import React, { useEffect, useRef, useState } from 'react';
import { BellRing, X, Target, ShieldAlert, Flag, Mail, Loader2, Check, Trash2, Sparkles, RefreshCw, Zap, Hand } from 'lucide-react';
import { PushToggle } from './PushToggle';
import type { PriceAlertItem, AlertLiveQuote, AlertMode } from '../types';
import { formatMarketPrice } from '../utils/formatPrice';

interface PriceAlertsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  enabled: boolean;
  alerts: PriceAlertItem[];
  loading: boolean;
  /** Approve (true, with the Auto / Manual choice) or switch off (false) live alerts */
  onConsent: (enabled: boolean, mode?: AlertMode) => Promise<void>;
  /** Auto (every signal watched by itself) or Manual (tap "Get price alert"); null = not chosen yet */
  mode?: AlertMode | null;
  onSetMode?: (mode: AlertMode) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  /** A setup waiting for approval (from an email link or a result card) */
  pendingSymbol?: string | null;
  /** Live prices of the markets being watched (from the last refresh) */
  liveQuotes?: Record<string, AlertLiveQuote>;
  /** When the list and prices were last loaded */
  checkedAt?: number | null;
  /** Reloads the alerts and live prices */
  onRefresh?: () => Promise<void>;
  /** The alert a notification or email link points at: scrolled into view and highlighted */
  focusId?: string | null;
}

const MODES: Array<{ id: AlertMode; icon: typeof Zap; title: string; text: string; tone: string }> = [
  { id: 'AUTO', icon: Zap, title: 'Auto', text: 'Every trade MarketX gives you from now on is watched by itself. No tapping needed.', tone: 'text-amber-200 bg-amber-500/15' },
  { id: 'MANUAL', icon: Hand, title: 'Manual', text: 'You pick: tap "Get price alert" on the trades you want watched.', tone: 'text-sky-200 bg-sky-500/15' },
];

/** The Auto / Manual question (asked once when alerts are turned on) */
const ModeChooser: React.FC<{ busy: string | null; onPick: (m: AlertMode) => void; current?: AlertMode | null }> = ({ busy, onPick, current }) => (
  <div className="space-y-2" role="radiogroup" aria-label="How should price alerts work?">
    {MODES.map(({ id, icon: Icon, title, text, tone }) => (
      <button
        key={id}
        type="button"
        role="radio"
        aria-checked={current === id}
        disabled={!!busy}
        onClick={() => onPick(id)}
        className={`w-full flex items-center gap-3 p-3 rounded-2xl text-left border transition cursor-pointer disabled:opacity-70 ${
          current === id ? 'bg-white/[0.07] border-sky-400/50' : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]'
        }`}
      >
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
          {busy === `mode-${id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-white">{title}</span>
          <span className="block text-xs text-slate-400 leading-relaxed">{text}</span>
        </span>
      </button>
    ))}
  </div>
);

const fmt = (p: number) => (Number.isFinite(p) ? formatMarketPrice(p) : '');
const ago = (ts: number) => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

function status(a: PriceAlertItem): { text: string; tone: string } {
  const has = (k: string) => a.hits.some(h => h.kind === k);
  if (!a.active) {
    if (a.endedReason === 'SL' || has('SL')) return { text: 'Closed · stop loss hit', tone: 'text-rose-300' };
    if (a.endedReason === 'MISSED') return { text: 'Closed · moved before entry', tone: 'text-slate-400' };
    if (a.endedReason === 'TP3' || has(`TP${a.tps.length}`)) return { text: 'Closed · every target hit', tone: 'text-emerald-300' };
    if (a.endedReason === 'EXPIRED') return { text: 'Expired', tone: 'text-slate-500' };
    return { text: 'Turned off', tone: 'text-slate-500' };
  }
  if (!a.entered) return { text: `Waiting for entry ${fmt(a.entry.min)} to ${fmt(a.entry.max)}`, tone: 'text-sky-300' };
  const next = a.tps.findIndex((_, i) => !has(`TP${i + 1}`));
  return { text: next >= 0 ? `In play · next TP${next + 1} at ${fmt(a.tps[next])}` : 'In play', tone: 'text-emerald-300' };
}

/** Entry → TP1 → TP2 → TP3 rail, with the stop loss at the start; reached levels light up */
const Rail: React.FC<{ a: PriceAlertItem }> = ({ a }) => {
  const has = (k: string) => a.hits.some(h => h.kind === k);
  const nodes = [
    { k: 'SL', label: 'SL', price: a.stop, on: has('SL'), tone: 'bg-rose-400 shadow-[0_0_12px_rgba(251,113,133,.8)]' },
    { k: 'ENTRY', label: 'Entry', price: a.entry.optimal, on: a.entered, tone: 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,.8)]' },
    ...a.tps.map((p, i) => ({ k: `TP${i + 1}`, label: `TP${i + 1}`, price: p, on: has(`TP${i + 1}`), tone: 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.8)]' })),
  ];
  const lit = nodes.filter(n => n.on && n.k !== 'SL').length;
  const pct = nodes.length > 2 ? Math.max(0, lit - 1) / (nodes.length - 2) : 0;
  return (
    <div className="relative mt-3 px-1">
      <div className="absolute left-[calc(12.5%)] right-[6%] top-[7px] h-[2px] rounded-full bg-white/[0.08]" />
      <div className="absolute left-[calc(12.5%)] top-[7px] h-[2px] rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-[width] duration-700" style={{ width: `${pct * 81.5}%` }} />
      <div className="relative grid" style={{ gridTemplateColumns: `repeat(${nodes.length}, minmax(0, 1fr))` }}>
        {nodes.map(n => (
          <div key={n.k} className="flex flex-col items-center min-w-0">
            <span className={`w-4 h-4 rounded-full border-2 border-[var(--mx-bg-2)] ${n.on ? n.tone : n.k === 'SL' ? 'bg-rose-500/25' : 'bg-white/[0.12]'}`} />
            <span className={`mt-1.5 text-[10px] font-semibold ${n.on ? 'text-white' : 'text-slate-500'}`}>{n.label}</span>
            <span className="text-[10px] font-mono text-slate-500 truncate max-w-full">{fmt(n.price)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Where price sits now against the trade: distance to the entry zone, or to the next target and the stop */
function livePosition(a: PriceAlertItem, price: number): { text: string; tone: string } {
  const long = a.direction === 'LONG';
  const pct = (to: number) => Math.abs(((to - price) / price) * 100);
  const f = (n: number) => (n < 0.1 ? n.toFixed(2) : n.toFixed(1));
  const has = (k: string) => a.hits.some(h => h.kind === k);
  if (!a.entered) {
    const inZone = price >= a.entry.min && price <= a.entry.max;
    if (inZone) return { text: 'Inside the entry zone now', tone: 'text-sky-300' };
    const edge = long ? a.entry.max : a.entry.min;
    return { text: `${f(pct(edge))}% from the entry zone`, tone: 'text-slate-300' };
  }
  const next = a.tps.findIndex((_, i) => !has(`TP${i + 1}`));
  const inProfit = long ? price >= a.entry.optimal : price <= a.entry.optimal;
  const pnl = ((price - a.entry.optimal) / a.entry.optimal) * 100 * (long ? 1 : -1);
  const parts = [`${pnl >= 0 ? '+' : ''}${f(pnl)}% from entry`];
  if (next >= 0) parts.push(`${f(pct(a.tps[next]))}% to TP${next + 1}`);
  parts.push(`${f(pct(a.stop))}% to SL`);
  return { text: parts.join(' · '), tone: inProfit ? 'text-emerald-300' : 'text-amber-300' };
}

export const PriceAlertsPanel: React.FC<PriceAlertsPanelProps> = ({ isOpen, onClose, enabled, alerts, loading, onConsent, onRemove, pendingSymbol, liveQuotes = {}, checkedAt, onRefresh, focusId, mode = null, onSetMode }) => {
  const [busy, setBusy] = useState<string | null>(null);
  // Turning alerts on asks Auto or Manual first
  const [askMode, setAskMode] = useState(false);
  useEffect(() => {
    if (!isOpen) setAskMode(false);
  }, [isOpen]);
  const [refreshing, setRefreshing] = useState(false);
  // Re-render the "updated … ago" label every 15s while the panel is open
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isOpen) return;
    const t = setInterval(() => setTick(x => x + 1), 15000);
    return () => clearInterval(t);
  }, [isOpen]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Bring the alert a notification points at into view once it is listed
  const focusListed = !!focusId && alerts.some(a => a.id === focusId);
  useEffect(() => {
    if (!isOpen || !focusListed) return;
    const t = setTimeout(() => document.getElementById(`alert-card-${focusId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
    return () => clearTimeout(t);
  }, [isOpen, focusListed, focusId]);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);
  if (!isOpen) return null;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const active = alerts.filter(a => a.active);
  const recent = alerts.filter(a => !a.active).slice(0, 8);
  const refresh = async () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  const updated = checkedAt ? (Date.now() - checkedAt < 30000 ? 'Updated just now' : `Updated ${ago(checkedAt)}`) : '';

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Price alerts">
      <button type="button" aria-label="Close price alerts" onClick={onClose} className="absolute inset-0 bg-black/60 mx-fade-in cursor-default" />
      <section className="mx-sheet absolute inset-x-0 bottom-0 max-h-[90dvh] sm:inset-y-3 sm:right-3 sm:left-auto sm:bottom-3 sm:max-h-none sm:w-[440px] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[var(--mx-bg-2)] border border-white/[0.08] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)] overflow-hidden">
        <div className="sm:hidden flex justify-center pt-2.5" aria-hidden="true">
          <span className="w-10 h-1 rounded-full bg-white/15" />
        </div>
        <header className="flex items-center gap-2.5 px-5 pt-4 sm:pt-5 pb-3">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500/25 to-violet-500/25 border border-white/[0.08] flex items-center justify-center">
            <BellRing className="w-4 h-4 text-sky-200" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white tracking-tight leading-tight">Price alerts</h2>
            <p className="text-[11px] text-slate-500">{enabled ? `${active.length} active · watched by MarketX` : 'Live updates on your setups'}</p>
          </div>
          {enabled && (
            <button
              type="button"
              role="switch"
              aria-checked="true"
              aria-label="Live price alerts on"
              disabled={!!busy}
              onClick={() => run('off', () => onConsent(false))}
              className="ml-auto h-7 w-12 rounded-full bg-emerald-500/80 relative transition-colors cursor-pointer disabled:opacity-60"
              title="Turn off price alerts"
            >
              <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white shadow" />
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className={`${enabled ? '' : 'ml-auto'} w-8 h-8 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] flex items-center justify-center cursor-pointer`}>
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-5 border-t border-white/[0.05]">
          {!enabled ? (
            // Consent: the trader approves live updates before anything is watched
            <div className="pt-6 text-center">
              <div className="relative mx-auto w-24 h-24">
                <span className="absolute inset-0 rounded-full bg-sky-400/20 animate-ping [animation-duration:2.4s]" />
                <span className="absolute inset-2 rounded-full bg-gradient-to-br from-sky-400/30 to-violet-500/30 border border-white/10" />
                <span className="absolute inset-0 flex items-center justify-center">
                  <BellRing className="w-9 h-9 text-white" />
                </span>
              </div>
              <h3 className="mt-5 text-xl font-semibold text-white tracking-tight">Get live price alerts</h3>
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed px-2">
                {pendingSymbol ? `Approve alerts to start watching your ${pendingSymbol} setup. ` : ''}
                MarketX watches the market for you and tells you the moment price reaches your setup.
              </p>
              <ul className="mt-5 space-y-2 text-left">
                {[
                  { icon: Target, tone: 'text-sky-300 bg-sky-500/10', t: 'Entry zone reached', d: 'Price arrives at the POI of your analysis' },
                  { icon: Flag, tone: 'text-emerald-300 bg-emerald-500/10', t: 'Every target hit', d: 'TP1, TP2 and TP3 as they happen' },
                  { icon: ShieldAlert, tone: 'text-rose-300 bg-rose-500/10', t: 'Stop loss hit', d: 'So you always know where the trade stands' },
                  { icon: Mail, tone: 'text-violet-300 bg-violet-500/10', t: 'In your notifications and by email', d: 'The market is watched on our servers, not your phone' },
                ].map(({ icon: Icon, tone, t, d }) => (
                  <li key={t} className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-white">{t}</span>
                      <span className="block text-xs text-slate-500">{d}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {askMode ? (
                <div className="mt-5 text-left">
                  <p className="px-1 pb-2 text-sm font-semibold text-white">How should alerts work?</p>
                  <ModeChooser busy={busy} onPick={m => run(`mode-${m}`, () => onConsent(true, m))} />
                  <p className="mt-2 px-1 text-[11px] text-slate-500">You can switch between Auto and Manual any time in this panel.</p>
                </div>
              ) : (
              <button
                type="button"
                disabled={!!busy}
                onClick={() => setAskMode(true)}
                className="mt-5 w-full h-12 rounded-2xl bg-gradient-to-r from-sky-500 to-violet-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-[0_12px_40px_-12px_rgba(99,102,241,.8)] hover:brightness-110 active:scale-[0.99] transition cursor-pointer disabled:opacity-70"
              >
                {busy === 'on' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Approve price alerts
              </button>
              )}
              <button type="button" onClick={onClose} className="mt-2 w-full h-10 rounded-2xl text-sm text-slate-400 hover:text-white cursor-pointer">
                Not now
              </button>
              <p className="mt-2 text-[11px] text-slate-500">Switch alerts off any time.</p>
            </div>
          ) : (
            <>
            {!mode ? (
              <div className="mt-4 p-3.5 rounded-2xl bg-gradient-to-br from-sky-500/10 to-violet-500/10 border border-white/[0.08]">
                <p className="text-sm font-semibold text-white">How should alerts work?</p>
                <p className="mt-0.5 mb-3 text-xs text-slate-400">Pick once. You can change it any time here.</p>
                <ModeChooser busy={busy} onPick={m => onSetMode && run(`mode-${m}`, () => onSetMode(m))} />
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2 px-1">
                <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Mode</span>
                <div className="ml-auto inline-flex p-0.5 rounded-full bg-white/[0.05] border border-white/[0.08]" role="radiogroup" aria-label="Alert mode">
                  {MODES.map(({ id, icon: Icon, title }) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={mode === id}
                      disabled={!!busy || mode === id}
                      onClick={() => onSetMode && run(`mode-${id}`, () => onSetMode(id))}
                      title={id === 'AUTO' ? 'Every new trade is watched by itself' : 'Tap "Get price alert" on the trades you want'}
                      className={`h-7 px-3 rounded-full text-[11px] font-semibold inline-flex items-center gap-1.5 transition cursor-pointer disabled:cursor-default ${
                        mode === id ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {busy === `mode-${id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
                      {title}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <PushToggle what="alert hits" />
            {loading && !alerts.length ? (
            <div className="py-16 flex justify-center text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : !alerts.length ? (
            <div className="py-12 text-center px-6">
              <span className="mx-auto w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-sky-300" />
              </span>
              <p className="mt-3 text-sm font-medium text-slate-200">Alerts are on</p>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                {mode === 'AUTO' ? (
                  <>Your next trade from MarketX is watched by itself: entry zone, stop loss and every target.</>
                ) : (
                  <>Tap <span className="text-white font-medium">Get price alert</span> on any analysis and MarketX will watch its entry zone, stop loss and targets for you.</>
                )}
              </p>
            </div>
          ) : (
            <div className="pt-3 space-y-5">
              {active.length > 0 && (
                <div>
                  <div className="px-1 pb-2 flex items-center gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Watching now</span>
                    {updated && <span className="text-[11px] text-slate-500 normal-case">· {refreshing ? 'Updating…' : updated}</span>}
                    {onRefresh && (
                      <button
                        type="button"
                        onClick={refresh}
                        disabled={refreshing}
                        aria-label="Refresh your alerts and live prices"
                        title="Refresh"
                        className="ml-auto h-7 pl-2 pr-2.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-[11px] font-medium text-slate-200 hover:text-white hover:bg-white/[0.09] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-70"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                    )}
                  </div>
                  <div className="space-y-2.5">
                    {active.map(a => (
                      <AlertCard key={a.id} a={a} focused={a.id === focusId} quote={liveQuotes[a.symbol]} busy={busy === a.id} onRemove={() => run(a.id, () => onRemove(a.id))} />
                    ))}
                  </div>
                </div>
              )}
              {recent.length > 0 && (
                <div>
                  <div className="px-1 pb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">Recent</div>
                  <div className="space-y-2.5 opacity-80">{recent.map(a => <AlertCard key={a.id} a={a} focused={a.id === focusId} />)}</div>
                </div>
              )}
            </div>
            )}
            </>
          )}
        </div>
      </section>
    </div>
  );
};

const AlertCard: React.FC<{ a: PriceAlertItem; quote?: AlertLiveQuote; busy?: boolean; onRemove?: () => void; focused?: boolean }> = ({ a, quote, busy, onRemove, focused }) => {
  const s = status(a);
  const pos = a.active && quote ? livePosition(a, quote.price) : null;
  const long = a.direction === 'LONG';
  return (
    <div id={`alert-card-${a.id}`} className={`relative p-3.5 rounded-2xl border transition-shadow ${a.active ? 'bg-white/[0.035] border-white/[0.08]' : 'bg-white/[0.02] border-white/[0.05]'} ${focused ? 'ring-2 ring-sky-400/70 shadow-[0_0_40px_-8px_rgba(56,189,248,.6)]' : ''}`}>
      <div className="flex items-center gap-2">
        {a.active && <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,.15)] animate-pulse" aria-hidden="true" />}
        <span className="text-sm font-semibold text-white font-mono">{a.symbol}</span>
        <span className={`h-5 px-2 rounded-full text-[10px] font-bold inline-flex items-center ${long ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
          {long ? 'BUY' : 'SELL'}{a.execution === 'MARKET' ? '' : ' LIMIT'}
        </span>
        <span className="h-5 px-1.5 rounded-md bg-white/[0.06] text-[10px] font-mono text-slate-300 inline-flex items-center">{a.timeframe}</span>
        <span className="ml-auto text-[11px] text-slate-500">{ago(a.createdAt)}</span>
        {onRemove && (
          <button type="button" onClick={onRemove} disabled={busy} aria-label={`Turn off the ${a.symbol} alert`} title="Turn off this alert" className="w-7 h-7 -mr-1 rounded-full text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 flex items-center justify-center cursor-pointer disabled:opacity-50">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      <div className={`mt-1.5 text-xs font-medium ${s.tone}`}>{s.text}</div>
      {quote && pos && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl bg-white/[0.03] border border-white/[0.06] px-2.5 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Live</span>
          <span className="text-xs font-mono font-semibold text-white">{fmt(quote.price)}</span>
          <span className={`text-[11px] font-mono ${quote.change24h >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {quote.change24h >= 0 ? '+' : ''}
            {quote.change24h.toFixed(2)}% today
          </span>
          <span className={`basis-full text-[11px] ${pos.tone}`}>{pos.text}</span>
        </div>
      )}
      <Rail a={a} />
    </div>
  );
};

export default PriceAlertsPanel;
