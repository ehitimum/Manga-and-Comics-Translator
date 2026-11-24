import test from 'node:test';
import assert from 'node:assert/strict';
import { translateJapanese } from '../extension/providers/browser.js';

test('unsupported browser uses only exact starter phrases', async () => {
  const result = await translateJapanese('あり がとう！', () => {});
  assert.deepEqual(result, { text: 'Thank you.', source: 'Built-in phrase list' });
  await assert.rejects(translateJapanese('ありがとうと言いました', () => {}), /unavailable/);
});

test('installed translator receives full text and releases its session on failure', async t => {
  let received;
  let destroyed = false;
  t.after(() => { delete globalThis.Translator; });
  globalThis.Translator = {
    availability: async () => 'available',
    create: async () => ({
      async translate(text) { received = text; throw Error('download interrupted'); },
      destroy() { destroyed = true; },
    }),
  };
  await assert.rejects(translateJapanese('ありがとう', () => {}), /download interrupted/);
  assert.equal(received, 'ありがとう');
  assert.equal(destroyed, true);
});
