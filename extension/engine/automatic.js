import { detectBubbles, bubbleCrop } from './bubbles.js';
import { OcrPool } from './ocr.js';
import { extractRegions, bubbleText, japaneseCount } from './regions.js';
import { coverage, isExcluded, LRU, readingOrder } from './geometry.js';
import { getTranslator, translationQueue } from '../providers/pageTranslation.js';
import * as accurate from './accurate.js';

export const ENGINE_VERSION = 'e4';
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
        if (request.settings?.accurateMode && await accurate.isInstalled()) await accurate.warm().catch(() => {});
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
    // A capture may cut bubbles at the screen edge; keep them (flagged partial) rather than miss them.
    return await runPipeline(source, req, alive, result =>
      send({ action: 'page_translation_result', tabId: req.tabId, requestId: req.requestId, result }), { allowEdges: true });
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
  let response;
  try {
    response = await fetch(req.url, { credentials: 'include', signal: AbortSignal.timeout(30000) });
  } catch (error) {
    // A network-level failure here almost always means CORS: the extension has no access to the image host.
    throw Error(error?.name === 'TimeoutError' ? 'timeout' : 'blocked');
  }
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
async function runPipeline(source, req, alive, emit, { allowEdges = false } = {}) {
  const settings = req.settings || {};
  const status = message => send({ action: 'page_translation_status', tabId: req.tabId, message });
  status('Finding speech bubbles…');
  const exclude = req.exclude || [];
  const prepared = [], candidates = detectBubbles(source, { allowEdges });
  for (const candidate of candidates) {
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
    const key = crop.hash + (useAccurate ? 'a' : '');
    let read = crops.get(key);
    if (read !== undefined) stats.cacheHits++;
    else {
      stats.ocrJobs++;
      const data = await pool.recognize(crop.canvas, crop.vertical);
      read = bubbleText(extractRegions(data, 55), crop.vertical);
      if (useAccurate && (!read || read.confidence < 60)) {
        // manga-ocr reads stylised manga lettering far better; prefer it when Tesseract is unsure.
        stats.accurateJobs++;
        const second = await accurate.readText(crop.canvas).catch(() => null);
        if (second && japaneseCount(second.text)) read = second;
      }
      crops.set(key, read);
    }
    deliver({ ...crop.bubble }, read);
  }));
  // Accurate mode: the learned detector finds what the heuristic missed — grey or textured bubbles,
  // narration and text drawn on the art — and manga-ocr reads each one.
  if (useAccurate && alive()) {
    status('Looking for text outside bubbles…');
    const regions = await accurate.detectRegions(source).catch(() => []);
    const known = [...candidates, ...exclude];
    for (const r of regions) {
      if (r.label === 'text_bubble' || !alive()) continue;
      if (known.some(k => coverage(r, k) > 0.3 || coverage(k, r) > 0.5)) continue;
      // Read the text box inside a bubble when the detector found one; it is a tighter crop.
      const inner = r.label === 'bubble' && regions.find(t => t.label === 'text_bubble' && coverage(t, r) > 0.8);
      const rect = inner || r;
      stats.accurateJobs++;
      const read = await accurate.readText(source, rect).catch(() => null);
      deliver({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), shape: r.label === 'bubble' ? 'ellipse' : 'rect', dark: isDark(source, r) }, read);
    }
  }
  await queue.drain();
  return results;
}

// Average brightness of a region decides white-on-black overlays.
function isDark(source, r) {
  const c = new OffscreenCanvas(16, 16), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(source, r.x, r.y, r.w, r.h, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;
  return sum / 256 < 100;
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
