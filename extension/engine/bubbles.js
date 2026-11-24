import { dropContainers, glyphScale, hashBytes, inkRuns, orientationFromInk, shapeOf } from './geometry.js';

const lum = (d, i) => (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;

// Find enclosed light (or dark) interiors. Each candidate keeps its per-row spans so the OCR crop
// can be masked to the bubble's real shape instead of a fixed rectangle.
export function detectBubbles(image, { maxSide = 1200, limit = 24 } = {}) {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const { width, height } = canvas;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const total = width * height;
  const mask = new Uint8Array(total);
  for (let i = 0; i < total; i++) { const l = lum(data, i); mask[i] = l >= 232 ? 1 : l <= 45 ? 2 : 0; }
  const queue = new Int32Array(total);
  const found = [];
  for (let index = 0; index < total; index++) {
    const tone = mask[index];
    if (!tone) continue;
    mask[index] = 0; queue[0] = index;
    let size = 1, left = width, right = 0, top = height, bottom = 0;
    for (let c = 0; c < size; c++) {
      const p = queue[c], x = p % width, y = (p / width) | 0;
      if (x < left) left = x; if (x > right) right = x;
      if (y < top) top = y; if (y > bottom) bottom = y;
      if (x > 0 && mask[p - 1] === tone) { mask[p - 1] = 0; queue[size++] = p - 1; }
      if (x < width - 1 && mask[p + 1] === tone) { mask[p + 1] = 0; queue[size++] = p + 1; }
      if (y > 0 && mask[p - width] === tone) { mask[p - width] = 0; queue[size++] = p - width; }
      if (y < height - 1 && mask[p + width] === tone) { mask[p + width] = 0; queue[size++] = p + width; }
    }
    const w = right - left + 1, h = bottom - top + 1;
    // Bubbles touching the edge are cut off; they are picked up once scrolled fully into view.
    if (size < 500 || size > total * 0.35 || w < 25 || h < 25 || size / (w * h) < 0.58 ||
        left === 0 || top === 0 || right === width - 1 || bottom === height - 1) continue;
    const spans = new Int32Array(h * 2).fill(-1);
    for (let c = 0; c < size; c++) {
      const p = queue[c], r = ((p / width) | 0) - top, x = p % width;
      if (spans[r * 2] < 0 || x < spans[r * 2]) spans[r * 2] = x;
      if (x > spans[r * 2 + 1]) spans[r * 2 + 1] = x;
    }
    found.push({
      x: left / scale, y: top / scale, w: w / scale, h: h / scale,
      left, top, sw: w, sh: h, spans, scale, dark: tone === 2, shape: shapeOf(size / (w * h)),
    });
  }
  return dropContainers(found).sort((a, b) => b.w * b.h - a.w * a.h).slice(0, limit);
}

// Masked, padded, inverted-if-dark, glyph-normalised crop of one candidate.
// Returns null when the bubble holds no ink.
export function bubbleCrop(source, b, { pad = 16, minInk = 0.004 } = {}) {
  const s = b.scale;
  const X = Math.floor(b.x), Y = Math.floor(b.y), W = Math.ceil(b.w), H = Math.ceil(b.h);
  const canvas = new OffscreenCanvas(W + pad * 2, H + pad * 2);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = b.dark ? '#000' : '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let r = 0; r < b.sh; r++) {
    const x0 = b.spans[r * 2], x1 = b.spans[r * 2 + 1];
    if (x0 < 0) continue;
    // Shrink each span by one detection pixel to stay inside the outline's anti-aliasing.
    const sx = Math.floor((x0 + 1) / s), ex = Math.ceil(x1 / s);
    const sy = Math.floor((b.top + r) / s), ey = Math.ceil((b.top + r + 1) / s);
    if (ex > sx) ctx.drawImage(source, sx, sy, ex - sx, ey - sy, sx - X + pad, sy - Y + pad, ex - sx, ey - sy);
  }
  if (b.dark) {
    ctx.globalCompositeOperation = 'difference';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  }
  const { width: cw, height: ch } = canvas;
  const { data } = ctx.getImageData(0, 0, cw, ch);
  const colInk = new Uint16Array(cw), rowInk = new Uint16Array(ch);
  let ink = 0, x0 = cw, y0 = ch, x1 = -1, y1 = -1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    if (lum(data, y * cw + x) < 110) {
      ink++; colInk[x]++; rowInk[y]++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (ink / (W * H) < minInk) return null;
  const orientation = orientationFromInk(x1 - x0 + 1, y1 - y0 + 1);
  const vertical = orientation === 'v';
  // Column widths (vertical) or line heights (horizontal) approximate the glyph size.
  const runs = inkRuns(vertical ? colInk : rowInk, 2);
  const k = glyphScale(runs);
  let out = canvas;
  if (Math.abs(k - 1) > 0.08) {
    out = new OffscreenCanvas(Math.max(8, Math.round(cw * k)), Math.max(8, Math.round(ch * k)));
    const o = out.getContext('2d');
    o.imageSmoothingQuality = 'high';
    o.drawImage(canvas, 0, 0, out.width, out.height);
  }
  // Coarse fingerprint for the crop cache: 24x24 grey, quantised to 16 levels.
  const thumb = new OffscreenCanvas(24, 24);
  const t = thumb.getContext('2d', { willReadFrequently: true });
  t.drawImage(canvas, 0, 0, 24, 24);
  const td = t.getImageData(0, 0, 24, 24).data;
  const bytes = new Uint8Array(24 * 24 + 4);
  for (let i = 0; i < 576; i++) bytes[i] = lum(td, i) >> 4;
  bytes.set([cw & 255, cw >> 8, ch & 255, ch >> 8], 576);
  return {
    canvas: out, scale: k, originX: X - pad, originY: Y - pad, vertical, ink: ink / (W * H),
    hash: hashBytes(bytes),
    bubble: { x: X, y: Y, w: W, h: H, dark: b.dark, shape: b.shape },
  };
}
