import { detectBubbles, bubbleCrop } from './bubbles.js';
import { OcrPool } from './ocr.js';
import { extractRegions, bubbleText, japaneseCount } from './regions.js';
import { groupLines, isExcluded, LRU, readingOrder } from './geometry.js';
import { getTranslator, translationQueue } from '../providers/pageTranslation.js';
import * as accurate from './accurate.js';

export const ENGINE_VERSION = 'e2';
const pool = new OcrPool();
const crops = new LRU(500);            // crop hash -> { text, confidence } (OCR result)
const translations = new LRU(1000);    // Japanese text -> English
const latest = new Map();              // tabId -> latest capture requestId
const stats = { ocrJobs: 0, cacheHits: 0, accurateJobs: 0, images: 0, imageCacheHits: 0 };

const send = message => chrome.runtime.sendMessage(message).catch(() => {});

chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (sender.tab || sender.id !== chrome.runtime.id) return;
  const reply = promise => { promise.then(respond, e => respond({ error: e.message || String(e) })); return true; };
  switch (request.action) {
    case 'engine_warm':
      return reply((async () => {
        await pool.warm();
        await getTranslator(() => {}, { test: request.settings?.debugEchoTranslator }).catch(() => {});
        if (request.settings?.accurateMode && await accurate.isInstalled()) await accurate.detectLines(new OffscreenCanvas(32, 32)).catch(() => {});
        return { ok: true };
      })());
    case 'engine_stats': respond({ ...stats, cachedCrops: crops.size, isolated: globalThis.crossOriginIsolated, poolSize: pool.size }); return;
    case 'engine_cancel': latest.set(request.tabId, -1); respond({ ok: true }); return;
    case 'accurate_install': return reply(accurate.install(m => send({ action: 'page_translation_status', tabId: request.tabId, message: m })).then(() => ({ ok: true })));
    case 'accurate_remove': return reply(accurate.remove().then(() => ({ ok: true })));
    case 'translate_captured_page': {
      latest.set(request.tabId, request.requestId);
      return reply(translateCapture(request).then(results => ({ results })));
    }
    case 'translate_image': return reply(enqueueImage(request));
  }
});

async function translateCapture(req) {
  const source = await createImageBitmap(await (await fetch(req.image)).blob());
  try {
    const alive = () => latest.get(req.tabId) === req.requestId;
    return await runPipeline(source, req, alive, result =>
      send({ action: 'page_translation_result', tabId: req.tabId, requestId: req.requestId, result }));
  } finally { source.close(); }
}

// ---- source images, one at a time, nearest-to-viewport first, cached in IndexedDB
const imageQueue = [];
let imageRunning = false;
function enqueueImage(req) {
  return new Promise((resolve, reject) => {
    imageQueue.push({ req, resolve, reject });
    imageQueue.sort((a, b) => (a.req.priority ?? 0) - (b.req.priority ?? 0));
    pumpImages();
  });
}
async function pumpImages() {
  if (imageRunning) return;
  imageRunning = true;
  while (imageQueue.length) {
    const { req, resolve, reject } = imageQueue.shift();
    try { resolve(await translateImage(req)); } catch (e) { reject(e); }
  }
  imageRunning = false;
}
async function translateImage(req) {
  const cacheKey = [req.url, req.width, req.height, ENGINE_VERSION, req.settings?.accurateMode ? 'a' : 'f', req.settings?.debugEchoTranslator ? 't' : ''].join('|');
  const hit = await idb('get', cacheKey).catch(() => null);
  if (hit) { stats.imageCacheHits++; return { results: hit, cached: true }; }
  const response = await fetch(req.url, { credentials: 'include', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error('Image fetch failed: ' + response.status);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/') && blob.type !== '') throw Error('Not an image');
  const source = await createImageBitmap(blob);
  try {
    if (req.width && Math.abs(source.width - req.width) > 2) throw Error('Fetched image differs from the page image');
    stats.images++;
    const results = await runPipeline(source, req, () => true, result =>
      send({ action: 'page_translation_result', tabId: req.tabId, imageKey: req.imageKey, result }));
    await idb('put', cacheKey, results).catch(() => {});
    return { results, width: source.width, height: source.height };
  } finally { source.close(); }
}

// ---- the pipeline: detect → masked crops → OCR (pool, cached) → streamed batched translation
async function runPipeline(source, req, alive, emit) {
  const settings = req.settings || {};
  const status = message => send({ action: 'page_translation_status', tabId: req.tabId, message });
  status('Finding speech bubbles…');
  const exclude = req.exclude || [];
  const prepared = [];
  for (const candidate of detectBubbles(source)) {
    if (isExcluded(candidate, exclude)) continue;
    const crop = bubbleCrop(source, candidate);
    if (crop) prepared.push({ ...crop, x: crop.bubble.x, y: crop.bubble.y, w: crop.bubble.w, h: crop.bubble.h });
  }
  const ordered = readingOrder(prepared);
  const useAccurate = settings.accurateMode && await accurate.isInstalled().catch(() => false);
  const translator = await getTranslator(status, { test: settings.debugEchoTranslator });
  const results = [];
  let id = 0;
  const queue = translationQueue(translator, (item, english) => {
    const text = (english || '').trim();
    if (!text || text === item.text) return;
    translations.set(translator.kind + ':' + item.text, text);
    const result = { ...item.box, id: item.id, text, source: item.text, automatic: true };
    results.push(result);
    if (alive()) emit(result);
  });
  const deliver = (box, read) => {
    if (!read || !japaneseCount(read.text) || !alive()) return;
    const item = { id: id++, text: read.text, box };
    const known = translations.get(translator.kind + ':' + read.text);
    if (known) { const result = { ...box, id: item.id, text: known, source: read.text, automatic: true }; results.push(result); emit(result); }
    else queue.push(item);
  };
  if (ordered.length) status(`Reading ${ordered.length} bubble${ordered.length === 1 ? '' : 's'}…`);
  await Promise.all(ordered.map(async crop => {
    if (!alive()) return;
    let read = crops.get(crop.hash);
    if (read !== undefined) stats.cacheHits++;
    else {
      stats.ocrJobs++;
      const data = await pool.recognize(crop.canvas, crop.vertical);
      read = bubbleText(extractRegions(data, 55), crop.vertical);
      if (useAccurate && (!read || read.confidence < 60)) {
        stats.accurateJobs++;
        const second = await accurate.readCrop(crop.canvas, crop.vertical).catch(() => null);
        if (second && japaneseCount(second.text) && (!read || second.confidence > read.confidence)) read = second;
      }
      crops.set(crop.hash, read);
    }
    deliver({ ...crop.bubble }, read);
  }));
  // Accurate mode: nothing bubble-shaped found — look for text lines anywhere (narration, text on art).
  if (useAccurate && !ordered.length && alive()) {
    status('No bubbles found · scanning for text lines…');
    for (const group of groupLines(await accurate.detectLines(source))) {
      if (isExcluded(group, exclude)) continue;
      const parts = [];
      for (const line of group.lines) { stats.accurateJobs++; const r = await accurate.recognizeLine(source, line); if (japaneseCount(r.text)) parts.push({ ...line, ...r }); }
      if (!parts.length) continue;
      const vertical = group.h > group.w;
      parts.sort((a, b) => vertical ? b.x - a.x : a.y - b.y);
      deliver({ x: group.x, y: group.y, w: group.w, h: group.h, dark: false, shape: 'rect' }, { text: parts.map(p => p.text).join(''), confidence: 70 });
    }
  }
  await queue.drain();
  return results;
}

// ---- tiny IndexedDB key/value store for source-image results
let dbPromise;
function idb(op, key, value) {
  dbPromise ??= new Promise((resolve, reject) => {
    const open = indexedDB.open('mtp-results', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('images');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  return dbPromise.then(db => new Promise((resolve, reject) => {
    const store = db.transaction('images', op === 'get' ? 'readonly' : 'readwrite').objectStore('images');
    const r = op === 'get' ? store.get(key) : store.put({ value, at: Date.now() }, key);
    r.onsuccess = () => resolve(op === 'get' ? r.result?.value ?? null : true);
    r.onerror = () => reject(r.error);
  }));
}
