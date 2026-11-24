import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRegions, bubbleText, removeOverlaps } from '../extension/engine/regions.js';

const para = (text, confidence, x0 = 0) => ({ text, confidence, bbox: { x0, y0: 0, x1: x0 + 20, y1: 40 } });
const data = (...paragraphs) => ({ blocks: [{ paragraphs }] });

test('single-character bubbles are kept only when confident', () => {
  assert.equal(extractRegions(data(para('え？', 90)), 55).length, 1);
  assert.equal(extractRegions(data(para('え？', 60)), 55).length, 0);
  assert.equal(extractRegions(data(para('えっ', 60)), 55).length, 1);
  assert.equal(extractRegions(data(para('OK!', 99)), 55).length, 0);
  assert.equal(extractRegions(data(para('ありがとう', 40)), 55).length, 0);
});

test('bubble text joins vertical columns right to left', () => {
  const r = bubbleText([{ x: 0, y: 0, text: 'いるの', confidence: 80 }, { x: 40, y: 0, text: 'どうして', confidence: 90 }], true);
  assert.equal(r.text, 'どうしているの');
  assert.ok(r.confidence > 80 && r.confidence < 90);
  assert.equal(bubbleText([], true), null);
  assert.equal(bubbleText([{ x: 0, y: 30, text: 'b', confidence: 1 }, { x: 50, y: 0, text: 'a', confidence: 1 }], false).text, 'ab');
});

test('overlapping regions keep the most confident', () => {
  const kept = removeOverlaps([{ x: 0, y: 0, w: 10, h: 10, confidence: 50 }, { x: 1, y: 1, w: 10, h: 10, confidence: 90 }]);
  assert.deepEqual(kept.map(k => k.confidence), [90]);
});
