import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowLeft, Bot, CheckCircle2, ChevronDown, CircleDot, Clock, Crown, Info, Link2, Loader2, Lock, Minus, Plug, Plus, Power, RefreshCw,
  ShieldAlert, Square, Target, Unlink, XCircle,
} from 'lucide-react';
import { apiFetch, formatMoney } from '../utils/apiClient';
import { exactPrice } from '../utils/formatPrice';
import {
  AGENT_FRAMES, AGENT_LIMITS, AGENT_PRICING, AGENT_STYLE_INFO, DEFAULT_AGENT_SETTINGS, ENDED_TEXT, agentMaxCost, normalizeAgentSettings,
  type AgentDuration, type AgentLogEntry, type AgentRunView, type AgentSettings, type AgentStats, type AgentStyle, type AgentTradeView,
} from '../utils/tradingAgent';
import { Mt5ServerInput } from './Mt5ServerInput';
import './agents.css';

// Trading Agent page (owner-specified, `/agents`): a full-screen page of its own, soft and calm, with motion that follows
// what the agent is doing (a breathing orb that sends out rings while it runs, cards that rise in, a sliding tab pill,
// steppers and choices that respond to the touch). The trader sets it up (trade type, timeframes, markets, risk per trade,
// profit target, loss limit, trades per day, run length with its credit cost) and switches it on; the agent then finds,
// places and manages trades on its own (Steady mode) and alerts the trader at every step. Same routes as before.
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
    link: null | {
      status: 'CONNECTING' | 'CONNECTED' | 'FAILED';
      stage?: 'CREATING' | 'DEPLOYING' | 'SIGNING_IN' | null;
      asleep?: boolean;
      login: string;
      server: string;
      broker: string | null;
      currency: string | null;
      balance: number | null;
      symbols: Record<string, string | null>;
      message: string;
      linkedAt: number;
    };
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
  PENDING: { text: 'Waiting to fill', cls: 'bg-sky-500/12 text-sky-300' },
  OPEN: { text: 'Open', cls: 'bg-violet-500/12 text-violet-300' },
  WIN: { text: 'Won', cls: 'bg-emerald-500/12 text-emerald-300' },
  LOSS: { text: 'Lost', cls: 'bg-rose-500/12 text-rose-300' },
  TIMEOUT: { text: 'Closed', cls: 'bg-slate-500/12 text-slate-300' },
  CANCELLED: { text: 'Cancelled', cls: 'bg-slate-500/10 text-slate-400' },
};
const chipOf = (t: AgentTradeView) => STATE_CHIP[t.state === 'CLOSED' ? t.result || 'TIMEOUT' : t.state];
const LOG_ICON: Record<AgentLogEntry['kind'], { icon: React.ElementType; cls: string; dot: string }> = {
  START: { icon: Power, cls: 'text-emerald-300', dot: 'bg-emerald-400' },
  SCAN: { icon: Activity, cls: 'text-slate-400', dot: 'bg-slate-500' },
  ORDER: { icon: CircleDot, cls: 'text-sky-300', dot: 'bg-sky-400' },
  FILL: { icon: Target, cls: 'text-violet-300', dot: 'bg-violet-400' },
  WIN: { icon: CheckCircle2, cls: 'text-emerald-300', dot: 'bg-emerald-400' },
  LOSS: { icon: XCircle, cls: 'text-rose-300', dot: 'bg-rose-400' },
  CLOSE: { icon: Square, cls: 'text-slate-300', dot: 'bg-slate-400' },
  CANCEL: { icon: Minus, cls: 'text-slate-400', dot: 'bg-slate-500' },
  STOP: { icon: Square, cls: 'text-amber-300', dot: 'bg-amber-400' },
  END: { icon: Clock, cls: 'text-slate-300', dot: 'bg-slate-400' },
  PAUSE: { icon: ShieldAlert, cls: 'text-amber-300', dot: 'bg-amber-400' },
};

/** Rise-in delay for the n-th item of a list */
const rise = (i: number): React.CSSProperties => ({ animationDelay: `${Math.min(i, 12) * 45}ms` });

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <div className="ag-tile">
      <p className="text-[10.5px] uppercase tracking-[0.08em] text-slate-500 truncate">{label}</p>
      <p key={value} className={`ag-pop mt-1 text-[17px] font-semibold tabular-nums truncate ${tone === 'up' ? 'text-emerald-300' : tone === 'down' ? 'text-rose-300' : 'text-white'}`}>
        {value}
      </p>
    </div>
  );
}

function Stepper({ value, min, max, step, onChange, suffix, label, title, hint }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix?: string; label: string; title: string; hint: string }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Number((Math.round(v / step) * step).toFixed(2)))));
  return (
    <div className="ag-soft p-3.5">
      <p className="text-[13px] font-medium text-white">{title}</p>
      <p className="text-[11px] text-slate-500 leading-snug min-h-[28px]">{hint}</p>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <button type="button" disabled={value <= min} onClick={() => set(value - step)} aria-label={`Less ${label}`} className="ag-round">
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span key={value} className="ag-pop text-[18px] font-semibold text-white tabular-nums">
          {value === 0 && suffix === '%' && min === 0 ? 'None' : `${value}${suffix || ''}`}
        </span>
        <button type="button" disabled={value >= max} onClick={() => set(value + step)} aria-label={`More ${label}`} className="ag-round">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function Section({ title, hint, children, i = 0 }: { title: string; hint?: string; children: React.ReactNode; i?: number }) {
  return (
    <section className="ag-card ag-rise p-4 sm:p-5" style={rise(i)}>
      <p className="text-[14px] font-semibold text-white">{title}</p>
      {hint && <p className="mt-0.5 text-[11.5px] text-slate-500">{hint}</p>}
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

export interface AgentsPageProps {
  focusId?: string | null;
  onBack: () => void;
  onBuyCredits?: () => void;
  onUpgrade?: () => void;
}

export function AgentsPage({ focusId, onBack, onBuyCredits, onUpgrade }: AgentsPageProps) {
  const [data, setData] = useState<AgentState | null>(null);
  const [draft, setDraft] = useState<AgentSettings>(DEFAULT_AGENT_SETTINGS);
  const [tab, setTab] = useState<Tab>('setup');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [showBacktest, setShowBacktest] = useState(false);
  const [mt5Form, setMt5Form] = useState({ login: '', server: '', password: '', consent: false });
  const pageRef = useRef<HTMLDivElement>(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
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
    load();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role="dialog"]') && onBackRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [load]);
  // While the agent runs, the page follows it (every 20s while the tab is visible); while MT5 is linking, every 4s so
  // each step (or the reason it failed) shows at once
  const linking = data?.mt5?.link?.status === 'CONNECTING';
  useEffect(() => {
    if (!(running || linking)) return;
    const id = setInterval(() => document.visibilityState === 'visible' && load(true), linking ? 4_000 : 20_000);
    return () => clearInterval(id);
  }, [running, linking, load]);
  const [clock, setClock] = useState(0);
  useEffect(() => {
    if (!linking && !running) return;
    const id = setInterval(() => setClock(Date.now()), linking ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [linking, running]);
  // A notification's trade: open the Trades tab and ring it
  useEffect(() => {
    if (!focusId || !data) return;
    setTab('trades');
    const t = setTimeout(() => pageRef.current?.querySelector(`[data-trade="${focusId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 160);
    return () => clearTimeout(t);
  }, [focusId, data]);

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
      pageRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
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
      setData(await apiFetch<AgentState>('/api/agent/mt5/connect', { method: 'POST', body: JSON.stringify(mt5Form), timeoutMs: 30_000 }));
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

  const run = data?.run || null;
  const access = data?.access;
  const allowed = !!access?.allowed;
  const link = data?.mt5?.link || null;
  const rs = run?.stats;
  const openTrades = (data?.trades || []).filter(t => t.state === 'OPEN' || t.state === 'PENDING');
  const marketLabel = (s: string) => data?.markets.find(m => m.symbol === s);
  const tabs: Array<[Tab, string]> = [
    ['setup', 'Setup'],
    ['trades', `Trades${data?.trades.length ? ` · ${data.trades.length}` : ''}`],
    ['activity', 'Activity'],
  ];
  const tabIndex = tabs.findIndex(([id]) => id === tab);
  const linkStep = link?.stage === 'SIGNING_IN' ? 3 : link?.stage === 'DEPLOYING' ? 2 : 1;

  return (
    <div ref={pageRef} className="ag fixed inset-0 z-[46] overflow-y-auto overscroll-contain bg-[var(--mx-bg)] text-slate-100" role="main" aria-label="Trading Agent">
      <div className="ag-aura" aria-hidden="true" data-on={running ? '1' : undefined} />

      {/* Top bar */}
      <header className="sticky top-0 z-20 ag-bar">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <button type="button" onClick={onBack} className="ag-back" aria-label="Back to MarketX">
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div className="min-w-0 flex items-center gap-2.5">
            <span className={`ag-mark ${running ? 'on' : ''}`} aria-hidden="true">
              <Bot className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h1 className="text-[15px] sm:text-base font-semibold text-white tracking-tight leading-tight">Trading Agent</h1>
              <p className="text-[11px] text-slate-500 truncate hidden sm:block">Finds, places and manages trades for you, and tells you every step</p>
            </div>
          </div>
          <span className={`ml-auto ag-status ${running ? 'on' : ''}`}>
            <span className="ag-status-dot" />
            {running ? 'Running' : run ? 'Ended' : 'Off'}
          </span>
          <button type="button" onClick={() => load()} disabled={loading} className="ag-round !w-9 !h-9" aria-label="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-4 pb-[max(4rem,calc(env(safe-area-inset-bottom)+3rem))]">
        {!data && loading && (
          <div className="py-28 flex flex-col items-center gap-4 text-slate-500">
            <span className="ag-orb" aria-hidden="true" />
            <p className="text-xs">Waking the agent…</p>
          </div>
        )}
        {!data && !loading && error && (
          <div className="py-24 text-center">
            <p className="text-sm text-rose-300">{error}</p>
            <button type="button" onClick={() => load()} className="mt-4 ag-ghost-btn">
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
          </div>
        )}

        {data && (
          <div className="grid lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] gap-4 lg:gap-6 items-start">
            {/* ---------- Left: status, plan, MT5 ---------- */}
            <div className="space-y-4 lg:sticky lg:top-20">
              {/* Status hero */}
              <section className={`ag-hero ag-rise ${running ? 'on' : ''}`}>
                <div className="flex items-center gap-4">
                  <span className={`ag-orb ${running ? 'on' : ''}`} aria-hidden="true">
                    <Bot className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.1em] text-slate-500">{running ? `${AGENT_PRICING[run!.settings.duration].label} run` : 'Status'}</p>
                    <p className="text-[19px] font-semibold text-white leading-tight">{running ? 'Working on your markets' : run ? ENDED_TEXT[run.endedReason || 'TIME_UP'] : 'Ready when you are'}</p>
                    {running && (
                      <p className="mt-0.5 text-[12px] text-emerald-300/90 tabular-nums" data-clock={clock}>
                        Ends in {left(run!.endsAt)}
                      </p>
                    )}
                  </div>
                </div>

                {run ? (
                  <>
                    <p className="mt-3.5 text-[11.5px] text-slate-400 leading-relaxed">
                      {run.settings.markets.map(m => marketLabel(m)?.label || m).join(', ')} · {run.settings.timeframes.join(' + ')} · risk {run.settings.riskPct}% · up to {run.settings.tradesPerDay}/day · {run.perTrade} credits a trade, {run.maxCredits} at most
                    </p>
                    <div className="mt-3.5 grid grid-cols-4 gap-2">
                      <Stat label="Won" value={rs!.trades ? `${rs!.winRate}%` : '–'} />
                      <Stat label="Result" value={rs!.trades ? `${sign(rs!.totalR)}R` : '–'} tone={rs!.totalR > 0 ? 'up' : rs!.totalR < 0 ? 'down' : undefined} />
                      <Stat label="P/L" value={rs!.trades ? `${sign(rs!.pnlPct)}%` : '–'} tone={rs!.pnlPct > 0 ? 'up' : rs!.pnlPct < 0 ? 'down' : undefined} />
                      <Stat label="Credits" value={String(run.creditsUsed)} />
                    </div>
                    {running && (
                      <p className="mt-3 text-[11.5px] text-slate-400">
                        {openTrades.length ? `${openTrades.length} order${openTrades.length === 1 ? '' : 's'}/trade${openTrades.length === 1 ? '' : 's'} live. ` : 'Watching your markets for a clean setup. '}
                        It only trades setups of quality {data.minQuality}+, so some days it takes none.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-3.5 text-[12px] text-slate-400 leading-relaxed">Set it up and switch it on for a day, a week or a month. It finds the setup, places the order and manages it to the target or the stop.</p>
                )}

                {running && (
                  <div className={`ag-collapse ${confirmStop ? 'open' : ''}`}>
                    <div>
                      <div className="mt-3.5 ag-soft p-3.5 space-y-2.5">
                        <p className="text-[12px] text-slate-300">Stop the agent? Orders waiting to fill are cancelled (no credits used).</p>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" disabled={busy} onClick={() => stop(false)} className="ag-ghost-btn">
                            Stop, keep open trades
                          </button>
                          <button type="button" disabled={busy} onClick={() => stop(true)} className="ag-ghost-btn !bg-rose-500/15 !text-rose-200 hover:!bg-rose-500/25">
                            Stop and close them now
                          </button>
                          <button type="button" onClick={() => setConfirmStop(false)} className="px-3 h-9 rounded-full text-xs text-slate-400 hover:text-white cursor-pointer">
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {running && !confirmStop && (
                  <button type="button" onClick={() => setConfirmStop(true)} className="mt-3.5 w-full ag-ghost-btn !h-11 !rounded-2xl justify-center">
                    <Square className="w-3.5 h-3.5" /> Stop agent
                  </button>
                )}
              </section>

              {/* Pro: the agent is part of Pro (free for everyone until the Pro date); credits are used per trade */}
              {access && !allowed && (
                <section className="ag-card ag-rise p-4 sm:p-5 !border-violet-400/25" style={{ ...rise(1), background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(217,70,239,0.06))' }}>
                  <div className="flex items-center gap-2">
                    <Crown className="w-4 h-4 text-violet-300" />
                    <p className="text-[14px] font-semibold text-white">The Trading Agent is part of Pro</p>
                  </div>
                  <p className="mt-1 text-[12px] text-slate-400">Upgrade to Pro to switch it on. Credits are used per trade the agent takes.</p>
                  {onUpgrade && (
                    <button type="button" onClick={onUpgrade} className="mt-3.5 w-full ag-cta !from-violet-500 !to-fuchsia-500">
                      <Lock className="w-4 h-4" /> Upgrade to Pro
                    </button>
                  )}
                </section>
              )}
              {access && allowed && !access.staff && access.freeUntil && (
                <p className="ag-rise text-[11.5px] text-slate-500 flex items-center gap-1.5 px-1" style={rise(1)}>
                  <Crown className="w-3.5 h-3.5 text-violet-300" /> Free for everyone until{' '}
                  {new Date(access.freeUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, then part of Pro.
                </p>
              )}

              {/* MT5 */}
              <section className="ag-card ag-rise p-4 sm:p-5" style={rise(2)}>
                <div className="flex gap-3">
                  <span className={`ag-icon ${link?.status === 'CONNECTED' ? 'ok' : link?.status === 'FAILED' ? 'bad' : 'wait'}`}>
                    <Plug className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-white">
                      {link?.status === 'CONNECTED' ? `MT5 linked · ${link.login}` : link?.status === 'CONNECTING' ? 'Linking your MT5…' : link?.status === 'FAILED' ? `MT5 not linked · ${link.server}` : 'MT5'}
                    </p>
                    <p className={`mt-0.5 text-[11.5px] leading-relaxed ${link?.status === 'FAILED' ? 'text-rose-300' : 'text-slate-400'}`} role={link?.status === 'FAILED' ? 'alert' : undefined}>
                      {link?.status === 'CONNECTED'
                        ? `${link.broker || link.server}${link.balance != null && link.currency ? ` · balance ${formatMoney(link.balance, link.currency)}` : ''}. The agent places its trades here, sized to your risk per trade.${link.asleep ? ' Resting while the agent is off: it reconnects by itself when you start a run.' : ''}`
                        : link?.status === 'CONNECTING'
                          ? link.message || 'Signing in to your broker…'
                          : link?.status === 'FAILED'
                            ? link.message || 'Linking failed. Check your details and try again.'
                            : data.mt5.available
                              ? 'Link your MT5 account and the agent places its trades there. Until then MarketX tracks each trade and alerts you with the exact order.'
                              : 'MT5 linking is being set up. Until then MarketX tracks each trade and alerts you with the exact order to place.'}
                    </p>
                  </div>
                </div>
                {link?.status === 'CONNECTED' && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(link.symbols).map(([m, bs]) => (
                      <span key={m} className={`text-[10.5px] px-2.5 py-1 rounded-full ${bs ? 'bg-emerald-500/10 text-emerald-200' : 'bg-white/[0.04] text-slate-500'}`}>
                        {marketLabel(m)?.label || m}: {bs || 'not at your broker'}
                      </span>
                    ))}
                  </div>
                )}
                {link?.status === 'CONNECTING' && (
                  <div className="mt-3.5">
                    <div className="flex items-center gap-2 text-[11.5px] text-slate-300">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-300" />
                      <span>
                        Step {linkStep} of 3: {linkStep === 3 ? 'signing in to your broker' : linkStep === 2 ? 'starting the MT5 connection' : 'checking your details'}
                      </span>
                      <span className="ml-auto tabular-nums text-slate-500">
                        {(() => {
                          const s = Math.max(0, Math.floor(((clock || Date.now()) - link.linkedAt) / 1000));
                          return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
                        })()}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden="true">
                      {[1, 2, 3].map(n => (
                        <span key={n} className={`ag-step ${n < linkStep ? 'done' : n === linkStep ? 'now' : ''}`} />
                      ))}
                    </div>
                    <p className="mt-2 text-[10.5px] text-slate-500">Usually under 2 minutes; a broker server MT5 hasn't seen before can take up to 5. If it can't link, the reason shows here.</p>
                  </div>
                )}
                {link && (
                  <div className="mt-3.5 flex gap-2">
                    {link.status !== 'FAILED' && (
                      <button type="button" disabled={busy} onClick={() => mt5Action('/api/agent/mt5/refresh', 'POST')} className="ag-ghost-btn">
                        <RefreshCw className="w-3 h-3" /> Check
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={() => mt5Action('/api/agent/mt5', 'DELETE')} className="ag-ghost-btn !text-slate-300">
                      <Unlink className="w-3 h-3" /> {link.status === 'FAILED' ? 'Clear' : link.status === 'CONNECTING' ? 'Cancel' : 'Disconnect'}
                    </button>
                  </div>
                )}
                {(!link || link.status === 'FAILED') && data.mt5.available && allowed && (
                  <form
                    className="mt-4 space-y-2.5"
                    onSubmit={e => {
                      e.preventDefault();
                      connectMt5();
                    }}
                    autoComplete="off"
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <input value={mt5Form.login} onChange={e => setMt5Form(f => ({ ...f, login: e.target.value.replace(/\D/g, '').slice(0, 20) }))} inputMode="numeric" placeholder="MT5 login" aria-label="MT5 login" className="ag-input" />
                      <Mt5ServerInput value={mt5Form.server} onChange={v => setMt5Form(f => ({ ...f, server: v }))} />
                    </div>
                    <input type="password" value={mt5Form.password} onChange={e => setMt5Form(f => ({ ...f, password: e.target.value.slice(0, 64) }))} placeholder="Master (trading) password" aria-label="MT5 master password" autoComplete="new-password" className="ag-input w-full" />
                    <label className="flex items-start gap-2.5 text-[11.5px] text-slate-400 cursor-pointer leading-relaxed">
                      <input type="checkbox" checked={mt5Form.consent} onChange={e => setMt5Form(f => ({ ...f, consent: e.target.checked }))} className="mt-0.5 accent-emerald-500" />
                      <span>I let the MarketX agent place and close trades on this account. The password goes straight to the secure MT5 connection: MarketX never stores it. An investor password can't place trades.</span>
                    </label>
                    <button type="submit" disabled={busy || !mt5Form.login || !mt5Form.server || !mt5Form.password || !mt5Form.consent} className="w-full ag-ghost-btn !h-11 !rounded-2xl justify-center">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Link MT5
                    </button>
                  </form>
                )}
              </section>

              {error && (
                <p className="ag-rise text-[12px] text-rose-300 bg-rose-500/10 rounded-2xl px-3.5 py-2.5" role="alert">
                  {error}
                </p>
              )}
            </div>

            {/* ---------- Right: tabs ---------- */}
            <div className="min-w-0">
              <div role="tablist" aria-label="Trading agent" className="ag-tabs ag-rise" style={rise(1)}>
                <span className="ag-tab-pill" style={{ transform: `translateX(${tabIndex * 100}%)` }} aria-hidden="true" />
                {tabs.map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`ag-tab ${tab === id ? 'on' : ''}`}>
                    {label}
                  </button>
                ))}
              </div>

              <div key={tab} className="mt-4 ag-fade">
                {tab === 'setup' && (
                  <div className={`space-y-4 ${running ? 'opacity-60 pointer-events-none select-none' : ''}`} aria-disabled={running}>
                    {running && <p className="text-[12px] text-slate-400 px-1">Stop the agent to change its setup.</p>}
                    <Section title="Trade type" hint="Steady mode: limit entries, a wider stop, calm markets only" i={0}>
                      <div className="grid grid-cols-3 gap-2">
                        {(['DAY', 'SWING', 'ANY'] as AgentStyle[]).map(s => (
                          <button key={s} type="button" onClick={() => setStyle(s)} className={`ag-choice ${draft.style === s ? 'on' : ''}`} aria-pressed={draft.style === s}>
                            <span className="block text-[13px] font-semibold text-white">{AGENT_STYLE_INFO[s].label}</span>
                            <span className="block mt-0.5 text-[10.5px] text-slate-500 leading-snug">{AGENT_STYLE_INFO[s].hint}</span>
                          </button>
                        ))}
                      </div>
                    </Section>

                    <Section title="Timeframes and markets" hint="The markets the agent's back-test covered and that held up" i={1}>
                      <div className="flex flex-wrap gap-2">
                        {AGENT_FRAMES[draft.style].map(tf => (
                          <button key={tf} type="button" onClick={() => patch({ timeframes: toggle(draft.timeframes, tf) })} className={`ag-chip ${draft.timeframes.includes(tf) ? 'on' : ''}`} aria-pressed={draft.timeframes.includes(tf)}>
                            {tf}
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {data.markets.map(m => (
                          <button key={m.symbol} type="button" onClick={() => patch({ markets: toggle(draft.markets, m.symbol) })} className={`ag-chip ${draft.markets.includes(m.symbol) ? 'on' : ''}`} aria-pressed={draft.markets.includes(m.symbol)}>
                            {m.label} <span className="text-[10px] opacity-60">{m.mt5}</span>
                          </button>
                        ))}
                      </div>
                    </Section>

                    <Section title="Risk and limits" i={2}>
                      <div className="grid grid-cols-2 gap-2.5">
                        <Stepper title="Risk per trade" hint="Of your account, lost if a trade hits its stop" label="risk" value={draft.riskPct} min={AGENT_LIMITS.riskPct.min} max={AGENT_LIMITS.riskPct.max} step={0.1} suffix="%" onChange={v => patch({ riskPct: v })} />
                        <Stepper title="Trades per day" hint="The most it opens in a day" label="trades per day" value={draft.tradesPerDay} min={AGENT_LIMITS.tradesPerDay.min} max={AGENT_LIMITS.tradesPerDay.max} step={1} onChange={v => patch({ tradesPerDay: v })} />
                        <Stepper title="Profit target" hint="Stops taking trades once it is up this much" label="profit target" value={draft.profitTargetPct} min={0} max={AGENT_LIMITS.profitTargetPct.max} step={0.5} suffix="%" onChange={v => patch({ profitTargetPct: v })} />
                        <Stepper title="Loss limit" hint="The run stops once it is down this much" label="loss limit" value={draft.lossLimitPct} min={0} max={AGENT_LIMITS.lossLimitPct.max} step={0.5} suffix="%" onChange={v => patch({ lossLimitPct: v })} />
                      </div>
                    </Section>

                    <Section title="How long it runs" i={3}>
                      <div className="grid grid-cols-3 gap-2">
                        {(Object.keys(AGENT_PRICING) as AgentDuration[]).map(k => (
                          <button key={k} type="button" onClick={() => patch({ duration: k })} className={`ag-choice ${draft.duration === k ? 'on' : ''}`} aria-pressed={draft.duration === k}>
                            <span className="block text-[13px] font-semibold text-white">{AGENT_PRICING[k].label}</span>
                            <span className="block mt-1 text-[15px] text-emerald-300 font-semibold tabular-nums">{AGENT_PRICING[k].perTrade}</span>
                            <span className="block text-[10.5px] text-slate-500">credits a trade</span>
                          </button>
                        ))}
                      </div>
                      <div className="mt-3 ag-soft p-3.5 text-[11.5px] text-slate-400 space-y-1.5 leading-relaxed">
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
                    </Section>

                    <section className="ag-card ag-rise overflow-hidden" style={rise(4)}>
                      <button type="button" onClick={() => setShowBacktest(v => !v)} aria-expanded={showBacktest} className="w-full flex items-center gap-2 text-left px-4 sm:px-5 py-3.5 text-[12.5px] text-slate-300 hover:text-white cursor-pointer">
                        <Info className="w-4 h-4 shrink-0 text-slate-500" /> How it has done in back-tests, and the risks
                        <ChevronDown className={`w-4 h-4 ml-auto transition-transform duration-300 ${showBacktest ? 'rotate-180' : ''}`} />
                      </button>
                      <div className={`ag-collapse ${showBacktest ? 'open' : ''}`}>
                        <div>
                          <div className="px-4 sm:px-5 pb-4 text-[11.5px] leading-relaxed text-slate-400 space-y-1.5">
                            <p>
                              Replayed on years of real prices for these markets, after spreads and fees: <span className="text-white">{data.backtest.won}% of trades won</span>, about{' '}
                              <span className="text-white">{sign(data.backtest.avgR)}R a trade</span> on average, about {data.backtest.tradesPerMonth} trades a month across all six markets.
                            </p>
                            <p>
                              Winners are bigger than losers, so most trades lose. The deepest drop was {data.backtest.maxDrawdownR}R and the longest losing run {data.backtest.worstRun} trades: at 0.5% risk that is
                              about {(data.backtest.maxDrawdownR * 0.5).toFixed(0)}% of the account. Back-tests are not live results, and past results don't guarantee future ones. Not financial advice.
                            </p>
                          </div>
                        </div>
                      </div>
                    </section>

                    {!running && (
                      <div className="ag-rise" style={rise(5)}>
                        <button type="button" onClick={start} disabled={busy || !check.ok || short || !allowed} className="w-full ag-cta">
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />} Start the agent
                        </button>
                        {!check.ok && <p className="mt-2 text-[11.5px] text-amber-300 px-1">{(check as { message: string }).message}</p>}
                      </div>
                    )}
                  </div>
                )}

                {tab === 'trades' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-4 gap-2 ag-rise">
                      <Stat label="Win rate" value={data.stats.trades ? `${data.stats.winRate}%` : '–'} />
                      <Stat label="Trades" value={String(data.stats.trades)} />
                      <Stat label="Total" value={data.stats.trades ? `${sign(data.stats.totalR)}R` : '–'} tone={data.stats.totalR > 0 ? 'up' : data.stats.totalR < 0 ? 'down' : undefined} />
                      <Stat label="P/L" value={data.stats.trades ? `${sign(data.stats.pnlPct)}%` : '–'} tone={data.stats.pnlPct > 0 ? 'up' : data.stats.pnlPct < 0 ? 'down' : undefined} />
                    </div>
                    <p className="text-[11px] text-slate-500 px-1">All the agent's closed trades. Wins and losses in R (the amount risked on a trade) and in % of your account.</p>
                    {!data.trades.length && (
                      <div className="ag-card py-14 text-center">
                        <Target className="w-6 h-6 mx-auto text-slate-600" />
                        <p className="mt-3 text-[12.5px] text-slate-500">No trades yet. Switch the agent on and its orders show here.</p>
                      </div>
                    )}
                    {data.trades.map((t, i) => {
                      const chip = chipOf(t);
                      const focus = t.id === focusId;
                      return (
                        <article key={t.id} data-trade={t.id} className={`ag-card ag-rise p-4 ${focus ? 'ag-focus' : ''}`} style={rise(i + 1)}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${t.direction === 'LONG' ? 'bg-emerald-500/12 text-emerald-300' : 'bg-rose-500/12 text-rose-300'}`}>{t.direction === 'LONG' ? 'BUY' : 'SELL'}</span>
                            <span className="text-[14px] font-semibold text-white truncate">{t.symbol}</span>
                            <span className="text-[11.5px] text-slate-500">{t.timeframe}</span>
                            <span className={`ml-auto text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full ${chip.cls}`}>{chip.text}</span>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2">
                            {(
                              [
                                ['Entry', t.entry],
                                ['Stop', t.stop],
                                ['Target', t.target],
                              ] as const
                            ).map(([k, v]) => (
                              <div key={k} className="ag-soft px-3 py-2 min-w-0">
                                <p className="text-[10.5px] text-slate-500">{k}</p>
                                <p className="text-[12.5px] text-slate-200 font-mono truncate">{exactPrice(v)}</p>
                              </div>
                            ))}
                          </div>
                          <div className="mt-2.5 flex items-center gap-2 text-[11.5px] text-slate-500">
                            <span>
                              Quality {t.quality}/100 · {t.rr}R · risk {t.riskPct}%
                            </span>
                            {typeof t.r === 'number' ? (
                              <span className={`ml-auto font-semibold tabular-nums ${t.r > 0 ? 'text-emerald-300' : t.r < 0 ? 'text-rose-300' : 'text-slate-300'}`}>
                                {sign(t.r)}R · {sign(t.pnlPct || 0)}%
                              </span>
                            ) : (
                              <span className="ml-auto">{ago(t.filledAt || t.createdAt)}</span>
                            )}
                          </div>
                          {t.mt5 && (
                            <p className={`mt-1.5 text-[11px] ${t.mt5.state === 'FAILED' ? 'text-amber-300' : 'text-emerald-300'}`}>
                              {t.mt5.state === 'FAILED' ? `Not placed on MT5: ${t.mt5.error || 'error'}` : `On MT5 · ${t.mt5.symbol} · ${t.mt5.volume} lots${t.mt5.state === 'CANCELLED' ? ' · cancelled' : t.mt5.state === 'CLOSED' ? ' · closed' : ''}`}
                            </p>
                          )}
                          {t.note && t.state !== 'OPEN' && t.state !== 'PENDING' && (
                            <p className="mt-1 text-[11px] text-slate-500">
                              {t.note}
                              {t.refunded ? ` · ${t.refunded} credits refunded` : t.credits ? ` · ${t.credits} credits` : ''}
                            </p>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}

                {tab === 'activity' && (
                  <div className="ag-card p-4 sm:p-5">
                    {!data.log.length && (
                      <div className="py-10 text-center">
                        <Activity className="w-6 h-6 mx-auto text-slate-600" />
                        <p className="mt-3 text-[12.5px] text-slate-500">Nothing yet. Everything the agent does shows here, and you're alerted as it happens.</p>
                      </div>
                    )}
                    <ol className="ag-timeline">
                      {data.log.map((l, i) => {
                        const { icon: Icon, cls, dot } = LOG_ICON[l.kind] || LOG_ICON.SCAN;
                        return (
                          <li key={`${l.at}-${i}`} className="ag-rise relative pl-9 pb-4 last:pb-0" style={rise(i)}>
                            <span className={`absolute left-0 top-0 w-6 h-6 rounded-full grid place-items-center bg-[var(--mx-bg)] ${cls}`}>
                              <span className={`absolute inset-0 rounded-full opacity-15 ${dot}`} />
                              <Icon className="relative w-3.5 h-3.5" />
                            </span>
                            <p className="text-[12.5px] text-slate-200 leading-relaxed break-words">{l.text}</p>
                            <p className="text-[10.5px] text-slate-500">{ago(l.at)}</p>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AgentsPage;
