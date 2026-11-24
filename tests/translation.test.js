import test from 'node:test';
import assert from 'node:assert/strict';
import { getTranslator, translationQueue, disposeTranslator } from '../extension/providers/pageTranslation.js';

test('Chrome translator is created once and reused', async t => {
  let created = 0, destroyed = 0;
  globalThis.Translator = {
    availability: async () => 'available',
    create: async () => { created++; return { translate: async s => s.toUpperCase(), destroy() { destroyed++; } }; },
  };
  t.after(async () => { await disposeTranslator(); delete globalThis.Translator; });
  const a = await getTranslator();
  const b = await getTranslator();
  assert.equal(a, b);
  assert.equal(created, 1);
  assert.deepEqual(await a.translateBatch(['ab', 'cd']), ['AB', 'CD']);
  await disposeTranslator();
  assert.equal(destroyed, 1);
});

test('the queue sends the first item alone, batches the rest, and keeps order', async () => {
  const calls = [];
  const translator = { translateBatch: async texts => { calls.push(texts.length); await new Promise(r => setTimeout(r, 5)); return texts.map(s => s + '!'); } };
  const out = [];
  const q = translationQueue(translator, (item, en) => out.push(en), { batch: 3 });
  q.push({ text: 'a' });
  for (const s of ['b', 'c', 'd', 'e']) q.push({ text: s });
  await q.drain();
  assert.deepEqual(out, ['a!', 'b!', 'c!', 'd!', 'e!']);
  assert.deepEqual(calls, [1, 3, 1]);
});

test('a failing batch rejects drain but keeps earlier results', async () => {
  let n = 0;
  const translator = { translateBatch: async texts => { if (n++) throw Error('offline'); return texts; } };
  const out = [];
  const q = translationQueue(translator, (item, en) => out.push(en));
  q.push({ text: 'first' });
  await new Promise(r => setTimeout(r, 0));
  q.push({ text: 'second' });
  await assert.rejects(q.drain(), /offline/);
  assert.deepEqual(out, ['first']);
});

test('the test translator echoes', async () => {
  const t = await getTranslator(() => {}, { test: true });
  assert.deepEqual(await t.translateBatch(['あ']), ['[EN] あ']);
});
