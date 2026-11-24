import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { unzipEntries, ctcDecode } from '../extension/engine/accurate.js';

// Build a small zip (one deflated entry, one stored) the same way wheels are laid out.
function zip(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, data, method] of files) {
    const body = method === 8 ? deflateRawSync(data) : data, n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(method, 10);
    c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(local, n, body); central.push(c, n);
    offset += 30 + n.length + body.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  const b = Buffer.concat([...locals, dir, end]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}

test('wheel entries are extracted (deflate and stored)', async () => {
  const text = Buffer.from('あいう\n'.repeat(50));
  const out = await unzipEntries(zip([['a/dict.txt', text, 8], ['b.bin', Buffer.from([1, 2, 3]), 0], ['skip', Buffer.from('x'), 0]]), ['a/dict.txt', 'b.bin']);
  assert.equal(Buffer.from(out['a/dict.txt']).toString(), text.toString());
  assert.deepEqual([...new Uint8Array(out['b.bin'])], [1, 2, 3]);
  assert.equal(out.skip, undefined);
  await assert.rejects(unzipEntries(new ArrayBuffer(40), []), /Not a zip/);
});

test('CTC decoding drops blanks and repeats', () => {
  const dict = ['', 'あ', 'い'];
  // timesteps: あ あ blank い い
  const p = Float32Array.from([0, .9, .1, 0, .8, .2, .9, .05, .05, .1, .1, .8, .1, .2, .7]);
  const r = ctcDecode(p, 5, 3, dict);
  assert.equal(r.text, 'あい');
  assert.ok(r.confidence > 70);
});
