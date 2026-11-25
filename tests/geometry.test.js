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
