import { installModel } from '../reader/models.js';

// Paths default to the extension; the benchmark overrides them.
const extensionPaths = () => {
  const url = path => chrome.runtime.getURL('reader/' + path);
  // A directory (not a single .js file) lets tesseract.js pick the SIMD / relaxed-SIMD build.
  return { workerPath: url('vendor/worker.min.js'), corePath: url('vendor'), langPath: url('data') };
};

export async function createJapaneseWorker(code, logger, paths = extensionPaths(), install = installModel) {
  await install(code);
  return Tesseract.createWorker(code, 1, {
    ...paths, workerBlobURL: false, gzip: false,
    cacheMethod: 'none', // installModel() caches and the service worker serves the files
    ...(logger ? { logger } : {}),
  });
}

export function poolSize({ cores = navigator.hardwareConcurrency || 2, memory = navigator.deviceMemory || 8 } = {}) {
  return cores >= 4 && memory >= 4 ? 2 : 1;
}

const OUTPUT = { blocks: true, text: false };

// One scheduler per orientation, kept warm between pages and released after `idleMs`.
export class OcrPool {
  constructor({ paths, install, idleMs = 5 * 60 * 1000, size = poolSize() } = {}) {
    Object.assign(this, { paths, install, idleMs, size, ready: null, timer: null, jobs: 0 });
  }
  warm() {
    this.touch();
    this.ready ??= (async () => {
      const make = async (code, psm) => {
        const scheduler = Tesseract.createScheduler();
        for (let i = 0; i < this.size; i++) {
          const worker = await createJapaneseWorker(code, undefined, this.paths ?? extensionPaths(), this.install ?? installModel);
          await worker.setParameters({ tessedit_pageseg_mode: psm });
          scheduler.addWorker(worker);
        }
        return scheduler;
      };
      const [h, v] = await Promise.all([make('jpn', '6'), make('jpn_vert', '5')]);
      return { h, v };
    })().catch(error => { this.ready = null; throw error; });
    return this.ready;
  }
  async recognize(image, vertical) {
    const pool = await this.warm();
    this.jobs++;
    try {
      const { data } = await (vertical ? pool.v : pool.h).addJob('recognize', image, {}, OUTPUT);
      return data;
    } finally { this.touch(); }
  }
  touch() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.close(), this.idleMs);
  }
  async close() {
    clearTimeout(this.timer);
    const ready = this.ready;
    this.ready = null;
    if (!ready) return;
    const pool = await ready.catch(() => null);
    if (pool) await Promise.all([pool.h.terminate(), pool.v.terminate()]);
  }
}
