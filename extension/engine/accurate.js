// Opt-in Accurate mode: PP-OCRv5 mobile (Apache-2.0) as a second pass for low-confidence crops and as a
// text-line detector when no bubbles are found. Models come from a pinned, immutable PyPI wheel whose
// SHA-256 is verified before use, then are cached unpacked in Cache Storage.
export const WHEEL = {
  url: 'https://files.pythonhosted.org/packages/8b/69/9e21a9884769a604ca43928da8eb6c4917188bde21d4d649b2a436849f4c/onnxocr_ppocrv5-0.0.23-py3-none-any.whl',
  sha256: '63476d092e2194756775ac57af0500389054b5ba0fe9f777f882ccd33067263f',
  bytes: 19176650,
  files: {
    det: { path: 'onnxocr/models/ppocrv5/det/det.onnx', sha256: 'd7fe3ea74652890722c0f4d02458b7261d9f5ae6c92904d05707c9eb155c7924' },
    rec: { path: 'onnxocr/models/ppocrv5/rec/rec.onnx', sha256: 'bf66820f48fa99f779974c4df78e5274a9d8e0458c4137e8c5357e40e2c3faf2' },
    dict: { path: 'onnxocr/models/ppocrv5/ppocrv5_dict.txt', sha256: 'd1979e9f794c464c0d2e0b70a7fe14dd978e9dc644c0e71f14158cdf8342af1b' },
  },
};
export const ACCURATE_CACHE = 'ppocrv5-' + WHEEL.sha256.slice(0, 12);
const key = name => `https://mtp.invalid/ppocrv5/${name}`;

async function sha256(buffer) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}

// Minimal ZIP reader (stored or deflate entries, no ZIP64) — enough for a wheel.
export async function unzipEntries(buffer, wanted) {
  const v = new DataView(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw Error('Not a zip archive');
  let p = v.getUint32(eocd + 16, true);
  const count = v.getUint16(eocd + 10, true), out = {}, dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw Error('Bad zip directory');
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buffer, p + 46, nameLen));
    p += 46 + nameLen + extra + comment;
    if (!wanted.includes(name)) continue;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const raw = new Uint8Array(buffer, start, csize);
    if (method === 0) out[name] = raw.slice().buffer;
    else if (method === 8) out[name] = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    else throw Error('Unsupported zip method ' + method);
  }
  return out;
}

export async function isInstalled() {
  const cache = await caches.open(ACCURATE_CACHE);
  return (await Promise.all(Object.keys(WHEEL.files).map(k => cache.match(key(k))))).every(Boolean);
}

export async function install(status = () => {}) {
  if (await isInstalled()) return;
  status('Downloading Accurate mode models (19 MB)…');
  const response = await fetch(WHEEL.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw Error(`Accurate mode download failed (${response.status}).`);
  const wheel = await response.arrayBuffer();
  if (wheel.byteLength !== WHEEL.bytes || await sha256(wheel) !== WHEEL.sha256) throw Error('Accurate mode download was incomplete or changed.');
  const entries = await unzipEntries(wheel, Object.values(WHEEL.files).map(f => f.path));
  const cache = await caches.open(ACCURATE_CACHE);
  for (const [name, file] of Object.entries(WHEEL.files)) {
    const buf = entries[file.path];
    if (!buf || await sha256(buf) !== file.sha256) throw Error('Accurate mode model failed verification: ' + name);
    await cache.put(key(name), new Response(buf));
  }
}

export const remove = () => caches.delete(ACCURATE_CACHE);

let sessions = null;
async function load() {
  sessions ??= (async () => {
    const ort = await import('./vendor/ort/ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = chrome.runtime.getURL('engine/vendor/ort/');
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) >> 1)) : 1;
    const cache = await caches.open(ACCURATE_CACHE);
    const read = async k => { const r = await cache.match(key(k)); if (!r) throw Error('Accurate mode is not installed.'); return r; };
    const [det, rec] = await Promise.all(['det', 'rec'].map(async k =>
      ort.InferenceSession.create(new Uint8Array(await (await read(k)).arrayBuffer()), { executionProviders: ['wasm'] })));
    const lines = (await (await read('dict')).text()).split('\n');
    if (lines.at(-1) === '') lines.pop();
    return { ort, det, rec, dict: ['', ...lines.map(l => l.replace(/\r$/, '')), ' '] };
  })().catch(e => { sessions = null; throw e; });
  return sessions;
}

// DB text-line detection on a canvas/bitmap. Boxes are in input pixels.
export async function detectLines(image, { maxSide = 960, thresh = 0.3, boxThresh = 0.6, unclip = 1.5 } = {}) {
  const { ort, det } = await load();
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const w = Math.max(32, Math.round(image.width * scale / 32) * 32), h = Math.max(32, Math.round(image.height * scale / 32) * 32);
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0, w, h);
  const { data } = g.getImageData(0, 0, w, h);
  const n = w * h, f = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    f[i] = (data[i * 4 + 2] / 255 - 0.485) / 0.229;
    f[i + n] = (data[i * 4 + 1] / 255 - 0.456) / 0.224;
    f[i + 2 * n] = (data[i * 4] / 255 - 0.406) / 0.225;
  }
  const out = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', f, [1, 3, h, w]) });
  const prob = out[det.outputNames[0]].data, sx = image.width / w, sy = image.height / h;
  const bin = new Uint8Array(n);
  for (let i = 0; i < n; i++) bin[i] = prob[i] > thresh ? 1 : 0;
  const q = new Int32Array(n), boxes = [];
  for (let i = 0; i < n; i++) {
    if (!bin[i]) continue;
    bin[i] = 0; q[0] = i;
    let m = 1, x0 = w, y0 = h, x1 = 0, y1 = 0, sum = 0;
    for (let k = 0; k < m; k++) {
      const p = q[k], x = p % w, y = (p / w) | 0;
      sum += prob[p];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0 && bin[p - 1]) { bin[p - 1] = 0; q[m++] = p - 1; }
      if (x < w - 1 && bin[p + 1]) { bin[p + 1] = 0; q[m++] = p + 1; }
      if (y > 0 && bin[p - w]) { bin[p - w] = 0; q[m++] = p - w; }
      if (y < h - 1 && bin[p + w]) { bin[p + w] = 0; q[m++] = p + w; }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (Math.min(bw, bh) < 3 || sum / m < boxThresh) continue;
    const d = bw * bh * unclip / (2 * (bw + bh));
    const bx = Math.max(0, (x0 - d) * sx), by = Math.max(0, (y0 - d) * sy);
    boxes.push({ x: bx, y: by, w: Math.min(image.width, (x1 + 1 + d) * sx) - bx, h: Math.min(image.height, (y1 + 1 + d) * sy) - by });
  }
  return boxes;
}

// Recognise one text line. Tall crops are rotated 90° CCW, as PaddleOCR does for vertical text.
export async function recognizeLine(image, box) {
  const { ort, rec, dict } = await load();
  const cw = Math.max(1, Math.round(box.w)), ch = Math.max(1, Math.round(box.h));
  let src = new OffscreenCanvas(cw, ch);
  src.getContext('2d').drawImage(image, box.x, box.y, box.w, box.h, 0, 0, cw, ch);
  let w = cw, h = ch;
  if (h / w >= 1.5) {
    const r = new OffscreenCanvas(h, w), g = r.getContext('2d');
    g.translate(0, w); g.rotate(-Math.PI / 2); g.drawImage(src, 0, 0);
    src = r; [w, h] = [h, w];
  }
  const H = 48, W = Math.max(16, Math.min(3200, Math.round(H * w / h)));
  const c = new OffscreenCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, W, H);
  const { data } = g.getImageData(0, 0, W, H);
  const n = W * H, f = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    f[i] = (data[i * 4 + 2] / 255 - 0.5) / 0.5;
    f[i + n] = (data[i * 4 + 1] / 255 - 0.5) / 0.5;
    f[i + 2 * n] = (data[i * 4] / 255 - 0.5) / 0.5;
  }
  const out = await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', f, [1, 3, H, W]) });
  const o = out[rec.outputNames[0]], [, T, C] = o.dims, p = o.data;
  return ctcDecode(p, T, C, dict);
}

export function ctcDecode(p, T, C, dict) {
  let text = '', prev = -1, conf = 0, count = 0;
  for (let t = 0; t < T; t++) {
    let best = 0, bv = -Infinity;
    for (let k = 0; k < C; k++) { const v = p[t * C + k]; if (v > bv) { bv = v; best = k; } }
    if (best !== 0 && best !== prev) { text += dict[best] ?? ''; conf += bv; count++; }
    prev = best;
  }
  return { text, confidence: count ? 100 * conf / count : 0 };
}

// Read a whole bubble crop: detect its lines, recognise each, join in reading order.
export async function readCrop(canvas, vertical) {
  const lines = await detectLines(canvas, { maxSide: 640 });
  const results = [];
  for (const b of lines) {
    const r = await recognizeLine(canvas, b);
    if (r.text.trim()) results.push({ ...b, ...r });
  }
  results.sort((a, b) => vertical ? (b.x - a.x) || (a.y - b.y) : (a.y - b.y) || (a.x - b.x));
  const chars = results.reduce((s, r) => s + r.text.length, 0);
  return chars ? { text: results.map(r => r.text).join(''), confidence: results.reduce((s, r) => s + r.confidence * r.text.length, 0) / chars, lines: results } : null;
}
