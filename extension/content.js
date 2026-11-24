// Content script for Manga Translator Pro (injected on demand, or registered for "Always translate" sites).
//
// Overlays live in one host element in the browser's top layer (popover="manual", closed shadow root),
// so page z-index, fullscreen, modal dialogs and transforms cannot cover them, and clicks pass through.
// Each overlay is anchored to the element under it (image, canvas, iframe) as fractions of that
// element's box, so it follows inner scrolling, zoom, resizing and fit-to-width layouts.
(() => {
  if (window.__mangaTranslatorInjected) return;
  window.__mangaTranslatorInjected = true;

  const R = globalThis.MTPRender;
  const isTop = window === window.top;
  const sampleMode = location.href === chrome.runtime.getURL('sample.html');
  let autoMode = false, siteAuto = false, showOriginal = false, busy = false, pendingAuto = false, pendingManual = false;
  let requestSeq = 0, current = null, imageSeq = 0, lastRun = null;
  const items = [];

  // ------------------------------------------------------------ host
  const host = document.createElement('mtp-layer');
  host.setAttribute('popover', 'manual');
  host.style.cssText = ['position:fixed', 'inset:0', 'width:auto', 'height:auto', 'margin:0', 'padding:0', 'border:0',
    'background:transparent', 'overflow:visible', 'pointer-events:none', 'display:block', 'z-index:2147483647',
    'visibility:visible', 'opacity:1', 'transform:none', 'filter:none'].map(d => d + ' !important').join(';');
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`:host { all: initial; }
    .layer { position:absolute; inset:0; overflow:hidden; pointer-events:none; }
    .layer.original { display:none; }
    .controls { position:fixed; right:24px; bottom:24px; display:flex; flex-direction:column; align-items:flex-end; gap:8px;
      font:600 13px/1.3 system-ui,sans-serif; pointer-events:none; }
    .controls button { pointer-events:auto; cursor:pointer; border:0; border-radius:999px; padding:10px 18px; color:#fff;
      background:linear-gradient(135deg,#2563eb,#4f46e5); box-shadow:0 4px 14px rgba(37,99,235,.35); font:inherit; }
    .controls button.secondary { background:#fff; color:#172033; border:1px solid #777; border-radius:12px; padding:8px 14px; box-shadow:none; }
    .controls button[data-busy="true"] { opacity:.75; cursor:progress; }
    .controls button[data-error="true"] { background:linear-gradient(135deg,#dc2626,#991b1b); }
    .toast { max-width:320px; padding:10px 14px; border-radius:8px; background:#0f172a; color:#fff; font-weight:400;
      opacity:0; transform:translateY(6px); transition:opacity .2s, transform .2s; }
    .toast[data-visible="true"] { opacity:1; transform:none; }
    .toast[data-kind="error"] { background:#991b1b; }
    [hidden] { display:none !important; }
    ${R.CSS}`);
  root.adoptedStyleSheets = [sheet];
  const layer = document.createElement('div');
  layer.className = 'layer';
  root.append(layer);

  let btn, compare, toast;
  if (isTop) {
    const controls = document.createElement('div');
    controls.className = 'controls';
    toast = document.createElement('div'); toast.className = 'toast';
    compare = document.createElement('button'); compare.className = 'secondary'; compare.hidden = true; compare.textContent = 'Show original';
    btn = document.createElement('button'); btn.textContent = 'Translate';
    controls.append(toast, compare, btn);
    root.append(controls);
    btn.addEventListener('click', () => translate({ incremental: false }));
    compare.addEventListener('click', () => setOriginal(!showOriginal));
  }

  // Mount on <html>; if the page keeps deleting it, mount inside the reader instead (the top layer ignores
  // ancestors' overflow, transforms and z-index). If even that fails, offer the snapshot view.
  let removals = [], strikes = 0, gaveUp = false;
  const fallbackMounts = () => [
    items.find(i => i.anchor.isConnected)?.anchor.parentElement,
    document.querySelector('main, #app, #root, #__next, [role="main"]'),
    document.body?.firstElementChild,
    document.body,
  ].filter(el => el && el !== host && !host.contains(el));
  const mountPoint = () => strikes < 3 ? document.documentElement
    : (fallbackMounts()[Math.floor((strikes - 3) / 3) % Math.max(1, fallbackMounts().length)] || document.documentElement);
  function raise() {
    if (gaveUp) return;
    if (!host.isConnected) mountPoint().appendChild(host);
    try { host.hidePopover(); } catch {}
    try { host.showPopover(); } catch {}
  }
  document.addEventListener('fullscreenchange', () => queueMicrotask(raise), true);
  document.addEventListener('toggle', e => { if (e.target !== host) queueMicrotask(raise); }, true);
  new MutationObserver(ms => {
    if (ms.some(m => m.type === 'attributes' && m.target.localName === 'dialog' && m.target.open)) queueMicrotask(raise);
    if (host.isConnected || gaveUp || (!items.length && !isTop)) return;
    const now = performance.now();
    removals = [...removals.filter(t => now - t < 2000), now];
    strikes++;
    if (removals.length < 20 || !items.length) raise();
    else {
      // The page keeps deleting our layer even inside its own content: show the snapshot view instead.
      gaveUp = true;
      if (isTop) chrome.runtime.sendMessage({ action: 'open_snapshot' }).catch(() => {});
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
  if (isTop) raise();

  // ------------------------------------------------------------ UI helpers
  let toastTimer, busyTimer;
  function showToast(message, kind = 'info', ms = 3500) {
    if (!toast) return;
    toast.textContent = message; toast.dataset.kind = kind; toast.dataset.visible = 'true';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.dataset.visible = 'false'; }, ms);
  }
  function setBusy(on) {
    if (!btn) return;
    btn.dataset.busy = String(on); btn.dataset.error = 'false';
    clearInterval(busyTimer);
    if (on) {
      const t0 = Date.now();
      btn.textContent = 'Translating… 0s';
      busyTimer = setInterval(() => { btn.textContent = `Translating… ${Math.floor((Date.now() - t0) / 1000)}s`; }, 1000);
    } else btn.textContent = 'Translate';
  }
  function setOriginal(on) {
    showOriginal = on;
    layer.classList.toggle('original', on);
    if (compare) compare.textContent = on ? 'Show translation' : 'Show original';
  }
  const updateCompare = () => { if (compare) compare.hidden = items.length === 0; };

  // ------------------------------------------------------------ overlays
  const contentTags = /^(img|picture|canvas|video|svg|iframe|object|embed)$/i;
  function snapshotAnchors() {
    const out = [];
    for (const el of document.querySelectorAll('img,picture,canvas,video,svg,iframe')) {
      const r = el.getBoundingClientRect();
      if (r.width >= 120 && r.height >= 120 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth) out.push({ el, rect: r });
    }
    return out;
  }
  function anchorFor(box, anchors) {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const inside = anchors.filter(a => cx >= a.rect.left && cx <= a.rect.right && cy >= a.rect.top && cy <= a.rect.bottom && a.el.isConnected)
      .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
    if (inside.length) return inside[0];
    const stack = document.elementsFromPoint(Math.min(innerWidth - 1, Math.max(0, cx)), Math.min(innerHeight - 1, Math.max(0, cy)))
      .filter(el => el !== host && el !== document.documentElement && el !== document.body);
    const el = stack.find(e => contentTags.test(e.localName)) || stack[0] || document.documentElement;
    return { el, rect: el.getBoundingClientRect() };
  }
  const relTo = (box, rect) => ({ x: (box.x - rect.left) / rect.width, y: (box.y - rect.top) / rect.height, w: box.w / rect.width, h: box.h / rect.height });

  function addItem(anchor, rel, result, key) {
    if (key && items.some(i => i.key === key)) return;
    // Drop near-duplicates on the same anchor (re-translation of an already covered bubble).
    if (items.some(i => i.anchor === anchor && overlapRel(i.rel, rel) > 0.5)) return;
    const el = R.createOverlay(result);
    layer.appendChild(el);
    items.push({ el, anchor, rel, key, w: 0, h: 0 });
    resizeObserver.observe(anchor);
    raise();
    updateCompare();
    schedule();
  }
  function overlapRel(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? (w * h) / Math.min(a.w * a.h, b.w * b.h) : 0;
  }
  function clearOverlays() {
    for (const i of items.splice(0)) i.el.remove();
    resizeObserver.disconnect();
    setOriginal(false);
    updateCompare();
  }

  function place() {
    const zoom = host.currentCSSZoom || 1;
    const rects = items.map(i => (i.anchor.isConnected ? i.anchor.getBoundingClientRect() : null));
    items.forEach((i, k) => {
      const a = rects[k];
      const visible = a && a.width > 0 && a.height > 0;
      i.el.hidden = !visible;
      if (!visible) return;
      const left = a.left + i.rel.x * a.width, top = a.top + i.rel.y * a.height;
      const w = i.rel.w * a.width, h = i.rel.h * a.height;
      if (top > innerHeight + 200 || top + h < -200) { i.el.hidden = true; return; }
      R.layout(i.el, left / zoom, top / zoom, w / zoom, h / zoom);
      if (Math.abs(w - i.w) > 2 || Math.abs(h - i.h) > 2) { i.w = w; i.h = h; R.fitText(i.el); }
    });
  }
  let frame = 0, settleUntil = 0;
  function schedule() {
    settleUntil = performance.now() + 400;
    if (frame) return;
    const tick = () => {
      frame = 0;
      if (items.length) place();
      if (performance.now() < settleUntil) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }
  const resizeObserver = new ResizeObserver(schedule);
  addEventListener('resize', schedule);
  visualViewport?.addEventListener('resize', schedule);
  setInterval(() => { if (items.length && !document.hidden) place(); }, 1000); // catches silent layout changes

  // ------------------------------------------------------------ drawing results
  const plausible = box => box.w >= 8 && box.h >= 8 && box.w * box.h <= innerWidth * innerHeight * 0.4 &&
    !(box.w > innerWidth * 0.7 && box.h > innerHeight * 0.7);

  // A result from a viewport capture: image px → CSS px at capture time → anchored element.
  async function drawCaptureResult(r, req) {
    if (![r.x, r.y, r.w, r.h].every(Number.isFinite)) return;
    const box = { x: r.x / req.dpr, y: r.y / req.dpr, w: r.w / req.dpr, h: r.h / req.dpr };
    if (!plausible(box)) return;
    const key = `c${req.requestId}:${r.id ?? `${r.x},${r.y}`}`;
    if (req.drawn.has(key)) return;
    req.drawn.add(key);
    const a = anchorFor(box, req.anchors);
    if (isTop && a.el.localName === 'iframe' && a.el.src) {
      const frameBox = { x: box.x - a.rect.left - a.el.clientLeft, y: box.y - a.rect.top - a.el.clientTop, w: box.w, h: box.h };
      const ok = await chrome.runtime.sendMessage({ action: 'draw_in_frame', src: a.el.src, box: frameBox, result: r, key }).catch(() => null);
      if (ok?.ok) return;
    }
    addItem(a.el, relTo(box, a.rect), r, key);
  }

  // A result from a source image: natural image px → fractions of the <img>.
  function drawImageResult(img, r) {
    if (!img?.isConnected || !img.naturalWidth) return;
    addItem(img, { x: r.x / img.naturalWidth, y: r.y / img.naturalHeight, w: r.w / img.naturalWidth, h: r.h / img.naturalHeight }, r, `i:${img.dataset.mtpKey}:${r.id}`);
  }

  // ------------------------------------------------------------ source images (read-ahead)
  const imageState = new WeakMap(), imageByKey = new Map(), failedHosts = new Set();
  let sourceUnsupported = false;
  function isMangaImage(img) {
    if (!img.complete || img.naturalWidth < 400 || img.naturalHeight < 400) return false;
    const r = img.getBoundingClientRect();
    if (r.width < 200 || r.height < 200) return false;
    try { const u = new URL(img.currentSrc || img.src); return /^https?:$/.test(u.protocol) && !failedHosts.has(u.host); } catch { return false; }
  }
  function translateImage(img, priority = 0) {
    if (sourceUnsupported) return Promise.resolve(false);
    const state = imageState.get(img);
    if (state) return state;
    const key = img.dataset.mtpKey || `${Date.now().toString(36)}${++imageSeq}`;
    img.dataset.mtpKey = key;
    imageByKey.set(key, img);
    const url = img.currentSrc || img.src;
    const promise = chrome.runtime.sendMessage({ action: 'translate_source_image', url, width: img.naturalWidth, height: img.naturalHeight, imageKey: key, priority })
      .then(res => {
        if (!res || res.error) {
          if (res?.error === 'unsupported') sourceUnsupported = true;
          else try { failedHosts.add(new URL(url).host); } catch {}
          imageState.delete(img);
          return false;
        }
        for (const r of res.results || []) drawImageResult(img, r);
        return true;
      })
      .catch(() => { imageState.delete(img); return false; });
    imageState.set(img, promise);
    return promise;
  }
  const readAhead = new IntersectionObserver(entries => {
    if (!(autoMode || siteAuto)) return;
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target, priority = Math.max(0, e.boundingClientRect.top);
      // Lazy-loaded images are often still empty when they come near the screen.
      if (!img.complete) img.addEventListener('load', () => { if (isMangaImage(img)) translateImage(img, priority); }, { once: true });
      else if (isMangaImage(img)) translateImage(img, priority);
    }
  }, { rootMargin: '0px 0px 150% 0px' });
  const observed = new WeakSet();
  function observeImages() {
    for (const img of document.images) if (!observed.has(img)) { observed.add(img); readAhead.observe(img); }
  }

  // ------------------------------------------------------------ translation
  const toImagePx = (r, dpr) => ({ x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: r.height * dpr });

  async function translate({ incremental = false } = {}) {
    if (!isTop) return;
    if (busy) { if (incremental) pendingAuto = true; else pendingManual = true; return; }
    busy = true; setBusy(true);
    if (!incremental) clearOverlays();
    const dpr = window.devicePixelRatio || 1;
    const req = current = { requestId: ++requestSeq, dpr, anchors: [], drawn: new Set() };
    try {
      if (sampleMode) {
        const results = [...document.querySelectorAll('[data-translation]')].map((b, id) => {
          const r = b.getBoundingClientRect();
          return { id, x: r.x * dpr, y: r.y * dpr, w: r.width * dpr, h: r.height * dpr, text: b.dataset.translation, shape: 'ellipse', automatic: true };
        });
        req.anchors = snapshotAnchors();
        for (const r of results) await drawCaptureResult(r, req);
        showToast(`Translated ${results.length} text regions.`);
        return;
      }
      // 1. Visible manga images through the source-image path (exact pixels, cached, no capture).
      const visible = [...document.images].filter(img => { const r = img.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && isMangaImage(img); });
      const handled = (await Promise.all(visible.map(img => translateImage(img, 0).then(ok => (ok ? img : null))))).filter(Boolean);
      // 2. Everything else through a viewport capture, skipping translated areas and our own controls.
      const zones = [...handled.map(img => img.getBoundingClientRect()),
        ...items.filter(i => !i.el.hidden).map(i => i.el.getBoundingClientRect()),
        ...(btn ? [btn.parentElement.getBoundingClientRect()] : [])];
      const coveredByImages = handled.reduce((s, img) => { const r = img.getBoundingClientRect(); return s + Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)); }, 0);
      if (!handled.length || coveredByImages < innerWidth * innerHeight * 0.5) {
        // Let removed overlays leave the screen before Chrome grabs the frame.
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        req.anchors = snapshotAnchors();
        const res = await chrome.runtime.sendMessage({ action: 'capture_and_translate', requestId: req.requestId, dpr, exclude: zones.map(z => toImagePx(z, dpr)) });
        if (res?.error === 'busy') { pendingAuto = true; return; }
        if (!res || res.error) throw new Error(res?.error || 'No response from the extension.');
        lastRun = { captured: res.results?.length || 0, excluded: zones.length };
        for (const r of res.results || []) await drawCaptureResult(r, req);
      }
      if (!incremental) showToast(items.length ? `Translated ${items.length} text region${items.length === 1 ? '' : 's'}.` : 'No usable text regions in the visible area.');
    } catch (err) {
      if (btn) { btn.dataset.error = 'true'; }
      lastRun = { error: err.message || String(err) };
      showToast(err.message || String(err), 'error', 6000);
    } finally {
      busy = false;
      clearInterval(busyTimer);
      if (btn) { btn.dataset.busy = 'false'; btn.textContent = btn.dataset.error === 'true' ? 'Retry' : 'Translate'; }
      if (pendingManual) { pendingManual = pendingAuto = false; setTimeout(() => translate({ incremental: false })); }
      else if (pendingAuto) { pendingAuto = false; scheduleAuto(); }
    }
  }

  // Auto mode: translate newly visible content after any scroll container settles.
  let autoTimer;
  function scheduleAuto(delay = 350) {
    if (!(autoMode || siteAuto) || !isTop) return;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => translate({ incremental: true }), delay);
  }
  document.addEventListener('scroll', () => { schedule(); scheduleAuto(); }, { capture: true, passive: true });
  document.addEventListener('scrollend', () => scheduleAuto(60), { capture: true, passive: true });

  // ------------------------------------------------------------ messages + settings
  chrome.runtime.onMessage.addListener((request, _sender, respond) => {
    switch (request.action) {
      case 'page_translation_status':
        if (busy) showToast(request.message, 'info', 10000);
        return;
      case 'page_translation_result':
        if (request.imageKey) drawImageResult(imageByKey.get(request.imageKey), request.result);
        else if (current && request.requestId === current.requestId) drawCaptureResult(request.result, current);
        return;
      case 'draw_in_frame': {
        if (isTop || request.src !== location.href) return;
        const a = anchorFor(request.box, snapshotAnchors());
        addItem(a.el, relTo(request.box, a.rect), request.result, request.key);
        respond({ ok: true });
        return;
      }
      case 'trigger_from_popup': translate({ incremental: false }); respond?.({ ok: true }); return;
      case 'clear_overlays': clearOverlays(); respond?.({ ok: true }); return;
      case 'toggle_original': setOriginal(!showOriginal); respond?.({ ok: true, showOriginal }); return;
      case 'auto_changed': loadSettings(); respond?.({ ok: true }); return;
      case 'overlay_state': respond({ ok: true, items: items.length, showOriginal, busy: busy || pendingManual, lastRun,
        debug: request.debug ? items.map(i => ({ tag: i.anchor.localName, cls: i.anchor.className?.baseVal ?? i.anchor.className, rel: i.rel, box: i.el.style.cssText })) : undefined }); return;
    }
  });

  async function loadSettings() {
    const { autoMode: a = false, autoSites = [] } = await chrome.storage.local.get(['autoMode', 'autoSites']);
    const wasAuto = autoMode || siteAuto;
    autoMode = !!a;
    siteAuto = autoSites.includes(location.origin);
    if (autoMode || siteAuto) observeImages();
    if (!wasAuto && (autoMode || siteAuto)) scheduleAuto(800);
  }
  chrome.storage.onChanged.addListener(changes => { if (changes.autoMode || changes.autoSites) loadSettings(); });
  loadSettings();
  if (isTop) new MutationObserver(() => { if (autoMode || siteAuto) observeImages(); }).observe(document.documentElement, { childList: true, subtree: true });

  fetch(chrome.runtime.getURL('build-info.json')).then(r => r.json()).then(info => {
    if (isTop) console.log(`%c[MangaTranslator] ready · v${info.version} · build ${info.buildId}`, 'color:#2563eb;font-weight:bold');
    if (btn) btn.title = `Manga Translator Pro v${info.version}\nBuild: ${info.buildId}\nShortcut: Alt+Shift+T`;
  }).catch(() => {});
})();
