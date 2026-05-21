import { motion } from 'motion/react';
import type { ProviderId } from '../lib/types';

interface ProviderOption {
  id: ProviderId;
  name: string;
  tagline: string;
  features: string[];
  icon: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    id: 'gemini',
    name: 'Gemini API',
    tagline: 'Google Gemini (recommended)',
    features: ['Best at bubble vs background', 'Strong Japanese OCR', 'Free ~1500 req/day'],
    icon: '✨',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    tagline: 'Local vision-language model',
    features: ['One-shot: detect + OCR + translate', 'Runs entirely on your machine', 'Free, private, offline'],
    icon: '🦙',
  },
  {
    id: 'local',
    name: 'Local Server',
    tagline: 'Python FastAPI + manga-ocr',
    features: ['Specialized manga OCR model', 'Configurable translator', 'Higher accuracy on text'],
    icon: '🐍',
  },
];

export function ProviderSelector({
  value,
  onChange,
}: {
  value: ProviderId;
  onChange: (v: ProviderId) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {PROVIDERS.map((p) => {
        const selected = p.id === value;
        return (
          <motion.button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.99 }}
            className={`group relative cursor-pointer rounded-xl border p-4 text-left transition-all ${
              selected
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/8 shadow-lg shadow-[var(--color-accent)]/20'
                : 'border-[var(--color-border)] bg-[var(--color-panel-2)]/50 hover:border-[var(--color-border)]/80 hover:bg-[var(--color-panel-2)]'
            }`}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-2xl">{p.icon}</span>
              <span
                className={`h-3 w-3 rounded-full border-2 transition-colors ${
                  selected ? 'border-[var(--color-accent)] bg-[var(--color-accent)]' : 'border-[var(--color-border)]'
                }`}
              />
            </div>
            <div className="font-display text-base text-[var(--color-text)]">{p.name}</div>
            <div className="mt-0.5 text-xs text-[var(--color-muted)]">{p.tagline}</div>
            <ul className="mt-3 space-y-1">
              {p.features.map((f) => (
                <li key={f} className="flex items-start gap-1.5 text-xs text-[var(--color-muted)]">
                  <span className="mt-0.5 text-[var(--color-accent)]">▸</span>
                  {f}
                </li>
              ))}
            </ul>
          </motion.button>
        );
      })}
    </div>
  );
}
