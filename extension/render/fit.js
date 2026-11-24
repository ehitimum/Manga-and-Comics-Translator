// Shared overlay rendering for the content script and the snapshot view (classic script, no imports).
(() => {
  if (globalThis.MTPRender) return;

  // Largest size in [min, max] for which fits(size) holds (fits must be monotonic). Mirrors engine/geometry.js.
  function fitFontSize(fits, min = 9, max = 28) {
    let lo = min, hi = max, best = min;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (fits(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  }

  // Fit an overlay's text to its box. Needs the element laid out (in the document).
  function fitText(el, { min = 9, max = 28 } = {}) {
    const limit = Math.max(min, Math.min(max, Math.floor(el.clientHeight * 0.6)));
    const fits = size => {
      el.style.fontSize = size + 'px';
      return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    };
    const size = fitFontSize(fits, min, limit);
    el.style.fontSize = size + 'px';
    el.classList.toggle('mtp-tight', !fits(size));
    el.style.fontSize = size + 'px';
    return size;
  }

  // Size an overlay and fit its text. Padding is set in px from the box itself: CSS percentages would
  // resolve against the full-viewport layer and blow the box up.
  function layout(el, left, top, width, height) {
    const ellipse = el.classList.contains('mtp-ellipse');
    const px = ellipse ? width * 0.13 : Math.min(6, width * 0.06), py = ellipse ? height * 0.15 : Math.min(4, height * 0.06);
    Object.assign(el.style, { left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px', padding: `${py}px ${px}px` });
  }

  function createOverlay(item, doc = document) {
    const el = doc.createElement('div');
    el.className = 'mtp-o ' + (item.shape === 'ellipse' ? 'mtp-ellipse' : 'mtp-rect') + (item.dark ? ' mtp-dark' : '') + (item.automatic ? '' : ' mtp-provider');
    el.lang = 'en';
    el.textContent = item.text;
    el.title = item.source ? `${item.text}\n\n${item.source}` : item.text;
    return el;
  }

  const CSS = `
    .mtp-o { position:absolute; box-sizing:border-box; display:flex; align-items:center; justify-content:center;
      text-align:center; margin:0; overflow:hidden; pointer-events:none; background:#fff; color:#111;
      font:700 14px/1.12 "Comic Neue","Wild Words","Comic Sans MS","Segoe UI",system-ui,sans-serif;
      text-wrap:balance; hyphens:auto; overflow-wrap:anywhere; writing-mode:horizontal-tb; letter-spacing:0;
      text-transform:none; text-shadow:none; }
    .mtp-ellipse { border-radius:50%; }
    .mtp-rect { border-radius:3px; }
    .mtp-dark { background:#0b0b0b; color:#fff; }
    .mtp-provider { border:1.5px solid rgba(0,0,0,.55); }
    .mtp-tight { overflow-wrap:anywhere; word-break:break-all; }
  `;

  globalThis.MTPRender = { CSS, fitFontSize, fitText, createOverlay, layout };
})();
