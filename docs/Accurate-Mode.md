# Decision record: Accurate mode and model licences (#21, #22)

## Decision

- The default path stays heuristic bubble detection + Tesseract. It was 4–7× faster than PP-OCRv5 on the benchmark page, and at least as accurate on clean lettering.
- **Accurate mode** (opt-in, Settings → Behavior) adds **PP-OCRv5 mobile** (PaddleOCR, Apache-2.0):
  - a second pass for bubbles Tesseract reads with confidence below 60;
  - a text-line detector when no bubbles are found, which covers narration and text drawn on the art.
- Models come from the pinned, immutable PyPI wheel `onnxocr-ppocrv5==0.0.23` (Apache-2.0 packaging of the PaddleOCR models). The wheel's SHA-256 and each extracted file's SHA-256 are verified before use, then cached unpacked in Cache Storage. The download needs the optional host permission `files.pythonhosted.org`, requested when the user turns the mode on.
- The extension pages are cross-origin isolated (COOP `same-origin`, COEP `credentialless`), so ONNX Runtime Web can use up to 4 threads. Measured on PP-OCRv5: 1 thread ~1.55 s → 4 threads ~0.85 s per viewport (detection ~440 → ~150 ms). `credentialless` keeps the options page's web fonts working.

## Measurements (synthetic page, 4 cores)

| Engine | DPR 2 | DPR 1 | DPR 1 JPEG q40 |
| --- | --- | --- | --- |
| Tesseract fast path | ~170 ms · 7/7 | ~150 ms · 7/7 | ~130 ms · 7/7 |
| PP-OCRv5 full page, 4 threads | 829 ms · 6/7 | 506 ms · 6/7 | 472 ms · 4/7 |

## Not chosen, or not yet evaluated

| Candidate | Status |
| --- | --- |
| comic-text-detector (ONNX conversions) | GPL-3.0, and trained partly on Manga109-s. Blocked unless the project licence (#23) is GPL-3.0. |
| Ultralytics YOLO bubble detectors | AGPL-3.0 per Ultralytics, including trained weights. Not used. |
| ogkalu/comic-text-and-bubble-detector (RT-DETR-v2, Apache-2.0) | Not benchmarked: Hugging Face unreachable from the test environment. Next candidate for text and bubble boxes on real pages. |
| manga-ocr (Apache-2.0, ~444 MB) | Not benchmarked, for the same reason. Likely the most accurate on stylised lettering; too large for the default path. |
| LFM2-350M-ENJP-MT, ElanMT, Gemini Nano (Prompt API) | Translation-quality candidates. LFM2's licence terms need checking; Gemini Nano is hardware-gated. |
| WebGPU | No GPU adapter in the headless test environment. Check on a GPU machine. |
