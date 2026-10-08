// ===========================================================================
// Trade lock (owner-specified): one running trade per trader, per pair, per timeframe
//
// Every analysis is still computed fresh from live candles and the live price; nothing is replayed or shared
// between traders. The lock only decides whether a NEW buy or sell may go out to THIS trader:
//   - while their last trade on the same pair and timeframe is still running (waiting for its entry, or in the
//     trade), no new trade is served on that pair and timeframe, buy or sell;
//   - the lock ends when TP1 is hit, the stop loss is hit, TP1 comes before the entry (played out), the entry is
//     not filled within FILL_CANDLES candles, or the trade's alert window ends;
//   - after a stop loss, the OPPOSITE side waits COOLDOWN_CANDLES candles, so a stop-out never flips straight
//     into the other direction.
// A blocked trade is served as NO_SIGNAL with the running trade's status at the live price, and the credit is
// given back. Other traders are never affected: each trader only ever sees their own trades.
// The engine (server/strategy.ts, prompts, models) is untouched: this runs on the finished result.
// ===========================================================================
import type { Request, Response, NextFunction } from 'express';
import { db, isFirebaseConfigured } from './firebase';
import { evaluateBars, levelsFromStrategy, tfMinutes, type AlertHit, type AlertOffer, type Bar, type PriceAlert } from './priceAlerts';
import { exactPrice } from '../src/utils/formatPrice';
import { withDefaults } from '../src/utils/preferences';

// A pending entry gets 6 candles to fill: zones that react do so within a few candles, and a zone that stays untouched for
// longer has usually gone stale, so the next valid setup on the pair is never held back for long
const FILL_CANDLES = 6;
const COOLDOWN_CANDLES = 3;
const LOOKBACK_MS = 22 * 86400e3;
const MAX_WAIT_MS = 4000;

export type LockSide = 'LONG' | 'SHORT';
export interface RunningTrade {
  offerId: string;
  direction: LockSide;
  symbol: string;
  timeframe: string;
  entry: { min: number; max: number; optimal: number };
  stop: number;
  tps: number[];
  issuedAt: number;
  state: 'WAITING_ENTRY' | 'IN_TRADE';
  /** Waiting for the entry: the time it stops waiting (not filled by then = the lock ends) */
  fillBy?: number;
  /** When the trade's watch window ends at the latest */
  endsAt: number;
  userStrategy?: string;
}
export type LockVerdict =
  | { kind: 'RUNNING'; trade: RunningTrade }
  | { kind: 'COOLDOWN'; stopped: RunningTrade; stoppedAt: number; until: number }
  | null;

/** Candles for a symbol on a timeframe (oldest first), or null when the feed has none */
type GetBars = (symbol: string, tf: string) => Promise<Bar[] | null>;
let getBars: GetBars | null = null;
export function configureSignalLock(deps: { getBars: GetBars }) {
  getBars = deps.getBars;
}

export const fillWindowMs = (tf: string) => Math.max(30 * 60e3, tfMinutes(tf) * FILL_CANDLES * 60e3);
export const cooldownMs = (tf: string) => Math.max(15 * 60e3, tfMinutes(tf) * COOLDOWN_CANDLES * 60e3);

// Finest series that reaches back to the trade's issue time (feeds return ~300 bars), as the proof tracker does
const TRACK_TFS: Array<[string, number]> = [['1M', 1], ['15M', 15], ['1H', 60], ['4H', 240]];

type TradeStatus =
  | { running: true; state: 'WAITING_ENTRY' | 'IN_TRADE'; fillBy?: number }
  | { running: false; endedBy: 'TP' | 'SL' | 'MISSED' | 'NOT_FILLED' | 'EXPIRED' | 'UNKNOWN'; endedAt: number };

/** Where one of the trader's earlier trades stands now, from every hit known (earliest end wins) */
export function statusFromHits(offer: AlertOffer, hits: AlertHit[], now: number): TradeStatus {
  const sorted = [...hits].sort((a, b) => a.at - b.at);
  const end = sorted.find(h => h.kind === 'SL' || h.kind === 'MISSED' || h.kind.startsWith('TP'));
  if (end) return { running: false, endedBy: end.kind === 'SL' ? 'SL' : end.kind === 'MISSED' ? 'MISSED' : 'TP', endedAt: end.at };
  if (now >= offer.expiresAt) return { running: false, endedBy: 'EXPIRED', endedAt: offer.expiresAt };
  // A market entry is filled the moment it is served; a limit entry is filled once price reaches the zone
  if (offer.execution === 'MARKET' || sorted.some(h => h.kind === 'ENTRY')) return { running: true, state: 'IN_TRADE' };
  const fillBy = offer.createdAt + fillWindowMs(offer.timeframe);
  if (now >= fillBy) return { running: false, endedBy: 'NOT_FILLED', endedAt: fillBy };
  return { running: true, state: 'WAITING_ENTRY', fillBy };
}

async function tradeStatus(offer: AlertOffer, alert: PriceAlert | undefined, series: (tf: string) => Promise<Bar[] | null>, now: number): Promise<TradeStatus> {
  if (now >= offer.expiresAt) return { running: false, endedBy: 'EXPIRED', endedAt: offer.expiresAt };
  const hits: AlertHit[] = [];
  let known = false;
  // An alert the trader kept on is checked every 15s on 1-minute candles, but only from the moment it was switched on
  if (alert && (alert.active || (alert.endedReason && alert.endedReason !== 'TURNED_OFF'))) {
    hits.push(...(alert.hits || []));
    known = true;
  }
  // Fresh candles cover the whole life of the trade, from the moment it was served (a hit before the alert started counts)
  for (const [tf] of TRACK_TFS) {
    const bars = await series(tf);
    if (!bars || !bars.length || bars[0].t > offer.createdAt) continue;
    const ev = evaluateBars({ direction: offer.direction, entry: offer.entry, stop: offer.stop, tps: offer.tps, entered: offer.execution === 'MARKET', hits: [], createdAt: offer.createdAt }, bars);
    hits.push(...ev.hits);
    known = true;
    break;
  }
  // Neither an alert nor candles reach back that far: not provable either way, so the trader is never blocked on a guess
  if (!known) return { running: false, endedBy: 'UNKNOWN', endedAt: offer.createdAt };
  return statusFromHits(offer, hits, now);
}

const toTrade = (o: AlertOffer, st: { state: 'WAITING_ENTRY' | 'IN_TRADE'; fillBy?: number }): RunningTrade => ({
  offerId: o.id,
  direction: o.direction,
  symbol: o.symbol,
  timeframe: o.timeframe,
  entry: o.entry,
  stop: o.stop,
  tps: o.tps,
  issuedAt: o.createdAt,
  state: st.state,
  fillBy: st.fillBy,
  endsAt: o.expiresAt,
  ...(o.userStrategy ? { userStrategy: o.userStrategy } : {}),
});

/** The trader's own choice in Preference Mode (off by default; on only once they turn it on): when on, it applies everywhere for them */
export async function tradeLockOn(uid: string): Promise<boolean> {
  const doc = (await db().collection('users').doc(uid).get()).data() as { preferences?: unknown } | undefined;
  return withDefaults(doc?.preferences as any).tradeLock;
}

// Two analyses finishing at the same moment would both pass before the first one's offer is saved: a trade that just
// passed is reserved here (per worker) for a short while, and a second one on the same trader, pair and timeframe is held
const RESERVE_MS = 30_000;
const reserved = new Map<string, { trade: RunningTrade; until: number }>();
const reserveKey = (uid: string, symbol: string, tf: string) => `${uid}|${symbol}|${tf}`;
function reservedTrade(uid: string, symbol: string, tf: string, now: number): RunningTrade | null {
  const k = reserveKey(uid, symbol, tf);
  const r = reserved.get(k);
  if (!r) return null;
  if (r.until <= now) {
    reserved.delete(k);
    return null;
  }
  return r.trade;
}
function release(key: string) {
  reserved.delete(key);
}
function reserve(uid: string, s: any, now: number): string | null {
  if (reserved.size > 5000) for (const [k, v] of reserved) if (v.until <= now) reserved.delete(k);
  const lv = levelsFromStrategy(s);
  if (!lv) return null;
  const key = reserveKey(uid, lv.symbol, lv.timeframe);
  reserved.set(key, {
    until: now + RESERVE_MS,
    trade: { offerId: '', direction: lv.direction, symbol: lv.symbol, timeframe: lv.timeframe, entry: lv.entry, stop: lv.stop, tps: lv.tps, issuedAt: now, state: lv.execution === 'MARKET' ? 'IN_TRADE' : 'WAITING_ENTRY', fillBy: lv.execution === 'MARKET' ? undefined : now + fillWindowMs(lv.timeframe), endsAt: now + RESERVE_MS },
  });
  return key;
}

/** This trader's running trade (or stop-loss cool-down) on a pair and timeframe; null = free to trade */
export async function tradeLockFor(uid: string, symbol: string, timeframe: string, now = Date.now()): Promise<LockVerdict> {
  if (!uid || !symbol || !timeframe) return null;
  const [offerSnap, alertSnap] = await Promise.all([
    db().collection('alertOffers').where('uid', '==', uid).where('symbol', '==', symbol).where('timeframe', '==', timeframe).get(),
    db().collection('priceAlerts').where('uid', '==', uid).where('symbol', '==', symbol).where('timeframe', '==', timeframe).get(),
  ]);
  const offers = offerSnap.docs
    .map(d => d.data() as AlertOffer)
    .filter(o => o && (o.direction === 'LONG' || o.direction === 'SHORT') && o.createdAt > now - LOOKBACK_MS && o.createdAt <= now)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 8);
  if (!offers.length) return null;
  const alerts = alertSnap.docs.map(d => d.data() as PriceAlert);
  const alertFor = (o: AlertOffer) => alerts.find(a => a.id === `al_${o.id}` || a.id === o.alertId || (a.offerIds || []).includes(o.id));
  const cache = new Map<string, Promise<Bar[] | null>>();
  const series = (tf: string) => {
    if (!getBars) return Promise.resolve(null);
    if (!cache.has(tf)) cache.set(tf, getBars(symbol, tf).catch(() => null));
    return cache.get(tf)!;
  };
  let cooldown: LockVerdict = null;
  for (const o of offers) {
    const st = await tradeStatus(o, alertFor(o), series, now);
    if (!('endedBy' in st)) return { kind: 'RUNNING', trade: toTrade(o, st) };
    if (!cooldown && st.endedBy === 'SL' && now - st.endedAt < cooldownMs(timeframe)) {
      cooldown = { kind: 'COOLDOWN', stopped: toTrade(o, { state: 'IN_TRADE' }), stoppedAt: st.endedAt, until: st.endedAt + cooldownMs(timeframe) };
    }
  }
  return cooldown;
}

/** The trader's running trade on a pair and timeframe (a trade served moments ago included), or null; used before the engine runs */
export async function runningTradeFor(uid: string, symbol: string, timeframe: string, now = Date.now()): Promise<Extract<LockVerdict, { kind: 'RUNNING' }> | null> {
  const held = reservedTrade(uid, symbol, timeframe, now);
  if (held) return { kind: 'RUNNING', trade: held };
  const v = await tradeLockFor(uid, symbol, timeframe, now);
  return v && v.kind === 'RUNNING' ? v : null;
}

/** A running trade blocks every new trade on its pair and timeframe; a stop-loss cool-down only blocks the other side */
export function lockBlocks(v: LockVerdict, side: LockSide): boolean {
  if (!v) return false;
  if (v.kind === 'RUNNING') return true;
  return v.stopped.direction !== side;
}

// ---------------------------------------------------------------------------
// The served result
// ---------------------------------------------------------------------------
const sideWord = (d: LockSide) => (d === 'LONG' ? 'buy' : 'sell');
const SIDE = (d: LockSide) => (d === 'LONG' ? 'BUY' : 'SELL');
const px = (n: number) => (Number.isFinite(n) ? exactPrice(n) : String(n));

export function inWords(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60e3));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h < 48) return r ? `${h} h ${r} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

/** Turns a blocked LONG / SHORT into NO_SIGNAL that shows the trader's running trade at the live price */
export function applyLock(s: any, v: Exclude<LockVerdict, null>, now = Date.now(), charged = true) {
  const creditLine = charged ? 'Your credit was given back.' : 'No credit was used.';
  const price = Number(s.currentPrice);
  const live = Number.isFinite(price) && price > 0 ? price : null;
  const pair = `${s.symbol} · ${s.timeframe}`;
  const blockedSide = s.tradeType as LockSide;
  let verdict: string;
  let details: string;
  let lines: string[];
  if (v.kind === 'RUNNING') {
    const t = v.trade;
    verdict = 'Your trade is still running';
    details = `Your ${SIDE(t.direction)} on ${pair} from ${inWords(now - t.issuedAt)} ago is still running. No new trade on this pair and timeframe until it ends.`;
    lines = [
      `> **One trade at a time:** your ${SIDE(t.direction)} on ${pair}${t.userStrategy ? ` (personal strategy: ${t.userStrategy})` : ''} from ${inWords(now - t.issuedAt)} ago has not ended yet, so MarketX gives you no new buy or sell here until it does. ${creditLine}`,
      '',
      `#### Your running ${sideWord(t.direction)}`,
      `- **Status:** ${t.state === 'IN_TRADE' ? 'in the trade, entry filled' : `waiting for the entry, ${t.fillBy ? `until about ${inWords(t.fillBy - now)} from now` : 'still valid'}`}`,
      `- **Entry zone:** ${px(t.entry.min)} to ${px(t.entry.max)}`,
      `- **Stop loss:** ${px(t.stop)}`,
      ...t.tps.map((p, i) => `- **TP${i + 1}:** ${px(p)}`),
      ...(live ? [`- **Live price now:** ${px(live)}`] : []),
      '',
      `The lock ends as soon as TP1 or the stop loss is hit, price reaches TP1 before the entry, or the entry is not filled in time. Then ask again for a fresh analysis at the live price.`,
    ];
  } else {
    const t = v.stopped;
    verdict = 'Cooling down after a stop loss';
    details = `Your ${SIDE(t.direction)} on ${pair} hit its stop loss ${inWords(now - v.stoppedAt)} ago. No ${SIDE(blockedSide)} on this pair and timeframe for about ${inWords(v.until - now)}.`;
    lines = [
      `> **No flip after a stop loss:** your ${SIDE(t.direction)} on ${pair} hit its stop loss ${inWords(now - v.stoppedAt)} ago. MarketX doesn't turn straight into a ${SIDE(blockedSide)} on the same pair and timeframe, so this one waits about ${inWords(v.until - now)} more. ${creditLine}`,
      '',
      ...(live ? [`- **Live price now:** ${px(live)}`, ''] : []),
      `After that, ask again and MarketX reads the chart fresh at the live price. A ${SIDE(t.direction)} on this pair is not held back.`,
    ];
  }
  s.tradeType = 'NO_SIGNAL';
  s.bias = 'NEUTRAL';
  if (live) {
    s.entryZone = { min: live, max: live, optimal: live, rationale: `No new trade: ${verdict.toLowerCase()}` };
    s.stopLoss = { price: live, riskPercent: 0, rationale: 'No new position, so no stop' };
  }
  s.takeProfits = [];
  s.riskRewardRatio = '1 : 0';
  for (const k of ['execution', 'setupCheck', 'proof', 'alertOffer', 'alreadyMoved', 'alreadyMitigated']) delete s[k];
  s.signalStatus = { state: 'PENDING_CONFIRMATION', verdict, details };
  s.signalLock =
    v.kind === 'RUNNING'
      ? { reason: 'RUNNING', side: v.trade.direction, state: v.trade.state, issuedAt: v.trade.issuedAt, entry: { min: v.trade.entry.min, max: v.trade.entry.max }, stop: v.trade.stop, tp1: v.trade.tps[0], fillBy: v.trade.fillBy ?? null }
      : { reason: 'COOLDOWN', side: v.stopped.direction, stoppedAt: v.stoppedAt, until: v.until };
  s.detailedThesis = lines.join('\n');
  return s;
}

/**
 * Wraps res.json on /api/market/analyze (installed after the alert offer, proof and safety wrappers, so it runs
 * first: a blocked trade never becomes an alert offer or a seal). Never holds a result for more than MAX_WAIT_MS,
 * and on any error the result goes out unchanged.
 */
export function signalLockMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isFirebaseConfigured()) return next();
  const json = res.json.bind(res);
  res.json = ((body: any) => {
    const uid = (res.locals.user as any)?.uid as string | undefined;
    const s = body?.strategy;
    if (!uid || res.statusCode >= 400 || !s || (s.tradeType !== 'LONG' && s.tradeType !== 'SHORT') || !levelsFromStrategy(s)) return json(body);
    // Tighten SL re-sends the trader's own trade with a closer stop: the same trade, never a new one, so it is not held
    if (res.locals.tightenedSetup) return json(body);
    let sent = false;
    const sym = String(s.symbol).slice(0, 32);
    const tf = String(s.timeframe).slice(0, 8);
    const check = tradeLockOn(uid)
      .then(async on => {
        if (!on) return { on, v: null as LockVerdict };
        const held = reservedTrade(uid, sym, tf, Date.now());
        return { on, v: held ? ({ kind: 'RUNNING', trade: held } as LockVerdict) : await tradeLockFor(uid, sym, tf) };
      })
      .then(({ on, v }) => {
        if (sent) return;
        if (!lockBlocks(v, s.tradeType)) {
          if (on) {
            // Held only until the response is out: its offer is saved by then, and the stored trade takes over
            const key = reserve(uid, s, Date.now());
            if (key) res.once('close', () => release(key));
          }
          return;
        }
        applyLock(s, v!);
        if (typeof body.message === 'string') body.message = s.detailedThesis;
        res.locals.refundCredit = true;
        console.log(`[MarketX Lock] ${s.symbol} ${s.timeframe}: new trade held back (${v!.kind})`);
      })
      .catch(err => console.warn('[MarketX Lock] check failed:', err?.message || err));
    Promise.race([check, new Promise(r => setTimeout(r, MAX_WAIT_MS))]).then(() => {
      sent = true;
      json(body);
    });
    return res;
  }) as typeof res.json;
  next();
}
