import { detectBubbles, cropBubble } from './bubbles.js';
import { createJapaneseWorker } from './ocr.js';
import { extractRegions, removeOverlaps } from './regions.js';
import { createPageTranslator } from '../providers/pageTranslation.js';

chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (request.action !== 'translate_captured_page' || sender.tab || sender.id !== chrome.runtime.id) return;
  translatePage(request.image, request.tabId).then(
    results => respond({ results }),
    error => respond({ error: error.message || String(error) }),
  );
  return true;
});

async function translatePage(image, tabId) {
  const status = message => chrome.runtime.sendMessage({
    action: 'page_translation_status', tabId, message,
  }).catch(() => {});
  status('Finding speech bubbles…');
  const source = await createImageBitmap(await (await fetch(image)).blob());
  const bubbles = detectBubbles(source);
  const regions = [];
  for (const code of ['jpn', 'jpn_vert']) {
    const vertical = code === 'jpn_vert';
    status(vertical ? 'Reading vertical text…' : 'Reading horizontal text…');
    const worker = await createJapaneseWorker(code);
    const output = { blocks: true, text: false };
    try {
      await worker.setParameters({ tessedit_pageseg_mode: vertical ? '5' : '6' });
      for (const bubble of bubbles.filter(candidate => candidate.vertical === vertical)) {
        const crop = await cropBubble(source, bubble);
        const { data } = await worker.recognize(crop, {}, output);
        regions.push(...extractRegions(data, 55).map(region => ({
          ...region, x: region.x + bubble.x, y: region.y + bubble.y, confidence: region.confidence + 20,
        })));
      }
      await worker.setParameters({ tessedit_pageseg_mode: '3' });
      const { data } = await worker.recognize(image, {}, output);
      regions.push(...extractRegions(data, 65));
    } finally {
      await worker.terminate();
    }
  }
  source.close();
  const selected = removeOverlaps(regions);
  if (!selected.length) return [];

  const translator = await createPageTranslator(status);
  try {
    const result = [];
    const cache = new Map();
    for (const region of selected) {
      status(`Translating ${result.length + 1} of ${selected.length}…`);
      if (!cache.has(region.text)) cache.set(region.text, await translator.translate(region.text));
      const text = cache.get(region.text).trim();
      if (text && text !== region.text) result.push({ ...region, text, automatic: true });
    }
    return result;
  } finally {
    await translator.close();
  }
}
