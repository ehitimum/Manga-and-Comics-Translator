export const modelRevision = '87416418657359cb625c412a48b6e1d6d41c29bd';
export const ocrCache = 'ocr-tessdata-fast-' + modelRevision;
export const models = {
  jpn: { bytes: 2471260, sha256: '1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d' },
  jpn_vert: { bytes: 3037480, sha256: 'bf1e2640954691797e2dc14f38533e601b59ee37958698ae0f0b81dc6f09c71b' },
};

export function modelUrl(code) {
  return 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/' + modelRevision + '/' + code + '.traineddata';
}

export async function installModel(code) {
  const entry = models[code];
  const cache = await caches.open(ocrCache);
  const key = modelUrl(code);
  if (await cache.match(key)) return;
  const response = await fetch(key, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error('OCR download failed (' + response.status + '). Try again.');
  const bytes = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const hash = Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== entry.bytes || hash !== entry.sha256) throw Error('OCR download was incomplete or changed. Retry the download.');
  await cache.put(key, new Response(bytes));
}
