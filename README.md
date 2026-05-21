# Manga Translator Pro

A Chrome extension that translates Japanese manga into English in-place on any web page. Works on MangaDex, raw Japanese aggregator sites, and anywhere manga is rendered as images.

**Phase 1 status**: working end-to-end with local Ollama. Hosted/paid providers coming in Phase 2.

---

## Architecture

```
┌─────────────────────┐         ┌──────────────────────────┐
│  Chrome Extension   │         │  Provider (your choice)  │
│                     │         │                          │
│  popup.html ─────┐  │         │  Option A: Ollama        │
│  background.js ──┼──┼────────►│    qwen2.5vl:7b          │
│  content.js   ◄──┘  │         │    (one-shot vision)     │
│  options/ (React)   │         │                          │
└─────────────────────┘         │  Option B: FastAPI       │
                                │    + manga-ocr           │
                                │    + Ollama (text trans) │
                                └──────────────────────────┘
```

**Two-tier provider model**:
- **Ollama (default)**: one vision model handles detect + OCR + translate. Faster setup.
- **Local FastAPI Server**: specialized manga-OCR + a separate translation step. Higher quality.

---

## Prerequisites

- Node.js 20+
- Python 3.10+
- [Ollama](https://ollama.com/download) installed locally
- Chrome / Chromium / Edge / Brave (any Chromium-based browser)

---

## Setup

### 1. Install Ollama models

```bash
# For the Ollama provider (one-shot vision):
ollama pull qwen2.5vl:7b

# For the Local Server provider (translation step only):
ollama pull qwen2.5:7b
```

You only need both if you want both providers available. Most users only need `qwen2.5vl:7b`.

### 2. Build the extension

```bash
npm install
npm run build
```

This builds the React options page into `extension/options/`.

### 3. Load the extension into Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder

You should see "Manga Translator Pro" appear with the speech-bubble icon. Pin it to your toolbar for easier access.

### 4. (Optional) Start the local Python server

Only required if you pick the **Local Server** provider in the extension's options.

```bash
cd server
pip install -r requirements.txt
uvicorn app:app --port 8000
```

First run downloads the manga-ocr model (~400 MB). Subsequent runs are fast.

---

## Daily usage

1. Make sure Ollama is running: `ollama serve` (or it auto-starts on Mac/Windows)
2. Open any manga page — MangaDex, rawkuma, syosetu, whatever
3. Click the **Manga Translator Pro** icon in your toolbar
4. Click **Translate page** in the popup
5. English overlays appear on the detected bubbles

For repeated translation as you scroll, enable **Auto-translate on scroll** in the popup or options.

---

## Development

```bash
# Dev mode (Vite watching the React options page)
npm run build:watch

# Type-check
npm run lint

# Package as zip for distribution
npm run package
```

When developing the extension, after any change to `extension/*.js` you need to click the reload icon next to "Manga Translator Pro" in `chrome://extensions`. React changes to the options page auto-rebuild if you used `build:watch`.

---

## File structure

```
manga-translator-pro/
├── extension/                    # The Chrome extension (MV3)
│   ├── manifest.json
│   ├── background.js             # Service worker — routes to providers
│   ├── content.js                # Injected on-demand into manga pages
│   ├── popup.html / popup.js     # Toolbar popup
│   ├── icons/                    # 16/48/128 px
│   ├── providers/                # Pluggable backend interfaces
│   │   ├── ollama.js
│   │   └── localServer.js
│   └── options/                  # Built React options page (npm run build)
├── src/                          # React source (compiled into extension/options/)
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   ├── components/
│   │   ├── ProviderSelector.tsx
│   │   ├── ConnectionTester.tsx
│   │   └── ui.tsx
│   └── lib/
│       ├── storage.ts            # Typed chrome.storage wrapper
│       └── types.ts
├── server/                       # Optional FastAPI backend
│   ├── app.py
│   ├── requirements.txt
│   └── README.md
├── vite.config.ts                # Builds src/ → extension/options/
├── package.json
└── tsconfig.json
```

---

## Roadmap

- [x] **Phase 1** — Ollama + Local server providers, DPR-correct overlays, polished UI
- [ ] **Phase 2** — Multi-provider VLM (add Gemini, Claude, GPT-4o)
- [ ] **Phase 3** — Glossary memory (character names stay consistent across pages)
- [ ] **Phase 4** — Hosted backend with subscription
- [ ] **Phase 5** — Site-specific adapters (capture full-resolution manga images, not viewport screenshots)

---

## Troubleshooting

**"Cannot reach Ollama"** — Run `ollama serve` in a terminal. On Mac/Windows it should auto-start.

**"Model not installed"** — `ollama pull qwen2.5vl:7b`.

**Overlays appear in the wrong place** — Browser zoom or Retina display issue. Reset zoom to 100% (`Ctrl+0`). The DPR fix in `content.js` handles most cases but extreme zoom levels can still drift.

**No Japanese text detected** — Try toggling **Auto-translate on scroll** off, scroll to fully load the manga page, then click Translate again. Some sites lazy-load images.

**Can't translate this page** — The page must be `http://` or `https://`. Chrome blocks extensions on `chrome://`, the Web Store, and other extension pages.
