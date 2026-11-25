// Toolbar popup logic.
import { languagePair } from './providers/browser.js';

const $ = id => document.getElementById(id);
const statusEl = $('status'), statusText = $('status-text'), translateBtn = $('translate-btn');
const autoModeToggle = $('auto-mode'), siteToggle = $('site-auto'), hint = $('hint');

const PROVIDER_LABELS = {
  ollama: 'Ollama (local)', local: 'Local FastAPI server', browser: 'On this device', gemini: 'Gemini API (cloud)',
};

function setStatus(state, text) { statusEl.dataset.state = state; statusText.textContent = text; }

const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
const translatable = tab => /^https?:/.test(tab?.url || '');
const hostPatterns = hosts => [...new Set(hosts.map(h => `*://${h.replace(/:\d+$/, "")}/*`))]; // any port

// What the page's content script knows: is whole-page translation running, and which image hosts are blocked.
async function pageInfo(tab) {
  if (!tab?.id || !translatable(tab)) return null;
  return chrome.tabs.sendMessage(tab.id, { action: 'page_info' }, { frameId: 0 }).catch(() => null);
}

async function showAccess(tab) {
  const info = await pageInfo(tab);
  const access = $('access');
  if (!info?.blockedHosts?.length) { access.hidden = true; return; }
  access.hidden = false;
  $('access-text').textContent = `Images come from ${info.blockedHosts.join(', ')}, so only the visible screen is translated and bubbles at the screen edge can be missed.`;
  $('access-btn').onclick = async () => {
    // Inside this click: permission prompts need a user gesture.
    const granted = await chrome.permissions.request({ origins: hostPatterns(info.blockedHosts) }).catch(() => false);
    if (!granted) return;
    await chrome.tabs.sendMessage(tab.id, { action: 'access_granted' }, { frameId: 0 }).catch(() => {});
    access.hidden = true;
    setStatus('ok', 'Whole-page translation on');
  };
}

async function loadBuildInfo() {
  try {
    const info = await (await fetch(chrome.runtime.getURL('build-info.json'))).json();
    $('build-label').textContent = `v${info.version} · ${info.buildId}`;
    $('build-label').title = `Built ${info.buildTime}`;
  } catch { $('build-label').textContent = 'v?'; }
}

async function loadSettingsAndProbe() {
  const { provider = 'browser', autoMode = false, autoSites = [] } = await chrome.storage.local.get(['provider', 'autoMode', 'autoSites']);
  $('provider-label').textContent = PROVIDER_LABELS[provider] || provider;
  autoModeToggle.checked = autoMode;
  const tab = await activeTab();
  if (translatable(tab)) {
    const origin = new URL(tab.url).origin;
    $('site-name').textContent = new URL(tab.url).host;
    siteToggle.checked = autoSites.includes(origin);
    showAccess(tab);
  } else siteToggle.disabled = true;

  if (provider === 'browser') {
    chrome.runtime.sendMessage({ action: 'engine_warm' }).catch(() => {}); // start OCR workers while the user decides
    const availability = globalThis.Translator ? await Translator.availability(languagePair).catch(() => 'unavailable') : 'unavailable';
    setStatus('ok', 'Japanese → English · On this device');
    hint.textContent = availability === 'available' ? 'Ready. Shortcut: Alt+Shift+T.'
      : availability === 'unavailable' ? 'First use downloads an offline translation model (about 115 MB).'
      : "First use downloads Chrome's Japanese language pack.";
    return;
  }
  setStatus('', 'Checking provider…');
  const res = await chrome.runtime.sendMessage({ action: 'test_connection', provider }).catch(e => ({ error: e.message }));
  if (!res || res.error || !res.ok) {
    setStatus('err', res?.error || res?.message || 'Provider unreachable');
    hint.textContent = { ollama: 'Start Ollama (ollama serve) and pull a vision model.', local: 'Start the local server: cd server && uvicorn app:app --port 8001', gemini: 'Add your Gemini API key in Settings.' }[provider] || '';
  } else if (provider === 'ollama' && !res.modelInstalled) {
    setStatus('warn', res.message || 'Model not installed');
  } else {
    setStatus('ok', res.message || 'Provider ready');
    hint.textContent = 'Open a manga page, then click Translate.';
  }
}

// Chrome's language pack can only be downloaded after a user gesture, which the offscreen engine never has.
// This click is one, so start (or join) the download here; later runs then use Chrome's fast translator.
async function startLanguagePack() {
  if (!globalThis.Translator) return;
  const availability = await Translator.availability(languagePair).catch(() => 'unavailable');
  if (availability !== 'downloadable' && availability !== 'downloading') return;
  setStatus('', 'Downloading Chrome language pack…');
  return Translator.create({
    ...languagePair,
    monitor(m) { m.addEventListener('downloadprogress', e => setStatus('', `Language pack · ${Math.round(e.loaded * 100)}%`)); },
  }).then(t => { t.destroy(); setStatus('ok', 'Language pack ready'); }).catch(() => {});
}

async function sendToTab(message) {
  const tab = await activeTab();
  if (!tab?.id || !translatable(tab)) throw new Error("Can't translate this page (not a regular http/https page).");
  const inj = await chrome.runtime.sendMessage({ action: 'inject_content_script', tabId: tab.id });
  if (!inj?.ok) throw new Error(inj?.error || 'Failed to inject content script');
  return chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
}

translateBtn.addEventListener('click', async () => {
  translateBtn.disabled = true;
  translateBtn.textContent = 'Working…';
  try {
    const download = startLanguagePack(); // must start inside this click
    await sendToTab({ action: 'trigger_from_popup' });
    // Resolves at once when nothing is downloading; otherwise the popup shows progress until the pack is ready.
    await download;
    window.close();
  } catch (err) {
    setStatus('err', err.message);
    translateBtn.disabled = false;
    translateBtn.textContent = 'Translate page';
  }
});

$('original-btn').addEventListener('click', async () => {
  try {
    const res = await sendToTab({ action: 'toggle_original' });
    $('original-btn').textContent = res?.showOriginal ? 'Show translation' : 'Show original';
  } catch (err) { setStatus('err', err.message); }
});

$('snapshot-btn').addEventListener('click', async () => {
  const tab = await activeTab();
  const res = await chrome.runtime.sendMessage({ action: 'open_snapshot', tabId: tab?.id }).catch(e => ({ error: e.message }));
  if (res?.error) setStatus('err', res.error); else window.close();
});

autoModeToggle.addEventListener('change', e => chrome.storage.local.set({ autoMode: e.target.checked }));

siteToggle.addEventListener('change', async () => {
  const tab = await activeTab();
  const url = new URL(tab.url);
  const pattern = `${url.protocol}//${url.host}/*`;
  try {
    if (siteToggle.checked) {
      // Must run inside this click: permission prompts need a user gesture.
      // Include the servers the page's images come from, so whole pages can be read, not just the screen.
      const info = await pageInfo(tab);
      const granted = await chrome.permissions.request({ origins: [pattern, ...hostPatterns((info?.imageHosts || []).filter(h => h !== url.host))] });
      if (!granted) { siteToggle.checked = false; return; }
    }
    const res = await chrome.runtime.sendMessage({ action: 'register_site', origin: url.origin, enable: siteToggle.checked });
    if (res?.error) throw new Error(res.error);
    if (siteToggle.checked) { await sendToTab({ action: 'auto_changed' }); await sendToTab({ action: 'access_granted' }); $('access').hidden = true; }
    hint.textContent = siteToggle.checked ? `Pages on ${url.host} now translate automatically.` : `Stopped translating ${url.host} automatically.`;
  } catch (err) {
    siteToggle.checked = !siteToggle.checked;
    setStatus('err', err.message);
  }
});

$('open-options').addEventListener('click', e => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

loadBuildInfo();
loadSettingsAndProbe();
