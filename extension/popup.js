// Toolbar popup logic.

const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const translateBtn = document.getElementById('translate-btn');
const autoModeToggle = document.getElementById('auto-mode');
const providerLabel = document.getElementById('provider-label');
const hint = document.getElementById('hint');
const openOptions = document.getElementById('open-options');

const PROVIDER_LABELS = {
  ollama: 'Ollama (local)',
  local: 'Local FastAPI server',
};

function setStatus(state, text) {
  statusEl.dataset.state = state;
  statusText.textContent = text;
}

async function loadSettingsAndProbe() {
  const { provider = 'ollama', autoMode = false } = await chrome.storage.local.get([
    'provider', 'autoMode',
  ]);
  providerLabel.textContent = PROVIDER_LABELS[provider] || provider;
  autoModeToggle.checked = autoMode;

  setStatus('', 'Checking provider…');

  chrome.runtime.sendMessage({ action: 'test_connection', provider }, (res) => {
    if (!res || res.error || !res.ok) {
      setStatus('err', res?.error || res?.message || 'Provider unreachable');
      hint.innerHTML = provider === 'ollama'
        ? `Start Ollama: <code>ollama serve</code><br/>Then pull a vision model: <code>ollama pull qwen2.5vl:7b</code>`
        : `Start the local server: <code>cd server && uvicorn app:app --port 8000</code>`;
      return;
    }
    if (provider === 'ollama' && !res.modelInstalled) {
      setStatus('warn', res.message || 'Model not installed');
      hint.innerHTML = `Run: <code>ollama pull qwen2.5vl:7b</code>`;
    } else {
      setStatus('ok', res.message || 'Provider ready');
      hint.textContent = 'Open a manga page, then click Translate.';
    }
  });
}

translateBtn.addEventListener('click', async () => {
  translateBtn.disabled = true;
  translateBtn.textContent = 'Working…';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');

    // Some pages (chrome://, the Web Store, extension pages) can't host content scripts.
    if (!/^https?:/.test(tab.url || '')) {
      throw new Error("Can't translate this page (not a regular http/https page).");
    }

    // Inject content script on demand, then trigger translation
    const inj = await chrome.runtime.sendMessage({ action: 'inject_content_script', tabId: tab.id });
    if (!inj?.ok) throw new Error(inj?.error || 'Failed to inject content script');

    // Tell the content script to start (also works if it's the first time)
    chrome.tabs.sendMessage(tab.id, { action: 'trigger_from_popup' }, () => {
      // We don't wait for the result — content script handles its own UI.
      window.close();
    });
  } catch (err) {
    setStatus('err', err.message);
    translateBtn.disabled = false;
    translateBtn.textContent = 'Translate page';
  }
});

autoModeToggle.addEventListener('change', async (e) => {
  await chrome.storage.local.set({ autoMode: e.target.checked });
});

openOptions.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

loadSettingsAndProbe();
