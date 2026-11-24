import { languagePair } from './browser.js';

const model = 'Xenova/opus-mt-ja-en';
const revision = '1a906cfaaf7c8f4193f67f5885c082aa6dbd9d16';
let localEngine;

export async function createPageTranslator(status) {
  if (globalThis.Translator && await Translator.availability(languagePair) === 'available') {
    try {
      const native = await Translator.create(languagePair);
      return { translate: text => native.translate(text), close: () => native.destroy() };
    } catch (error) {
      console.warn('Chrome Translator could not start:', error);
    }
  }
  status('Preparing offline Japanese → English model (115 MB on first use)…');
  localEngine ??= loadLocalEngine(status).catch(error => {
    localEngine = null;
    throw error;
  });
  const engine = await localEngine;
  return {
    async translate(text) {
      const [result] = await engine(text, { max_new_tokens: 96, num_beams: 1 });
      return result.translation_text;
    },
    async close() {
      localEngine = null;
      await engine.dispose();
    },
  };
}

async function loadLocalEngine(status) {
  const { env, pipeline } = await import('../engine/vendor/transformers.min.js');
  env.allowLocalModels = false;
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('engine/vendor/');
  return pipeline('translation', model, {
    revision, device: 'wasm', dtype: 'q8',
    progress_callback(event) {
      if (event.status === 'progress') status(`Downloading translation model · ${Math.round(event.progress)}%`);
    },
  });
}
