# Manga Translator Pro — Server

FastAPI backend that does the heavy lifting when you pick the **Local Server** provider in the extension.

## Pipeline

```
image → text-region detection → manga-ocr → Ollama translation → JSON results
```

- **Text region detection**: OpenCV heuristic (good enough for Phase 1). Detects bright blob regions that look like speech bubbles.
- **OCR**: [manga-ocr](https://github.com/kha-white/manga-ocr) — a vision transformer trained specifically on Japanese manga. Much better than Tesseract on stylized fonts.
- **Translation**: Ollama running locally (default `qwen2.5:7b`). You can swap models via env var.

## Setup

```bash
pip install -r requirements.txt
uvicorn app:app --port 8001 --reload
```

(Or simply `python app.py` — it binds to port 8001 by default.)

First run will download the manga-ocr model (~400 MB). Subsequent starts are fast.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_URL` | `http://localhost:11434` | Where Ollama is running |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Ollama model used for JP→EN translation (text-only model is fine here, the OCR is done by manga-ocr). `TRANSLATION_MODEL` is also accepted for backwards compatibility. |

If the configured model isn't installed, the server falls back to the first
installed model from this list at startup: `qwen2.5:3b`, `qwen2.5:7b`,
`llama3.2:3b`, `llama3.1:8b`. Check `/health` to see what it actually resolved to.

Pull the default model once:
```bash
ollama pull qwen2.5:3b
```

## Health check

```bash
curl http://localhost:8001/health
```

Returns provider status, OCR engine info, and whether Ollama is reachable.

## Known limitations (Phase 1)

The OpenCV detector misses bubbles that:
- Have very dark backgrounds (inverted bubbles)
- Are too close to other bubbles (gets merged)
- Have busy/textured backgrounds

**Planned for Phase 2/3**: replace this with [comic-text-detector](https://github.com/dmMaze/comic-text-detector) (a CNN trained specifically on manga panels) for ~3x better recall.

## Why two providers?

The extension lets the user pick between:

- **Ollama (one-shot)** — vision-language model does detect + OCR + translate in a single API call. Simpler, faster, requires only one model running.
- **Local Server (this one)** — uses specialized manga-ocr (better text recognition) + a translation step. Higher quality text recognition, more components to manage.

For most users, **Ollama** is the recommended path. This server exists for users who want the best possible OCR quality.
