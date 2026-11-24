// End-to-end checks in Chromium (Playwright). Run after `npm run build`.
//   node tests/e2e/run.mjs            engine accuracy + extension suites
//   node tests/e2e/run.mjs --bench    engine benchmark only (timings + accuracy)
//   node tests/e2e/run.mjs --accurate also download and exercise Accurate mode (19 MB)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIX = path.join(ROOT, 'tests/e2e/fixtures');
const CACHE = path.join(ROOT, 'tests/.cache');
const args = new Set(process.argv.slice(2));
const failures = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures.push(name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------ tessdata (pinned, verified)
async function tessdata() {
  const src = fs.readFileSync(path.join(ROOT, 'extension/reader/models.js'), 'utf8');
  const rev = src.match(/modelRevision = '([0-9a-f]+)'/)[1];
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [, code, sha] of src.matchAll(/(jpn(?:_vert)?): \{ bytes: \d+, sha256: '([0-9a-f]+)'/g)) {
    const file = path.join(CACHE, `${code}.traineddata`);
    if (!fs.existsSync(file)) {
      const res = await fetch(`https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${rev}/${code}.traineddata`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    const got = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (got !== sha) { fs.rmSync(file); throw Error(`${code}.traineddata checksum mismatch`); }
  }
}

// ------------------------------------------------------------ static server
const generated = new Map();
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.png': 'image/png', '.wasm': 'application/wasm' };
function serve(port, extraRoutes = {}) {
  const routes = { '/ext/': path.join(ROOT, 'extension'), '/fixtures/': FIX, '/cache/': CACHE, ...extraRoutes };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (generated.has(url)) { const g = generated.get(url); return res.writeHead(200, { 'content-type': g.type, ...(g.headers || {}) }).end(g.body); }
    const prefix = Object.keys(routes).find(p => url.startsWith(p));
    if (!prefix) return res.writeHead(404).end();
    const file = path.join(routes[prefix], url.slice(prefix.length));
    if (!file.startsWith(routes[prefix])) return res.writeHead(403).end();
    fs.readFile(file, (err, buf) => err ? res.writeHead(404).end() : res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(buf));
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

// ------------------------------------------------------------ scoring
const norm = s => s.normalize('NFKC').replace(/[\s、。，．！？!?…「」『』・ー〜~.,:;'"()（）`\-]/gu, '');
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
function score(results, gt) {
  const inside = (r, g) => { const cx = r.x + r.w / 2, cy = r.y + r.h / 2; return cx >= g.x && cx <= g.x + g.w && cy >= g.y && cy <= g.y + g.h; };
  const visible = gt.filter(g => g.full);
  const sims = visible.map(g => {
    const text = results.filter(r => inside(r, g)).map(r => r.text).join('');
    const a = norm(g.text), b = norm(text);
    return Math.max(0, 1 - lev(a, b) / Math.max(a.length, b.length));
  });
  return { mean: sims.reduce((s, v) => s + v, 0) / sims.length, read: sims.filter(v => v >= 0.8).length, of: visible.length,
    fp: results.filter(r => !gt.some(g => inside(r, g))).length };
}

async function capturePage(browser, port, dpr) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
  await p.goto(`http://127.0.0.1:${port}/fixtures/manga-page.html`);
  await p.evaluate(() => document.fonts.ready);
  const png = await p.screenshot();
  const gt = await p.evaluate(dpr => [...document.querySelectorAll('[data-gt]')].map(el => {
    const r = el.getBoundingClientRect();
    const full = el.classList.contains('bubble') && r.bottom <= innerHeight && r.top >= 0;
    return { text: el.dataset.gt, full, x: r.left * dpr, y: r.top * dpr, w: r.width * dpr, h: Math.min(r.height, innerHeight - r.top) * dpr };
  }), dpr);
  await p.close();
  return { png, gt };
}

// ------------------------------------------------------------ 1. engine benchmark
async function engineBench(browser, port) {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('[bench page error]', e.message));
  await page.goto(`http://127.0.0.1:${port}/fixtures/bench.html`);
  await page.waitForFunction(() => window.benchReady === true);
  const t0 = Date.now();
  await page.evaluate(() => engineBench.warm());
  console.log(`  warm-up: ${Date.now() - t0} ms`);
  for (const dpr of [2, 1]) {
    const { png, gt } = await capturePage(browser, port, dpr);
    if (dpr === 1) generated.set('/gen/page-dpr1.png', { type: 'image/png', body: png });
    const image = 'data:image/png;base64,' + png.toString('base64');
    let best = null;
    for (let i = 0; i < 3; i++) { const r = await page.evaluate(img => engineBench.run(img), image); if (!best || r.total < best.total) best = r; }
    const s = score(best.results, gt);
    const t = Object.entries(best.t).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ');
    console.log(`  DPR ${dpr}: OCR stage ${Math.round(best.total)} ms (first ${Math.round(best.first)} ms; ${t}); ${best.crops}/${best.candidates} candidates OCR'd; read ${s.read}/${s.of}, mean ${s.mean.toFixed(2)}, false positives ${s.fp}`);
    check(`engine DPR ${dpr}: fully visible bubbles similarity ≥ 0.9`, s.mean >= 0.9, s.mean.toFixed(2));
    check(`engine DPR ${dpr}: no false positives`, s.fp === 0, String(s.fp));
    check(`engine DPR ${dpr}: warm OCR stage ≤ 1500 ms`, best.total <= 1500, `${Math.round(best.total)} ms`);
  }
  await page.evaluate(() => engineBench.close());
  await page.close();
}

// ------------------------------------------------------------ 2. extension suites
const BOXES = [{ x: 100, y: 100, w: 220, h: 130 }, { x: 520, y: 320, w: 220, h: 130 }];
const bubbleCss = (k = 1) => BOXES.map((b, i) => `.b${i}{position:absolute;left:${b.x / k}px;top:${b.y / k}px;width:${b.w / k}px;height:${b.h / k}px;background:#ff00ff;border-radius:10px}`).join('');
const bubbles = '<div class="b0" id="b0"></div><div class="b1" id="b1"></div>';
const hostile = {
  baseline: `<style>body{margin:0;height:2000px;background:#ddd}${bubbleCss()}</style>${bubbles}`,
  csp: `<link rel="stylesheet" href="/gen/csp.css">${bubbles}`,
  zindex: `<style>body{margin:0}.r{position:fixed;inset:0;z-index:2147483647;background:#333}${bubbleCss()}</style><div class="r">${bubbles}</div>`,
  dialog: `<style>body{margin:0}dialog{position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:#333}${bubbleCss()}</style><dialog id="d">${bubbles}</dialog><script src="/gen/dialog.js"></script>`,
  popover: `<style>body{margin:0}#p{position:fixed;inset:0;width:100vw;height:100vh;margin:0;padding:0;border:0;background:#333}${bubbleCss()}</style><div id="p" popover="manual">${bubbles}</div><script src="/gen/popover.js"></script>`,
  fullscreen: `<style>body{margin:0}#r{position:relative;width:100vw;height:100vh;background:#333}${bubbleCss()}</style><div id="r">${bubbles}</div><button id="fs" style="position:fixed;left:0;bottom:0">fs</button><script src="/gen/fs.js"></script>`,
  scroller: `<style>html,body{margin:0;height:100%;overflow:hidden}.s{position:fixed;inset:0;overflow:auto;background:#ddd}.c{position:relative;height:3000px}${bubbleCss()}</style><div class="s" id="s"><div class="c">${bubbles}</div></div>`,
  remover: `<style>body{margin:0;background:#ddd}${bubbleCss()}</style><div data-app>${bubbles}</div><script src="/gen/remover.js"></script>`,
  clickthrough: `<style>body{margin:0;background:#ddd}${bubbleCss()}</style>${bubbles}<script src="/gen/click.js"></script>`,
  zoom: `<style>html{zoom:1.25}body{margin:0;background:#ddd}${bubbleCss(1.25)}</style>${bubbles}`,
  iframe: `<style>body{margin:0}iframe{position:fixed;inset:0;width:100vw;height:100vh;border:0}</style><iframe src="http://127.0.0.1:8772/frame.html"></iframe>`,
};
function registerHostileAssets() {
  const js = body => ({ type: 'text/javascript', body });
  generated.set('/gen/csp.css', { type: 'text/css', body: `body{margin:0;background:#ddd}${bubbleCss()}` });
  generated.set('/gen/dialog.js', js(`document.getElementById('d').showModal();`));
  generated.set('/gen/popover.js', js(`document.getElementById('p').showPopover();`));
  generated.set('/gen/fs.js', js(`document.getElementById('fs').onclick=()=>document.getElementById('r').requestFullscreen();`));
  generated.set('/gen/remover.js', js(`new MutationObserver(ms=>{for(const m of ms)for(const n of m.addedNodes){if(n.nodeType===1&&!n.closest('[data-app]')&&(n.parentNode===document.body||n.parentNode===document.documentElement))n.remove();}}).observe(document.documentElement,{childList:true,subtree:true});`));
  generated.set('/gen/click.js', js(`window.clicks=0;document.getElementById('b0').addEventListener('click',()=>window.clicks++);`));
  for (const [name, body] of Object.entries(hostile)) {
    generated.set(`/p/${name}`, { type: 'text/html', body: `<!doctype html><meta charset="utf-8">${body}`,
      headers: name === 'csp' ? { 'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'" } : {} });
  }
}

function testExtensionCopy() {
  // Automation cannot grant activeTab, so the test copy gets <all_urls> for captureVisibleTab.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtp-ext-'));
  fs.cpSync(path.join(ROOT, 'extension'), dir, { recursive: true });
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
  m.host_permissions.push('<all_urls>');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m));
  return dir;
}

async function launchExtension() {
  const ext = testExtensionCopy();
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'mtp-profile-')), {
    channel: 'chromium', viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
  // onInstalled writes defaults asynchronously: wait for it before changing settings.
  for (let i = 0; i < 40 && !(await sw.evaluate(async () => (await chrome.storage.local.get('provider')).provider)); i++) await sleep(100);
  const set = async values => {
    await sw.evaluate(v => chrome.storage.local.set(v), values);
    await sleep(100);
  };
  const page = ctx.pages()[0] || await ctx.newPage();
  const decoder = await ctx.newPage();
  await page.bringToFront();
  const decode = (png, points) => decoder.evaluate(async ([b64, pts]) => {
      const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0);
      return pts.map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3)));
    }, [png.toString('base64'), points]);
  const pixels = async points => decode(await page.screenshot(), points);
  const inject = () => sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
    const files = ['render/fit.js', 'content.js'];
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files }); }
    catch { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files }); }
  });
  const message = msg => sw.evaluate(async m => {
    const [tab] = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
    return chrome.tabs.sendMessage(tab.id, m, { frameId: 0 }).catch(e => ({ error: e.message }));
  }, msg);
  const engine = msg => sw.evaluate(m => chrome.runtime.sendMessage(m).catch(e => ({ error: e.message })), msg); // SW → offscreen engine directly
  return { ctx, sw, page, set, pixels, decode, inject, message, engine, ext };
}

const isMagenta = ([r, g, b]) => r > 200 && g < 80 && b > 200;
const isWhite = ([r, g, b]) => r > 235 && g > 235 && b > 235;

async function hostileSuite(x) {
  const provider = http.createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
    req.resume();
    req.on('end', () => res.writeHead(200, cors).end(JSON.stringify({ results: BOXES.map(b => ({ ...b, text: 'OK' })) })));
  });
  await new Promise(r => provider.listen(8001, '127.0.0.1', r));
  const frame = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' })
    .end(`<!doctype html><style>body{margin:0;height:3000px;background:#ddd}${bubbleCss()}</style>${bubbles}`));
  await new Promise(r => frame.listen(8772, '127.0.0.1', r));
  await x.set({ provider: 'local', localServerUrl: 'http://127.0.0.1:8001' });
  const probe = BOXES.map(b => [Math.round(b.x + b.w * 0.5), Math.round(b.y + 6)]);
  for (const name of Object.keys(hostile)) {
    await x.page.goto(`http://127.0.0.1:8770/p/${name}`);
    await x.page.bringToFront();
    if (name === 'fullscreen') { await x.page.click('#fs'); await sleep(300); }
    await x.inject();
    await x.message({ action: 'trigger_from_popup' });
    await sleep(1700);
    const px = await x.pixels(probe);
    check(`overlay visible: ${name}`, px.every(isWhite), JSON.stringify(px));
    if (name === 'scroller' || name === 'iframe') {
      await x.page.mouse.move(640, 400);
      await x.page.mouse.wheel(0, 150);
      await sleep(600);
      const after = await x.pixels(probe.filter(([, py]) => py - 150 > 0).map(([px_, py]) => [px_, py - 150]));
      check(`overlay follows inner scroll: ${name}`, after.every(isWhite), JSON.stringify(after));
    }
    if (name === 'clickthrough') {
      await x.page.mouse.click(probe[0][0], probe[0][1] + 30);
      check('page receives clicks through overlays', await x.page.evaluate(() => window.clicks > 0));
    }
    if (name === 'zoom') {
      const edge = await x.pixels([[BOXES[0].x + 3, BOXES[0].y + 3], [BOXES[0].x + BOXES[0].w - 3, BOXES[0].y + BOXES[0].h - 3], [BOXES[0].x + BOXES[0].w + 6, BOXES[0].y + 20]]);
      check('overlay aligned under html zoom', isWhite(edge[0]) && isWhite(edge[1]) && !isWhite(edge[2]), JSON.stringify(edge));
    }
    if (name === 'fullscreen') await x.page.evaluate(() => document.exitFullscreen().catch(() => {}));
    if (name === 'baseline') {
      await x.message({ action: 'toggle_original' });
      await sleep(150);
      check('show original hides overlays', (await x.pixels(probe)).every(isMagenta));
      await x.message({ action: 'toggle_original' });
    }
  }
  provider.close(); frame.close();
}

async function pipelineSuite(x, port) {
  await x.set({ provider: 'browser', debugEchoTranslator: true, autoMode: false });
  // a. capture path, streamed results, Japanese → echo
  await x.page.goto(`http://127.0.0.1:${port}/fixtures/manga-page.html`);
  await x.inject();
  const t0 = Date.now();
  await x.message({ action: 'trigger_from_popup' });
  let first = null, count = 0;
  for (let i = 0; i < 300; i++) {
    count = (await x.message({ action: 'overlay_state' }))?.items || 0;
    if (count && first === null) first = Date.now() - t0;
    if (count >= 7) break;
    await sleep(50);
  }
  for (let i = 0; i < 200 && (await x.message({ action: 'overlay_state' }))?.busy; i++) await sleep(50);
  const stats = await x.engine({ action: 'engine_stats' });
  check('browser pipeline: ≥ 7 bubble overlays from a capture', count >= 7, `${count} overlays, first after ${first} ms (cold), ${stats.ocrJobs} OCR jobs`);
  check('offscreen engine is cross-origin isolated (threads available)', stats.isolated === true, String(stats.isolated));
  // b. second run hits the crop cache instead of OCR
  await x.message({ action: 'trigger_from_popup' });
  await sleep(300);
  for (let i = 0; i < 200 && (await x.message({ action: 'overlay_state' }))?.busy; i++) await sleep(50);
  const stats2 = await x.engine({ action: 'engine_stats' });
  console.log('  second run:', JSON.stringify((await x.message({ action: 'overlay_state' })).lastRun));
  if (process.env.MTP_DEBUG) {
    const img = await x.sw.evaluate(async () => Object.values(await chrome.storage.session.get(null))[0]?.image);
    if (img) fs.writeFileSync('/tmp/mtp-second-capture.png', Buffer.from(img.split(',')[1], 'base64'));
  }
  check('repeat translation served from the crop cache', stats2.ocrJobs === stats.ocrJobs && stats2.cacheHits > stats.cacheHits, `ocrJobs ${stats.ocrJobs}→${stats2.ocrJobs}, hits ${stats.cacheHits}→${stats2.cacheHits}`);
  // c. snapshot view
  const pagesBefore = x.ctx.pages().length;
  const snapTabId = await x.sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0].id);
  const extPage = await x.ctx.newPage(); // the SW cannot message itself, so ask from an extension page
  await extPage.goto(x.sw.url().replace('background.js', 'sample.html'));
  const snapPromise = x.ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null);
  await extPage.evaluate(id => chrome.runtime.sendMessage({ action: 'open_snapshot', tabId: id }), snapTabId);
  const snap = await snapPromise;
  if (snap) {
    snap.on('pageerror', e => console.log('  [snapshot error]', e.message));
    snap.on('console', m => console.log('  [snapshot console]', m.text()));
    await snap.waitForLoadState(); await sleep(800);
    console.log('  snapshot info:', await snap.evaluate(() => document.getElementById('info').textContent));
    const n = await snap.evaluate(() => document.querySelectorAll('.mtp-o').length);
    check('snapshot view shows the translations', n >= 7, `${n} overlays`);
    await snap.close();
    await extPage.close();
  } else check('snapshot view opens', false, `pages ${pagesBefore}`);
  await x.page.bringToFront();
  // d. source images: the page image is read from the <img>, then served from IndexedDB on revisit
  generated.set('/p/strip', { type: 'text/html', body: `<!doctype html><style>body{margin:0;background:#222}img{display:block;margin:0 auto 40px;width:1280px}</style><img src="/gen/page-dpr1.png"><img src="/gen/page-dpr1.png?2">` });
  for (const visit of [1, 2]) {
    await x.page.goto(`http://127.0.0.1:${port}/p/strip`);
    await x.page.waitForFunction(() => [...document.images].every(i => i.complete));
    await x.inject();
    const before = await x.engine({ action: 'engine_stats' });
    await x.message({ action: 'trigger_from_popup' });
    let n = 0;
    for (let i = 0; i < 200 && n < 7; i++) { await sleep(50); n = (await x.message({ action: 'overlay_state' }))?.items || 0; }
    const after = await x.engine({ action: 'engine_stats' });
    if (visit === 1) check('source image translated from the <img>', after.images > before.images && n >= 7, `${n} overlays, images ${before.images}→${after.images}`);
    else check('revisited image served from the results cache', after.imageCacheHits > before.imageCacheHits && n >= 7, `${n} overlays, cache hits ${before.imageCacheHits}→${after.imageCacheHits}`);
  }
  // e. incremental auto mode on a long capture-only page (canvas-free <div> art)
  generated.set('/p/long', { type: 'text/html', body: `<!doctype html><style>body{margin:0;background:#1e1e1e}iframe{display:block;border:0;width:1280px;height:800px}</style>${'<div style="width:1280px;height:800px;background:url(/gen/page-dpr1.png)"></div>'.repeat(3)}` });
  await x.set({ autoMode: true });
  await x.page.goto(`http://127.0.0.1:${port}/p/long`);
  await sleep(800);
  await x.inject();
  await x.message({ action: 'trigger_from_popup' });
  await sleep(3000);
  const s1 = await x.engine({ action: 'engine_stats' });
  await x.page.mouse.move(640, 400);
  await x.page.mouse.wheel(0, 300);
  await sleep(3000);
  const s2 = await x.engine({ action: 'engine_stats' });
  const state = await x.message({ action: 'overlay_state' });
  check('auto mode re-translates after scrolling, reusing cached bubbles', s2.ocrJobs - s1.ocrJobs <= 3 && s2.cacheHits > s1.cacheHits && state.items > 7, `new OCR jobs ${s2.ocrJobs - s1.ocrJobs}, cache hits +${s2.cacheHits - s1.cacheHits}, overlays ${state.items}`);
  await x.set({ autoMode: false });

  // f. extension pages load without errors; the bundled overlay demo still works
  const base = x.sw.url().replace('background.js', '');
  for (const name of ['popup.html', 'options/index.html', 'sample.html', 'reader/index.html']) {
    const p = await x.ctx.newPage();
    const errors = [];
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(base + name);
    await sleep(700);
    if (name === 'sample.html') {
      const box = await p.evaluate(() => { const r = document.querySelector('.bubble').getBoundingClientRect(); return [r.x + r.width / 2, r.y + 8]; });
      await p.mouse.click(1280 - 60, 800 - 40); // the in-page Translate button
      await sleep(600);
      const [px] = await x.decode(await p.screenshot(), [box]);
      check('overlay demo (sample.html) draws its translations', isWhite(px), JSON.stringify(px));
    }
    check(`${name} loads without errors`, errors.length === 0, errors.join('; '));
    await p.close();
  }

  // g. "Always translate on this site": registered script injects and translates on page load
  const helper = await x.ctx.newPage();
  await helper.goto(base + 'sample.html');
  const reg = await helper.evaluate(() => chrome.runtime.sendMessage({ action: 'register_site', origin: 'http://127.0.0.1:8770', enable: true }));
  await helper.close();
  await x.page.bringToFront();
  await x.page.goto(`http://127.0.0.1:${port}/fixtures/manga-page.html`);
  let auto = 0;
  for (let i = 0; i < 100 && auto < 7; i++) { await sleep(100); auto = (await x.message({ action: 'overlay_state' }))?.items || 0; }
  check('always-translate site translates on load without a click', !reg?.error && auto >= 7, `${auto} overlays ${reg?.error || ''}`);
  const helper2 = await x.ctx.newPage();
  await helper2.goto(base + 'sample.html');
  await helper2.evaluate(() => chrome.runtime.sendMessage({ action: 'register_site', origin: 'http://127.0.0.1:8770', enable: false }));
  const left = await helper2.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  check('removing the site unregisters its script', left.length === 0, JSON.stringify(left.map(s => s.id)));
  await helper2.close();
}

async function accurateSuite(x, port) {
  const res = await x.engine({ action: 'accurate_install' });
  check('Accurate mode models download and verify', !res?.error, res?.error || 'ok');
  if (res?.error) return;
  await x.set({ accurateMode: true });
  await x.page.goto(`http://127.0.0.1:${port}/fixtures/manga-page.html`);
  await x.inject();
  await x.message({ action: 'trigger_from_popup' });
  await sleep(5000);
  const n = (await x.message({ action: 'overlay_state' }))?.items || 0;
  check('Accurate mode pipeline produces overlays', n >= 7, `${n} overlays`);
  // Text drawn straight on grey art (no bubble): only Accurate mode's line detector can find it.
  generated.set('/p/nobubble', { type: 'text/html', body: `<!doctype html><meta charset="utf-8"><style>body{margin:0;height:800px;background:repeating-linear-gradient(45deg,#777 0 6px,#8a8a8a 6px 12px);font:700 34px IPAGothic,sans-serif}p{position:absolute;left:600px;top:200px;margin:0;writing-mode:vertical-rl;color:#111;-webkit-text-stroke:0}</style><p>その時、空が割れた</p>` });
  const before = await x.engine({ action: 'engine_stats' });
  await x.page.goto(`http://127.0.0.1:${port}/p/nobubble`);
  await x.inject();
  await x.message({ action: 'trigger_from_popup' });
  await sleep(4000);
  const after = await x.engine({ action: 'engine_stats' });
  const m = (await x.message({ action: 'overlay_state' }))?.items || 0;
  check('Accurate mode finds text outside bubbles', m >= 1 && after.accurateJobs > before.accurateJobs, `${m} overlays, accurate jobs +${after.accurateJobs - before.accurateJobs}`);
  await x.set({ accurateMode: false });
}

// ------------------------------------------------------------ main
await tessdata();
registerHostileAssets();
const servers = [await serve(8770)];
const browser = await chromium.launch({ channel: 'chromium' });
try {
  console.log('Engine benchmark');
  await engineBench(browser, 8770);
  if (!args.has('--bench')) {
    console.log('Extension suites');
    const x = await launchExtension();
    try {
      await hostileSuite(x);
      await pipelineSuite(x, 8770);
      if (args.has('--accurate')) await accurateSuite(x, 8770);
    } finally { await x.ctx.close(); fs.rmSync(x.ext, { recursive: true, force: true }); }
  }
} finally {
  await browser.close();
  servers.forEach(s => s.close());
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
