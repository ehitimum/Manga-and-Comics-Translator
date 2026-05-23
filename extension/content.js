// Content script for Manga Translator Pro.
//
// Injected on-demand by background.js (via chrome.scripting.executeScript).
// Adds a floating "Translate" button to the page and draws translated text
// overlays on top of detected manga bubbles.

(() => {
  if (window.__mangaTranslatorInjected) return;
  window.__mangaTranslatorInjected = true;

  // -----------------------------------------------------
  // State
  // -----------------------------------------------------
  let autoMode = false;
  let scrollTimer = null;
  let lastResults = [];
  let lastDpr = window.devicePixelRatio || 1;
  let lastViewportScroll = { x: window.scrollX, y: window.scrollY };

  chrome.storage.local.get(['autoMode'], (r) => { autoMode = !!r.autoMode; });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.autoMode) autoMode = !!changes.autoMode.newValue;
  });

  // -----------------------------------------------------
  // Inject styles (scoped via prefix to avoid clashes)
  // -----------------------------------------------------
  const STYLE_ID = 'manga-translator-styles';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #mtp-btn {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 18px;
        background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%);
        color: #fff;
        font-family: system-ui, -apple-system, sans-serif;
        font-weight: 600;
        font-size: 14px;
        line-height: 1;
        border-radius: 999px;
        box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35), 0 2px 4px rgba(0,0,0,0.1);
        cursor: pointer;
        user-select: none;
        transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
      }
      #mtp-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(37, 99, 235, 0.45); }
      #mtp-btn:active { transform: translateY(0); }
      #mtp-btn[data-busy="true"] { opacity: 0.75; cursor: progress; pointer-events: none; }
      #mtp-btn[data-error="true"] {
        background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%);
      }

      #mtp-btn .mtp-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #facc15; box-shadow: 0 0 6px #facc15;
      }
      #mtp-btn[data-busy="true"] .mtp-dot { animation: mtp-pulse 0.9s ease-in-out infinite; }
      @keyframes mtp-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.3; transform: scale(0.7); }
      }

      .mtp-overlay {
        position: absolute;
        z-index: 2147483645;
        background: #ffffff;
        color: #0f172a;
        border: 1.5px solid rgba(0, 0, 0, 0.55);
        border-radius: 50% / 40%;
        padding: 8px 10px;
        font-family: 'Wild Words', 'Comic Sans MS', system-ui, sans-serif;
        font-weight: 700;
        font-size: 13px;
        text-align: center;
        line-height: 1.2;
        word-wrap: break-word;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        pointer-events: auto;
        cursor: text;
      }

      #mtp-toast {
        position: fixed;
        bottom: 80px;
        right: 24px;
        z-index: 2147483647;
        max-width: 320px;
        padding: 12px 16px;
        background: #0f172a;
        color: #fff;
        font-family: system-ui, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.25);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.2s, transform 0.2s;
        pointer-events: none;
      }
      #mtp-toast[data-visible="true"] { opacity: 1; transform: translateY(0); }
      #mtp-toast[data-kind="error"] { background: #991b1b; }
    `;
    document.head.appendChild(style);
  }

  // -----------------------------------------------------
  // UI: floating button + toast
  // -----------------------------------------------------
  const btn = document.createElement('div');
  btn.id = 'mtp-btn';
  btn.innerHTML = `<span class="mtp-dot"></span><span class="mtp-label">Translate</span>`;
  document.body.appendChild(btn);

  const toast = document.createElement('div');
  toast.id = 'mtp-toast';
  document.body.appendChild(toast);

  function showToast(message, kind = 'info', durationMs = 3500) {
    toast.textContent = message;
    toast.dataset.kind = kind;
    toast.dataset.visible = 'true';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      toast.dataset.visible = 'false';
    }, durationMs);
  }

  let busyTimer = null;
  function setBusy(busy, label = null) {
    btn.dataset.busy = busy ? 'true' : 'false';
    const labelEl = btn.querySelector('.mtp-label');
    if (busyTimer) { clearInterval(busyTimer); busyTimer = null; }
    if (busy) {
      const startedAt = Date.now();
      labelEl.textContent = label || 'Translating… 0s';
      busyTimer = setInterval(() => {
        const sec = Math.floor((Date.now() - startedAt) / 1000);
        labelEl.textContent = `Translating… ${sec}s`;
      }, 1000);
    } else {
      labelEl.textContent = label || 'Translate';
    }
  }

  function setError(msg) {
    btn.dataset.error = 'true';
    btn.querySelector('.mtp-label').textContent = 'Retry';
    showToast(msg, 'error', 6000);
    setTimeout(() => {
      btn.dataset.error = 'false';
      btn.querySelector('.mtp-label').textContent = 'Translate';
    }, 6000);
  }

  // -----------------------------------------------------
  // Translation flow
  // -----------------------------------------------------
  async function triggerTranslation() {
    if (btn.dataset.busy === 'true') return;
    setBusy(true);
    clearOverlays();

    lastDpr = window.devicePixelRatio || 1;
    lastViewportScroll = { x: window.scrollX, y: window.scrollY };

    chrome.runtime.sendMessage({ action: 'capture_and_translate' }, (response) => {
      setBusy(false);
      if (chrome.runtime.lastError) {
        setError(chrome.runtime.lastError.message || 'Extension messaging failed');
        return;
      }
      if (!response) {
        setError('No response from background. Try reloading the extension.');
        return;
      }
      if (response.error) {
        setError(response.error);
        return;
      }
      const results = response.results || [];
      lastResults = results;
      // Clamp coordinates to the captured viewport size
      const viewportWidth = window.innerWidth * lastDpr;
      const viewportHeight = window.innerHeight * lastDpr;
      const clamped = results.map(r => ({
        ...r,
        x: Math.min(Math.max(r.x, 0), viewportWidth),
        y: Math.min(Math.max(r.y, 0), viewportHeight),
        w: Math.min(r.w, viewportWidth - r.x),
        h: Math.min(r.h, viewportHeight - r.y),
      })).filter(r => r.w > 5 && r.h > 5);
      drawOverlays(clamped);

      if (clamped.length === 0) {   // use clamped length, not results
        showToast('No Japanese text found in the visible area.', 'info');
      } else {
        showToast(`Translated ${clamped.length} text region${clamped.length === 1 ? '' : 's'}.`, 'info', 2000);
      }
    });
  }

  btn.addEventListener('click', triggerTranslation);

  // Allow popup or background to trigger translation
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'trigger_from_popup') {
      triggerTranslation();
      sendResponse({ ok: true });
    } else if (request.action === 'clear_overlays') {
      clearOverlays();
      sendResponse({ ok: true });
    }
    return true;
  });

  // -----------------------------------------------------
  // Overlay drawing
  // Coordinates from the provider are in IMAGE pixels (PNG-space).
  // captureVisibleTab returns a PNG scaled by devicePixelRatio.
  // We convert: cssPixels = imagePixels / dpr, then add the scroll
  // offset captured at the moment of capture (NOT current scroll).
  // -----------------------------------------------------
  function drawOverlays(results) {
    clearOverlays();
    if (!results || results.length === 0) return;

    const dpr = lastDpr;
    const scrollX = lastViewportScroll.x;
    const scrollY = lastViewportScroll.y;
    const contentBounds = detectContentBounds();

    for (const item of results) {
      let cssLeft = item.x / dpr + scrollX;
      const cssTop = item.y / dpr + scrollY;
      let cssWidth = item.w / dpr;
      const cssHeight = item.h / dpr;

      // Skip bogus boxes. Two failure modes to reject:
      //   1. Tiny / zero-size boxes (model hallucination).
      //   2. Full-image fallback boxes — both width AND height huge.
      // Long vertical recap columns are tall but very narrow, so we use AND
      // (not OR) on the dimension check to let them through.
      if (cssWidth < 8 || cssHeight < 8) continue;
      if (cssWidth > window.innerWidth * 0.7 && cssHeight > window.innerHeight * 0.7) {
        console.warn('[MangaTranslator] skipping full-page overlay', cssWidth, cssHeight);
        continue;
      }
      const viewportArea = window.innerWidth * window.innerHeight;
      if (cssWidth * cssHeight > viewportArea * 0.4) {
        console.warn('[MangaTranslator] skipping overlay covering >40% of viewport');
        continue;
      }

      // Nudge boxes that land in the dark page margins (Gemini left/right spatial bias).
      // Only correct if the misplacement is small (<= 100px) — large errors are skipped.
      if (contentBounds) {
        const TOL = 100;
        if (cssLeft < contentBounds.left && contentBounds.left - cssLeft <= TOL) {
          cssLeft = contentBounds.left;
        }
        const cssRight = cssLeft + cssWidth;
        if (cssRight > contentBounds.right && cssRight - contentBounds.right <= TOL) {
          if (cssLeft >= contentBounds.right) {
            cssLeft = Math.max(contentBounds.left, contentBounds.right - cssWidth);
          } else {
            cssWidth = contentBounds.right - cssLeft;
          }
        }
      }

      const el = document.createElement('div');
      el.className = 'mtp-overlay';
      el.textContent = item.text;
      el.style.left = `${cssLeft}px`;
      el.style.top = `${cssTop}px`;
      el.style.width = `${cssWidth}px`;
      el.style.height = `${cssHeight}px`;
      el.style.fontSize = `${computeFontSize(cssWidth, cssHeight, item.text)}px`;
      el.title = item.text; // tooltip for long text
      document.body.appendChild(el);
    }
  }

  function clearOverlays() {
    document.querySelectorAll('.mtp-overlay').forEach((el) => el.remove());
  }

  /**
   * Heuristic: pick a font size that fits the text in the bubble.
   * Manga bubbles are usually wider than tall; we estimate area-per-character.
   */
  function computeFontSize(width, height, text) {
    const len = Math.max(1, text.length);
    const area = width * height;
    // 0.5x area-per-char ≈ reasonable readability budget
    const px = Math.sqrt((area * 0.45) / len);
    return Math.max(10, Math.min(22, Math.round(px)));
  }

  // Returns the document-coordinate left/right bounds of large images currently
  // in the viewport. Used to detect the manga content area vs. dark page margins.
  function detectContentBounds() {
    const large = [...document.querySelectorAll('img')].filter((img) => {
      const r = img.getBoundingClientRect();
      return r.width > 100 && r.height > 100 && r.top < window.innerHeight && r.bottom > 0;
    });
    if (!large.length) return null;
    let minLeft = Infinity, maxRight = -Infinity;
    for (const img of large) {
      const r = img.getBoundingClientRect();
      minLeft = Math.min(minLeft, r.left + window.scrollX);
      maxRight = Math.max(maxRight, r.right + window.scrollX);
    }
    return Number.isFinite(minLeft) ? { left: minLeft, right: maxRight } : null;
  }

  // -----------------------------------------------------
  // Auto-mode: re-translate after scrolling stops
  // -----------------------------------------------------
  window.addEventListener('scroll', () => {
    if (!autoMode) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(triggerTranslation, 1500);
  }, { passive: true });

  // Reposition overlays on resize (re-fitting to new viewport without re-translating)
  window.addEventListener('resize', () => {
    // Resize invalidates pixel-space coordinates; safer to clear and let
    // the user re-translate.
    if (lastResults.length > 0) {
      clearOverlays();
      showToast('Window resized — click Translate to redraw.', 'info', 2500);
    }
  });

  // Log build info so the user can verify from DevTools which build is running
  fetch(chrome.runtime.getURL('build-info.json'))
    .then((r) => r.json())
    .then((info) => {
      console.log(
        `%c[MangaTranslator] content script ready · v${info.version} · build ${info.buildId}`,
        'color:#2563eb;font-weight:bold',
      );
      btn.title = `Manga Translator Pro v${info.version}\nBuild: ${info.buildId}`;
    })
    .catch(() => console.log('[MangaTranslator] content script ready (build-info unavailable)'));
})();
