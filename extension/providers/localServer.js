// Local server provider — calls the FastAPI Python backend in /server.

export async function translateWithLocalServer(base64Image, settings) {
  const url = (settings.localServerUrl || 'http://localhost:8001').replace(/\/$/, '');
  const response = await fetch(`${url}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Local server returned ${response.status}: ${errText || response.statusText}. ` +
      `Is the FastAPI server running at ${url}?`
    );
  }
  const data = await response.json();
  const results = data.results || [];
  return results.map((item) => ({
    x: Math.round(Number(item.x ?? 0)),
    y: Math.round(Number(item.y ?? 0)),
    w: Math.round(Number(item.w ?? 0)),
    h: Math.round(Number(item.h ?? 0)),
    text: String(item.text ?? '').trim(),
  })).filter((item) => item.text && item.w > 0 && item.h > 0);
}

export async function testLocalServer(settings) {
  const url = (settings.localServerUrl || 'http://localhost:8001').replace(/\/$/, '');
  try {
    const res = await fetch(`${url}/health`);
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();
    return {
      ok: true, serverReachable: true,
      message: `Local server OK. ${data.detector || ''} ${data.ocr || ''} ${data.translator || ''}`.trim(),
      details: data,
    };
  } catch (e) {
    throw new Error(`Cannot reach local server at ${url}. Start it with: cd server && uvicorn app:app --port 8001`);
  }
}
