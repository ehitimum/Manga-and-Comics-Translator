# Benchmarks and test suites

Run `npm run build` first.

| Command | What it does |
| --- | --- |
| `npm test` | Node unit tests: geometry, OCR text assembly, translation batching, ZIP/CTC decoding, text fitting. |
| `npm run bench` | Engine benchmark on the synthetic manga page (`tests/e2e/fixtures/manga-page.html`) at DPR 2 and 1. |
| `npm run test:e2e` | Benchmark plus the extension suites: hostile pages, capture and source-image pipelines, 5-page read-ahead, partial-bubble replacement, blocked image hosts, cache, auto mode, snapshot view, always-translate sites, extension pages. |
| `node tests/e2e/run.mjs --accurate` | Also downloads Accurate mode (128 MB from Hugging Face) and checks it, including text outside bubbles. |

The suites load a copy of `extension/` with `<all_urls>` added, because automation cannot grant `activeTab`. Pinned tessdata is downloaded to `tests/.cache` and checked against the SHA-256 in `extension/reader/models.js`. The `debugEchoTranslator` setting makes the engine "translate" to `[EN] <Japanese>` so the pipeline can be tested without a translation model.

## Hard cases (`tests/e2e/fixtures/hard-page.html`)

The page has four bubbles built from cases reported on real sites: vertical text with furigana, a thin broken outline on a pale page, and bubbles cut off by the top and bottom of the screen.

| Version | DPR 2 | DPR 1 |
| --- | --- | --- |
| 0.5.0-beta.2 | 0 of 4 | 1 of 4 |
| 0.5.0-beta.3 | 4 of 4 | 4 of 4 |

The fixes: the light and dark masks are eroded by one pixel, which seals outline gaps and keeps crops inside the outline; bubble shape is judged on the filled outline; furigana columns are blanked before OCR; screen captures keep bubbles cut by one edge, flagged as partial, and replace them once fully visible.

## Hostile pages

Each page checks screen pixels where the overlays should be: baseline, strict CSP, fixed reader at max `z-index`, modal `<dialog>`, page popover, fullscreen reader, inner scroll container (overlays must follow), a script that deletes added nodes, click-to-turn-page (clicks must pass through), `html { zoom: 1.25 }` (alignment), and a cross-origin iframe reader (overlays must follow scrolling inside the frame).

## Baseline (4-core cloud container, headless Chrome 158)

Engine, OCR stage, warm, synthetic page with 7 fully visible bubbles:

| Version | DPR 2 | DPR 1 | Bubbles read (similarity ≥ 0.8) |
| --- | --- | --- | --- |
| 0.4.0-beta.1 | ~3.4 s | — | 3 of 7 |
| 0.5.0-beta.1 | ~170–190 ms | ~150–170 ms | 7 of 7 (mean similarity 1.00 / 0.97) |

What changed: SIMD Tesseract builds, a warm worker pool shared by both orientations, no full-page OCR passes, crops masked to the bubble's shape, blank and background candidates skipped, orientation from the ink, crops scaled to ~18 px glyphs, single-character bubbles kept.

In the extension, the first overlay of a cold start appears after about 2 s (offscreen document, OCR workers and translator start-up). Later translations reuse warm workers and the crop cache. Translation-model timings are not included: Hugging Face was not reachable from the test environment, so the suites use the echo translator.

The synthetic page uses a clean print font. Add real pages you have rights to before drawing conclusions about stylised lettering.
