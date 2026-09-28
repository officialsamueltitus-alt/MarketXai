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
  fvg: { low: number; high: number; filled: boolean } | null;
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
  demandZones: SDZone[];
  supplyZones: SDZone[];
  plan: TradePlan | null; // chosen plan (null => NO_SIGNAL)
  alternate: TradePlan | null; // best plan in the other direction, if valid
  confidence: number;
  noSignalReason?: string;
  /** Best setup that would have qualified but whose levels were already tapped (reason for "already mitigated") */
  mitigatedSetup?: TradePlan | null;
  decimals: number;
}

// ---------------------------------------------------------------------------
// Timeframes
// ---------------------------------------------------------------------------
const SUPPORTED = ['1M', '3M', '5M', '15M', '30M', '1H', '2H', '4H', '6H', '8H', '12H', '1D', '1W'];

/** Minutes in a normalised timeframe ("15M", "4H", "1D", "1W"). */
export function timeframeMinutes(tf: string): number {
  const m = /^(\d+)([MHDW])$/.exec(tf);
  if (!m) return 240;
  const n = Number(m[1]);
  return m[2] === 'M' ? n : m[2] === 'H' ? n * 60 : m[2] === 'D' ? n * 1440 : n * 10080;
}

/** Snaps any timeframe to the nearest supported one (e.g. "3H" → "4H", "45M" → "30M"). */
export function normalizeTimeframe(tf: string | null | undefined): string {
  const clean = String(tf || '').trim().toUpperCase();
  if (SUPPORTED.includes(clean)) return clean;
  if (!/^\d+[MHDW]$/.test(clean)) return '4H';
  const target = timeframeMinutes(clean);
  let best = '4H';
  let bestDiff = Infinity;
  for (const s of SUPPORTED) {
    const d = Math.abs(Math.log(timeframeMinutes(s) / target));
    if (d < bestDiff) {
      bestDiff = d;
      best = s;
    }
  }
  return best;
}

/** Reads a timeframe written in the prompt ("on the 1H", "15 min", "H4", "daily", "weekly"). */
export function timeframeFromPrompt(text: string): string | null {
  const t = ` ${String(text || '').toLowerCase()} `;
  let m = /(?:^|[^a-z0-9])(\d{1,2})\s*(?:m|min|mins|minute|minutes)(?![a-z0-9])/.exec(t);
  if (m) return normalizeTimeframe(`${m[1]}M`);
  m = /(?:^|[^a-z0-9])(\d{1,2})\s*(?:h|hr|hrs|hour|hours)(?![a-z0-9])/.exec(t);
  if (m) return normalizeTimeframe(`${m[1]}H`);
  m = /(?:^|[^a-z0-9])(\d)\s*(?:d|day|days)(?![a-z0-9])/.exec(t);
  if (m) return normalizeTimeframe(`${m[1]}D`);
  m = /(?:^|[^a-z0-9])(\d)\s*(?:w|wk|week|weeks)(?![a-z0-9])/.exec(t);
  if (m) return normalizeTimeframe(`${m[1]}W`);
  m = /(?:^|[^a-z0-9])([mhdw])(\d{1,2})(?![a-z0-9])/.exec(t); // MT4 style: M15, H1, H4, D1, W1
  if (m) return normalizeTimeframe(`${m[2]}${m[1].toUpperCase()}`);
  if (/\bhourly\b/.test(t)) return '1H';
  if (/\bdaily\b/.test(t)) return '1D';
  if (/\bweekly\b/.test(t)) return '1W';
  return null;
}

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
  if (price < 0.01) return 7;
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
// 1-2. Supply & Demand zones with freshness
// ---------------------------------------------------------------------------
function isBasing(c: Candle, atr: number) {
  return body(c) <= range(c) * 0.5 || range(c) <= atr * 0.7;
}

export function detectZones(candles: Candle[], price: number): { demand: SDZone[]; supply: SDZone[]; atr: number; swings: Swing[] } {
  const atrs = rollingAtr(candles);
  const atr = atrs[atrs.length - 1] || Math.abs(price) * 0.005;
  const swings = findSwings(candles);
  const zones: SDZone[] = [];
  const n = candles.length;

  const medianBody = (i: number) => {
    const xs = candles.slice(Math.max(0, i - 20), i).map(body).sort((x, y) => x - y);
    return xs.length ? xs[Math.floor(xs.length / 2)] : 0;
  };

  for (let i = 2; i < n - 1; i++) {
    const leg = candles[i];
    const a = atrs[i - 1] || atr;
    const typical = medianBody(i);
    // Explosive leg-out: clearly larger than normal candles (imbalance), or two strong candles in the same direction
    const strongSingle = body(leg) >= a * 1.1 && body(leg) >= typical * 1.8 && body(leg) >= range(leg) * 0.55;
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

    // Pattern: what came into the base (drop or rally) decides reversal vs continuation
    const before = candles[Math.max(0, base[0] - 1)];
    const cameFromDrop = before && before.c < before.o;
    const pattern: SDZone['pattern'] = up ? (cameFromDrop ? 'DBR' : 'RBR') : cameFromDrop ? 'DBD' : 'RBD';

    // Departure: how far price travelled away within the next 6 candles
    const after = candles.slice(i, Math.min(n, i + 7));
    const departure = up ? (Math.max(...after.map(c => c.h)) - proximal) / a : (proximal - Math.min(...after.map(c => c.l))) / a;
    if (departure < 1.5) continue;

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
      let filled = false;
      for (let j = k + 2; j < n; j++) {
        if (up ? candles[j].l <= gap.low : candles[j].h >= gap.high) {
          filled = true;
          break;
        }
      }
      fvg = { ...gap, filled };
      break;
    }

    // Freshness: replay candles after the leg-out
    let tapCount = 0;
    let broken = false;
    let away = true;
    for (let j = i + (strongPair ? 2 : 1); j < n; j++) {
      const c = candles[j];
      const touches = up ? c.l <= proximal : c.h >= proximal;
      if (touches && away) tapCount++;
      away = !touches;
      if (up ? c.c < distal : c.c > distal) {
        broken = true;
        break;
      }
    }
    if (broken) continue;

    zones.push({
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
      priceInside: price >= Math.min(proximal, distal) && price <= Math.max(proximal, distal),
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
    s += z.tapCount === 0 ? 14 : z.tapCount === 1 ? 4 : -12; // fresh zones hold best
    s += z.brokeStructure ? 8 : 0;
    s += z.fvg ? (z.fvg.filled ? 0 : 6) : -8; // an open imbalance at the zone proves institutional displacement
    s += z.baseCandles === 1 ? 6 : z.baseCandles === 2 ? 3 : 0; // less time at base = more imbalance
    s += z.pattern === 'DBR' || z.pattern === 'RBD' ? 4 : 2; // reversal zones slightly stronger
    if ((z.kind === 'DEMAND' && trend === 'BULLISH') || (z.kind === 'SUPPLY' && trend === 'BEARISH')) s += 8;
    if ((z.kind === 'DEMAND' && trend === 'BEARISH') || (z.kind === 'SUPPLY' && trend === 'BULLISH')) s -= 6;
    s -= Math.max(0, z.distanceAtr - 6) * 2; // far-away zones are less actionable
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

function planForZone(
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

  // A limit entry must still be ahead of price (or price is sitting in the zone right now)
  if (!z.priceInside && (long ? optimal >= price : optimal <= price)) return null;
  if (z.priceInside) optimal = long ? Math.min(optimal, price) : Math.max(optimal, price);
  eMin = Math.min(eMin, optimal);
  eMax = Math.max(eMax, optimal);

  // Stop beyond the zone's distal line with an ATR buffer (tight = just beyond the line)
  // Normal: 0.3 ATR beyond the distal line, >= 1 ATR risk. Tight (input-box toggle): a smaller but still
  // valid stop for the timeframe — 0.15 ATR beyond the distal line, >= 0.7 ATR risk.
  const buffer = atr * (slMode === 'tight' ? 0.15 : 0.3);
  let stop = long ? z.distal - buffer : z.distal + buffer;
  // Give the trade room to breathe: never risk less than a fraction of the ATR
  const minRisk = atr * (slMode === 'tight' ? 0.7 : 1.0);
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

  // Mitigation check: replay the candles for THIS setup. The zone must be untouched since it formed, and since
  // the impulse extreme (where the pullback to the entry begins) price must not have tapped the entry, the stop
  // or — after an entry fill — the first target. Any of these means the setup has already played out.
  const mitigation: string[] = [];
  const when = (c: Candle) => new Date(c.t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  if (z.tapCount > 0) mitigation.push(`the ${long ? 'demand' : 'supply'} zone was already tapped ${z.tapCount}x since it formed`);
  else if (z.priceInside) mitigation.push(`price is trading inside the ${long ? 'demand' : 'supply'} zone right now`);
  // The live 24h range can show a tap the candle feed has not printed yet. Only used when the window opens after the
  // zone's leg-out, so the displacement candles themselves are never mistaken for a tap.
  const legOutDone = candles[Math.min(candles.length - 1, z.legOutIndex + 2)];
  if (session && legOutDone.t < session.since) {
    const extreme = long ? session.low : session.high;
    if (z.tapCount === 0 && !z.priceInside && (long ? extreme <= z.proximal : extreme >= z.proximal))
      mitigation.push(`the 24h ${long ? 'low' : 'high'} ${round(extreme)} already traded into the zone`);
    if (long ? extreme <= stop : extreme >= stop) mitigation.push(`the 24h ${long ? 'low' : 'high'} ${round(extreme)} already reached the stop-loss level ${round(stop)}`);
  }
  let entryTap: Candle | null = null;
  for (let j = Math.max(extIndex + 1, z.legOutIndex + 1); j < candles.length; j++) {
    const c = candles[j];
    if (!entryTap && (long ? c.l <= optimal : c.h >= optimal)) {
      entryTap = c;
      mitigation.push(`the entry ${round(optimal)} was already tapped (${when(c)})`);
    }
    if (entryTap && (long ? c.h >= targets[0].price : c.l <= targets[0].price) && c.t > entryTap.t) {
      mitigation.push(`TP1 ${targets[0].price} was then reached (${when(c)})`);
      break;
    }
  }
  for (let j = z.legOutIndex + 1; j < candles.length; j++) {
    const c = candles[j];
    if (long ? c.l <= stop : c.h >= stop) {
      mitigation.push(`the stop-loss level ${round(stop)} was already hit (${when(c)})`);
      break;
    }
  }

  return {
    mitigation,
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
  }
): MarketMap | null {
  const clean = candles.filter(c => [c.o, c.h, c.l, c.c].every(v => Number.isFinite(v) && v > 0) && c.h >= c.l);
  if (clean.length < 40) return null;
  const lastClose = clean[clean.length - 1].c;
  const price = opts.price && opts.price > 0 && Math.abs(opts.price - lastClose) / lastClose < 0.2 ? opts.price : lastClose;
  const dec = priceDecimals(price, opts.jpy, opts.forex);
  const slMode = opts.slMode === 'tight' ? 'tight' : 'normal';
  const { demand, supply, atr, swings } = detectZones(clean, price);
  const trend = trendFromSwings(swings);
  const lookback = clean.slice(-120);
  const swingHigh = Math.max(...lookback.map(c => c.h));
  const swingLow = Math.min(...lookback.map(c => c.l));

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
  // Only clean setups can become signals: fresh zone, and entry / stop / targets never tapped for this setup
  const longs = allLongs.filter(p => p.mitigation.length === 0);
  const shorts = allShorts.filter(p => p.mitigation.length === 0);
  const bestLong = longs.sort((a, b) => b.score - a.score)[0] || null;
  const bestShort = shorts.sort((a, b) => b.score - a.score)[0] || null;

  // A signal needs a Fibonacci-confirmed entry, a strong zone within reach and at least 1:2.5 to the final target.
  // A deep retest of the leg's origin (Fib 100%) only counts when the zone is fresh and very strong.
  const qualifiesIgnoringMitigation = (p: TradePlan | null) =>
    !!p &&
    p.confluence !== 'ZONE_ONLY' &&
    (p.confluence !== 'LEG_ORIGIN' || (p.zone.fresh && p.score >= 80)) &&
    // Institutional displacement: an unfilled fair value gap at the zone's doorstep
    !!p.zone.fvg &&
    !p.zone.fvg.filled &&
    // Counter-trend trades must clear a much higher bar
    p.score >= ((trend === 'BULLISH' && p.direction === 'SHORT') || (trend === 'BEARISH' && p.direction === 'LONG') ? 82 : 70) &&
    p.zone.distanceAtr <= 12 &&
    p.rrFinal >= 2.5;
  const qualifies = (p: TradePlan | null) => qualifiesIgnoringMitigation(p) && p!.mitigation.length === 0;
  let plan: TradePlan | null = null;
  let alternate: TradePlan | null = null;
  const preferred = opts.prefer === 'LONG' ? bestLong : opts.prefer === 'SHORT' ? bestShort : null;
  if (qualifies(preferred)) {
    plan = preferred;
    alternate = preferred === bestLong ? (qualifies(bestShort) ? bestShort : null) : qualifies(bestLong) ? bestLong : null;
  } else {
    const ranked = [bestLong, bestShort].filter(qualifies).sort((a, b) => b!.score - a!.score) as TradePlan[];
    plan = ranked[0] || null;
    alternate = ranked[1] || null;
  }

  let noSignalReason: string | undefined;
  let mitigatedSetup: TradePlan | null = null;
  if (!plan) {
    // The best setup would have qualified, but its levels were already tapped: say so explicitly
    // Prefer a setup that would otherwise have been a signal, then any Fibonacci-confirmed one, then any tapped setup
    const mitigated = [...allLongs, ...allShorts].filter(p => p.mitigation.length > 0).sort((a, b) => b.score - a.score);
    mitigatedSetup =
      mitigated.find(p => qualifiesIgnoringMitigation(p)) ||
      mitigated.find(p => p.confluence !== 'ZONE_ONLY' && p.rrFinal >= 2.5) ||
      mitigated[0] ||
      null;
  }
  if (!plan && mitigatedSetup) {
    const m = mitigatedSetup;
    noSignalReason = `No signal, already mitigated. The ${m.direction === 'LONG' ? 'buy' : 'sell'} setup from the ${
      m.zone.kind === 'DEMAND' ? 'demand' : 'supply'
    } zone ${m.zone.low.toFixed(dec)} to ${m.zone.high.toFixed(dec)} is no longer fresh: ${m.mitigation.join('; ')}. No other fresh, untouched zone offers a valid setup right now.`;
  } else if (!plan) {
    if (!demand.length && !supply.length) noSignalReason = 'No signal. No fresh, unbroken institutional supply or demand zone is in play on this timeframe.';
    else if ([...demand, ...supply].every(z => z.tapCount >= 1))
      noSignalReason = 'No signal. Every zone in play has already been tapped since it formed, so none is fresh; wait for a new, untouched zone.';
    else if (!bestLong && !bestShort) noSignalReason = 'No signal. Fresh zones exist, but none leaves room for a clean Fibonacci entry ahead of price with a valid stop.';
    else if (![...longs, ...shorts].some(p => p.zone.fvg && !p.zone.fvg.filled))
      noSignalReason = 'No signal. The fresh zones have no open fair value gap at their doorstep, so institutional displacement is not confirmed; wait for a cleaner zone.';
    else noSignalReason = 'No signal. The fresh zones lack golden-pocket confluence, are too far from price, or do not pay at least 1:2.5, so there is no high-probability edge right now.';
  }

  return {
    timeframe: opts.timeframe,
    candles: clean.length,
    lastClose,
    price,
    atr,
    trend,
    swingHigh: Number(swingHigh.toFixed(dec)),
    swingLow: Number(swingLow.toFixed(dec)),
    demandZones: demand.slice(0, 4),
    supplyZones: supply.slice(0, 4),
    plan,
    alternate,
    confidence: plan ? Math.max(55, Math.min(92, plan.score)) : 50,
    noSignalReason,
    mitigatedSetup,
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
  const state = z.priceInside ? 'price is inside it now' : z.fresh ? 'fresh, untouched' : `tapped ${z.tapCount}x and held`;
  return `${z.kind} ${f(z.low)} – ${f(z.high)} (${PATTERN_NAME[z.pattern]}, proximal ${f(z.proximal)}, distal ${f(z.distal)}, ${state}, departure ${z.departureAtr.toFixed(1)} ATR${
    z.brokeStructure ? ', broke structure' : ''
  }${z.fvg ? `, FVG ${f(z.fvg.low)} to ${f(z.fvg.high)} ${z.fvg.filled ? 'filled' : 'open'}` : ', no FVG'}, score ${z.score}/100)`;
}

/** Compact, factual block for the AI prompt. */
export function marketMapPromptBlock(map: MarketMap): string {
  const f = (p: number) => p.toFixed(map.decimals);
  const lines: string[] = [];
  lines.push(`COMPUTED MARKET MAP (from ${map.candles} real ${map.timeframe} candles; ATR(14) ${f(map.atr)}):`);
  lines.push(`- Market structure: ${map.trend}. Recent range ${f(map.swingLow)} – ${f(map.swingHigh)}. Last close ${f(map.lastClose)}.`);
  lines.push(`- Demand zones below price: ${map.demandZones.length ? '' : 'none valid'}`);
  map.demandZones.forEach((z, i) => lines.push(`  ${i + 1}. ${describeZone(z, map.decimals)}`));
  lines.push(`- Supply zones above price: ${map.supplyZones.length ? '' : 'none valid'}`);
  map.supplyZones.forEach((z, i) => lines.push(`  ${i + 1}. ${describeZone(z, map.decimals)}`));
  const p = map.plan;
  if (p) {
    lines.push(`- SELECTED PLAN: ${p.direction} from the ${p.zone.kind.toLowerCase()} zone ${f(p.zone.low)} – ${f(p.zone.high)}.`);
    lines.push(`  Fibonacci drawn on the swing leg ${f(p.impulseFrom)} (100%) → ${f(p.impulseTo)} (0%): ${p.fib.map(l => `${l.ratio} = ${f(l.price)}`).join(', ')}. Golden pocket 0.618–0.705 = ${f(p.goldenPocket.from)} – ${f(p.goldenPocket.to)}. Confluence: ${p.confluence.replace(/_/g, ' ').toLowerCase()}${p.goldenPocketNear ? ' (within 0.3% of the zone)' : ''}.`);
    if (p.zone.fvg) lines.push(`  Fair value gap at the zone: ${f(p.zone.fvg.low)} – ${f(p.zone.fvg.high)}, unfilled (institutional displacement confirmed).`);
    lines.push(`  Pre-signal crosscheck passed: zone untouched (tapCount 0), entry, stop loss and every target still untouched and ahead of price.`);
    lines.push(`  Entry ${f(p.entry.min)} – ${f(p.entry.max)} (optimal ${f(p.entry.optimal)}), stop loss ${f(p.stopLoss)}, targets ${p.targets.map((t, i) => `TP${i + 1} ${f(t.price)} [${t.label}, 1:${t.rr}]`).join('; ')}. Plan score ${p.score}/100.`);
  } else {
    lines.push(`- SELECTED PLAN: NO_SIGNAL. ${map.noSignalReason}`);
  }
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
      out += `**Displacement:** an open fair value gap (${f(p.zone.fvg.low)} to ${f(p.zone.fvg.high)}) sits at the zone's doorstep, so the zone is untouched and institutional orders are still resting there.\n\n`;
    out += `#### Execution Plan · ${p.direction}\n`;
    out += `- **Entry (${long ? 'buy' : 'sell'} limit):** ${f(p.entry.min)} to ${f(p.entry.max)}, optimal **${f(p.entry.optimal)}**\n`;
    out += `- **Stop loss:** ${f(p.stopLoss)}, beyond the zone's distal line (Fibonacci 100%)\n`;
    p.targets.forEach((t, i) => (out += `- **TP${i + 1}:** ${f(t.price)}, ${t.label} (1:${t.rr})\n`));
    out += `\n**Invalidation:** a candle close ${long ? 'below' : 'above'} ${f(p.zone.distal)} breaks the zone; cancel the order if price reaches TP1 before filling.\n\n`;
  } else {
    const already = !!map.mitigatedSetup;
    out += `#### ${already ? 'No signal, already mitigated' : 'No signal'}\n${map.noSignalReason} ${
      already
        ? 'Signals are only called from fresh zones whose entry, stop loss and targets are still untouched.'
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
