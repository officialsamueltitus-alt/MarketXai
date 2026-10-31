import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowLeft, ArrowUpRight, Bot, CheckCircle2, ChevronDown, CircleDot, Clock, Crown, Gauge, Info, Layers, LayoutGrid, Link2, Loader2, Lock, Minus, Plug,
  Plus, Power, Radar, RefreshCw, ScanLine, Send, ShieldAlert, Square, Target, Unlink, WandSparkles, XCircle, Bell, Coins, Settings2,
} from 'lucide-react';
import { apiFetch, formatMoney } from '../utils/apiClient';
import { exactPrice } from '../utils/formatPrice';
import {
  AGENT_FRAMES, AGENT_LIMITS, AGENT_STRATEGY_MAX, AGENT_SYMBOLS, DEFAULT_AGENT_SETTINGS as AGENT_DEFAULTS, agentMarketInfo, strategyAgentFrames, AGENT_PRICING, AGENT_RUN_LABEL, AGENT_STYLE_INFO, DEFAULT_AGENT_SETTINGS, ENDED_TEXT, normalizeAgentSettings,
  type AgentDuration, type AgentLogEntry, type AgentRunView, type AgentSettings, type AgentStats, type AgentStyle, type AgentTradeView,
} from '../utils/tradingAgent';
import { Mt5ServerInput } from './Mt5ServerInput';
import { StrategyBuilderPanel } from '../components/StrategyBuilderPanel';
import { PushToggle } from '../components/PushToggle';
import { SETUPS } from '../utils/strategyRules';
import './agents.css';

// Trading Agent page (owner-specified, `/agents`): a full-screen page of its own, a dashboard laid out on the owner's reference in the
// site's own colours (owner-specified: violet accent with cyan / fuchsia, following the site's light and dark themes): pill
// navigation, big title, stat cards with progress bars, credits card with highlighted mini cards, a trades panel with a
// violet detail card. "Live automation" shows the agent at work (a pipeline pulse, market
// charts being scanned, the next-scan ring, its latest steps): it moves only while a run is on and stops when it ends or the
// trader stops it. The trader sets it up (strategy, trade type, timeframes, markets, risk, limits, run length) and switches it
// on; the agent then finds, places and manages trades on its own and alerts the trader at every step. Same routes as before.
interface AgentState {
  settings: AgentSettings;
  run: AgentRunView | null;
  trades: AgentTradeView[];
  stats: AgentStats;
  log: AgentLogEntry[];
  markets: Array<{ symbol: string; label: string; mt5: string }>;
  pricing: typeof AGENT_PRICING;
  minQuality: number;
  /** A personal strategy's quality floor */
  strategyMinQuality?: number;
  /** The trader's own strategies the agent can trade with */
  strategies?: Array<{ id: string; name: string; summary: string; setup: string; timeframes?: string[]; ownTimeframes?: boolean; kinds?: string[] }>;
  /** Markets and timeframes a personal strategy can run on */
  strategyMarkets?: Array<{ symbol: string; label: string; mt5: string; kind: string }>;
  strategyFrames?: string[];
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
/** Trades + History are the agent's day-to-day view; everything the trader configures lives under Settings */
type Tab = 'trades' | 'activity' | 'settings';

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

const STATE_CHIP: Record<string, { text: string; tone: 'live' | 'win' | 'loss' | 'flat' }> = {
  PENDING: { text: 'Waiting to fill', tone: 'live' },
  OPEN: { text: 'Open', tone: 'live' },
  WIN: { text: 'Won', tone: 'win' },
  LOSS: { text: 'Lost', tone: 'loss' },
  TIMEOUT: { text: 'Closed', tone: 'flat' },
  CANCELLED: { text: 'Cancelled', tone: 'flat' },
};
const chipOf = (t: AgentTradeView) => STATE_CHIP[t.state === 'CLOSED' ? t.result || 'TIMEOUT' : t.state] || STATE_CHIP.TIMEOUT;
const LOG_ICON: Record<AgentLogEntry['kind'], { icon: React.ElementType; color: string }> = {
  START: { icon: Power, color: '#8b5cf6' },
  SCAN: { icon: Activity, color: '#94a3b8' },
  ORDER: { icon: CircleDot, color: '#0ea5e9' },
  FILL: { icon: Target, color: '#a855f7' },
  WIN: { icon: CheckCircle2, color: '#10b981' },
  LOSS: { icon: XCircle, color: '#f43f5e' },
  CLOSE: { icon: Square, color: '#94a3b8' },
  CANCEL: { icon: Minus, color: '#94a3b8' },
  STOP: { icon: Square, color: '#f59e0b' },
  END: { icon: Clock, color: '#94a3b8' },
  PAUSE: { icon: ShieldAlert, color: '#f59e0b' },
};

/** Market "avatars": a short code on the market's own colour */
const MARKET_AV: Record<string, { code: string; bg: string }> = {
  'XAU/USD': { code: 'XAU', bg: '#fcd34d' },
  'BTC/USDT': { code: 'BTC', bg: '#fdba74' },
  'ETH/USDT': { code: 'ETH', bg: '#c4b5fd' },
  'USD/JPY': { code: 'JPY', bg: '#fda4af' },
  'GBP/USD': { code: 'GBP', bg: '#7dd3fc' },
  NAS100: { code: 'NAS', bg: '#86efac' },
};
const avOf = (s: string) => MARKET_AV[s] || { code: s.replace(/[^A-Z]/g, '').slice(0, 3) || '•', bg: '#e5e7eb' };
function MarketAv({ symbol, size = 34 }: { symbol: string; size?: number }) {
  const a = avOf(symbol);
  return (
    <span className="ag-av" style={{ background: a.bg, width: size, height: size, fontSize: size < 30 ? 7.5 : 9.5 }} title={symbol}>
      {a.code}
    </span>
  );
}

/** A made-up but steady line per market for the scan animation (no prices: it only shows the agent reading charts) */
function scanPath(seed: string): { line: string; area: string } {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rnd = () => ((h = Math.imul(h ^ (h >>> 13), 1274126177)) >>> 0) / 4294967296;
  const n = 22;
  const ys: number[] = [];
  let y = 30;
  for (let i = 0; i < n; i++) {
    y = Math.max(8, Math.min(46, y + (rnd() - 0.5) * 16));
    ys.push(y);
  }
  ys.push(ys[0]);
  // Two identical periods side by side, so sliding by half loops without a seam
  const pts: string[] = [];
  for (let k = 0; k < 2; k++) ys.forEach((v, i) => (k === 1 && i === 0 ? null : pts.push(`${((k * n + i) / (2 * n)) * 200},${v.toFixed(1)}`)));
  const line = `M${pts.join(' L')}`;
  return { line, area: `${line} L200,54 L0,54 Z` };
}
const SCAN_STEPS = ['Reading candles', 'Mapping zones', 'Checking quality', 'Waiting for a setup'];
const FLOW: Array<[string, React.ElementType]> = [
  ['Scan', ScanLine],
  ['Find zone', Layers],
  ['Quality', Gauge],
  ['Order', Send],
  ['Manage', Bell],
];

/** Rise-in delay for the n-th item of a list */
const rise = (i: number): React.CSSProperties => ({ animationDelay: `${Math.min(i, 12) * 45}ms` });

function Stepper({ value, min, max, step, onChange, suffix, label, title, hint }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix?: string; label: string; title: string; hint: string }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Number((Math.round(v / step) * step).toFixed(2)))));
  return (
    <div className="ag-soft p-3.5">
      <p className="text-[13px] font-medium text-white">{title}</p>
      <p className="text-[11px] text-[var(--ag-muted)] leading-snug min-h-[28px]">{hint}</p>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <button type="button" disabled={value <= min} onClick={() => set(value - step)} aria-label={`Less ${label}`} className="ag-step-btn">
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span key={value} className="ag-pop text-[20px] font-medium text-white tabular-nums">
          {value === 0 && suffix === '%' && min === 0 ? 'None' : `${value}${suffix || ''}`}
        </span>
        <button type="button" disabled={value >= max} onClick={() => set(value + step)} aria-label={`More ${label}`} className="ag-step-btn">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function Section({ title, hint, children, i = 0 }: { title: string; hint?: string; children: React.ReactNode; i?: number }) {
  return (
    <section className="ag-card ag-rise p-4 sm:p-5" style={rise(i)}>
      <p className="text-[15px] font-medium text-white">{title}</p>
      {hint && <p className="mt-0.5 text-[11.5px] text-[var(--ag-muted)]">{hint}</p>}
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

export interface AgentsPageProps {
  focusId?: string | null;
  onBack: () => void;
  onBuyCredits?: () => void;
  onUpgrade?: () => void;
  onToast?: (message: string, type?: 'success' | 'info') => void;
  /** Tells the app whether a run is live (it then picks up the agent's notices on the normal page too) */
  onRunning?: (live: boolean) => void;
  /** Goes up when a new agent notice arrives while this page is open: the page reloads at once */
  pulse?: number;
}

export function AgentsPage({ focusId, onBack, onBuyCredits, onUpgrade, onToast, onRunning, pulse = 0 }: AgentsPageProps) {
  const [data, setData] = useState<AgentState | null>(null);
  const [draft, setDraft] = useState<AgentSettings>(DEFAULT_AGENT_SETTINGS);
  const [tab, setTab] = useState<Tab>('trades');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [showBacktest, setShowBacktest] = useState(false);
  const [mt5Form, setMt5Form] = useState({ login: '', server: '', password: '', consent: false });
  const [builderOpen, setBuilderOpen] = useState(false);
  const [tradeFilter, setTradeFilter] = useState<'all' | 'live' | 'won' | 'lost'>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const toast = useCallback((m: string, t?: 'success' | 'info') => onToast?.(m, t), [onToast]);
  const pageRef = useRef<HTMLDivElement>(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;
  const running = data?.run?.state === 'RUNNING';
  const onRunningRef = useRef(onRunning);
  onRunningRef.current = onRunning;
  useEffect(() => {
    if (data) onRunningRef.current?.(running);
  }, [data, running]);

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
  // Live automation: a 1s beat while the agent runs (next-scan ring, step words); nothing ticks when it's off
  const [beat, setBeat] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => document.visibilityState === 'visible' && setBeat(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  // A new agent notice (order, fill, result) while the page is open: show it straight away
  useEffect(() => {
    if (pulse) load(true);
  }, [pulse, load]);
  // A notification's trade: open the Trades tab and ring it
  useEffect(() => {
    if (!focusId || !data) return;
    setTab('trades');
    setTradeFilter('all');
    setPicked(focusId);
    const t = setTimeout(() => pageRef.current?.querySelector(`[data-trade="${focusId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 160);
    return () => clearTimeout(t);
  }, [focusId, data]);

  const check = useMemo(() => normalizeAgentSettings(draft), [draft]);
  // The page shows only the credits the trader has (owner-specified, no price list); enough = the agent's first trade
  const needed = AGENT_PRICING[draft.duration].perTrade;
  const credits = data?.credits ?? null;
  const short = credits !== null && credits < needed;
  const strategies = data?.strategies || [];
  const chosen = draft.strategyId ? strategies.find(x => x.id === draft.strategyId) || null : null;
  // A personal strategy's choices: its own timeframes (or any the agent runs), markets of the kinds it trades
  const sFrames = chosen?.ownTimeframes ? chosen.timeframes || [] : data?.strategyFrames || [];
  const sMarkets = (data?.strategyMarkets || []).filter(m => !chosen?.kinds?.length || chosen.kinds.includes(m.kind));
  /** Picks what the agent trades with (kept with the agent's settings, separate from the normal page's Strategy Builder) */
  const pickStrategy = (strategyId: string | null) => {
    // The engine keeps its back-tested markets on 1H/4H; a personal strategy picks its own (RDM = all the strategy's timeframes)
    let next: AgentSettings;
    if (!strategyId) {
      const markets = draft.markets.filter(m => AGENT_SYMBOLS.includes(m));
      next = { ...draft, strategyId: null, rdm: false, timeframes: AGENT_FRAMES[draft.style], markets: markets.length ? markets : AGENT_DEFAULTS.markets };
    } else {
      const st = strategies.find(x => x.id === strategyId);
      const kinds = st?.kinds || [];
      const okMarket = (m: string) => !kinds.length || kinds.includes(agentMarketInfo(m)?.kind || '');
      const pool = (data?.strategyMarkets || []).filter(m => okMarket(m.symbol)).map(m => m.symbol);
      const markets = draft.markets.filter(okMarket).slice(0, AGENT_STRATEGY_MAX.markets);
      next = { ...draft, strategyId, rdm: true, timeframes: st?.timeframes?.slice(0, 1) || ['1H'], markets: markets.length ? markets : pool.slice(0, 1) };
    }
    setDraft(next);
    if (running) return;
    const v = normalizeAgentSettings(next);
    if (v.ok) apiFetch<AgentState>('/api/agent/settings', { method: 'PUT', body: JSON.stringify({ settings: v.settings }) }).then(d => setData(cur => (cur ? { ...cur, settings: d.settings, strategies: d.strategies } : d))).catch(() => {});
  };

  const patch = (p: Partial<AgentSettings>) => setDraft(d => ({ ...d, ...p }));
  const setStyle = (style: AgentStyle) => patch({ style, timeframes: AGENT_FRAMES[style] });
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const start = async () => {
    if (!check.ok) return setError((check as { message: string }).message);
    setBusy(true);
    setError('');
    try {
      // Before anything begins: read the balance again and stop here when it can't cover the agent's first trade
      const fresh = await apiFetch<AgentState>('/api/agent');
      setData(fresh);
      if (fresh.credits !== null && fresh.credits < AGENT_PRICING[check.settings.duration].perTrade) {
        setError('No credits available. Add credits to start the agent.');
        return;
      }
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
  const trades = data?.trades || [];
  const openTrades = trades.filter(t => t.state === 'OPEN' || t.state === 'PENDING');
  const marketLabel = (s: string) => data?.markets.find(m => m.symbol === s) || data?.strategyMarkets?.find(m => m.symbol === s) || agentMarketInfo(s);
  const linkStep = link?.stage === 'SIGNING_IN' ? 3 : link?.stage === 'DEPLOYING' ? 2 : 1;
  // The overview follows the live run, else all the agent's trades
  const st = (running && run?.stats) || data?.stats || null;
  const won = trades.filter(t => t.state === 'CLOSED' && t.result === 'WIN');
  const lost = trades.filter(t => t.state === 'CLOSED' && t.result === 'LOSS');
  const filtered = tradeFilter === 'live' ? openTrades : tradeFilter === 'won' ? won : tradeFilter === 'lost' ? lost : trades;
  const sel = filtered.find(t => t.id === picked) || filtered[0] || null;
  const runMarkets = running ? run!.settings.markets : draft.markets;
  const runFrames = running ? run!.settings.timeframes : draft.rdm && chosen ? chosen.timeframes || [] : draft.timeframes;
  const elapsed = running ? Math.min(1, Math.max(0, (beat - run!.startedAt) / Math.max(1, run!.endsAt - run!.startedAt))) : 0;
  const lastScan = run?.lastScanAt || run?.startedAt || beat;
  const nextScan = running ? 60 - (Math.floor((beat - lastScan) / 1000) % 60) : 60;
  const navTabs: Array<[Tab, string, number?]> = [
    ['trades', 'Trades', trades.length || undefined],
    ['activity', 'History'],
    ['settings', 'Settings'],
  ];
  const goSetupStart = () => {
    setTab('settings');
    setTimeout(() => pageRef.current?.querySelector('[data-start]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
  };
  const scanTiles = runMarkets.flatMap(m => runFrames.map(tf => ({ m, tf }))).slice(0, 8);

  return (
    <div ref={pageRef} className="ag fixed inset-0 z-[46] overflow-y-auto overscroll-contain" role="main" aria-label="Trading Agent">
      {/* Top bar: brand, white pill navigation, round buttons */}
      <header className="sticky top-0 z-20 ag-bar">
        <div className="ag-bar-row max-w-[1240px] mx-auto px-3 sm:px-6 h-[60px] sm:h-[68px] flex items-center gap-2 sm:gap-3">
          <span className="ag-brand">
            <span className={`ag-mark ${running ? 'on' : ''}`} aria-hidden="true">
              <Bot className="w-4 h-4" />
            </span>
            <span className="hidden sm:inline">Trading Agent</span>
          </span>
          <nav className="ag-nav mx-auto" role="tablist" aria-label="Trading agent">
            <span className="ag-nav-ico hidden md:grid" aria-hidden="true">
              <LayoutGrid className="w-3.5 h-3.5" />
            </span>
            {navTabs.map(([id, label, count]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`ag-nav-tab ${tab === id ? 'on' : ''}`}>
                {label}
                {count ? <span className="ag-nav-count">{count}</span> : null}
              </button>
            ))}
          </nav>
          <span className={`ag-status hidden sm:inline-flex ${running ? 'on' : ''}`}>
            <span className="ag-status-dot" />
            {running ? 'Running' : run ? 'Ended' : 'Off'}
          </span>
          <button type="button" onClick={() => load()} disabled={loading} className="ag-round" aria-label="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="relative max-w-[1240px] mx-auto px-4 sm:px-6 pt-3 pb-[max(4rem,calc(env(safe-area-inset-bottom)+3rem))]">
        {/* Title row */}
        <div className="flex items-center gap-3 sm:gap-4">
          <button type="button" onClick={onBack} className="ag-round" aria-label="Back to MarketX">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="min-w-0 truncate text-[23px] min-[360px]:text-[28px] sm:text-[44px] font-light tracking-[-0.03em] text-white leading-tight">Trading Agent</h1>
          <div className="ml-auto flex items-center gap-2">
            {data &&
              (running ? (
                <button type="button" onClick={() => setConfirmStop(true)} className="ag-pill">
                  <Square className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Stop agent</span>
                  <span className="sm:hidden">Stop</span>
                </button>
              ) : (
                <button type="button" onClick={goSetupStart} className="ag-pill">
                  <Power className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Start the agent</span>
                  <span className="sm:hidden">Start</span>
                </button>
              ))}
          </div>
        </div>

        {!data && loading && (
          <div className="py-28 flex flex-col items-center gap-4 text-[var(--ag-muted)]">
            <span className="ag-mark on" aria-hidden="true">
              <Bot className="w-4 h-4" />
            </span>
            <p className="text-xs">Waking the agent…</p>
          </div>
        )}
        {!data && !loading && error && (
          <div className="py-24 text-center">
            <p className="text-sm text-rose-300">{error}</p>
            <button type="button" onClick={() => load()} className="mt-4 ag-pill">
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
          </div>
        )}

        {data && (
          <>
            {tab !== 'settings' && (
            <>
            {/* ---------- Overview: results + credits ---------- */}
            <div className="mt-5 sm:mt-7 grid lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-3 sm:gap-4">
              <section className="ag-card ag-rise p-5 sm:p-6" style={rise(0)}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-6">
                  <div className="min-w-0">
                    <p className="ag-label">{running ? 'Won this run' : 'Won'}</p>
                    <p key={`w${st?.winRate}`} className="ag-big ag-pop mt-1.5">{st?.trades ? `${st.winRate}%` : '–'}</p>
                    <div className="mt-5 flex justify-between ag-label text-[11px]">
                      <span>{st?.wins ?? 0} won</span>
                      <span>{st?.losses ?? 0} lost</span>
                    </div>
                    <div className="mt-1.5 ag-bar-track">
                      <span className="ag-bar-fill" style={{ width: `${st?.trades ? st.winRate : 0}%` }} />
                    </div>
                    <div className="mt-4 ag-avatars" aria-label="Markets">
                      {runMarkets.slice(0, 6).map(m => (
                        <MarketAv key={m} symbol={m} />
                      ))}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="ag-label">Result</p>
                    <p key={`r${st?.totalR}`} className={`ag-big ag-pop mt-1.5 ${st && st.totalR > 0 ? '!text-[var(--ag-accent-text)]' : st && st.totalR < 0 ? '!text-rose-300' : ''}`}>
                      {st?.trades ? `${sign(st.totalR)}R` : '–'}
                    </p>
                    <div className="mt-5 flex justify-between ag-label text-[11px]">
                      <span>{st?.trades ? `${sign(st.pnlPct)}% of account` : 'No closed trades'}</span>
                      <span>{openTrades.length} live</span>
                    </div>
                    <div className="mt-1.5 ag-bar-track">
                      <span className={`ag-bar-fill ${running && openTrades.length ? 'run' : ''}`} style={{ width: `${Math.min(100, (openTrades.length / Math.max(1, (running ? run!.settings : draft).tradesPerDay)) * 100)}%` }} />
                    </div>
                    <p className="mt-4 text-[11.5px] text-[var(--ag-muted)] leading-snug">
                      {running ? `Up to ${run!.settings.tradesPerDay} a day · risk ${run!.settings.riskPct}% a trade` : `${data.stats.trades} closed trade${data.stats.trades === 1 ? '' : 's'} so far`}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="ag-label">{running ? 'Time left' : 'Status'}</p>
                    <p className="ag-big mt-1.5" data-clock={clock}>
                      {running ? left(run!.endsAt) : <span className="text-[24px] text-[var(--ag-text-2)]">{run ? ENDED_TEXT[run.endedReason || 'TIME_UP'] : 'Off'}</span>}
                    </p>
                    <div className="mt-5 flex justify-between ag-label text-[11px]">
                      <span>{running ? AGENT_PRICING[run!.settings.duration].label : AGENT_PRICING[draft.duration].label}</span>
                      <span>{running ? `${Math.round(elapsed * 100)}%` : AGENT_RUN_LABEL[draft.duration]}</span>
                    </div>
                    <div className="mt-1.5 ag-bar-track">
                      <span className={`ag-bar-fill ${running ? 'run' : ''}`} style={{ width: `${running ? Math.max(3, elapsed * 100) : 0}%` }} />
                    </div>
                    <p className="mt-4 text-[11.5px] text-[var(--ag-muted)] leading-snug truncate">{running ? (run!.strategyName ? `Strategy: ${run!.strategyName}` : 'MarketX engine') : chosen ? `Strategy: ${chosen.name}` : 'MarketX engine'}</p>
                  </div>
                </div>
              </section>

              <section className="ag-card ag-rise p-5 sm:p-6 pb-0 sm:pb-0 flex flex-col" style={rise(1)}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0">
                    <p className="ag-label">Credits available</p>
                    <div className="mt-1.5 flex items-center gap-2.5 flex-wrap">
                      <p className={`ag-big ${short ? '!text-amber-300' : ''}`}>{credits === null ? '∞' : short ? '0' : credits.toLocaleString()}</p>
                      {onBuyCredits && credits !== null && (
                        <button type="button" onClick={onBuyCredits} className="ag-pill !h-7 !px-3 !text-[11px]">
                          Buy credits
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-[var(--ag-muted)]">{short ? 'No credits available: the agent can’t start.' : 'Used only when the agent places a trade, refunded if it never fills.'}</p>
                  </div>
                  {onBuyCredits && (
                    <button type="button" onClick={onBuyCredits} className="ag-round sm ml-auto" aria-label="Open credits">
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {/* Phones: the mini cards take the full width and the button sits under them (no squeeze, no overlap) */}
                <div className="mt-auto pt-5 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3 sm:items-end">
                  <div className="ag-minis">
                    <div className={`ag-mini ${link?.status === 'CONNECTED' && !running ? 'hi' : ''}`}>
                      <p className="text-[11.5px] font-semibold truncate">{link?.status === 'CONNECTED' ? `*${String(link.login).slice(-4)}` : link?.status === 'CONNECTING' ? 'Linking' : 'Not linked'}</p>
                      <p className="text-[10.5px] opacity-70">MT5</p>
                    </div>
                    <div className={`ag-mini ${running ? 'hi' : ''}`}>
                      <p className="text-[11.5px] font-semibold truncate">{running ? left(run!.endsAt) : AGENT_PRICING[draft.duration].label}</p>
                      <p className="text-[10.5px] opacity-70">{running ? 'Running' : 'Run'}</p>
                    </div>
                    <div className="ag-mini">
                      <p className="text-[11.5px] font-semibold truncate">{(running ? run!.settings.riskPct : draft.riskPct) + '%'}</p>
                      <p className="text-[10.5px] opacity-70">Risk</p>
                    </div>
                  </div>
                  <div className="sm:pb-4 [&>button]:w-full sm:[&>button]:w-auto">
                    {running ? (
                      <button type="button" onClick={() => setConfirmStop(true)} className="ag-pill white">
                        Stop now
                      </button>
                    ) : (
                      <button type="button" onClick={goSetupStart} className="ag-pill white">
                        Start now
                      </button>
                    )}
                  </div>
                </div>
              </section>
            </div>
            </>
            )}

            {/* Stop: asks first */}
            {running && (
              <div className={`ag-collapse ${confirmStop ? 'open' : ''}`}>
                <div>
                  <div className="mt-3 ag-card p-4 flex flex-wrap items-center gap-2.5">
                    <p className="text-[12.5px] text-[var(--ag-text-2)] mr-auto">Stop the agent? Orders waiting to fill are cancelled and their credits refunded.</p>
                    <button type="button" disabled={busy} onClick={() => stop(false)} className="ag-pill">
                      Stop, keep open trades
                    </button>
                    <button type="button" disabled={busy} onClick={() => stop(true)} className="ag-pill danger">
                      Stop and close them now
                    </button>
                    <button type="button" onClick={() => setConfirmStop(false)} className="ag-pill !border-transparent">
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}
            {error && (
              <p className="mt-3 ag-rise text-[12px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-full px-4 py-2.5" role="alert">
                {error}
              </p>
            )}

            {tab !== 'settings' && (
            <>
            {/* ---------- Live automation: moves only while the agent runs ---------- */}
            <section className="mt-3 sm:mt-4 ag-card ag-live ag-rise p-5 sm:p-6" style={rise(2)} data-on={running ? '1' : undefined} aria-label="Live automation">
              <div className="relative flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-medium text-white flex items-center gap-2">
                    <Radar className={`w-4 h-4 ${running ? 'text-[var(--ag-accent-text)]' : 'text-[var(--ag-muted)]'}`} /> Live automation
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-[var(--ag-muted)]">
                    {running
                      ? `Scanning ${runMarkets.length} market${runMarkets.length === 1 ? '' : 's'} on ${runFrames.join(' + ')} every minute, on its own.`
                      : run
                        ? `Stopped: ${ENDED_TEXT[run.endedReason || 'TIME_UP'].toLowerCase()}. Start a run and it picks up here.`
                        : 'Switch the agent on and you can watch it work here.'}
                  </p>
                </div>
                <span className={`ml-auto ag-status ${running ? 'on' : ''}`}>
                  <span className="ag-status-dot" />
                  {running ? 'Working' : 'Stopped'}
                </span>
              </div>

              {/* The pipeline every scan goes through */}
              <div className="relative mt-5 ag-flow" aria-hidden="true">
                <span className="ag-flow-line" />
                {FLOW.map(([label, Icon], n) => (
                  <div key={label} className="ag-node" style={{ ['--n' as any]: n }}>
                    <span className="ag-node-dot">
                      <Icon className="w-4 h-4" />
                    </span>
                    <span>{label}</span>
                  </div>
                ))}
              </div>

              <div className="relative mt-5 grid lg:grid-cols-[minmax(0,1fr)_280px] gap-3">
                {/* Market scan tiles */}
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
                  {scanTiles.map(({ m, tf }, i) => {
                    const live = openTrades.find(t => t.symbol === m && t.timeframe === tf);
                    const p = scanPath(`${m}|${tf}`);
                    const step = live ? (live.state === 'OPEN' ? 'In a trade' : 'Order live') : SCAN_STEPS[(Math.floor(beat / 3200) + i) % SCAN_STEPS.length];
                    return (
                      <div key={`${m}${tf}`} className={`ag-scan ${running && live ? 'hot' : ''}`} style={{ ['--d' as any]: `${12 + (i % 4) * 2.5}s`, ['--s' as any]: `${2.8 + (i % 3) * 0.6}s`, ['--delay' as any]: `${(i * 0.35).toFixed(2)}s` }}>
                        <div className="flex items-center gap-2 min-w-0">
                          <MarketAv symbol={m} size={26} />
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-white truncate">{marketLabel(m)?.label || m}</p>
                            <p className="text-[10px] text-[var(--ag-muted)]">{tf}</p>
                          </div>
                        </div>
                        <div className="ag-scan-chart" aria-hidden="true">
                          <svg viewBox="0 0 200 54" preserveAspectRatio="none">
                            <defs>
                              <linearGradient id="ag-fade" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0" stopColor="#8b5cf6" stopOpacity=".28" />
                                <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
                              </linearGradient>
                            </defs>
                            <path className="area" d={p.area} />
                            <path d={p.line} />
                          </svg>
                        </div>
                        <p className="mt-1.5 ag-scan-state">
                          <i />
                          <span key={running ? step : 'off'} className="ag-word truncate">
                            {running ? step : 'Paused'}
                          </span>
                        </p>
                      </div>
                    );
                  })}
                  {!scanTiles.length && <p className="col-span-full text-[12px] text-[var(--ag-muted)]">Pick markets and timeframes in Setup.</p>}
                </div>

                {/* Next scan + the agent's latest steps */}
                <div className="ag-soft p-4 flex flex-col gap-3 min-w-0">
                  <div className="flex items-center gap-3.5">
                    <div className="ag-radar" aria-hidden="true">
                      <span className="ag-radar-sweep" />
                      <svg viewBox="0 0 84 84">
                        <circle className="bg" cx="42" cy="42" r="36" />
                        <circle className="fg" cx="42" cy="42" r="36" strokeDasharray={226.2} strokeDashoffset={running ? (226.2 * nextScan) / 60 : 226.2} />
                      </svg>
                      <span className="absolute inset-0 grid place-items-center text-[15px] font-semibold text-white tabular-nums">{running ? `${nextScan}s` : '–'}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-white">{running ? 'Next scan' : 'Not scanning'}</p>
                      <p className="text-[11px] text-[var(--ag-muted)] leading-snug">
                        {running ? `Quality ${run!.settings.strategyId ? data.strategyMinQuality ?? 45 : data.minQuality}+ only, so some days it takes none.` : 'The agent is off.'}
                      </p>
                    </div>
                  </div>
                  <ol className="ag-feed space-y-2 min-w-0" aria-label="Latest steps">
                    {data.log.slice(0, 3).map((l, i) => (
                      <li key={`${l.at}-${i}`} className="flex gap-2 text-[11.5px] leading-snug min-w-0" style={rise(i)}>
                        <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${i === 0 && running ? 'bg-[#a855f7]' : 'bg-[var(--ag-line-2)]'}`} />
                        <span className="text-[var(--ag-text-2)] line-clamp-2 break-words">{l.text}</span>
                      </li>
                    ))}
                    {!data.log.length && <li className="text-[11.5px] text-[var(--ag-muted)]">Its steps show here as it works.</li>}
                  </ol>
                </div>
              </div>
            </section>
            </>
            )}

            {/* ---------- Tabs ---------- */}
            <div key={tab} className="mt-6 ag-fade">
              {tab === 'settings' && (
                <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-4 items-start">
                  <div className="lg:col-span-2 -mb-1 px-1">
                    <p className="text-[18px] font-medium text-white flex items-center gap-2">
                      <Settings2 className="w-4 h-4 text-[var(--ag-accent-text)]" /> Settings
                    </p>
                    <p className="text-[12px] text-[var(--ag-muted)]">Strategy, markets, risk, how long it runs, your MT5 account and alerts on this device.</p>
                  </div>
                  <div className={`space-y-4 ${running ? 'opacity-55 pointer-events-none select-none' : ''}`} aria-disabled={running}>
                    {running && <p className="text-[12px] text-[var(--ag-muted)] px-1">Stop the agent to change its setup.</p>}
                    <Section title="Strategy" hint="What the agent trades with. Separate from your normal MarketX setup." i={0}>
                      <div className="grid sm:grid-cols-2 gap-2">
                        <button type="button" onClick={() => pickStrategy(null)} className={`ag-choice ${!draft.strategyId ? 'on' : ''}`} aria-pressed={!draft.strategyId}>
                          <span className="flex items-center gap-1.5 text-[13px] font-semibold text-white">
                            <Bot className="w-3.5 h-3.5 text-[var(--ag-accent-text)]" /> MarketX engine
                            <span className="ml-auto text-[10px] font-semibold text-[var(--ag-accent-text)]">Default</span>
                          </span>
                          <span className="block mt-0.5 text-[10.5px] text-[var(--ag-muted)] leading-snug">Steady mode: supply and demand zones with a Fibonacci entry, back-tested on these markets</span>
                        </button>
                        {strategies.map(x => (
                          <button key={x.id} type="button" onClick={() => pickStrategy(x.id)} className={`ag-choice ${draft.strategyId === x.id ? 'on' : ''}`} aria-pressed={draft.strategyId === x.id}>
                            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-white min-w-0">
                              <span className="truncate">{x.name}</span>
                              {x.setup && <span className="ml-auto shrink-0 text-[10px] font-semibold text-violet-300">{x.setup}</span>}
                            </span>
                            <span className="block mt-0.5 text-[10.5px] text-[var(--ag-muted)] leading-snug line-clamp-2">{x.summary || 'Your own strategy'}</span>
                          </button>
                        ))}
                      </div>
                      {draft.strategyId && !chosen && <p className="mt-2 text-[11px] text-amber-300">That strategy no longer exists. Pick another one, or the MarketX engine.</p>}
                      <button type="button" onClick={() => setBuilderOpen(true)} className="mt-3 ag-pill">
                        <WandSparkles className="w-3.5 h-3.5" /> {strategies.length ? 'Create or edit a strategy' : 'Create your own strategy'}
                      </button>
                      {draft.strategyId && <p className="mt-2 text-[11px] text-[var(--ag-muted)]">Your strategy’s own rules find the setups (quality {data.strategyMinQuality ?? 45}+). The agent still places, sizes and manages every trade.</p>}
                    </Section>

                    {!draft.strategyId && (
                      <Section title="Trade type" hint="Steady mode: limit entries, a wider stop, calm markets only" i={1}>
                        <div className="grid grid-cols-3 gap-2">
                          {(['DAY', 'SWING', 'ANY'] as AgentStyle[]).map(x => (
                            <button key={x} type="button" onClick={() => setStyle(x)} className={`ag-choice ${draft.style === x ? 'on' : ''}`} aria-pressed={draft.style === x}>
                              <span className="block text-[13px] font-semibold text-white">{AGENT_STYLE_INFO[x].label}</span>
                              <span className="block mt-0.5 text-[10.5px] text-[var(--ag-muted)] leading-snug">{AGENT_STYLE_INFO[x].hint}</span>
                            </button>
                          ))}
                        </div>
                      </Section>
                    )}

                    {draft.strategyId ? (
                      <Section title="Timeframes and markets" hint={`Your strategy decides the trades, so you choose where it runs: RDM or up to ${AGENT_STRATEGY_MAX.timeframes} timeframes, up to ${AGENT_STRATEGY_MAX.markets} markets.`} i={2}>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => patch({ rdm: !draft.rdm })} className={`ag-chip ${draft.rdm ? 'on' : ''}`} aria-pressed={draft.rdm} title="Every timeframe your strategy trades; the strongest setup wins">
                            RDM
                          </button>
                          {sFrames.map(tf => (
                            <button
                              key={tf}
                              type="button"
                              disabled={draft.rdm}
                              onClick={() => patch({ timeframes: toggle(draft.timeframes, tf).slice(-AGENT_STRATEGY_MAX.timeframes) })}
                              className={`ag-chip ${!draft.rdm && draft.timeframes.includes(tf) ? 'on' : ''} ${draft.rdm ? 'opacity-45' : ''}`}
                              aria-pressed={!draft.rdm && draft.timeframes.includes(tf)}
                            >
                              {tf}
                            </button>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] text-[var(--ag-muted)]">
                          {draft.rdm ? `RDM: the agent reads ${(chosen?.timeframes || sFrames).join(', ')} and takes the strongest setup.` : chosen?.ownTimeframes ? `The timeframes "${chosen.name}" trades.` : 'Any timeframe: your strategy has no timeframe rule.'}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {sMarkets.map(m => (
                            <button key={m.symbol} type="button" onClick={() => patch({ markets: toggle(draft.markets, m.symbol).slice(-AGENT_STRATEGY_MAX.markets) })} className={`ag-chip !pl-1.5 ${draft.markets.includes(m.symbol) ? 'on' : ''}`} aria-pressed={draft.markets.includes(m.symbol)}>
                              <MarketAv symbol={m.symbol} size={24} /> {m.label} <span className="text-[10px] opacity-60">{m.mt5}</span>
                            </button>
                          ))}
                        </div>
                        {!!chosen?.kinds?.length && <p className="mt-2 text-[11px] text-[var(--ag-muted)]">Only {chosen.kinds.join(', ')} markets: the kinds "{chosen.name}" trades.</p>}
                      </Section>
                    ) : (
                      <Section title="Timeframes and markets" hint="The MarketX engine trades the markets its back-test covered and that held up, on 1H and 4H" i={2}>
                        <div className="flex flex-wrap gap-2">
                          {AGENT_FRAMES[draft.style].map(tf => (
                            <button key={tf} type="button" onClick={() => patch({ timeframes: toggle(draft.timeframes, tf) })} className={`ag-chip ${draft.timeframes.includes(tf) ? 'on' : ''}`} aria-pressed={draft.timeframes.includes(tf)}>
                              {tf}
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {data.markets.map(m => (
                            <button key={m.symbol} type="button" onClick={() => patch({ markets: toggle(draft.markets, m.symbol) })} className={`ag-chip !pl-1.5 ${draft.markets.includes(m.symbol) ? 'on' : ''}`} aria-pressed={draft.markets.includes(m.symbol)}>
                              <MarketAv symbol={m.symbol} size={24} /> {m.label} <span className="text-[10px] opacity-60">{m.mt5}</span>
                            </button>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] text-[var(--ag-muted)]">Want other markets or timeframes? Pick your own strategy above.</p>
                      </Section>
                    )}

                    <Section title="Risk and limits" i={3}>
                      <div className="grid grid-cols-2 gap-2.5">
                        <Stepper title="Risk per trade" hint="Of your account, lost if a trade hits its stop" label="risk" value={draft.riskPct} min={AGENT_LIMITS.riskPct.min} max={AGENT_LIMITS.riskPct.max} step={0.1} suffix="%" onChange={v => patch({ riskPct: v })} />
                        <Stepper title="Trades per day" hint="The most it opens in a day" label="trades per day" value={draft.tradesPerDay} min={AGENT_LIMITS.tradesPerDay.min} max={AGENT_LIMITS.tradesPerDay.max} step={1} onChange={v => patch({ tradesPerDay: v })} />
                        <Stepper title="Profit target" hint="Stops taking trades once it is up this much" label="profit target" value={draft.profitTargetPct} min={0} max={AGENT_LIMITS.profitTargetPct.max} step={0.5} suffix="%" onChange={v => patch({ profitTargetPct: v })} />
                        <Stepper title="Loss limit" hint="The run stops once it is down this much" label="loss limit" value={draft.lossLimitPct} min={0} max={AGENT_LIMITS.lossLimitPct.max} step={0.5} suffix="%" onChange={v => patch({ lossLimitPct: v })} />
                      </div>
                    </Section>

                    <Section title="How long it runs" i={4}>
                      <div className="grid grid-cols-3 gap-2">
                        {(Object.keys(AGENT_PRICING) as AgentDuration[]).map(k => (
                          <button key={k} type="button" onClick={() => patch({ duration: k })} className={`ag-choice ${draft.duration === k ? 'on' : ''}`} aria-pressed={draft.duration === k}>
                            <span className="block text-[13px] font-semibold text-white">{AGENT_PRICING[k].label}</span>
                            <span className="block mt-0.5 text-[10.5px] text-[var(--ag-muted)]">{AGENT_RUN_LABEL[k]}</span>
                          </button>
                        ))}
                      </div>
                      {/* Credits: only what the trader has (owner-specified) */}
                      <div className={`mt-3 ag-soft p-3.5 flex items-center gap-3 ${short ? '!border-amber-400/30 !bg-amber-500/10' : ''}`}>
                        <span className={`ag-icon ${short ? 'wait' : 'ok'}`}>
                          <Coins className="w-4 h-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className={`text-[13px] font-semibold ${short ? 'text-amber-300' : 'text-white'}`}>
                            {credits === null ? 'Unlimited credits' : short ? 'No credits available' : `${credits.toLocaleString()} credits available`}
                          </p>
                          <p className="text-[11px] text-[var(--ag-muted)] leading-snug">
                            {short ? 'The agent can’t start until you add credits.' : 'Credits come from your balance only when the agent places a trade, and are refunded if it never fills.'}
                          </p>
                        </div>
                        {short && onBuyCredits && (
                          <button type="button" onClick={onBuyCredits} className="ag-pill accent shrink-0 !h-9">
                            Buy credits
                          </button>
                        )}
                      </div>
                    </Section>

                    {!running && (
                      <div className="ag-rise" style={rise(5)} data-start>
                        <button type="button" onClick={start} disabled={busy || !check.ok || short || !allowed} className="w-full ag-cta">
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : short ? <Coins className="w-4 h-4" /> : <Power className="w-4 h-4" />} {short ? 'No credits available' : 'Start the agent'}
                        </button>
                        {!check.ok && <p className="mt-2 text-[11.5px] text-amber-300 px-1">{(check as { message: string }).message}</p>}
                      </div>
                    )}
                  </div>

                  {/* Right column: Pro, MT5, alerts on this device, back-test */}
                  <div className="space-y-4 lg:sticky lg:top-24">
                    {access && !allowed && (
                      <section className="ag-card ag-rise p-5" style={rise(1)}>
                        <div className="flex items-center gap-2">
                          <Crown className="w-4 h-4 text-[var(--ag-accent-text)]" />
                          <p className="text-[14px] font-semibold text-white">The Trading Agent is part of Pro</p>
                        </div>
                        <p className="mt-1 text-[12px] text-[var(--ag-muted)]">Upgrade to Pro to switch it on. Credits are used per trade the agent takes.</p>
                        {onUpgrade && (
                          <button type="button" onClick={onUpgrade} className="mt-3.5 w-full ag-cta !h-12">
                            <Lock className="w-4 h-4" /> Upgrade to Pro
                          </button>
                        )}
                      </section>
                    )}
                    {access && allowed && !access.staff && access.freeUntil && (
                      <p className="ag-rise text-[11.5px] text-[var(--ag-muted)] flex items-center gap-1.5 px-1" style={rise(1)}>
                        <Crown className="w-3.5 h-3.5 text-[var(--ag-accent-text)]" /> Free for everyone until{' '}
                        {new Date(access.freeUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, then part of Pro.
                      </p>
                    )}

                    {/* MT5 */}
                    <section className="ag-card ag-rise p-5" style={rise(2)}>
                      <div className="flex gap-3">
                        <span className={`ag-icon ${link?.status === 'CONNECTED' ? 'ok' : link?.status === 'FAILED' ? 'bad' : 'wait'}`}>
                          <Plug className="w-4 h-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-semibold text-white">
                            {link?.status === 'CONNECTED' ? `MT5 linked · ${link.login}` : link?.status === 'CONNECTING' ? 'Linking your MT5…' : link?.status === 'FAILED' ? `MT5 not linked · ${link.server}` : 'MT5'}
                          </p>
                          <p className={`mt-0.5 text-[11.5px] leading-relaxed ${link?.status === 'FAILED' ? 'text-rose-300' : 'text-[var(--ag-muted)]'}`} role={link?.status === 'FAILED' ? 'alert' : undefined}>
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
                            <span key={m} className={`text-[10.5px] px-2.5 py-1 rounded-full ${bs ? 'bg-violet-500/10 text-[var(--ag-accent-text)]' : 'bg-[var(--ag-panel-2)] text-[var(--ag-muted)]'}`}>
                              {marketLabel(m)?.label || m}: {bs || 'not at your broker'}
                            </span>
                          ))}
                        </div>
                      )}
                      {link?.status === 'CONNECTING' && (
                        <div className="mt-3.5">
                          <div className="flex items-center gap-2 text-[11.5px] text-[var(--ag-text-2)]">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--ag-accent-text)]" />
                            <span>
                              Step {linkStep} of 3: {linkStep === 3 ? 'signing in to your broker' : linkStep === 2 ? 'starting the MT5 connection' : 'checking your details'}
                            </span>
                            <span className="ml-auto tabular-nums text-[var(--ag-muted)]">
                              {(() => {
                                const sec = Math.max(0, Math.floor(((clock || Date.now()) - link.linkedAt) / 1000));
                                return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
                              })()}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-1.5" aria-hidden="true">
                            {[1, 2, 3].map(n => (
                              <span key={n} className={`ag-step ${n < linkStep ? 'done' : n === linkStep ? 'now' : ''}`} />
                            ))}
                          </div>
                          <p className="mt-2 text-[10.5px] text-[var(--ag-muted)]">Usually under 2 minutes; a broker server MT5 hasn't seen before can take up to 5. If it can't link, the reason shows here.</p>
                        </div>
                      )}
                      {link && (
                        <div className="mt-3.5 flex gap-2">
                          {link.status !== 'FAILED' && (
                            <button type="button" disabled={busy} onClick={() => mt5Action('/api/agent/mt5/refresh', 'POST')} className="ag-pill !h-9">
                              <RefreshCw className="w-3 h-3" /> Check
                            </button>
                          )}
                          <button type="button" disabled={busy} onClick={() => mt5Action('/api/agent/mt5', 'DELETE')} className="ag-pill !h-9">
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
                          <label className="flex items-start gap-2.5 text-[11.5px] text-[var(--ag-muted)] cursor-pointer leading-relaxed">
                            <input type="checkbox" checked={mt5Form.consent} onChange={e => setMt5Form(f => ({ ...f, consent: e.target.checked }))} className="mt-0.5 accent-violet-500" />
                            <span>I let the MarketX agent place and close trades on this account. The password goes straight to the secure MT5 connection: MarketX never stores it. An investor password can't place trades.</span>
                          </label>
                          <button type="submit" disabled={busy || !mt5Form.login || !mt5Form.server || !mt5Form.password || !mt5Form.consent} className="w-full ag-pill accent !h-11">
                            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Link MT5
                          </button>
                        </form>
                      )}
                    </section>

                    {/* The agent's notices on this device (the same switch as the sidebar's) */}
                    <section className="ag-card ag-rise p-5" style={rise(3)}>
                      <div className="flex items-center gap-2.5 mb-3">
                        <span className="ag-icon ok">
                          <Bell className="w-4 h-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-white">Alerts on this device</p>
                          <p className="text-[11.5px] text-[var(--ag-muted)]">Orders, fills, wins and losses show on your phone or computer, and in MarketX's notifications wherever you are.</p>
                        </div>
                      </div>
                      <PushToggle what="every agent order, fill and result" onToast={toast} />
                    </section>

                    <section className="ag-card ag-rise overflow-hidden" style={rise(4)}>
                      <button type="button" onClick={() => setShowBacktest(v => !v)} aria-expanded={showBacktest} className="w-full flex items-center gap-2 text-left px-5 py-4 text-[12.5px] text-[var(--ag-text-2)] hover:text-white cursor-pointer">
                        <Info className="w-4 h-4 shrink-0 text-[var(--ag-muted)]" /> How it has done in back-tests, and the risks
                        <ChevronDown className={`w-4 h-4 ml-auto transition-transform duration-300 ${showBacktest ? 'rotate-180' : ''}`} />
                      </button>
                      <div className={`ag-collapse ${showBacktest ? 'open' : ''}`}>
                        <div>
                          <div className="px-5 pb-4 text-[11.5px] leading-relaxed text-[var(--ag-muted)] space-y-1.5">
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
                  </div>
                </div>
              )}

              {tab === 'trades' && (
                <div>
                  <div className="relative z-10 flex justify-center -mb-5">
                    <div className="ag-notch ag-scroll-x max-w-full" role="tablist" aria-label="Filter trades">
                      {(
                        [
                          ['all', 'All trades', trades.length],
                          ['live', 'Live', openTrades.length],
                          ['won', 'Won', won.length],
                          ['lost', 'Lost', lost.length],
                        ] as const
                      ).map(([id, label, n]) => (
                        <button key={id} type="button" role="tab" aria-selected={tradeFilter === id} onClick={() => setTradeFilter(id)} className={`ag-seg shrink-0 ${tradeFilter === id ? 'on' : ''}`}>
                          {label}
                          {id !== 'all' && <b>{n}</b>}
                        </button>
                      ))}
                    </div>
                  </div>
                  <section className="ag-paper ag-rise p-4 sm:p-6 pt-9 sm:pt-10">
                    <div className="flex items-center gap-2 px-1">
                      <p className="text-[15px] font-medium">Agent trades</p>
                      <p className="muted text-[11.5px] hidden sm:block">
                        · {data.stats.trades ? `${data.stats.winRate}% won · ${sign(data.stats.totalR)}R · ${sign(data.stats.pnlPct)}%` : 'no closed trades yet'}
                      </p>
                    </div>
                    {!filtered.length ? (
                      <div className="py-14 text-center">
                        <Target className="w-6 h-6 mx-auto text-[var(--ag-muted)]" />
                        <p className="mt-3 text-[12.5px] muted">{trades.length ? 'Nothing here for this filter.' : 'No trades yet. Switch the agent on and its orders show here.'}</p>
                      </div>
                    ) : (
                      <div className="mt-4 grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 items-start">
                        <div className="space-y-1 max-h-[560px] overflow-y-auto pr-1">
                          {filtered.map((t, i) => {
                            const chip = chipOf(t);
                            const on = sel?.id === t.id;
                            return (
                              <button key={t.id} type="button" data-trade={t.id} onClick={() => setPicked(t.id)} className={`ag-row ag-rise ${on ? 'on' : ''} ${t.id === focusId ? 'ag-focus' : ''}`} style={rise(i)}>
                                <MarketAv symbol={t.symbol} size={36} />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[13px] font-semibold truncate">
                                    # {marketLabel(t.symbol)?.mt5 || t.symbol} <span className="font-normal muted">· {t.timeframe}</span>
                                  </span>
                                  <span className="block text-[11px] muted">
                                    {t.direction === 'LONG' ? 'Buy' : 'Sell'} · {ago(t.closedAt || t.filledAt || t.createdAt)}
                                  </span>
                                </span>
                                <span className="ag-row-chip hidden sm:inline-grid">{chip.text}</span>
                                <span className={`w-[64px] text-right text-[13.5px] font-semibold tabular-nums ${typeof t.r === 'number' ? (t.r > 0 ? 'text-emerald-500' : t.r < 0 ? 'text-rose-500' : '') : 'muted !font-medium'} ${on && typeof t.r === 'number' && t.r > 0 ? '!text-[var(--ag-accent-text)]' : ''} ${on && typeof t.r === 'number' && t.r < 0 ? '!text-rose-300' : ''}`}>
                                  {typeof t.r === 'number' ? `${sign(t.r)}R` : `${t.rr}R aim`}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {sel && (
                          <div key={sel.id} className="ag-detail ag-fade">
                            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                              <div className="min-w-0">
                                <p className="text-[11.5px] dim">Trade details</p>
                                <div className="mt-1 flex items-center gap-2.5">
                                  <p className="text-[26px] sm:text-[30px] font-medium tracking-[-0.02em] leading-none">
                                    <span className="dim text-[16px] mr-1">#</span>
                                    {marketLabel(sel.symbol)?.mt5 || sel.symbol}
                                  </p>
                                  <span className={`ag-pill !h-7 !px-3 !text-[11px] ${chipOf(sel).tone === 'win' ? 'accent' : ''}`}>{chipOf(sel).text}</span>
                                </div>
                              </div>
                              <div>
                                <p className="text-[11.5px] dim">Side</p>
                                <p className={`mt-1 text-[18px] font-semibold ${sel.direction === 'LONG' ? 'text-[#fff]' : 'text-rose-200'}`}>{sel.direction === 'LONG' ? 'Buy' : 'Sell'}</p>
                              </div>
                              <div>
                                <p className="text-[11.5px] dim">Chart</p>
                                <p className="mt-1 text-[18px] font-semibold">{sel.timeframe}</p>
                              </div>
                            </div>
                            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                              {(
                                [
                                  ['Entry', exactPrice(sel.entry)],
                                  ['Stop', exactPrice(sel.stop)],
                                  ['Target', exactPrice(sel.target)],
                                  ['Quality', `${sel.quality}/100`],
                                ] as const
                              ).map(([k, v]) => (
                                <div key={k} className="ag-dtile">
                                  <ArrowUpRight className="absolute right-2.5 top-2.5 w-3.5 h-3.5 dim" />
                                  <p className="text-[14px] font-medium tabular-nums truncate pr-4">{v}</p>
                                  <p className="mt-3 text-[10.5px] dim">{k}</p>
                                </div>
                              ))}
                            </div>
                            {sel.mt5 && (
                              <p className={`mt-3 text-[11.5px] ${sel.mt5.state === 'FAILED' ? 'text-amber-300' : 'text-[#fff]'}`}>
                                {sel.mt5.state === 'FAILED' ? `Not placed on MT5: ${sel.mt5.error || 'error'}` : `On MT5 · ${sel.mt5.symbol} · ${sel.mt5.volume} lots${sel.mt5.state === 'CANCELLED' ? ' · cancelled' : sel.mt5.state === 'CLOSED' ? ' · closed' : ''}`}
                              </p>
                            )}
                            {sel.proof?.id && (
                              <a
                                href={`/proof/${encodeURIComponent(sel.proof.id)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[var(--ag-accent-text)] hover:underline"
                                title="This trade is sealed on Solana with the tag Agent; its result is written there when it ends"
                              >
                                Sealed on Solana · Agent <ArrowUpRight className="w-3 h-3" />
                              </a>
                            )}
                            {sel.note && sel.state !== 'OPEN' && sel.state !== 'PENDING' && (
                              <p className="mt-2 text-[11.5px] dim">
                                {sel.note}
                                {sel.refunded ? ` · ${sel.refunded} credits refunded` : sel.credits ? ` · ${sel.credits} credits` : ''}
                              </p>
                            )}
                            <div className="mt-4 ag-dsum">
                              <div className="min-w-0">
                                <p className="text-[10.5px] dim">Reward to risk</p>
                                <p className="text-[15px] font-semibold tabular-nums">{sel.rr}R</p>
                              </div>
                              <div className="min-w-0">
                                <p className="text-[10.5px] dim">Risk</p>
                                <p className="text-[15px] font-semibold tabular-nums">{sel.riskPct}%</p>
                              </div>
                              <div className="min-w-0 hidden sm:block">
                                <p className="text-[10.5px] dim">Placed</p>
                                <p className="text-[15px] font-semibold">{ago(sel.createdAt)}</p>
                              </div>
                              <span className={`ml-auto ag-pill !h-10 ${typeof sel.r === 'number' && sel.r > 0 ? 'accent' : typeof sel.r === 'number' && sel.r < 0 ? 'danger' : 'white'}`}>
                                {typeof sel.r === 'number' ? `${sign(sel.r)}R · ${sign(sel.pnlPct || 0)}%` : chipOf(sel).text}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                </div>
              )}

              {tab === 'activity' && (
                <section className="ag-paper ag-rise p-5 sm:p-7">
                  <p className="text-[15px] font-medium">History</p>
                  <p className="muted text-[11.5px]">Everything the agent does, newest first. You're alerted as it happens.</p>
                  {!data.log.length && (
                    <div className="py-10 text-center">
                      <Activity className="w-6 h-6 mx-auto text-[var(--ag-muted)]" />
                      <p className="mt-3 text-[12.5px] muted">Nothing yet.</p>
                    </div>
                  )}
                  <ol className="ag-timeline mt-5">
                    {data.log.map((l, i) => {
                      const { icon: Icon, color } = LOG_ICON[l.kind] || LOG_ICON.SCAN;
                      return (
                        <li key={`${l.at}-${i}`} className="ag-rise relative pl-11 pb-5 last:pb-0" style={rise(i)}>
                          <span className="absolute left-0 top-0 w-7 h-7 rounded-full grid place-items-center bg-[var(--ag-panel)] border border-[var(--ag-line-2)]" style={{ color }}>
                            <Icon className="w-3.5 h-3.5" />
                          </span>
                          <p className="text-[13px] leading-relaxed break-words">{l.text}</p>
                          <p className="text-[11px] muted">{ago(l.at)}</p>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}
            </div>
          </>
        )}
      </div>

      <StrategyBuilderPanel
        isOpen={builderOpen}
        onClose={() => {
          setBuilderOpen(false);
          load(true);
        }}
        onToast={(m, t) => toast(m, t)}
        onState={st =>
          setData(cur =>
            cur
              ? {
                  ...cur,
                  strategies: st.strategies.map(x => ({
                    id: x.id, name: x.name, summary: x.summary || '', setup: SETUPS[x.rules.setup]?.short || '',
                    timeframes: strategyAgentFrames(x.rules.timeframes), ownTimeframes: x.rules.timeframes.length > 0, kinds: x.rules.markets,
                  })),
                }
              : cur
          )
        }
        onProRequired={() => (setBuilderOpen(false), onUpgrade?.())}
        agent={{ selectedId: draft.strategyId, onSelect: id => pickStrategy(id) }}
      />
    </div>
  );
}

export default AgentsPage;
