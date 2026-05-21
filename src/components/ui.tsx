import { motion } from 'motion/react';
import type { ReactNode, ChangeEvent } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-[var(--color-border)] bg-[var(--color-panel)]/80 backdrop-blur-sm ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
      <div>
        <h3 className="font-display text-base text-[var(--color-text)]">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-[var(--color-muted)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <div>
        <div className="text-sm font-medium text-[var(--color-text)]">{label}</div>
        {description && <div className="mt-0.5 text-xs text-[var(--color-muted)]">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50 ${
          checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-panel-2)]'
        }`}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 600, damping: 30 }}
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = 'text',
  mono = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className={`w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 text-sm text-[var(--color-text)] outline-none transition-colors placeholder:text-[var(--color-muted)]/60 focus:border-[var(--color-accent)] ${
          mono ? 'font-mono text-[13px]' : ''
        }`}
      />
      {hint && <p className="mt-1.5 text-xs text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

export function Select<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; note?: string }[];
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-[var(--color-text)]">{label}</label>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as T)}
          className="w-full appearance-none rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-3 py-2 pr-8 text-sm text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)]"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
              {o.note ? `  —  ${o.note}` : ''}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
        </svg>
      </div>
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]/50 disabled:cursor-not-allowed disabled:opacity-60';
  const variants = {
    primary: 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] shadow-lg shadow-[var(--color-accent)]/20',
    secondary: 'bg-[var(--color-panel-2)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-border)]',
    ghost: 'text-[var(--color-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-panel-2)]',
  };
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`${base} ${variants[variant]}`}>
      {children}
    </button>
  );
}

export function StatusBadge({
  state,
  children,
}: {
  state: 'idle' | 'ok' | 'warn' | 'err' | 'loading';
  children: ReactNode;
}) {
  const colorByState: Record<typeof state, string> = {
    idle: 'bg-[var(--color-muted)]/20 text-[var(--color-muted)] border-[var(--color-border)]',
    loading: 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-[var(--color-accent)]/30',
    ok: 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30',
    warn: 'bg-[var(--color-warn)]/10 text-[var(--color-warn)] border-[var(--color-warn)]/30',
    err: 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/30',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${colorByState[state]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          state === 'ok'
            ? 'bg-[var(--color-success)]'
            : state === 'warn'
              ? 'bg-[var(--color-warn)]'
              : state === 'err'
                ? 'bg-[var(--color-danger)]'
                : state === 'loading'
                  ? 'bg-[var(--color-accent)] animate-pulse'
                  : 'bg-[var(--color-muted)]'
        }`}
      />
      {children}
    </span>
  );
}
