// ===========================================================================
// MarketX strategy engine: Institutional Supply & Demand zones + Fibonacci entries
//
// Works on real OHLC candles of the requested timeframe:
//   1. Supply & Demand: find bases (1-3 small candles) that price left with an explosive, displacing
//      leg-out (DBR / RBR demand, RBD / DBD supply). Proximal line = base body edge, distal = base wick.
//   2. Freshness: replay every later candle — untouched zones are FRESH, tapped zones lose strength,
//      zones closed through are broken and discarded.
//   3. Fibonacci: anchor the retracement on the impulse the zone created (zone distal → extreme of the
//      move). Entry is where the 0.618–0.705 golden pocket overlaps the zone; the stop sits beyond the
//      distal line (the 100% level); targets are the impulse extreme and its -0.272 / -0.618 extensions,
//      or an opposing fresh zone if it comes first.
//   4. Only high-probability plans are signalled (score + minimum 1:2.5 reward to the final target);
//      otherwise NO_SIGNAL with the levels to watch.
//   5. Premium / discount: the dealing range is the recent swing range; its 0.50 equilibrium splits premium from
//      discount. Demand is only traded in discount (below 0.50), supply only in premium (above 0.50), both on the
//      dealing range and on the swing leg the Fibonacci is drawn on.
//   6. Strict, on every timeframe: zones come only from the most recent candles and the current price range, and
//      before any signal the zone, the entry band, the stop loss and every target are checked against every candle
//      since the zone formed (plus the live 24h range). Anything already tapped, smashed or entered-and-left makes
//      the setup "No signal, already mitigated".
// Pure functions only (no I/O) so it can be tested with fixture candles.
// ===========================================================================

export interface Candle {
  t: number; // open time (ms)
  o: number;
  h: number;
  l: number;
  c: number;
}

export type ZoneKind = 'DEMAND' | 'SUPPLY';

export interface SDZone {
  kind: ZoneKind;
  pattern: 'DBR' | 'RBR' | 'RBD' | 'DBD';
  proximal: number; // edge nearest current price (entry side)
  distal: number; // far edge (invalidation side)
  low: number;
  high: number;
  formedAt: number; // candle time of the base
  baseIndex: number;
  legOutIndex: number;
  baseCandles: number;
  departureAtr: number; // how far price left the zone, in ATRs
  brokeStructure: boolean;
  tapCount: number;
  fresh: boolean;
  score: number; // 0-100
  distanceAtr: number; // from current price to the proximal line
  priceInside: boolean;
  /** 3-candle fair value gap (imbalance) at the zone's doorstep; filled = price has since traded through it */
  fvg: { low: number; high: number; filled: boolean; filledAt?: number } | null;
  /** First candle after the leg-out: every tap/mitigation check replays from here */
  freshFrom: number;
  /** Open time of that candle (used by the recheck to replay from the same point) */
  freshFromTime?: number;
  /** Candles since the base formed (lower = more recent) */
  ageBars: number;
  /** Where the zone sits in the dealing range: discount (below the 0.50 equilibrium) or premium (above it) */
  territory?: 'PREMIUM' | 'DISCOUNT';
  /** Price is making the zone's FIRST touch right now (touch began on one of the last LIVE_TOUCH_BARS candles, never touched before) */
  liveFirstTouch?: boolean;
  /** Candle index where the current (live) touch began */
  touchStart?: number;
}

export interface FibLevel {
  ratio: number;
  label: string;
  price: number;
  isKey: boolean;
  description?: string;
}

export interface TradePlan {
  direction: 'LONG' | 'SHORT';
  zone: SDZone;
  impulseFrom: number; // 100% (zone origin)
  impulseTo: number; // 0% (impulse extreme)
  fib: FibLevel[];
  goldenPocket: { from: number; to: number };
  confluence: 'GOLDEN_POCKET_IN_ZONE' | 'FIB_BAND_OVERLAP' | 'LEG_ORIGIN' | 'ZONE_ONLY';
  entry: { min: number; max: number; optimal: number };
  stopLoss: number;
  targets: Array<{ label: string; price: number; rr: number }>;
  rrFinal: number;
  score: number;
  /** Why this setup is no longer fresh (empty = clean): zone/entry/stop/target already tapped */
  mitigation: string[];
  /** The golden pocket sits just outside the zone (within 0.3% of price) rather than inside it */
  goldenPocketNear?: boolean;
  /** 0.50 equilibrium of the swing leg the Fibonacci is drawn on */
  legEquilibrium: number;
  /** The zone sits on the right side of the leg's equilibrium (demand in discount, supply in premium) */
  inTerritory: boolean;
  /** LIMIT: pending order ahead of price. MARKET: price is on the zone's first touch now, enter at the current price */
  execution: 'LIMIT' | 'MARKET';
  /**
   * Proximity guard: price already moved toward TP1 (at least half-way from the entry, or closer than 1.5 ATR / 1R to it),
   * sits close to the stop loss, or already reacted just short of the entry and left. Any of these = no fresh trade.
   */
  moved?: { kind: 'NEAR_TP' | 'NEAR_SL' | 'LEFT_ZONE'; text: string } | null;
  /** RSI(14) entry confirmation and EMA(50) crosscheck (set by buildMarketMap) */
  confirmation?: { ok: boolean; rsiOk: boolean; emaOk: boolean; divergence: boolean; note: string };
  /** Setup quality 0-100, calibrated on MarketX's back-tests (set by buildMarketMap; see setupQuality) */
  quality?: number;
  /** The back-tested expectation behind the quality score (average R per trade of similar setups) */
  expectR?: number;
  /** A market entry that failed the stricter market-entry rules (fast market, or price deep in the zone) */
  marketBlocked?: string;
}

export interface MarketMap {
  timeframe: string;
  candles: number;
  lastClose: number;
  price: number;
  atr: number;
  trend: 'BULLISH' | 'BEARISH' | 'RANGING';
  swingHigh: number;
  swingLow: number;
  /** 0.50 of the dealing range (recent swing range): below is discount, above is premium */
  equilibrium: number;
  demandZones: SDZone[];
  supplyZones: SDZone[];
  plan: TradePlan | null; // chosen plan (null => NO_SIGNAL)
  alternate: TradePlan | null; // best plan in the other direction, if valid
  confidence: number;
  noSignalReason?: string;
  /** Best setup that would have qualified but whose levels were already tapped (reason for "already mitigated") */
  mitigatedSetup?: TradePlan | null;
  /** Best clean setup that price has already moved away from (close to TP1 / the stop, or reacted and left) */
  movedSetup?: TradePlan | null;
  /** RSI(14) / EMA(50) read on the latest candle */
  indicators?: IndicatorRead;
  decimals: number;
  /** Market the map was built for (when the caller passed it) */
  symbol?: string;
  /** A short heads-up on back-tested weaker markets/timeframes (shown above the write-up) */
  edgeNote?: string;
  /** Tight SL was asked for where it doesn't hold up (daily charts, crypto): Normal SL used instead, and why */
  slNote?: string;
  /** Where the latest ATR sits among the last 200 candles' ATRs (0 calm .. 1 hottest) */
  volatilityPct?: number;
}

// ---------------------------------------------------------------------------
// Timeframes
// ---------------------------------------------------------------------------
export { timeframeMinutes, normalizeTimeframe, timeframeFromPrompt, SUPPORTED_TIMEFRAMES } from '../src/utils/timeframe';
import { timeframeMinutes, normalizeTimeframe } from '../src/utils/timeframe';
import { isCryptoSymbol, normalEdge, priorR, AVERAGE_R } from './edge';

/** Merges candles into larger buckets (e.g. 1H → 4H), aligned to UTC. */
export function aggregateCandles(candles: Candle[], bucketMinutes: number): Candle[] {
  const size = bucketMinutes * 60000;
  const out: Candle[] = [];
  for (const c of candles) {
    const key = Math.floor(c.t / size) * size;
    const last = out[out.length - 1];
    if (last && last.t === key) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
    } else {
      out.push({ t: key, o: c.o, h: c.h, l: c.l, c: c.c });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function priceDecimals(price: number, jpy = false, forex = false): number {
  if (jpy) return 3;
  if (forex) return 5;
  // Sub-cent coins and memes: four significant digits (a 0.00000004 price would round to 0 at a fixed 7)
  if (price < 0.01) return Math.min(12, Math.max(7, Math.ceil(-Math.log10(price)) + 3));
  if (price < 1) return 5;
  if (price < 10) return 4;
  if (price < 1000) return 3;
  return 2;
}

const body = (c: Candle) => Math.abs(c.c - c.o);
const range = (c: Candle) => Math.max(c.h - c.l, 1e-12);
const bull = (c: Candle) => c.c > c.o;
const bear = (c: Candle) => c.c < c.o;

/** Rolling ATR (simple average of true range over `period`). */
function rollingAtr(candles: Candle[], period = 14): number[] {
  const tr = candles.map((c, i) => (i === 0 ? c.h - c.l : Math.max(c.h - c.l, Math.abs(c.h - candles[i - 1].c), Math.abs(c.l - candles[i - 1].c))));
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < tr.length; i++) {
    sum += tr[i];
    if (i >= period) sum -= tr[i - period];
    out.push(sum / Math.min(i + 1, period));
  }
  return out;
}

interface Swing {
  i: number;
  price: number;
  kind: 'H' | 'L';
}

function findSwings(candles: Candle[], k = 2): Swing[] {
  const out: Swing[] = [];
  for (let i = k; i < candles.length - k; i++) {
    let isH = true;
    let isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (candles[j].h >= candles[i].h) isH = false;
      if (candles[j].l <= candles[i].l) isL = false;
    }
    if (isH) out.push({ i, price: candles[i].h, kind: 'H' });
    if (isL) out.push({ i, price: candles[i].l, kind: 'L' });
  }
  return out;
}

function trendFromSwings(swings: Swing[]): 'BULLISH' | 'BEARISH' | 'RANGING' {
  const highs = swings.filter(s => s.kind === 'H').slice(-2);
  const lows = swings.filter(s => s.kind === 'L').slice(-2);
  if (highs.length < 2 || lows.length < 2) return 'RANGING';
  const hh = highs[1].price > highs[0].price;
  const hl = lows[1].price > lows[0].price;
  if (hh && hl) return 'BULLISH';
  if (!hh && !hl) return 'BEARISH';
  return 'RANGING';
}

// ---------------------------------------------------------------------------
// Indicators: RSI(14) is the leading entry confirmation, EMA(50) the signal crosscheck
// ---------------------------------------------------------------------------
/** Wilder's RSI on closes (NaN until `period` candles exist). */
export function rsiSeries(candles: Candle[], period = 14): number[] {
  const out: number[] = new Array(candles.length).fill(NaN);
  if (candles.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = candles[i].c - candles[i - 1].c;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const val = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[period] = val();
  for (let i = period + 1; i < candles.length; i++) {
    const d = candles[i].c - candles[i - 1].c;
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = val();
  }
  return out;
}

/** Exponential moving average of closes (seeded with the first close). */
export function emaSeries(candles: Candle[], period = 50): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  candles.forEach((c, i) => out.push(i === 0 ? c.c : c.c * k + out[i - 1] * (1 - k)));
  return out;
}

export interface IndicatorRead {
  /** RSI(14) on the latest candle */
  rsi: number;
  /** Price made a lower low while RSI made a higher low on the last two swing lows (recent) */
  bullishDivergence: boolean;
  /** Price made a higher high while RSI made a lower high on the last two swing highs (recent) */
  bearishDivergence: boolean;
  /** EMA(50) on the latest candle (null with too few candles) */
  ema50: number | null;
  /** EMA(50) slope over the last 10 candles, in ATRs */
  emaSlopeAtr: number;
  emaTrend: 'RISING' | 'FALLING' | 'FLAT';
}

/** RSI oversold / overbought bands: a buy is never taken into an overbought RSI, a sell never into an oversold one */
export const RSI_OVERBOUGHT = 70;
export const RSI_OVERSOLD = 30;
/** EMA(50) slope (ATRs per 10 candles) beyond which the trend is counted as clearly rising or falling */
export const EMA_SLOPE_ATR = 0.5;

export function readIndicators(candles: Candle[], swings: Swing[], atr: number): IndicatorRead {
  const n = candles.length;
  const rsi = rsiSeries(candles);
  const rsiNow = Number.isFinite(rsi[n - 1]) ? rsi[n - 1] : 50;
  // Divergence: compare the last two swing lows (highs) of the recent candles, the newer one within the last 25
  const div = (kind: 'H' | 'L') => {
    const pts = swings.filter(s => s.kind === kind && s.i >= n - 80 && Number.isFinite(rsi[s.i])).slice(-2);
    if (pts.length < 2 || pts[1].i < n - 25) return false;
    const [a, b] = pts;
    return kind === 'L' ? b.price < a.price && rsi[b.i] > rsi[a.i] + 2 : b.price > a.price && rsi[b.i] < rsi[a.i] - 2;
  };
  const enough = n >= 60;
  const ema = enough ? emaSeries(candles) : [];
  const emaSlopeAtr = enough && atr > 0 ? (ema[n - 1] - ema[n - 11]) / atr : 0;
  return {
    rsi: Number(rsiNow.toFixed(1)),
    bullishDivergence: div('L'),
    bearishDivergence: div('H'),
    ema50: enough ? ema[n - 1] : null,
    emaSlopeAtr: Number(emaSlopeAtr.toFixed(2)),
    emaTrend: emaSlopeAtr > EMA_SLOPE_ATR ? 'RISING' : emaSlopeAtr < -EMA_SLOPE_ATR ? 'FALLING' : 'FLAT',
  };
}

/**
 * Indicator confirmation of one setup (every timeframe and market):
 * 1. RSI(14), the leading entry indicator: a buy is refused into an overbought RSI (price is running away from the
 *    zone), a sell into an oversold one. A market entry (first touch now) also needs RSI at or below 50 for buys
 *    (at or above 50 for sells) or a divergence in the trade's favour.
 * 2. EMA(50), the crosscheck: the trade must not fight a clearly falling (buys) or rising (sells) EMA, unless an RSI
 *    divergence confirms the reversal.
 */
export function confirmWithIndicators(p: { direction: 'LONG' | 'SHORT'; execution: 'LIMIT' | 'MARKET' }, ind: IndicatorRead): TradePlan['confirmation'] {
  const long = p.direction === 'LONG';
  const div = long ? ind.bullishDivergence : ind.bearishDivergence;
  let rsiOk = long ? ind.rsi < RSI_OVERBOUGHT : ind.rsi > RSI_OVERSOLD;
  let rsiNote = `RSI(14) ${ind.rsi}`;
  if (!rsiOk) rsiNote += long ? ' is overbought, price is running away from the demand zone' : ' is oversold, price is running away from the supply zone';
  else if (p.execution === 'MARKET' && !div && (long ? ind.rsi > 50 : ind.rsi < 50)) {
    rsiOk = false;
    rsiNote += long ? ' has not pulled back below 50 on this touch' : ' has not pushed above 50 on this touch';
  } else rsiNote += div ? `, ${long ? 'bullish' : 'bearish'} divergence confirms the turn` : long ? ', room to rise' : ', room to fall';
  const against = long ? ind.emaTrend === 'FALLING' : ind.emaTrend === 'RISING';
  const emaOk = ind.ema50 === null || !against || div;
  const emaNote =
    ind.ema50 === null
      ? 'EMA(50) needs more candles, skipped'
      : `EMA(50) ${ind.emaTrend.toLowerCase()}${against ? (div ? ', counter-trend but the RSI divergence confirms the reversal' : `, the trade fights it`) : ', agrees with the trade'}`;
  return { ok: rsiOk && emaOk, rsiOk, emaOk, divergence: div, note: `${rsiNote}; ${emaNote}` };
}

// ---------------------------------------------------------------------------
// 1-2. Supply & Demand zones with freshness
// ---------------------------------------------------------------------------
/** Zones are only taken from the most recent candles of the timeframe (the current price range), never old history. */
export const RECENT_ZONE_BARS = 120;
/** A zone further than this from price (in ATRs) is too far to trigger soon and is never signalled. */
export const MAX_ZONE_DISTANCE_ATR = 12;
/** A first touch that began within this many candles (the live candle or the one before) can be traded at market */
export const LIVE_TOUCH_BARS = 2;

function isBasing(c: Candle, atr: number) {
  return body(c) <= range(c) * 0.5 || range(c) <= atr * 0.7;
}

/** The zone's fair value gap was still open before the current first touch (price filling it on the way in is expected) */
export function fvgOpenBefore(z: SDZone): boolean {
  if (!z.fvg) return false;
  if (!z.fvg.filled) return true;
  return !!z.liveFirstTouch && z.touchStart !== undefined && z.fvg.filledAt !== undefined && z.fvg.filledAt >= z.touchStart;
}

export function detectZones(
  candles: Candle[],
  price: number,
  opts: { loose?: boolean } = {}
): { demand: SDZone[]; supply: SDZone[]; atr: number; swings: Swing[] } {
  // Daily forex (owner-specified): daily currency candles are calmer than intraday ones, so the leg-out and departure
  // bars are set a little lower there, or no daily zone ever qualifies
  const legBody = opts.loose ? 0.9 : 1.1;
  const legVsTypical = opts.loose ? 1.5 : 1.8;
  const minDeparture = opts.loose ? 1.2 : 1.5;
  const atrs = rollingAtr(candles);
  const atr = atrs[atrs.length - 1] || Math.abs(price) * 0.005;
  const swings = findSwings(candles);
  const zones: SDZone[] = [];
  const n = candles.length;

  const medianBody = (i: number) => {
    const xs = candles.slice(Math.max(0, i - 20), i).map(body).sort((x, y) => x - y);
    return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
  };

  // Most recent candles only: a zone must form inside the current range, not somewhere far back in history
  const firstRecent = Math.max(2, n - RECENT_ZONE_BARS);
  const recent = candles.slice(firstRecent - 2);
  const recentHigh = Math.max(...recent.map(c => c.h));
  const recentLow = Math.min(...recent.map(c => c.l));

  for (let i = firstRecent; i < n - 1; i++) {
    const leg = candles[i];
    const a = atrs[i - 1] || atr;
    const typical = medianBody(i);
    // Explosive leg-out: clearly larger than normal candles (imbalance), or two strong candles in the same direction
    const strongSingle = body(leg) >= a * legBody && body(leg) >= typical * legVsTypical && body(leg) >= range(leg) * 0.55;
    const next = candles[i + 1];
    const strongPair =
      !strongSingle &&
      body(leg) >= a * 0.6 &&
      !!next &&
      Math.sign(next.c - next.o) === Math.sign(leg.c - leg.o) &&
      Math.abs(next.c - leg.o) >= Math.max(a * 1.6, typical * 3);
    if (!strongSingle && !strongPair) continue;
    const up = bull(leg);
    if (!up && !bear(leg)) continue;

    // Base: up to 3 basing candles right before the leg-out, else the last opposite-colour candle (order block)
    let b = i - 1;
    const base: number[] = [];
    while (b >= 0 && base.length < 3 && isBasing(candles[b], atrs[b] || a)) {
      base.unshift(b);
      b--;
    }
    if (base.length === 0) {
      const prev = candles[i - 1];
      if ((up && bear(prev)) || (!up && bull(prev))) base.push(i - 1);
      else continue;
    }
    const baseCandles = base.map(k => candles[k]);
    const baseHigh = Math.max(...baseCandles.map(c => c.h));
    const baseLow = Math.min(...baseCandles.map(c => c.l));
    const legEnd = strongPair ? next : leg;

    // The leg-out must leave the base decisively
    if (up && legEnd.c <= baseHigh) continue;
    if (!up && legEnd.c >= baseLow) continue;

    const bodyTop = Math.max(...baseCandles.map(c => Math.max(c.o, c.c)));
    const bodyBottom = Math.min(...baseCandles.map(c => Math.min(c.o, c.c)));
    let proximal: number;
    let distal: number;
    if (up) {
      distal = Math.min(baseLow, leg.l);
      proximal = Math.max(bodyTop, distal + a * 0.15);
    } else {
      distal = Math.max(baseHigh, leg.h);
      proximal = Math.min(bodyBottom, distal - a * 0.15);
    }
    // Ignore zones too wide to trade with a sensible stop
    if (Math.abs(proximal - distal) > a * 2.5) continue;
    // The zone must sit inside the current price range
    if (Math.max(proximal, distal) < recentLow - atr * 0.5 || Math.min(proximal, distal) > recentHigh + atr * 0.5) continue;

    // Pattern: what came into the base (drop or rally) decides reversal vs continuation
    const before = candles[Math.max(0, base[0] - 1)];
    const cameFromDrop = before && before.c < before.o;
    const pattern: SDZone['pattern'] = up ? (cameFromDrop ? 'DBR' : 'RBR') : cameFromDrop ? 'DBD' : 'RBD';

    // Departure: how far price travelled away within the next 6 candles
    const after = candles.slice(i, Math.min(n, i + 7));
    const departure = up ? (Math.max(...after.map(c => c.h)) - proximal) / a : (proximal - Math.min(...after.map(c => c.l))) / a;
    if (departure < minDeparture) continue;

    // Break of structure: the move cleared the last swing on the other side
    const priorSwing = [...swings].reverse().find(s => s.i < base[0] && s.kind === (up ? 'H' : 'L'));
    const brokeStructure = priorSwing ? (up ? Math.max(...after.map(c => c.h)) > priorSwing.price : Math.min(...after.map(c => c.l)) < priorSwing.price) : false;

    // Fair value gap at the zone's doorstep: the first 3-candle imbalance of the leg-out
    // (bullish: candle k+1 low above candle k-1 high; bearish: candle k+1 high below candle k-1 low)
    let fvg: SDZone['fvg'] = null;
    for (let k = i; k <= i + (strongPair ? 2 : 1) && k + 1 < n; k++) {
      const c0 = candles[k - 1];
      const c2 = candles[k + 1];
      const gap = up ? (c2.l > c0.h ? { low: c0.h, high: c2.l } : null) : c2.h < c0.l ? { low: c2.h, high: c0.l } : null;
      if (!gap) continue;
      let filledAt: number | undefined;
      for (let j = k + 2; j < n; j++) {
        if (up ? candles[j].l <= gap.low : candles[j].h >= gap.high) {
          filledAt = j;
          break;
        }
      }
      fvg = filledAt === undefined ? { ...gap, filled: false } : { ...gap, filled: true, filledAt };
      break;
    }

    // Freshness: replay candles after the leg-out
    let tapCount = 0;
    let broken = false;
    let away = true;
    let touchStart = -1;
    for (let j = i + (strongPair ? 2 : 1); j < n; j++) {
      const c = candles[j];
      const touches = up ? c.l <= proximal : c.h >= proximal;
      if (touches && away) {
        tapCount++;
        touchStart = j;
      }
      away = !touches;
      if (up ? c.c < distal : c.c > distal) {
        broken = true;
        break;
      }
    }
    if (broken) continue;
    const insideNow = price >= Math.min(proximal, distal) && price <= Math.max(proximal, distal);
    // First touch in progress: never touched before, the touch began on the live candle (or the one before) and
    // price is still inside the zone. Such a zone can be entered at market; any earlier touch means mitigated.
    const liveFirstTouch = tapCount === 1 && !away && touchStart >= n - LIVE_TOUCH_BARS && insideNow;

    zones.push({
      ...(liveFirstTouch ? { liveFirstTouch, touchStart } : {}),
      freshFrom: i + (strongPair ? 2 : 1),
      freshFromTime: candles[Math.min(n - 1, i + (strongPair ? 2 : 1))].t,
      ageBars: n - 1 - base[0],
      kind: up ? 'DEMAND' : 'SUPPLY',
      pattern,
      proximal,
      distal,
      low: Math.min(proximal, distal),
      high: Math.max(proximal, distal),
      formedAt: candles[base[0]].t,
      baseIndex: base[0],
      legOutIndex: i,
      baseCandles: base.length,
      departureAtr: departure,
      brokeStructure,
      tapCount,
      fresh: tapCount === 0,
      score: 0,
      distanceAtr: 0,
      priceInside: insideNow,
      fvg,
    });
  }

  // Merge overlapping zones of the same kind (keep the stronger)
  const merged: SDZone[] = [];
  for (const z of zones.sort((x, y) => y.departureAtr - x.departureAtr)) {
    const overlap = merged.find(m => m.kind === z.kind && z.low <= m.high && z.high >= m.low);
    if (!overlap) merged.push(z);
  }

  const trend = trendFromSwings(swings);
  for (const z of merged) {
    z.distanceAtr = z.priceInside ? 0 : Math.abs(price - z.proximal) / atr;
    let s = 40;
    s += Math.min(z.departureAtr, 5) * 6; // up to +30 for explosive departure
    s += z.tapCount === 0 || z.liveFirstTouch ? 14 : z.tapCount === 1 ? 4 : -12; // fresh zones hold best (a first touch in progress is still fresh)
    s += z.brokeStructure ? 8 : 0;
    s += z.fvg ? (fvgOpenBefore(z) ? 6 : 0) : -8; // an open imbalance at the zone proves institutional displacement
    s += z.baseCandles === 1 ? 6 : z.baseCandles === 2 ? 3 : 0; // less time at base = more imbalance
    s += z.pattern === 'DBR' || z.pattern === 'RBD' ? 4 : 2; // reversal zones slightly stronger
    if ((z.kind === 'DEMAND' && trend === 'BULLISH') || (z.kind === 'SUPPLY' && trend === 'BEARISH')) s += 8;
    if ((z.kind === 'DEMAND' && trend === 'BEARISH') || (z.kind === 'SUPPLY' && trend === 'BULLISH')) s -= 6;
    s -= Math.max(0, z.distanceAtr - 6) * 2; // far-away zones are less actionable
    s += Math.round(6 * (1 - Math.min(1, z.ageBars / RECENT_ZONE_BARS))); // the most recent zones reflect current order flow
    z.score = Math.max(0, Math.min(100, Math.round(s)));
  }

  const demand = merged
    .filter(z => z.kind === 'DEMAND' && (z.proximal < price || z.priceInside))
    .sort((a2, b2) => b2.score - a2.score);
  const supply = merged
    .filter(z => z.kind === 'SUPPLY' && (z.proximal > price || z.priceInside))
    .sort((a2, b2) => b2.score - a2.score);
  return { demand, supply, atr, swings };
}

// ---------------------------------------------------------------------------
// 3. Fibonacci + trade plan
// ---------------------------------------------------------------------------
const FIB_RATIOS: Array<[number, string]> = [
  [0, '0.0% (Impulse Extreme)'],
  [0.236, '23.6% Retracement'],
  [0.382, '38.2% Retracement'],
  [0.5, '50.0% Equilibrium'],
  [0.618, '61.8% Golden Pocket'],
  [0.786, '78.6% Deep Retracement'],
  [1, '100.0% (Swing Origin)'],
];

interface Leg {
  from: number; // 100% (leg origin)
  to: number; // 0% (leg extreme)
  fromIndex: number;
  toIndex: number;
}

/**
 * The swing leg the Fibonacci is drawn on. For buys: the lowest low before the highest high of the
 * lookback (price is pulling back from that high). For sells: the highest high before the lowest low.
 * A leg is only valid while price has not broken its origin.
 */
function currentLeg(candles: Candle[], long: boolean, price: number, lookback = 150): Leg | null {
  const start = Math.max(0, candles.length - lookback);
  let ext = start;
  for (let i = start; i < candles.length; i++) {
    if (long ? candles[i].h > candles[ext].h : candles[i].l < candles[ext].l) ext = i;
  }
  if (ext === start) return null;
  let org = start;
  for (let i = start; i < ext; i++) {
    if (long ? candles[i].l < candles[org].l : candles[i].h > candles[org].h) org = i;
  }
  const from = long ? candles[org].l : candles[org].h;
  const to = long ? candles[ext].h : candles[ext].l;
  if (long ? price <= from : price >= from) return null;
  return { from, to, fromIndex: org, toIndex: ext };
}

/** Latest 24h high/low from the live quote, used to catch taps the candle feed may not show yet */
export interface SessionRange {
  high: number;
  low: number;
  /** Start of the 24h window (ms) */
  since: number;
}

export function planForZone(
  z: SDZone,
  candles: Candle[],
  price: number,
  atr: number,
  opposing: SDZone[],
  slMode: 'normal' | 'tight',
  dec: number,
  session?: SessionRange | null
): TradePlan | null {
  const long = z.kind === 'DEMAND';
  // Fibonacci on the current swing leg when the zone sits inside it; otherwise on the impulse the zone created
  const leg = currentLeg(candles, long, price);
  let from: number;
  let to: number;
  let extIndex: number; // candle of the impulse extreme — the pullback toward the entry starts after it
  if (leg && z.baseIndex >= leg.fromIndex - 2 && (long ? z.distal >= leg.from - atr * 0.5 : z.distal <= leg.from + atr * 0.5)) {
    from = long ? Math.min(leg.from, z.distal) : Math.max(leg.from, z.distal);
    to = leg.to;
    extIndex = leg.toIndex;
  } else {
    const since = candles.slice(z.legOutIndex);
    from = z.distal;
    to = long ? Math.max(...since.map(c => c.h)) : Math.min(...since.map(c => c.l));
    extIndex = z.legOutIndex + since.findIndex(c => (long ? c.h : c.l) === to);
  }
  const diff = Math.abs(to - from);
  if (diff < atr * 1.5) return null;

  const lvl = (r: number) => (long ? to - diff * r : to + diff * r);
  const ratioOf = (p: number) => (long ? (to - p) / diff : (p - to) / diff);
  const round = (p: number) => Number(p.toFixed(dec));
  const fib: FibLevel[] = FIB_RATIOS.map(([ratio, label]) => ({
    ratio,
    label,
    price: round(lvl(ratio)),
    isKey: ratio === 0.5 || ratio === 0.618,
    ...(ratio === 0.618 ? { description: 'Golden pocket entry confluence' } : {}),
  }));
  const gp = { from: round(lvl(0.618)), to: round(lvl(0.705)) };

  // Where does the zone sit on the retracement? (0 = extreme, 1 = origin)
  const rNear = ratioOf(z.proximal);
  const rFar = ratioOf(z.distal);
  const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.max(a1, b1) <= Math.min(a2, b2);
  let confluence: TradePlan['confluence'];
  let band: [number, number] | null = null;
  let goldenPocketNear = false;
  if (overlap(rNear, rFar, 0.618, 0.705)) {
    confluence = 'GOLDEN_POCKET_IN_ZONE';
    band = [Math.max(rNear, 0.618), Math.min(rFar, 0.705)];
  } else if (
    // The golden pocket sits just outside the zone: within 0.3% of price still counts as golden pocket confluence
    Math.max(Math.min(gp.from, gp.to) - z.high, z.low - Math.max(gp.from, gp.to), 0) <= price * 0.003
  ) {
    confluence = 'GOLDEN_POCKET_IN_ZONE';
    goldenPocketNear = true;
  } else if (overlap(rNear, rFar, 0.5, 0.786)) {
    confluence = 'FIB_BAND_OVERLAP';
    band = [Math.max(rNear, 0.5), Math.min(rFar, 0.786)];
  } else if (rFar >= 0.9) {
    confluence = 'LEG_ORIGIN';
  } else {
    confluence = 'ZONE_ONLY';
  }

  let optimal: number;
  let eMin: number;
  let eMax: number;
  if (band) {
    const p1 = lvl(band[0]);
    const p2 = lvl(band[1]);
    eMin = Math.min(p1, p2);
    eMax = Math.max(p1, p2);
    optimal = confluence === 'GOLDEN_POCKET_IN_ZONE' ? (p1 + p2) / 2 : long ? eMax - (eMax - eMin) * 0.4 : eMin + (eMax - eMin) * 0.4;
  } else if (goldenPocketNear) {
    // Enter at the zone edge nearest the golden pocket
    eMin = z.low;
    eMax = z.high;
    const gpMid = (gp.from + gp.to) / 2;
    optimal = Math.abs(gpMid - z.high) < Math.abs(gpMid - z.low) ? z.high - (z.high - z.low) * 0.1 : z.low + (z.high - z.low) * 0.1;
  } else {
    eMin = z.low;
    eMax = z.high;
    optimal = long ? z.proximal - (z.high - z.low) * 0.25 : z.proximal + (z.high - z.low) * 0.25;
  }

  // Instant (market) execution: price is making the zone's FIRST touch right now and sits at or beyond the leg's
  // 0.50 (discount for buys, premium for sells), so the entry is the current price instead of a pending order
  const instant = !!z.liveFirstTouch && z.priceInside && ratioOf(price) >= 0.5;
  if (instant) {
    const pad = Math.min(atr * 0.1, (z.high - z.low) * 0.25);
    optimal = price;
    eMin = long ? Math.max(z.low, price - pad) : price;
    eMax = long ? price : Math.min(z.high, price + pad);
  } else {
    // A limit entry must still be ahead of price (or price is sitting in the zone right now)
    if (!z.priceInside && (long ? optimal >= price : optimal <= price)) return null;
    if (z.priceInside) optimal = long ? Math.min(optimal, price) : Math.max(optimal, price);
    eMin = Math.min(eMin, optimal);
    eMax = Math.max(eMax, optimal);
  }

  // Stop beyond the zone's distal line (the invalidation: price trading through it means the zone failed), owner-specified:
  // Normal SL: breathing space past the invalidation, 0.3 ATR beyond the distal line and >= 1 ATR risk, so a wick
  //   through the zone edge doesn't stop the trade out.
  // Tight SL: works with each zone found on its own timeframe, just past the distal line (0.08 ATR, the timeframe's
  //   own ATR) with only the smallest valid floor (>= 0.5 ATR risk, the same floor as Tighten SL), so the stop follows the zone.
  // Either way the stop also sits beyond the far edge of the entry band.
  const tight = slMode === 'tight';
  const buffer = atr * (tight ? 0.08 : 0.3);
  let stop = long ? Math.min(z.distal, eMin) - buffer : Math.max(z.distal, eMax) + buffer;
  // Never risk less than a fraction of the ATR (normal keeps a full ATR of room to breathe)
  const minRisk = atr * (tight ? 0.5 : 1.0);
  if (Math.abs(optimal - stop) < minRisk) stop = long ? optimal - minRisk : optimal + minRisk;
  const risk = Math.abs(optimal - stop);
  if (risk <= 0) return null;

  // Targets (realistic ladder): 0.382 retracement (first reaction), the swing extreme (Fib 0.0 liquidity),
  // then the -0.272 extension. An opposing fresh zone caps the ladder if price meets it first.
  const opp = opposing
    .filter(o => (long ? o.proximal > optimal : o.proximal < optimal))
    .sort((a2, b2) => (long ? a2.proximal - b2.proximal : b2.proximal - a2.proximal))[0];
  const ladder: Array<{ label: string; price: number }> = [
    { label: 'Fib 0.382 retracement', price: lvl(0.382) },
    { label: `Swing ${long ? 'high' : 'low'} liquidity (Fib 0.0)`, price: to },
    { label: 'Fib extension -0.272', price: long ? to + diff * 0.272 : to - diff * 0.272 },
  ];
  const candidates = opp
    ? [...ladder.filter(c => (long ? c.price < opp.proximal : c.price > opp.proximal)), { label: `Opposing ${opp.kind === 'SUPPLY' ? 'supply' : 'demand'} zone`, price: opp.proximal }]
    : ladder;
  // Every target must sit ahead of the entry AND ahead of current price (a target behind price has already been reached)
  const ordered = candidates
    .filter(c => (long ? c.price > optimal && c.price > price : c.price < optimal && c.price < price))
    .sort((a2, b2) => (long ? a2.price - b2.price : b2.price - a2.price));

  const rr = (p: number) => Math.abs(p - optimal) / risk;
  const targets: TradePlan['targets'] = [];
  for (const c of ordered) {
    const r = rr(c.price);
    const prev = targets[targets.length - 1];
    if (targets.length === 0 && r < 1) continue; // TP1 at least 1R
    if (prev && r - prev.rr < 0.5) continue; // keep targets meaningfully spaced
    targets.push({ label: c.label, price: round(c.price), rr: Number(r.toFixed(2)) });
    if (targets.length === 3) break;
  }
  if (targets.length === 0) return null;
  while (targets.length < 3) {
    const last = targets[targets.length - 1];
    // (extensions continue beyond the last target, so they stay ahead of price too)
    const p = long ? last.price + risk * 1.5 : last.price - risk * 1.5;
    targets.push({ label: 'Measured extension', price: round(p), rr: Number(rr(p).toFixed(2)) });
  }
  const rrFinal = targets[targets.length - 1].rr;

  let score = z.score;
  score += confluence === 'GOLDEN_POCKET_IN_ZONE' ? 12 : confluence === 'FIB_BAND_OVERLAP' ? 6 : confluence === 'LEG_ORIGIN' ? 0 : -12;
  score += rrFinal >= 4 ? 4 : rrFinal >= 2.5 ? 0 : -15;
  score += Math.max(0, 6 - z.distanceAtr); // closer = more likely to trigger soon
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Mitigation check (strict, every timeframe): replay every candle since the zone formed. The setup is only clean
  // if price has never re-entered the zone, never touched the entry band, never reached the stop loss, and, once the
  // entry was touched, never reached any target. Anything else means the move has already played out.
  const mitigation: string[] = [];
  const when = (c: Candle) => new Date(c.t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const entryEdge = long ? eMax : eMin; // the side of the entry band price reaches first
  if (instant) {
    // The first touch is happening now: that is the entry itself, not a mitigation
  } else if (z.tapCount > 0) mitigation.push(`the ${long ? 'demand' : 'supply'} zone was already tapped ${z.tapCount}x since it formed (price entered it and returned)`);
  else if (z.priceInside) mitigation.push(`price is trading inside the ${long ? 'demand' : 'supply'} zone right now`);
  // The live 24h range can show a tap the candle feed has not printed yet. Only used when the window opens after the
  // zone's leg-out, so the displacement candles themselves are never mistaken for a tap.
  const legOutDone = candles[Math.min(candles.length - 1, z.freshFrom)];
  if (session && legOutDone.t < session.since) {
    const extreme = long ? session.low : session.high;
    if (instant) {
      // Only the stop matters: the zone and entry are being touched right now
    } else if (z.tapCount === 0 && !z.priceInside && (long ? extreme <= z.proximal : extreme >= z.proximal))
      mitigation.push(`the 24h ${long ? 'low' : 'high'} ${round(extreme)} already traded into the zone`);
    else if (long ? extreme <= entryEdge : extreme >= entryEdge)
      mitigation.push(`the 24h ${long ? 'low' : 'high'} ${round(extreme)} already reached the entry ${round(entryEdge)}`);
    if (long ? extreme <= stop : extreme >= stop) mitigation.push(`the 24h ${long ? 'low' : 'high'} ${round(extreme)} already reached the stop-loss level ${round(stop)}`);
  }
  let entryTap: Candle | null = null;
  let stopHit = false;
  const tpHit = new Set<number>();
  for (let j = Math.max(z.freshFrom, 0); j < candles.length; j++) {
    const c = candles[j];
    if (!stopHit && (long ? c.l <= stop : c.h >= stop)) {
      stopHit = true;
      mitigation.push(`the stop-loss level ${round(stop)} was already hit (${when(c)})`);
    }
    // For a market entry the live touch is the fill; only candles before it could have tapped the entry earlier
    if (!entryTap && !(instant && j >= (z.touchStart ?? candles.length)) && (long ? c.l <= entryEdge : c.h >= entryEdge)) {
      entryTap = c;
      mitigation.push(`the entry ${round(entryEdge)} was already tapped (${when(c)})`);
      continue; // targets count from the next candle after the entry fill
    }
    if (entryTap) {
      targets.forEach((t, k) => {
        if (!tpHit.has(k) && (long ? c.h >= t.price : c.l <= t.price)) {
          tpHit.add(k);
          mitigation.push(`TP${k + 1} ${t.price} was then reached (${when(c)})`);
        }
      });
    }
  }
  // Every target must still be ahead of live price (a smashed target means the move already happened)
  targets.forEach((t, k) => {
    if (!tpHit.has(k) && (long ? price >= t.price : price <= t.price)) mitigation.push(`TP${k + 1} ${t.price} has already been reached by price`);
  });

  // Proximity guard (strict, every timeframe): a fresh trade needs price well away from TP1 and the stop loss.
  let moved: TradePlan['moved'] = null;
  const tp1 = targets[0].price;
  const toTp1 = long ? tp1 - price : price - tp1;
  const span = Math.abs(tp1 - optimal);
  const progress = span > 0 ? 1 - toTp1 / span : 1; // 0 = price at the entry, 1 = price at TP1
  const toStop = Math.abs(price - stop);
  if (toStop < Math.max(risk * 0.5, atr * 0.5)) {
    moved = { kind: 'NEAR_SL', text: `price ${round(price)} is already close to the stop loss ${round(stop)}` };
  } else if (toTp1 > 0 && (progress >= 0.5 || toTp1 < Math.max(atr * 1.5, risk))) {
    // TP1 must sit far ahead of live price: at least 1.5 ATR and one full risk unit away, with price nearer the entry
    moved = {
      kind: 'NEAR_TP',
      text: `price ${round(price)} has already moved ${Math.round(Math.min(progress, 0.99) * 100)}% of the way from the entry ${round(optimal)} to TP1 ${round(tp1)} and is close to TP1`,
    };
  } else if (!instant) {
    // Price turned just short of the entry after the pullback and has since left the zone: the reaction already happened
    let nearest = long ? Infinity : -Infinity;
    for (let j = Math.max(extIndex + 1, z.freshFrom, 0); j < candles.length; j++) nearest = long ? Math.min(nearest, candles[j].l) : Math.max(nearest, candles[j].h);
    const gap = long ? nearest - entryEdge : entryEdge - nearest;
    const away = long ? price - nearest : nearest - price;
    if (Number.isFinite(nearest) && gap > 0 && gap <= atr * 0.25 && away >= atr) {
      moved = { kind: 'LEFT_ZONE', text: `price already turned at ${round(nearest)}, just ${long ? 'above' : 'below'} the entry ${round(entryEdge)}, and has left the zone` };
    }
  }

  return {
    execution: instant ? 'MARKET' : 'LIMIT',
    moved,
    mitigation,
    legEquilibrium: round(lvl(0.5)),
    inTerritory: rNear >= 0.5,
    ...(goldenPocketNear ? { goldenPocketNear } : {}),
    direction: long ? 'LONG' : 'SHORT',
    zone: z,
    impulseFrom: round(from),
    impulseTo: round(to),
    fib,
    goldenPocket: gp,
    confluence,
    entry: { min: round(eMin), max: round(eMax), optimal: round(optimal) },
    stopLoss: round(stop),
    targets,
    rrFinal,
    score,
  };
}

/**
 * Setup quality (owner-specified: the score must reflect real setup quality). Built from what actually separated winners
 * from losers in MarketX's walk-forward back-tests on real history: the market/timeframe's own record, trading with the
 * swing trend, a young zone, a 2-3 candle base, a normal-volatility market, a zone near price, a mid-width zone and a calm
 * departure. Returns the expected R per trade of similar setups and a 0-100 grade (back-tested bands: the top fifth
 * averaged about +2.5R per trade at a ~40% win rate, the bottom fifth about breakeven).
 */
export function setupQuality(
  p: TradePlan,
  ctx: { trend: MarketMap['trend']; atr: number; volatilityPct: number; symbol?: string; timeframe: string }
): { quality: number; expectR: number } {
  const z = p.zone;
  const long = p.direction === 'LONG';
  let e = 0.5 * priorR(ctx.symbol, ctx.timeframe) + 0.5 * AVERAGE_R;
  e += (ctx.trend === 'BULLISH' && long) || (ctx.trend === 'BEARISH' && !long) ? 0.25 : ctx.trend === 'RANGING' ? 0 : -0.2;
  e += z.ageBars < 20 ? 0.3 : z.ageBars >= 50 ? -0.45 : -0.05;
  e += z.baseCandles === 1 ? -0.3 : z.baseCandles === 2 ? 0.5 : 0.15;
  e += ctx.volatilityPct >= 0.67 ? -0.35 : ctx.volatilityPct >= 0.34 ? 0.3 : 0.05;
  e += z.distanceAtr === 0 ? -0.5 : z.distanceAtr >= 5 ? -1.3 : z.distanceAtr >= 2 ? 0.35 : 0.05;
  const width = ctx.atr > 0 ? (z.high - z.low) / ctx.atr : 1;
  e += width < 0.6 ? -0.2 : width < 1.2 ? 0.25 : -0.35;
  e += p.confluence === 'FIB_BAND_OVERLAP' ? -0.4 : p.confluence === 'LEG_ORIGIN' ? 0.2 : 0;
  e += p.confirmation?.divergence ? -0.55 : 0;
  e += z.departureAtr < 2.5 ? 0.5 : z.departureAtr < 4 ? 0.15 : z.departureAtr < 6 ? -0.5 : 0;
  // Expected R → 0-100 (band edges from the back-test: 0.10 / 0.68 / 1.15 / 1.71)
  const pts: Array<[number, number]> = [[-0.6, 30], [0.1, 45], [0.68, 58], [1.15, 68], [1.71, 78], [3.0, 95]];
  let q = e <= pts[0][0] ? pts[0][1] : pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    if (e <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      q = y0 + ((e - x0) / (x1 - x0)) * (y1 - y0);
      break;
    }
  }
  return { quality: Math.round(Math.max(20, Math.min(95, q))), expectR: Number(e.toFixed(2)) };
}
/** Signals need at least this quality: below it, similar setups averaged about breakeven in the back-tests */
const qualityFloor = Number(process.env.MIN_SIGNAL_QUALITY);
export const MIN_SIGNAL_QUALITY = process.env.MIN_SIGNAL_QUALITY && Number.isFinite(qualityFloor) ? Math.max(0, Math.min(95, qualityFloor)) : 45;

/** Where the latest ATR sits among the last 200 candles' ATRs (0 = calmest, 1 = hottest) */
export function volatilityPercentile(candles: Candle[]): number {
  const atrs = rollingAtr(candles);
  const w = atrs.slice(-200).filter(v => Number.isFinite(v) && v > 0);
  const now = atrs[atrs.length - 1];
  return w.length ? w.filter(v => v <= now).length / w.length : 0.5;
}

export function buildMarketMap(
  candles: Candle[],
  opts: {
    price?: number;
    timeframe: string;
    slMode?: 'normal' | 'tight';
    prefer?: 'LONG' | 'SHORT' | null;
    jpy?: boolean;
    forex?: boolean;
    /** Live 24h high/low (checked for taps the candles may not show yet) */
    session?: SessionRange | null;
    /** The market (for its back-tested record: switched-off combinations, heads-ups, the quality prior) */
    symbol?: string;
    /** 'crypto' / 'forex' / … (Tight SL is not used on crypto) */
    assetType?: string;
  }
): MarketMap | null {
  const clean = candles.filter(c => [c.o, c.h, c.l, c.c].every(v => Number.isFinite(v) && v > 0) && c.h >= c.l);
  if (clean.length < 40) return null;
  const lastClose = clean[clean.length - 1].c;
  const price = opts.price && opts.price > 0 && Math.abs(opts.price - lastClose) / lastClose < 0.2 ? opts.price : lastClose;
  const dec = priceDecimals(price, opts.jpy, opts.forex);
  // Tight SL (owner-specified, from the back-tests): not used on daily/weekly charts or crypto, where normal swings stop it
  // out too often; Normal SL is used instead and the result says so
  let slMode: 'normal' | 'tight' = opts.slMode === 'tight' ? 'tight' : 'normal';
  let slNote: string | undefined;
  if (slMode === 'tight' && (opts.timeframe === '1D' || opts.timeframe === '1W' || isCryptoSymbol(opts.symbol, opts.assetType))) {
    slMode = 'normal';
    slNote = `Tight SL isn't used ${opts.timeframe === '1D' || opts.timeframe === '1W' ? `on the ${opts.timeframe} chart` : 'on crypto'}: in our back-tests its stop was hit by normal swings too often there, so this plan uses Normal SL.`;
  }
  const looseZones = !!opts.forex && (opts.timeframe === '1D' || opts.timeframe === '1W');
  const { demand, supply, atr, swings } = detectZones(clean, price, { loose: looseZones });
  const volatilityPct = volatilityPercentile(clean);
  const trend = trendFromSwings(swings);
  const lookback = clean.slice(-120);
  const swingHigh = Math.max(...lookback.map(c => c.h));
  const swingLow = Math.min(...lookback.map(c => c.l));
  // Dealing range equilibrium (0.50): demand must sit in discount below it, supply in premium above it
  const equilibrium = (swingHigh + swingLow) / 2;
  for (const z of [...demand, ...supply]) z.territory = z.proximal <= equilibrium ? 'DISCOUNT' : 'PREMIUM';
  const rightTerritory = (p: TradePlan) =>
    p.inTerritory && (p.direction === 'LONG' ? p.zone.territory === 'DISCOUNT' : p.zone.territory === 'PREMIUM');

  // Trust the live 24h range only when it is consistent with price and with the candles' own last-24h range
  // (a stale or placeholder quote must never mark a fresh zone as tapped)
  let session: SessionRange | null = null;
  const sr = opts.session;
  if (sr && sr.high > 0 && sr.low > 0 && sr.high >= sr.low && price >= sr.low && price <= sr.high) {
    const recent = clean.filter(c => c.t >= sr.since);
    const tol = price * 0.015;
    const agrees = recent.length
      ? Math.abs(Math.min(...recent.map(c => c.l)) - sr.low) <= tol && Math.abs(Math.max(...recent.map(c => c.h)) - sr.high) <= tol
      : false;
    if (agrees) session = sr;
  }
  const allLongs = demand.map(z => planForZone(z, clean, price, atr, supply, slMode, dec, session)).filter(Boolean) as TradePlan[];
  const allShorts = supply.map(z => planForZone(z, clean, price, atr, demand, slMode, dec, session)).filter(Boolean) as TradePlan[];
  const indicators = readIndicators(clean, swings, atr);
  for (const p of [...allLongs, ...allShorts]) {
    p.confirmation = confirmWithIndicators(p, indicators);
    // An RSI divergence in the trade's favour is the strongest leading confirmation
    if (p.confirmation.divergence) p.score = Math.min(100, p.score + 5);
    Object.assign(p, setupQuality(p, { trend, atr, volatilityPct, symbol: opts.symbol, timeframe: opts.timeframe }));
    // Stricter market entries (owner-specified, from the back-tests: market entries earned less than half of limit
    // entries, worst in fast markets and deep inside the zone): enter at market only in a normal or calm market, with
    // price still in the zone's outer half (the first touch, not a deep push into it)
    if (p.execution === 'MARKET') {
      const z = p.zone;
      const w = z.high - z.low;
      const outer = w > 0 ? (p.direction === 'LONG' ? (price - z.low) / w : (z.high - price) / w) : 1;
      if (volatilityPct >= 0.67) p.marketBlocked = 'the market is moving too fast right now for a safe market entry';
      else if (outer < 0.5) p.marketBlocked = 'price has already pushed deep into the zone, so the first-touch entry has passed';
    }
  }
  // Only clean setups can become signals: fresh zone, entry / stop / targets never tapped for this setup, price still
  // well away from TP1 and the stop, the RSI / EMA crosscheck passed, a market entry passed its stricter rules, and the
  // setup's back-tested quality clears the minimum
  const ready = (p: TradePlan) =>
    p.mitigation.length === 0 && !p.moved && !!p.confirmation?.ok && !p.marketBlocked && (p.quality ?? 100) >= MIN_SIGNAL_QUALITY;
  const longs = allLongs.filter(ready);
  const shorts = allShorts.filter(ready);
  // Ranked by quality (what the back-tests say pays), then the zone score
  const rank = (a: TradePlan, b: TradePlan) => (b.quality ?? 0) - (a.quality ?? 0) || b.score - a.score;
  const bestLong = longs.sort(rank)[0] || null;
  const bestShort = shorts.sort(rank)[0] || null;

  // A signal needs a Fibonacci-confirmed entry, a strong zone within reach and at least 1:2.5 to the final target.
  // A deep retest of the leg's origin (Fib 100%) only counts when the zone is fresh and very strong.
  const qualifiesIgnoringMitigation = (p: TradePlan | null) =>
    !!p &&
    rightTerritory(p) &&
    p.confluence !== 'ZONE_ONLY' &&
    (p.confluence !== 'LEG_ORIGIN' || ((p.zone.fresh || p.execution === 'MARKET') && p.score >= 80)) &&
    // Institutional displacement: an unfilled fair value gap at the zone's doorstep
    fvgOpenBefore(p.zone) &&
    // Counter-trend trades must clear a much higher bar
    p.score >= ((trend === 'BULLISH' && p.direction === 'SHORT') || (trend === 'BEARISH' && p.direction === 'LONG') ? 82 : 70) &&
    p.zone.distanceAtr <= MAX_ZONE_DISTANCE_ATR &&
    p.rrFinal >= 2.5;
  const qualifies = (p: TradePlan | null) => qualifiesIgnoringMitigation(p) && ready(p!);
  let plan: TradePlan | null = null;
  let alternate: TradePlan | null = null;
  const preferred = opts.prefer === 'LONG' ? bestLong : opts.prefer === 'SHORT' ? bestShort : null;
  if (qualifies(preferred)) {
    plan = preferred;
    alternate = preferred === bestLong ? (qualifies(bestShort) ? bestShort : null) : qualifies(bestLong) ? bestLong : null;
  } else {
    const ranked = ([bestLong, bestShort].filter(qualifies) as TradePlan[]).sort(rank);
    plan = ranked[0] || null;
    alternate = ranked[1] || null;
  }

  let noSignalReason: string | undefined;
  let mitigatedSetup: TradePlan | null = null;
  let movedSetup: TradePlan | null = null;
  let unconfirmed: TradePlan | null = null;
  if (!plan) {
    // A clean, valid setup that price has already moved away from (close to TP1 or the stop): flag it as already moved
    const all = [...allLongs, ...allShorts].sort((a, b) => b.score - a.score);
    movedSetup = all.find(p => p.mitigation.length === 0 && p.moved && qualifiesIgnoringMitigation(p)) || null;
    unconfirmed = all.find(p => p.mitigation.length === 0 && !p.moved && !p.confirmation?.ok && qualifiesIgnoringMitigation(p)) || null;
  }
  // A clean setup held back only by the stricter market-entry rules or by its quality: say so plainly
  const heldBack =
    !plan && !movedSetup && !unconfirmed
      ? [...allLongs, ...allShorts].find(p => p.mitigation.length === 0 && !p.moved && !!p.confirmation?.ok && qualifiesIgnoringMitigation(p))
      : undefined;
  // Setups whose levels are untouched (quality, not proximity or indicators, decides the reason below)
  const untouched = [...allLongs, ...allShorts].filter(p => p.mitigation.length === 0);
  if (!plan && !movedSetup && !unconfirmed) {
    // The best setup would have qualified, but its levels were already tapped: say so explicitly
    // Prefer a setup that would otherwise have been a signal, then any Fibonacci-confirmed one, then any tapped setup
    const mitigated = [...allLongs, ...allShorts].filter(p => p.mitigation.length > 0).sort((a, b) => b.score - a.score);
    mitigatedSetup =
      mitigated.find(p => qualifiesIgnoringMitigation(p)) ||
      mitigated.find(p => p.confluence !== 'ZONE_ONLY' && p.rrFinal >= 2.5) ||
      mitigated[0] ||
      null;
  }
  const zoneText = (m: TradePlan) => `${m.direction === 'LONG' ? 'buy' : 'sell'} setup from the fresh ${m.zone.kind === 'DEMAND' ? 'demand' : 'supply'} zone ${m.zone.low.toFixed(dec)} to ${m.zone.high.toFixed(dec)}`;
  if (!plan && movedSetup) {
    const m = movedSetup;
    const label = m.moved!.kind === 'NEAR_SL' ? 'already moved, close to the stop loss' : 'already moved, close to TP';
    noSignalReason = `No signal, ${label}. The ${zoneText(m)} is valid, but ${m.moved!.text}, so it is no longer a fresh entry. Wait for a new, untouched zone.`;
  } else if (!plan && heldBack?.marketBlocked) {
    noSignalReason = `No signal. Price is on the first touch of the ${zoneText(heldBack)}, but ${heldBack.marketBlocked}. MarketX only enters at market in a calm market at the zone's edge; wait for the next clean setup.`;
  } else if (!plan && heldBack && (heldBack.quality ?? 100) < MIN_SIGNAL_QUALITY) {
    noSignalReason = `No signal. The ${zoneText(heldBack)} is valid, but its setup quality (${heldBack.quality}/100) is below what MarketX calls: setups like it have broken even at best in our back-tests. Wait for a stronger one.`;
  } else if (!plan && unconfirmed) {
    noSignalReason = `No signal. The ${zoneText(unconfirmed)} failed the indicator crosscheck: ${unconfirmed.confirmation!.note}. Stand aside until the indicators confirm a fresh zone.`;
  } else if (!plan && mitigatedSetup) {
    const m = mitigatedSetup;
    noSignalReason = `No signal, already mitigated. The ${m.direction === 'LONG' ? 'buy' : 'sell'} setup from the ${
      m.zone.kind === 'DEMAND' ? 'demand' : 'supply'
    } zone ${m.zone.low.toFixed(dec)} to ${m.zone.high.toFixed(dec)} is no longer fresh: ${m.mitigation.join('; ')}. No other fresh, untouched zone offers a valid setup right now.`;
  } else if (!plan) {
    if (!demand.length && !supply.length) noSignalReason = 'No signal. No fresh, unbroken institutional supply or demand zone is in play on this timeframe.';
    else if ([...demand, ...supply].every(z => z.tapCount >= 1))
      noSignalReason = 'No signal. Every zone in play has already been tapped since it formed, so none is fresh; wait for a new, untouched zone.';
    else if (!untouched.length) noSignalReason = 'No signal. Fresh zones exist, but none leaves room for a clean Fibonacci entry ahead of price with a valid stop.';
    else if (!untouched.some(rightTerritory))
      noSignalReason = 'No signal. The fresh zones sit on the wrong side of the 0.50 equilibrium (demand in premium or supply in discount), so there is no institutional-value entry right now.';
    else if (!untouched.some(p => fvgOpenBefore(p.zone)))
      noSignalReason = 'No signal. The fresh zones have no open fair value gap at their doorstep, so institutional displacement is not confirmed; wait for a cleaner zone.';
    else noSignalReason = 'No signal. The fresh zones lack golden-pocket confluence, are too far from price, or do not pay at least 1:2.5, so there is no high-probability edge right now.';
  }

  // Back-tested record of this market/timeframe (owner-specified): switched-off combinations give no signal, weaker
  // ones carry a heads-up
  const edge = normalEdge(opts.symbol, opts.timeframe);
  let edgeNote: string | undefined;
  if (edge.off) {
    plan = null;
    alternate = null;
    movedSetup = null;
    mitigatedSetup = null;
    noSignalReason = edge.text;
  } else edgeNote = (edge as { off: false; note?: string }).note;

  return {
    ...(opts.symbol ? { symbol: opts.symbol } : {}),
    ...(edgeNote && plan ? { edgeNote } : {}),
    ...(slNote ? { slNote } : {}),
    volatilityPct: Number(volatilityPct.toFixed(2)),
    timeframe: opts.timeframe,
    candles: clean.length,
    lastClose,
    price,
    atr,
    trend,
    swingHigh: Number(swingHigh.toFixed(dec)),
    swingLow: Number(swingLow.toFixed(dec)),
    equilibrium: Number(equilibrium.toFixed(dec)),
    demandZones: demand.slice(0, 4),
    supplyZones: supply.slice(0, 4),
    plan,
    alternate,
    // The confidence shown is the setup's back-tested quality (owner-specified), not the zone score
    confidence: plan ? plan.quality ?? Math.max(55, Math.min(92, plan.score)) : 50,
    noSignalReason,
    mitigatedSetup,
    movedSetup,
    indicators,
    decimals: dec,
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------
const PATTERN_NAME: Record<SDZone['pattern'], string> = {
  DBR: 'Drop-Base-Rally',
  RBR: 'Rally-Base-Rally',
  RBD: 'Rally-Base-Drop',
  DBD: 'Drop-Base-Drop',
};

const grouped = (p: number, dec: number) => p.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

export function describeZone(z: SDZone, dec: number, pretty = false): string {
  const f = (p: number) => (pretty ? grouped(p, dec) : p.toFixed(dec));
  const state = z.liveFirstTouch ? 'first touch in progress now' : z.priceInside ? 'price is inside it now' : z.fresh ? 'fresh, untouched' : `tapped ${z.tapCount}x and held`;
  return `${z.kind} ${f(z.low)} – ${f(z.high)} (${PATTERN_NAME[z.pattern]}${z.territory ? `, ${z.territory.toLowerCase()}` : ''}, proximal ${f(z.proximal)}, distal ${f(z.distal)}, ${state}, departure ${z.departureAtr.toFixed(1)} ATR${
    z.brokeStructure ? ', broke structure' : ''
  }${z.fvg ? `, FVG ${f(z.fvg.low)} to ${f(z.fvg.high)} ${fvgOpenBefore(z) ? (z.fvg.filled ? 'open until this touch' : 'open') : 'filled'}` : ', no FVG'}, score ${z.score}/100)`;
}

/** Compact, factual block for the AI prompt. */
export interface PoiItem {
  type: 'DEMAND_ORDER_BLOCK' | 'SUPPLY_ZONE' | 'FAIR_VALUE_GAP' | 'GOLDEN_POCKET';
  name: string;
  low: number;
  high: number;
  mitigated: boolean;
  tapCount: number;
  note: string;
}

/**
 * The institutional POI map: demand order blocks (discount), supply zones (premium), the fair value gaps at their
 * doorsteps and the golden pocket pool of the selected (or best mitigated) setup, each with its mitigation status.
 */
export function poiList(map: MarketMap): PoiItem[] {
  const dec = map.decimals;
  const f = (p: number) => p.toFixed(dec);
  const out: PoiItem[] = [];
  const zoneItem = (z: SDZone): PoiItem => ({
    type: z.kind === 'DEMAND' ? 'DEMAND_ORDER_BLOCK' : 'SUPPLY_ZONE',
    name: `${z.kind === 'DEMAND' ? 'Demand order block' : 'Supply zone'} (${PATTERN_NAME[z.pattern]})`,
    low: z.low,
    high: z.high,
    mitigated: !z.liveFirstTouch && (z.tapCount > 0 || z.priceInside),
    tapCount: z.tapCount,
    note: `${z.territory === 'DISCOUNT' ? 'Discount' : 'Premium'} (equilibrium ${f(map.equilibrium)}), ${
      z.liveFirstTouch ? 'first touch in progress, price is at it now' : z.priceInside ? 'price inside it now' : z.tapCount > 0 ? `tapped ${z.tapCount}x and left` : 'untouched'
    }, departure ${z.departureAtr.toFixed(1)} ATR, score ${z.score}/100`,
  });
  const zones = [...map.demandZones, ...map.supplyZones];
  for (const z of zones) out.push(zoneItem(z));
  for (const z of zones) {
    if (!z.fvg) continue;
    out.push({
      type: 'FAIR_VALUE_GAP',
      name: `Fair value gap at the ${z.kind === 'DEMAND' ? 'demand' : 'supply'} zone`,
      low: Math.min(z.fvg.low, z.fvg.high),
      high: Math.max(z.fvg.low, z.fvg.high),
      mitigated: !fvgOpenBefore(z),
      tapCount: fvgOpenBefore(z) ? 0 : 1,
      note: !z.fvg.filled
        ? 'Open 3-candle imbalance, a liquidity vacuum price has not revisited'
        : fvgOpenBefore(z)
          ? 'Open until the current first touch of the zone, price is filling it on the way in now'
          : 'Filled, price has traded back through the imbalance',
    });
  }
  const setup = map.plan || map.movedSetup || map.mitigatedSetup;
  if (setup) {
    out.push({
      type: 'GOLDEN_POCKET',
      name: 'Golden pocket pool (0.618 to 0.705)',
      low: Math.min(setup.goldenPocket.from, setup.goldenPocket.to),
      high: Math.max(setup.goldenPocket.from, setup.goldenPocket.to),
      mitigated: setup.mitigation.length > 0,
      tapCount: setup.mitigation.length > 0 ? 1 : 0,
      note: `On the swing leg ${f(setup.impulseFrom)} (100%) to ${f(setup.impulseTo)} (0%), equilibrium ${f(setup.legEquilibrium)}`,
    });
  }
  return out;
}

export function marketMapPromptBlock(map: MarketMap): string {
  const f = (p: number) => p.toFixed(map.decimals);
  const lines: string[] = [];
  lines.push(`COMPUTED MARKET MAP (from ${map.candles} real ${map.timeframe} candles; ATR(14) ${f(map.atr)}):`);
  lines.push(`- Market structure: ${map.trend}. Recent range ${f(map.swingLow)} – ${f(map.swingHigh)}. Last close ${f(map.lastClose)}.`);
  if (map.indicators) {
    const ind = map.indicators;
    lines.push(`- Indicators (latest candle): RSI(14) ${ind.rsi}${ind.bullishDivergence ? ', bullish divergence' : ''}${ind.bearishDivergence ? ', bearish divergence' : ''}; EMA(50) ${ind.ema50 === null ? 'n/a' : `${f(ind.ema50)} ${ind.emaTrend.toLowerCase()}`}.`);
  }
  lines.push(`- Dealing range equilibrium (0.50): ${f(map.equilibrium)}. Below it is discount (demand only), above it is premium (supply only). Price is in ${map.price <= map.equilibrium ? 'discount' : 'premium'}.`);
  lines.push(`- Demand zones below price: ${map.demandZones.length ? '' : 'none valid'}`);
  map.demandZones.forEach((z, i) => lines.push(`  ${i + 1}. ${describeZone(z, map.decimals)}`));
  lines.push(`- Supply zones above price: ${map.supplyZones.length ? '' : 'none valid'}`);
  map.supplyZones.forEach((z, i) => lines.push(`  ${i + 1}. ${describeZone(z, map.decimals)}`));
  const p = map.plan;
  if (p) {
    lines.push(`- SELECTED PLAN: ${p.direction} from the ${p.zone.kind.toLowerCase()} zone ${f(p.zone.low)} – ${f(p.zone.high)}.`);
    lines.push(`  Fibonacci drawn on the swing leg ${f(p.impulseFrom)} (100%) → ${f(p.impulseTo)} (0%): ${p.fib.map(l => `${l.ratio} = ${f(l.price)}`).join(', ')}. Golden pocket 0.618–0.705 = ${f(p.goldenPocket.from)} – ${f(p.goldenPocket.to)}. Confluence: ${p.confluence.replace(/_/g, ' ').toLowerCase()}${p.goldenPocketNear ? ' (within 0.3% of the zone)' : ''}.`);
    if (p.zone.fvg) lines.push(`  Fair value gap at the zone: ${f(p.zone.fvg.low)} – ${f(p.zone.fvg.high)}, unfilled${p.execution === 'MARKET' ? ' until this first touch' : ''} (institutional displacement confirmed).`);
    lines.push(
      p.execution === 'MARKET'
        ? `  EXECUTION: MARKET (instant). Price ${f(map.price)} is making the zone's FIRST touch right now (never touched before), so the trade is entered at the current market price, not as a pending order. Stop loss and every target are untouched and ahead of price. Say "${p.direction === 'LONG' ? 'buy' : 'sell'} now at market" in the writeup.`
        : `  EXECUTION: LIMIT (pending order). Pre-signal crosscheck passed: zone untouched (tapCount 0), entry, stop loss and every target still untouched and ahead of price.`
    );
    if (p.confirmation) lines.push(`  INDICATOR CROSSCHECK passed: ${p.confirmation.note}. PROXIMITY CHECK passed: price ${f(map.price)} is still well away from TP1 and the stop loss (fresh entry).`);
    lines.push(`  Entry ${f(p.entry.min)} – ${f(p.entry.max)} (optimal ${f(p.entry.optimal)}), stop loss ${f(p.stopLoss)}, targets ${p.targets.map((t, i) => `TP${i + 1} ${f(t.price)} [${t.label}, 1:${t.rr}]`).join('; ')}. Plan score ${p.score}/100.`);
  } else {
    lines.push(`- SELECTED PLAN: NO_SIGNAL. ${map.noSignalReason}`);
  }
  const pois = poiList(map);
  lines.push(`- POI MAP (${pois.length} points of interest, mitigation verified against every candle since each formed):`);
  pois.forEach(p2 => lines.push(`  • ${p2.name} ${f(p2.low)} – ${f(p2.high)}: ${p2.mitigated ? 'MITIGATED' : 'UNMITIGATED'} (tapCount ${p2.tapCount}). ${p2.note}.`));
  if (map.alternate) {
    const a = map.alternate;
    lines.push(`- Alternate ${a.direction} plan: entry ${f(a.entry.optimal)} in ${f(a.zone.low)} – ${f(a.zone.high)}, stop ${f(a.stopLoss)}, final target ${f(a.targets[2].price)} (1:${a.rrFinal}).`);
  }
  return lines.join('\n');
}

/** Standalone Markdown thesis (used when the AI engine is unavailable or contradicts the computed map). */
export function marketMapThesis(map: MarketMap, assetLabel: string, currencySymbol = ''): string {
  const f = (p: number) => `${currencySymbol}${grouped(p, map.decimals)}`;
  const zoneLines = (zs: SDZone[]) => (zs.length ? zs.map(z => `- ${describeZone(z, map.decimals, true)}`).join('\n') : '- None valid on this timeframe');
  const p = map.plan;
  let out = `### ${assetLabel} · ${map.timeframe} Supply & Demand + Fibonacci Map\n\n`;
  out += `**Market structure:** ${map.trend.toLowerCase()} · recent range ${f(map.swingLow)} to ${f(map.swingHigh)} · ATR ${f(map.atr)} · built from ${map.candles} live ${map.timeframe} candles.\n\n`;
  out += `**Premium and discount:** the 0.50 equilibrium of the range is ${f(map.equilibrium)}; price is in ${map.price <= map.equilibrium ? 'discount' : 'premium'}. Demand is only bought in discount and supply only sold in premium.\n\n`;
  out += `#### Institutional Demand (below price)\n${zoneLines(map.demandZones)}\n\n#### Institutional Supply (above price)\n${zoneLines(map.supplyZones)}\n\n`;
  if (p) {
    const long = p.direction === 'LONG';
    out += `#### Fibonacci Entry\n`;
    out += `Fibonacci is drawn on the swing leg **${f(p.impulseFrom)} (100%) → ${f(p.impulseTo)} (0%)**. `;
    out +=
      p.confluence === 'GOLDEN_POCKET_IN_ZONE'
        ? `The **0.618–0.705 golden pocket (${f(p.goldenPocket.from)} to ${f(p.goldenPocket.to)})** ${
            p.goldenPocketNear ? 'sits within 0.3% of the zone' : 'sits inside the zone'
          }, the highest-probability entry.\n\n`
        : p.confluence === 'FIB_BAND_OVERLAP'
          ? `The zone overlaps the 0.5–0.786 retracement band, giving Fibonacci confluence for the entry.\n\n`
          : p.confluence === 'LEG_ORIGIN'
            ? `The zone is the origin of the swing (Fibonacci 100%), a deep retest entry at the proximal edge.\n\n`
            : `The zone sits outside the key retracement band, so the entry is taken at the zone's proximal edge with reduced size.\n\n`;
    if (p.zone.fvg)
      out +=
        p.execution === 'MARKET'
          ? `**Displacement:** the fair value gap (${f(p.zone.fvg.low)} to ${f(p.zone.fvg.high)}) stayed open until this first touch, so institutional orders were still resting in the zone when price arrived.\n\n`
          : `**Displacement:** an open fair value gap (${f(p.zone.fvg.low)} to ${f(p.zone.fvg.high)}) sits at the zone's doorstep, so the zone is untouched and institutional orders are still resting there.\n\n`;
    if (p.confirmation) out += `**Indicator crosscheck:** ${p.confirmation.note}. Price is still well away from TP1 and the stop loss, so this is a fresh entry.\n\n`;
    const pois = poiList(map);
    out += `#### Points of Interest\n${pois
      .map(x => `- **${x.name}:** ${f(x.low)} to ${f(x.high)}, ${x.mitigated ? 'mitigated' : 'unmitigated'}`)
      .join('\n')}\n\n`;
    out += `#### Execution Plan · ${p.direction}\n`;
    out +=
      p.execution === 'MARKET'
        ? `- **Entry (${long ? 'buy' : 'sell'} now at market):** price is making the zone's first touch right now, enter at **${f(p.entry.optimal)}** (band ${f(p.entry.min)} to ${f(p.entry.max)})\n`
        : `- **Entry (${long ? 'buy' : 'sell'} limit):** ${f(p.entry.min)} to ${f(p.entry.max)}, optimal **${f(p.entry.optimal)}**\n`;
    out += `- **Stop loss:** ${f(p.stopLoss)}, beyond the zone's distal line (Fibonacci 100%)\n`;
    p.targets.forEach((t, i) => (out += `- **TP${i + 1}:** ${f(t.price)}, ${t.label} (1:${t.rr})\n`));
    out += `\n**Invalidation:** a candle close ${long ? 'below' : 'above'} ${f(p.zone.distal)} breaks the zone${
      p.execution === 'MARKET' ? '; if price leaves the entry band before you fill, do not chase it' : '; cancel the order if price reaches TP1 before filling'
    }.\n\n`;
  } else {
    const already = !!map.mitigatedSetup;
    const moved = map.movedSetup?.moved;
    out += `#### ${moved ? (moved.kind === 'NEAR_SL' ? 'No signal, already moved (close to the stop loss)' : 'No signal, already moved (close to TP)') : already ? 'No signal, already mitigated' : 'No signal'}\n${map.noSignalReason} ${
      already || moved
        ? 'Signals are only called from fresh zones whose entry, stop loss and targets are still untouched, with price still well away from TP1 and the stop.'
        : 'Wait for price to form a fresh, untouched zone and a new impulse to anchor the Fibonacci retracement.'
    }\n\n`;
  }
  out += `#### Risk Management\nRisk no more than 1–2% per trade, scale out at each target, and move the stop to entry after TP1.`;
  return out;
}

// ---------------------------------------------------------------------------
// Volatility helpers & "Tighten SL" on an existing setup
// ---------------------------------------------------------------------------
/** ATR(14) of the latest candle. */
export function computeAtr(candles: Candle[], period = 14): number {
  const a = rollingAtr(candles, period);
  return a[a.length - 1] || 0;
}

/**
 * Typical ATR(14) as a fraction of price when candles are unavailable. Scales with the square root of the
 * timeframe (0.12% per 1H for FX majors) and with how volatile the asset class is.
 */
export function estimateAtrFraction(tf: string, assetType?: string): number {
  const mult: Record<string, number> = { forex: 1, commodity: 1.6, stock: 2, synthetic: 3, crypto: 3.5 };
  const k = mult[String(assetType || '')] ?? 2;
  return 0.0012 * k * Math.sqrt(timeframeMinutes(normalizeTimeframe(tf)) / 60);
}

export interface TightenResult {
  stop: number;
  tightened: boolean;
  basis: string;
  minRisk: number;
}

/**
 * A tighter but still valid stop for an existing setup (same entry & targets). Prefers structure — the 0.786
 * retracement, then the zone's distal line — never closer than 0.5 ATR of the setup's timeframe and always
 * tighter than the original stop. If the original is already at that floor, it is kept (tightened=false).
 */
export function tightenStop(opts: {
  direction: 'LONG' | 'SHORT';
  entry: number;
  originalStop: number;
  atr: number;
  zoneDistal?: number | null;
  fib786?: number | null;
}): TightenResult {
  const { direction, entry, originalStop, atr } = opts;
  const long = direction === 'LONG';
  const originalRisk = Math.abs(entry - originalStop);
  const minRisk = Math.max(atr * 0.5, 1e-12);
  const riskOf = (p: number) => (long ? entry - p : p - entry);
  const tighter = (p: number) => riskOf(p) < originalRisk * 0.92;
  const valid = (p: number) => Number.isFinite(p) && riskOf(p) >= minRisk && tighter(p);

  const candidates: Array<{ price: number; basis: string }> = [];
  if (opts.fib786 && (long ? opts.fib786 < entry : opts.fib786 > entry)) {
    candidates.push({ price: long ? opts.fib786 - atr * 0.1 : opts.fib786 + atr * 0.1, basis: 'just beyond the 0.786 Fibonacci retracement' });
  }
  if (opts.zoneDistal && (long ? opts.zoneDistal < entry : opts.zoneDistal > entry)) {
    candidates.push({ price: long ? opts.zoneDistal - atr * 0.05 : opts.zoneDistal + atr * 0.05, basis: "just beyond the zone's distal line" });
  }
  // Closest valid structural level to the entry wins
  const structural = candidates.filter(c => valid(c.price)).sort((a, b) => riskOf(a.price) - riskOf(b.price))[0];
  if (structural) return { stop: structural.price, tightened: true, basis: structural.basis, minRisk };

  // Otherwise ~60% of the original risk, floored at 0.5 ATR
  const fallbackRisk = Math.max(minRisk, originalRisk * 0.6);
  const p = long ? entry - fallbackRisk : entry + fallbackRisk;
  if (tighter(p)) return { stop: p, tightened: true, basis: '60% of the original risk, kept above half an ATR of this timeframe', minRisk };
  return { stop: originalStop, tightened: false, basis: 'already at the tightest valid level for this timeframe', minRisk };
}

// ---------------------------------------------------------------------------
// Recheck: replay live candles over a signal's zone, entry, stop and targets
// ---------------------------------------------------------------------------
export interface RecheckSetup {
  direction: 'LONG' | 'SHORT';
  execution: 'LIMIT' | 'MARKET';
  zone: { low: number; high: number };
  entry: { min: number; max: number; optimal: number };
  stop: number;
  targets: number[];
  /** Replay from here: the first candle after the zone's leg-out */
  since: number;
  /** When the signal was issued */
  issuedAt: number;
}

export type RecheckLevelStatus = 'UNTOUCHED' | 'AT_PRICE' | 'TOUCHED' | 'HIT';

export interface RecheckLevel {
  key: string;
  label: string;
  low: number;
  high: number;
  status: RecheckLevelStatus;
  at?: number;
  note: string;
}

export interface RecheckResult {
  state: 'VALID' | 'TRIGGERED' | 'TP_HIT' | 'SL_HIT' | 'MITIGATED' | 'NO_SIGNAL' | 'SETUP_FORMED';
  headline: string;
  details: string;
  price: number;
  levels: RecheckLevel[];
  candlesChecked: number;
}

/**
 * Checks a signal again against the latest candles and live price: has the zone been tapped, the entry filled,
 * the stop hit or a target reached since the zone formed? Pure function, no I/O.
 */
export function recheckSetup(
  candlesIn: Candle[],
  price: number,
  setup: RecheckSetup,
  opts: { timeframeMinutes: number; decimals: number; now?: number; session?: SessionRange | null }
): RecheckResult {
  const long = setup.direction === 'LONG';
  const now = opts.now ?? Date.now();
  const tfMs = Math.max(1, opts.timeframeMinutes) * 60_000;
  const f = (p: number) => grouped(p, opts.decimals);
  const when = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  // Levels price reaches going against the trade (zone, entry, stop) and with it (targets)
  const against = (c: Candle, lvl: number) => (long ? c.l <= lvl : c.h >= lvl);
  const withTrade = (c: Candle, lvl: number) => (long ? c.h >= lvl : c.l <= lvl);
  const proximal = long ? setup.zone.high : setup.zone.low;
  const entryEdge = long ? setup.entry.max : setup.entry.min;
  const market = setup.execution === 'MARKET';

  const candles = candlesIn.filter(c => c.t >= setup.since && [c.o, c.h, c.l, c.c].every(v => Number.isFinite(v) && v > 0));
  // The live price is the newest tick: treat it as a last candle
  const live: Candle = { t: now, o: price, h: price, l: price, c: price };
  const series = [...candles, live];

  let zoneAt: number | undefined;
  let fillAt: number | undefined;
  let stopAt: number | undefined;
  const tpAt: Array<number | undefined> = setup.targets.map(() => undefined);
  let runAwayAt: number | undefined; // a target reached before the limit filled
  let fillIdx = -1;
  series.forEach((c, i) => {
    if (zoneAt === undefined && against(c, proximal)) zoneAt = c.t;
    if (market) return;
    if (fillAt === undefined && against(c, entryEdge)) {
      fillAt = c.t;
      fillIdx = i;
      return;
    }
    // Only after the signal: the impulse that created the zone naturally traded beyond TP1 before the pullback
    if (fillAt === undefined && runAwayAt === undefined && c.t >= setup.issuedAt && setup.targets[0] && withTrade(c, setup.targets[0])) runAwayAt = c.t;
  });
  // The trade starts when it is entered: a market order on the candle the signal was issued in, a limit order on its
  // fill candle. Only from there do the stop and targets count, in time order, like the price alerts, journal and
  // track record: a stop and a target in the same candle count as the stop (the safe reading), nothing counts after
  // the stop, and TP1 reached first is a win even if price comes back to the stop later.
  const startIdx = market ? series.findIndex(c => c.t + tfMs > setup.issuedAt) : fillIdx;
  let preStopAt: number | undefined; // a stop tap before the trade started (an unfilled limit order is then invalid)
  for (let i = 0; i < (startIdx >= 0 ? startIdx : series.length); i++) {
    if (against(series[i], setup.stop)) {
      preStopAt = series[i].t;
      break;
    }
  }
  if (startIdx >= 0) {
    for (let i = startIdx; i < series.length; i++) {
      const c = series[i];
      if (against(c, setup.stop)) {
        stopAt = c.t;
        break;
      }
      // (a limit order's targets count from the candle after its fill: inside the fill candle the order of moves is unknown)
      if (!market && i === startIdx) continue;
      setup.targets.forEach((t, k) => {
        if (tpAt[k] === undefined && withTrade(c, t)) tpAt[k] = c.t;
      });
    }
  }
  // The live 24h range can show a stop tap the candle feed has not printed yet (only once the whole range is inside the trade)
  const session = opts.session;
  const startedAt = startIdx >= 0 ? series[startIdx].t : undefined;
  let sessionStop = false;
  if (session && startedAt !== undefined && session.since >= startedAt && stopAt === undefined && tpAt[0] === undefined) {
    const extreme = long ? session.low : session.high;
    if (long ? extreme <= setup.stop : extreme >= setup.stop) sessionStop = true;
  }

  const beforeIssue = (t?: number) => t !== undefined && t + tfMs <= setup.issuedAt;
  const inZoneNow = price >= setup.zone.low && price <= setup.zone.high;
  const inEntryNow = price >= Math.min(setup.entry.min, setup.entry.max) && price <= Math.max(setup.entry.min, setup.entry.max);
  const tpHits = tpAt.map((t, k) => (t !== undefined ? k : -1)).filter(k => k >= 0);

  // Level checklist
  const levels: RecheckLevel[] = [];
  levels.push({
    key: 'ZONE',
    label: long ? 'Demand zone' : 'Supply zone',
    low: setup.zone.low,
    high: setup.zone.high,
    status: market ? 'AT_PRICE' : zoneAt === undefined ? 'UNTOUCHED' : inZoneNow && zoneAt === now ? 'AT_PRICE' : 'TOUCHED',
    ...(zoneAt !== undefined && zoneAt !== now ? { at: zoneAt } : {}),
    note: market
      ? 'First touch was the entry signal'
      : zoneAt === undefined
        ? 'Untouched since it formed'
        : zoneAt === now
          ? 'Price is at the zone right now'
          : `Tapped ${when(zoneAt)}`,
  });
  levels.push({
    key: 'ENTRY',
    label: market ? 'Entry (market)' : 'Entry (limit)',
    low: Math.min(setup.entry.min, setup.entry.max),
    high: Math.max(setup.entry.min, setup.entry.max),
    status: market ? (inEntryNow ? 'AT_PRICE' : 'HIT') : fillAt === undefined ? 'UNTOUCHED' : fillAt === now ? 'AT_PRICE' : 'HIT',
    ...(fillAt !== undefined && fillAt !== now ? { at: fillAt } : {}),
    note: market
      ? inEntryNow
        ? 'Price is still inside the entry band'
        : `Filled at market; price has moved ${long ? (price > setup.entry.optimal ? 'up' : 'down') : price < setup.entry.optimal ? 'down' : 'up'} since`
      : fillAt === undefined
        ? 'Not filled yet'
        : fillAt === now
          ? 'Price is at the entry right now'
          : `Filled ${when(fillAt)}`,
  });
  levels.push({
    key: 'STOP',
    label: 'Stop loss',
    low: setup.stop,
    high: setup.stop,
    status: stopAt !== undefined || sessionStop || (preStopAt !== undefined && startIdx < 0) ? 'HIT' : 'UNTOUCHED',
    ...(stopAt !== undefined ? { at: stopAt } : preStopAt !== undefined && startIdx < 0 ? { at: preStopAt } : {}),
    note:
      stopAt !== undefined
        ? tpAt[0] !== undefined
          ? `Hit ${when(stopAt)}, after TP1 (the trade had already won)`
          : `Hit ${when(stopAt)}`
        : sessionStop
          ? 'Reached inside the last 24 hours'
          : preStopAt !== undefined && startIdx < 0
            ? `Hit ${when(preStopAt)}, before the entry`
            : 'Untouched',
  });
  setup.targets.forEach((t, k) =>
    levels.push({
      key: `TP${k + 1}`,
      label: `TP${k + 1}`,
      low: t,
      high: t,
      status: tpAt[k] !== undefined ? 'HIT' : 'UNTOUCHED',
      ...(tpAt[k] !== undefined ? { at: tpAt[k] } : {}),
      note: tpAt[k] !== undefined ? `Reached ${when(tpAt[k]!)}` : k === 0 && runAwayAt !== undefined ? `Reached before the entry filled (${when(runAwayAt)})` : 'Untouched',
    })
  );

  const base = { price, levels, candlesChecked: candles.length };
  const side = long ? 'buy' : 'sell';
  // Verdicts, in the order things happened: a target reached before any stop is a win (TP1 first = WIN)
  if (tpHits.length) {
    const last = tpHits[tpHits.length - 1];
    const stoppedLater = stopAt !== undefined;
    return {
      ...base,
      state: 'TP_HIT',
      headline: `TP${last + 1} reached`,
      details: `${tpHits.map(k => `TP${k + 1} ${f(setup.targets[k])}`).join(', ')} reached after the entry filled${
        stoppedLater
          ? `. Price came back to the stop ${f(setup.stop)} later (${when(stopAt!)}), but TP${last + 1} was reached first, so the trade counts as a win`
          : `. The move has played out${last + 1 < setup.targets.length ? '; if you are in the trade, keep the stop at entry for the remaining targets' : ''}`
      }. A new entry here is late, wait for a fresh setup.`,
    };
  }
  if (stopAt !== undefined || sessionStop || (preStopAt !== undefined && startIdx < 0)) {
    const filled = startIdx >= 0;
    return {
      ...base,
      state: 'SL_HIT',
      headline: filled ? 'Stopped out' : 'Stop level already hit, setup invalid',
      details: `The stop loss ${f(setup.stop)} ${stopAt !== undefined ? `was hit ${when(stopAt)}` : sessionStop ? 'was reached inside the last 24 hours' : `was hit ${when(preStopAt!)}, before the entry`}. ${
        filled ? 'The trade is closed at a loss.' : 'Do not place this order.'
      } Wait for a new, untouched zone.`,
    };
  }
  if (!market) {
    if (fillAt !== undefined && beforeIssue(fillAt)) {
      return {
        ...base,
        state: 'MITIGATED',
        headline: 'Already mitigated',
        details: `The entry ${f(entryEdge)} was already tapped ${when(fillAt)}, before this signal. The zone is used; do not place this order.`,
      };
    }
    if (fillAt !== undefined) {
      return {
        ...base,
        state: 'TRIGGERED',
        headline: fillAt === now ? `Entry reached now, ${side} limit filling` : 'Entry filled, trade is live',
        details: `Price ${fillAt === now ? 'is at' : `filled`} the entry ${f(entryEdge)}${fillAt === now ? ' right now' : ` ${when(fillAt)}`}. The stop ${f(setup.stop)} and every target are untouched. Manage the position: stop at ${f(setup.stop)}, targets ${setup.targets.map(t => f(t)).join(', ')}.`,
      };
    }
    if (zoneAt !== undefined && zoneAt !== now) {
      return {
        ...base,
        state: 'MITIGATED',
        headline: 'Already mitigated',
        details: `Price entered the zone ${when(zoneAt)} without reaching the entry ${f(entryEdge)} and left. The resting orders have reacted; do not place this order.`,
      };
    }
    if (runAwayAt !== undefined) {
      return {
        ...base,
        state: 'MITIGATED',
        headline: 'Price ran away',
        details: `Price reached TP1 ${f(setup.targets[0])} before the limit entry filled. Cancel the order; the move went without you.`,
      };
    }
    return {
      ...base,
      state: 'VALID',
      headline: inZoneNow ? 'Still valid, price is at the zone now' : 'Still valid, zone untouched',
      details: `The zone ${f(setup.zone.low)} to ${f(setup.zone.high)}, the entry ${f(entryEdge)}, the stop ${f(setup.stop)} and every target are untouched. The ${side} limit order is still good.`,
    };
  }
  // Market execution, no stop and no target yet
  return {
    ...base,
    state: 'TRIGGERED',
    headline: inEntryNow ? `Still valid, ${side} at market` : 'Trade is live',
    details: inEntryNow
      ? `Price ${f(price)} is still inside the entry band ${f(Math.min(setup.entry.min, setup.entry.max))} to ${f(Math.max(setup.entry.min, setup.entry.max))}. The stop ${f(setup.stop)} and every target are untouched.`
      : `The entry was taken at ${f(setup.entry.optimal)}; price is now ${f(price)}. The stop ${f(setup.stop)} and every target are untouched. If you are not in yet, do not chase it.`,
  };
}

/**
 * Recheck for a "No signal" result: have the zones it listed been tapped since, and has a fresh, valid setup
 * formed on live data? Never returns new trade levels (a new analysis gives those).
 */
export function recheckNoSignal(
  candlesIn: Candle[],
  price: number,
  zones: Array<{ kind: ZoneKind; low: number; high: number; label?: string }>,
  opts: { timeframe: string; issuedAt: number; decimals: number; now?: number; jpy?: boolean; forex?: boolean; session?: SessionRange | null }
): RecheckResult {
  const now = opts.now ?? Date.now();
  const f = (p: number) => grouped(p, opts.decimals);
  const when = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  const tfMs = timeframeMinutes(opts.timeframe) * 60_000;
  const candles = candlesIn.filter(c => [c.o, c.h, c.l, c.c].every(v => Number.isFinite(v) && v > 0));
  // Candles that closed after the result was given, plus the live price
  const since = candles.filter(c => c.t + tfMs > opts.issuedAt);
  const levels: RecheckLevel[] = zones.slice(0, 8).map((z, i) => {
    const demand = z.kind === 'DEMAND';
    const proximal = demand ? z.high : z.low;
    const tap = since.find(c => (demand ? c.l <= proximal : c.h >= proximal));
    const inside = price >= z.low && price <= z.high;
    return {
      key: `Z${i + 1}`,
      label: z.label || (demand ? 'Demand zone' : 'Supply zone'),
      low: z.low,
      high: z.high,
      status: inside ? 'AT_PRICE' : tap ? 'TOUCHED' : 'UNTOUCHED',
      ...(tap && !inside ? { at: tap.t } : {}),
      note: inside ? 'Price is inside it right now' : tap ? `Tapped ${when(tap.t)}` : 'Untouched since this result',
    };
  });
  const map = buildMarketMap(candles, { price, timeframe: opts.timeframe, jpy: opts.jpy, forex: opts.forex, session: opts.session });
  const base = { price, levels, candlesChecked: since.length };
  if (map?.plan) {
    const p = map.plan;
    const side = p.direction === 'LONG' ? 'buy' : 'sell';
    return {
      ...base,
      state: 'SETUP_FORMED',
      headline: p.execution === 'MARKET' ? `A fresh ${side} setup is triggering now` : `A fresh ${side} setup has formed`,
      details: `Live ${opts.timeframe} data now shows a valid ${side} setup from a fresh ${p.zone.kind === 'DEMAND' ? 'demand' : 'supply'} zone around ${f(p.zone.low)} to ${f(p.zone.high)}${
        p.execution === 'MARKET' ? ', with price making its first touch right now' : ''
      }. Run a new analysis to get the verified entry, stop and targets.`,
    };
  }
  const touched = levels.filter(l => l.status !== 'UNTOUCHED').length;
  return {
    ...base,
    state: 'NO_SIGNAL',
    headline: 'Still no signal',
    details: `${map?.noSignalReason || 'No fresh, untouched zone offers a valid setup right now.'}${
      levels.length ? ` ${touched ? `${touched} of the ${levels.length} zones listed were touched since this result.` : 'None of the zones listed has been touched since this result.'}` : ''
    }`,
  };
}
