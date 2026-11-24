function luminance(data, index) {
  const offset = index * 4;
  return (data[offset] * 3 + data[offset + 1] * 6 + data[offset + 2]) / 10;
}

// Find enclosed light or dark interiors to give OCR a clean crop of each bubble.
export function detectBubbles(image) {
  const scale = Math.min(1, 1200 / Math.max(image.width, image.height));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
  );
  const { width, height } = canvas;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const mask = Uint8Array.from({ length: width * height }, (_, index) => {
    const level = luminance(data, index);
    return level >= 232 ? 1 : level <= 45 ? 2 : 0;
  });
  const queue = new Int32Array(mask.length);
  const bubbles = [];
  for (let index = 0; index < mask.length; index++) {
    const tone = mask[index];
    if (!tone) continue;
    mask[index] = 0;
    queue[0] = index;
    let size = 1;
    let left = width, right = 0, top = height, bottom = 0;
    for (let cursor = 0; cursor < size; cursor++) {
      const pixel = queue[cursor];
      const x = pixel % width, y = Math.floor(pixel / width);
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      if (x > 0) visit(pixel - 1);
      if (x < width - 1) visit(pixel + 1);
      if (y > 0) visit(pixel - width);
      if (y < height - 1) visit(pixel + width);
    }
    function visit(pixel) {
      if (mask[pixel] !== tone) return;
      queue[size++] = pixel;
      mask[pixel] = 0;
    }
    const w = right - left + 1, h = bottom - top + 1;
    if (size < 500 || size > mask.length * 0.35 || w < 25 || h < 25 ||
        size / (w * h) < 0.58 || left === 0 || top === 0 ||
        right === width - 1 || bottom === height - 1) continue;
    const x = Math.ceil((left + w * 0.11) / scale);
    const y = Math.ceil((top + h * 0.14) / scale);
    bubbles.push({
      x, y, w: Math.floor(w * 0.78 / scale), h: Math.floor(h * 0.72 / scale),
      dark: tone === 2, vertical: h > w * 1.15,
    });
  }
  return bubbles.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 16);
}

export async function cropBubble(image, bubble) {
  const canvas = new OffscreenCanvas(bubble.w, bubble.h);
  const context = canvas.getContext('2d');
  if (bubble.dark) context.filter = 'invert(1)';
  context.drawImage(image, bubble.x, bubble.y, bubble.w, bubble.h, 0, 0, bubble.w, bubble.h);
  return canvas.convertToBlob();
}
