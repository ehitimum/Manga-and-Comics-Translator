import { motion, AnimatePresence } from 'motion/react';
import { useSettings } from './lib/storage';
import { RECOMMENDED_OLLAMA_MODELS, RECOMMENDED_GEMINI_MODELS } from './lib/types';
import { ProviderSelector } from './components/ProviderSelector';
import { ConnectionTester } from './components/ConnectionTester';
import { Card, CardHeader, Toggle, TextField, Select } from './components/ui';

export default function App() {
  const { settings, loading, update } = useSettings();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--color-muted)]">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 flex items-center gap-4"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--color-accent)] to-[oklch(55%_0.2_290)] shadow-lg shadow-[var(--color-accent)]/30">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-white" fill="currentColor">
            <path d="M4 6a3 3 0 013-3h10a3 3 0 013 3v8a3 3 0 01-3 3h-3.5l-3.2 3.2A1 1 0 018.5 19.5V17H7a3 3 0 01-3-3V6z" />
          </svg>
        </div>
        <div>
          <h1 className="font-display text-2xl tracking-tight">Manga Translator Pro</h1>
          <p className="mt-0.5 text-sm text-[var(--color-muted)]">
            Configure your provider and let it work on any manga page.
          </p>
        </div>
      </motion.header>

      <div className="space-y-6">
        {/* Provider selection */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <Card>
            <CardHeader
              title="Translation provider"
              subtitle="Pick where the OCR + translation happens."
            />
            <div className="p-5">
              <ProviderSelector
                value={settings.provider}
                onChange={(v) => update({ provider: v })}
              />
            </div>
          </Card>
        </motion.section>

        {/* Provider-specific config */}
        <AnimatePresence mode="wait">
          {settings.provider === 'gemini' && (
            <motion.section
              key="gemini"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <Card>
                <CardHeader title="Gemini configuration" subtitle="Google Gemini vision model via REST API." />
                <div className="space-y-5 p-5">
                  <TextField
                    label="Gemini API key"
                    value={settings.geminiApiKey}
                    onChange={(v) => update({ geminiApiKey: v })}
                    placeholder="AIza…"
                    type="password"
                    mono
                    hint="Stored locally in your browser only. Free key at aistudio.google.com/apikey."
                  />
                  <Select
                    label="Model"
                    value={settings.geminiModel}
                    onChange={(v) => update({ geminiModel: v })}
                    options={RECOMMENDED_GEMINI_MODELS.map((m) => ({
                      value: m.id,
                      label: m.label,
                      note: m.note,
                    }))}
                  />
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)]/50 p-3">
                    <p className="text-xs font-semibold text-[var(--color-text)]">
                      How to get a free key
                    </p>
                    <ol className="mt-2 space-y-1 text-xs text-[var(--color-muted)]">
                      <li>1. Visit <span className="font-mono">aistudio.google.com/apikey</span> and sign in with a Google account.</li>
                      <li>2. Click <span className="font-mono">Create API key</span> and copy the value.</li>
                      <li>3. Paste it above — it's stored only in this browser.</li>
                    </ol>
                    <p className="mt-2 text-xs text-[var(--color-muted)]">
                      Free tier (Gemini 2.0 Flash): 15 requests/minute, ~1,500/day.
                    </p>
                  </div>
                  <ConnectionTester provider="gemini" />
                </div>
              </Card>
            </motion.section>
          )}
          {settings.provider === 'ollama' && (
            <motion.section
              key="ollama"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <Card>
                <CardHeader title="Ollama configuration" subtitle="Local vision-language model." />
                <div className="space-y-5 p-5">
                  <TextField
                    label="Ollama URL"
                    value={settings.ollamaUrl}
                    onChange={(v) => update({ ollamaUrl: v })}
                    placeholder="http://localhost:11434"
                    mono
                    hint="The base URL where Ollama is running (no trailing slash)."
                  />
                  <Select
                    label="Vision model"
                    value={settings.ollamaModel}
                    onChange={(v) => update({ ollamaModel: v })}
                    options={RECOMMENDED_OLLAMA_MODELS.map((m) => ({
                      value: m.id,
                      label: m.label,
                      note: m.note,
                    }))}
                  />
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)]/50 p-3">
                    <p className="text-xs font-semibold text-[var(--color-text)]">
                      First-time setup
                    </p>
                    <pre className="mt-2 overflow-x-auto rounded bg-[var(--color-bg)] p-2.5 font-mono text-[12px] leading-relaxed text-[var(--color-muted)]">
{`# 1. Start Ollama (one-time per boot)
ollama serve

# 2. Pull the vision model (~5GB, one-time)
ollama pull ${settings.ollamaModel}

# 3. Verify
ollama list`}
                    </pre>
                  </div>
                  <ConnectionTester provider="ollama" />
                </div>
              </Card>
            </motion.section>
          )}
          {settings.provider === 'local' && (
            <motion.section
              key="local"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <Card>
                <CardHeader title="Local server configuration" subtitle="Python FastAPI backend (manga-ocr pipeline)." />
                <div className="space-y-5 p-5">
                  <TextField
                    label="Server URL"
                    value={settings.localServerUrl}
                    onChange={(v) => update({ localServerUrl: v })}
                    placeholder="http://localhost:8001"
                    mono
                  />
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)]/50 p-3">
                    <p className="text-xs font-semibold text-[var(--color-text)]">
                      Start the server
                    </p>
                    <pre className="mt-2 overflow-x-auto rounded bg-[var(--color-bg)] p-2.5 font-mono text-[12px] leading-relaxed text-[var(--color-muted)]">
{`cd server
pip install -r requirements.txt
uvicorn app:app --port 8001`}
                    </pre>
                  </div>
                  <ConnectionTester provider="local" />
                </div>
              </Card>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Behavior */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <Card>
            <CardHeader title="Behavior" />
            <div className="space-y-5 p-5">
              <Toggle
                checked={settings.autoMode}
                onChange={(v) => update({ autoMode: v })}
                label="Auto-translate on scroll"
                description="Re-translate automatically 1.5 seconds after you stop scrolling."
              />
            </div>
          </Card>
        </motion.section>

        {/* How to use */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
        >
          <Card>
            <CardHeader title="How to use" />
            <ol className="space-y-3 p-5 text-sm text-[var(--color-muted)]">
              <li className="flex gap-3">
                <span className="font-display text-[var(--color-accent)]">1.</span>
                Open any manga page (MangaDex, raw Japanese sites, etc).
              </li>
              <li className="flex gap-3">
                <span className="font-display text-[var(--color-accent)]">2.</span>
                Click the Manga Translator Pro icon in your toolbar.
              </li>
              <li className="flex gap-3">
                <span className="font-display text-[var(--color-accent)]">3.</span>
                Press <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-panel-2)] px-1.5 py-0.5 font-mono text-xs">Translate page</kbd> in the popup.
              </li>
              <li className="flex gap-3">
                <span className="font-display text-[var(--color-accent)]">4.</span>
                English overlays appear on the detected Japanese bubbles. Scroll and repeat.
              </li>
            </ol>
          </Card>
        </motion.section>

        <p className="pt-4 text-center text-xs text-[var(--color-muted)]">
          Manga Translator Pro · v0.2.0 · Phase 1
        </p>
      </div>
    </div>
  );
}
