// ===========================================================================
// Backtest (/backtest): replays the MarketX strategy on real past candles, bar by bar, with no lookahead.
//
// - At every closed candle the engine builds the same Supply & Demand + Fibonacci map the live analysis uses
//   (`buildMarketMap`, read only), from the candles up to that bar only. A valid plan becomes an order.
// - A LIMIT order fills when a later candle trades through the entry; MARKET orders fill at the next candle's open.
//   An order that sees TP1 (or the stop) before it fills is MISSED; one that waits longer than the expiry is EXPIRED.
// - Once filled, each candle is checked against the stop and the targets. When a candle touches both, the stop counts
//   first (conservative). Targets are never counted on the fill candle itself.
// - Exits: SCALE (40% TP1, 40% TP2, 20% TP3, the plan's own split) or the full position at TP1, TP2 or TP3;
//   optional break-even stop after TP1. One trade at a time. Results are in R (risk units) and in money from a
//   starting balance and a fixed % risk per trade (compounded).
// No AI calls and no credits: it is deterministic, so the same candles always give the same result.
// ===========================================================================
import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { db } from './firebase';
import { getUser, requireAuth } from './account';
import { requirePro } from './proAccess';
import { createKeyedThrottle } from './security';
import { buildMarketMap, type Candle } from './strategy';
import { SUPPORTED_TIMEFRAMES, timeframeMinutes } from '../src/utils/timeframe';

export type ExitStyle = 'SCALE' | 'TP1' | 'TP2' | 'TP3';
export interface BacktestOptions {
  timeframe: string;
  exit: ExitStyle;
  breakeven: boolean;
  balance: number;
  riskPct: number;
  forex?: boolean;
  jpy?: boolean;
}
export type TradeOutcome = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'OPEN';
export interface BacktestTrade {
  n: number;
  direction: 'LONG' | 'SHORT';
  execution: 'LIMIT' | 'MARKET';
  signalAt: number;
  filledAt: number;
  closedAt: number | null;
  entry: number;
  stop: number;
  targets: number[];
  /** Targets reached, in order */
  hits: Array<'TP1' | 'TP2' | 'TP3'>;
  exitReason: 'TP' | 'SL' | 'BE' | 'END';
  r: number;
  outcome: TradeOutcome;
  bars: number;
  score: number;
  /** Balance after this trade */
  balance: number;
}
export interface BacktestStats {
  signals: number;
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  missed: number;
  expired: number;
  winRate: number;
  totalR: number;
  avgR: number;
  profitFactor: number | null;
  maxDrawdownR: number;
  maxDrawdownPct: number;
  bestR: number;
  worstR: number;
  avgBars: number;
  longestLosingStreak: number;
  startBalance: number;
  endBalance: number;
  netReturnPct: number;
  /** Price change over the same candles (a buy-and-hold comparison) */
  marketChangePct: number;
  longs: { trades: number; winRate: number; totalR: number };
  shorts: { trades: number; winRate: number; totalR: number };
}
export interface BacktestResult {
  stats: BacktestStats;
  trades: BacktestTrade[];
  /** Balance after each trade, from the start (first point = starting balance) */
  equity: Array<{ t: number; balance: number; r: number }>;
  from: number;
  to: number;
  candles: number;
}

/** Bars a pending order waits before it is cancelled (about the live alert horizon) */
export const ORDER_EXPIRY_BARS = 48;
/** Candles of history given to the map at each step (the live analysis reads about this many) */
const MAP_WINDOW = 300;
/** First bar the replay may trade from (the map needs history behind it) */
const WARMUP = 60;
const SPLIT = [0.4, 0.4, 0.2];

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** Runs the replay. Yields to the event loop every few hundred bars so a long run never blocks the server. */
export async function runBacktest(candles: Candle[], opts: BacktestOptions): Promise<BacktestResult> {
  const c = candles.filter(k => [k.o, k.h, k.l, k.c].every(v => Number.isFinite(v) && v > 0) && k.h >= k.l);
  const trades: BacktestTrade[] = [];
  let signals = 0, missed = 0, expired = 0;
  let balance = opts.balance;
  const equity: BacktestResult['equity'] = [{ t: c[WARMUP]?.t ?? c[0]?.t ?? 0, balance, r: 0 }];
  const usedZones = new Set<string>();
  let i = WARMUP;
  while (i < c.length - 1) {
    if (i % 200 === 0) await new Promise(r => setImmediate(r));
    const map = buildMarketMap(c.slice(Math.max(0, i + 1 - MAP_WINDOW), i + 1), {
      price: c[i].c, timeframe: opts.timeframe, forex: opts.forex, jpy: opts.jpy,
    });
    const plan = map?.plan;
    const zoneKey = plan ? `${plan.direction}|${plan.zone.formedAt}|${plan.zone.low}` : '';
    if (!plan || usedZones.has(zoneKey)) {
      i++;
      continue;
    }
    usedZones.add(zoneKey);
    signals++;
    const long = plan.direction === 'LONG';
    const beyond = (a: number, b: number) => (long ? a >= b : a <= b);
    const targets = plan.targets.map(t => t.price);
    const stop = plan.stopLoss;
    // Fill
    let fillBar = -1;
    let entry = plan.entry.optimal;
    if (plan.execution === 'MARKET') {
      fillBar = i + 1;
      entry = c[i + 1].o;
    } else {
      for (let j = i + 1; j < c.length && j <= i + ORDER_EXPIRY_BARS; j++) {
        const k = c[j];
        const touched = long ? k.l <= entry : k.h >= entry;
        if (touched) {
          fillBar = j;
          // A gap through the entry fills at the open
          if (long ? k.o < entry : k.o > entry) entry = k.o;
          break;
        }
        // Target 1 (or the stop) reached before the entry: the move left without us
        if ((long ? k.h >= targets[0] : k.l <= targets[0]) || (long ? k.l <= stop : k.h >= stop)) {
          fillBar = -2;
          break;
        }
      }
    }
    if (fillBar === -2) {
      missed++;
      i++;
      continue;
    }
    if (fillBar < 0) {
      expired++;
      i = Math.min(c.length - 1, i + ORDER_EXPIRY_BARS);
      continue;
    }
    const risk = Math.abs(entry - stop);
    // A market fill that opened beyond the stop or the first target is not a valid trade
    if (!(risk > 0) || !beyond(entry, stop) || beyond(entry, targets[0])) {
      missed++;
      i = fillBar;
      continue;
    }
    // Manage
    const portions = opts.exit === 'SCALE' ? SPLIT : opts.exit === 'TP1' ? [1, 0, 0] : opts.exit === 'TP2' ? [0, 1, 0] : [0, 0, 1];
    const lastTarget = portions.reduce((last, p, idx) => (p > 0 ? idx : last), 0);
    let open = 1;
    let rSum = 0;
    let stopNow = stop;
    const hits: BacktestTrade['hits'] = [];
    let exitReason: BacktestTrade['exitReason'] = 'END';
    let closeBar = -1;
    for (let j = fillBar; j < c.length; j++) {
      const k = c[j];
      const stopHit = long ? k.l <= stopNow : k.h >= stopNow;
      if (stopHit) {
        rSum += open * ((long ? stopNow - entry : entry - stopNow) / risk);
        open = 0;
        exitReason = stopNow === stop ? 'SL' : 'BE';
        closeBar = j;
        break;
      }
      if (j === fillBar) continue;
      for (let t = hits.length; t < targets.length; t++) {
        if (!(long ? k.h >= targets[t] : k.l <= targets[t])) break;
        hits.push(`TP${t + 1}` as 'TP1' | 'TP2' | 'TP3');
        const part = Math.min(open, portions[t]);
        rSum += part * ((long ? targets[t] - entry : entry - targets[t]) / risk);
        open = round(open - part, 6);
        if (t === 0 && opts.breakeven) stopNow = entry;
        if (t >= lastTarget || open <= 0) break;
      }
      if (open <= 0 || hits.length > lastTarget) {
        exitReason = 'TP';
        closeBar = j;
        open = 0;
        break;
      }
    }
    if (open > 0) {
      // Still running when the data ends: marked at the last close
      const last = c[c.length - 1].c;
      rSum += open * ((long ? last - entry : entry - last) / risk);
    }
    const r = round(rSum, 2);
    const outcome: TradeOutcome = open > 0 ? 'OPEN' : Math.abs(r) < 0.05 ? 'BREAKEVEN' : r > 0 ? 'WIN' : 'LOSS';
    balance = round(balance * (1 + (opts.riskPct / 100) * r), 2);
    const endBar = closeBar >= 0 ? closeBar : c.length - 1;
    trades.push({
      n: trades.length + 1,
      direction: plan.direction,
      execution: plan.execution,
      signalAt: c[i].t,
      filledAt: c[fillBar].t,
      closedAt: closeBar >= 0 ? c[closeBar].t : null,
      entry, stop, targets, hits, exitReason, r, outcome,
      bars: endBar - fillBar + 1,
      score: Math.round(plan.score),
      balance,
    });
    equity.push({ t: c[endBar].t, balance, r });
    // Next signal only after this trade is done
    i = endBar + 1;
  }
  return {
    stats: summarize(trades, { signals, missed, expired, startBalance: opts.balance, first: c[WARMUP]?.c ?? c[0]?.c, last: c[c.length - 1]?.c }),
    trades,
    equity,
    from: c[Math.min(WARMUP, c.length - 1)]?.t ?? 0,
    to: c[c.length - 1]?.t ?? 0,
    candles: c.length,
  };
}

export function summarize(
  trades: BacktestTrade[],
  ctx: { signals: number; missed: number; expired: number; startBalance: number; first?: number; last?: number }
): BacktestStats {
  const closed = trades;
  const wins = closed.filter(t => t.r > 0.05);
  const losses = closed.filter(t => t.r < -0.05);
  const totalR = closed.reduce((s, t) => s + t.r, 0);
  const grossWin = wins.reduce((s, t) => s + t.r, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.r, 0);
  let peakR = 0, curR = 0, ddR = 0, peakB = ctx.startBalance, ddPct = 0, streak = 0, worstStreak = 0;
  for (const t of closed) {
    curR += t.r;
    peakR = Math.max(peakR, curR);
    ddR = Math.max(ddR, peakR - curR);
    peakB = Math.max(peakB, t.balance);
    ddPct = Math.max(ddPct, peakB > 0 ? ((peakB - t.balance) / peakB) * 100 : 0);
    streak = t.r < -0.05 ? streak + 1 : 0;
    worstStreak = Math.max(worstStreak, streak);
  }
  const side = (d: 'LONG' | 'SHORT') => {
    const s = closed.filter(t => t.direction === d);
    const w = s.filter(t => t.r > 0.05).length;
    return { trades: s.length, winRate: s.length ? round((w / s.length) * 100, 1) : 0, totalR: round(s.reduce((a, t) => a + t.r, 0)) };
  };
  const endBalance = closed.length ? closed[closed.length - 1].balance : ctx.startBalance;
  return {
    signals: ctx.signals,
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: closed.length - wins.length - losses.length,
    missed: ctx.missed,
    expired: ctx.expired,
    winRate: closed.length ? round((wins.length / closed.length) * 100, 1) : 0,
    totalR: round(totalR),
    avgR: closed.length ? round(totalR / closed.length) : 0,
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : grossWin > 0 ? null : 0,
    maxDrawdownR: round(ddR),
    maxDrawdownPct: round(ddPct),
    bestR: closed.length ? round(Math.max(...closed.map(t => t.r))) : 0,
    worstR: closed.length ? round(Math.min(...closed.map(t => t.r))) : 0,
    avgBars: closed.length ? round(closed.reduce((s, t) => s + t.bars, 0) / closed.length, 1) : 0,
    longestLosingStreak: worstStreak,
    startBalance: ctx.startBalance,
    endBalance,
    netReturnPct: round(((endBalance - ctx.startBalance) / ctx.startBalance) * 100),
    marketChangePct: ctx.first && ctx.last ? round(((ctx.last - ctx.first) / ctx.first) * 100) : 0,
    longs: side('LONG'),
    shorts: side('SHORT'),
  };
}

// ---------------------------------------------------------------------------
// Storage and routes
// ---------------------------------------------------------------------------
const RUNS = 'backtests';
const KEEP_RUNS = 12;
const MAX_TRADES_STORED = 250;
const MAX_EQUITY_POINTS = 300;
const RUNS_PER_DAY = Math.max(1, Number(process.env.BACKTESTS_PER_DAY) || 40);

export interface BacktestDeps {
  /** The market a query names, or null when nothing is listed */
  resolve: (query: string) => Promise<{ symbol: string; name: string; type: string } | null>;
  /** As many past candles as the feed gives (up to about 1,000) */
  history: (symbol: string, timeframe: string) => Promise<Candle[] | null>;
}
export interface BacktestRun {
  id: string;
  uid: string;
  symbol: string;
  name: string;
  type: string;
  createdAt: number;
  options: Omit<BacktestOptions, 'forex' | 'jpy'>;
  result: BacktestResult;
}

const EXITS: ExitStyle[] = ['SCALE', 'TP1', 'TP2', 'TP3'];
export const BACKTEST_TIMEFRAMES = SUPPORTED_TIMEFRAMES;

/** Validates the request body; returns the options or a message for the trader */
export function readBacktestOptions(body: any): { options: Omit<BacktestOptions, 'forex' | 'jpy'> } | { error: string } {
  const timeframe = typeof body?.timeframe === 'string' ? body.timeframe.toUpperCase() : '';
  if (!BACKTEST_TIMEFRAMES.includes(timeframe)) return { error: 'Choose a timeframe from the list.' };
  const exit = typeof body?.exit === 'string' && (EXITS as string[]).includes(body.exit) ? (body.exit as ExitStyle) : null;
  if (!exit) return { error: 'Choose how trades are closed.' };
  const balance = Number(body?.balance);
  if (!Number.isFinite(balance) || balance < 10 || balance > 1e9) return { error: 'Starting balance must be between 10 and 1,000,000,000.' };
  const riskPct = Number(body?.riskPct);
  if (!Number.isFinite(riskPct) || riskPct < 0.1 || riskPct > 10) return { error: 'Risk per trade must be between 0.1% and 10%.' };
  if (body?.breakeven !== undefined && typeof body.breakeven !== 'boolean') return { error: 'Break-even must be on or off.' };
  return { options: { timeframe, exit, breakeven: !!body?.breakeven, balance: round(balance), riskPct: round(riskPct, 2) } };
}

const summary = (r: BacktestRun) => ({
  id: r.id, symbol: r.symbol, name: r.name, createdAt: r.createdAt, options: r.options,
  stats: { trades: r.result.stats.trades, winRate: r.result.stats.winRate, totalR: r.result.stats.totalR, netReturnPct: r.result.stats.netReturnPct },
});

/** Keeps a stored run small: trades capped, equity curve thinned evenly (first and last points kept) */
function compact(result: BacktestResult): BacktestResult {
  const eq = result.equity;
  const step = Math.ceil(eq.length / MAX_EQUITY_POINTS);
  const equity = step > 1 ? eq.filter((_, i) => i % step === 0 || i === eq.length - 1) : eq;
  return { ...result, trades: result.trades.slice(-MAX_TRADES_STORED), equity };
}

// Same candles + same options = same result: shared for a few minutes across traders
const resultCache = new Map<string, { at: number; result: BacktestResult }>();
const CACHE_MS = 5 * 60_000;

export function registerBacktestRoutes(app: Express, deps: BacktestDeps, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  const burst = createKeyedThrottle({ windowMs: 10_000, max: 1 });
  const daily = createKeyedThrottle({ windowMs: 24 * 60 * 60 * 1000, max: RUNS_PER_DAY });
  const running = new Set<string>();
  const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) =>
    fn(req, res).catch(err => {
      console.error(`[MarketX Backtest] ${req.method} ${req.path} failed:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
    });
  const ID = /^bt_[a-z0-9]{8,40}$/;
  const mine = async (uid: string) =>
    (await db().collection(RUNS).where('uid', '==', uid).get()).docs.map(d => d.data() as BacktestRun).sort((a, b) => b.createdAt - a.createdAt);

  app.get('/api/backtest', limiter, requireAuth, requirePro, wrap(async (_req, res) => {
    const { uid } = getUser(res);
    res.json({ runs: (await mine(uid)).slice(0, KEEP_RUNS).map(summary), timeframes: BACKTEST_TIMEFRAMES, perDay: RUNS_PER_DAY });
  }));

  app.get('/api/backtest/:id', limiter, requireAuth, requirePro, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const id = String(req.params.id || '');
    if (!ID.test(id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Backtest not found.' });
    const run = (await db().collection(RUNS).doc(id).get()).data() as BacktestRun | undefined;
    if (!run || run.uid !== uid) return res.status(404).json({ error: 'NOT_FOUND', message: 'Backtest not found.' });
    const { uid: _u, ...rest } = run;
    res.json({ run: rest });
  }));

  app.delete('/api/backtest/:id', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const id = String(req.params.id || '');
    if (!ID.test(id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Backtest not found.' });
    const ref = db().collection(RUNS).doc(id);
    const run = (await ref.get()).data() as BacktestRun | undefined;
    if (!run || run.uid !== uid) return res.status(404).json({ error: 'NOT_FOUND', message: 'Backtest not found.' });
    await ref.delete();
    res.json({ runs: (await mine(uid)).slice(0, KEEP_RUNS).map(summary) });
  }));

  app.post('/api/backtest', limiter, requireAuth, requirePro, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const query = typeof req.body?.query === 'string' ? req.body.query.trim().slice(0, 80) : '';
    if (!query) return res.status(400).json({ error: 'BAD_REQUEST', message: 'Enter a pair, for example BTC, EURUSD or gold.' });
    const read = readBacktestOptions(req.body);
    if ('error' in read) return res.status(400).json({ error: 'BAD_REQUEST', message: read.error });
    if (running.has(uid)) return res.status(429).json({ error: 'BUSY', message: 'Your last backtest is still running.' });
    if (burst.hit(uid)) return res.status(429).json({ error: 'TOO_SOON', message: 'Give it a few seconds before the next run.' });
    if (daily.hit(uid)) return res.status(429).json({ error: 'DAILY_LIMIT', message: 'You have run the most backtests allowed today. Try again tomorrow.' });
    running.add(uid);
    try {
      const asset = await deps.resolve(query);
      if (!asset) return res.status(404).json({ error: 'UNKNOWN_ASSET', message: `I couldn't find a live market for "${query}". Try a ticker like BTC, EURUSD or XAUUSD.` });
      const { options } = read;
      const candles = await Promise.race([deps.history(asset.symbol, options.timeframe).catch(() => null), new Promise<null>(r => setTimeout(() => r(null), 15_000))]);
      if (!candles || candles.length < 120) {
        return res.status(422).json({ error: 'NOT_ENOUGH_DATA', message: `Not enough ${options.timeframe} history for ${asset.symbol} right now. Try another timeframe.` });
      }
      const key = `${asset.symbol}|${JSON.stringify(options)}|${candles.length}|${candles[candles.length - 1].t}`;
      let result = resultCache.get(key)?.at && Date.now() - resultCache.get(key)!.at < CACHE_MS ? resultCache.get(key)!.result : null;
      if (!result) {
        const sym = asset.symbol.toUpperCase();
        result = compact(await runBacktest(candles, { ...options, forex: asset.type === 'forex', jpy: sym.includes('JPY') }));
        resultCache.set(key, { at: Date.now(), result });
        if (resultCache.size > 200) resultCache.delete(resultCache.keys().next().value!);
      }
      const run: BacktestRun = {
        id: `bt_${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`,
        uid, symbol: asset.symbol, name: asset.name, type: asset.type, createdAt: Date.now(), options, result,
      };
      await db().collection(RUNS).doc(run.id).set(run);
      // Only the latest runs are kept
      const all = await mine(uid);
      await Promise.all(all.slice(KEEP_RUNS).map(r => db().collection(RUNS).doc(r.id).delete().catch(() => {})));
      const { uid: _u, ...out } = run;
      res.json({ run: out, runs: all.slice(0, KEEP_RUNS).map(summary) });
    } finally {
      running.delete(uid);
    }
  }));
}

// Exposed for tests
export const __backtestInternals = { WARMUP, MAP_WINDOW, timeframeMinutes };
