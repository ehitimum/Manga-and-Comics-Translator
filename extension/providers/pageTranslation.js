import { languagePair } from './browser.js';

const model = 'Xenova/opus-mt-ja-en';
const revision = '1a906cfaaf7c8f4193f67f5885c082aa6dbd9d16';
const IDLE_MS = 5 * 60 * 1000;

let current = null; // { kind, translateBatch, close, timer }

function keepAlive(t) {
  clearTimeout(t.timer);
  t.timer = setTimeout(() => { if (current === t) current = null; t.close().catch(() => {}); }, IDLE_MS);
  return t;
}

// Test-only translator selected by the background for unpacked test runs; never chosen by users.
const echo = { kind: 'echo', translateBatch: async texts => texts.map(t => '[EN] ' + t), close: async () => {} };

async function chromeTranslator(status) {
  if (!globalThis.Translator) return null;
  let availability = await Translator.availability(languagePair);
  // The popup starts Chrome's language-pack download; wait for it rather than downloading OPUS-MT too.
  for (let waited = 0; availability === 'downloading' && waited < 120; waited++) {
    status("Waiting for Chrome's Japanese language pack…");
    await new Promise(r => setTimeout(r, 1000));
    availability = await Translator.availability(languagePair);
  }
  if (availability !== 'available') return null;
  try {
    const native = await Translator.create(languagePair);
    return {
      kind: 'chrome',
      // Chrome's translator is fast per call; keep order and stop on the first failure.
      translateBatch: async texts => { const out = []; for (const t of texts) out.push(await native.translate(t)); return out; },
      close: async () => native.destroy(),
    };
  } catch (error) {
    console.warn('Chrome Translator could not start:', error);
    return null;
  }
}

let localEngine = null;
async function opusTranslator(status) {
  status('Preparing offline Japanese → English model (115 MB on first use)…');
  localEngine ??= loadLocalEngine(status).catch(error => { localEngine = null; throw error; });
  const engine = await localEngine;
  return {
    kind: 'opus',
    async translateBatch(texts) {
      const out = await engine(texts, { max_new_tokens: 96, num_beams: 1 });
      return (Array.isArray(out) ? out : [out]).map(r => r.translation_text);
    },
    async close() { localEngine = null; await engine.dispose(); },
  };
}

// Returns a warm translator, reusing the previous one unless Chrome's translator became available.
export async function getTranslator(status = () => {}, { test = false } = {}) {
  if (test) return echo;
  if (current && current.kind === 'opus' && globalThis.Translator &&
      await Translator.availability(languagePair) === 'available') {
    const old = current; current = null; old.close().catch(() => {});
  }
  if (!current) current = (await chromeTranslator(status)) || (await opusTranslator(status));
  return keepAlive(current);
}

// Kept for callers that expect the old one-text API.
export async function createPageTranslator(status) {
  const t = await getTranslator(status);
  return { translate: async text => (await t.translateBatch([text]))[0], close: async () => {} };
}

export async function disposeTranslator() {
  const t = current; current = null;
  if (t) { clearTimeout(t.timer); await t.close(); }
}

async function loadLocalEngine(status) {
  const { env, pipeline } = await import('../engine/vendor/transformers.min.js');
  env.allowLocalModels = false;
  // Threads need cross-origin isolation (manifest COOP/COEP); fall back to one thread otherwise.
  env.backends.onnx.wasm.numThreads = globalThis.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) >> 1)) : 1;
  env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('engine/vendor/');
  return pipeline('translation', model, {
    revision, device: 'wasm', dtype: 'q8',
    progress_callback(event) {
      if (event.status === 'progress') status(`Downloading translation model · ${Math.round(event.progress)}%`);
    },
  });
}

// Queue that translates in small batches as OCR results arrive; the first item goes out alone
// so the first overlay appears as soon as possible.
export function translationQueue(translator, onResult, { batch = 6 } = {}) {
  const pending = [];
  let running = null, failed = null;
  const pump = async () => {
    while (pending.length) {
      const items = pending.splice(0, batch);
      try {
        const out = await translator.translateBatch(items.map(i => i.text));
        items.forEach((item, k) => onResult(item, out[k]));
      } catch (error) { failed = error; pending.length = 0; }
    }
    running = null;
  };
  return {
    push(item) { if (failed) return; pending.push(item); running ??= pump(); },
    async drain() { while (running) await running; if (failed) throw failed; },
  };
}
