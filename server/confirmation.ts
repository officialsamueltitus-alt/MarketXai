// ===========================================================================
// Confirmation analysis (owner-specified, Preference Mode "Analysis mode"): a layer on top of the normal engine.
//
// Normal analysis signals a fresh, untouched zone ahead of price (a pending limit order). Confirmation analysis waits:
//   1. The engine finds the setup and its POI (the same supply / demand zone, Fibonacci leg and targets).
//   2. Nothing is signalled until price reaches the zone. Then the lower timeframe (LTF) is read for a confirmation
//      that price is respecting it: a liquidity sweep / false breakout (wick through the zone, close back inside), an
//      engulfing candle, a pin bar (rejection wick), a morning / evening star, or a break of the LTF structure, with RSI
//      on the LTF as a crosscheck (no buy into RSI 70+, no sell into RSI 30-; a divergence adds confluence).
//   3. Only then the setup is ready: entered at market, stop beyond the reaction's extreme wick (the swept low / high,
//      which may sit inside the zone or beyond it after a wick-out), targets from the engine's Fibonacci ladder.
// A zone that was already tapped can still confirm (the tap is the test). Price closing through the zone on the LTF,
// a target reached since the confirmation, or price half-way to TP1 = no trade. Normal mode is untouched.
// ===========================================================================
import {
  computeAtr,
  planForZone,
  rsiSeries,
  type Candle,
  type MarketMap,
  type SDZone,
  type TradePlan,
} from './strategy';
import { timeframeMinutes } from '../src/utils/timeframe';
import type { AnalysisMode } from '../src/utils/preferences';
export type { AnalysisMode };
export type ConfirmState = 'CONFIRMED' | 'WAITING_PATTERN' | 'WAITING_TAP' | 'NONE';

export interface ConfirmEntry {
  /** Lower timeframe the confirmation was read on */
  ltf: string;
  /** Every confirmation found, strongest first ("Liquidity sweep below the zone", "Bullish engulfing", ...) */
  patterns: string[];
  /** Open time of the confirming candle */
  confirmedAt: number;
  /** Close of the confirming candle */
  confirmClose: number;
  /** The reaction's extreme (swept low for a buy, swept high for a sell): the stop sits beyond it */
  reactionExtreme: number;
  /** The reaction wicked through the zone's far edge and closed back inside (false breakout) */
  sweptZone: boolean;
  note: string;
}

export interface ConfirmationRead {
  mode: 'CONFIRMATION';
  state: ConfirmState;
  direction?: 'LONG' | 'SHORT';
  zone?: { low: number; high: number; kind: 'DEMAND' | 'SUPPLY' };
  ltf: string;
  entry?: ConfirmEntry;
  /** Plain words for the result ("Waiting for confirmation at the demand zone ...") */
  text: string;
}

export type ConfirmedPlan = TradePlan & { confirmEntry: ConfirmEntry };

// The read made for a map (kept beside it, so MarketMap itself is unchanged)
const reads = new WeakMap<MarketMap, ConfirmationRead>();
/** The confirmation read of a map built in Confirmation mode (undefined = Normal mode) */
export function confirmationOf(map: MarketMap | null | undefined): ConfirmationRead | undefined {
  return map ? reads.get(map) : undefined;
}

/** Lower timeframe a confirmation is read on (about 8 to 12 candles per candle of the analysis timeframe) */
const LTF: Record<string, string> = {
  '1M': '1M', '3M': '1M', '5M': '1M', '15M': '1M', '30M': '3M', '1H': '5M', '2H': '15M', '4H': '30M',
  '6H': '30M', '8H': '1H', '12H': '1H', '1D': '2H', '1W': '12H',
};
export function confirmationTimeframe(tf: string): string {
  return LTF[tf] || '15M';
}

/** Score a confirmed setup needs (same floor as a normal signal) */
export const CONFIRM_MIN_SCORE = 70;

const body = (c: Candle) => Math.abs(c.c - c.o);
const range = (c: Candle) => Math.max(c.h - c.l, 1e-12);
const label = (tf: string) => tf.replace(/^(\d+)M$/, '$1m');
// A sell is read as a buy on the mirrored chart (prices negated): one set of rules for both sides
const mirror = (c: Candle): Candle => ({ t: c.t, o: -c.o, h: -c.l, l: -c.h, c: -c.c });
/** Pattern names read on the mirrored chart, in a seller's words */
const sellWords = (name: string) =>
  name
    .replace('below the zone', 'above the zone')
    .replace('local low', 'local high')
    .replace('Bullish engulfing', 'Bearish engulfing')
    .replace('Morning star', 'Evening star')
    .replace('close above the last lower high', 'close below the last higher low');

interface LongRead {
  state: 'CONFIRMED' | 'WAITING_PATTERN' | 'WAITING_TAP' | 'FAILED';
  patterns: string[];
  confirmIdx: number;
  lowIdx: number;
  low: number;
  swept: boolean;
  divergence: boolean;
  rsiAtConfirm: number;
  reason?: string;
}

/**
 * The confirmation read for a buy at a demand zone (top = proximal, bottom = distal) on the LTF candles.
 * Sells call it on the mirrored chart.
 */
function readLong(ltf: Candle[], top: number, bottom: number, window: number, freshBars: number): LongRead {
  const n = ltf.length;
  const atr = computeAtr(ltf) || range(ltf[n - 1]);
  const none = (state: LongRead['state'], reason?: string): LongRead => ({ state, patterns: [], confirmIdx: -1, lowIdx: -1, low: NaN, swept: false, divergence: false, rsiAtConfirm: NaN, reason });
  const start = Math.max(1, n - window);
  // The touch: the first candle of the recent window that reached the zone
  let touch = -1;
  for (let i = start; i < n; i++) if (ltf[i].l <= top + atr * 0.1) { touch = i; break; }
  if (touch < 0) return none('WAITING_TAP');
  // Price closing through the zone on the LTF (and still below it) means the zone is failing, not holding
  const last = ltf[n - 1];
  if (last.c < bottom) return none('FAILED', "price is closing through the zone's far edge");
  // The reaction low since the touch; a confirmation must come at or after it (a lower low later cancels it)
  let lowIdx = touch;
  for (let i = touch; i < n; i++) if (ltf[i].l <= ltf[lowIdx].l) lowIdx = i;
  const low = ltf[lowIdx].l;
  const before = ltf.slice(Math.max(0, touch - 20), touch);
  const localLow = before.length ? Math.min(...before.map(c => c.l)) : Infinity;
  const mid = (top + bottom) / 2;
  const rsi = rsiSeries(ltf);
  const found: Array<{ i: number; name: string; w: number }> = [];
  for (let i = lowIdx; i < n; i++) {
    const c = ltf[i];
    const p = ltf[i - 1];
    const atZone = Math.min(c.l, p?.l ?? c.l) <= top + atr * 0.25;
    if (!atZone && i > lowIdx + 2) {
      // Structure break: the first close above the last lower high before the reaction low
      const hi = Math.max(...ltf.slice(Math.max(touch - 5, lowIdx - 6, 0), lowIdx + 1).map(x => x.h));
      if (c.c > hi && !found.some(f => f.name.startsWith('Break of structure'))) found.push({ i, name: 'Break of structure (close above the last lower high)', w: 2 });
      continue;
    }
    const lowerWick = Math.min(c.o, c.c) - c.l;
    const closesHigh = c.c >= c.l + range(c) * 0.6;
    if (c.l < bottom && c.c > bottom && closesHigh) found.push({ i, name: 'Liquidity sweep below the zone (false breakout, closed back inside)', w: 3 });
    else if (c.l < localLow && c.c > localLow && closesHigh && c.l <= top) found.push({ i, name: 'Sweep of the local low into the zone', w: 2 });
    if (p && p.c < p.o && c.c > c.o && c.c >= p.o && c.o <= p.c && body(c) >= body(p)) found.push({ i, name: 'Bullish engulfing', w: 2 });
    if (lowerWick >= body(c) * 2 && lowerWick >= range(c) * 0.55 && closesHigh) found.push({ i, name: 'Pin bar (rejection wick)', w: 2 });
    const a = ltf[i - 2];
    if (a && p && a.c < a.o && body(a) >= range(a) * 0.5 && body(p) <= body(a) * 0.4 && c.c > c.o && c.c > (a.o + a.c) / 2) found.push({ i, name: 'Morning star', w: 2 });
    // Structure break inside the zone as well
    const hi = Math.max(...ltf.slice(Math.max(touch - 5, lowIdx - 6, 0), lowIdx + 1).map(x => x.h));
    if (i > lowIdx && c.c > hi && !found.some(f => f.name.startsWith('Break of structure'))) found.push({ i, name: 'Break of structure (close above the last lower high)', w: 2 });
  }
  // The confirming candle: the first one with a pattern that also closed in the upper half of the zone or above it
  const confirming = found.filter(f => ltf[f.i].c >= mid).sort((x, y) => x.i - y.i)[0];
  if (!confirming) return { ...none('WAITING_PATTERN'), lowIdx, low };
  const confirmIdx = confirming.i;
  const patterns = [...new Map(found.filter(f => f.i <= confirmIdx + 3).sort((x, y) => y.w - x.w).map(f => [f.name, f])).keys()];
  const rsiAt = rsi[confirmIdx];
  // RSI divergence: a lower low than before the touch while RSI printed a higher low
  let divergence = false;
  if (before.length) {
    const bi = touch - before.length + before.findIndex(c => c.l === localLow);
    divergence = low < localLow && Number.isFinite(rsi[lowIdx]) && Number.isFinite(rsi[bi]) && rsi[lowIdx] > rsi[bi] + 2;
  }
  if (Number.isFinite(rsiAt) && rsiAt >= 70) return { ...none('WAITING_PATTERN', `RSI on the confirmation is already ${Math.round(rsiAt)} (overbought)`), lowIdx, low };
  if (confirmIdx < n - freshBars) return { ...none('FAILED', 'the confirmation is old and the reaction has already played out'), lowIdx, low };
  return { state: 'CONFIRMED', patterns, confirmIdx, lowIdx, low, swept: low < bottom, divergence, rsiAtConfirm: rsiAt };
}

/** The touch must be recent (the last 3 candles of the analysis timeframe) and the confirmation fresh (the last 2), in LTF bars */
function confirmWindows(htfTf: string, ltfTf: string) {
  const ratio = Math.max(1, timeframeMinutes(htfTf) / Math.max(1, timeframeMinutes(ltfTf)));
  return { window: Math.round(Math.min(120, Math.max(12, ratio * 3))), freshBars: Math.round(Math.min(60, Math.max(6, ratio * 2))) };
}

export interface ZoneRead {
  state: 'CONFIRMED' | 'WAITING_PATTERN' | 'WAITING_TAP' | 'FAILED';
  /** Pattern names, in a buyer's words (sells: confirmWords) */
  patterns: string[];
  confirmIdx: number;
  /** Reaction extreme in buy space (the swept low; sells: the negated high) */
  low: number;
  swept: boolean;
  divergence: boolean;
  reason?: string;
  /** ATR of the lower timeframe (for the stop buffer) */
  ltfAtr: number;
}
/**
 * The same confirmation read for any zone (owner-specified: Strategy Builder trades use Confirmation analysis too).
 * Buy space: top = the zone's near edge, bottom = its far edge; sells pass the mirrored candles and negated levels.
 */
export function readZoneConfirmation(ltf: Candle[], top: number, bottom: number, htfTf: string, ltfTf: string): ZoneRead {
  const { window, freshBars } = confirmWindows(htfTf, ltfTf);
  const rd = readLong(ltf, top, bottom, window, freshBars);
  return { state: rd.state, patterns: rd.patterns, confirmIdx: rd.confirmIdx, low: rd.low, swept: rd.swept, divergence: rd.divergence, reason: rd.reason, ltfAtr: computeAtr(ltf) || range(ltf[ltf.length - 1]) };
}
/** Pattern names in the trader's side words (a sell's patterns were read on the mirrored chart) */
export const confirmWords = (names: string[], long: boolean) => (long ? names : names.map(sellWords));

/**
 * Applies Confirmation analysis to a map built by the normal engine. Returns the read; the map is changed in place:
 * map.plan becomes the confirmed trade (market entry, stop beyond the reaction wick), or null with a "waiting for
 * confirmation" reason.
 */
export function applyConfirmation(
  map: MarketMap,
  htfRaw: Candle[],
  ltfRaw: Candle[] | null,
  opts: { ltf: string; slMode: 'normal' | 'tight' }
): ConfirmationRead {
  const ltfName = opts.ltf;
  const clean = (cs: Candle[]) => cs.filter(c => [c.o, c.h, c.l, c.c].every(v => Number.isFinite(v) && v > 0) && c.h >= c.l);
  const htf = clean(htfRaw);
  const ltf = ltfRaw ? clean(ltfRaw) : [];
  const dec = map.decimals;
  const r = (p: number) => Number(p.toFixed(dec));
  const fmt = (p: number) => p.toFixed(dec);
  const price = map.price;
  const normalPlan = map.plan;
  const read: ConfirmationRead = { mode: 'CONFIRMATION', state: 'NONE', ltf: ltfName, text: '' };
  reads.set(map, read);
  const zoneWords = (z: SDZone) => `${z.kind === 'DEMAND' ? 'demand' : 'supply'} zone ${fmt(z.low)} to ${fmt(z.high)}`;

  const finish = (plan: TradePlan | null, reason?: string) => {
    map.plan = plan;
    map.alternate = null;
    map.movedSetup = null;
    map.mitigatedSetup = null;
    if (plan) {
      map.noSignalReason = undefined;
      map.confidence = Math.max(55, Math.min(92, plan.score));
    } else {
      map.noSignalReason = reason || map.noSignalReason;
      map.confidence = 50;
    }
    return read;
  };

  if (ltf.length < 40 || htf.length < 40) {
    read.text = `No signal. Confirmation analysis needs the ${label(ltfName)} chart, which can't be read right now. Try again shortly, or switch to Normal analysis.`;
    return finish(null, read.text);
  }

  const { window, freshBars } = confirmWindows(map.timeframe, ltfName);
  const atrH = map.atr;
  const rightSide = (z: SDZone) => (z.kind === 'DEMAND' ? z.territory === 'DISCOUNT' : z.territory === 'PREMIUM');

  // Candidate zones: on the right side of the dealing range, with institutional displacement, first or second touch
  const zones = [...map.demandZones, ...map.supplyZones].filter(z => rightSide(z) && !!z.fvg && z.tapCount <= 2 && z.distanceAtr <= 12);
  let best: { plan: ConfirmedPlan; score: number } | null = null;
  let waiting: { z: SDZone; reason?: string } | null = null;
  for (const z of zones) {
    const long = z.kind === 'DEMAND';
    const base = planForZone(z, htf, price, atrH, long ? map.supplyZones : map.demandZones, opts.slMode, dec, null);
    if (!base || base.confluence === 'ZONE_ONLY') continue;
    const L = long ? ltf : ltf.map(mirror);
    const top = long ? z.proximal : -z.proximal;
    const bottom = long ? z.distal : -z.distal;
    const rd = readLong(L, top, bottom, window, freshBars);
    if (rd.state === 'WAITING_PATTERN' && (!waiting || z.score > waiting.z.score)) waiting = { z, reason: rd.reason };
    if (rd.state !== 'CONFIRMED') continue;

    // Levels: market entry now, stop beyond the reaction's extreme wick, targets from the engine's ladder
    const atrL = computeAtr(L) || range(L[L.length - 1]);
    const buffer = atrL * (opts.slMode === 'tight' ? 0.2 : 0.4);
    const sgn = long ? 1 : -1;
    const ext = long ? rd.low : -rd.low;
    let stop = ext - sgn * buffer;
    const minRisk = atrL * (opts.slMode === 'tight' ? 0.5 : 0.8);
    if ((price - stop) * sgn < minRisk) stop = price - sgn * minRisk;
    const risk = (price - stop) * sgn;
    if (!(risk > 0)) continue;
    const rr = (p: number) => ((p - price) * sgn) / risk;
    const real = base.targets.map(t => ({ label: t.label, price: t.price })).filter(t => (t.price - price) * sgn > 0);
    const targets: TradePlan['targets'] = [];
    for (const t of real) {
      const v = rr(t.price);
      const prev = targets[targets.length - 1];
      if (!targets.length && v < 1) continue;
      if (prev && v - prev.rr < 0.5) continue;
      targets.push({ label: t.label, price: r(t.price), rr: Number(v.toFixed(2)) });
      if (targets.length === 3) break;
    }
    if (!targets.length) continue; // no real target pays at least 1R from here
    while (targets.length < 3) {
      const p = targets[targets.length - 1].price + sgn * risk * 1.5;
      targets.push({ label: 'Measured extension', price: r(p), rr: Number(rr(p).toFixed(2)) });
    }
    // Already moved: judged from the confirmation itself (its close and the TP1 that paid 1R from there), so a trade is
    // never re-offered at a worse price with a further target. A target reached since then, or price half-way to it = no.
    const conf = L[rd.confirmIdx];
    const confClose = long ? conf.c : -conf.c;
    const risk0 = (confClose - stop) * sgn;
    const refTp1 = risk0 > 0 ? real.find(t => ((t.price - confClose) * sgn) / risk0 >= 1)?.price : undefined;
    if (refTp1 === undefined) continue;
    const since = ltf.slice(rd.confirmIdx);
    if (since.some(c => (long ? c.h >= refTp1 : c.l <= refTp1))) continue;
    const progress = ((price - confClose) * sgn) / ((refTp1 - confClose) * sgn);
    if (progress >= 0.5) continue;

    const score = Math.max(0, Math.min(100, Math.round(base.score + Math.min(15, rd.patterns.length * 5) + (rd.divergence ? 5 : 0) + (rd.swept ? 3 : 0))));
    if (score < CONFIRM_MIN_SCORE) continue;
    const named = long ? rd.patterns : rd.patterns.map(sellWords);
    const patterns = rd.divergence ? [...named, `RSI ${long ? 'bullish' : 'bearish'} divergence`] : named;
    const note =
      `Confirmed on the ${label(ltfName)}: ${patterns.join(', ')} at the ${zoneWords(z)}` +
      `${rd.swept ? ` (price wicked through the zone to ${fmt(ext)} and closed back inside)` : ''}. Stop beyond the reaction ${long ? 'low' : 'high'} ${fmt(ext)}.`;
    const pad = Math.min(atrL * 0.15, risk * 0.25);
    const plan: ConfirmedPlan = {
      ...base,
      execution: 'MARKET',
      entry: { min: r(long ? price - pad : price), max: r(long ? price : price + pad), optimal: r(price) },
      stopLoss: r(stop),
      targets,
      rrFinal: targets[targets.length - 1].rr,
      score,
      mitigation: [],
      moved: null,
      confirmation: { ok: true, rsiOk: true, emaOk: true, divergence: rd.divergence, note },
      confirmEntry: {
        ltf: ltfName,
        patterns,
        confirmedAt: conf.t,
        confirmClose: r(long ? conf.c : -conf.c),
        reactionExtreme: r(ext),
        sweptZone: rd.swept,
        note,
      },
    };
    if (!best || score > best.score) best = { plan, score };
  }

  if (best) {
    const p = best.plan;
    Object.assign(read, { state: 'CONFIRMED', direction: p.direction, zone: { low: p.zone.low, high: p.zone.high, kind: p.zone.kind }, entry: p.confirmEntry, text: p.confirmEntry.note });
    return finish(p);
  }
  if (waiting) {
    const z = waiting.z;
    const side = z.kind === 'DEMAND' ? 'buy' : 'sell';
    Object.assign(read, { state: 'WAITING_PATTERN', direction: z.kind === 'DEMAND' ? 'LONG' : 'SHORT', zone: { low: z.low, high: z.high, kind: z.kind } });
    read.text =
      `Setup found, waiting for confirmation. Price is at the ${side} ${zoneWords(z)}, but the ${label(ltfName)} has not confirmed it yet` +
      `${waiting.reason ? ` (${waiting.reason})` : ''}. MarketX only calls it once price shows it is respecting the zone: a liquidity sweep or false breakout, ` +
      `an engulfing candle, a pin bar, a ${z.kind === 'DEMAND' ? 'morning' : 'evening'} star or a break of the ${label(ltfName)} structure. Stand aside until then.`;
    return finish(null, read.text);
  }
  if (normalPlan) {
    const z = normalPlan.zone;
    const side = normalPlan.direction === 'LONG' ? 'buy' : 'sell';
    Object.assign(read, { state: 'WAITING_TAP', direction: normalPlan.direction, zone: { low: z.low, high: z.high, kind: z.kind } });
    read.text =
      `Setup found, waiting for confirmation. The ${side} setup from the ${zoneWords(z)} is valid (score ${normalPlan.score}), but price has not reached it yet. ` +
      `Confirmation analysis does not place a pending order: when price taps the zone, MarketX reads the ${label(ltfName)} for a confirmation ` +
      `(sweep, engulfing, pin bar, star or structure break) and only then gives the entry and a stop beyond the reaction wick. Add the pair to your watchlist to be told the moment it confirms.`;
    return finish(null, read.text);
  }
  read.text = map.noSignalReason || 'No signal. No zone is setting up for a confirmation entry right now.';
  return finish(null, read.text);
}
