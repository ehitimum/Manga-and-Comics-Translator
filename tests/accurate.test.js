import test from 'node:test';
import assert from 'node:assert/strict';
import { tiles, suppress, decodeTokens, tokenProbability, MODELS, DOWNLOAD_MB } from '../extension/engine/accurate.js';

test('tall strips are split into overlapping square tiles; a normal page is one tile', () => {
  assert.deepEqual(tiles(1280, 800), [{ x: 0, y: 0, w: 800, h: 800 }, { x: 480, y: 0, w: 800, h: 800 }]);
  assert.deepEqual(tiles(800, 800), [{ x: 0, y: 0, w: 800, h: 800 }]);
  const strip = tiles(800, 4000);
  assert.equal(strip[0].y, 0);
  assert.equal(strip.at(-1).y + strip.at(-1).h, 4000);
  assert.ok(strip.every((t, i) => i === 0 || t.y < strip[i - 1].y + strip[i - 1].h), 'tiles overlap');
  assert.ok(tiles(800, 100000).length <= 8);
});

test('duplicate boxes from tile seams are suppressed per label', () => {
  const kept = suppress([
    { x: 0, y: 0, w: 100, h: 100, label: 'bubble', score: 0.9 },
    { x: 5, y: 5, w: 100, h: 100, label: 'bubble', score: 0.8 },
    { x: 5, y: 5, w: 100, h: 100, label: 'text_bubble', score: 0.7 },
    { x: 300, y: 0, w: 50, h: 50, label: 'bubble', score: 0.6 },
  ]);
  assert.deepEqual(kept.map(k => [k.label, k.score]), [['bubble', 0.9], ['text_bubble', 0.7], ['bubble', 0.6]]);
});

test('manga-ocr tokens are joined without specials or spaces', () => {
  const vocab = ['[PAD]', '[UNK]', '[CLS]', '[SEP]', 'ど', 'う', '##し', '.', ' '];
  assert.equal(decodeTokens([2, 4, 5, 6, 8, 7, 7, 7], vocab), 'どうし…');
});

test('token probability is a softmax', () => {
  const p = tokenProbability(Float32Array.from([0, 0, Math.log(2)]), 0, 3, 2);
  assert.ok(Math.abs(p - 0.5) < 1e-6);
});

test('models are pinned to revisions with checksums', () => {
  for (const m of Object.values(MODELS)) {
    assert.match(m.url, /\/resolve\/[0-9a-f]{40}\//);
    assert.match(m.sha256, /^[0-9a-f]{64}$/);
  }
  assert.equal(DOWNLOAD_MB, 128);
});
