import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { db } from './firebase';
import { getUser, requireAuth } from './account';
import { requirePro } from './proAccess';
import { createKeyedThrottle } from './security';
import { formatMarketPrice } from '../src/utils/formatPrice';

// ===========================================================================
// Trade Journal (/trade-journal) and Track Record (/track-record)
//
//   journalTrades/{id} -> a trade in the journal. Manual: logged by the trader. Auto: opened the moment the trader turns
//                         on a price alert for a signal, then scored once by the server when the alert ends (entry,
//                         targets or stop from checked candles), after which it is finished and only its notes change.
//   trackRecord/{id}   -> the outcome of every MarketX signal a trader watched with a price alert, written by the
//                         alert monitor when the alert finishes (id = the alert id, so it is written once). Outcomes
//                         come only from candles the server checked: nobody can type them in.
//
// The journal's numbers (win rate, average R, P/L) are worked out on the server from the trades themselves.
// ===========================================================================

const TRADES = 'journalTrades';
const RECORDS = 'trackRecord';
export const MAX_TRADES = 1000;
const LIST_LIMIT = 200;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const positive = (n: unknown): n is number => finite(n) && n > 0;

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------
export interface JournalTrade {
  id: string;
  uid: string;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  stop: number | null;
  target: number | null;
  exit: number | null;
  size: number | null;
  /** Profit or loss in the trader's account currency (optional) */
  pnl: number | null;
  status: 'OPEN' | 'CLOSED';
  /** NO_FILL: an auto trade whose entry was never reached (not counted in the stats) */
  result: 'WIN' | 'LOSS' | 'BE' | 'NO_FILL' | null;
  /** Result in R (risk units), when the stop loss is known */
  r: number | null;
  timeframe: string;
  notes: string;
  openedAt: number;
  closedAt: number | null;
  createdAt: number;
  updatedAt: number;
  /** MANUAL (typed by the trader) or AUTO (from a price alert); missing on older trades = MANUAL */
  source?: 'MANUAL' | 'AUTO';
  /** Strategy Builder: logged from a trade the trader's own strategy found (shown as "Personal strategy") */
  userStrategy?: string;
  /** Auto trades only */
  auto?: AutoInfo;
}
export interface AutoInfo {
  alertId: string;
  /** TRACKING: the alert is still watching. DONE: scored once, finished. HANDED_OVER: the alert ended while the trade
   *  was open with no target or stop reached, so the trader closes it by hand */
  state: 'TRACKING' | 'DONE' | 'HANDED_OVER';
  execution: 'LIMIT' | 'MARKET';
  targets: number[];
  tpsHit: number;
  endedReason: string | null;
  enteredAt: number | null;
  /** Plain-English account of how the trade played out, written once when it ends */
  summary: string;
}

const cleanText = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Result and R of a closed trade, from its prices (P/L decides when there is no exit price) */
export function scoreTrade(t: Pick<JournalTrade, 'direction' | 'entry' | 'stop' | 'exit' | 'pnl'>): { result: JournalTrade['result']; r: number | null } {
  const long = t.direction === 'LONG';
  let r: number | null = null;
  if (positive(t.exit) && positive(t.stop) && t.stop !== t.entry) {
    const risk = Math.abs(t.entry - t.stop);
    r = Number((((t.exit - t.entry) * (long ? 1 : -1)) / risk).toFixed(2));
  }
  let move: number | null = null;
  if (positive(t.exit)) move = (t.exit - t.entry) * (long ? 1 : -1);
  else if (finite(t.pnl)) move = t.pnl;
  if (move === null) return { result: null, r };
  // Within 0.05% of the entry (or a P/L of exactly 0) counts as break-even
  const be = positive(t.exit) ? Math.abs(t.exit - t.entry) / t.entry < 0.0005 : move === 0;
  return { result: be ? 'BE' : move > 0 ? 'WIN' : 'LOSS', r };
}

/** Validates a trade from the client; returns the clean fields or an error message */
/** Same pair, side and levels: the same trade */
export function sameTrade(a: Pick<JournalTrade, 'symbol' | 'direction' | 'entry' | 'stop' | 'target'>, b: Pick<JournalTrade, 'symbol' | 'direction' | 'entry' | 'stop' | 'target'>): boolean {
  return a.symbol.toUpperCase() === b.symbol.toUpperCase() && a.direction === b.direction && a.entry === b.entry && (a.stop ?? null) === (b.stop ?? null) && (a.target ?? null) === (b.target ?? null);
}

export function parseTrade(body: any, existing?: JournalTrade): { trade?: Omit<JournalTrade, 'id' | 'uid' | 'createdAt' | 'updatedAt'>; error?: string } {
  const pick = <K extends keyof JournalTrade>(k: K) => (body?.[k] !== undefined ? body[k] : existing?.[k]);
  const symbol = cleanText(pick('symbol'), 24).toUpperCase();
  if (!symbol) return { error: 'Add the market you traded, for example EURUSD or BTC.' };
  const direction = String(pick('direction') || '').toUpperCase();
  if (direction !== 'LONG' && direction !== 'SHORT') return { error: 'Pick Buy or Sell.' };
  const entry = num(pick('entry'));
  if (!positive(entry) || entry > 1e12) return { error: 'Add a valid entry price.' };
  const field = (k: 'stop' | 'target' | 'exit' | 'size') => {
    const v = num(pick(k));
    return v === null ? null : positive(v) && v < 1e12 ? v : NaN;
  };
  const stop = field('stop'), target = field('target'), exit = field('exit'), size = field('size');
  if ([stop, target, exit, size].some(v => Number.isNaN(v))) return { error: 'Prices and size must be positive numbers.' };
  const long = direction === 'LONG';
  if (stop !== null && (long ? stop >= entry : stop <= entry)) return { error: long ? 'For a buy, the stop loss goes below the entry.' : 'For a sell, the stop loss goes above the entry.' };
  if (target !== null && (long ? target <= entry : target >= entry)) return { error: long ? 'For a buy, the target goes above the entry.' : 'For a sell, the target goes below the entry.' };
  const pnlRaw = num(pick('pnl'));
  if (pnlRaw !== null && Math.abs(pnlRaw) > 1e12) return { error: 'That profit or loss looks too large.' };
  const closing = body?.status === 'CLOSED' || (body?.status === undefined && (exit !== null || pnlRaw !== null || existing?.status === 'CLOSED'));
  const status: JournalTrade['status'] = body?.status === 'OPEN' ? 'OPEN' : closing ? 'CLOSED' : 'OPEN';
  if (status === 'CLOSED' && exit === null && pnlRaw === null) return { error: 'To close a trade, add the exit price or the profit/loss.' };
  const t = Date.now();
  const openedRaw = num(pick('openedAt'));
  const openedAt = openedRaw && openedRaw > 946684800000 && openedRaw <= t + 86400e3 ? openedRaw : existing?.openedAt || t;
  const timeframe = cleanText(pick('timeframe'), 6).toUpperCase();
  const scored = status === 'CLOSED' ? scoreTrade({ direction: direction as 'LONG' | 'SHORT', entry, stop, exit, pnl: pnlRaw }) : { result: null, r: null };
  return {
    trade: {
      symbol, direction: direction as 'LONG' | 'SHORT', entry, stop, target, exit: status === 'CLOSED' ? exit : null, size,
      pnl: status === 'CLOSED' ? pnlRaw : null, status, result: scored.result, r: scored.r,
      timeframe: /^[0-9]{1,2}[MHDW]$/.test(timeframe) ? timeframe : '', notes: cleanText(pick('notes'), 600),
      openedAt, closedAt: status === 'CLOSED' ? existing?.closedAt || t : null,
    },
  };
}

export function journalStats(trades: JournalTrade[]) {
  const closed = trades.filter(t => t.status === 'CLOSED' && (t.result === 'WIN' || t.result === 'LOSS' || t.result === 'BE'));
  const wins = closed.filter(t => t.result === 'WIN').length;
  const losses = closed.filter(t => t.result === 'LOSS').length;
  const be = closed.filter(t => t.result === 'BE').length;
  const rs = closed.map(t => t.r).filter(finite);
  const pnls = closed.map(t => t.pnl).filter(finite);
  const bySymbol = new Map<string, { trades: number; wins: number; pnl: number }>();
  for (const t of closed) {
    const s = bySymbol.get(t.symbol) || { trades: 0, wins: 0, pnl: 0 };
    s.trades++;
    if (t.result === 'WIN') s.wins++;
    if (finite(t.pnl)) s.pnl += t.pnl;
    bySymbol.set(t.symbol, s);
  }
  const markets = [...bySymbol.entries()].map(([symbol, s]) => ({ symbol, ...s, winRate: Math.round((s.wins / s.trades) * 100) })).sort((a, b) => b.trades - a.trades || b.wins - a.wins);
  // Current streak, newest first
  const sorted = [...closed].sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
  let streak = 0;
  const streakKind = sorted[0]?.result === 'WIN' ? 'WIN' : sorted[0]?.result === 'LOSS' ? 'LOSS' : null;
  if (streakKind) for (const t of sorted) { if (t.result === streakKind) streak++; else if (t.result !== 'BE') break; }
  return {
    total: trades.length,
    open: trades.filter(t => t.status === 'OPEN').length,
    closed: closed.length,
    wins, losses, breakeven: be,
    winRate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : null,
    avgR: rs.length ? Number((rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(2)) : null,
    totalR: rs.length ? Number(rs.reduce((a, b) => a + b, 0).toFixed(2)) : null,
    pnl: pnls.length ? Number(pnls.reduce((a, b) => a + b, 0).toFixed(2)) : null,
    bestMarket: markets.filter(m => m.trades >= 2).sort((a, b) => b.winRate - a.winRate || b.trades - a.trades)[0]?.symbol || null,
    markets: markets.slice(0, 6),
    streak: streakKind ? { kind: streakKind, count: streak } : null,
  };
}

async function loadTrades(uid: string) {
  const snap = await db().collection(TRADES).where('uid', '==', uid).get();
  return snap.docs.map(d => d.data() as JournalTrade).sort((a, b) => b.openedAt - a.openedAt || b.createdAt - a.createdAt);
}
const tradeView = ({ uid: _u, ...t }: JournalTrade) => t;
async function journalPayload(uid: string) {
  const trades = await loadTrades(uid);
  return { trades: trades.slice(0, LIST_LIMIT).map(tradeView), stats: journalStats(trades), max: MAX_TRADES };
}

// ---------------------------------------------------------------------------
// Track record: outcomes of watched MarketX signals
// ---------------------------------------------------------------------------
/** ENDED: a day / swing trade still open at its close time (9:00 PM WAT), recorded at the price then with its R */
export type SignalOutcome = 'WIN' | 'LOSS' | 'MISSED' | 'NO_FILL' | 'OPEN' | 'ENDED';
export interface TrackRecordEntry {
  id: string;
  uid: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  outcome: SignalOutcome;
  /** Take profits reached (0-3) */
  tpsHit: number;
  tpsTotal: number;
  createdAt: number;
  closedAt: number;
  /** signalKey of the signal (records made before it was stored are matched by the cleanup) */
  signalKey?: string;
  /** Strategy mode: the trader's own strategy (counted in their own record, not in MarketX's) */
  userStrategy?: string;
  /** R made: at the furthest target reached for a win (even when the stop came after it), -1 for a loss, at the close
   *  price for an ENDED trade */
  r?: number;
  /** Trade type of the signal (SCALP, DAY, SWING) */
  tradeStyle?: string;
}
export interface AlertLike {
  id: string; uid: string; symbol: string; timeframe: string; direction: 'LONG' | 'SHORT'; tps: number[]; entered: boolean;
  hits: Array<{ kind: string; at: number; price?: number }>; createdAt: number; updatedAt?: number; active: boolean; endedReason?: string;
  entry?: { min: number; max: number; optimal: number }; stop?: number; execution?: 'LIMIT' | 'MARKET'; userStrategy?: string;
  tradeStyle?: string; closeBy?: number;
}

/**
 * The same signal (pair, timeframe, side and every level), however many times it was served or turned on. Used so a
 * signal is only ever one price alert, one journal trade and one track record result.
 */
export function signalKey(a: { symbol: string; timeframe: string; direction: string; entry?: { min: number; max: number; optimal: number }; stop?: number; tps: number[] }): string {
  const parts = [String(a.symbol).toUpperCase(), String(a.timeframe || '').toUpperCase(), a.direction, a.entry?.min, a.entry?.max, a.entry?.optimal, a.stop, a.tps];
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

/**
 * R of a finished (or running) signal, from its own levels: a win is scored at the furthest target reached, even when
 * price came back to the stop after it (owner rule: TP1 first is a win, never a loss); a loss is the stop hit first.
 */
export function outcomeR(a: Pick<AlertLike, 'direction' | 'entry' | 'stop' | 'tps'> & { hits?: AlertLike['hits'] }, outcome: SignalOutcome, tpsHit: number): number | undefined {
  const entry = a.entry?.optimal;
  if (!(Number(entry) > 0) || !(Number(a.stop) > 0) || entry === a.stop) return undefined;
  const risk = Math.abs((entry as number) - (a.stop as number));
  if (outcome === 'LOSS') return -1;
  if (outcome === 'ENDED') {
    const end = a.hits?.find(h => h.kind === 'END')?.price;
    if (!(Number(end) > 0)) return undefined;
    return Number(((((end as number) - (entry as number)) * (a.direction === 'LONG' ? 1 : -1)) / risk).toFixed(2));
  }
  if (outcome !== 'WIN' || tpsHit < 1) return undefined;
  const tp = a.tps[Math.min(tpsHit, a.tps.length) - 1];
  if (!(Number(tp) > 0)) return undefined;
  return Number((((tp - (entry as number)) * (a.direction === 'LONG' ? 1 : -1)) / risk).toFixed(2));
}

/** Outcome of an alert: a win once a target is hit (also when the stop comes after it), a loss only when the stop
 *  goes first, otherwise no result */
export function outcomeOf(a: AlertLike): { outcome: SignalOutcome; tpsHit: number } {
  const tpsHit = a.hits.reduce((m, h) => { const x = /^TP(\d)$/.exec(h.kind); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  if (tpsHit > 0) return { outcome: 'WIN', tpsHit };
  if (a.hits.some(h => h.kind === 'SL')) return { outcome: 'LOSS', tpsHit: 0 };
  if (a.hits.some(h => h.kind === 'MISSED')) return { outcome: 'MISSED', tpsHit: 0 };
  // The trade type's close time came first: an open trade ended there; one never entered had no trade
  if (a.hits.some(h => h.kind === 'END')) return { outcome: a.entered ? 'ENDED' : 'NO_FILL', tpsHit: 0 };
  if (a.active) return { outcome: 'OPEN', tpsHit: 0 };
  return { outcome: a.entered ? 'OPEN' : 'NO_FILL', tpsHit: 0 };
}

/** Called by the alert monitor when an alert finishes: closes its auto journal trade (once), then writes the track
 *  record (id = alert id). Only real results join the track record. */
export async function archiveAlertOutcome(a: AlertLike): Promise<void> {
  await closeAutoJournal(a).catch(err => console.warn('[MarketX Journal] auto close failed:', err?.message || err));
  const { outcome, tpsHit } = outcomeOf({ ...a, active: false });
  if (outcome !== 'WIN' && outcome !== 'LOSS' && outcome !== 'MISSED' && outcome !== 'ENDED') return;
  const last = a.hits.length ? Math.max(...a.hits.map(h => h.at)) : Date.now();
  const entry: TrackRecordEntry = {
    id: a.id, uid: a.uid, symbol: a.symbol, timeframe: a.timeframe, direction: a.direction, outcome, tpsHit,
    tpsTotal: a.tps.length, createdAt: a.createdAt, closedAt: last, signalKey: signalKey(a),
    ...(a.userStrategy ? { userStrategy: a.userStrategy } : {}),
    ...(a.tradeStyle ? { tradeStyle: a.tradeStyle } : {}),
  };
  const rMade = outcomeR(a, outcome, tpsHit);
  if (rMade !== undefined) entry.r = rMade;
  // One result per signal per trader: a twin record of the same signal is never added
  const twins = (await db().collection(RECORDS).where('uid', '==', a.uid).get()).docs.map(d => d.data() as TrackRecordEntry);
  if (twins.some(t => t.id !== a.id && t.signalKey === entry.signalKey)) return;
  await db().collection(RECORDS).doc(a.id).set(entry);
}

// ---------------------------------------------------------------------------
// Auto journal: price alerts write the trade in, then score it once when the alert ends
// ---------------------------------------------------------------------------
/** One journal id per alert, so turning the same alert on twice never logs the trade twice */
export const autoJournalId = (alertId: string) => `jt_${crypto.createHash('sha256').update(`auto:${alertId}`).digest('hex').slice(0, 16)}`;

const durationText = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

/** Called when the trader turns on a price alert: the trade is logged straight away, marked as tracked by the alert */
export async function openAutoJournal(a: AlertLike): Promise<void> {
  if (!a.entry || !positive(a.stop) || !a.tps.length) return;
  const ref = db().collection(TRADES).doc(autoJournalId(a.id));
  const count = (await db().collection(TRADES).where('uid', '==', a.uid).get()).docs.length;
  await db().runTransaction(async tx => {
    const cur = await tx.get(ref);
    // Already logged (the alert was turned off and on again): a trade still tracked keeps going, a finished one stays
    if (cur.exists) {
      const t = cur.data() as JournalTrade;
      // Still tracked, or already scored: leave it. The one exception is an alert switched off before its entry and
      // switched back on: that "no fill" was only a pause, so the trade is tracked again.
      const pausedNoFill = t.auto?.state === 'DONE' && t.result === 'NO_FILL' && t.auto.endedReason === 'TURNED_OFF';
      if ((t.auto?.state === 'DONE' && !pausedNoFill) || t.auto?.state === 'TRACKING') return;
    } else if (count >= MAX_TRADES) return;
    const now = Date.now();
    const entered = a.execution === 'MARKET' || a.entered;
    const doc: JournalTrade = {
      id: ref.id, uid: a.uid, symbol: cleanText(a.symbol, 24).toUpperCase(), direction: a.direction,
      entry: a.entry!.optimal, stop: a.stop!, target: a.tps[a.tps.length - 1], exit: null, size: null, pnl: null,
      status: 'OPEN', result: null, r: null, timeframe: /^[0-9]{1,2}[MHDW]$/.test(String(a.timeframe).toUpperCase()) ? String(a.timeframe).toUpperCase() : '',
      notes: cur.exists ? (cur.data() as JournalTrade).notes : '',
      openedAt: cur.exists ? (cur.data() as JournalTrade).openedAt : now, closedAt: null,
      createdAt: cur.exists ? (cur.data() as JournalTrade).createdAt : now, updatedAt: now, source: 'AUTO',
      ...(a.userStrategy ? { userStrategy: cleanText(a.userStrategy, 48) } : {}),
      auto: {
        alertId: a.id, state: 'TRACKING', execution: a.execution === 'MARKET' ? 'MARKET' : 'LIMIT', targets: a.tps.slice(0, 3),
        tpsHit: 0, endedReason: null, enteredAt: entered ? now : null,
        summary: entered ? 'In the trade, tracked by your price alert.' : 'Waiting for the entry zone, tracked by your price alert.',
      },
    };
    tx.set(ref, doc);
  });
}

/** Reads the finished alert once: works out the result, R and how it played out, then the trade is done */
export async function closeAutoJournal(a: AlertLike): Promise<void> {
  const ref = db().collection(TRADES).doc(autoJournalId(a.id));
  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const t = snap.data() as JournalTrade;
    if (t.uid !== a.uid || t.source !== 'AUTO' || t.auto?.state !== 'TRACKING') return;
    const now = Date.now();
    const at = (k: string) => a.hits.find(h => h.kind === k)?.at ?? null;
    const tpIdx = a.hits.reduce((m, h) => { const x = /^TP(\d)$/.exec(h.kind); return x ? Math.max(m, Number(x[1])) : m; }, 0);
    const slAt = at('SL');
    const endHit = a.hits.find(h => h.kind === 'END');
    const entryAt = at('ENTRY') ?? (a.execution === 'MARKET' || a.entered ? t.auto.enteredAt ?? a.createdAt : null);
    const styleName = a.tradeStyle === 'SWING' ? 'swing trade' : 'day trade';
    const reason = a.endedReason || (a.active ? null : 'EXPIRED');
    const base = { ...t.auto, tpsHit: tpIdx, endedReason: reason, enteredAt: entryAt };
    // Prices written the way the site shows them (same decimals as the entry, 4 significant digits under a cent)
    const p = (n: number) => formatMarketPrice(n, t.entry);
    let update: Partial<JournalTrade>;
    if (tpIdx > 0 || slAt !== null) {
      // A target counts first when it came before the stop (the track record scores it the same way)
      const win = tpIdx > 0;
      const exit = win ? a.tps[tpIdx - 1] : (a.stop as number);
      const exitAt = win ? at(`TP${tpIdx}`) ?? now : slAt ?? now;
      const scored = scoreTrade({ direction: t.direction, entry: t.entry, stop: t.stop, exit, pnl: null });
      const held = entryAt ? ` after ${durationText(exitAt - entryAt)}` : '';
      const summary = win
        ? `Entry ${p(t.entry)} filled, TP${tpIdx} of ${a.tps.length} reached at ${p(exit)}${held}${slAt && slAt > (at(`TP${tpIdx}`) ?? 0) ? ', then the stop was hit (scored at the furthest target reached)' : ''}. ${fmtR(scored.r)}.`
        : `Entry ${p(t.entry)} filled, the stop loss at ${p(exit)} was hit${held} before any target. ${fmtR(scored.r)}.`;
      update = { status: 'CLOSED', exit, result: win ? 'WIN' : 'LOSS', r: scored.r, closedAt: exitAt, openedAt: entryAt ?? t.openedAt, auto: { ...base, state: 'DONE', summary } };
    } else if (endHit && entryAt && Number(endHit.price) > 0) {
      // Day / swing trade still open at its close time (9:00 PM WAT): closed there, in profit or in loss
      const exit = Number(endHit.price);
      const scored = scoreTrade({ direction: t.direction, entry: t.entry, stop: t.stop, exit, pnl: null });
      const summary = `Entry ${p(t.entry)} filled, no target or stop before the ${styleName} close (9:00 PM WAT), so it ended there at ${p(exit)} after ${durationText(endHit.at - entryAt)}. ${fmtR(scored.r)}.`;
      update = { status: 'CLOSED', exit, result: scored.result, r: scored.r, closedAt: endHit.at, openedAt: entryAt, auto: { ...base, state: 'DONE', summary } };
    } else if (!entryAt) {
      const why = endHit ? `The ${styleName} close (9:00 PM WAT) came before price reached the entry zone` : reason === 'MISSED' ? 'Price moved toward the targets without reaching the entry zone' : reason === 'TURNED_OFF' ? 'The alert was turned off before price reached the entry zone' : 'The setup expired before price reached the entry zone';
      update = { status: 'CLOSED', result: 'NO_FILL', closedAt: now, auto: { ...base, state: 'DONE', summary: `${why}, so there was no trade. Not counted in your stats.` } };
    } else {
      // In the trade, but the alert stopped before a target or the stop: the trader closes it with their own exit
      const why = reason === 'TURNED_OFF' ? 'You turned the alert off' : 'The alert finished watching';
      update = { auto: { ...base, state: 'HANDED_OVER', summary: `${why} while the trade was open, before a target or the stop. Close it with your exit price or P/L.` } };
    }
    tx.update(ref, { ...update, updatedAt: now });
  });
}
/**
 * A target was just reached while the alert keeps watching the next ones: the trade is already a win (owner rule:
 * TP1 first is never a loss, even if price comes back to the stop), so it is scored now at the furthest target and
 * updated again at TP2 / TP3. closeAutoJournal writes the final summary when the alert ends.
 */
export async function progressAutoJournal(a: AlertLike): Promise<void> {
  const tpIdx = a.hits.reduce((m, h) => { const x = /^TP(\d)$/.exec(h.kind); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  if (tpIdx < 1) return;
  const ref = db().collection(TRADES).doc(autoJournalId(a.id));
  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const t = snap.data() as JournalTrade;
    if (t.uid !== a.uid || t.source !== 'AUTO' || t.auto?.state !== 'TRACKING' || (t.auto.tpsHit || 0) >= tpIdx) return;
    const now = Date.now();
    const exit = a.tps[tpIdx - 1];
    const tpAt = a.hits.find(h => h.kind === `TP${tpIdx}`)?.at ?? now;
    const entryAt = a.hits.find(h => h.kind === 'ENTRY')?.at ?? t.auto.enteredAt ?? (a.execution === 'MARKET' ? a.createdAt : null);
    const scored = scoreTrade({ direction: t.direction, entry: t.entry, stop: t.stop, exit, pnl: null });
    const p = (n: number) => formatMarketPrice(n, t.entry);
    const next = tpIdx < a.tps.length ? `, still tracking TP${tpIdx + 1}` : '';
    const summary = `Entry ${p(t.entry)} filled, TP${tpIdx} of ${a.tps.length} reached at ${p(exit)}. ${fmtR(scored.r)} so far${next}. Scored as a win even if price comes back to the stop.`;
    tx.update(ref, {
      status: 'CLOSED', exit, result: 'WIN', r: scored.r, closedAt: tpAt, openedAt: entryAt ?? t.openedAt, updatedAt: now,
      auto: { ...t.auto, tpsHit: tpIdx, enteredAt: entryAt, summary },
    });
  });
}
const fmtR = (r: number | null) => (r === null ? 'R not available' : `${r > 0 ? '+' : ''}${r.toFixed(2)}R`);

export function recordStats(entries: Array<Pick<TrackRecordEntry, 'outcome' | 'tpsHit' | 'symbol' | 'timeframe' | 'r'>>) {
  const wins = entries.filter(e => e.outcome === 'WIN').length;
  const losses = entries.filter(e => e.outcome === 'LOSS').length;
  const missed = entries.filter(e => e.outcome === 'MISSED').length;
  const ended = entries.filter(e => e.outcome === 'ENDED').length;
  const decided = wins + losses;
  const tpCounts = [1, 2, 3].map(n => entries.filter(e => e.outcome === 'WIN' && e.tpsHit >= n).length);
  const byTf = new Map<string, { wins: number; losses: number }>();
  for (const e of entries) {
    if (e.outcome !== 'WIN' && e.outcome !== 'LOSS') continue;
    const s = byTf.get(e.timeframe) || { wins: 0, losses: 0 };
    if (e.outcome === 'WIN') s.wins++;
    else s.losses++;
    byTf.set(e.timeframe, s);
  }
  // R of every scored result (wins at their furthest target, losses -1); results recorded before R was stored are skipped
  // Trades ended at their trade type's close time add the R they made or lost there (they are not wins or losses)
  const scored = entries.filter(e => (e.outcome === 'WIN' || e.outcome === 'LOSS' || e.outcome === 'ENDED') && typeof e.r === 'number' && Number.isFinite(e.r));
  const totalR = scored.length ? Number(scored.reduce((t, e) => t + (e.r as number), 0).toFixed(2)) : null;
  return {
    signals: entries.length,
    wins, losses, missed, ended,
    totalR,
    avgR: totalR !== null ? Number((totalR / scored.length).toFixed(2)) : null,
    winRate: decided ? Math.round((wins / decided) * 100) : null,
    tp1Rate: decided ? Math.round((tpCounts[0] / decided) * 100) : null,
    tp2Rate: decided ? Math.round((tpCounts[1] / decided) * 100) : null,
    tp3Rate: decided ? Math.round((tpCounts[2] / decided) * 100) : null,
    timeframes: [...byTf.entries()].map(([timeframe, s]) => ({ timeframe, ...s, winRate: Math.round((s.wins / (s.wins + s.losses)) * 100) })).sort((a, b) => b.wins + b.losses - (a.wins + a.losses)).slice(0, 6),
  };
}

/** Keeps one result per signal (the earliest), so the same signal never counts twice */
export function uniqueSignals(entries: TrackRecordEntry[]): TrackRecordEntry[] {
  const seen = new Map<string, TrackRecordEntry>();
  for (const e of entries) {
    const k = e.signalKey || e.id;
    const cur = seen.get(k);
    if (!cur || e.createdAt < cur.createdAt) seen.set(k, e);
  }
  return [...seen.values()];
}

/** The trader's own record: archived outcomes plus alerts still in storage (finished ones counted, live ones listed) */
async function personalRecord(uid: string) {
  const [archived, alerts] = await Promise.all([
    db().collection(RECORDS).where('uid', '==', uid).get(),
    db().collection('priceAlerts').where('uid', '==', uid).get(),
  ]);
  const byId = new Map<string, TrackRecordEntry>();
  for (const d of archived.docs) byId.set(d.id, d.data() as TrackRecordEntry);
  const live: Array<{ id: string; symbol: string; timeframe: string; direction: string; entered: boolean; tpsHit: number; createdAt: number }> = [];
  for (const d of alerts.docs) {
    const a = d.data() as AlertLike;
    if (byId.has(a.id)) continue;
    const { outcome, tpsHit } = outcomeOf(a);
    if (a.active) {
      live.push({ id: a.id, symbol: a.symbol, timeframe: a.timeframe, direction: a.direction, entered: a.entered, tpsHit, createdAt: a.createdAt });
      // A target already reached counts as a win even while later targets are still watched
      if (outcome !== 'WIN') continue;
    }
    if (outcome === 'WIN' || outcome === 'LOSS' || outcome === 'MISSED' || outcome === 'ENDED') {
      const last = a.hits.length ? Math.max(...a.hits.map(h => h.at)) : a.updatedAt || a.createdAt;
      const rMade = outcomeR(a, outcome, tpsHit);
      byId.set(a.id, { id: a.id, uid, symbol: a.symbol, timeframe: a.timeframe, direction: a.direction, outcome, tpsHit, tpsTotal: a.tps.length, createdAt: a.createdAt, closedAt: last, signalKey: signalKey(a), ...(rMade !== undefined ? { r: rMade } : {}) });
    }
  }
  const entries = uniqueSignals([...byId.values()]).sort((a, b) => b.closedAt - a.closedAt);
  return {
    stats: recordStats(entries),
    entries: entries.slice(0, 60).map(({ uid: _u, ...e }) => e),
    live: live.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20),
  };
}

// Every trader's results (latest 1000 outcomes), refreshed every 10 minutes
let globalCache: { at: number; value: ReturnType<typeof recordStats> & { since: number | null } } | null = null;
async function globalRecord() {
  if (globalCache && Date.now() - globalCache.at < 10 * 60_000) return globalCache.value;
  const snap = await db().collection(RECORDS).orderBy('closedAt', 'desc').limit(1000).get();
  // A signal given to several traders (same pair, timeframe and levels) counts once in MarketX's record; results of
  // traders' own strategies (Strategy mode) are theirs, not MarketX's, and stay out of it
  const entries = uniqueSignals(snap.docs.map(d => d.data() as TrackRecordEntry).filter(e => !e.userStrategy));
  const value = { ...recordStats(entries), since: entries.length ? Math.min(...entries.map(e => e.createdAt)) : null };
  globalCache = { at: Date.now(), value };
  return value;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export function registerJournalRoutes(app: Express, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  const throttle = createKeyedThrottle({ windowMs: 60_000, max: 40 });
  const guard = (req: Request, res: Response, next: NextFunction) => {
    const wait = throttle.hit(getUser(res).uid);
    if (wait) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many changes. Please wait a minute.' });
    next();
  };
  const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) =>
    fn(req, res).catch(err => {
      console.error(`[MarketX Journal] ${req.method} ${req.path} failed:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
    });
  const own = async (uid: string, id: string) => {
    if (!/^jt_[a-f0-9]{16}$/.test(id)) return null;
    const snap = await db().collection(TRADES).doc(id).get();
    const t = snap.data() as JournalTrade | undefined;
    return t && t.uid === uid ? t : null;
  };

  app.get('/api/journal', limiter, requireAuth, requirePro, wrap(async (_req, res) => {
    res.json(await journalPayload(getUser(res).uid));
  }));

  app.post('/api/journal', limiter, requireAuth, guard, requirePro, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const count = (await db().collection(TRADES).where('uid', '==', uid).get()).docs.length;
    if (count >= MAX_TRADES) return res.status(429).json({ error: 'JOURNAL_FULL', message: `Your journal holds up to ${MAX_TRADES} trades. Delete some old ones first.` });
    const { trade, error } = parseTrade(req.body);
    if (!trade) return res.status(400).json({ error: 'BAD_TRADE', message: error });
    // The same trade twice (typed again, or already logged by its price alert) is refused: one record per trade
    const mineNow = (await db().collection(TRADES).where('uid', '==', uid).get()).docs.map(d => d.data() as JournalTrade);
    if (mineNow.some(x => sameTrade(x, trade) && (x.status === 'OPEN' || Math.abs((x.openedAt || 0) - (trade.openedAt || 0)) < 60_000))) {
      return res.status(409).json({ error: 'DUPLICATE_TRADE', message: 'This trade is already in your journal.' });
    }
    const t = Date.now();
    const doc: JournalTrade = { id: `jt_${crypto.randomBytes(8).toString('hex')}`, uid, ...trade, createdAt: t, updatedAt: t, source: 'MANUAL' };
    await db().collection(TRADES).doc(doc.id).set(doc);
    res.json({ trade: tradeView(doc), ...(await journalPayload(uid)) });
  }));

  app.patch('/api/journal/:id', limiter, requireAuth, guard, requirePro, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const existing = await own(uid, String(req.params.id || ''));
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'That trade is not in your journal.' });
    const body = req.body || {};
    let doc: JournalTrade;
    if (existing.source === 'AUTO' && existing.auto?.state !== 'HANDED_OVER') {
      // Auto trades: the levels come from the signal and the result from the market, so only the notes change
      // (an update, not a rewrite, so a result the alert monitor writes at the same moment is never overwritten)
      const notes = body.notes === undefined ? existing.notes : cleanText(body.notes, 600);
      await db().collection(TRADES).doc(existing.id).update({ notes, updatedAt: Date.now() });
      const fresh = (await db().collection(TRADES).doc(existing.id).get()).data() as JournalTrade;
      return res.json({ trade: tradeView(fresh), ...(await journalPayload(uid)) });
    } else {
      // A handed-over auto trade (its alert ended while it was open) keeps its levels; the trader adds the exit or P/L
      const input = existing.source === 'AUTO' ? { notes: body.notes, exit: body.exit, pnl: body.pnl, size: body.size, status: body.status === 'CLOSED' ? 'CLOSED' : undefined } : body;
      const { trade, error } = parseTrade(input, existing);
      if (!trade) return res.status(400).json({ error: 'BAD_TRADE', message: error });
      doc = { ...existing, ...trade, updatedAt: Date.now() };
      if (doc.source === 'AUTO' && doc.status === 'CLOSED' && doc.auto) {
        doc.auto = { ...doc.auto, state: 'DONE', summary: `${doc.auto.summary} You closed it${doc.exit !== null ? ` at ${formatMarketPrice(doc.exit, doc.entry)}` : ''}.` };
      }
    }
    await db().collection(TRADES).doc(existing.id).set(doc);
    res.json({ trade: tradeView(doc), ...(await journalPayload(uid)) });
  }));

  app.delete('/api/journal/:id', limiter, requireAuth, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const existing = await own(uid, String(req.params.id || ''));
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'That trade is not in your journal.' });
    await db().collection(TRADES).doc(existing.id).delete();
    res.json(await journalPayload(uid));
  }));

  app.get('/api/track-record', limiter, requireAuth, wrap(async (_req, res) => {
    const { uid } = getUser(res);
    const [mine, all] = await Promise.all([personalRecord(uid), globalRecord()]);
    res.json({ ...mine, global: all, checkedAt: Date.now() });
  }));
}
