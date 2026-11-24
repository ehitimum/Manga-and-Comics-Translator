// Engine benchmark page: the real detector, crops and OCR pool, without extension APIs.
import { detectBubbles, bubbleCrop } from '/ext/engine/bubbles.js';
import { OcrPool } from '/ext/engine/ocr.js';
import { extractRegions, bubbleText } from '/ext/engine/regions.js';
import { readingOrder } from '/ext/engine/geometry.js';

const pool = new OcrPool({
  paths: { workerPath: '/ext/reader/vendor/worker.min.js', corePath: '/ext/reader/vendor', langPath: '/cache' },
  install: async () => {},
  size: 2,
});

async function run(image) {
  const t = {}, start = performance.now();
  let s = performance.now();
  const source = await createImageBitmap(await (await fetch(image)).blob());
  t.decode = performance.now() - s; s = performance.now();
  const candidates = detectBubbles(source);
  t.detect = performance.now() - s; s = performance.now();
  const crops = readingOrder(candidates.map(c => bubbleCrop(source, c)).filter(Boolean).map(c => ({ ...c, ...c.bubble })));
  t.crop = performance.now() - s; s = performance.now();
  let first = null;
  const results = [];
  await Promise.all(crops.map(async c => {
    const read = bubbleText(extractRegions(await pool.recognize(c.canvas, c.vertical), 55), c.vertical);
    if (read) { results.push({ ...c.bubble, ...read }); first ??= performance.now() - start; }
  }));
  t.ocr = performance.now() - s;
  source.close();
  return { t, total: performance.now() - start, first, candidates: candidates.length, crops: crops.length, results };
}

window.engineBench = { warm: () => pool.warm(), run, close: () => pool.close() };
window.benchReady = true;
