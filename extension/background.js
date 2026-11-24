// Background service worker for Manga Translator Pro.
//
// - Captures the visible tab (rate-limited to Chrome's 2 calls/second) or routes source-image jobs.
// - Runs the on-device engine in an offscreen document and relays its streamed results to the tab.
// - Routes other providers (Gemini, Ollama, local server), keyboard shortcuts, snapshots and
//   "Always translate on this site" registrations.
//
// Coordinates: providers and the engine return boxes in IMAGE pixels (capture px = CSS px × DPR,
// or the source image's natural pixels). The content script maps them onto page elements.

import { translateWithOllama, testOllama } from './providers/ollama.js';
import { translateWithLocalServer, testLocalServer } from './providers/localServer.js';
import { translateWithGemini, testGemini } from './providers/gemini.js';
import { ocrCache, modelUrl, models } from './reader/models.js';

export const DEFAULT_SETTINGS = {
  provider: 'browser',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'moondream:latest',
  localServerUrl: 'http://localhost:8001',
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  autoMode: false,
  accurateMode: false,
  autoSites: [],
};
const ENGINE_URL = 'engine/automatic.html';

self.addEventListener('fetch', event => {
  const prefix = chrome.runtime.getURL('reader/data/');
  if (event.request.url.startsWith(prefix)) {
    const code = event.request.url.slice(prefix.length).replace(/\.traineddata$/, '');
    if (!Object.hasOwn(models, code)) return;
    event.respondWith(caches.open(ocrCache).then(async cache =>
      await cache.match(modelUrl(code)) || new Response('OCR model missing', { status: 404 })));
  }
});

const busyTabs = new Set();
let lastCapture = 0;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const reply = promise => { promise.then(sendResponse, e => sendResponse({ error: e.message || String(e) })); return true; };
  const fromEngine = sender.url === chrome.runtime.getURL(ENGINE_URL);
  switch (request.action) {
    case 'capture_and_translate': return reply(captureAndTranslate(sender, request));
    case 'translate_source_image': return reply(translateSourceImage(sender, request));
    case 'page_translation_status':
    case 'page_translation_result':
      if (fromEngine && request.tabId >= 0) chrome.tabs.sendMessage(request.tabId, request, { frameId: 0 }).catch(() => {});
      return;
    case 'engine_warm': return reply(warmEngine());
    case 'engine_forward': return reply(forwardToEngine(request.message));
    case 'draw_in_frame':
      // Sent to every frame; only the frame whose URL matches answers.
      if (sender.tab) return reply(chrome.tabs.sendMessage(sender.tab.id, request));
      return;
    case 'open_snapshot': return reply(openSnapshot(request.tabId ?? sender.tab?.id));
    case 'register_site': return reply(registerSite(request.origin, request.enable));
    case 'test_connection': return reply(testConnection(request.provider));
    case 'inject_content_script': return reply(injectContentScript(request.tabId).then(() => ({ ok: true })));
  }
});

// ------------------------------------------------------------ engine

async function ensureEngine() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(ENGINE_URL)] });
  if (!contexts.length) {
    try {
      await chrome.offscreen.createDocument({ url: ENGINE_URL, reasons: ['WORKERS'], justification: 'Run local OCR and translation workers on manga images.' });
    } catch (error) {
      if (!/single offscreen/i.test(error.message)) throw error; // created concurrently
    }
  }
}

async function engineSettings() {
  const { accurateMode = false, debugEchoTranslator = false } = await chrome.storage.local.get(['accurateMode', 'debugEchoTranslator']);
  return { accurateMode, debugEchoTranslator };
}

async function forwardToEngine(message) {
  await ensureEngine();
  return chrome.runtime.sendMessage({ ...message, settings: await engineSettings() });
}

async function warmEngine() {
  const { provider } = await getSettings();
  if (provider !== 'browser') return { ok: true, skipped: true };
  return forwardToEngine({ action: 'engine_warm' });
}

// ------------------------------------------------------------ capture + translate

async function captureAndTranslate(sender, request) {
  const tab = sender.tab;
  if (!tab) throw new Error('Open a manga tab to capture it.');
  if (busyTabs.has(tab.id)) return { error: 'busy' };
  busyTabs.add(tab.id);
  try {
    const settings = await getSettings();
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (active?.id !== tab.id) throw new Error('Return to the manga tab and click Translate.');
    const wait = 520 - (Date.now() - lastCapture);
    if (wait > 0) await sleep(wait);
    lastCapture = Date.now();
    const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    let results;
    if (settings.provider === 'browser') {
      const response = await forwardToEngine({
        action: 'translate_captured_page', image, tabId: tab.id, requestId: request.requestId,
        exclude: request.exclude || [],
      });
      if (response?.error) throw new Error(response.error);
      results = response?.results || [];
    } else {
      results = await callProviderWithRetry(settings, image.split(',')[1]);
    }
    saveSnapshot(tab, image, results, request.dpr).catch(() => {});
    return { results, streamed: settings.provider === 'browser' };
  } finally {
    busyTabs.delete(tab.id);
  }
}

async function translateSourceImage(sender, request) {
  const { provider } = await getSettings();
  if (provider !== 'browser') return { error: 'unsupported' };
  const response = await forwardToEngine({
    action: 'translate_image', tabId: sender.tab.id, url: request.url, width: request.width,
    height: request.height, imageKey: request.imageKey, priority: request.priority ?? 0,
  });
  return response || { error: 'No response from the engine.' };
}

async function callProviderWithRetry(settings, base64Image, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callProvider(settings, base64Image);
    } catch (err) {
      lastErr = err;
      const msg = err.message || '';
      const isTimeout = /timed out|abort/i.test(msg);
      const isServerBusy = /\b(503|429)\b/.test(msg);
      const transient = !isTimeout && (isServerBusy || /network|fetch|JSON/i.test(msg));
      if (!transient || attempt === maxAttempts) throw err;
      await sleep(isServerBusy ? 2000 * attempt : 500 * attempt);
    }
  }
  throw lastErr;
}

function callProvider(settings, base64Image) {
  switch (settings.provider) {
    case 'ollama': return translateWithOllama(base64Image, settings);
    case 'local': return translateWithLocalServer(base64Image, settings);
    case 'gemini': return translateWithGemini(base64Image, settings);
    default: throw new Error(`Unknown provider: ${settings.provider}`);
  }
}

async function testConnection(provider) {
  const settings = await getSettings();
  try {
    if (provider === 'ollama') return await testOllama(settings);
    if (provider === 'local') return await testLocalServer(settings);
    if (provider === 'gemini') return await testGemini(settings);
    throw new Error(`Unknown provider: ${provider}`);
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// ------------------------------------------------------------ snapshot view

async function saveSnapshot(tab, image, results, dpr = 1) {
  // Session storage lives in memory and is cleared when the browser closes or the view is closed.
  if (image.length > 7_000_000) return;
  await chrome.storage.session.set({ ['snapshot:' + tab.id]: { image, results, dpr, url: tab.url, at: Date.now() } });
}

async function openSnapshot(tabId) {
  if (tabId == null) throw new Error('No tab.');
  const { ['snapshot:' + tabId]: snap } = await chrome.storage.session.get('snapshot:' + tabId);
  if (!snap) throw new Error('Translate the page once, then open the snapshot.');
  await chrome.tabs.create({ url: chrome.runtime.getURL(`reader/snapshot.html?tab=${tabId}`) });
  return { ok: true };
}

// ------------------------------------------------------------ injection, shortcuts, per-site

async function injectContentScript(tabId) {
  const id = tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (!id) throw new Error('No active tab.');
  const files = ['render/fit.js', 'content.js'];
  try {
    await chrome.scripting.executeScript({ target: { tabId: id, allFrames: true }, files });
  } catch {
    // Some frames may be off-limits; the top frame is enough to translate.
    await chrome.scripting.executeScript({ target: { tabId: id }, files });
  }
  return id;
}

chrome.commands?.onCommand.addListener(async (command, tab) => {
  if (!tab?.id || !/^https?:|^file:/.test(tab.url || '')) return;
  try {
    if (command === 'toggle-auto') {
      const { autoMode } = await chrome.storage.local.get('autoMode');
      await chrome.storage.local.set({ autoMode: !autoMode });
    }
    await injectContentScript(tab.id);
    const action = { 'translate-page': 'trigger_from_popup', 'toggle-original': 'toggle_original', 'toggle-auto': 'auto_changed' }[command];
    if (action) await chrome.tabs.sendMessage(tab.id, { action }, { frameId: 0 });
  } catch (error) {
    console.warn('[MangaTranslator] command failed:', error);
  }
});

const siteScriptId = origin => 'site-' + origin.replace(/[^a-z0-9]/gi, '_');

async function registerSite(origin, enable) {
  const url = new URL(origin);
  const pattern = `${url.protocol}//${url.host}/*`;
  const { autoSites = [] } = await chrome.storage.local.get('autoSites');
  const id = siteScriptId(url.origin);
  await chrome.scripting.unregisterContentScripts({ ids: [id] }).catch(() => {});
  if (enable) {
    await chrome.scripting.registerContentScripts([{ id, matches: [pattern], js: ['render/fit.js', 'content.js'], runAt: 'document_idle', allFrames: true }]);
    await chrome.storage.local.set({ autoSites: [...new Set([...autoSites, url.origin])] });
  } else {
    await chrome.storage.local.set({ autoSites: autoSites.filter(s => s !== url.origin) });
    await chrome.permissions.remove({ origins: [pattern] }).catch(() => {});
  }
  return { ok: true };
}

// ------------------------------------------------------------ settings

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...stored };
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const missing = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) if (stored[k] === undefined) missing[k] = v;
  if (details.reason === 'update' && stored.provider === 'gemini' && !stored.geminiApiKey?.trim()) missing.provider = 'browser';
  if (Object.keys(missing).length) await chrome.storage.local.set(missing);
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
