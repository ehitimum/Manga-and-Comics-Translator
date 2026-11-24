# Manga Translator Pro

## Test v0.4.0 beta

Download the [extension ZIP](https://github.com/ehitimum/Manga-and-Comics-Translator/releases/tag/v0.4.0-beta.1). Extract it and select the folder containing `manifest.json` under **chrome://extensions → Developer mode → Load unpacked**. From a source checkout, run `npm ci` and `npm run build` before loading or reloading `extension`.

1. Open a Japanese manga page on HTTP or HTTPS. Choose **Chrome Translator** in Settings if you previously configured another provider.
2. Open the extension popup and click **Translate page**. Stay on the manga tab while the extension detects and reads the visible bubbles. English appears over the original page.
3. Use **Show original** to compare, or enable **Auto-translate on scroll** to process the next viewport after scrolling stops.

The default pipeline uses local bubble detection and horizontal and vertical Japanese OCR. If Chrome’s Japanese-to-English translator is ready, the extension uses it. Otherwise it downloads a quantized OPUS-MT model and runs it locally with ONNX Runtime WASM. Allow about 120 MB for the first fallback run, including OCR models. The default pipeline keeps manga pixels and recognized text on the device. Existing configured providers retain their own processing paths. [Chrome Translator API](https://developer.chrome.com/docs/ai/translator-api) · [OPUS-MT model and license](https://huggingface.co/Helsinki-NLP/opus-mt-ja-en)

This beta uses viewport capture and heuristic speech-bubble detection. Stylized lettering, clipped bubbles and textured art can reduce recall. The **Translate typed text** tool remains available in the popup.

The [GitHub wiki](https://github.com/ehitimum/Manga-and-Comics-Translator/wiki/Development-Roadmap) and [repository roadmap](docs/Development-Roadmap.md) track release history and phase acceptance checks.

---

## Optional automatic overlay providers

```
┌─────────────────────┐         ┌──────────────────────────────┐
│  Chrome Extension   │         │  Provider (your choice)      │
│                     │         │                              │
│  popup.html ─────┐  │         │  Option A: Gemini API        │
│  background.js ──┼──┼────────►│    gemini-2.0-flash          │
│  content.js   ◄──┘  │         │    (cloud, free tier)        │
│  options/ (React)   │         │                              │
└─────────────────────┘         │  Option B: Ollama            │
                                │    qwen2.5vl:7b              │
                                │    (one-shot local vision)   │
                                │                              │
                                │  Option C: FastAPI           │
                                │    + manga-ocr               │
                                │    + Ollama (text trans)     │
                                └──────────────────────────────┘
```

**Three provider options:**

| Provider | Setup | Privacy | Cost |
|---|---|---|---|
| **Gemini API** | Paste a free API key | Sends images to Google | Free ~1500 req/day |
| **Ollama** | Install + pull model | Fully local | Free, needs ~6GB RAM |
| **Local Server** | Python + Ollama | Fully local | Free, best OCR quality |

---

## Prerequisites

- Node.js 20+
- Chrome / Chromium / Edge / Brave (any Chromium-based browser)
- **For Gemini provider:** A Google account to get a free API key
- **For Ollama provider:** [Ollama](https://ollama.com/download) installed locally
- **For Local Server provider:** Python 3.10+ and Ollama installed locally

---

## Setup

### Option A — Gemini

**1. Get a free Gemini API key**

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and sign in with a Google account.
2. Click **Create API key** → select **Default Gemini Project** → copy the key.

> **Which model?** The default is `gemini-2.5-flash` — good accuracy, generous free quota. For production / highest accuracy on pages with dark margins, switch to `gemini-2.5-pro` in the options dropdown (requires Pro billing enabled in your Google Cloud project — Pro is not on the free tier).

**2. Build and load the extension**

```bash
npm install
npm run build
```

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder
4. Pin "Manga Translator Pro" to your toolbar

**3. Paste your API key**

Click the Manga Translator Pro icon → **Options** (or right-click → Options). Select the **Gemini** provider. Paste your key and click **Test connection**.

---

### Option B — Ollama (local, offline)

**1. Install Ollama models**

```bash
# Vision model for detect + OCR + translate (one-shot):
ollama pull qwen2.5vl:7b

# Or a smaller alternative (~1.7 GB):
ollama pull moondream:latest
```

**2. Build and load the extension** (same as Option A steps 2 above)

**3. Switch to Ollama in options**

Open the extension's Options page → select **Ollama** → confirm the URL is `http://localhost:11434` → click **Test connection**.

---

### Option C — Local Server (highest OCR quality)

Requires Ollama (for translation) plus a Python FastAPI server (for specialist manga-OCR).

**1. Pull the translation model**

```bash
ollama pull qwen2.5:3b
```

**2. Start the Python server**

```bash
cd server

# Create and activate a virtual environment (one-time)
python -m venv venv
source venv/bin/activate        # Mac/Linux
# venv\Scripts\activate         # Windows

pip install -r requirements.txt
uvicorn app:app --port 8001
```

On subsequent runs, just activate the venv and start the server:

```bash
cd server
source venv/bin/activate        # Mac/Linux
# venv\Scripts\activate         # Windows
uvicorn app:app --port 8001
```

First run downloads the manga-ocr model (~400 MB). Subsequent runs are fast.

**3. Build and load the extension** (same as Option A steps 2 above)

**4. Switch to Local Server in options**

Open the extension's Options page → select **Local Server** → confirm the URL is `http://localhost:8001` → click **Test connection**.

---

## Daily usage

1. Open any manga page — MangaDex, rawkuma, syosetu, etc.
2. Click the **Manga Translator Pro** icon in your toolbar.
3. Click **Translate page** in the popup.
4. English overlays appear on the detected bubbles.

> **Gemini users:** No local software needs to be running.
>
> **Ollama / Local Server users:** Make sure `ollama serve` is running first (it auto-starts on Mac/Windows).

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

When developing the extension, after any change to `extension/*.js` click the reload icon next to "Manga Translator Pro" in `chrome://extensions`. React changes to the options page auto-rebuild if you used `build:watch`.

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
│   │   ├── gemini.js             # Google Gemini vision API
│   │   ├── ollama.js             # Local Ollama vision model
│   │   └── localServer.js        # FastAPI + manga-ocr server
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
├── server/                       # Optional FastAPI backend (Option C)
│   ├── app.py
│   ├── requirements.txt
│   └── README.md
├── vite.config.ts                # Builds src/ → extension/options/
├── package.json
└── tsconfig.json
```

---

## Roadmap

- [x] **Phase 1** — Gemini API + Ollama + Local server providers, DPR-correct overlays, polished options UI
- [ ] **Phase 2** — Additional cloud providers (Claude, GPT-4o); glossary memory for character names
- [ ] **Phase 3** — Hosted backend with subscription
- [ ] **Phase 4** — Site-specific adapters (capture full-resolution images, not viewport screenshots)

---

## Troubleshooting

**"Cannot reach Ollama"** — Run `ollama serve` in a terminal. On Mac/Windows it should auto-start.

**"Model not installed"** — Run `ollama pull qwen2.5vl:7b` (or whichever model is selected in options).

**Gemini 429 / quota exceeded** — You've hit the free-tier limit (~1500 req/day for gemini-2.0-flash). Either wait for the daily reset or switch the model to **Gemini 1.5 Flash** in options (more consistent free quota).

**Gemini API key not working** — Make sure the key was created with **Default Gemini Project** selected at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Keys created under other projects may have zero Gemini quota.

**Overlays appear in the wrong place** — Browser zoom or Retina display issue. Reset zoom to 100% (`Ctrl+0`). The DPR fix in `content.js` handles most cases but extreme zoom levels can still drift.

**No Japanese text detected** — Try toggling **Auto-translate on scroll** off, scroll to fully load the manga page, then click Translate again. Some sites lazy-load images.

**Can't translate this page** — The page must be `http://` or `https://`. Chrome blocks extensions on `chrome://`, the Web Store, and other extension pages.
