import { useState } from 'react';
import { testConnection } from '../lib/storage';
import type { ConnectionTestResult, ProviderId } from '../lib/types';
import { Button, StatusBadge } from './ui';

export function ConnectionTester({ provider }: { provider: ProviderId }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'warn' | 'err'>('idle');
  const [result, setResult] = useState<ConnectionTestResult | null>(null);

  async function run() {
    setState('loading');
    setResult(null);
    const r = await testConnection(provider);
    setResult(r);
    if (!r.ok) {
      setState('err');
    } else if (provider === 'ollama' && r.modelInstalled === false) {
      setState('warn');
    } else {
      setState('ok');
    }
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <StatusBadge state={state}>
            {state === 'idle' && 'Not tested'}
            {state === 'loading' && 'Testing…'}
            {state === 'ok' && 'Connected'}
            {state === 'warn' && 'Partial'}
            {state === 'err' && 'Failed'}
          </StatusBadge>
        </div>
        {result && (
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            {result.message || result.error}
          </p>
        )}
        {result?.availableModels && result.availableModels.length > 0 && (
          <details className="mt-2 text-xs text-[var(--color-muted)]">
            <summary className="cursor-pointer hover:text-[var(--color-text)]">
              {result.availableModels.length} model{result.availableModels.length === 1 ? '' : 's'} installed
            </summary>
            <ul className="mt-1.5 space-y-0.5 font-mono">
              {result.availableModels.map((m) => (
                <li key={m}>• {m}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <Button variant="secondary" onClick={run} disabled={state === 'loading'}>
        {state === 'loading' ? 'Testing…' : 'Test connection'}
      </Button>
    </div>
  );
}
