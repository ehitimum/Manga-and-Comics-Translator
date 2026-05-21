// Ollama provider — uses a local vision-language model (default: qwen2.5vl:7b)
// to detect Japanese text bubbles, OCR them, and translate in one shot.

const PROMPT = `You are a manga translator. Look at this image of a manga page.

Find EVERY Japanese text bubble, caption, sign, or sound effect visible in the image.
For each one:
  - Read the Japanese text (OCR)
  - Translate it to natural, fluent English (preserve tone — keep yelling LOUD, whispers soft)
  - Locate its bounding box in IMAGE PIXELS

Respond with ONLY a JSON array. No prose, no markdown fences, no explanation.
Schema: [{"x": <int>, "y": <int>, "w": <int>, "h": <int>, "text": "<english>"}]

  - x, y = top-left corner of the bubble in pixels
  - w, h = width and height of the bubble in pixels
  - text = English translation (NEVER Japanese, NEVER romaji)

If you see no Japanese text, return: []
If a bubble is partially cut off, still include it.
Do not include English text that is already English.`;

export async function translateWithOllama(base64Image, settings) {
  const url = (settings.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
  const model = settings.ollamaModel || 'qwen2.5vl:7b';

  const response = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, prompt: PROMPT, images: [base64Image], stream: false, format: 'json',
      options: { temperature: 0.2, num_ctx: 8192 },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Ollama returned ${response.status}: ${errText || response.statusText}. ` +
      `Is Ollama running at ${url}? Is the model "${model}" pulled? ` +
      `Try: ollama pull ${model}`
    );
  }

  const data = await response.json();
  const raw = (data.response || '').trim();
  return parseTranslationJson(raw);
}

export function parseTranslationJson(raw) {
  if (!raw) return [];
  let txt = raw.trim();
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
    const objMatch = txt.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { parsed = [JSON.parse(objMatch[0])]; }
      catch { throw new Error(`Model returned unparseable JSON. First 200 chars: ${raw.slice(0, 200)}`); }
    } else {
      throw new Error(`Model returned unparseable JSON. First 200 chars: ${raw.slice(0, 200)}`);
    }
  }
  if (!Array.isArray(parsed)) parsed = [parsed];
  return parsed
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      x: Math.round(Number(item.x ?? item.left ?? 0)),
      y: Math.round(Number(item.y ?? item.top ?? 0)),
      w: Math.round(Number(item.w ?? item.width ?? 0)),
      h: Math.round(Number(item.h ?? item.height ?? 0)),
      text: String(item.text ?? item.translation ?? '').trim(),
    }))
    .filter((item) => item.text && item.w > 0 && item.h > 0);
}

export async function testOllama(settings) {
  const url = (settings.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
  const model = settings.ollamaModel || 'qwen2.5vl:7b';
  const tagsRes = await fetch(`${url}/api/tags`);
  if (!tagsRes.ok) throw new Error(`Cannot reach Ollama at ${url}. Is it running? (ollama serve)`);
  const { models = [] } = await tagsRes.json();
  const names = models.map((m) => m.name);
  const hasModel = names.some((n) => n === model || n.startsWith(model.split(':')[0] + ':'));
  return {
    ok: true, serverReachable: true, modelInstalled: hasModel, availableModels: names,
    message: hasModel
      ? `Ollama OK. Model "${model}" is installed.`
      : `Ollama is running but "${model}" is not installed. Run: ollama pull ${model}`,
  };
}
