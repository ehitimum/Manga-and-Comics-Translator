import test from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../extension/engine/geometry.js';

test('coverage and exclusion zones', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(g.coverage(a, { x: 5, y: 0, w: 10, h: 10 }), 0.5);
  assert.equal(g.isExcluded(a, [{ x: 5, y: 0, w: 10, h: 10 }]), true);
  assert.equal(g.isExcluded(a, [{ x: 8, y: 8, w: 10, h: 10 }]), false);
  assert.equal(g.isExcluded(a, []), false);
});

test('background regions that contain a bubble are dropped', () => {
  const sky = { x: 0, y: 0, w: 100, h: 100 }, bubble = { x: 10, y: 10, w: 20, h: 30 }, other = { x: 200, y: 0, w: 20, h: 20 };
  assert.deepEqual(g.dropContainers([sky, bubble, other]), [bubble, other]);
});

test('orientation comes from the ink, defaulting to vertical', () => {
  assert.equal(g.orientationFromInk(180, 34), 'h');
  assert.equal(g.orientationFromInk(156, 216), 'v'); // wide 3-column vertical bubble
  assert.equal(g.orientationFromInk(100, 90), 'v');
});

test('reading order is top row first, right to left', () => {
  const b = (id, x, y) => ({ id, x, y, w: 50, h: 80 });
  const order = g.readingOrder([b('L', 0, 10), b('R', 300, 0), b('M', 150, 20), b('next', 250, 300)]).map(i => i.id);
  assert.deepEqual(order, ['R', 'M', 'L', 'next']);
});

test('glyph scale targets ~18 px columns and is clamped', () => {
  assert.ok(Math.abs(g.glyphScale([34, 36, 35]) - 18 / 35) < 1e-9);
  assert.equal(g.glyphScale([2, 3]), 1); // noise only
  assert.equal(g.glyphScale([200]), 0.35);
  assert.equal(g.glyphScale([5]), 1.6);
  assert.deepEqual(g.inkRuns([0, 3, 3, 0, 0, 2, 1, 4]), [2, 3]);
  assert.deepEqual(g.inkRuns([0, 3, 3, 0, 2, 2], 2), [2, 2]);
});

test('fitFontSize finds the largest fitting size', () => {
  assert.equal(g.fitFontSize(s => s <= 17, 9, 28), 17);
  assert.equal(g.fitFontSize(() => false, 9, 28), 9);
  assert.equal(g.fitFontSize(() => true, 9, 28), 28);
});

test('shape, hashing and LRU', () => {
  assert.equal(g.shapeOf(0.78), 'ellipse');
  assert.equal(g.shapeOf(0.97), 'rect');
  assert.equal(g.hashBytes(new Uint8Array([1, 2, 3])), g.hashBytes(new Uint8Array([1, 2, 3])));
  assert.notEqual(g.hashBytes(new Uint8Array([1, 2, 3])), g.hashBytes(new Uint8Array([1, 2, 4])));
  const lru = new g.LRU(2);
  lru.set('a', 1); lru.set('b', 2); lru.get('a'); lru.set('c', 3);
  assert.equal(lru.get('b'), undefined);
  assert.equal(lru.get('a'), 1);
  assert.equal(lru.size, 2);
});

test('run positions and furigana selection', () => {
  assert.deepEqual(g.runsWithPositions([0, 3, 3, 0, 2, 0]), [{ start: 1, len: 2 }, { start: 4, len: 1 }]);
  // main column 30 px, furigana 14 px right beside it, next main column, its furigana
  const runs = [{ start: 0, len: 30 }, { start: 31, len: 14 }, { start: 60, len: 31 }, { start: 92, len: 14 }];
  assert.deepEqual(g.rubyRuns(runs).map(r => r.start), [31, 92]);
  // DPR 1: thin stray runs beside 15 px columns
  assert.deepEqual(g.rubyRuns([{ start: 0, len: 15 }, { start: 16, len: 2 }, { start: 40, len: 15 }]).map(r => r.start), [16]);
  // two ordinary columns, nothing removed; a far-away thin run is not furigana
  assert.deepEqual(g.rubyRuns([{ start: 0, len: 30 }, { start: 40, len: 28 }]), []);
  assert.deepEqual(g.rubyRuns([{ start: 0, len: 30 }, { start: 80, len: 10 }]), []);
});

test('eroding the light tone seals a 1-pixel gap in an outline', () => {
  // 7x5 light field split by a dark wall at x=3 with a one-pixel gap at y=2
  const w = 7, h = 5, mask = new Uint8Array(w * h).fill(1);
  for (let y = 0; y < h; y++) if (y !== 2) mask[y * w + 3] = 0;
  const out = g.erodeTone(mask, w, h, 1);
  assert.equal(out[2 * w + 3], 0, 'gap closed');
  assert.equal(out[2 * w + 1], 1, 'interior kept');
  assert.equal(mask[2 * w + 3], 1, 'input untouched');
});
