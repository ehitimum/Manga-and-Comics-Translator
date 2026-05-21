// Background service worker for Manga Translator Pro.
//
// Responsibilities:
//   1. Receive "capture_and_translate" requests from content scripts or popup.
//   2. Capture the visible tab as a PNG.
//   3. Route to the user-selected provider (Ollama or local FastAPI server).
//   4. Return translation results to the caller.
//
// Coordinate convention:
//   - captureVisibleTab returns a PNG at the device pixel ratio (DPR).
//   - Provider returns boxes in IMAGE pixels (i.e. PNG-space).
//   - Content script converts those to CSS pixels using window.devicePixelRatio.

import { translateWithOllama, testOllama } from './providers/ollama.js';
import { translateWithLocalServer, testLocalServer } from './providers/localServer.js';
import { translateWithGemini, testGemini } from './providers/gemini.js';

const DEFAULT_SETTINGS = {
  provider: 'gemini',                       // 'ollama' | 'local' | 'gemini' — Gemini is the easy path
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'moondream:latest',          // small vision model (~1.7GB). qwen2.5vl:7b is better but RAM-heavy.
  localServerUrl: 'http://localhost:8001',  // matches `python app.py` default
  geminiApiKey: '',                         // free key at aistudio.google.com/apikey
  geminiModel: 'gemini-2.5-flash',          // Dev default. For production: switch to gemini-2.5-pro (better spatial reasoning, requires Pro billing).
  autoMode: false,
};

let isProcessing = false;

// ------------------------------------------------------------
// Message router
// ------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'capture_and_translate':
      handleCaptureAndTranslate(sender, sendResponse);
      return true; // async

    case 'test_connection':
      handleTestConnection(request.provider, sendResponse);
      return true;

    case 'inject_content_script':
      handleInjectContentScript(request.tabId, sendResponse);
      return true;
  }
});

// ------------------------------------------------------------
// Capture + translate
// ------------------------------------------------------------

async function handleCaptureAndTranslate(sender, sendResponse) {
  if (isProcessing) {
    sendResponse({ error: 'A translation is already in progress.' });
    return;
  }
  isProcessing = true;

  try {
    const tabId = sender.tab?.id;
    const settings = await getSettings();

    // Capture visible tab as PNG
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const base64Image = dataUrl.split(',')[1];

    // Route to provider
    const results = await callProviderWithRetry(settings, base64Image);

    sendResponse({ results });
  } catch (error) {
    console.error('[MangaTranslator] capture_and_translate failed:', error);
    sendResponse({ error: error.message || String(error) });
  } finally {
    isProcessing = false;
  }
}

async function callProviderWithRetry(settings, base64Image, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await callProvider(settings, base64Image);
    } catch (err) {
      lastErr = err;
      const msg = err.message || '';
      // Don't retry on timeout — the caller already waited 90s, doubling the wait helps no one.
      const isTimeout = /timed out|abort/i.test(msg);
      // 503 (overloaded), 429 (rate limit), and network/JSON glitches are worth retrying with backoff.
      const isServerBusy = /\b(503|429)\b/.test(msg);
      const transient = !isTimeout && (isServerBusy || /network|fetch|JSON/i.test(msg));
      if (!transient || attempt === maxAttempts) throw err;
      const backoffMs = isServerBusy ? 2000 * attempt : 500 * attempt;
      console.warn(`[MangaTranslator] attempt ${attempt} failed, retrying in ${backoffMs}ms:`, msg);
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}

async function callProvider(settings, base64Image) {
  switch (settings.provider) {
    case 'ollama':
      return translateWithOllama(base64Image, settings);
    case 'local':
      return translateWithLocalServer(base64Image, settings);
    case 'gemini':
      return translateWithGemini(base64Image, settings);
    default:
      throw new Error(`Unknown provider: ${settings.provider}`);
  }
}

// ------------------------------------------------------------
// Connection test (used by options page)
// ------------------------------------------------------------

async function handleTestConnection(providerName, sendResponse) {
  try {
    const settings = await getSettings();
    let result;
    if (providerName === 'ollama') {
      result = await testOllama(settings);
    } else if (providerName === 'local') {
      result = await testLocalServer(settings);
    } else if (providerName === 'gemini') {
      result = await testGemini(settings);
    } else {
      throw new Error(`Unknown provider: ${providerName}`);
    }
    sendResponse(result);
  } catch (err) {
    sendResponse({ ok: false, error: err.message || String(err) });
  }
}

// ------------------------------------------------------------
// On-demand content script injection (replaces the broad
// content_scripts entry in manifest)
// ------------------------------------------------------------

async function handleInjectContentScript(tabId, sendResponse) {
  try {
    const id = tabId || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
    if (!id) throw new Error('No active tab.');

    // Inject only if not already injected
    const [{ result: alreadyInjected } = {}] = await chrome.scripting.executeScript({
      target: { tabId: id },
      func: () => Boolean(window.__mangaTranslatorInjected),
    });

    if (!alreadyInjected) {
      await chrome.scripting.executeScript({
        target: { tabId: id },
        files: ['content.js'],
      });
    }
    sendResponse({ ok: true });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

// ------------------------------------------------------------
// Settings helper
// ------------------------------------------------------------

async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...stored };
}

// ------------------------------------------------------------
// Init: write defaults on install
// ------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const missing = {};
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (stored[k] === undefined) missing[k] = v;
  }
  if (Object.keys(missing).length > 0) {
    await chrome.storage.local.set(missing);
  }
});

// ------------------------------------------------------------
// Utility
// ------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
