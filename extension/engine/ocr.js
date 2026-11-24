import { installModel } from '../reader/models.js';

export async function createJapaneseWorker(code, logger) {
  await installModel(code);
  const url = path => chrome.runtime.getURL('reader/' + path);
  return Tesseract.createWorker(code, 1, {
    workerPath: url('vendor/worker.min.js'),
    workerBlobURL: false,
    corePath: url('vendor/tesseract-core-lstm.wasm.js'),
    langPath: url('data'),
    gzip: false,
    cacheMethod: 'none',
    logger,
  });
}
