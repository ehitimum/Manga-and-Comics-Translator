import { installModel, ocrCache } from './models.js';
import { translateJapanese } from '../providers/browser.js';

const el = id => document.getElementById(id);
const stage = el('stage'), image = el('image'), box = el('box'), source = el('source');
const status = text => { el('status').textContent = text; };
let crop, start, busy = false;
let translation;
el('cancel').onclick = () => translation?.abort();

function refresh() {
  const text = source.value.trim();
  el('translate').disabled = busy || !text;
  el('recognize').disabled = busy || !crop;
  el('remove').disabled = busy;
  source.disabled = el('direction').disabled = busy;
  const link = el('online');
  link.hidden = !text;
  if (text) link.href = 'https://translate.google.com/?' + new URLSearchParams({sl:'ja', tl:'en', text, op:'translate'});
  else link.removeAttribute('href');
}

function resetOutput() {
  el('result').textContent = '';
  status('');
  refresh();
}
source.addEventListener('input', resetOutput);

function point(event) {
  const rect = image.getBoundingClientRect();
  const clamp = n => Math.min(1, Math.max(0, n));
  return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
}
function select(end) {
  const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
  const w = Math.abs(start.x - end.x), h = Math.abs(start.y - end.y);
  Object.assign(box.style, {left:x*100+'%', top:y*100+'%', width:w*100+'%', height:h*100+'%'});
  box.hidden = false;
  const left = Math.floor(x * image.naturalWidth), top = Math.floor(y * image.naturalHeight);
  const width = Math.min(image.naturalWidth-left, Math.ceil(w * image.naturalWidth));
  const height = Math.min(image.naturalHeight-top, Math.ceil(h * image.naturalHeight));
  crop = width >= 8 && height >= 8 ? {left, top, width, height} : null;
  refresh();
}
stage.onpointerdown = e => {
  if (busy || !e.isPrimary || e.button !== 0) return;
  stage.setPointerCapture(e.pointerId);
  start = point(e);
  select(start);
};
stage.onpointermove = e => { if (start && e.isPrimary) select(point(e)); };
stage.onpointerup = e => { if (start && e.isPrimary) { select(point(e)); start = null; } };
stage.onpointercancel = () => { start = crop = null; box.hidden = true; refresh(); };

el('recognize').onclick = async () => {
  if (busy || !crop) return;
  busy = true;
  source.value = '';
  resetOutput();
  let worker;
  try {
    const code = el('direction').value;
    status('Preparing OCR model…');
    await installModel(code);
    const url = path => chrome.runtime.getURL('reader/' + path);
    worker = await Tesseract.createWorker(code, 1, {
      workerPath: url('vendor/worker.min.js'), workerBlobURL: false,
      corePath: url('vendor/tesseract-core-lstm.wasm.js'),
      langPath: url('data'), gzip:false, cacheMethod:'none',
    });
    await worker.setParameters({ tessedit_pageseg_mode: code === 'jpn_vert' ? '5' : '6' });
    status('Reading selection…');
    const {data} = await worker.recognize(image, {rectangle: crop});
    source.value = data.text.trim();
    status(source.value ? 'Check the recognized text, then translate.' : 'No text found. Try a tighter selection or change writing direction.');
  } catch (error) {
    status('OCR failed. ' + (error.message || String(error)));
  } finally {
    if (worker) await worker.terminate();
    busy = false;
    refresh();
  }
};
el('translate').onclick = async () => {
  if (busy || !source.value.trim()) return;
  busy = true;
  resetOutput();
  status('Preparing Chrome Translator…');
  translation = new AbortController();
  el('cancel').hidden = false;
  const timeout = AbortSignal.timeout(90000);
  const signal = AbortSignal.any([translation.signal, timeout]);
  try {
    const result = await translateJapanese(source.value.trim(), status, signal);
    el('result').textContent = result.text;
    status(result.source);
  } catch (error) {
    if (timeout.aborted) {
      status('Chrome Translator is taking too long. Try again or open Google Translate below.');
    } else if (translation.signal.aborted) {
      status('Translation canceled.');
    } else {
      status((error.message || String(error)) + ' You can open Google Translate below.');
    }
  } finally {
    translation = null;
    el('cancel').hidden = true;
    busy = false;
    refresh();
  }
};
el('remove').onclick = async () => { await caches.delete(ocrCache); status('Downloaded OCR models removed.'); };

const key = location.hash.slice(1);
if (/^capture-[a-f0-9-]{36}$/.test(key)) {
  try {
    const saved = await chrome.storage.session.get(key);
    await chrome.storage.session.remove(key);
    history.replaceState(null, '', location.pathname);
    if (!saved[key]) throw Error('Capture expired. Reopen the manga page and choose Read a bubble.');
    image.src = saved[key];
    await image.decode();
    el('capture').hidden = false;
  } catch (error) { status(error.message); }
}
refresh();
