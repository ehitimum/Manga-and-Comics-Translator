// Opt-in Accurate mode (all Apache-2.0):
//  - comic text & bubble detector (ogkalu, RT-DETR-v2 small, int8, 11 MB) finds bubbles and text the
//    fast heuristic misses (grey/textured bubbles, narration and text drawn on the art);
//  - manga-ocr (kha-white, ONNX by onnx-community; uint8 encoder + int8 decoder, 117 MB) re-reads
//    bubbles Tesseract is unsure about.
// Files come from pinned Hugging Face revisions, are checked against SHA-256, and cached in Cache Storage.
const HF = 'https://huggingface.co';
const DETECTOR = `${HF}/ogkalu/comic-text-and-bubble-detector/resolve/16e8a622f91fabc6b5b65c96d32d1183f8843546`;
const MANGA_OCR = `${HF}/onnx-community/manga-ocr-base-ONNX/resolve/f9023406bb2f6b17df67bc4a327c56ecd20611f0/onnx`;
const VOCAB = `${HF}/kha-white/manga-ocr-base/resolve/aa6573bd10b0d446cbf622e29c3e084914df9741`;

export const MODELS = {
  detector: { url: `${DETECTOR}/detector-v4-s_int8.onnx`, bytes: 11120765, sha256: '5fe9e4f576e49d4e7e8b0e029d6d3cdc252abd4694113e1cae120e62c931ea79' },
  encoder: { url: `${MANGA_OCR}/encoder_model_uint8.onnx`, bytes: 86967805, sha256: 'a73e7a9959f3412f4d0ab60c8cd0f71c29e7e29a2e52a1e184ad6f2be3b892e3' },
  decoder: { url: `${MANGA_OCR}/decoder_model_int8.onnx`, bytes: 29627936, sha256: '2e7177d2b0a59f1c612b694ed70c13971bee765cc2b2bc7bc9376e4753652f27' },
  vocab: { url: `${VOCAB}/vocab.txt`, bytes: 24072, sha256: '344fbb6b8bf18c57839e924e2c9365434697e0227fac00b88bb4899b78aa594d' },
};
export const DOWNLOAD_MB = Math.round(Object.values(MODELS).reduce((s, m) => s + m.bytes, 0) / 1e6);
export const ACCURATE_CACHE = 'accurate-models-v2';
export const LABELS = ['bubble', 'text_bubble', 'text_free'];

async function sha256(buffer) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}

export async function isInstalled() {
  const cache = await caches.open(ACCURATE_CACHE);
  return (await Promise.all(Object.values(MODELS).map(m => cache.match(m.url)))).every(Boolean);
}

export async function install(status = () => {}) {
  const cache = await caches.open(ACCURATE_CACHE);
  let done = 0;
  for (const [name, m] of Object.entries(MODELS)) {
    if (!(await cache.match(m.url))) {
      status(`Downloading Accurate mode models · ${Math.round(100 * done / (DOWNLOAD_MB * 1e6))}%`);
      const response = await fetch(m.url, { signal: AbortSignal.timeout(600000) });
      if (!response.ok) throw Error(`Download of ${name} failed (${response.status}).`);
      const buf = await response.arrayBuffer();
      if (buf.byteLength !== m.bytes || await sha256(buf) !== m.sha256) throw Error(`The ${name} download was incomplete or changed.`);
      await cache.put(m.url, new Response(buf));
    }
    done += m.bytes;
  }
  // Older PP-OCRv5 cache from 0.5.0-beta.1 builds.
  for (const key of await caches.keys()) if (key.startsWith('ppocrv5-')) await caches.delete(key);
}

export const remove = () => { sessions = null; return caches.delete(ACCURATE_CACHE); };

let sessions = null;
async function load() {
  sessions ??= (async () => {
    const ort = await import('./vendor/ort/ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = chrome.runtime.getURL('engine/vendor/ort/');
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) >> 1)) : 1;
    const cache = await caches.open(ACCURATE_CACHE);
    const read = async name => {
      const r = await cache.match(MODELS[name].url);
      if (!r) throw Error('Accurate mode is not installed.');
      return r;
    };
    const session = async name => ort.InferenceSession.create(new Uint8Array(await (await read(name)).arrayBuffer()), { executionProviders: ['wasm'] });
    const [detector, encoder, decoder] = await Promise.all([session('detector'), session('encoder'), session('decoder')]);
    const vocab = (await (await read('vocab')).text()).split('\n').map(t => t.replace(/\r$/, ''));
    return { ort, detector, encoder, decoder, vocab };
  })().catch(e => { sessions = null; throw e; });
  return sessions;
}
export const warm = () => load();

function pixels(ort, image, size, sx, sy, sw, sh, mean, std) {
  const c = new OffscreenCanvas(size, size), g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff';
  g.fillRect(0, 0, size, size);
  g.drawImage(image, sx, sy, sw, sh, 0, 0, size, size);
  const d = g.getImageData(0, 0, size, size).data, n = size * size, f = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) f[i + k * n] = (d[i * 4 + k] / 255 - mean[k]) / std[k];
  return new ort.Tensor('float32', f, [1, 3, size, size]);
}

// Square-ish tiles along the long side so tall strips are not squashed into 640×640.
export function tiles(width, height, overlap = 0.12) {
  const side = Math.min(width, height), long = Math.max(width, height);
  const count = Math.min(8, Math.max(1, Math.ceil((long - side * overlap) / (side * (1 - overlap)))));
  const step = count > 1 ? (long - side) / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => width >= height
    ? { x: Math.round(i * step), y: 0, w: side, h: height }
    : { x: 0, y: Math.round(i * step), w: width, h: side });
}

const iou = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / (a.w * a.h + b.w * b.h - i);
};
// Keep the best box per label among overlapping ones (tile seams produce duplicates).
export function suppress(boxes, threshold = 0.5) {
  const kept = [];
  for (const b of [...boxes].sort((p, q) => q.score - p.score)) {
    if (!kept.some(k => k.label === b.label && iou(k, b) > threshold)) kept.push(b);
  }
  return kept;
}

// Boxes in image pixels: { x, y, w, h, label: 'bubble'|'text_bubble'|'text_free', score }.
export async function detectRegions(image, { minScore = 0.5 } = {}) {
  const { ort, detector } = await load();
  const out = [];
  for (const t of tiles(image.width, image.height)) {
    const res = await detector.run({
      images: pixels(ort, image, 640, t.x, t.y, t.w, t.h, [0, 0, 0], [1, 1, 1]),
      orig_target_sizes: new ort.Tensor('int64', BigInt64Array.from([BigInt(t.w), BigInt(t.h)]), [1, 2]),
    });
    const L = res.labels.data, B = res.boxes.data, S = res.scores.data;
    for (let i = 0; i < S.length; i++) {
      if (S[i] < minScore) continue;
      const [x0, y0, x1, y1] = [B[i * 4], B[i * 4 + 1], B[i * 4 + 2], B[i * 4 + 3]];
      out.push({ x: t.x + Math.max(0, x0), y: t.y + Math.max(0, y0), w: Math.min(t.w, x1) - Math.max(0, x0), h: Math.min(t.h, y1) - Math.max(0, y0), label: LABELS[Number(L[i])] || 'text_free', score: S[i] });
    }
  }
  return suppress(out.filter(b => b.w > 8 && b.h > 8));
}

// Join BERT-style character tokens, dropping special tokens and spaces (as manga-ocr's post-processing does).
export function decodeTokens(ids, vocab) {
  return ids.map(i => vocab[i] ?? '').filter(t => !/^\[(CLS|SEP|PAD|UNK|MASK)\]$/.test(t))
    .map(t => t.replace(/^##/, '')).join('').replace(/\s+/g, '').replace(/\.{3,}/g, '…');
}

// Softmax probability of the chosen token, for a confidence estimate.
export function tokenProbability(logits, offset, size, best) {
  let max = -Infinity, sum = 0;
  for (let k = 0; k < size; k++) if (logits[offset + k] > max) max = logits[offset + k];
  for (let k = 0; k < size; k++) sum += Math.exp(logits[offset + k] - max);
  return Math.exp(logits[offset + best] - max) / sum;
}

// Read one text block (a whole bubble) with manga-ocr: greedy decoding, start token 2, end token 3.
export async function readText(image, rect = { x: 0, y: 0, w: image.width, h: image.height }, { maxTokens = 64 } = {}) {
  const { ort, encoder, decoder, vocab } = await load();
  const { last_hidden_state } = await encoder.run({ pixel_values: pixels(ort, image, 224, rect.x, rect.y, rect.w, rect.h, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]) });
  const ids = [2];
  let confidence = 0;
  for (let step = 0; step < maxTokens; step++) {
    const { logits } = await decoder.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
      encoder_hidden_states: last_hidden_state,
    });
    const V = logits.dims[2], off = (ids.length - 1) * V, d = logits.data;
    let best = 0;
    for (let k = 1; k < V; k++) if (d[off + k] > d[off + best]) best = k;
    if (best === 3) break;
    confidence += tokenProbability(d, off, V, best);
    ids.push(best);
  }
  const text = decodeTokens(ids.slice(1), vocab);
  return { text, confidence: ids.length > 1 ? 100 * confidence / (ids.length - 1) : 0 };
}
