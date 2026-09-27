import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Shared building blocks for the admin console
// ---------------------------------------------------------------------------

export const fmtNum = (n: number) => (Number(n) || 0).toLocaleString('en-US');
export const fmtUsd = (n: number) =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtMoney = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
};
export const fmtDate = (ts?: number | null) =>
  ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
export const fmtDateTime = (ts?: number | null) =>
  ts ? new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export function timeAgo(ts?: number | null): string {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : fmtDate(ts);
}

export const Card: React.FC<{ title?: React.ReactNode; action?: React.ReactNode; className?: string; children: React.ReactNode }> = ({
  title,
  action,
  className = '',
  children,
}) => (
  <section className={`rounded-3xl bg-[var(--mx-surface)] border border-white/[0.07] p-4 sm:p-5 min-w-0 ${className}`}>
    {(title || action) && (
      <header className="flex items-center justify-between gap-3 mb-4">
        {title && <h2 className="text-sm font-semibold text-white tracking-tight">{title}</h2>}
        {action}
      </header>
    )}
    {children}
  </section>
);

export const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ElementType; tone?: string }> = ({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'bg-indigo-500/15 text-indigo-300',
}) => (
  <div className="rounded-3xl bg-[var(--mx-surface)] border border-white/[0.07] p-4 min-w-0">
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500 leading-tight line-clamp-2">{label}</span>
      {Icon && (
        <span className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
      )}
    </div>
    <div className="mt-2 text-2xl sm:text-[28px] font-semibold text-white tracking-tight tabular-nums truncate">{value}</div>
    {hint && <div className="mt-1 text-xs text-slate-500 leading-snug line-clamp-2">{hint}</div>}
  </div>
);

export const Badge: React.FC<{ tone?: 'green' | 'amber' | 'red' | 'violet' | 'gray'; children: React.ReactNode }> = ({ tone = 'gray', children }) => {
  const tones = {
    green: 'bg-emerald-500/12 text-emerald-300',
    amber: 'bg-amber-500/12 text-amber-300',
    red: 'bg-rose-500/12 text-rose-300',
    violet: 'bg-indigo-500/15 text-indigo-300',
    gray: 'bg-white/[0.06] text-slate-300',
  };
  return <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] font-medium whitespace-nowrap ${tones[tone]}`}>{children}</span>;
};

export const Spinner: React.FC<{ label?: string }> = ({ label = 'Loading' }) => (
  <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500" role="status">
    <Loader2 className="w-4 h-4 animate-spin" /> {label}…
  </div>
);

export const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="py-10 text-center text-sm text-slate-500">{children}</div>
);

export const ErrorNote: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-200 flex items-center justify-between gap-3">
    <span>{message}</span>
    {onRetry && (
      <button type="button" onClick={onRetry} className="text-xs font-medium underline underline-offset-2 cursor-pointer">
        Retry
      </button>
    )}
  </div>
);

export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) => (
  <div role="radiogroup" aria-label={label} className="inline-flex p-1 rounded-full bg-white/[0.04] border border-white/[0.06] max-w-full overflow-x-auto no-scrollbar">
    {options.map(o => (
      <button
        key={o.value}
        type="button"
        role="radio"
        aria-checked={value === o.value}
        onClick={() => onChange(o.value)}
        className={`h-8 px-3.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
          value === o.value ? 'bg-white text-slate-950' : 'text-slate-400 hover:text-white'
        }`}
      >
        {o.label}
      </button>
    ))}
  </div>
);

/** Loads an endpoint and exposes { data, error, loading, reload }. */
export function useAdminData<T>(loader: () => Promise<T>, deps: React.DependencyList = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loader()
      .then(d => !cancelled && setData(d))
      .catch(e => {
        if (e?.status === 401) window.dispatchEvent(new Event('mx-admin-401'));
        if (!cancelled) setError(e?.message || 'Could not load data.');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick(t => t + 1) };
}

// ---------------------------------------------------------------------------
// Single-series column chart (one hue, thin bars, rounded tops, hover tooltip, recessive axis)
// ---------------------------------------------------------------------------
export const ColumnChart: React.FC<{
  data: { label: string; value: number }[];
  height?: number;
  unit?: string;
  ariaLabel: string;
}> = ({ data, height = 180, unit = '', ariaLabel }) => {
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the container's real width so text stays 11px at every size
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(entries => setW(Math.max(200, Math.round(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const max = Math.max(1, ...data.map(d => d.value));
  const niceMax = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  const H = height;
  const padB = 22;
  const padT = 18;
  const n = data.length || 1;
  const slot = W / n;
  const barW = Math.max(3, Math.min(22, slot - 2)); // 2px surface gap between neighbours
  const plotH = H - padB - padT;
  const labelIdx = new Set([0, Math.floor((n - 1) / 2), n - 1]);
  const short = (l: string) => (/^\d{4}-\d{2}-\d{2}$/.test(l) ? new Date(`${l}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : l);

  return (
    <div ref={wrapRef} className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="w-full h-auto block" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {/* recessive gridlines: 0, half, max */}
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={0} x2={W} y1={padT + plotH * (1 - f)} y2={padT + plotH * (1 - f)} className="stroke-white/[0.06]" strokeWidth={1} />
            {f > 0 && (
              <text x={W - 2} y={padT + plotH * (1 - f) - 4} textAnchor="end" className="fill-slate-500" fontSize={11}>
                {fmtNum(Math.round(niceMax * f))}
              </text>
            )}
          </g>
        ))}
        {data.map((d, i) => {
          const h = (d.value / niceMax) * plotH;
          const x = i * slot + (slot - barW) / 2;
          const y = padT + plotH - h;
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={d.label}>
              {/* generous hit target */}
              <rect x={i * slot} y={padT} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => { setHover(i); setTimeout(() => setHover(h => (h === i ? null : h)), 2500); }} />
              {h > 0 && (
                <path
                  d={`M${x},${padT + plotH} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${padT + plotH} Z`}
                  className={hover === i ? 'fill-indigo-300' : 'fill-indigo-400'}
                  pointerEvents="none"
                />
              )}
              {labelIdx.has(i) && (
                <text x={i * slot + slot / 2} y={H - 5} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-slate-500" fontSize={11}>
                  {short(d.label)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && data[hover] && (
        <div
          className="pointer-events-none absolute -top-2 -translate-y-full -translate-x-1/2 rounded-xl bg-[var(--mx-surface-2)] border border-white/[0.1] px-2.5 py-1.5 text-xs shadow-lg whitespace-nowrap"
          style={{ left: `${((hover + 0.5) / n) * 100}%` }}
        >
          <span className="text-slate-400">{short(data[hover].label)}</span>{' '}
          <span className="font-semibold text-white tabular-nums">
            {fmtNum(data[hover].value)}
            {unit}
          </span>
        </div>
      )}
    </div>
  );
};

/** Ranked horizontal bars (single hue) with the value as text. */
export const RankBars: React.FC<{ rows: { name: string; count: number }[]; unit?: string }> = ({ rows, unit = '' }) => {
  const max = Math.max(1, ...rows.map(r => r.count));
  if (!rows.length) return <Empty>No data yet.</Empty>;
  return (
    <ol className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.name} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-5 text-[11px] text-slate-500 tabular-nums">{i + 1}</span>
              <span className="text-slate-200 font-medium truncate">{r.name}</span>
            </span>
            <span className="text-slate-300 tabular-nums shrink-0">
              {fmtNum(r.count)}
              {unit}
            </span>
          </div>
          <div className="mt-1.5 ml-7 h-1.5 rounded-full bg-white/[0.05] overflow-hidden">
            <div className="h-full rounded-full bg-indigo-400" style={{ width: `${Math.max(3, (r.count / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ol>
  );
};

/** Confirmation dialog used for destructive actions. */
export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}> = ({ open, title, body, confirmLabel, danger, busy, onConfirm, onCancel, children }) => {
  if (!open) return null;
  // Portaled so it always sits above sticky headers, whatever the parent's stacking context
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Cancel" className="absolute inset-0 bg-black/70 mx-fade-in cursor-default" onClick={onCancel} />
      <div className="mx-pop-in relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-[var(--mx-surface)] border border-white/[0.08] p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <div className="mt-2 text-sm text-slate-400 leading-relaxed">{body}</div>
        {children}
        <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2">
          <button type="button" onClick={onCancel} className="h-11 w-full sm:flex-1 rounded-xl border border-white/[0.1] text-sm text-slate-200 hover:bg-white/[0.05] cursor-pointer">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`h-11 w-full sm:flex-1 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer ${
              danger ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-white text-slate-950 hover:bg-slate-200'
            }`}
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
