import { useState } from 'react';
import { Toggle } from './ui';

// Accurate mode downloads a comic text/bubble detector and manga-ocr (Apache-2.0, ~128 MB) from pinned
// Hugging Face revisions, verified by SHA-256. Hugging Face allows cross-origin downloads, so no extra
// permission is needed.
export function AccurateModeToggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  const [status, setStatus] = useState('');
  const toggle = async (on: boolean) => {
    if (!on) {
      onChange(false);
      await chrome.runtime.sendMessage({ action: 'engine_forward', message: { action: 'accurate_remove' } });
      setStatus('Accurate mode models removed.');
      return;
    }
    setStatus('Downloading and verifying models (about 128 MB)…');
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
        label="Accurate mode (manga-ocr + comic text detector)"
        description="Re-reads bubbles Tesseract is unsure about with manga-ocr, and finds grey bubbles, narration and text drawn on the art. Downloads about 128 MB once from Hugging Face. Adds roughly 0.3–0.4 s per extra bubble plus ~0.3 s per screen on a 4-core CPU."
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
