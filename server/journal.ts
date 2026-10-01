import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { db } from './firebase';
import { getUser, requireAuth } from './account';
import { createKeyedThrottle } from './security';

// ===========================================================================
// Trade Journal (/trade-journal) and Track Record (/track-record)
//
//   journalTrades/{id} -> a trade the trader logged (market, side, entry, stop, target, exit, P/L, notes)
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
  result: 'WIN' | 'LOSS' | 'BE' | null;
  /** Result in R (risk units), when the stop loss is known */
  r: number | null;
  timeframe: string;
  notes: string;
  openedAt: number;
  closedAt: number | null;
  createdAt: number;
  updatedAt: number;
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
  const closed = trades.filter(t => t.status === 'CLOSED' && t.result);
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
export type SignalOutcome = 'WIN' | 'LOSS' | 'MISSED' | 'NO_FILL' | 'OPEN';
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
}
interface AlertLike {
  id: string; uid: string; symbol: string; timeframe: string; direction: 'LONG' | 'SHORT'; tps: number[]; entered: boolean;
  hits: Array<{ kind: string; at: number }>; createdAt: number; updatedAt?: number; active: boolean; endedReason?: string;
}

/** Outcome of an alert: a win once a target is hit, a loss when the stop goes first, otherwise no result */
export function outcomeOf(a: AlertLike): { outcome: SignalOutcome; tpsHit: number } {
  const tpsHit = a.hits.filter(h => /^TP\d$/.test(h.kind)).length;
  if (tpsHit > 0) return { outcome: 'WIN', tpsHit };
  if (a.hits.some(h => h.kind === 'SL')) return { outcome: 'LOSS', tpsHit: 0 };
  if (a.hits.some(h => h.kind === 'MISSED')) return { outcome: 'MISSED', tpsHit: 0 };
  if (a.active) return { outcome: 'OPEN', tpsHit: 0 };
  return { outcome: a.entered ? 'OPEN' : 'NO_FILL', tpsHit: 0 };
}

/** Called by the alert monitor when an alert finishes; written once (id = alert id). Only real results are kept. */
export async function archiveAlertOutcome(a: AlertLike): Promise<void> {
  const { outcome, tpsHit } = outcomeOf({ ...a, active: false });
  if (outcome !== 'WIN' && outcome !== 'LOSS' && outcome !== 'MISSED') return;
  const last = a.hits.length ? Math.max(...a.hits.map(h => h.at)) : Date.now();
  const entry: TrackRecordEntry = {
    id: a.id, uid: a.uid, symbol: a.symbol, timeframe: a.timeframe, direction: a.direction, outcome, tpsHit,
    tpsTotal: a.tps.length, createdAt: a.createdAt, closedAt: last,
  };
  await db().collection(RECORDS).doc(a.id).set(entry);
}

export function recordStats(entries: Array<Pick<TrackRecordEntry, 'outcome' | 'tpsHit' | 'symbol' | 'timeframe'>>) {
  const wins = entries.filter(e => e.outcome === 'WIN').length;
  const losses = entries.filter(e => e.outcome === 'LOSS').length;
  const missed = entries.filter(e => e.outcome === 'MISSED').length;
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
  return {
    signals: entries.length,
    wins, losses, missed,
    winRate: decided ? Math.round((wins / decided) * 100) : null,
    tp1Rate: decided ? Math.round((tpCounts[0] / decided) * 100) : null,
    tp2Rate: decided ? Math.round((tpCounts[1] / decided) * 100) : null,
    tp3Rate: decided ? Math.round((tpCounts[2] / decided) * 100) : null,
    timeframes: [...byTf.entries()].map(([timeframe, s]) => ({ timeframe, ...s, winRate: Math.round((s.wins / (s.wins + s.losses)) * 100) })).sort((a, b) => b.wins + b.losses - (a.wins + a.losses)).slice(0, 6),
  };
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
    if (outcome === 'WIN' || outcome === 'LOSS' || outcome === 'MISSED') {
      const last = a.hits.length ? Math.max(...a.hits.map(h => h.at)) : a.updatedAt || a.createdAt;
      byId.set(a.id, { id: a.id, uid, symbol: a.symbol, timeframe: a.timeframe, direction: a.direction, outcome, tpsHit, tpsTotal: a.tps.length, createdAt: a.createdAt, closedAt: last });
    }
  }
  const entries = [...byId.values()].sort((a, b) => b.closedAt - a.closedAt);
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
  const entries = snap.docs.map(d => d.data() as TrackRecordEntry);
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

  app.get('/api/journal', limiter, requireAuth, wrap(async (_req, res) => {
    res.json(await journalPayload(getUser(res).uid));
  }));

  app.post('/api/journal', limiter, requireAuth, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const count = (await db().collection(TRADES).where('uid', '==', uid).get()).docs.length;
    if (count >= MAX_TRADES) return res.status(429).json({ error: 'JOURNAL_FULL', message: `Your journal holds up to ${MAX_TRADES} trades. Delete some old ones first.` });
    const { trade, error } = parseTrade(req.body);
    if (!trade) return res.status(400).json({ error: 'BAD_TRADE', message: error });
    const t = Date.now();
    const doc: JournalTrade = { id: `jt_${crypto.randomBytes(8).toString('hex')}`, uid, ...trade, createdAt: t, updatedAt: t };
    await db().collection(TRADES).doc(doc.id).set(doc);
    res.json({ trade: tradeView(doc), ...(await journalPayload(uid)) });
  }));

  app.patch('/api/journal/:id', limiter, requireAuth, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const existing = await own(uid, String(req.params.id || ''));
    if (!existing) return res.status(404).json({ error: 'NOT_FOUND', message: 'That trade is not in your journal.' });
    const { trade, error } = parseTrade(req.body, existing);
    if (!trade) return res.status(400).json({ error: 'BAD_TRADE', message: error });
    const doc: JournalTrade = { ...existing, ...trade, updatedAt: Date.now() };
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
