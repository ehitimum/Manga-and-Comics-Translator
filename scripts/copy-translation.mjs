import { copyFileSync, mkdirSync } from 'node:fs';
const dest = 'extension/engine/vendor';
mkdirSync(dest, { recursive: true });
const source = 'node_modules/@huggingface/transformers';
for (const file of ['transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  copyFileSync(source + '/dist/' + file, dest + '/' + file);
}
copyFileSync(source + '/LICENSE', dest + '/transformers.LICENSE');
copyFileSync('scripts/onnxruntime.LICENSE', dest + '/onnxruntime.LICENSE');
