import { copyFileSync, mkdirSync } from 'node:fs';
const dest = 'extension/reader/vendor';
mkdirSync(dest, {recursive: true});
for (const file of ['tesseract.min.js', 'worker.min.js', 'worker.min.js.LICENSE.txt', 'tesseract.min.js.LICENSE.txt']) {
  copyFileSync('node_modules/tesseract.js/dist/' + file, dest + '/' + file);
}
copyFileSync('node_modules/tesseract.js/LICENSE.md', dest + '/tesseract.js.LICENSE');
copyFileSync('node_modules/tesseract.js-core/LICENSE', dest + '/tesseract.js-core.LICENSE');
// All LSTM builds: tesseract.js picks relaxed-SIMD, SIMD or plain at runtime (OEM 1 is LSTM-only).
for (const core of ['lstm', 'simd-lstm', 'relaxedsimd-lstm']) {
  copyFileSync(`node_modules/tesseract.js-core/tesseract-core-${core}.wasm.js`, `${dest}/tesseract-core-${core}.wasm.js`);
}
