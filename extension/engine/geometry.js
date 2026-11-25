// Pure helpers shared by the engine and tests. No DOM or extension APIs here.

export const area = r => Math.max(0, r.w) * Math.max(0, r.h);

export function intersection(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// Share of `a` covered by `b`.
export const coverage = (a, b) => (area(a) ? intersection(a, b) / area(a) : 0);

export const contains = (outer, inner) => outer !== inner &&
  inner.x >= outer.x && inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

// Background regions (sky, screentone gaps) enclose real bubbles; bubbles rarely contain bubbles.
export const dropContainers = boxes => boxes.filter(b => !boxes.some(o => contains(b, o)));

// Skip candidates mostly covered by an exclusion zone (already translated, or our own UI).
export const isExcluded = (box, zones = [], threshold = 0.3) => zones.some(z => coverage(box, z) > threshold);

// Japanese manga text is vertical unless the ink is clearly wider than tall.
export const orientationFromInk = (inkW, inkH) => (inkW > inkH * 1.3 ? 'h' : 'v');

// Manga reading order: rows top to bottom, right to left inside a row.
export function readingOrder(boxes) {
  const rows = [];
  for (const b of [...boxes].sort((p, q) => p.y - q.y)) {
    const row = rows.find(r => b.y < r.bottom - Math.min(r.height, b.h) * 0.5);
    if (row) { row.items.push(b); row.bottom = Math.max(row.bottom, b.y + b.h); }
    else rows.push({ bottom: b.y + b.h, height: b.h, items: [b] });
  }
  return rows.flatMap(r => r.items.sort((p, q) => (q.x + q.w) - (p.x + p.w)));
}

// Lengths of consecutive runs above `min` in a projection profile.
export function inkRuns(profile, min = 1) {
  const runs = [];
  let run = 0;
  for (const v of profile) {
    if (v >= min) run++;
    else if (run) { runs.push(run); run = 0; }
  }
  if (run) runs.push(run);
  return runs;
}

export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

// Scale so a text line/column is about `target` px thick. Tesseract read the benchmark best near 18 px.
export function glyphScale(runs, target = 18) {
  const usable = runs.filter(r => r >= 4);
  if (!usable.length) return 1;
  return Math.min(1.6, Math.max(0.35, target / median(usable)));
}

// Largest size in [min, max] for which fits(size) is true (fits must be monotonic). Returns min if none fit.
export function fitFontSize(fits, min = 9, max = 28) {
  let lo = min, hi = max, best = min;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

// Elliptical bubbles fill ~π/4 of their bounding box; rectangles (narration boxes) close to 1.
export const shapeOf = fillRatio => (fillRatio < 0.88 ? 'ellipse' : 'rect');

// 64-bit FNV-1a over bytes, as hex. Used for crop cache keys.
export function hashBytes(bytes) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193);
    h2 = Math.imul(h2 ^ bytes[i] ^ (i & 0xff), 0x01000193);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export class LRU {
  constructor(limit = 400) { this.limit = limit; this.map = new Map(); }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key); this.map.set(key, value);
    return value;
  }
  set(key, value) {
    this.map.delete(key); this.map.set(key, value);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
  }
  get size() { return this.map.size; }
}


// Runs above `min` in a projection profile, with positions: [{ start, len }].
export function runsWithPositions(profile, min = 1) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= profile.length; i++) {
    const on = i < profile.length && profile[i] >= min;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { runs.push({ start, len: i - start }); start = -1; }
  }
  return runs;
}

// Furigana (reading aids) form thin columns/lines right beside the main text. Main-text thickness is taken
// from the thickest runs (furigana can be as many runs as the text itself). Returns the runs to blank out.
export function rubyRuns(runs, ratio = 0.6) {
  if (runs.length < 2) return [];
  const widest = Math.max(...runs.map(r => r.len));
  const main = median(runs.map(r => r.len).filter(l => l >= widest * 0.75));
  if (main < 6) return [];
  const isMain = r => r.len >= main * ratio;
  return runs.filter((r, i) => !isMain(r) && [runs[i - 1], runs[i + 1]].some(n => n && isMain(n) &&
    Math.min(Math.abs(n.start + n.len - r.start), Math.abs(r.start + r.len - n.start)) <= main * 0.5));
}

// Light pixels survive only if all 8 neighbours are light too. Seals 1–2 px gaps in thin bubble outlines,
// so a bubble's inside no longer leaks into a pale page, and dissolves screentone lattices.
export function erodeTone(mask, width, height, tone = 1) {
  const out = mask.slice();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (mask[i] !== tone) continue;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) continue;
    if (mask[i - 1] !== tone || mask[i + 1] !== tone || mask[i - width] !== tone || mask[i + width] !== tone ||
        mask[i - width - 1] !== tone || mask[i - width + 1] !== tone || mask[i + width - 1] !== tone || mask[i + width + 1] !== tone) out[i] = 0;
  }
  return out;
}
