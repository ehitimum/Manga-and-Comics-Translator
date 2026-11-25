# Development phases and release history

## What has shipped

| Version | Delivered | How to verify |
| --- | --- | --- |
| v0.3.0 (historical package version, commit `68498dd`) | Gemini joins Ollama vision and the local FastAPI companion. The popup displays build information. Subsequent commit `c906ec3` adjusts overlays near dark image margins. | Select a provider in Settings and run its connection check. |
| [v0.3.1](https://github.com/ehitimum/Manga-and-Comics-Translator/releases/tag/v0.3.1) | First test release. Toggle original and translated layers without another provider call. Boxes crossing viewport edges are clipped. Moving or resizing during a request discards stale results. A bundled two-bubble sample exercises the renderer without credentials. | Open **Try sample page**, click **Translate**, then switch to the original and back. Open a manga page to test a configured provider. |
| [v0.3.2](https://github.com/ehitimum/Manga-and-Comics-Translator/releases/tag/v0.3.2) | Key-free Chrome Translator for Japanese text with ten starter phrases for first use. Manual bubble selection, editable Tesseract OCR, version-pinned horizontal and vertical model downloads, checksum verification, cache removal and optional Google Translate web link. | Translate **ありがとう** as typed text, then capture a manga page and read one selected bubble. |
| [v0.4.0-beta.1](https://github.com/ehitimum/Manga-and-Comics-Translator/releases/tag/v0.4.0-beta.1) | Default automatic Japanese-to-English overlays on the original tab. Local bubble segmentation, horizontal and vertical OCR, reversible overlays and scroll-triggered translation. Uses Chrome Translator when ready and downloads an ONNX/WASM translation model when needed. | Open a Japanese manga tab, click **Translate page**, and use **Show original** to compare. |
| v0.5.0-beta.3 ([PR #24](https://github.com/ehitimum/Manga-and-Comics-Translator/pull/24), plan [#6](https://github.com/ehitimum/Manga-and-Comics-Translator/issues/6)) | OCR stage ~3.4 s → ~0.15–0.19 s per screen, warm. Overlays live in the browser top layer, anchored to the page, so they survive fullscreen, dialogs, max z-index, inner scrolling, zoom and node-removing scripts. Two-step translation: whole page images first, including the next 5 pages ahead, then screen captures for the rest. Furigana removal, sealed bubble outlines, cut-off bubbles kept and replaced. Opt-in Accurate mode (comic text detector + manga-ocr, 128 MB). Shortcuts, snapshot view, always-translate sites. Unit and Playwright suites with CI. | `npm test`, `npm run test:e2e`; see [Benchmarks](Benchmarks.md). |

## Status of the v0.4–0.5 plan

The original phases were re-sequenced in [#6](https://github.com/ehitimum/Manga-and-Comics-Translator/issues/6): fast path first, then overlay robustness, then read-ahead, then opt-in learned models.

| Phase (original) | Status |
| --- | --- |
| 1. Engine and model loading | Done. Warm worker pool, pinned and checksummed models (Tesseract, Accurate mode), offscreen engine with cancellation and caches. |
| 2. Detection and OCR | Done for the fast path: shape-masked crops, furigana removal, sealed outlines, ink orientation. Accurate mode adds a learned detector and manga-ocr. |
| 3. Text translation | Partly done. Chrome Translator with language-pack download from the popup, OPUS-MT fallback, batching. Glossary, target-language choice and Cloud Translation remain. |
| 4. Cleanup and layout | Partly done. Bubble-shaped fills and fitted text. Inpainting moved to v0.5+. |
| 5. Browser integration | Done. Source images with read-ahead, IndexedDB cache, anchoring, frames, always-translate sites. |
| 6. Reliability and release | In progress. CI suites exist; real-page validation and the licence decision ([#23](https://github.com/ehitimum/Manga-and-Comics-Translator/issues/23)) remain. |

## Later releases

- **v0.5.0** improves bubble segmentation, reading order, typography and manual correction. Optional learned inpainting requires a separate download.
- **v0.6.0** adds optional offline translation, optimizes models for CPU-only systems and extends browser coverage.

## Distribution and hardware targets

Ship a small Manifest V3 extension and offer two core model downloads separately. Display sizes before download and provide removal and lighter variants where available. Keep weights outside Git. The working budgets are 5–20 MB for the extension, 250–450 MB for core assets, another 100–500 MB for offline translation and 200 MB–1.5 GB for learned inpainting. Actual sizes depend on the licensed artifacts selected.

Target 8 GB RAM on CPU and 16 GB recommended. Limit constrained devices to one image at a time and unload optional models when idle. The design uses pretrained models and an optional local companion. It requires neither custom training nor a central inference service.
