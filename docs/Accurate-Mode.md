# Decision record: Accurate mode and model licences (#21, #22)

## Decision

- The default path stays as it is: heuristic bubble detection plus Tesseract (about 0.2 s per screen, no download beyond 5.5 MB).
- **Accurate mode** (opt-in, Settings → Behavior) downloads about 128 MB once, from pinned Hugging Face revisions with a SHA-256 check per file. Both models are Apache-2.0:
  - **Comic text & bubble detector**, small: `ogkalu/comic-text-and-bubble-detector`, `detector-v4-s_int8.onnx` (RT-DETR-v2, 11 MB). It finds bubbles, text inside bubbles, and text outside bubbles. Accurate mode adds the regions the heuristic missed: grey or textured bubbles, narration, and text drawn on the art.
  - **manga-ocr**: `onnx-community/manga-ocr-base-ONNX`, uint8 encoder (87 MB) + int8 decoder (30 MB), vocabulary from `kha-white/manga-ocr-base`. It re-reads bubbles where Tesseract's confidence is below 60, and reads every region the detector adds.
- Hugging Face sends CORS headers, so no extra host permission is needed.
- Extension pages are cross-origin isolated (COOP `same-origin`, COEP `credentialless`), so ONNX Runtime Web uses up to 4 threads.

## Measurements (headless Chromium, 4 cores, WASM, 4 threads)

| Model | Warm time | Result on the synthetic page |
| --- | --- | --- |
| Detector small int8 (11 MB) | ~0.32 s per 640×640 tile | All 7 bubbles and their text boxes; best scores with plain 0–1 input |
| Detector full int8 (44 MB) | ~1.0 s per tile | Same boxes. Not used. |
| manga-ocr, uint8 encoder + int8 decoder | ~0.3–0.4 s per bubble | 4/4 test crops read exactly |
| manga-ocr, q4 encoder | ~0.4–0.6 s per bubble | Same text, slower. Not used. |
| manga-ocr, int8 encoder | — | Does not load: ONNX Runtime has no `ConvInteger` kernel |
| PP-OCRv5 mobile (used in 0.5.0-beta.1 builds) | ~0.85 s per screen | 6/7. Replaced by the above. |

Expected load on a typical 4-core laptop without a GPU: about 0.3 s extra per screen for the detector, plus 0.3–0.4 s for each bubble manga-ocr reads. Memory use is about 0.5 GB more while active. Models are released when the offscreen engine is idle. Tall strips are split into square tiles (at most 8) so they are not squashed.

## Not chosen

| Candidate | Reason |
| --- | --- |
| comic-text-detector (ONNX conversions) | GPL-3.0, and trained partly on Manga109-s. Blocked unless the project licence (#23) is GPL-3.0. |
| Ultralytics YOLO bubble detectors | AGPL-3.0 per Ultralytics, including trained weights. |
| LFM2-350M-ENJP-MT, ElanMT, Gemini Nano (Prompt API) | Translation-quality candidates. LFM2's licence terms need checking; Gemini Nano is hardware-gated. |
| WebGPU | No GPU adapter in the headless test environment. Check on a GPU machine. |
