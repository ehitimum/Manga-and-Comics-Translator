// Shows the last capture of a tab with its translations. The page being translated cannot touch this view.
(async () => {
  const R = globalThis.MTPRender;
  const style = document.createElement('style');
  style.textContent = R.CSS;
  document.head.append(style);
  const tab = new URLSearchParams(location.search).get('tab');
  const key = 'snapshot:' + tab;
  const { [key]: snap } = await chrome.storage.session.get(key);
  const info = document.getElementById('info'), img = document.getElementById('shot'), stage = document.getElementById('stage');
  if (!snap) { info.textContent = 'No snapshot. Translate the page first.'; return; }
  info.textContent = `${snap.results.length} translation${snap.results.length === 1 ? '' : 's'} · ${snap.url || ''}`;
  img.src = snap.image;
  await img.decode();
  const overlays = snap.results.map(r => { const el = R.createOverlay(r); stage.append(el); return { el, r }; });
  const layout = () => {
    const k = img.clientWidth / img.naturalWidth;
    for (const { el, r } of overlays) {
      R.layout(el, r.x * k, r.y * k, r.w * k, r.h * k);
      R.fitText(el);
    }
  };
  layout();
  addEventListener('resize', layout);
  document.getElementById('toggle').onclick = e => {
    const on = stage.classList.toggle('original');
    e.target.textContent = on ? 'Show translation' : 'Show original';
  };
  // The capture is not kept once this view closes.
  addEventListener('pagehide', () => chrome.storage.session.remove(key));
})();
