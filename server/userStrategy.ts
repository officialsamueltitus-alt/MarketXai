// ===========================================================================
// Strategy mode: runs a trader's approved rules (src/utils/strategyRules.ts) on real candles, in code. No AI decides a
// level here: the Strategy Builder's words engine (server/strategyAi.ts, same connection as the general engine) only turns words into rules and writes the explanation.
// Every setup is read as a buy; sells run the same code on the mirrored chart (prices negated). A setup must have formed
// on the latest candles; filters, stop, targets and the minimum reward then decide, and the same guards as the general
// engine apply: stop on the right side, targets ahead of price, and price not already half-way to TP1.
// ===========================================================================
import { computeAtr, emaSeries, rsiSeries, type Candle } from './strategy';
import { timeframeMinutes } from '../src/utils/timeframe';
import { SESSIONS, SETUPS, type StrategyRules } from '../src/utils/strategyRules';

export interface UserSignal {
  direction: 'LONG' | 'SHORT';
  execution: 'MARKET' | 'LIMIT';
  entry: { min: number; max: number; optimal: number };
  stop: number;
  targets: Array<{ label: string; price: number; rr: number }>;
  rrFinal: number;
  score: number;
  /** The level or area the setup is built on (order block, FVG, broken level, EMA, range edge…) */
  zone: { low: number; high: number; label: string };
  /** What triggered it, in plain words */
  trigger: string;
  /** Open time of the trigger candle (or of the setup's formation for a limit entry) */
  at: number;
  /** Every filter and check it passed */
  checks: string[];
}
export interface UserStrategyResult {
  signal: UserSignal | null;
  /** Why there is no trade (null when there is one) */
  reason: string | null;
  indicators: { rsi: number | null; atr: number; emaFast: number | null; emaSlow: number | null };
  setupName: string;
}

const body = (c: Candle) => Math.abs(c.c - c.o);
const range = (c: Candle) => Math.max(c.h - c.l, 1e-12);
const mirror = (c: Candle): Candle => ({ t: c.t, o: -c.o, h: -c.l, l: -c.h, c: -c.c });

interface Pivot { i: number; p: number }
function pivots(cs: Candle[], k = 2): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = [];
  const lows: Pivot[] = [];
  for (let i = k; i < cs.length - k; i++) {
    let hi = true;
    let lo = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (cs[j].h >= cs[i].h) hi = false;
      if (cs[j].l <= cs[i].l) lo = false;
    }
    if (hi) highs.push({ i, p: cs[i].h });
    if (lo) lows.push({ i, p: cs[i].l });
  }
  return { highs, lows };
}
const maxH = (cs: Candle[], a: number, b: number) => Math.max(...cs.slice(Math.max(0, a), Math.max(a + 1, b)).map(c => c.h));
const minL = (cs: Candle[], a: number, b: number) => Math.min(...cs.slice(Math.max(0, a), Math.max(a + 1, b)).map(c => c.l));

/** A buy setup read on candles (sells use the mirrored chart). null fields = not formed; reason says why. */
interface LongSetup {
  execution: 'MARKET' | 'LIMIT';
  /** LIMIT only: the entry band (proximal edge = high for a buy) */
  band?: { low: number; high: number };
  /** The setup's own invalidation (below it the idea is wrong) */
  invalidation: number;
  /** A structure target (resistance, liquidity, range high, middle band…), if the setup has one */
  structTarget?: number;
  zone: { low: number; high: number; label: string };
  trigger: string;
  at: number;
  /** 0 to 10: how clean the setup is */
  quality: number;
}
type Ctx = { cs: Candle[]; price: number; atr: number; rules: StrategyRules; tfMin: number; ema: (n: number) => number[]; rsi: number[] };
type SetupFn = (x: Ctx) => LongSetup | string;

const SETUP_FNS: Record<StrategyRules['setup'], SetupFn> = {
  EMA_PULLBACK: ({ cs, rules, ema, atr }) => {
    const n = cs.length;
    const f = ema(rules.params.emaFast);
    const s = ema(rules.params.emaSlow);
    if (!(f[n - 1] > s[n - 1] && s[n - 1] > s[n - 6])) return `the ${rules.params.emaFast} EMA is not above a rising ${rules.params.emaSlow} EMA`;
    for (let i = n - 1; i >= n - 2; i--) {
      const c = cs[i];
      if (c.l <= f[i] + atr * 0.05 && c.c > f[i] && c.c > c.o) {
        return { execution: 'MARKET', invalidation: minL(cs, n - 5, n), structTarget: maxH(cs, n - rules.params.lookback, n), zone: { low: Math.min(c.l, f[i]), high: f[i], label: `${rules.params.emaFast} EMA` }, trigger: `pullback to the ${rules.params.emaFast} EMA closed back up with the trend`, at: c.t, quality: c.c - c.l > range(c) * 0.6 ? 8 : 5 };
      }
    }
    return `no pullback to the ${rules.params.emaFast} EMA closed back with the trend on the last two candles`;
  },
  MA_CROSS: ({ cs, rules, ema }) => {
    const n = cs.length;
    const f = ema(rules.params.emaFast);
    const s = ema(rules.params.emaSlow);
    for (let i = n - 1; i >= n - 2; i--) {
      if (f[i - 1] <= s[i - 1] && f[i] > s[i]) {
        return { execution: 'MARKET', invalidation: minL(cs, n - 10, n), zone: { low: Math.min(f[i], s[i]), high: Math.max(f[i], s[i]), label: `${rules.params.emaFast}/${rules.params.emaSlow} EMA cross` }, trigger: `the ${rules.params.emaFast} EMA crossed above the ${rules.params.emaSlow} EMA`, at: cs[i].t, quality: 5 };
      }
    }
    return `no ${rules.params.emaFast}/${rules.params.emaSlow} EMA cross on the last two candles`;
  },
  RSI_DIVERGENCE: ({ cs, rules, rsi }) => {
    const n = cs.length;
    const lows = pivots(cs).lows.filter(p => p.i >= n - rules.params.lookback);
    if (lows.length < 2) return 'not enough swing lows to compare';
    const [a, b] = lows.slice(-2);
    if (!(b.p < a.p && rsi[b.i] > rsi[a.i] + 2 && b.i >= n - 10 && rsi[b.i] < 45)) return 'no bullish RSI divergence (lower low in price with a higher RSI low) on the latest swing';
    for (let i = Math.max(b.i + 1, n - 3); i < n; i++) {
      if (cs[i].c > cs[b.i].h && cs[i].c > cs[i].o) {
        return { execution: 'MARKET', invalidation: b.p, structTarget: maxH(cs, a.i, b.i + 1), zone: { low: b.p, high: cs[b.i].h, label: 'divergence low' }, trigger: `RSI divergence (RSI ${Math.round(rsi[a.i])} → ${Math.round(rsi[b.i])} while price made a lower low), confirmed by a close above the swing candle`, at: cs[i].t, quality: 7 };
      }
    }
    return 'RSI divergence found, waiting for a close above the swing candle';
  },
  BREAKOUT_RETEST: ({ cs, rules, atr, price }) => {
    const n = cs.length;
    const level = maxH(cs, n - rules.params.lookback, n - 6);
    const floor = minL(cs, n - rules.params.lookback, n - 6);
    let b = -1;
    for (let i = n - 15; i < n; i++) if (i > 0 && cs[i].c > level && cs[i - 1].c <= level) { b = i; break; }
    if (b < 0) return 'no recent close above the key level';
    for (let i = b + 1; i < n; i++) if (cs[i].c < level) return 'the breakout failed (price closed back below the level)';
    const target = level + (level - floor);
    for (let i = n - 1; i > b; i--) {
      if (cs[i].l <= level + atr * 0.25 && cs[i].c > level && i >= n - 2) {
        return { execution: 'MARKET', invalidation: Math.min(minL(cs, b, n), level - atr * 0.5), structTarget: target, zone: { low: level - atr * 0.2, high: level + atr * 0.2, label: 'broken level' }, trigger: `retest of the broken level ${level} held`, at: cs[i].t, quality: 8 };
      }
    }
    if (minL(cs, b + 1, n) > level + atr * 0.25 && price - level <= atr * 3) {
      return { execution: 'LIMIT', band: { low: level, high: level + atr * 0.2 }, invalidation: level - atr * 0.6, structTarget: target, zone: { low: level, high: level + atr * 0.2, label: 'broken level' }, trigger: `breakout above ${level}; waiting for the retest`, at: cs[b].t, quality: 6 };
    }
    return 'breakout found, but price is too far from the level for a retest entry';
  },
  SR_BOUNCE: ({ cs, rules, atr }) => {
    const n = cs.length;
    const support = minL(cs, n - rules.params.lookback, n - 4);
    const touches = pivots(cs.slice(0, n - 3)).lows.filter(p => p.i >= n - rules.params.lookback && p.p <= support + atr * 0.3).length;
    if (touches < 2) return 'no support level touched at least twice';
    for (let i = n - 1; i >= n - 2; i--) {
      const c = cs[i];
      if (c.l <= support + atr * 0.3 && c.c > support && c.c >= c.l + range(c) * 0.5) {
        return { execution: 'MARKET', invalidation: Math.min(c.l, support), structTarget: maxH(cs, n - rules.params.lookback, n - 1), zone: { low: support, high: support + atr * 0.3, label: `support (${touches} touches)` }, trigger: `support tested ${touches + 1} times and rejected with a wick`, at: c.t, quality: Math.min(9, 4 + touches) };
      }
    }
    return 'price is not rejecting the support level right now';
  },
  BOLLINGER_REVERSION: ({ cs, rules }) => {
    const n = cs.length;
    const P = rules.params.bbPeriod;
    const band = (i: number) => {
      const w = cs.slice(i - P + 1, i + 1).map(c => c.c);
      const m = w.reduce((a, b) => a + b, 0) / w.length;
      const sd = Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
      return { mid: m, lower: m - sd * rules.params.bbStdDev };
    };
    for (let i = n - 1; i >= n - 2; i--) {
      const prev = band(i - 1);
      const cur = band(i);
      if (cs[i - 1].c < prev.lower && cs[i].c > cur.lower) {
        return { execution: 'MARKET', invalidation: minL(cs, i - 2, n), structTarget: cur.mid, zone: { low: cur.lower, high: cur.lower, label: 'lower Bollinger Band' }, trigger: 'closed outside the lower band, then back inside', at: cs[i].t, quality: 6 };
      }
    }
    return 'no close back inside the Bollinger Bands on the last two candles';
  },
  SESSION_BREAKOUT: ({ cs, tfMin }) => {
    if (tfMin > 60) return 'the session breakout needs an intraday timeframe (1H or lower)';
    const n = cs.length;
    const last = cs[n - 1];
    const day = Math.floor(last.t / 86400000) * 86400000;
    const asia = cs.filter(c => c.t >= day && c.t < day + 7 * 3600000);
    if (asia.length < 3) return "today's Asian session range is not complete yet";
    const hi = Math.max(...asia.map(c => c.h));
    const lo = Math.min(...asia.map(c => c.l));
    for (let i = n - 1; i >= n - 2; i--) {
      const h = new Date(cs[i].t).getUTCHours();
      if (h >= 7 && h < 16 && cs[i].c > hi && cs[i - 1].c <= hi) {
        return { execution: 'MARKET', invalidation: (hi + lo) / 2, structTarget: hi + (hi - lo), zone: { low: lo, high: hi, label: 'Asian range' }, trigger: `closed above the Asian range high ${hi} during ${h < 12 ? 'London' : 'New York'}`, at: cs[i].t, quality: 6 };
      }
    }
    return 'no breakout of the Asian range on the last two candles';
  },
  RANGE_SWEEP: ({ cs, rules, atr }) => {
    const n = cs.length;
    const lo = minL(cs, n - rules.params.lookback, n - 4);
    const hi = maxH(cs, n - rules.params.lookback, n - 4);
    if (hi - lo > atr * 10) return 'price is trending, not in a trading range';
    for (let i = n - 1; i >= n - 3; i--) {
      const c = cs[i];
      if (c.l < lo && c.c > lo) {
        return { execution: 'MARKET', invalidation: c.l, structTarget: hi, zone: { low: lo, high: hi, label: 'trading range' }, trigger: `swept the range low ${lo} and closed back inside (spring)`, at: c.t, quality: c.c >= c.l + range(c) * 0.6 ? 8 : 6 };
      }
    }
    return 'no sweep of the range low that closed back inside';
  },
  SMC_OB_RETEST: ({ cs, rules, atr, price }) => {
    const n = cs.length;
    const { highs } = pivots(cs);
    // Break of structure: a close above the last swing high, within the last 30 candles
    let bos = -1;
    let swing: Pivot | null = null;
    for (let i = n - 1; i >= Math.max(1, n - 30); i--) {
      const sh = [...highs].reverse().find(p => p.i < i - 1);
      if (sh && cs[i].c > sh.p && cs[i - 1].c <= sh.p) { bos = i; swing = sh; break; }
    }
    if (bos < 0 || !swing) return 'no break of structure on the recent candles';
    // The impulse started at the lowest low between the swing and the break; the order block is the last bearish candle at its start
    let lowIdx = swing.i;
    for (let i = swing.i; i <= bos; i++) if (cs[i].l <= cs[lowIdx].l) lowIdx = i;
    let ob = -1;
    for (let i = lowIdx; i >= Math.max(0, lowIdx - 5); i--) if (cs[i].c < cs[i].o) { ob = i; break; }
    if (ob < 0) return 'no order block (bearish candle) at the start of the impulse';
    const z = { low: cs[ob].l, high: Math.max(cs[ob].o, cs[ob].c) };
    for (let i = bos + 1; i < n; i++) if (cs[i].c < z.low) return 'the order block was broken';
    const touched = cs.slice(bos + 1, n - 1).some(c => c.l <= z.high);
    if (touched) return 'the order block was already retested';
    const target = maxH(cs, bos, n);
    if (cs[n - 1].l <= z.high) return { execution: 'MARKET', invalidation: z.low, structTarget: target, zone: { ...z, label: 'order block' }, trigger: 'break of structure, price now retesting the order block', at: cs[n - 1].t, quality: 8 };
    if (price - z.high > atr * 6) return 'the order block is too far below price';
    return { execution: 'LIMIT', band: { low: (z.low + z.high) / 2, high: z.high }, invalidation: z.low, structTarget: target, zone: { ...z, label: 'order block' }, trigger: `break of structure above ${swing.p}; limit entry on the order block retest`, at: cs[bos].t, quality: 7 };
  },
  ICT_SWEEP_FVG: ({ cs, rules, atr, price }) => {
    const n = cs.length;
    const { lows } = pivots(cs);
    for (let s = n - 2; s >= Math.max(3, n - 30); s--) {
      const liq = [...lows].reverse().find(p => p.i < s - 2 && p.i >= n - rules.params.lookback);
      if (!liq || !(cs[s].l < liq.p && cs[s].c > liq.p)) continue;
      // Market structure shift: a close above the highs right before the sweep
      const shiftHigh = maxH(cs, s - 5, s + 1);
      let m = -1;
      for (let i = s + 1; i < n; i++) if (cs[i].c > shiftHigh) { m = i; break; }
      if (m < 0) return 'liquidity swept, waiting for the structure shift';
      // Fair value gap left by the displacement
      let fvg: { low: number; high: number } | null = null;
      for (let k = s + 1; k <= Math.min(m + 1, n - 2); k++) if (cs[k - 1].h < cs[k + 1].l) fvg = { low: cs[k - 1].h, high: cs[k + 1].l };
      if (!fvg) return 'structure shifted, but the displacement left no fair value gap';
      for (let i = m + 1; i < n; i++) if (cs[i].c < fvg.low) return 'the fair value gap was filled through';
      const target = maxH(cs, n - rules.params.lookback, s);
      if (cs[n - 1].l <= fvg.high) return { execution: 'MARKET', invalidation: cs[s].l, structTarget: target, zone: { ...fvg, label: 'fair value gap' }, trigger: `swept the low ${liq.p}, shifted structure, price now in the fair value gap`, at: cs[n - 1].t, quality: 9 };
      if (price - fvg.high > atr * 5) return 'the fair value gap is too far below price';
      return { execution: 'LIMIT', band: fvg, invalidation: cs[s].l, structTarget: target, zone: { ...fvg, label: 'fair value gap' }, trigger: `swept the low ${liq.p} and shifted structure; limit entry in the fair value gap`, at: cs[m].t, quality: 8 };
    }
    return 'no sweep of a swing low on the recent candles';
  },
};

/** Runs the rules on the candles of one timeframe; the trade (if any) and why */
export function runUserStrategy(
  candlesRaw: Candle[],
  rules: StrategyRules,
  opts: { price: number; timeframe: string; decimals: number; slMode?: 'normal' | 'tight' }
): UserStrategyResult {
  const setupName = SETUPS[rules.setup].name;
  const cs0 = candlesRaw.filter(c => [c.o, c.h, c.l, c.c].every(v => Number.isFinite(v) && v > 0) && c.h >= c.l);
  const atr0 = cs0.length ? computeAtr(cs0) : 0;
  const ind = { rsi: null as number | null, atr: atr0, emaFast: null as number | null, emaSlow: null as number | null };
  if (cs0.length < Math.max(60, rules.params.emaSlow + 5, rules.filters.trendEma ? rules.filters.trendEma + 5 : 0)) {
    return { signal: null, reason: `No signal. Not enough ${opts.timeframe} candles to run your strategy right now.`, indicators: ind, setupName };
  }
  const n = cs0.length;
  const rsi0 = rsiSeries(cs0, rules.params.rsiPeriod);
  ind.rsi = Number.isFinite(rsi0[n - 1]) ? Math.round(rsi0[n - 1]) : null;
  ind.emaFast = emaSeries(cs0, rules.params.emaFast)[n - 1];
  ind.emaSlow = emaSeries(cs0, rules.params.emaSlow)[n - 1];
  const dec = opts.decimals;
  const r = (p: number) => Number(p.toFixed(dec));
  const tfMin = timeframeMinutes(opts.timeframe);
  const reasons: string[] = [];
  let best: UserSignal | null = null;

  for (const dir of ['LONG', 'SHORT'] as const) {
    if (rules.direction !== 'BOTH' && rules.direction !== dir) continue;
    const long = dir === 'LONG';
    const sg = long ? 1 : -1;
    const cs = long ? cs0 : cs0.map(mirror);
    const price = long ? opts.price : -opts.price;
    const atr = computeAtr(cs) || range(cs[n - 1]);
    const cache = new Map<number, number[]>();
    const ema = (k: number) => cache.get(k) || (cache.set(k, emaSeries(cs, k)), cache.get(k)!);
    const rsi = long ? rsi0 : rsi0.map(v => 100 - v);
    const side = long ? 'buy' : 'sell';
    const got = SETUP_FNS[rules.setup]({ cs, price, atr, rules, tfMin, ema, rsi });
    if (typeof got === 'string') {
      reasons.push(`${side}: ${got}`);
      continue;
    }
    const checks: string[] = [];
    // Filters
    if (rules.filters.trendEma) {
      const e = ema(rules.filters.trendEma);
      if (!(price > e[n - 1] && e[n - 1] > e[n - 6])) { reasons.push(`${side}: against the ${rules.filters.trendEma} EMA trend`); continue; }
      checks.push(`with the ${rules.filters.trendEma} EMA trend`);
    }
    if (rules.filters.rsiCap && Number.isFinite(rsi[n - 1])) {
      if (rsi[n - 1] > rules.filters.rsiCap) { reasons.push(`${side}: RSI ${Math.round(long ? rsi[n - 1] : 100 - rsi[n - 1])} is ${long ? 'overbought' : 'oversold'} for a ${side}`); continue; }
      checks.push(`RSI ${Math.round(long ? rsi[n - 1] : 100 - rsi[n - 1])} within your limit`);
    }
    if (rules.filters.sessions.length && tfMin < 240) {
      const h = new Date(got.at).getUTCHours();
      const ok = rules.filters.sessions.some(id => { const s = SESSIONS.find(x => x.id === id)!; return h >= s.hours[0] && h < s.hours[1]; });
      if (!ok) { reasons.push(`${side}: the setup formed outside your sessions (${rules.filters.sessions.join(', ').toLowerCase().replace('_', ' ')})`); continue; }
      checks.push('inside your session');
    }
    // Entry
    let entry: { min: number; max: number; optimal: number };
    if (got.execution === 'LIMIT' && got.band) {
      if (got.band.high > price) { reasons.push(`${side}: the limit entry is no longer ahead of price`); continue; }
      entry = { min: got.band.low, max: got.band.high, optimal: got.band.high - (got.band.high - got.band.low) * 0.3 };
    } else {
      const pad = atr * 0.1;
      entry = { min: price - pad, max: price, optimal: price };
    }
    // Stop
    const buffer = atr * (opts.slMode === 'tight' ? 0.05 : 0.1);
    let stop = rules.stop.type === 'ATR' ? entry.optimal - atr * rules.stop.atrMult : got.invalidation - buffer;
    if (entry.optimal - stop < atr * 0.3) stop = entry.optimal - atr * 0.3;
    const risk = entry.optimal - stop;
    if (!(risk > 0) || price <= stop) { reasons.push(`${side}: price is already at or beyond the stop`); continue; }
    // Targets
    const rrOf = (p: number) => (p - entry.optimal) / risk;
    // The trader's R multiples plus (for structure targets) the setup's own level, in price order, spaced at least 0.4R;
    // a structure level is always kept (as the last target when it is the furthest)
    const struct = rules.targets.type === 'STRUCTURE' && got.structTarget !== undefined && rrOf(got.structTarget) >= 1 && got.structTarget > price ? got.structTarget : null;
    const pool = [
      ...rules.targets.rr.map(x => ({ label: `${x}R`, price: entry.optimal + risk * x })),
      ...(struct !== null ? [{ label: 'Structure target', price: struct }] : []),
    ]
      .filter(x => x.price > price && rrOf(x.price) >= 1)
      .sort((a, b) => a.price - b.price);
    const tps: Array<{ label: string; price: number }> = [];
    for (const x of pool) if (!tps.length || x.price > tps[tps.length - 1].price + risk * 0.4) tps.push(x);
    if (struct !== null && tps.length > 3 && !tps.slice(0, 3).some(x => x.price === struct)) tps.splice(2, tps.length - 2, tps.find(x => x.price === struct)!);
    tps.splice(3);
    while (tps.length && tps.length < 3) tps.push({ label: 'Extension', price: tps[tps.length - 1].price + risk });
    if (!tps.length) { reasons.push(`${side}: no target sits ahead of price`); continue; }
    const rrFinal = rrOf(tps[tps.length - 1].price);
    if (rrOf(tps[0].price) < 1) { reasons.push(`${side}: TP1 pays less than 1R`); continue; }
    if (rrFinal < rules.minRR) { reasons.push(`${side}: pays ${rrFinal.toFixed(1)}R, under your ${rules.minRR}R minimum`); continue; }
    // Already moved: price half-way from the trigger to TP1 (market entries), or a target already reached since the setup
    // (a limit entry has not filled yet: its targets are the highs price is expected to revisit, so only market entries
    // are checked against what happened since the trigger)
    const fromIdx = cs.findIndex(c => c.t >= got.at);
    if (got.execution === 'MARKET') {
      const since = cs.slice(Math.max(0, fromIdx));
      if (since.some(c => c.h >= tps[0].price)) { reasons.push(`${side}: TP1 was already reached since the setup formed`); continue; }
      const trig = cs[Math.max(0, fromIdx)].c;
      const prog = (price - trig) / (tps[0].price - trig);
      if (tps[0].price > trig && prog >= 0.5) { reasons.push(`${side}: price already moved half-way to TP1 since the trigger`); continue; }
    }
    checks.unshift(got.trigger);
    const score = Math.max(50, Math.min(95, Math.round(62 + got.quality * 2 + checks.length * 3 + Math.min(8, (rrFinal - 2) * 3))));
    const back = (p: number) => r(long ? p : -p);
    const sig: UserSignal = {
      direction: dir,
      execution: got.execution,
      entry: long ? { min: back(entry.min), max: back(entry.max), optimal: back(entry.optimal) } : { min: back(entry.max), max: back(entry.min), optimal: back(entry.optimal) },
      stop: back(stop),
      targets: tps.map(x => ({ label: x.label, price: back(x.price), rr: Number(rrOf(x.price).toFixed(2)) })),
      rrFinal: Number(rrFinal.toFixed(2)),
      score,
      zone: long ? { low: back(got.zone.low), high: back(got.zone.high), label: got.zone.label } : { low: back(got.zone.high), high: back(got.zone.low), label: got.zone.label },
      trigger: long ? got.trigger : sellWords(got.trigger),
      at: got.at,
      checks: long ? checks : checks.map(sellWords),
    };
    // (sg kept for readability of the mirrored maths above)
    void sg;
    if (!best || sig.score > best.score) best = sig;
  }
  if (best) return { signal: best, reason: null, indicators: ind, setupName };
  return {
    signal: null,
    reason: `No signal from your strategy (${setupName}) on the ${opts.timeframe.replace(/^(\d+)M$/, '$1m')}: ${reasons.join('; ') || 'no setup'}.`,
    indicators: ind,
    setupName,
  };
}

/** A buy's wording read on the mirrored chart, in a seller's words (prices are shown positive) */
function sellWords(s: string): string {
  return s
    .replace(/-(\d[\d.]*)/g, '$1')
    .replace('above a rising', 'below a falling')
    .replace('closed back up', 'closed back down')
    .replace('crossed above', 'crossed below')
    .replace('lower low', 'higher high')
    .replace('higher RSI low', 'lower RSI high')
    .replace('a close above the swing candle', 'a close below the swing candle')
    .replace('close above', 'close below')
    .replace('closed above', 'closed below')
    .replace('Asian range high', 'Asian range low')
    .replace('range low', 'range high')
    .replace('the low ', 'the high ')
    .replace('support', 'resistance')
    .replace('lower Bollinger Band', 'upper Bollinger Band')
    .replace('lower band', 'upper band')
    .replace('break of structure above', 'break of structure below');
}
