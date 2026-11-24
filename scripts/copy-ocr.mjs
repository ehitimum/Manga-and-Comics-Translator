import { copyFileSync, mkdirSync } from 'node:fs';
const dest = 'extension/reader/vendor';
mkdirSync(dest, {recursive: true});
for (const file of ['tesseract.min.js', 'worker.min.js', 'worker.min.js.LICENSE.txt', 'tesseract.min.js.LICENSE.txt']) {
  copyFileSync('node_modules/tesseract.js/dist/' + file, dest + '/' + file);
}
for (const [pkg, file] of [['tesseract.js','LICENSE.md'], ['tesseract.js-core','LICENSE'], ['tesseract.js-core','tesseract-core-lstm.wasm.js']]) {
  copyFileSync('node_modules/' + pkg + '/' + file, dest + '/' + (file.startsWith('LICENSE') ? pkg + '.LICENSE' : file));
}
