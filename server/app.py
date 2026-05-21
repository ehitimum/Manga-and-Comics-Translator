"""
Manga Translator Pro — local backend server.

Pipeline:
    image -> text-region detection -> manga-ocr (per region) -> translation -> JSON

Text detection: OpenCV heuristic (multi-threshold + density + text-presence
filtering). Phase 1 "good enough" detector — swap for comic-text-detector or
manga-image-translator later for higher recall.

OCR: manga-ocr (specialized vision transformer for Japanese manga text).
Translation: Ollama (local LLM, default qwen2.5:3b — text-only, low RAM).

Run:
    pip install -r requirements.txt
    uvicorn app:app --port 8001 --reload
"""

import asyncio
import base64
import io
import logging
import os
import re
from contextlib import asynccontextmanager
from typing import List, Optional, Tuple

import cv2
import httpx
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from manga_ocr import MangaOcr
from PIL import Image
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
# Accept either OLLAMA_MODEL or TRANSLATION_MODEL (the latter is the legacy name).
TRANSLATION_MODEL = (
    os.getenv("OLLAMA_MODEL")
    or os.getenv("TRANSLATION_MODEL")
    or "qwen2.5:3b"
)
# Fallback candidates if the configured model returns 404. Listed smallest first.
FALLBACK_MODELS = ["qwen2.5:3b", "qwen2.5:7b", "llama3.2:3b", "llama3.1:8b"]

# Detection caps so the response can't be dominated by garbage.
MAX_REGIONS = 15

# Used to recognize meaningful Japanese in OCR output (filters hallucinations).
_CJK_RE = re.compile(r"[぀-ゟ゠-ヿ一-鿿＀-￯]")
_PUNCT_RE = re.compile(r"[\s\.\,\!\?\:\;\(\)\[\]\{\}\<\>\"\'\`\~\-\_\=\+\*\&\^\%\$\#\@\…\・\。\、\「\」\『\』]+")


def _is_meaningful_japanese(text: str) -> bool:
    """Heuristic: does this look like real Japanese text we should translate?

    manga-ocr hallucinates on empty/textureless crops, producing strings like
    "..." or single random characters. Drop those before sending to translation.
    """
    if not text:
        return False
    stripped = _PUNCT_RE.sub("", text).strip()
    if len(stripped) < 2:
        return False
    cjk_count = len(_CJK_RE.findall(stripped))
    return cjk_count >= 2

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("manga-translator")

# ---------------------------------------------------------------------------
# Models (loaded once at startup)
# ---------------------------------------------------------------------------
mocr: Optional[MangaOcr] = None
resolved_translation_model: str = TRANSLATION_MODEL


async def _list_ollama_models() -> List[str]:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            r.raise_for_status()
            data = r.json()
            return [m.get("name", "") for m in data.get("models", []) if m.get("name")]
    except Exception as e:
        log.warning("Could not list Ollama models: %s", e)
        return []


async def _resolve_model() -> str:
    """Pick the first available model from [configured, *FALLBACK_MODELS]."""
    available = await _list_ollama_models()
    candidates = [TRANSLATION_MODEL, *[m for m in FALLBACK_MODELS if m != TRANSLATION_MODEL]]
    for cand in candidates:
        if cand in available:
            if cand != TRANSLATION_MODEL:
                log.warning(
                    "Configured model %r is not installed. Falling back to %r.",
                    TRANSLATION_MODEL, cand,
                )
            return cand
    log.warning(
        "None of the candidate models %s are installed in Ollama (available=%s). "
        "Translation will fail until you `ollama pull %s` (or any candidate).",
        candidates, available, TRANSLATION_MODEL,
    )
    return TRANSLATION_MODEL  # keep configured value; will 404 but at least it's loud


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global mocr, resolved_translation_model
    log.info("Loading manga-ocr model (this can take ~30s on first run)...")
    mocr = MangaOcr()
    log.info("manga-ocr ready.")
    resolved_translation_model = await _resolve_model()
    log.info("Translation model resolved to: %s", resolved_translation_model)
    yield
    log.info("Shutting down.")


app = FastAPI(title="Manga Translator Pro", version="0.2.1", lifespan=lifespan)

# Allow the Chrome extension to call us from any origin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class TranslateRequest(BaseModel):
    image: str = Field(..., description="Base64-encoded PNG image (no data: prefix)")


class TextRegion(BaseModel):
    x: int
    y: int
    w: int
    h: int
    text: str


class TranslateResponse(BaseModel):
    results: List[TextRegion]


# ---------------------------------------------------------------------------
# Text region detection
# ---------------------------------------------------------------------------
def _iou(a: Tuple[int, int, int, int], b: Tuple[int, int, int, int]) -> float:
    ax1, ay1, aw, ah = a; ax2, ay2 = ax1 + aw, ay1 + ah
    bx1, by1, bw, bh = b; bx2, by2 = bx1 + bw, by1 + bh
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter == 0:
        return 0.0
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def _box_contains(outer: Tuple[int, int, int, int], inner: Tuple[int, int, int, int]) -> bool:
    ox, oy, ow, oh = outer
    ix, iy, iw, ih = inner
    return ix >= ox and iy >= oy and ix + iw <= ox + ow and iy + ih <= oy + oh


def _dedupe(boxes: List[Tuple[int, int, int, int]], iou_thresh: float = 0.5) -> List[Tuple[int, int, int, int]]:
    """Greedy dedupe — keep the larger box on overlap, and drop boxes fully inside another."""
    boxes_sorted = sorted(boxes, key=lambda b: b[2] * b[3], reverse=True)
    kept: List[Tuple[int, int, int, int]] = []
    for box in boxes_sorted:
        if any(_iou(box, k) >= iou_thresh or _box_contains(k, box) for k in kept):
            continue
        kept.append(box)
    return kept


def _candidates_from_mask(mask: np.ndarray, gray: np.ndarray, img_area: int) -> List[Tuple[int, int, int, int]]:
    """Connected-component candidates from a binary mask. Keeps regions that look
    like manga bubble interiors: high fill ratio, multiple distinct text-stroke
    blobs in the interior, no dominant straight edges (would indicate a panel
    border or locker door, not a bubble).

    Crucially we do NOT morphologically close the mask — manga bubble outlines
    are thin black lines that would be bridged by close(), merging each bubble
    with the surrounding panel and locker whitespace.
    """
    h, w = mask.shape
    num_labels, _labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)

    boxes: List[Tuple[int, int, int, int]] = []
    for i in range(1, num_labels):  # 0 is background
        x, y, cw, ch, pixel_area = stats[i]
        bbox_area = cw * ch
        if bbox_area == 0:
            continue
        # Reject region touching the image border by more than a hair — those are
        # almost always panel backgrounds bleeding to the edge, not bubbles.
        if x <= 1 and y <= 1 and (x + cw >= w - 1 or y + ch >= h - 1):
            continue
        # Size: 0.04% – 8% of the page (bubbles are smallish; panels are larger).
        if pixel_area < img_area * 0.0004 or pixel_area > img_area * 0.08:
            continue
        # Aspect ratio: tightened — real manga bubbles aren't extreme ribbons.
        aspect = cw / max(1, ch)
        if aspect < 0.3 or aspect > 3.5:
            continue
        # Fill ratio LOWER bound: bubble interior is convex-ish (component fills
        # most of its bbox). UPPER bound: rectangles (lockers, panels) fill
        # ~0.86-1.0 of their bbox; ellipses fill ~0.785. Reject near-rectangles.
        fill_ratio = pixel_area / bbox_area
        if fill_ratio < 0.55 or fill_ratio > 0.82:
            continue
        # Text presence: check dark density in the INTERIOR only (exclude border).
        ipx = max(2, cw // 8)
        ipy = max(2, ch // 8)
        inner = gray[y + ipy : y + ch - ipy, x + ipx : x + cw - ipx]
        if inner.size == 0:
            continue
        dark_density = float(np.mean(inner < 90))
        if dark_density < 0.02 or dark_density > 0.45:
            continue
        # Edge-density (Laplacian variance) — text crops have many sharp edges,
        # while empty panels have low variance.
        lap_var = float(cv2.Laplacian(inner, cv2.CV_64F).var())
        if lap_var < 150.0:
            continue
        # Distinct dark blobs — a bubble with text has multiple separated dark
        # connected components (one per character stroke cluster).
        _, dark = cv2.threshold(inner, 90, 255, cv2.THRESH_BINARY_INV)
        _n, _, dark_stats, _ = cv2.connectedComponentsWithStats(dark, connectivity=8)
        meaningful_dark = [s for s in dark_stats[1:] if s[cv2.CC_STAT_AREA] >= 8]
        if len(meaningful_dark) < 3:
            continue
        # Largest dark blob aspect — character strokes are roughly compact (~1:1
        # to 1:3). Long thin blobs are shadow bars / underlines, not text.
        if meaningful_dark:
            largest = max(meaningful_dark, key=lambda s: s[cv2.CC_STAT_AREA])
            blob_aspect = largest[cv2.CC_STAT_WIDTH] / max(1, largest[cv2.CC_STAT_HEIGHT])
            if blob_aspect > 5.0 or blob_aspect < 0.18:
                continue
        # CENTER density — text in a real bubble lives near the middle. An empty
        # locker with bottom shading has the dark pixels at the edge, not the
        # center. Sample the central 40% × 40% of the bbox.
        ch_inner = ch - 2 * ipy
        cw_inner = cw - 2 * ipx
        center_x0 = x + ipx + cw_inner * 3 // 10
        center_y0 = y + ipy + ch_inner * 3 // 10
        center_x1 = x + ipx + cw_inner * 7 // 10
        center_y1 = y + ipy + ch_inner * 7 // 10
        if center_x1 <= center_x0 or center_y1 <= center_y0:
            continue
        center = gray[center_y0:center_y1, center_x0:center_x1]
        center_dark = float(np.mean(center < 90))
        if center_dark < 0.03:
            continue
        # Straight-edge detection — locker doors have long straight sides.
        bbox_gray = gray[y : y + ch, x : x + cw]
        edges = cv2.Canny(bbox_gray, 80, 200)
        line_thresh = max(20, int(0.4 * min(cw, ch)))
        min_line = int(0.6 * max(cw, ch))
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=line_thresh,
                                minLineLength=min_line, maxLineGap=4)
        if lines is not None and len(lines) > 0:
            continue
        boxes.append((int(x), int(y), int(cw), int(ch)))
    return boxes


def detect_text_regions(pil_image: Image.Image) -> List[dict]:
    """
    Detect speech-bubble-like regions in a manga page.

    Strategy:
      1. Two brightness thresholds (catches both bright-white and slightly-tinted bubbles)
      2. Connected components on each mask — NO morphological close (would bridge
         thin black bubble outlines and merge each bubble with the surrounding panel)
      3. Filter each component by size, aspect ratio, fill ratio, and dark-pixel
         (text) presence
      4. Optional padding so cropped regions include a margin of bubble border
      5. Dedupe and cap

    Returns list of {x, y, w, h} dicts in IMAGE pixels. Empty list if nothing
    looks like a bubble — we intentionally do NOT fall back to the full image,
    because that produces one giant overlay covering the page.
    """
    img = np.array(pil_image.convert("RGB"))
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    img_area = h * w

    # Smooth a little to suppress halftone screentone noise without erasing borders.
    gray_blur = cv2.medianBlur(gray, 3)

    # Two thresholds: 200 catches slightly-tinted bubbles, 230 catches crisp white ones.
    _, mask_loose = cv2.threshold(gray_blur, 200, 255, cv2.THRESH_BINARY)
    _, mask_tight = cv2.threshold(gray_blur, 230, 255, cv2.THRESH_BINARY)

    boxes = (
        _candidates_from_mask(mask_loose, gray, img_area)
        + _candidates_from_mask(mask_tight, gray, img_area)
    )

    # Pad each box by 4px so manga-ocr sees a small margin (it improves OCR).
    padded: List[Tuple[int, int, int, int]] = []
    for x, y, cw, ch in boxes:
        pad = 4
        nx = max(0, x - pad)
        ny = max(0, y - pad)
        nw = min(w - nx, cw + 2 * pad)
        nh = min(h - ny, ch + 2 * pad)
        padded.append((nx, ny, nw, nh))

    regions: List[Tuple[int, int, int, int]] = _dedupe(padded)[:MAX_REGIONS]

    if not regions:
        log.info("No regions detected (returning empty — extension will show 'no text found').")
        return []

    log.info("Detected %d candidate text regions.", len(regions))
    return [{"x": int(x), "y": int(y), "w": int(cw), "h": int(ch)} for x, y, cw, ch in regions]


# ---------------------------------------------------------------------------
# Translation via Ollama
# ---------------------------------------------------------------------------
TRANSLATION_PROMPT = """You are a manga translator. Translate the following Japanese text into natural, fluent English.

Rules:
- Preserve tone (yelling stays LOUD, whispers stay soft, casual stays casual).
- Use natural English idioms, not literal translations.
- Keep onomatopoeia/SFX short (e.g. "BANG!", "thud").
- Return ONLY the English translation, no explanation, no romaji, no quotes.

Japanese: {text}
English:"""


async def translate_text(japanese: str, client: httpx.AsyncClient) -> str:
    if not japanese.strip():
        return ""
    try:
        res = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": resolved_translation_model,
                "prompt": TRANSLATION_PROMPT.format(text=japanese),
                "stream": False,
                "options": {"temperature": 0.3, "num_ctx": 2048},
            },
            timeout=60.0,
        )
        if res.status_code == 404:
            log.error(
                "Ollama 404 for model %r. Run: ollama pull %s  (or set OLLAMA_MODEL to an installed model)",
                resolved_translation_model, resolved_translation_model,
            )
            return japanese
        res.raise_for_status()
        return (res.json().get("response") or "").strip()
    except Exception as e:
        log.warning("Translation failed for %r: %s", japanese[:30], e)
        return japanese  # fall back to original; better than empty


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
async def health():
    """Status endpoint hit by the extension's options page test button."""
    ollama_status = "unknown"
    available_models: List[str] = []
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            if r.status_code == 200:
                ollama_status = "ok"
                available_models = [m.get("name", "") for m in r.json().get("models", [])]
            else:
                ollama_status = f"http_{r.status_code}"
    except Exception as e:
        ollama_status = f"unreachable ({type(e).__name__})"

    model_installed = resolved_translation_model in available_models

    return {
        "ok": True,
        "detector": "opencv-heuristic",
        "ocr": "manga-ocr",
        "translator": f"ollama:{resolved_translation_model}",
        "model_installed": model_installed,
        "ollama_status": ollama_status,
        "ollama_url": OLLAMA_URL,
        "available_models": available_models,
    }


@app.post("/translate", response_model=TranslateResponse)
async def translate(req: TranslateRequest):
    if mocr is None:
        raise HTTPException(503, "OCR model not loaded yet, try again in a moment.")

    # Decode image
    try:
        image_bytes = base64.b64decode(req.image)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception as e:
        raise HTTPException(400, f"Invalid image: {e}")

    log.info("Image received: %dx%d", image.width, image.height)

    # 1. Detect text regions
    regions = detect_text_regions(image)
    if not regions:
        return TranslateResponse(results=[])

    # 2. OCR each region with manga-ocr, drop hallucinations
    ocr_results = []
    dropped = 0
    for box in regions:
        try:
            cropped = image.crop((box["x"], box["y"], box["x"] + box["w"], box["y"] + box["h"]))
            jp_text = mocr(cropped)
            if jp_text and _is_meaningful_japanese(jp_text):
                ocr_results.append((box, jp_text.strip()))
            elif jp_text:
                dropped += 1
        except Exception as e:
            log.warning("OCR failed on region %s: %s", box, e)

    log.info("OCR produced %d meaningful texts (%d dropped as nonsense).", len(ocr_results), dropped)
    if not ocr_results:
        return TranslateResponse(results=[])

    # 3. Translate via Ollama (concurrent)
    async with httpx.AsyncClient() as client:
        translations = await asyncio.gather(
            *(translate_text(jp, client) for _, jp in ocr_results),
            return_exceptions=False,
        )

    # 4. Pack results
    results: List[TextRegion] = []
    for (box, _jp), en in zip(ocr_results, translations):
        if en and en.strip():
            results.append(TextRegion(x=box["x"], y=box["y"], w=box["w"], h=box["h"], text=en.strip()))

    log.info("Returning %d translations.", len(results))
    return TranslateResponse(results=results)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
