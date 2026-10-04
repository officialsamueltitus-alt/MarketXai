import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, Play, Loader2, Trash2, ChevronDown, TrendingUp, TrendingDown, ShieldCheck, Info, Search, Sparkles, Clock3 } from 'lucide-react';
import { apiFetch, ApiError } from '../utils/apiClient';
import { formatMarketPrice } from '../utils/formatPrice';
import { SUPPORTED_TIMEFRAMES } from '../utils/timeframe';
import { formatMoney, type Currency, type Preferences } from '../utils/preferences';
import { PluginSheet, ago } from './PluginSheet';

// /backtest: the MarketX strategy replayed bar by bar on real past candles (server/backtest.ts)
type ExitStyle = 'SCALE' | 'TP1' | 'TP2' | 'TP3';
interface BtTrade {
  n: number;
  direction: 'LONG' | 'SHORT';
  execution: 'LIMIT' | 'MARKET';
  signalAt: number;
  filledAt: number;
  closedAt: number | null;
  entry: number;
  stop: number;
  targets: number[];
  hits: string[];
  exitReason: 'TP' | 'SL' | 'BE' | 'END';
  r: number;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'OPEN';
  bars: number;
  score: number;
  balance: number;
}
interface BtStats {
  signals: number; trades: number; wins: number; losses: number; breakeven: number; missed: number; expired: number;
  winRate: number; totalR: number; avgR: number; profitFactor: number | null; maxDrawdownR: number; maxDrawdownPct: number;
  bestR: number; worstR: number; avgBars: number; longestLosingStreak: number; startBalance: number; endBalance: number;
  netReturnPct: number; marketChangePct: number;
  longs: { trades: number; winRate: number; totalR: number };
  shorts: { trades: number; winRate: number; totalR: number };
}
interface BtRun {
  id: string;
  symbol: string;
  name: string;
  createdAt: number;
  options: { timeframe: string; exit: ExitStyle; breakeven: boolean; balance: number; riskPct: number };
  result: { stats: BtStats; trades: BtTrade[]; equity: Array<{ t: number; balance: number; r: number }>; from: number; to: number; candles: number };
}
interface BtSummary {
  id: string;
  symbol: string;
  name: string;
  createdAt: number;
  options: BtRun['options'];
  stats: { trades: number; winRate: number; totalR: number; netReturnPct: number };
}

interface BacktestPanelProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: Preferences;
  /** Pro rule after the free period */
  onProRequired: (message: string) => void;
  /** Runs a live analysis of the pair (from the results) */
  onAnalyze: (symbol: string, timeframe: string) => void;
}

const EXITS: Array<{ id: ExitStyle; label: string; hint: string }> = [
  { id: 'SCALE', label: 'Scale out', hint: '40% at TP1, 40% at TP2, 20% at TP3' },
  { id: 'TP1', label: 'TP1', hint: 'Full position closed at TP1' },
  { id: 'TP2', label: 'TP2', hint: 'Full position closed at TP2' },
  { id: 'TP3', label: 'TP3', hint: 'Full position closed at TP3' },
];
const QUICK = ['BTC', 'ETH', 'SOL', 'EURUSD', 'GBPJPY', 'XAUUSD', 'NAS100'];
const STEPS = ['Loading past candles', 'Replaying the strategy bar by bar', 'Scoring every trade'];
const tfLabel = (tf: string) => tf.replace(/^(\d+)M$/, '$1m');
const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const rText = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}R`;
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const stamp = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Width of a container, for charts that redraw to fit */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Balance after each trade: one line, the starting balance as a dashed baseline, crosshair + tooltip on hover */
const EquityChart: React.FC<{ run: BtRun; currency: Currency }> = ({ run, currency }) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const pts = run.result.equity;
  const H = 168, padL = 4, padR = 4, padT = 12, padB = 20;
  const W = Math.max(width, 200);
  const vals = pts.map(p => p.balance);
  const start = run.options.balance;
  const min = Math.min(start, ...vals), max = Math.max(start, ...vals);
  const span = max - min || Math.max(1, start * 0.01);
  const x = (i: number) => padL + (pts.length > 1 ? (i / (pts.length - 1)) * (W - padL - padR) : (W - padL - padR) / 2);
  const y = (v: number) => padT + (1 - (v - (min - span * 0.08)) / (span * 1.16)) * (H - padT - padB);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.length - 1).toFixed(1)},${H - padB}L${x(0).toFixed(1)},${H - padB}Z`;
  const up = vals[vals.length - 1] >= start;
  const stroke = up ? '#38bdf8' : '#fb7185';
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(x(i) - rel) < Math.abs(x(best) - rel)) best = i;
    setHover(best);
  };
  const h = hover != null ? pts[hover] : null;
  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg
          width="100%"
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Account balance after each trade, from ${formatMoney(start, currency)} to ${formatMoney(vals[vals.length - 1], currency)}`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          className="block touch-none"
        >
          <defs>
            <linearGradient id="bt-eq" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map(f => (
            <line key={f} x1={padL} x2={W - padR} y1={padT + f * (H - padT - padB)} y2={padT + f * (H - padT - padB)} stroke="rgba(255,255,255,0.05)" />
          ))}
          <line x1={padL} x2={W - padR} y1={y(start)} y2={y(start)} stroke="rgba(255,255,255,0.28)" strokeDasharray="3 4" />
          <path d={area} fill="url(#bt-eq)" />
          <path d={line} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {pts.length <= 60 && pts.slice(1).map((p, i) => (
            <circle key={i} cx={x(i + 1)} cy={y(p.balance)} r={2.5} fill={p.r >= 0 ? '#34d399' : '#fb7185'} stroke="var(--mx-bg-2)" strokeWidth={1.5} />
          ))}
          <text x={padL} y={H - 5} fontSize="10" fill="rgba(148,163,184,0.9)">{day(run.result.from)}</text>
          <text x={W - padR} y={H - 5} fontSize="10" fill="rgba(148,163,184,0.9)" textAnchor="end">{day(run.result.to)}</text>
          {h && hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="rgba(255,255,255,0.35)" />
              <circle cx={x(hover)} cy={y(h.balance)} r={4.5} fill={stroke} stroke="var(--mx-bg-2)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {h && hover != null && (
        <div
          className="pointer-events-none absolute top-1 z-10 px-2.5 py-1.5 rounded-lg bg-black/85 border border-white/10 text-[11px] leading-tight shadow-xl"
          style={{ left: Math.min(Math.max(x(hover) - 70, 0), W - 140), width: 140 }}
        >
          <div className="text-slate-400">{hover === 0 ? 'Start' : `Trade ${hover} · ${day(h.t)}`}</div>
          <div className="text-white font-semibold">{formatMoney(h.balance, currency)}</div>
          {hover > 0 && <div className="text-slate-300">{rText(h.r)}</div>}
        </div>
      )}
    </div>
  );
};

/** R of every trade as a bar from zero (gains up, losses down) */
const RBars: React.FC<{ trades: BtTrade[] }> = ({ trades }) => {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 96, mid = H / 2;
  const W = Math.max(width, 200);
  const maxAbs = Math.max(1, ...trades.map(t => Math.abs(t.r)));
  const gap = 2;
  const bw = Math.max(2, Math.min(18, (W - gap * (trades.length - 1)) / trades.length));
  const total = trades.length * bw + (trades.length - 1) * gap;
  const ox = (W - total) / 2;
  const t = hover != null ? trades[hover] : null;
  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Result of each trade in R" className="block" onPointerLeave={() => setHover(null)}>
          <line x1={0} x2={W} y1={mid} y2={mid} stroke="rgba(255,255,255,0.18)" />
          {trades.map((tr, i) => {
            const h = Math.max(2, (Math.abs(tr.r) / maxAbs) * (mid - 6));
            const xx = ox + i * (bw + gap);
            const pos = tr.r >= 0;
            return (
              <g key={tr.n} onPointerEnter={() => setHover(i)}>
                <rect x={xx - gap / 2} y={0} width={bw + gap} height={H} fill="transparent" />
                <rect x={xx} y={pos ? mid - h : mid} width={bw} height={h} rx={Math.min(3, bw / 2)} fill={pos ? '#34d399' : '#fb7185'} opacity={hover == null || hover === i ? 1 : 0.45} />
              </g>
            );
          })}
        </svg>
      )}
      {t && hover != null && (
        <div
          className="pointer-events-none absolute -top-1 z-10 px-2.5 py-1.5 rounded-lg bg-black/85 border border-white/10 text-[11px] leading-tight shadow-xl"
          style={{ left: Math.min(Math.max(ox + hover * (bw + gap) - 60, 0), W - 128), width: 128 }}
        >
          <div className="text-slate-400">Trade {t.n} · {t.direction === 'LONG' ? 'Buy' : 'Sell'}</div>
          <div className="text-white font-semibold">{rText(t.r)}</div>
          <div className="text-slate-400">{day(t.filledAt)}</div>
        </div>
      )}
    </div>
  );
};

/** The method and the words on this screen, in plain language */
const HOW_STEPS: Array<[string, string]> = [
  ['It loads real history', 'MarketX loads up to 1,000 past candles of the market and timeframe you pick, from the same price feeds the live analysis uses.'],
  ['It walks forward one candle at a time', 'At every closed candle it runs the exact strategy behind a live analysis: supply and demand zones in the recent range, the Fibonacci entry, the RSI and EMA checks and every freshness rule. It only sees the candles up to that moment, never the ones after, so it can’t peek at the future.'],
  ['A valid setup becomes an order', 'When the strategy finds a trade, a limit order waits at the entry. It fills when a later candle trades through the entry (if price gaps past it, the fill is at the open, the worse price). A “buy now” setup fills at the next candle’s open.'],
  ['Some orders never fill', 'If price reaches TP1 or the stop before the entry, the order is cancelled and counted as missed: the move happened without you. If nothing fills within 48 candles, the order expires.'],
  ['The trade is managed candle by candle', 'Once in, every candle is checked against the stop and the targets. If one candle touches both, the stop is counted first, the worst case, because a candle can’t tell which came first. Targets are never counted on the candle that filled the order.'],
  ['Profit is taken the way you chose', 'Scale out closes 40% at TP1, 40% at TP2 and 20% at TP3, as in a live plan. TP1, TP2 or TP3 closes the whole trade at that target. With “move stop to entry” on, the stop goes to break-even once TP1 is hit.'],
  ['One trade at a time', 'While a trade is open no new trade is taken. The next search starts on the candle after it closes. A trade still open when the history ends is valued at the last price and marked open.'],
  ['Results in R and in money', 'Every trade is scored in R: 1R is what you risked, so a stop is -1R and a target three times the stop away is +3R. Your balance grows or shrinks by your risk % times the R of each trade, compounded, which draws the balance curve.'],
];
const GLOSSARY: Array<[string, string]> = [
  ['Win rate', 'Trades that made money ÷ all trades.'],
  ['Profit factor', 'Everything won ÷ everything lost. Above 1 makes money; 2 means twice as much won as lost.'],
  ['Max drawdown', 'The deepest fall of the balance from a high point before a new high.'],
  ['Average trade', 'The average R per trade (expectancy). Positive means the method paid over these trades.'],
  ['Losing streak', 'The most losses in a row, a good guide to the run of losses to be ready for.'],
  ['Missed and expired', 'Setups that never filled. They cost nothing and are not in the win rate.'],
];
const HowItWorks: React.FC = () => (
  <details className="group rounded-3xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
    <summary className="list-none flex items-center gap-2 px-4 h-12 cursor-pointer text-sm font-semibold text-white">
      <Info className="w-4 h-4 text-sky-300" />
      How this backtest works
      <ChevronDown className="ml-auto w-4 h-4 text-slate-500 transition-transform group-open:rotate-180" />
    </summary>
    <div className="px-4 pb-4 space-y-4 border-t border-white/[0.05] pt-3">
      <ol className="space-y-3">
        {HOW_STEPS.map(([t, d], i) => (
          <li key={t} className="flex gap-3">
            <span className="w-6 h-6 rounded-full bg-sky-500/15 border border-sky-400/30 text-[11px] font-semibold text-sky-200 flex items-center justify-center shrink-0">{i + 1}</span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-white">{t}</span>
              <span className="block text-xs text-slate-400 leading-relaxed">{d}</span>
            </span>
          </li>
        ))}
      </ol>
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1.5">What the numbers mean</div>
        <dl className="grid sm:grid-cols-2 gap-2">
          {GLOSSARY.map(([t, d]) => (
            <div key={t} className="p-2.5 rounded-2xl bg-black/20 border border-white/[0.05]">
              <dt className="text-xs font-semibold text-white">{t}</dt>
              <dd className="text-[11px] text-slate-400 leading-relaxed">{d}</dd>
            </div>
          ))}
        </dl>
      </div>
      <p className="text-[11px] text-amber-300/90 leading-relaxed">
        Results are hypothetical. Spreads, fees and slippage are not included, and news can move a market in ways old candles don't show. A backtest shows
        how the method behaved on that history, not what it will do next.
      </p>
    </div>
  </details>
);

const Stat: React.FC<{ label: string; value: string; sub?: string; tone?: string }> = ({ label, value, sub, tone = 'text-white' }) => (
  <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] min-w-0">
    <div className="text-[10px] uppercase tracking-wider text-slate-500 truncate">{label}</div>
    <div className={`mt-1 text-lg font-semibold tabular-nums tracking-tight truncate ${tone}`}>{value}</div>
    {sub && <div className="text-[11px] text-slate-500 truncate">{sub}</div>}
  </div>
);

export const BacktestPanel: React.FC<BacktestPanelProps> = ({ isOpen, onClose, preferences, onProRequired, onAnalyze }) => {
  const [query, setQuery] = useState('BTC');
  const [timeframe, setTimeframe] = useState(() => (preferences.timeframe !== 'RDM' && SUPPORTED_TIMEFRAMES.includes(preferences.timeframe) ? preferences.timeframe : '4H'));
  const [exit, setExit] = useState<ExitStyle>(preferences.backtestExit || 'SCALE');
  const [breakeven, setBreakeven] = useState(false);
  const [balance, setBalance] = useState(String(preferences.accountSize || 10000));
  const [riskPct, setRiskPct] = useState(String(preferences.riskPct || 1));
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<BtRun | null>(null);
  const [runs, setRuns] = useState<BtSummary[]>([]);
  const [showTrades, setShowTrades] = useState(false);
  const currency = preferences.currency;
  const resultsRef = useRef<HTMLDivElement>(null);

  const loadRuns = useCallback(async () => {
    try {
      const data = await apiFetch<{ runs: BtSummary[] }>('/api/backtest');
      setRuns(data.runs || []);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'PRO_REQUIRED') onProRequired(err.message);
    }
  }, [onProRequired]);
  useEffect(() => {
    if (isOpen) loadRuns();
  }, [isOpen, loadRuns]);
  // The steps advance while the server works (the result arrives when it is ready)
  useEffect(() => {
    if (!running) return;
    setStep(0);
    const a = setTimeout(() => setStep(1), 900);
    const b = setTimeout(() => setStep(2), 2600);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [running]);

  const start = async () => {
    if (running) return;
    const q = query.trim();
    if (!q) return setError('Enter a pair, for example BTC, EURUSD or gold.');
    setError(null);
    setRunning(true);
    try {
      const data = await apiFetch<{ run: BtRun; runs: BtSummary[] }>('/api/backtest', {
        method: 'POST',
        body: JSON.stringify({ query: q, timeframe, exit, breakeven, balance: Number(balance), riskPct: Number(riskPct) }),
        timeoutMs: 60000,
      });
      setRun(data.run);
      setRuns(data.runs || []);
      setShowTrades(false);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'PRO_REQUIRED') onProRequired(err.message);
      else setError(err?.message || 'The backtest could not run. Please try again.');
    } finally {
      setRunning(false);
    }
  };
  const openRun = async (id: string) => {
    try {
      const data = await apiFetch<{ run: BtRun }>(`/api/backtest/${encodeURIComponent(id)}`);
      setRun(data.run);
      setShowTrades(false);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } catch (err: any) {
      setError(err?.message || 'Could not open that backtest.');
    }
  };
  const removeRun = async (id: string) => {
    try {
      const data = await apiFetch<{ runs: BtSummary[] }>(`/api/backtest/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setRuns(data.runs || []);
      if (run?.id === id) setRun(null);
    } catch (err: any) {
      setError(err?.message || 'Could not delete that backtest.');
    }
  };

  const s = run?.result.stats;
  const closedTrades = useMemo(() => (run ? run.result.trades : []), [run]);
  const segBtn = (on: boolean) =>
    `h-8 px-3 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${on ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'}`;

  return (
    <PluginSheet
      isOpen={isOpen}
      onClose={onClose}
      label="Backtest"
      title="Backtest"
      subtitle="The MarketX strategy replayed on real past candles"
      icon={History}
      gradient="from-fuchsia-500/25 to-sky-500/25"
      iconTone="text-fuchsia-200"
      enabled={false}
      width="sm:w-[600px]"
    >
      {/* Setup */}
      <div className="pt-4 space-y-4">
        <div className="p-4 rounded-3xl bg-gradient-to-br from-white/[0.05] to-white/[0.015] border border-white/[0.08] space-y-4">
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Market</span>
            <div className="mt-1.5 flex items-center gap-2 h-11 px-3 rounded-2xl bg-black/25 border border-white/[0.08] focus-within:border-sky-400/50 transition">
              <Search className="w-4 h-4 text-slate-500 shrink-0" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && start()}
                maxLength={80}
                placeholder="BTC, EURUSD, gold, NAS100, $WIF…"
                aria-label="Pair to backtest"
                className="flex-1 min-w-0 bg-transparent text-[15px] text-white placeholder:text-slate-600 focus:outline-none"
              />
            </div>
            <div className="mt-2 flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
              {QUICK.map(q => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuery(q)}
                  className={`h-7 px-2.5 rounded-full text-[11px] font-mono font-semibold border shrink-0 cursor-pointer transition ${
                    query.toUpperCase() === q ? 'bg-sky-500/15 border-sky-400/40 text-sky-200' : 'bg-white/[0.03] border-white/[0.07] text-slate-300 hover:text-white'
                  }`}
                >
                  {q}
                </button>
              ))}
            </div>
          </label>

          <div>
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Timeframe</span>
            <div className="mt-1.5 flex gap-1 overflow-x-auto no-scrollbar p-1 rounded-full bg-black/25 border border-white/[0.08]" role="radiogroup" aria-label="Timeframe">
              {SUPPORTED_TIMEFRAMES.map(tf => (
                <button key={tf} type="button" role="radio" aria-checked={timeframe === tf} onClick={() => setTimeframe(tf)} className={`${segBtn(timeframe === tf)} font-mono shrink-0 px-2.5`}>
                  {tfLabel(tf)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Take profit</span>
            <div className="mt-1.5 grid grid-cols-4 gap-1 p-1 rounded-full bg-black/25 border border-white/[0.08]" role="radiogroup" aria-label="How trades are closed">
              {EXITS.map(e => (
                <button key={e.id} type="button" role="radio" aria-checked={exit === e.id} title={e.hint} onClick={() => setExit(e.id)} className={segBtn(exit === e.id)}>
                  {e.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-slate-500">{EXITS.find(e => e.id === exit)?.hint}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Starting balance ({currency})</span>
              <input
                inputMode="decimal"
                value={balance}
                onChange={e => setBalance(e.target.value.replace(/[^0-9.]/g, ''))}
                aria-label="Starting balance"
                className="mt-1.5 w-full h-11 px-3 rounded-2xl bg-black/25 border border-white/[0.08] text-white tabular-nums focus:outline-none focus:border-sky-400/50"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Risk per trade (%)</span>
              <input
                inputMode="decimal"
                value={riskPct}
                onChange={e => setRiskPct(e.target.value.replace(/[^0-9.]/g, ''))}
                aria-label="Risk per trade in percent"
                className="mt-1.5 w-full h-11 px-3 rounded-2xl bg-black/25 border border-white/[0.08] text-white tabular-nums focus:outline-none focus:border-sky-400/50"
              />
            </label>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={breakeven}
            onClick={() => setBreakeven(v => !v)}
            className="w-full flex items-center gap-3 p-3 rounded-2xl bg-black/20 border border-white/[0.06] text-left cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-300 shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-white">Move stop to entry after TP1</span>
              <span className="block text-[11px] text-slate-500">Locks the trade at break-even once the first target is hit</span>
            </span>
            <span className={`h-6 w-10 rounded-full relative transition-colors shrink-0 ${breakeven ? 'bg-emerald-500/80' : 'bg-white/15'}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${breakeven ? 'right-0.5' : 'left-0.5'}`} />
            </span>
          </button>

          <button
            type="button"
            onClick={start}
            disabled={running}
            className="w-full h-12 rounded-2xl bg-gradient-to-r from-fuchsia-500 via-violet-500 to-sky-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-[0_14px_44px_-14px_rgba(139,92,246,.9)] hover:brightness-110 active:scale-[0.99] transition cursor-pointer disabled:opacity-80"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {running ? 'Running backtest…' : 'Run backtest'}
          </button>
          {running && (
            <ol className="space-y-1.5 px-1" aria-live="polite">
              {STEPS.map((label, i) => (
                <li key={label} className={`flex items-center gap-2 text-xs transition-opacity ${i <= step ? 'opacity-100' : 'opacity-35'}`}>
                  {i < step ? (
                    <span className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center text-[10px]">✓</span>
                  ) : i === step ? (
                    <Loader2 className="w-4 h-4 text-sky-300 animate-spin" />
                  ) : (
                    <span className="w-4 h-4 rounded-full border border-white/15" />
                  )}
                  <span className="text-slate-300">{label}</span>
                </li>
              ))}
            </ol>
          )}
          {error && <p className="px-1 text-xs text-rose-300" role="alert">{error}</p>}
        </div>

        {/* Results */}
        {run && s && (
          <div ref={resultsRef} className="space-y-3 scroll-mt-3">
            <div className="p-4 rounded-3xl bg-gradient-to-br from-sky-500/[0.08] via-violet-500/[0.06] to-fuchsia-500/[0.08] border border-white/[0.08]">
              <div className="flex items-start gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="font-mono font-semibold text-white">{run.symbol}</span>
                    <span className="px-1.5 h-5 rounded-md bg-white/[0.06] font-mono text-[10px] text-slate-300 inline-flex items-center">{tfLabel(run.options.timeframe)}</span>
                    <span className="truncate">{day(run.result.from)} to {day(run.result.to)} · {run.result.candles} candles</span>
                  </div>
                  <div className={`mt-2 text-4xl font-semibold tracking-tight tabular-nums ${s.netReturnPct >= 0 ? 'text-white' : 'text-rose-200'}`}>{pct(s.netReturnPct)}</div>
                  <div className="mt-0.5 text-sm text-slate-400 tabular-nums">
                    {formatMoney(s.startBalance, currency)} to <span className="text-white">{formatMoney(s.endBalance, currency)}</span> · {rText(s.totalR)}
                  </div>
                </div>
                <div className={`ml-auto shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center ${s.netReturnPct >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                  {s.netReturnPct >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                </div>
              </div>
              {s.trades > 0 ? (
                <div className="mt-3 -mx-1">
                  <EquityChart run={run} currency={currency} />
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-400">
                  No trade qualified in this window. MarketX only trades fresh, confirmed setups, so quiet stretches are normal. Try a lower timeframe for more history.
                </p>
              )}
              <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
                <Info className="w-3.5 h-3.5 shrink-0" />
                The market itself moved {pct(s.marketChangePct)} over the same candles.
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Stat label="Win rate" value={`${s.winRate.toFixed(1)}%`} sub={`${s.wins} won · ${s.losses} lost${s.breakeven ? ` · ${s.breakeven} even` : ''}`} />
              <Stat label="Profit factor" value={s.profitFactor == null ? 'No losses' : s.profitFactor.toFixed(2)} sub="Gains ÷ losses" />
              <Stat label="Max drawdown" value={`-${s.maxDrawdownPct.toFixed(2)}%`} sub={`${s.maxDrawdownR.toFixed(2)}R peak to low`} />
              <Stat label="Trades" value={String(s.trades)} sub={`${s.signals} signals · ${s.missed} missed${s.expired ? ` · ${s.expired} expired` : ''}`} />
              <Stat label="Average trade" value={rText(s.avgR)} sub={`Best ${rText(s.bestR)} · worst ${rText(s.worstR)}`} />
              <Stat label="Losing streak" value={String(s.longestLosingStreak)} sub={`Avg ${s.avgBars} candles in a trade`} />
            </div>

            {s.trades > 0 && (
              <div className="p-4 rounded-3xl bg-white/[0.03] border border-white/[0.06]">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Every trade</h3>
                  <span className="text-[11px] text-slate-500">R per trade, in order</span>
                </div>
                <div className="mt-3">
                  <RBars trades={closedTrades} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {([['Buys', s.longs, 'text-emerald-300'], ['Sells', s.shorts, 'text-rose-300']] as const).map(([label, side, tone]) => (
                    <div key={label} className="p-3 rounded-2xl bg-black/20 border border-white/[0.05]">
                      <div className={`text-[11px] font-semibold ${tone}`}>{label}</div>
                      <div className="mt-0.5 text-sm text-white tabular-nums">{side.trades} {side.trades === 1 ? 'trade' : 'trades'} · {side.winRate.toFixed(1)}%</div>
                      <div className="text-[11px] text-slate-500 tabular-nums">{rText(side.totalR)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {s.trades > 0 && (
              <div className="rounded-3xl bg-white/[0.03] border border-white/[0.06] overflow-hidden">
                <button type="button" onClick={() => setShowTrades(v => !v)} aria-expanded={showTrades} className="w-full flex items-center justify-between px-4 h-12 text-sm font-semibold text-white cursor-pointer">
                  Trade list
                  <span className="flex items-center gap-1.5 text-[11px] font-normal text-slate-500">
                    {closedTrades.length} {closedTrades.length === 1 ? 'trade' : 'trades'} <ChevronDown className={`w-4 h-4 transition-transform ${showTrades ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {showTrades && (
                  <ul className="divide-y divide-white/[0.05] border-t border-white/[0.05]">
                    {[...closedTrades].reverse().map(t => {
                      const long = t.direction === 'LONG';
                      return (
                        <li key={t.n} className="px-4 py-3 flex items-center gap-3">
                          <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-[10px] font-bold ${long ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                            {long ? 'BUY' : 'SELL'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs text-white tabular-nums truncate">
                              Entry {formatMarketPrice(t.entry)} · SL {formatMarketPrice(t.stop)}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {stamp(t.filledAt)} · {t.hits.length ? t.hits.join(', ') : 'No target'} ·{' '}
                              {t.exitReason === 'SL' ? 'Stopped' : t.exitReason === 'BE' ? 'Break-even stop' : t.exitReason === 'END' ? 'Still open' : 'Closed at target'}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className={`text-sm font-semibold tabular-nums ${t.r > 0.05 ? 'text-emerald-300' : t.r < -0.05 ? 'text-rose-300' : 'text-slate-300'}`}>{rText(t.r)}</div>
                            <div className="text-[10px] text-slate-500">{t.outcome === 'OPEN' ? 'Open' : t.outcome === 'BREAKEVEN' ? 'Even' : t.outcome === 'WIN' ? 'Win' : 'Loss'}</div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => onAnalyze(run.symbol, run.options.timeframe)}
              className="w-full h-11 rounded-2xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] text-sm font-semibold text-white inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-sky-300" />
              Analyze {run.symbol} on the {tfLabel(run.options.timeframe)} now
            </button>
          </div>
        )}

        <HowItWorks />

        {/* History */}
        {runs.length > 0 && (
          <div>
            <div className="px-1 pb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">
              <Clock3 className="w-3.5 h-3.5" /> Recent backtests
            </div>
            <ul className="space-y-1.5">
              {runs.map(r => (
                <li key={r.id} className={`flex items-center gap-2 p-1.5 pl-3 rounded-2xl border transition ${run?.id === r.id ? 'bg-white/[0.06] border-sky-400/30' : 'bg-white/[0.02] border-white/[0.06]'}`}>
                  <button type="button" onClick={() => openRun(r.id)} className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer py-1">
                    <span className="font-mono text-xs font-semibold text-white">{r.symbol}</span>
                    <span className="font-mono text-[10px] text-slate-400">{tfLabel(r.options.timeframe)}</span>
                    <span className="text-[11px] text-slate-500 truncate">{r.stats.trades} trades · {r.stats.winRate.toFixed(0)}% · {ago(r.createdAt)}</span>
                    <span className={`ml-auto text-xs font-semibold tabular-nums ${r.stats.netReturnPct >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{pct(r.stats.netReturnPct)}</span>
                  </button>
                  <button type="button" onClick={() => removeRun(r.id)} aria-label={`Delete the ${r.symbol} backtest`} className="w-8 h-8 rounded-xl text-slate-500 hover:text-rose-300 hover:bg-white/[0.05] flex items-center justify-center cursor-pointer shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </PluginSheet>
  );
};
