import { copyFileSync, mkdirSync } from 'node:fs';
const dest = 'extension/engine/vendor';
mkdirSync(dest, { recursive: true });
const source = 'node_modules/@huggingface/transformers';
for (const file of ['transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  copyFileSync(source + '/dist/' + file, dest + '/' + file);
}
copyFileSync(source + '/LICENSE', dest + '/transformers.LICENSE');
copyFileSync('scripts/onnxruntime.LICENSE', dest + '/onnxruntime.LICENSE');
// Plain ONNX Runtime Web (WASM) for the opt-in Accurate mode (PP-OCRv5).
const ort = 'node_modules/onnxruntime-web/dist';
mkdirSync(dest + '/ort', { recursive: true });
for (const file of ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  copyFileSync(`${ort}/${file}`, `${dest}/ort/${file}`);
}
