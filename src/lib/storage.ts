// Typed wrapper around chrome.storage.local + a React hook.

import { useEffect, useState, useCallback } from 'react';
import { DEFAULT_SETTINGS, type Settings } from './types';

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEYS);
  return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.local.set(patch);
}

/**
 * React hook for live-bound settings. Updates propagate via chrome.storage.onChanged
 * so popup + options + content scripts stay in sync.
 */
export function useSettings(): {
  settings: Settings;
  loading: boolean;
  update: (patch: Partial<Settings>) => Promise<void>;
} {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    loadSettings().then((s) => {
      if (alive) {
        setSettings(s);
        setLoading(false);
      }
    });

    const handler = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: chrome.storage.AreaName,
    ) => {
      if (area !== 'local') return;
      setSettings((prev) => {
        const next = { ...prev };
        for (const k of KEYS) {
          if (k in changes) {
            (next as Record<string, unknown>)[k] = changes[k].newValue;
          }
        }
        return next;
      });
    };
    chrome.storage.onChanged.addListener(handler);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(handler);
    };
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    await saveSettings(patch);
  }, []);

  return { settings, loading, update };
}

/**
 * Ask the background service worker to test a provider's connection.
 */
export function testConnection(provider: 'ollama' | 'local' | 'gemini') {
  return new Promise<import('./types').ConnectionTestResult>((resolve) => {
    chrome.runtime.sendMessage({ action: 'test_connection', provider }, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(res || { ok: false, error: 'No response' });
      }
    });
  });
}
