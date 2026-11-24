# Development phases and release history

## What has shipped

| Version | Delivered | How to verify |
| --- | --- | --- |
| v0.3.0 (historical package version, commit `68498dd`) | Gemini joins Ollama vision and the local FastAPI companion. The popup displays build information. Subsequent commit `c906ec3` adjusts overlays near dark image margins. | Select a provider in Settings and run its connection check. |
| [v0.3.1](https://github.com/ehitimum/Manga-and-Comics-Translator/releases/tag/v0.3.1) | First test release. Toggle original and translated layers without another provider call. Boxes crossing viewport edges are clipped. Moving or resizing during a request discards stale results. A bundled two-bubble sample exercises the renderer without credentials. | Open **Try sample page**, click **Translate**, then switch to the original and back. Open a manga page to test a configured provider. |
| [v0.3.2](https://github.com/ehitimum/Manga-and-Comics-Translator/releases/tag/v0.3.2) | Key-free Chrome Translator for Japanese text with ten starter phrases for first use. Manual bubble selection, editable Tesseract OCR, version-pinned horizontal and vertical model downloads, checksum verification, cache removal and optional Google Translate web link. | Translate **ありがとう** as typed text, then capture a manga page and read one selected bubble. |
| [v0.4.0-beta.1](https://github.com/ehitimum/Manga-and-Comics-Translator/releases/tag/v0.4.0-beta.1) | Default automatic Japanese-to-English overlays on the original tab. Local bubble segmentation, horizontal and vertical OCR, reversible overlays and scroll-triggered translation. Uses Chrome Translator when ready and downloads an ONNX/WASM translation model when needed. | Open a Japanese manga tab, click **Translate page**, and use **Show original** to compare. |

**Progress toward v0.4.0** · The beta exercises capture, detection, OCR, translation and rendering as independent stages. It delivers a first automated screenshot path and tests both writing directions. The stable milestone still includes pretrained comic detector evaluation, source image extraction, improved restoration and renderer fitting, and broader validation on representative manga chapters. Authenticated Google Cloud Translation, glossary and language selection remain on the provider roadmap.

The existing extension captures the visible viewport. Gemini and Ollama vision return translated boxes in one call. The optional Python companion detects bright bubble candidates with OpenCV, runs manga-ocr on crops and sends recognized text to Ollama. The content script draws HTML overlays. These are the starting points for the browser pipeline.

## Remaining phases

The targets below are planning milestones. The release history above records completed work. Estimates from the development plan total 27–41 working days before model compatibility or licensing delays.

| Phase | Target | Work and acceptance check |
| --- | --- | --- |
| 1. Engine and model loading · 4–6 days | v0.4.0 development | Define independent detection, OCR, text translation, restoration and rendering stages. Check WebGPU and WASM availability. Retain FastAPI as an optional fallback. Validate pretrained detector and Manga OCR NAR Small candidates for conversion, browser execution and license. Record immutable URLs, sizes, checksums, backends and licenses in a model manifest. Enable explicit download, verified caching, upgrades and removal. Acceptance requires swapping a stage and recovering from an interrupted model update with the prior model usable. |
| 2. Detection and OCR · 5–8 days | v0.4.0 development | Return detector boxes, lines and masks in source pixels. Group bubbles, narration and standalone text, order vertical Japanese, retry low-confidence crops, and allow region inspection and basic correction. Keep the OCR fallback. On representative pages, inspect Japanese text and coordinates before enabling translation. |
| 3. Text translation · 3–4 days | v0.4.0 development | Add a text-provider contract, authenticated Google Cloud Translation, Gemini and Ollama adapters, target language, glossary and cache. Verify that changing provider reuses the same OCR regions and that failures reach the reader. Provide an extension point for offline translation. |
| 4. Cleanup and layout · 6–9 days | v0.4.0 development | Use text masks for solid fill and classical WASM inpainting. Fit multiline Canvas text to the bubble with adjustable font size and alignment. Verify dark and textured backgrounds, text overflow and reversible comparison. v0.3.1 delivers comparison for the existing HTML renderer. |
| 5. Browser integration · 5–8 days | v0.4.0 development | Prefer original image elements, add site adapters and retain screenshot fallback. Queue near-visible images using IntersectionObserver, bound concurrency and cache by image identity and processing settings. Check alignment through zoom, scrolling and navigation on long chapters. v0.3.1 covers clipping and stale viewport results in the screenshot path. |
| 6. Reliability and release · 4–6 days | v0.4.0 release candidate → v0.4.0 | Exercise CPU/WASM and WebGPU, vertical text, dark bubbles and stylized lettering. Recover from interrupted downloads, missing assets and memory pressure. Record license and store reviews, publish a tested package and installation instructions. |

## Later releases

- **v0.5.0** improves bubble segmentation, reading order, typography and manual correction. Optional learned inpainting requires a separate download.
- **v0.6.0** adds optional offline translation, optimizes models for CPU-only systems and extends browser coverage.

## Distribution and hardware targets

Ship a small Manifest V3 extension and offer two core model downloads separately. Display sizes before download and provide removal and lighter variants where available. Keep weights outside Git. The working budgets are 5–20 MB for the extension, 250–450 MB for core assets, another 100–500 MB for offline translation and 200 MB–1.5 GB for learned inpainting. Actual sizes depend on the licensed artifacts selected.

Target 8 GB RAM on CPU and 16 GB recommended. Limit constrained devices to one image at a time and unload optional models when idle. The design uses pretrained models and an optional local companion. It requires neither custom training nor a central inference service.
