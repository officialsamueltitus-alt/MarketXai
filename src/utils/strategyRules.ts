// Strategy Builder: the rules a trader's strategy runs on, shared by the server (validation, the rules engine in
// server/userStrategy.ts) and the client (the builder, the review screen). A strategy is written in free text and/or the
// guided questions; the strategy engine (API 2) turns it into these rules, the trader approves them, and every analysis
// in Strategy mode runs them in code on real candles. None of the setups is the general MarketX engine (supply and demand
// zones entered with the Fibonacci retracement).
import { SUPPORTED_TIMEFRAMES } from './timeframe';

export type SetupId =
  | 'SMC_OB_RETEST'
  | 'ICT_SWEEP_FVG'
  | 'EMA_PULLBACK'
  | 'BREAKOUT_RETEST'
  | 'RSI_DIVERGENCE'
  | 'MA_CROSS'
  | 'SR_BOUNCE'
  | 'BOLLINGER_REVERSION'
  | 'SESSION_BREAKOUT'
  | 'RANGE_SWEEP';
export type MarketKind = 'forex' | 'crypto' | 'stock' | 'commodity' | 'synthetic';
export type SessionId = 'ASIA' | 'LONDON' | 'NEW_YORK';

export interface StrategyRules {
  version: 1;
  setup: SetupId;
  direction: 'BOTH' | 'LONG' | 'SHORT';
  /** Timeframes it trades ([] = any) */
  timeframes: string[];
  /** Markets it trades ([] = any) */
  markets: MarketKind[];
  params: {
    emaFast: number;
    emaSlow: number;
    rsiPeriod: number;
    /** Candles the setup looks back over (ranges, swings, levels) */
    lookback: number;
    bbPeriod: number;
    bbStdDev: number;
  };
  filters: {
    /** Only trade with the trend of this EMA (price on the right side and the EMA sloping that way); null = off */
    trendEma: number | null;
    /** No buy above this RSI, no sell below 100 minus it; null = off */
    rsiCap: number | null;
    /** Only when the trigger candle falls in these sessions (UTC; intraday timeframes); [] = any time */
    sessions: SessionId[];
  };
  stop: { type: 'STRUCTURE' | 'ATR'; atrMult: number };
  targets: { type: 'RR' | 'STRUCTURE'; rr: number[] };
  /** The final target must pay at least this many R */
  minRR: number;
}

export const SETUPS: Record<SetupId, { name: string; short: string; family: string; explain: string }> = {
  SMC_OB_RETEST: { name: 'SMC order block retest', short: 'Order block', family: 'SMC', explain: 'A break of structure, then a limit entry on the retest of the order block (the last opposite candle before the impulse). Stop beyond the order block.' },
  ICT_SWEEP_FVG: { name: 'ICT liquidity sweep + FVG', short: 'Sweep + FVG', family: 'ICT', explain: 'Price sweeps a swing low (or high), shifts structure with a displacement candle, and the entry sits in the fair value gap it leaves. Stop beyond the sweep.' },
  EMA_PULLBACK: { name: 'Trend pullback to the EMA', short: 'EMA pullback', family: 'Trend', explain: 'Fast EMA above the slow one and rising; price pulls back to the fast EMA and closes back with the trend. Market entry on that close.' },
  BREAKOUT_RETEST: { name: 'Breakout and retest', short: 'Breakout retest', family: 'Breakout', explain: 'Price closes beyond a key level, comes back to retest it and holds. Entry on the retest, stop back inside the level.' },
  RSI_DIVERGENCE: { name: 'RSI divergence reversal', short: 'RSI divergence', family: 'Reversal', explain: 'Price makes a lower low while RSI makes a higher low (or the mirror for sells), then a candle closes back above the last swing candle.' },
  MA_CROSS: { name: 'Moving average crossover', short: 'MA cross', family: 'Trend', explain: 'The fast EMA crosses the slow EMA. Market entry on the cross, stop beyond the recent swing.' },
  SR_BOUNCE: { name: 'Support and resistance bounce', short: 'S/R bounce', family: 'Price action', explain: 'A level touched at least twice is tested again and rejected with a wick. Entry on the rejection close, stop beyond the level.' },
  BOLLINGER_REVERSION: { name: 'Bollinger mean reversion', short: 'Bollinger', family: 'Mean reversion', explain: 'Price closes outside a Bollinger Band, then back inside. Entry on the close back inside, first target the middle band.' },
  SESSION_BREAKOUT: { name: 'London session breakout', short: 'Session breakout', family: 'Session', explain: 'The Asian session range is marked; a close beyond it during London or New York is the entry. Stop at the middle of the range.' },
  RANGE_SWEEP: { name: 'Range sweep (Wyckoff spring / upthrust)', short: 'Range sweep', family: 'Wyckoff', explain: 'Price wicks below the range low (or above the high) and closes back inside. Entry on that close, target the other side of the range.' },
};
export const SETUP_IDS = Object.keys(SETUPS) as SetupId[];
export const MARKETS: MarketKind[] = ['forex', 'crypto', 'stock', 'commodity', 'synthetic'];
export const SESSIONS: Array<{ id: SessionId; label: string; hours: [number, number] }> = [
  { id: 'ASIA', label: 'Asia', hours: [0, 7] },
  { id: 'LONDON', label: 'London', hours: [7, 12] },
  { id: 'NEW_YORK', label: 'New York', hours: [12, 21] },
];

const clamp = (n: unknown, lo: number, hi: number, dflt: number) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;
};
const intIn = (n: unknown, lo: number, hi: number, dflt: number) => Math.round(clamp(n, lo, hi, dflt));

export const DEFAULT_RULES: StrategyRules = {
  version: 1,
  setup: 'EMA_PULLBACK',
  direction: 'BOTH',
  timeframes: [],
  markets: [],
  params: { emaFast: 20, emaSlow: 50, rsiPeriod: 14, lookback: 50, bbPeriod: 20, bbStdDev: 2 },
  filters: { trendEma: null, rsiCap: 70, sessions: [] },
  stop: { type: 'STRUCTURE', atrMult: 1.5 },
  targets: { type: 'RR', rr: [1.5, 2.5, 4] },
  minRR: 2,
};

/** The strategy library: popular methods to start from and tweak. None is the general MarketX engine. */
export interface StrategyTemplate {
  id: string;
  name: string;
  family: string;
  blurb: string;
  rules: StrategyRules;
}
const t = (id: string, name: string, family: string, blurb: string, over: Partial<Omit<StrategyRules, 'params' | 'filters' | 'stop' | 'targets'>> & {
  params?: Partial<StrategyRules['params']>;
  filters?: Partial<StrategyRules['filters']>;
  stop?: Partial<StrategyRules['stop']>;
  targets?: Partial<StrategyRules['targets']>;
}): StrategyTemplate => ({
  id,
  name,
  family,
  blurb,
  rules: normalizeRules({
    ...DEFAULT_RULES,
    ...over,
    params: { ...DEFAULT_RULES.params, ...(over.params || {}) },
    filters: { ...DEFAULT_RULES.filters, ...(over.filters || {}) },
    stop: { ...DEFAULT_RULES.stop, ...(over.stop || {}) },
    targets: { ...DEFAULT_RULES.targets, ...(over.targets || {}) },
  }) as StrategyRules,
});
export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  t('smc-ob', 'SMC: order block retest', 'SMC', 'Break of structure, then buy or sell the retest of the order block that caused it.', { setup: 'SMC_OB_RETEST', timeframes: ['15M', '1H', '4H'], filters: { trendEma: null, rsiCap: null }, targets: { type: 'STRUCTURE', rr: [2, 3, 5] }, minRR: 2 }),
  t('ict-silver-bullet', 'ICT: liquidity sweep + FVG (killzones)', 'ICT', 'Sell-side or buy-side liquidity is swept, structure shifts, and the entry is the fair value gap, only in the London and New York killzones.', { setup: 'ICT_SWEEP_FVG', timeframes: ['5M', '15M', '1H'], filters: { sessions: ['LONDON', 'NEW_YORK'], rsiCap: null }, targets: { type: 'STRUCTURE', rr: [2, 3, 4] }, minRR: 2 }),
  t('ict-sweep', 'ICT: sweep + FVG (any session)', 'ICT', 'The same sweep, shift and fair value gap entry at any time of day, on any timeframe.', { setup: 'ICT_SWEEP_FVG', filters: { rsiCap: null }, targets: { type: 'STRUCTURE', rr: [2, 3, 4] } }),
  t('trend-ema', 'Trend following: EMA 20/50 pullback', 'Trend', 'Trade with the trend: buy pullbacks to the 20 EMA while it holds above the 50 (and the mirror for sells).', { setup: 'EMA_PULLBACK', params: { emaFast: 20, emaSlow: 50 }, filters: { trendEma: 200, rsiCap: 70 } }),
  t('golden-cross', 'Moving average crossover (9/21)', 'Trend', 'Enter when the 9 EMA crosses the 21 EMA, only in the direction of the 200 EMA trend.', { setup: 'MA_CROSS', params: { emaFast: 9, emaSlow: 21 }, filters: { trendEma: 200 }, stop: { type: 'ATR', atrMult: 1.5 }, targets: { type: 'RR', rr: [1.5, 2.5, 4] } }),
  t('breakout-retest', 'Breakout and retest', 'Breakout', 'A clean close through a key level, then the retest that holds. The classic continuation entry.', { setup: 'BREAKOUT_RETEST', params: { lookback: 60 }, targets: { type: 'STRUCTURE', rr: [1.5, 2.5, 4] } }),
  t('rsi-div', 'RSI divergence reversal', 'Reversal', 'Fade exhausted moves: a lower low with a higher RSI low (or the mirror), confirmed by a strong close.', { setup: 'RSI_DIVERGENCE', filters: { rsiCap: null }, targets: { type: 'STRUCTURE', rr: [1.5, 2.5, 3.5] } }),
  t('sr-bounce', 'Support and resistance bounce', 'Price action', 'Buy proven support and sell proven resistance on a rejection wick.', { setup: 'SR_BOUNCE', params: { lookback: 80 }, targets: { type: 'STRUCTURE', rr: [1.5, 2.5, 4] } }),
  t('bollinger', 'Bollinger Band mean reversion', 'Mean reversion', 'Price stretches outside the bands and snaps back: first target the middle band.', { setup: 'BOLLINGER_REVERSION', targets: { type: 'STRUCTURE', rr: [1, 2, 3] }, minRR: 1.5 }),
  t('london-breakout', 'London breakout (Asian range)', 'Session', 'Mark the Asian range, trade the London or New York breakout of it. Intraday only.', { setup: 'SESSION_BREAKOUT', timeframes: ['5M', '15M', '30M', '1H'], filters: { sessions: ['LONDON', 'NEW_YORK'], rsiCap: null }, targets: { type: 'STRUCTURE', rr: [1.5, 2.5, 3.5] } }),
  t('wyckoff-spring', 'Wyckoff spring / upthrust', 'Wyckoff', 'A false break of the trading range that closes back inside: the spring (or upthrust) entry, aiming for the other side.', { setup: 'RANGE_SWEEP', params: { lookback: 60 }, targets: { type: 'STRUCTURE', rr: [2, 3, 4] } }),
];

/** A valid rule set from any input (out-of-range values are clamped, unknown values dropped); null = unusable */
export function normalizeRules(input: any): StrategyRules | null {
  if (!input || typeof input !== 'object') return null;
  const setup = SETUP_IDS.includes(input.setup) ? (input.setup as SetupId) : null;
  if (!setup) return null;
  const p = input.params || {};
  const f = input.filters || {};
  const st = input.stop || {};
  const tg = input.targets || {};
  const emaFast = intIn(p.emaFast, 3, 100, DEFAULT_RULES.params.emaFast);
  let emaSlow = intIn(p.emaSlow, 5, 300, DEFAULT_RULES.params.emaSlow);
  if (emaSlow <= emaFast) emaSlow = Math.min(300, emaFast * 2);
  const tfs = Array.isArray(input.timeframes) ? input.timeframes.map((x: any) => String(x).toUpperCase()).filter((x: string) => SUPPORTED_TIMEFRAMES.includes(x)) : [];
  const rr = (Array.isArray(tg.rr) ? tg.rr : DEFAULT_RULES.targets.rr)
    .map((x: any) => Number(x))
    .filter((x: number) => Number.isFinite(x) && x >= 0.5 && x <= 20)
    .sort((a: number, b: number) => a - b)
    .slice(0, 3);
  return {
    version: 1,
    setup,
    direction: input.direction === 'LONG' || input.direction === 'SHORT' ? input.direction : 'BOTH',
    timeframes: SUPPORTED_TIMEFRAMES.filter(x => tfs.includes(x)),
    markets: Array.isArray(input.markets) ? MARKETS.filter(m => input.markets.includes(m)) : [],
    params: {
      emaFast,
      emaSlow,
      rsiPeriod: intIn(p.rsiPeriod, 5, 30, 14),
      lookback: intIn(p.lookback, 20, 200, 50),
      bbPeriod: intIn(p.bbPeriod, 10, 50, 20),
      bbStdDev: Number(clamp(p.bbStdDev, 1, 3.5, 2).toFixed(1)),
    },
    filters: {
      trendEma: f.trendEma === null || f.trendEma === undefined || f.trendEma === false ? null : intIn(f.trendEma, 20, 300, 200),
      rsiCap: f.rsiCap === null || f.rsiCap === undefined || f.rsiCap === false ? null : intIn(f.rsiCap, 55, 90, 70),
      sessions: Array.isArray(f.sessions) ? SESSIONS.map(s => s.id).filter(s => f.sessions.includes(s)) : [],
    },
    stop: { type: st.type === 'ATR' ? 'ATR' : 'STRUCTURE', atrMult: Number(clamp(st.atrMult, 0.5, 5, 1.5).toFixed(1)) },
    targets: { type: tg.type === 'STRUCTURE' ? 'STRUCTURE' : 'RR', rr: rr.length ? rr : [...DEFAULT_RULES.targets.rr] },
    minRR: Number(clamp(input.minRR, 1, 10, 2).toFixed(1)),
  };
}

const tfLabel = (tf: string) => tf.replace(/^(\d+)M$/, '$1m');
/** The rules in plain words (the review screen, and the write-up when the strategy engine is unavailable) */
export function describeRules(r: StrategyRules): string[] {
  const s = SETUPS[r.setup];
  const lines = [`Setup: ${s.name}. ${s.explain}`];
  lines.push(`Direction: ${r.direction === 'BOTH' ? 'buys and sells' : r.direction === 'LONG' ? 'buys only' : 'sells only'}.`);
  lines.push(`Timeframes: ${r.timeframes.length ? r.timeframes.map(tfLabel).join(', ') : 'any'}. Markets: ${r.markets.length ? r.markets.join(', ') : 'any'}.`);
  if (r.setup === 'EMA_PULLBACK' || r.setup === 'MA_CROSS') lines.push(`EMAs: fast ${r.params.emaFast}, slow ${r.params.emaSlow}.`);
  if (r.setup === 'BOLLINGER_REVERSION') lines.push(`Bollinger Bands: ${r.params.bbPeriod} periods, ${r.params.bbStdDev} standard deviations.`);
  if (['BREAKOUT_RETEST', 'SR_BOUNCE', 'RANGE_SWEEP', 'RSI_DIVERGENCE', 'SMC_OB_RETEST', 'ICT_SWEEP_FVG'].includes(r.setup)) lines.push(`Looks back over the last ${r.params.lookback} candles.`);
  const filters: string[] = [];
  if (r.filters.trendEma) filters.push(`only with the ${r.filters.trendEma} EMA trend`);
  if (r.filters.rsiCap) filters.push(`no buys above RSI ${r.filters.rsiCap}, no sells below RSI ${100 - r.filters.rsiCap}`);
  if (r.filters.sessions.length) filters.push(`only in the ${r.filters.sessions.map(x => SESSIONS.find(s => s.id === x)!.label).join(' and ')} session${r.filters.sessions.length > 1 ? 's' : ''}`);
  lines.push(`Filters: ${filters.length ? filters.join('; ') : 'none'}.`);
  lines.push(`Stop loss: ${r.stop.type === 'ATR' ? `${r.stop.atrMult} × ATR from the entry` : 'beyond the setup\'s own invalidation (structure)'}.`);
  lines.push(
    `Targets: ${r.targets.type === 'STRUCTURE' ? 'the next structure level first, then ' : ''}${r.targets.rr.map(x => `${x}R`).join(', ')}. Minimum reward: ${r.minRR}R.`
  );
  return lines;
}

/** One line: setup, direction and timeframes ("ICT liquidity sweep + FVG · buys only · 5m, 15m, 1H") */
export function shortSummary(r: StrategyRules): string {
  const dir = r.direction === 'BOTH' ? 'buys and sells' : r.direction === 'LONG' ? 'buys only' : 'sells only';
  return `${SETUPS[r.setup].name} · ${dir} · ${r.timeframes.length ? r.timeframes.map(tfLabel).join(', ') : 'any timeframe'}`;
}

/** What the trader answered in the builder (the guided questions plus their own words) */
export interface StrategyDraftInput {
  name: string;
  freeText: string;
  /** Guided answers: a full rule set the trader edited (from a template or the defaults) */
  guided: StrategyRules;
  templateId?: string | null;
}
export const MAX_STRATEGIES = 10;
export const MAX_FREE_TEXT = 2000;
