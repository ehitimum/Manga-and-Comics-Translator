const japanese = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu;

export function extractRegions(data, minimumConfidence = 45) {
  return (data.blocks || []).flatMap(block => block.paragraphs || []).flatMap(paragraph => {
    const text = paragraph.text.trim().replace(/\s+/gu, '');
    const { x0, y0, x1, y1 } = paragraph.bbox;
    if ((text.match(japanese)?.length || 0) < 2 || paragraph.confidence < minimumConfidence ||
        x1 - x0 < 8 || y1 - y0 < 8) return [];
    return [{ x: x0, y: y0, w: x1 - x0, h: y1 - y0, text, confidence: paragraph.confidence }];
  });
}

function overlap(a, b) {
  const width = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return width * height / Math.min(a.w * a.h, b.w * b.h);
}

export function removeOverlaps(regions) {
  const kept = [];
  for (const region of [...regions].sort((a, b) => b.confidence - a.confidence)) {
    if (!kept.some(other => overlap(region, other) > 0.65)) kept.push(region);
    if (kept.length === 24) break;
  }
  return kept;
}
