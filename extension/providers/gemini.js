// Google Gemini provider — uses gemini-2.0-flash (or any vision-capable Gemini
// model) to detect Japanese text bubbles, OCR them, and translate in one shot.
//
// Why Gemini for manga?
//  - Native spatial understanding: it knows what's a speech bubble vs a panel
//    border vs a locker door, which heuristic detectors can't reliably tell.
//  - Strong Japanese OCR including stylized fonts and vertical text.
//  - Free tier on aistudio.google.com is generous (1500 req/day on Flash).
//
// Coordinate convention: Gemini returns box_2d as [ymin, xmin, ymax, xmax]
// normalized to [0, 1000]. We convert to absolute PNG pixel coordinates
// expected by the content script.

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const PROMPT = `You are a manga translator. Look at this manga page image carefully.

Find EVERY Japanese text bubble, caption, sign, or sound effect visible in the image. Ignore empty bubbles, decorative panels, background details, lockers, walls, and anything that is not Japanese text.

For each Japanese text region:
  1. Read the Japanese text (OCR — including vertical text and stylized fonts)
  2. Translate it into natural, fluent English (preserve tone: yelling stays LOUD, whispers stay soft, casual stays casual)
  3. Locate its bounding box

Output strict JSON only — an array of objects with this exact schema:
[
  {"box_2d": [ymin, xmin, ymax, xmax], "text": "<english translation>"}
]

CRITICAL — bounding box accuracy:
  - box_2d uses [ymin, xmin, ymax, xmax] order, normalized to [0, 1000] relative to the full image.
  - The four numbers MUST tightly enclose the actual Japanese text in the image.
  - The image may have wide dark or empty margins on the left and/or right where the manga page is centered. NEVER place a bounding box inside an empty/dark margin — find the actual text pixels and put the box on them.
  - Before outputting, sanity-check each box: imagine drawing a rectangle at [xmin, ymin]–[xmax, ymax] on the image. The Japanese characters MUST be visible inside that rectangle. If the rectangle is mostly empty or dark, your coordinates are wrong.
  - Verify left/right placement: text on the right half of the image MUST have xmin > 500. Text on the left half MUST have xmax < 500. Centered text spans across 500.
  - Verify top/bottom placement: text in the bottom half MUST have ymin > 500. Text in the top half MUST have ymax < 500.
  - Do not output a box if you are unsure of its exact location — accuracy matters more than recall.

Rules:
  - Return ONLY the JSON array, no prose, no markdown, no code fences.
  - text is the English translation, never Japanese, never romaji, never quotes.
  - Keep onomatopoeia / sound effects short (e.g. "BANG!", "thud", "sigh").
  - If no Japanese text is visible, return: []
  - Do NOT include English text that is already English.`;

const REQUEST_TIMEOUT_MS = 90_000;

export async function translateWithGemini(base64Image, settings) {
  const apiKey = (settings.geminiApiKey || '').trim();
  if (!apiKey) {
    throw new Error('Gemini API key is not set. Add one in the extension options (free at aistudio.google.com/apikey).');
  }
  const model = settings.geminiModel || 'gemini-2.0-flash';
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: 'image/png', data: base64Image } },
              { text: PROMPT },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Gemini request timed out after ${REQUEST_TIMEOUT_MS / 1000}s. Try a smaller / different model or check your connection.`);
    }
    throw new Error(`Gemini network error: ${err.message || err}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    let detail = errText;
    try {
      const errJson = JSON.parse(errText);
      detail = errJson?.error?.message || errText;
    } catch { /* ignore */ }
    throw new Error(`Gemini API returned ${response.status}: ${detail || response.statusText}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!text.trim()) return [];

  const { width: imgW, height: imgH } = readPngSize(base64Image);
  if (!imgW || !imgH) {
    throw new Error('Could not read PNG dimensions from captured tab image.');
  }
  console.log(`[MangaTranslator] Gemini image ${imgW}x${imgH}, raw response:`, text);
  const boxes = parseGeminiBoxes(text, imgW, imgH);
  console.log('[MangaTranslator] Gemini boxes (PNG pixels):', boxes);
  return boxes;
}

export function parseGeminiBoxes(raw, imgW, imgH) {
  let txt = (raw || '').trim();
  txt = txt.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const firstBracket = txt.indexOf('[');
  const lastBracket = txt.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    txt = txt.slice(firstBracket, lastBracket + 1);
  }
  let parsed;
  try {
    parsed = JSON.parse(txt);
  } catch (e) {
    throw new Error(`Gemini returned unparseable JSON. First 200 chars: ${raw.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) parsed = [parsed];

  return parsed
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const text = String(item.text ?? item.translation ?? '').trim();
      // Two shapes: { box_2d: [ymin,xmin,ymax,xmax] } normalized to 1000,
      // OR direct { x, y, w, h } in pixel space. Handle both.
      if (Array.isArray(item.box_2d) && item.box_2d.length === 4) {
        const [ymin, xmin, ymax, xmax] = item.box_2d.map(Number);
        const x = Math.round((xmin / 1000) * imgW);
        const y = Math.round((ymin / 1000) * imgH);
        const w = Math.round(((xmax - xmin) / 1000) * imgW);
        const h = Math.round(((ymax - ymin) / 1000) * imgH);
        return { x, y, w, h, text };
      }
      return {
        x: Math.round(Number(item.x ?? item.left ?? 0)),
        y: Math.round(Number(item.y ?? item.top ?? 0)),
        w: Math.round(Number(item.w ?? item.width ?? 0)),
        h: Math.round(Number(item.h ?? item.height ?? 0)),
        text,
      };
    })
    .filter((item) => item.text && item.w > 0 && item.h > 0);
}

export async function testGemini(settings) {
  const apiKey = (settings.geminiApiKey || '').trim();
  if (!apiKey) {
    throw new Error('No Gemini API key set. Grab a free one at aistudio.google.com/apikey.');
  }
  const url = `${GEMINI_API_BASE}/models?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let detail = errText;
    try {
      const errJson = JSON.parse(errText);
      detail = errJson?.error?.message || errText;
    } catch { /* ignore */ }
    throw new Error(`Gemini API returned ${res.status}: ${detail || res.statusText}`);
  }
  const data = await res.json();
  const allModels = (data.models || []).map((m) => (m.name || '').replace(/^models\//, ''));
  const visionModels = allModels.filter((n) => /gemini-(2|1\.5)/i.test(n) && !/embedding|aqa/i.test(n));
  const wanted = settings.geminiModel || 'gemini-2.0-flash';
  const hasModel = visionModels.some((n) => n === wanted || n.startsWith(wanted));
  return {
    ok: true,
    serverReachable: true,
    modelInstalled: hasModel,
    availableModels: visionModels,
    message: hasModel
      ? `Gemini OK. Model "${wanted}" available.`
      : `API key is valid but "${wanted}" is not in the available models list — try one of the listed models.`,
  };
}

// ---------------------------------------------------------------------------
// PNG size reader — extracts width/height from the IHDR chunk of a base64 PNG
// without decoding the whole image. PNG layout: 8-byte signature + IHDR chunk
// where bytes 16..19 = width, 20..23 = height (both big-endian uint32).
// ---------------------------------------------------------------------------
export function readPngSize(base64) {
  // We only need the first ~24 bytes, so decode just the prefix to keep this cheap.
  const prefix = base64.slice(0, 64);
  const bin = atob(prefix);
  if (bin.length < 24) return { width: 0, height: 0 };
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  // PNG signature is 8 bytes (137,80,78,71,13,10,26,10)
  if (u8[0] !== 0x89 || u8[1] !== 0x50 || u8[2] !== 0x4e || u8[3] !== 0x47) {
    return { width: 0, height: 0 };
  }
  const dv = new DataView(u8.buffer);
  const width = dv.getUint32(16, false);
  const height = dv.getUint32(20, false);
  return { width, height };
}
