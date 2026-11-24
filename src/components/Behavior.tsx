import { useState } from 'react';
import { Toggle } from './ui';

const ACCURATE_HOST = 'https://files.pythonhosted.org/*';

// Accurate mode downloads PP-OCRv5 (Apache-2.0, ~19 MB) from a pinned PyPI wheel, verified by SHA-256.
export function AccurateModeToggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  const [status, setStatus] = useState('');
  const toggle = async (on: boolean) => {
    if (!on) {
      onChange(false);
      await chrome.runtime.sendMessage({ action: 'engine_forward', message: { action: 'accurate_remove' } });
      setStatus('Accurate mode models removed.');
      return;
    }
    // Permission prompts need this click's user gesture.
    const granted = await chrome.permissions.request({ origins: [ACCURATE_HOST] });
    if (!granted) { setStatus('Permission declined; Accurate mode stays off.'); return; }
    setStatus('Downloading and verifying models (19 MB)…');
    const res = await chrome.runtime.sendMessage({ action: 'engine_forward', message: { action: 'accurate_install' } });
    if (res?.error) { setStatus(`Download failed: ${res.error}`); return; }
    onChange(true);
    setStatus('Accurate mode ready.');
  };
  return (
    <div>
      <Toggle
        checked={enabled}
        onChange={toggle}
        label="Accurate mode (PP-OCRv5)"
        description="Re-reads low-confidence bubbles and finds text outside bubbles. Downloads about 19 MB once from files.pythonhosted.org; slower than the default."
      />
      {status && <p className="mt-2 text-xs text-[var(--color-muted)]">{status}</p>}
    </div>
  );
}

export function AutoSites({ sites }: { sites: string[] }) {
  if (!sites?.length) {
    return <p className="text-xs text-[var(--color-muted)]">Use “Always translate on this site” in the popup to translate a site’s pages automatically.</p>;
  }
  return (
    <div>
      <p className="text-sm font-medium text-[var(--color-text)]">Always translated sites</p>
      <ul className="mt-2 space-y-1">
        {sites.map((origin) => (
          <li key={origin} className="flex items-center justify-between rounded border border-[var(--color-border)] px-3 py-1.5 text-sm">
            <span className="font-mono">{origin}</span>
            <button
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-text)]"
              onClick={() => chrome.runtime.sendMessage({ action: 'register_site', origin, enable: false })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
