import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bot, CheckCircle2, ChevronDown, CircleDot, Clock, Crown, Info, Link2, Loader2, Lock, Minus, Plug, Plus, Power, RefreshCw, ShieldAlert, Square, Target, Unlink, X, XCircle } from 'lucide-react';
import { apiFetch, formatMoney } from '../utils/apiClient';
import { exactPrice } from '../utils/formatPrice';
import {
  AGENT_FRAMES, AGENT_LIMITS, AGENT_PRICING, AGENT_STYLE_INFO, DEFAULT_AGENT_SETTINGS, ENDED_TEXT, agentMaxCost, normalizeAgentSettings,
  type AgentDuration, type AgentLogEntry, type AgentRunView, type AgentSettings, type AgentStats, type AgentStyle, type AgentTradeView,
} from '../utils/tradingAgent';
import { MT5_BROKER_SERVERS, suggestMt5Servers } from '../utils/mt5Servers';

/** MT5 server box with suggestions: common brokers' servers at once, then the live server directory as the trader types */
const Mt5ServerInput: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<Array<{ broker: string; server: string }>>([]);
  const [active, setActive] = useState(-1);
  const local = useMemo(
    () => (value.trim() ? suggestMt5Servers(value, 12) : MT5_BROKER_SERVERS.slice(0, 10).map(b => ({ broker: b.broker, server: b.servers[0] }))),
    [value]
  );
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) return setLive([]);
    const t = setTimeout(() => {
      apiFetch<{ servers: Array<{ broker: string; server: string }> }>(`/api/agent/mt5/servers?q=${encodeURIComponent(q)}`)
        .then(r => setLive(r.servers || []))
        .catch(() => setLive([]));
    }, 300);
    return () => clearTimeout(t);
  }, [value]);
  const items = useMemo(() => {
    const seen = new Set<string>();
    return [...local, ...live].filter(x => {
      const k = x.server.toLowerCase();
      if (seen.has(k) || k === value.trim().toLowerCase()) return false;
      seen.add(k);
      return true;
    }).slice(0, 12);
  }, [local, live, value]);
  const pick = (server: string) => {
    onChange(server);
    setOpen(false);
    setActive(-1);
  };
  return (
    <div className="relative">
      <input
        value={value}
        onChange={e => {
          onChange(e.target.value.slice(0, 80));
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (!open || !items.length) return;
          if (e.key === 'ArrowDown') (e.preventDefault(), setActive(i => Math.min(items.length - 1, i + 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setActive(i => Math.max(0, i - 1)));
          else if (e.key === 'Enter' && active >= 0) (e.preventDefault(), pick(items[active].server));
          else if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Server, e.g. Exness-MT5Real8"
        aria-label="MT5 server"
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-autocomplete="list"
        className="w-full h-9 px-3 rounded-xl bg-black/25 border border-white/[0.08] text-sm text-white placeholder:text-slate-500 outline-none focus:border-emerald-400/40"
      />
      {open && items.length > 0 && (
        <ul role="listbox" className="absolute z-30 left-0 right-0 sm:right-auto sm:min-w-[260px] mt-1 max-h-60 overflow-y-auto rounded-xl border border-white/[0.1] bg-[var(--mx-surface-2,#141821)] shadow-xl py-1">
          {!value.trim() && <li className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-slate-500">Popular brokers · type to search</li>}
          {items.map((x, i) => (
            <li key={x.server} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => pick(x.server)}
                className={`w-full text-left px-3 py-1.5 flex items-center justify-between gap-3 cursor-pointer ${i === active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'}`}
              >
                <span className="text-[13px] text-white truncate">{x.server}</span>
                {x.broker && <span className="text-[10px] text-slate-500 shrink-0">{x.broker}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// Trading agent (/trading-agent, owner-specified): its own interface. The trader sets it up (trade type, timeframes,
// markets, risk per trade, profit target, loss limit, trades per day, run length with its credit cost) and switches it
// on; the agent then finds, places and manages trades on its own (Steady mode) and alerts the trader at every step.
// Tabs: Setup, Trades (win rate + history), Activity (what the agent did).
interface AgentState {
  settings: AgentSettings;
  run: AgentRunView | null;
  trades: AgentTradeView[];
  stats: AgentStats;
  log: AgentLogEntry[];
  markets: Array<{ symbol: string; label: string; mt5: string }>;
  pricing: typeof AGENT_PRICING;
  minQuality: number;
  backtest: { won: number; avgR: number; profitFactor: number; maxDrawdownR: number; worstRun: number; tradesPerMonth: number };
  credits: number | null;
  /** Pro gives the agent (free for everyone until the Pro date); credits are still used per trade */
  access: { allowed: boolean; staff: boolean; freeUntil: number | null };
  mt5: {
    available: boolean;
    link: null | { status: 'CONNECTING' | 'CONNECTED' | 'FAILED'; asleep?: boolean; login: string; server: string; broker: string | null; currency: string | null; balance: number | null; symbols: Record<string, string | null>; message: string; linkedAt: number };
  };
}
type Tab = 'setup' | 'trades' | 'activity';

const sign = (n: number, d = 2) => `${n > 0 ? '+' : ''}${n.toFixed(d)}`;
const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const left = (t: number) => {
  const m = Math.max(0, Math.round((t - Date.now()) / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};

const STATE_CHIP: Record<string, { text: string; cls: string }> = {
  PENDING: { text: 'Waiting to fill', cls: 'bg-sky-500/15 text-sky-300' },
  OPEN: { text: 'Open', cls: 'bg-violet-500/15 text-violet-300' },
  WIN: { text: 'Won', cls: 'bg-emerald-500/15 text-emerald-300' },
  LOSS: { text: 'Lost', cls: 'bg-rose-500/15 text-rose-300' },
  TIMEOUT: { text: 'Closed', cls: 'bg-slate-500/15 text-slate-300' },
  CANCELLED: { text: 'Cancelled', cls: 'bg-slate-500/10 text-slate-400' },
};
const chipOf = (t: AgentTradeView) => STATE_CHIP[t.state === 'CLOSED' ? t.result || 'TIMEOUT' : t.state];
const LOG_ICON: Record<AgentLogEntry['kind'], { icon: React.ElementType; cls: string }> = {
  START: { icon: Power, cls: 'text-emerald-300' },
  SCAN: { icon: Activity, cls: 'text-slate-400' },
  ORDER: { icon: CircleDot, cls: 'text-sky-300' },
  FILL: { icon: Target, cls: 'text-violet-300' },
  WIN: { icon: CheckCircle2, cls: 'text-emerald-300' },
  LOSS: { icon: XCircle, cls: 'text-rose-300' },
  CLOSE: { icon: Square, cls: 'text-slate-300' },
  CANCEL: { icon: Minus, cls: 'text-slate-400' },
  STOP: { icon: Square, cls: 'text-amber-300' },
  END: { icon: Clock, cls: 'text-slate-300' },
  PAUSE: { icon: ShieldAlert, cls: 'text-amber-300' },
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="rounded-2xl bg-black/20 border border-white/[0.06] px-3 py-2.5 min-w-0">
      <p className="text-[10px] uppercase tracking-wider text-slate-500 truncate">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums truncate ${tone === 'up' ? 'text-emerald-300' : tone === 'down' ? 'text-rose-300' : 'text-white'}`}>{value}</p>
    </div>
  );
}

function Stepper({ value, min, max, step, onChange, suffix, disabled, label }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix?: string; disabled?: boolean; label: string }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Number((Math.round(v / step) * step).toFixed(2)))));
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" disabled={disabled || value <= min} onClick={() => set(value - step)} aria-label={`Less ${label}`} className="w-8 h-8 rounded-full bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-slate-300 hover:bg-white/[0.1] disabled:opacity-40 cursor-pointer">
        <Minus className="w-3.5 h-3.5" />
      </button>
      <span className="min-w-[4.5rem] text-center text-sm font-semibold text-white tabular-nums">
        {value === 0 && suffix === '%' && min === 0 ? 'None' : `${value}${suffix || ''}`}
      </span>
      <button type="button" disabled={disabled || value >= max} onClick={() => set(value + step)} aria-label={`More ${label}`} className="w-8 h-8 rounded-full bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-slate-300 hover:bg-white/[0.1] disabled:opacity-40 cursor-pointer">
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="py-3 border-b border-white/[0.05] last:border-0">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white">{title}</p>
          {hint && <p className="text-[11px] text-slate-500">{hint}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function TradingAgentPanel({ isOpen, onClose, focusId, onBuyCredits, onUpgrade }: { isOpen: boolean; onClose: () => void; focusId?: string | null; onBuyCredits?: () => void; onUpgrade?: () => void }) {
  const [data, setData] = useState<AgentState | null>(null);
  const [draft, setDraft] = useState<AgentSettings>(DEFAULT_AGENT_SETTINGS);
  const [tab, setTab] = useState<Tab>('setup');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [showBacktest, setShowBacktest] = useState(false);
  const [mt5Form, setMt5Form] = useState({ login: '', server: '', password: '', consent: false });
  const listRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const running = data?.run?.state === 'RUNNING';

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const d = await apiFetch<AgentState>('/api/agent');
      setData(d);
      setDraft(prev => (quiet ? prev : d.run?.state === 'RUNNING' ? d.run.settings : d.settings));
      setError('');
    } catch (e: any) {
      if (!quiet) setError(e?.message || 'Could not load the trading agent.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    load();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, load]);
  // While the agent runs, the panel follows it (every 20s while the tab is visible)
  useEffect(() => {
    if (!isOpen || !(running || data?.mt5?.link?.status === 'CONNECTING')) return;
    const id = setInterval(() => document.visibilityState === 'visible' && load(true), 20_000);
    return () => clearInterval(id);
  }, [isOpen, running, data?.mt5?.link?.status, load]);
  // A notification's trade: open the Trades tab and ring it
  useEffect(() => {
    if (!isOpen || !focusId || !data) return;
    setTab('trades');
    const t = setTimeout(() => listRef.current?.querySelector(`[data-trade="${focusId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
    return () => clearTimeout(t);
  }, [isOpen, focusId, data]);

  const check = useMemo(() => normalizeAgentSettings(draft), [draft]);
  const price = AGENT_PRICING[draft.duration];
  const maxCost = agentMaxCost(draft);
  const credits = data?.credits ?? null;
  const short = credits !== null && credits < price.perTrade;

  const patch = (p: Partial<AgentSettings>) => setDraft(d => ({ ...d, ...p }));
  const setStyle = (style: AgentStyle) => patch({ style, timeframes: AGENT_FRAMES[style] });
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const start = async () => {
    if (!check.ok) return setError((check as { message: string }).message);
    setBusy(true);
    setError('');
    try {
      setData(await apiFetch<AgentState>('/api/agent/start', { method: 'POST', body: JSON.stringify({ settings: check.settings }) }));
      setTab('activity');
    } catch (e: any) {
      setError(e?.message || 'Could not start the agent.');
    } finally {
      setBusy(false);
    }
  };
  const stop = async (closeOpen: boolean) => {
    setBusy(true);
    setError('');
    try {
      setData(await apiFetch<AgentState>('/api/agent/stop', { method: 'POST', body: JSON.stringify({ closeOpen }) }));
      setConfirmStop(false);
    } catch (e: any) {
      setError(e?.message || 'Could not stop the agent.');
    } finally {
      setBusy(false);
    }
  };

  const connectMt5 = async () => {
    setBusy(true);
    setError('');
    try {
      setData(await apiFetch<AgentState>('/api/agent/mt5/connect', { method: 'POST', body: JSON.stringify(mt5Form), timeoutMs: 90_000 }));
      setMt5Form(f => ({ ...f, password: '' }));
    } catch (e: any) {
      setError(e?.message || 'Could not link MT5.');
      setMt5Form(f => ({ ...f, password: '' }));
    } finally {
      setBusy(false);
    }
  };
  const mt5Action = async (path: string, method: 'POST' | 'DELETE') => {
    setBusy(true);
    setError('');
    try {
      setData(await apiFetch<AgentState>(path, { method }));
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  if (!isOpen) return null;
  const run = data?.run || null;
  const access = data?.access;
  const allowed = !!access?.allowed;
  const link = data?.mt5?.link || null;
  const rs = run?.stats;
  const openTrades = (data?.trades || []).filter(t => t.state === 'OPEN' || t.state === 'PENDING');
  const marketLabel = (s: string) => data?.markets.find(m => m.symbol === s);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Trading agent">
      <button type="button" aria-label="Close trading agent" onClick={onClose} className="absolute inset-0 bg-black/60 mx-fade-in cursor-default" />
      <section className="mx-sheet absolute inset-x-0 bottom-0 max-h-[94dvh] sm:inset-y-3 sm:right-3 sm:left-auto sm:bottom-3 sm:max-h-none sm:w-[500px] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[var(--mx-bg-2)] border border-white/[0.08] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)] overflow-hidden">
        <div className="sm:hidden flex justify-center pt-2.5" aria-hidden="true">
          <span className="w-10 h-1 rounded-full bg-white/15" />
        </div>
        <header className="flex items-center gap-2.5 px-5 pt-4 sm:pt-5 pb-3">
          <span className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400/25 to-cyan-500/25 border border-white/[0.08] flex items-center justify-center shrink-0">
            <Bot className="w-4 h-4 text-emerald-300" />
            {running && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-[var(--mx-bg-2)] animate-pulse" />}
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white tracking-tight leading-tight">Trading Agent</h2>
            <p className="text-[11px] text-slate-500 truncate">Finds, places and manages trades for you, and tells you every step</p>
          </div>
          <button type="button" onClick={() => load()} disabled={loading} className="ml-auto w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] cursor-pointer disabled:opacity-50" aria-label="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] cursor-pointer" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5 space-y-4">
          {!data && loading && (
            <div className="py-16 flex justify-center text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          )}
          {data && (
            <>
              {/* Status */}
              <div className={`rounded-3xl border p-4 ${running ? 'border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.08] to-cyan-500/[0.04]' : 'border-white/[0.07] bg-white/[0.03]'}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${running ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                  <p className="text-sm font-semibold text-white">
                    {running ? `Running · ${AGENT_PRICING[run!.settings.duration].label} run` : run ? ENDED_TEXT[run.endedReason || 'TIME_UP'] : 'Off'}
                  </p>
                  {running && <span className="ml-auto text-[11px] text-slate-400 tabular-nums">ends in {left(run!.endsAt)}</span>}
                </div>
                {run ? (
                  <>
                    <p className="mt-1 text-[11px] text-slate-500 truncate">
                      {run.settings.markets.map(m => marketLabel(m)?.label || m).join(', ')} · {run.settings.timeframes.join(' + ')} · risk {run.settings.riskPct}% · up to {run.settings.tradesPerDay}/day · {run.perTrade} credits a trade, {run.maxCredits} at most
                    </p>
                    <div className="mt-3 grid grid-cols-4 gap-2">
                      <Stat label="Won" value={rs!.trades ? `${rs!.winRate}%` : '–'} />
                      <Stat label="Result" value={rs!.trades ? `${sign(rs!.totalR)}R` : '–'} tone={rs!.totalR > 0 ? 'up' : rs!.totalR < 0 ? 'down' : undefined} />
                      <Stat label="P/L" value={rs!.trades ? `${sign(rs!.pnlPct)}%` : '–'} tone={rs!.pnlPct > 0 ? 'up' : rs!.pnlPct < 0 ? 'down' : undefined} />
                      <Stat label="Credits" value={String(run.creditsUsed)} />
                    </div>
                    {running && (
                      <p className="mt-2.5 text-[11px] text-slate-400">
                        {openTrades.length ? `${openTrades.length} order${openTrades.length === 1 ? '' : 's'}/trade${openTrades.length === 1 ? '' : 's'} live. ` : 'Watching your markets for a clean setup. '}
                        It only trades setups of quality {data.minQuality}+, so some days it takes none.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-500">Set it up below and switch it on for a day, a week or a month.</p>
                )}
                {running &&
                  (confirmStop ? (
                    <div className="mt-3 rounded-2xl bg-black/25 border border-white/[0.08] p-3 space-y-2">
                      <p className="text-xs text-slate-300">Stop the agent? Orders waiting to fill are cancelled (no credits used).</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" disabled={busy} onClick={() => stop(false)} className="px-3 h-8 rounded-full bg-white/[0.08] text-xs font-medium text-white hover:bg-white/[0.14] cursor-pointer disabled:opacity-50">
                          Stop, keep open trades
                        </button>
                        <button type="button" disabled={busy} onClick={() => stop(true)} className="px-3 h-8 rounded-full bg-rose-500/20 text-xs font-medium text-rose-200 hover:bg-rose-500/30 cursor-pointer disabled:opacity-50">
                          Stop and close them now
                        </button>
                        <button type="button" onClick={() => setConfirmStop(false)} className="px-3 h-8 rounded-full text-xs text-slate-400 hover:text-white cursor-pointer">
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmStop(true)} className="mt-3 w-full h-10 rounded-2xl bg-white/[0.06] border border-white/[0.08] text-sm font-medium text-white hover:bg-white/[0.1] cursor-pointer flex items-center justify-center gap-2">
                      <Square className="w-3.5 h-3.5" /> Stop agent
                    </button>
                  ))}
              </div>

              {/* Pro: the agent is part of Pro (free for everyone until the Pro date); credits are used per trade */}
              {access && !allowed && (
                <div className="rounded-3xl border border-violet-400/30 bg-gradient-to-br from-violet-500/[0.12] to-fuchsia-500/[0.06] p-4">
                  <div className="flex items-center gap-2">
                    <Crown className="w-4 h-4 text-violet-300" />
                    <p className="text-sm font-semibold text-white">The Trading Agent is part of Pro</p>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">Upgrade to Pro to switch it on. Credits are used per trade the agent takes.</p>
                  {onUpgrade && (
                    <button type="button" onClick={onUpgrade} className="mt-3 w-full h-10 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-semibold text-white hover:brightness-110 cursor-pointer flex items-center justify-center gap-2">
                      <Lock className="w-4 h-4" /> Upgrade to Pro
                    </button>
                  )}
                </div>
              )}
              {access && allowed && !access.staff && access.freeUntil && (
                <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <Crown className="w-3.5 h-3.5 text-violet-300" /> Free for everyone until{' '}
                  {new Date(access.freeUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, then part of Pro.
                </p>
              )}

              {/* MT5 */}
              <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                <div className="flex gap-3">
                  <span className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 ${link?.status === 'CONNECTED' ? 'bg-emerald-500/15 border-emerald-500/25' : 'bg-amber-500/15 border-amber-500/25'}`}>
                    <Plug className={`w-4 h-4 ${link?.status === 'CONNECTED' ? 'text-emerald-300' : 'text-amber-300'}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">
                      {link?.status === 'CONNECTED' ? `MT5 linked · ${link.login}` : link?.status === 'CONNECTING' ? 'Linking your MT5…' : 'MT5: not linked'}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
                      {link?.status === 'CONNECTED'
                        ? `${link.broker || link.server}${link.balance != null && link.currency ? ` · balance ${formatMoney(link.balance, link.currency)}` : ''}. The agent places its trades here, sized to your risk per trade.${link.asleep ? ' Resting while the agent is off: it reconnects by itself when you start a run.' : ''}`
                        : link?.status === 'CONNECTING'
                          ? 'Signing in to your broker. This takes up to a minute or two.'
                          : link?.status === 'FAILED'
                            ? link.message || 'Linking failed. Check your details and try again.'
                            : data.mt5.available
                              ? 'Link your MT5 account and the agent places its trades there. Until then MarketX tracks each trade and alerts you with the exact order.'
                              : 'MT5 linking is being set up. Until then MarketX tracks each trade and alerts you with the exact order to place.'}
                    </p>
                  </div>
                </div>
                {link?.status === 'CONNECTED' && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {Object.entries(link.symbols).map(([m, bs]) => (
                      <span key={m} className={`text-[10px] px-2 py-0.5 rounded-full border ${bs ? 'border-emerald-500/25 text-emerald-200' : 'border-white/[0.08] text-slate-500'}`}>
                        {marketLabel(m)?.label || m}: {bs || 'not at your broker'}
                      </span>
                    ))}
                  </div>
                )}
                {link && (
                  <div className="mt-2.5 flex gap-2">
                    {link.status !== 'FAILED' && (
                      <button type="button" disabled={busy} onClick={() => mt5Action('/api/agent/mt5/refresh', 'POST')} className="px-3 h-8 rounded-full bg-white/[0.06] text-xs text-white hover:bg-white/[0.1] cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                        <RefreshCw className="w-3 h-3" /> Check
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={() => mt5Action('/api/agent/mt5', 'DELETE')} className="px-3 h-8 rounded-full bg-white/[0.06] text-xs text-slate-300 hover:bg-white/[0.1] cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                      <Unlink className="w-3 h-3" /> {link.status === 'FAILED' ? 'Clear' : 'Disconnect'}
                    </button>
                  </div>
                )}
                {(!link || link.status === 'FAILED') && data.mt5.available && allowed && (
                  <form
                    className="mt-3 space-y-2"
                    onSubmit={e => {
                      e.preventDefault();
                      connectMt5();
                    }}
                    autoComplete="off"
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <input value={mt5Form.login} onChange={e => setMt5Form(f => ({ ...f, login: e.target.value.replace(/\D/g, '').slice(0, 20) }))} inputMode="numeric" placeholder="MT5 login" aria-label="MT5 login" className="h-9 px-3 rounded-xl bg-black/25 border border-white/[0.08] text-sm text-white placeholder:text-slate-500 outline-none focus:border-emerald-400/40" />
                      <Mt5ServerInput value={mt5Form.server} onChange={v => setMt5Form(f => ({ ...f, server: v }))} />
                    </div>
                    <input type="password" value={mt5Form.password} onChange={e => setMt5Form(f => ({ ...f, password: e.target.value.slice(0, 64) }))} placeholder="Master (trading) password" aria-label="MT5 master password" autoComplete="new-password" className="w-full h-9 px-3 rounded-xl bg-black/25 border border-white/[0.08] text-sm text-white placeholder:text-slate-500 outline-none focus:border-emerald-400/40" />
                    <label className="flex items-start gap-2 text-[11px] text-slate-400 cursor-pointer">
                      <input type="checkbox" checked={mt5Form.consent} onChange={e => setMt5Form(f => ({ ...f, consent: e.target.checked }))} className="mt-0.5" />
                      <span>I let the MarketX agent place and close trades on this account. The password goes straight to the secure MT5 connection: MarketX never stores it. An investor password can't place trades.</span>
                    </label>
                    <button type="submit" disabled={busy || !mt5Form.login || !mt5Form.server || !mt5Form.password || !mt5Form.consent} className="w-full h-9 rounded-xl bg-white/[0.08] text-sm font-medium text-white hover:bg-white/[0.12] disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Link MT5
                    </button>
                  </form>
                )}
              </div>

              {error && <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">{error}</p>}

              {/* Tabs */}
              <div role="tablist" aria-label="Trading agent" className="grid grid-cols-3 p-1 rounded-2xl bg-black/25 border border-white/[0.06]">
                {(
                  [
                    ['setup', 'Setup'],
                    ['trades', `Trades${data.trades.length ? ` · ${data.trades.length}` : ''}`],
                    ['activity', 'Activity'],
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`h-8 rounded-xl text-xs font-medium transition cursor-pointer ${tab === id ? 'bg-white/[0.1] text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                    {label}
                  </button>
                ))}
              </div>

              {tab === 'setup' && (
                <div className={running ? 'opacity-60 pointer-events-none select-none' : ''} aria-disabled={running}>
                  {running && <p className="mb-2 text-[11px] text-slate-400">Stop the agent to change its setup.</p>}
                  <Row title="Trade type" hint="Steady mode: limit entries, a wider stop, calm markets only">
                    <div className="grid grid-cols-3 gap-1.5 w-full">
                      {(['DAY', 'SWING', 'ANY'] as AgentStyle[]).map(s => (
                        <button key={s} type="button" onClick={() => setStyle(s)} className={`rounded-2xl border px-2 py-2 text-left cursor-pointer transition ${draft.style === s ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05]'}`}>
                          <span className="block text-xs font-semibold text-white">{AGENT_STYLE_INFO[s].label}</span>
                          <span className="block text-[10px] text-slate-500">{AGENT_STYLE_INFO[s].hint}</span>
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Timeframes">
                    <div className="flex gap-1.5">
                      {AGENT_FRAMES[draft.style].map(tf => (
                        <button key={tf} type="button" onClick={() => patch({ timeframes: toggle(draft.timeframes, tf) })} className={`px-3 h-8 rounded-full text-xs font-semibold border cursor-pointer ${draft.timeframes.includes(tf) ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200' : 'border-white/[0.08] text-slate-400 hover:text-white'}`}>
                          {tf}
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Markets" hint="The markets the agent's back-test covered and that held up">
                    <div className="flex flex-wrap gap-1.5 w-full">
                      {data.markets.map(m => (
                        <button key={m.symbol} type="button" onClick={() => patch({ markets: toggle(draft.markets, m.symbol) })} className={`px-3 h-8 rounded-full text-xs font-medium border cursor-pointer ${draft.markets.includes(m.symbol) ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200' : 'border-white/[0.08] text-slate-400 hover:text-white'}`}>
                          {m.label} <span className="text-[10px] opacity-60">{m.mt5}</span>
                        </button>
                      ))}
                    </div>
                  </Row>
                  <Row title="Risk per trade" hint="Of your account, lost if a trade hits its stop">
                    <Stepper label="risk" value={draft.riskPct} min={AGENT_LIMITS.riskPct.min} max={AGENT_LIMITS.riskPct.max} step={0.1} suffix="%" onChange={v => patch({ riskPct: v })} />
                  </Row>
                  <Row title="Trades per day" hint="The most it opens in a day">
                    <Stepper label="trades per day" value={draft.tradesPerDay} min={AGENT_LIMITS.tradesPerDay.min} max={AGENT_LIMITS.tradesPerDay.max} step={1} onChange={v => patch({ tradesPerDay: v })} />
                  </Row>
                  <Row title="Profit target" hint="The run stops taking trades once it is up this much">
                    <Stepper label="profit target" value={draft.profitTargetPct} min={0} max={AGENT_LIMITS.profitTargetPct.max} step={0.5} suffix="%" onChange={v => patch({ profitTargetPct: v })} />
                  </Row>
                  <Row title="Loss limit" hint="The run stops once it is down this much">
                    <Stepper label="loss limit" value={draft.lossLimitPct} min={0} max={AGENT_LIMITS.lossLimitPct.max} step={0.5} suffix="%" onChange={v => patch({ lossLimitPct: v })} />
                  </Row>
                  <div className="pt-3">
                    <p className="text-sm font-medium text-white">How long it runs</p>
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      {(Object.keys(AGENT_PRICING) as AgentDuration[]).map(k => (
                        <button key={k} type="button" onClick={() => patch({ duration: k })} className={`rounded-2xl border px-2.5 py-2.5 text-left cursor-pointer transition ${draft.duration === k ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05]'}`}>
                          <span className="block text-xs font-semibold text-white">{AGENT_PRICING[k].label}</span>
                          <span className="block text-[11px] text-emerald-300 font-semibold">{AGENT_PRICING[k].perTrade} credits</span>
                          <span className="block text-[10px] text-slate-500">a trade</span>
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 rounded-2xl bg-black/20 border border-white/[0.06] p-3 text-[11px] text-slate-400 space-y-1">
                      <p>
                        <span className="text-white font-medium">{price.perTrade} credits a trade</span>, used once when the agent places it and refunded if the order never fills. Most this run can cost:{' '}
                        <span className="text-white font-medium">{maxCost} credits</span> ({draft.tradesPerDay} a day × {price.days} day{price.days === 1 ? '' : 's'}).
                      </p>
                      {credits !== null && (
                        <p className={short ? 'text-amber-300' : ''}>
                          You have {credits} credits.{short ? ` You need at least ${price.perTrade} to start.` : ''}{' '}
                          {onBuyCredits && (
                            <button type="button" onClick={onBuyCredits} className="underline underline-offset-2 cursor-pointer text-amber-200">
                              Buy credits
                            </button>
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  <button type="button" onClick={() => setShowBacktest(v => !v)} className="mt-3 w-full flex items-center gap-2 text-left text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer">
                    <Info className="w-3.5 h-3.5 shrink-0" /> How it has done in back-tests, and the risks
                    <ChevronDown className={`w-3.5 h-3.5 ml-auto transition ${showBacktest ? 'rotate-180' : ''}`} />
                  </button>
                  {showBacktest && (
                    <div className="mt-2 rounded-2xl bg-white/[0.03] border border-white/[0.06] p-3 text-[11px] leading-relaxed text-slate-400 space-y-1.5">
                      <p>
                        Replayed on years of real prices for these markets, after spreads and fees: <span className="text-white">{data.backtest.won}% of trades won</span>, about{' '}
                        <span className="text-white">{sign(data.backtest.avgR)}R a trade</span> on average, about {data.backtest.tradesPerMonth} trades a month across all six markets.
                      </p>
                      <p>
                        Winners are bigger than losers, so most trades lose. The deepest drop was {data.backtest.maxDrawdownR}R and the longest losing run {data.backtest.worstRun} trades: at 0.5% risk that is
                        about {(data.backtest.maxDrawdownR * 0.5).toFixed(0)}% of the account. Back-tests are not live results, and past results don't guarantee future ones. Not financial advice.
                      </p>
                    </div>
                  )}

                  {!running && (
                    <button type="button" onClick={start} disabled={busy || !check.ok || short || !allowed} className="mt-4 w-full h-11 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(16,185,129,0.8)] hover:brightness-110 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />} Start the agent
                    </button>
                  )}
                  {!check.ok && <p className="mt-2 text-[11px] text-amber-300">{(check as { message: string }).message}</p>}
                </div>
              )}

              {tab === 'trades' && (
                <div className="space-y-3">
                  <div className="grid grid-cols-4 gap-2">
                    <Stat label="Win rate" value={data.stats.trades ? `${data.stats.winRate}%` : '–'} />
                    <Stat label="Trades" value={String(data.stats.trades)} />
                    <Stat label="Total" value={data.stats.trades ? `${sign(data.stats.totalR)}R` : '–'} tone={data.stats.totalR > 0 ? 'up' : data.stats.totalR < 0 ? 'down' : undefined} />
                    <Stat label="P/L" value={data.stats.trades ? `${sign(data.stats.pnlPct)}%` : '–'} tone={data.stats.pnlPct > 0 ? 'up' : data.stats.pnlPct < 0 ? 'down' : undefined} />
                  </div>
                  <p className="text-[10px] text-slate-500">All the agent's closed trades. Wins and losses in R (the amount risked on a trade) and in % of your account.</p>
                  {!data.trades.length && <p className="py-10 text-center text-xs text-slate-500">No trades yet. Switch the agent on and its orders show here.</p>}
                  {data.trades.map(t => {
                    const chip = chipOf(t);
                    const focus = t.id === focusId;
                    return (
                      <div key={t.id} data-trade={t.id} className={`rounded-2xl border p-3 transition ${focus ? 'border-emerald-400/50 ring-2 ring-emerald-400/30' : 'border-white/[0.07]'} bg-white/[0.02]`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${t.direction === 'LONG' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{t.direction === 'LONG' ? 'BUY' : 'SELL'}</span>
                          <span className="text-sm font-semibold text-white truncate">{t.symbol}</span>
                          <span className="text-[11px] text-slate-500">{t.timeframe}</span>
                          <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${chip.cls}`}>{chip.text}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                          <div className="min-w-0"><p className="text-slate-500">Entry</p><p className="text-slate-200 font-mono truncate">{exactPrice(t.entry)}</p></div>
                          <div className="min-w-0"><p className="text-slate-500">Stop</p><p className="text-slate-200 font-mono truncate">{exactPrice(t.stop)}</p></div>
                          <div className="min-w-0"><p className="text-slate-500">Target</p><p className="text-slate-200 font-mono truncate">{exactPrice(t.target)}</p></div>
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                          <span>Quality {t.quality}/100 · {t.rr}R · risk {t.riskPct}%</span>
                          {typeof t.r === 'number' && (
                            <span className={`ml-auto font-semibold tabular-nums ${t.r > 0 ? 'text-emerald-300' : t.r < 0 ? 'text-rose-300' : 'text-slate-300'}`}>
                              {sign(t.r)}R · {sign(t.pnlPct || 0)}%
                            </span>
                          )}
                          {typeof t.r !== 'number' && <span className="ml-auto">{ago(t.filledAt || t.createdAt)}</span>}
                        </div>
                        {t.mt5 && (
                          <p className={`mt-1 text-[10px] ${t.mt5.state === 'FAILED' ? 'text-amber-300' : 'text-emerald-300'}`}>
                            {t.mt5.state === 'FAILED' ? `Not placed on MT5: ${t.mt5.error || 'error'}` : `On MT5 · ${t.mt5.symbol} · ${t.mt5.volume} lots${t.mt5.state === 'CANCELLED' ? ' · cancelled' : t.mt5.state === 'CLOSED' ? ' · closed' : ''}`}
                          </p>
                        )}
                        {t.note && t.state !== 'OPEN' && t.state !== 'PENDING' && (
                          <p className="mt-1 text-[10px] text-slate-500">
                            {t.note}
                            {t.refunded ? ` · ${t.refunded} credits refunded` : t.credits ? ` · ${t.credits} credits` : ''}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {tab === 'activity' && (
                <div className="space-y-1">
                  {!data.log.length && <p className="py-10 text-center text-xs text-slate-500">Nothing yet. Everything the agent does shows here, and you're alerted as it happens.</p>}
                  {data.log.map((l, i) => {
                    const { icon: Icon, cls } = LOG_ICON[l.kind] || LOG_ICON.SCAN;
                    return (
                      <div key={`${l.at}-${i}`} className="flex gap-3 py-2 border-b border-white/[0.04] last:border-0">
                        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${cls}`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-slate-200 leading-relaxed break-words">{l.text}</p>
                          <p className="text-[10px] text-slate-500">{ago(l.at)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
          {!data && !loading && error && <p className="text-xs text-rose-300">{error}</p>}
        </div>
      </section>
    </div>
  );
}

export default TradingAgentPanel;
