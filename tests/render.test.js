import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../extension/render/fit.js', import.meta.url), 'utf8'), ctx);
const R = ctx.MTPRender;

test('renderer font search matches the engine helper', async () => {
  const { fitFontSize } = await import('../extension/engine/geometry.js');
  for (const limit of [9, 13, 20, 28, 40]) assert.equal(R.fitFontSize(s => s <= limit), fitFontSize(s => s <= limit));
});

test('fitText picks the largest size that fits a fake element', () => {
  const el = {
    clientHeight: 60, clientWidth: 100, style: {}, classList: { toggle() {} },
    get scrollHeight() { return parseInt(this.style.fontSize) * 3; }, get scrollWidth() { return 100; },
  };
  assert.equal(R.fitText(el), 20);
});
