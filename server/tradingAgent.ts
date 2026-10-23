import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db, isFirebaseConfigured } from './firebase';
import { sendPush } from './webPush';
import { campaignPool, purchasedPool, claimMarketMail, getUser, isUnlimitedEmail, marketMailDay, notifyActivity, requireAuth, siteLink, userRef, type UserDoc } from './account';
import { IS_LEAD_WORKER } from './workers';
import { createKeyedThrottle } from './security';
import { fmtPrice, levelTolerance, tfMinutes, type Bar } from './priceAlerts';
import { getPaymentsPublicConfig } from './payments';
import {
  Mt5Error, brokerLevels, createMt5Account, deleteMt5Account, lotSize, maskLogin, matchSymbol, mt5AccountInfo, mt5AccountState, mt5Configured, mt5Positions,
  mt5Price, mt5Spec, mt5Symbols, mt5Trade, type Mt5Link,
} from './mt5';
import {
  AGENT_BACKTEST, AGENT_MARKETS, AGENT_MIN_QUALITY, AGENT_PRICING, ENDED_TEXT, agentMaxCost, agentStats, normalizeAgentSettings, DEFAULT_AGENT_SETTINGS,
  type AgentLogEntry, type AgentRunView, type AgentSettings, type AgentTradeResult, type AgentTradeState, type AgentTradeView,
} from '../src/utils/tradingAgent';

// ===========================================================================
// Trading agent (/trading-agent, owner-specified). The trader sets it up (trade type, timeframes, markets, risk per
// trade, profit target, loss limit, trades per day) and switches it on for a day, a week or a month. From then on the
// agent works on its own, on the lead worker:
//
//   1. scans the trader's markets with Steady mode (option C, the same engine read as the analysis, no AI call) and
//      takes only setups of quality AGENT_MIN_QUALITY+ (the back-tested floor);
//   2. places a limit order at the middle of the entry zone, with the stop and the FINAL target (the whole position is
//      held to the final target or the stop: the management that held up best in the back-test);
//   3. watches 1-minute candles: fills the order, then closes the trade at its target or stop (an unfilled order is
//      cancelled after PENDING_CANDLES candles, or when price reaches TP1 without it);
//   4. alerts the trader at every step (site notification, phone/desktop push, and email within the market budget).
//
// Access (owner-specified): the agent has its own subscription ($30 a month, a year 18% off; users.agentSub, granted by
// server/payments.ts after Paystack verification). Unlimited staff accounts need none.
// Credits (owner-specified, never below 5 a trade): charged ONCE per trade, when the agent places it, inside the same
// transaction, at the run's rate (daily 7, weekly 6, monthly 5), campaign credits first; an order that is cancelled
// before it fills is refunded in full.
//
// Execution: every trade is tracked by MarketX on live prices (the record for alerts and stats). With an MT5 account
// linked (server/mt5.ts, MetaApi), each order is also placed on the trader's account, sized to their risk, with the stop
// and target at the broker; MarketX never stores the MT5 password.
//
//   tradingAgents/{uid}  -> settings, the current/last run, the activity log, setups already used
//   mt5Links/{uid}       -> the trader's MT5 link (MetaApi account id, masked login, server, matched symbols)
//   agentTrades/{id}     -> one order/trade of a run, with its levels, state and result
// ===========================================================================

const AGENTS = 'tradingAgents';
const TRADES = 'agentTrades';
const TICK_MS = Math.max(2000, Number(process.env.AGENT_TICK_MS) || 60_000);
const SCAN_GAP_MS = Math.max(1000, Number(process.env.AGENT_SCAN_GAP_MS) || 5 * 60_000);
const BOOT_DELAY_MS = Math.max(500, Number(process.env.AGENT_BOOT_MS) || 30_000);
/** An order not filled within this many candles of its timeframe is cancelled (back-test: 48) */
const PENDING_CANDLES = 48;
/** A filled trade still open after this many candles is closed at the market (back-test: 500) */
const MAX_CANDLES = 500;
const LOG_MAX = 60;
const SEEN_MAX = 80;
const SCAN_CONCURRENCY = 3;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const now = () => Date.now();
const id = (prefix: string) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const mt5Name = (symbol: string) => AGENT_MARKETS.find(m => m.symbol === symbol)?.mt5 || symbol.replace(/[^A-Z0-9]/gi, '');

/** One setup the engine would serve right now (Steady mode, limit entry) */
export interface AgentSetup {
  direction: 'LONG' | 'SHORT';
  entry: { min: number; max: number; optimal: number };
  stop: number;
  targets: number[];
  quality: number;
  price: number;
}
export interface AgentDeps {
  /** Steady mode read of a market on a timeframe: the plan the analysis would serve, or null */
  scan: (symbol: string, timeframe: string) => Promise<AgentSetup | null>;
  /** Recent 1-minute candles of a market (oldest first), or null */
  getBars: (symbol: string) => Promise<Bar[] | null>;
}

interface AgentTrade extends AgentTradeView {
  uid: string;
  name: string;
  tp1: number;
  expiresAt: number;
  /** How long a filled trade may stay open (MAX_CANDLES candles of its timeframe) */
  holdMs: number;
  scanFrom: number;
  updatedAt: number;
  execution: 'TRACKED' | 'MT5';
  /** Credits of this trade taken from the campaign pool / bought credits (refunded there if the order never fills) */
  campaignCharged?: number;
  purchasedCharged?: number;
  /** The order on the trader's MT5 account (MetaApi), when linked */
  mt5?: { state: 'PLACED' | 'FAILED' | 'CANCELLED' | 'CLOSED'; symbol?: string; volume?: number; entry?: number; stop?: number; target?: number; orderId?: string; clientId?: string; error?: string };
}
interface AgentRun extends Omit<AgentRunView, 'stats'> {
  day: string;
  placedToday: number;
  lowCreditsAt?: number;
}
interface AgentDoc {
  uid: string;
  settings: AgentSettings;
  run: AgentRun | null;
  log: AgentLogEntry[];
  seen: string[];
  updatedAt: number;
}

const agentRef = (uid: string) => db().collection(AGENTS).doc(uid);
const tradeRef = (tid: string) => db().collection(TRADES).doc(tid);
const LINKS = 'mt5Links';
const linkRef = (uid: string) => db().collection(LINKS).doc(uid);
/** The trader's MT5 link (no password: MetaApi holds the credentials) */
interface Mt5LinkDoc extends Mt5Link {
  uid: string;
  status: 'CONNECTING' | 'CONNECTED' | 'FAILED';
  login: string;
  server: string;
  broker?: string;
  currency?: string;
  balance?: number;
  symbols?: Record<string, string | null>;
  message?: string;
  linkedAt: number;
  checkedAt?: number;
}
const linkOf = async (uid: string) => (await linkRef(uid).get()).data() as Mt5LinkDoc | undefined;

/** The agent's subscription is live (or the account is unlimited staff) */
export function agentSubActive(u: Pick<UserDoc, 'email' | 'emailVerified'> & { agentSub?: { active?: boolean; expiresAt?: number } } | undefined, at = Date.now()): boolean {
  if (!u) return false;
  if (u.emailVerified && isUnlimitedEmail(u.email)) return true;
  return !!u.agentSub?.active && (u.agentSub.expiresAt || 0) > at;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------
/** The order price: the middle of the entry zone (back-tested best: fills often enough, with room to the stop) */
export function orderPrice(e: { min: number; max: number }): number {
  return Number(((e.min + e.max) / 2).toPrecision(10));
}
/** R of a trade closed at a price, from its order price and stop */
export function tradeR(t: Pick<AgentTradeView, 'direction' | 'entry' | 'stop'>, price: number): number {
  const risk = Math.abs(t.entry - t.stop);
  if (!risk) return 0;
  return Number((((price - t.entry) * (t.direction === 'LONG' ? 1 : -1)) / risk).toFixed(2));
}

export interface StepResult {
  filled?: { at: number; price: number };
  closed?: { at: number; price: number; kind: 'TP' | 'SL' | 'TIME' };
  cancelled?: 'EXPIRED' | 'MISSED';
  scanFrom: number;
}
/**
 * Walks 1-minute candles (oldest first) for one order/trade, from where the last walk stopped. Same rules as the
 * back-test: the limit fills when price trades to the order price; before that, TP1 first cancels it (the move went
 * without us); once filled, the stop is checked before the target on every candle (same candle = stop), and levels
 * count once price trades through them by the market's margin (levelTolerance, as for price alerts).
 */
export function stepTrade(
  t: Pick<AgentTrade, 'direction' | 'entry' | 'stop' | 'target' | 'tp1' | 'symbol' | 'state' | 'scanFrom' | 'expiresAt' | 'holdMs' | 'filledAt'>,
  bars: Bar[],
  at: number = now()
): StepResult {
  const long = t.direction === 'LONG';
  const risk = Math.abs(t.entry - t.stop);
  const tol = (p: number) => levelTolerance(t.symbol, p, risk);
  const reached = (b: Bar, p: number) => (long ? b.h >= p + tol(p) : b.l <= p - tol(p));
  const stopped = (b: Bar) => (long ? b.l <= t.stop - tol(t.stop) : b.h >= t.stop + tol(t.stop));
  let state = t.state;
  let scanFrom = t.scanFrom;
  const out: StepResult = { scanFrom };
  for (const b of bars) {
    if (!(b.t >= t.scanFrom) || !finite(b.h) || !finite(b.l)) continue;
    scanFrom = b.t;
    if (state === 'PENDING') {
      if (b.t >= t.expiresAt) return { ...out, cancelled: 'EXPIRED', scanFrom };
      if (long ? b.l <= t.entry : b.h >= t.entry) {
        state = 'OPEN';
        out.filled = { at: b.t, price: t.entry };
      } else {
        if (reached(b, t.tp1)) return { ...out, cancelled: 'MISSED', scanFrom };
        continue;
      }
    }
    if (state === 'OPEN') {
      const maxEnd = (out.filled?.at ?? t.filledAt ?? Infinity) + t.holdMs;
      if (b.t >= maxEnd) return { ...out, closed: { at: b.t, price: b.o, kind: 'TIME' }, scanFrom };
      if (stopped(b)) return { ...out, closed: { at: b.t, price: t.stop, kind: 'SL' }, scanFrom };
      if (reached(b, t.target)) return { ...out, closed: { at: b.t, price: t.target, kind: 'TP' }, scanFrom };
    }
  }
  if (state === 'PENDING' && at >= t.expiresAt) return { ...out, cancelled: 'EXPIRED', scanFrom };
  return { ...out, scanFrom };
}

/** Best setup for an agent among fresh scans: quality floor, markets with no live order/trade, not used before */
export function pickSetup(
  settings: Pick<AgentSettings, 'markets' | 'timeframes'>,
  scans: Map<string, AgentSetup | null>,
  busy: Set<string>,
  seen: Set<string>
): { symbol: string; timeframe: string; setup: AgentSetup; key: string } | null {
  let best: { symbol: string; timeframe: string; setup: AgentSetup; key: string } | null = null;
  for (const symbol of settings.markets) {
    if (busy.has(symbol)) continue;
    for (const timeframe of settings.timeframes) {
      const s = scans.get(`${symbol}|${timeframe}`);
      if (!s || s.quality < AGENT_MIN_QUALITY || !s.targets.length) continue;
      const key = setupKey(symbol, timeframe, s);
      if (seen.has(key)) continue;
      // Higher quality first; on a tie the higher timeframe (it held up better in the back-test)
      if (!best || s.quality > best.setup.quality || (s.quality === best.setup.quality && tfMinutes(timeframe) > tfMinutes(best.timeframe))) best = { symbol, timeframe, setup: s, key };
    }
  }
  return best;
}
export const setupKey = (symbol: string, tf: string, s: Pick<AgentSetup, 'direction' | 'entry' | 'stop'>) =>
  `${symbol}|${tf}|${s.direction}|${s.entry.min}|${s.entry.max}|${s.stop}`;

const sideText = (t: Pick<AgentTradeView, 'direction'>) => (t.direction === 'LONG' ? 'BUY LIMIT' : 'SELL LIMIT');
const orderLine = (t: AgentTradeView) =>
  `${sideText(t)} ${mt5Name(t.symbol)} at ${fmtPrice(t.entry)}, stop ${fmtPrice(t.stop)}, target ${fmtPrice(t.target)} (${t.timeframe}, risk ${t.riskPct}%)`;
const rText = (r: number) => `${r > 0 ? '+' : ''}${r.toFixed(2)}R`;
const pctText = (p: number) => `${p > 0 ? '+' : ''}${p.toFixed(2)}%`;

function toView(t: AgentTrade): AgentTradeView {
  return {
    id: t.id, runId: t.runId, symbol: t.symbol, timeframe: t.timeframe, direction: t.direction, entry: t.entry, entryMin: t.entryMin, entryMax: t.entryMax,
    stop: t.stop, target: t.target, quality: t.quality, rr: t.rr, riskPct: t.riskPct, state: t.state, credits: t.credits, createdAt: t.createdAt,
    ...(t.result ? { result: t.result } : {}), ...(typeof t.r === 'number' ? { r: t.r } : {}), ...(typeof t.pnlPct === 'number' ? { pnlPct: t.pnlPct } : {}),
    ...(t.filledAt ? { filledAt: t.filledAt } : {}), ...(t.closedAt ? { closedAt: t.closedAt } : {}), ...(finite(t.closePrice) ? { closePrice: t.closePrice } : {}),
    ...(t.note ? { note: t.note } : {}),
    ...(t.mt5 ? { mt5: { state: t.mt5.state, ...(t.mt5.symbol ? { symbol: t.mt5.symbol } : {}), ...(t.mt5.volume ? { volume: t.mt5.volume } : {}), ...(t.mt5.error ? { error: t.mt5.error } : {}) } } : {}),
    ...((t as any).refunded ? { refunded: (t as any).refunded } : {}),
  };
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
async function tradesOf(uid: string): Promise<AgentTrade[]> {
  const snap = await db().collection(TRADES).where('uid', '==', uid).get();
  return snap.docs.map(d => d.data() as AgentTrade).sort((a, b) => b.createdAt - a.createdAt);
}

function logEntry(kind: AgentLogEntry['kind'], text: string, tradeId?: string): AgentLogEntry {
  return { at: now(), kind, text: text.slice(0, 240), ...(tradeId ? { tradeId } : {}) };
}
async function pushLog(uid: string, entries: AgentLogEntry[], extra: Record<string, unknown> = {}) {
  await db().runTransaction(async tx => {
    const snap = await tx.get(agentRef(uid));
    if (!snap.exists) return;
    const log = [...entries.reverse(), ...((snap.data() as AgentDoc).log || [])].slice(0, LOG_MAX);
    tx.update(agentRef(uid), { log, updatedAt: now(), ...extra });
  });
}

/** Tells the trader: site notification + push always; email for the steps that matter, within the market budget */
async function tell(uid: string, title: string, message: string, opts: { tradeId?: string; mail?: boolean; rows?: [string, string][] } = {}) {
  const url = `/?agent=1${opts.tradeId ? `&focus=${encodeURIComponent(opts.tradeId)}` : ''}`;
  const mail = opts.mail && (await claimMarketMail(uid).catch(() => false))
    ? { subject: title, lines: [message], options: { rows: (opts.rows || []).slice(0, 3), cta: { label: 'Open the trading agent', url: siteLink(url) } } }
    : undefined;
  await notifyActivity(uid, { type: 'market', title, message, actionType: 'open_agent', actionPayload: { tradeId: opts.tradeId || null } } as any, mail);
  sendPush(uid, { title, body: message, url, tag: `agent-${opts.tradeId || uid}`, kind: 'agent' }).catch(() => {});
}

/** Run stats from its closed trades, with the run's money figures */
async function runStats(uid: string, runId: string) {
  return agentStats((await tradesOf(uid)).filter(t => t.runId === runId));
}

/** Ends a run (time up, stopped, target, loss limit, out of credits): unfilled orders are cancelled, open trades run on */
async function endRun(uid: string, reason: NonNullable<AgentRunView['endedReason']>, opts: { closeOpen?: (t: AgentTrade) => Promise<number | null> } = {}) {
  const ended = await db().runTransaction(async tx => {
    const snap = await tx.get(agentRef(uid));
    const a = snap.data() as AgentDoc | undefined;
    if (!a?.run || a.run.state !== 'RUNNING') return null;
    tx.update(agentRef(uid), { 'run.state': 'ENDED', 'run.endedReason': reason, 'run.endedAt': now(), updatedAt: now() });
    return a.run;
  });
  if (!ended) return null;
  const mine = (await tradesOf(uid)).filter(t => t.runId === ended.id);
  for (const t of mine.filter(t => t.state === 'PENDING')) {
    await cancelPending(t, 'Cancelled: the run ended before the order filled.').catch(() => {});
  }
  if (opts.closeOpen) {
    for (const t of mine.filter(t => t.state === 'OPEN')) {
      const price = await opts.closeOpen(t).catch(() => null);
      if (finite(price)) {
        await mt5Close(t).catch(() => {});
        await closeTrade(t, { at: now(), price, kind: 'TIME' }, 'Closed when you stopped the agent.', false);
      }
    }
  }
  const stats = await runStats(uid, ended.id);
  const stillOpen = (await tradesOf(uid)).filter(t => t.runId === ended.id && t.state === 'OPEN').length;
  const summary =
    (stats.trades
      ? `${stats.trades} trade${stats.trades === 1 ? '' : 's'} closed, ${stats.winRate}% won, ${rText(stats.totalR)} (${pctText(stats.pnlPct)} of the account).`
      : 'No trades closed in this run.') +
    (stillOpen ? ` ${stillOpen} trade${stillOpen === 1 ? ' is' : 's are'} still open: the agent keeps managing ${stillOpen === 1 ? 'it' : 'them'} to the target or the stop.` : '');
  await pushLog(uid, [logEntry(reason === 'TIME_UP' ? 'END' : 'STOP', `${ENDED_TEXT[reason]}. ${summary}`)]);
  await tell(uid, `🤖 Trading agent: ${ENDED_TEXT[reason].toLowerCase()}`, summary, {
    mail: true,
    rows: [['Won', `${stats.winRate}%`], ['Result', `${rText(stats.totalR)} · ${pctText(stats.pnlPct)}`], ['Credits used', String(ended.creditsUsed)]],
  });
  return ended;
}

/** Closes a filled trade once (transaction), records its result, then checks the run's profit target / loss limit */
async function closeTrade(t: AgentTrade, c: NonNullable<StepResult['closed']>, note: string, notify = true) {
  const r = tradeR(t, c.price);
  const result: AgentTradeResult = c.kind === 'TIME' ? 'TIMEOUT' : r > 0 ? 'WIN' : 'LOSS';
  const pnlPct = Number((r * t.riskPct).toFixed(2));
  const done = await db().runTransaction(async tx => {
    const snap = await tx.get(tradeRef(t.id));
    const cur = snap.data() as AgentTrade | undefined;
    if (!cur || cur.state !== 'OPEN') return false;
    tx.update(tradeRef(t.id), { state: 'CLOSED', result, r, pnlPct, closedAt: c.at, closePrice: c.price, note, updatedAt: now() });
    return true;
  });
  if (!done) return;
  const kind: AgentLogEntry['kind'] = c.kind === 'TIME' ? 'CLOSE' : r > 0 ? 'WIN' : 'LOSS';
  const head =
    c.kind === 'TP' ? `✅ ${t.symbol} hit the target` : c.kind === 'SL' ? `🛑 ${t.symbol} hit the stop` : `⏹️ ${t.symbol} trade closed`;
  const text = `${head}: ${sideText(t).replace(' LIMIT', '')} ${t.timeframe} closed at ${fmtPrice(c.price)}, ${rText(r)} (${pctText(pnlPct)} of the account).`;
  await pushLog(t.uid, [logEntry(kind, text, t.id)]);
  if (notify) await tell(t.uid, head, text, { tradeId: t.id, mail: true, rows: [['Trade', `${sideText(t).replace(' LIMIT', '')} ${t.symbol} · ${t.timeframe}`], ['Closed at', fmtPrice(c.price)], ['Result', `${rText(r)} · ${pctText(pnlPct)}`]] });
  // The run's profit target / loss limit (realised results of this run)
  const snap = await agentRef(t.uid).get();
  const a = snap.data() as AgentDoc | undefined;
  if (!a?.run || a.run.state !== 'RUNNING' || a.run.id !== t.runId) return;
  const stats = await runStats(t.uid, t.runId);
  const s = a.run.settings;
  if (s.profitTargetPct > 0 && stats.pnlPct >= s.profitTargetPct) await endRun(t.uid, 'TARGET');
  else if (s.lossLimitPct > 0 && stats.pnlPct <= -s.lossLimitPct) await endRun(t.uid, 'LOSS_LIMIT');
}

/** The order filled: the trade is open (its credits were taken when it was placed) */
async function fillTrade(t: AgentTrade, f: NonNullable<StepResult['filled']>): Promise<'OK' | 'GONE'> {
  return db().runTransaction(async tx => {
    const cur = (await tx.get(tradeRef(t.id))).data() as AgentTrade | undefined;
    if (!cur || cur.state !== 'PENDING') return 'GONE';
    tx.update(tradeRef(t.id), { state: 'OPEN', filledAt: f.at, updatedAt: now() });
    return 'OK';
  });
}

/** Cancels an order that never filled, once (transaction): its credits go back where they came from */
async function cancelPending(t: AgentTrade, note: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  const ok = await db().runTransaction(async tx => {
    const [ts, as] = await Promise.all([tx.get(tradeRef(t.id)), tx.get(agentRef(t.uid))]);
    const cur = ts.data() as AgentTrade | undefined;
    if (!cur || cur.state !== 'PENDING') return false;
    const back = Math.max(0, cur.credits || 0);
    const camp = Math.min(back, Math.max(0, cur.campaignCharged || 0));
    const bought = Math.min(back - camp, Math.max(0, cur.purchasedCharged || 0));
    if (back) {
      const us = await tx.get(userRef(t.uid));
      if (us.exists)
        tx.update(userRef(t.uid), {
          'credits.available': FieldValue.increment(back),
          ...(camp ? { 'credits.campaign': FieldValue.increment(camp) } : {}),
          ...(bought ? { 'credits.purchased': FieldValue.increment(bought) } : {}),
        });
      const a = as.data() as AgentDoc | undefined;
      if (a?.run?.id === t.runId) tx.update(agentRef(t.uid), { 'run.creditsUsed': FieldValue.increment(-back), updatedAt: now() });
    }
    tx.update(tradeRef(t.id), { state: 'CANCELLED', note, credits: 0, campaignCharged: 0, purchasedCharged: 0, refunded: back, updatedAt: now(), ...extra });
    return true;
  });
  if (ok) await mt5Cancel(t).catch(() => {});
  return ok;
}

// ---------------------------------------------------------------------------
// MT5 execution (MetaApi): the agent's order is placed on the trader's own account, sized to their risk
// ---------------------------------------------------------------------------
/** Places the agent's limit order on the linked MT5 account; the outcome is kept on the trade and told to the trader */
async function mt5Open(t: AgentTrade, feedPrice: number): Promise<void> {
  const link = await linkOf(t.uid);
  if (!link || link.status !== 'CONNECTED' || !mt5Configured()) return;
  const symbol = link.symbols?.[t.symbol];
  const fail = async (error: string) => {
    await tradeRef(t.id).update({ mt5: { state: 'FAILED', ...(symbol ? { symbol } : {}), error: error.slice(0, 200) }, updatedAt: now() }).catch(() => {});
    await pushLog(t.uid, [logEntry('PAUSE', `MT5: the ${t.symbol} order was not placed on your account (${error}). MarketX keeps tracking it.`, t.id)]);
    await tell(t.uid, `⚠️ MT5: ${t.symbol} order not placed`, `${error}. MarketX keeps tracking the trade; you can place it yourself: ${orderLine(t)}.`, { tradeId: t.id });
  };
  if (!symbol) return fail(`your broker has no symbol matching ${t.symbol}`);
  try {
    const [info, spec, px] = await Promise.all([mt5AccountInfo(link), mt5Spec(link, symbol), mt5Price(link, symbol)]);
    if (!info.tradeAllowed) return fail('trading is not allowed with this login (an investor password is read only)');
    const lv = brokerLevels({ entry: t.entry, stop: t.stop, target: t.target }, feedPrice, (px.bid + px.ask) / 2, spec.digits);
    if (!lv) return fail(`your broker's ${symbol} price is too far from the market price MarketX reads`);
    const long = t.direction === 'LONG';
    if (long ? !(lv.entry < px.ask) : !(lv.entry > px.bid)) return fail('price is already at the entry on your broker');
    const volume = lotSize({ balance: info.balance, riskPct: t.riskPct, entry: lv.entry, stop: lv.stop, tickSize: spec.tickSize, lossTickValue: px.lossTickValue, minVolume: spec.minVolume, maxVolume: spec.maxVolume, volumeStep: spec.volumeStep });
    if (!volume) return fail(`${t.riskPct}% of your balance is below the smallest lot your broker allows for this stop`);
    const clientId = `MX${t.id.slice(3, 13)}`;
    const base = { actionType: long ? 'ORDER_TYPE_BUY_LIMIT' : 'ORDER_TYPE_SELL_LIMIT', symbol, volume, openPrice: lv.entry, stopLoss: lv.stop, takeProfit: lv.target, comment: 'MarketX agent', clientId };
    let res;
    try {
      res = await mt5Trade(link, { ...base, expiration: { type: 'ORDER_TIME_SPECIFIED', time: new Date(t.expiresAt).toISOString() } });
    } catch (err) {
      // Some brokers refuse timed orders: place it good-till-cancelled (MarketX cancels it when it expires)
      if (err instanceof Mt5Error && /EXPIRATION/i.test(err.code)) res = await mt5Trade(link, base);
      else throw err;
    }
    await tradeRef(t.id).update({ execution: 'MT5', mt5: { state: 'PLACED', symbol, volume, entry: lv.entry, stop: lv.stop, target: lv.target, clientId, ...(res.orderId ? { orderId: res.orderId } : {}) }, updatedAt: now() });
    const text = `🔗 On your MT5: ${long ? 'BUY LIMIT' : 'SELL LIMIT'} ${symbol} ${volume} lots at ${fmtPrice(lv.entry)}, stop ${fmtPrice(lv.stop)}, target ${fmtPrice(lv.target)}.`;
    await pushLog(t.uid, [logEntry('ORDER', text, t.id)]);
    await tell(t.uid, `🔗 Agent order placed on your MT5 (${symbol})`, text, { tradeId: t.id, mail: true, rows: [['Order', `${long ? 'BUY LIMIT' : 'SELL LIMIT'} ${symbol}`], ['Lots', String(volume)], ['Stop / target', `${fmtPrice(lv.stop)} / ${fmtPrice(lv.target)}`]] });
  } catch (err: any) {
    return fail(err instanceof Mt5Error ? err.message : 'the MT5 connection failed');
  }
}

/** Cancels the agent's unfilled order on MT5 (if it already filled at the broker, its stop and target manage it) */
async function mt5Cancel(t: AgentTrade): Promise<void> {
  if (t.mt5?.state !== 'PLACED' || !t.mt5.orderId) return;
  const link = await linkOf(t.uid);
  if (!link || !mt5Configured()) return;
  try {
    await mt5Trade(link, { actionType: 'ORDER_CANCEL', orderId: t.mt5.orderId });
    await tradeRef(t.id).update({ 'mt5.state': 'CANCELLED' }).catch(() => {});
  } catch {
    await pushLog(t.uid, [logEntry('PAUSE', `MT5: the ${t.mt5.symbol} order could not be cancelled (it may have filled at your broker). Check MT5: its stop and target are set.`, t.id)]);
  }
}

/** Closes the agent's open position on MT5 now (Stop and close) */
async function mt5Close(t: AgentTrade): Promise<void> {
  if (t.mt5?.state !== 'PLACED' || !t.mt5.clientId) return;
  const link = await linkOf(t.uid);
  if (!link || !mt5Configured()) return;
  try {
    const pos = (await mt5Positions(link)).find(p => p.clientId === t.mt5!.clientId);
    if (pos) await mt5Trade(link, { actionType: 'POSITION_CLOSE_ID', positionId: pos.id });
    else if (t.mt5.orderId) await mt5Trade(link, { actionType: 'ORDER_CANCEL', orderId: t.mt5.orderId }).catch(() => {});
    await tradeRef(t.id).update({ 'mt5.state': 'CLOSED' }).catch(() => {});
  } catch {
    await pushLog(t.uid, [logEntry('PAUSE', `MT5: the ${t.symbol} position could not be closed. Close it in MT5 yourself.`, t.id)]);
  }
}

/** Follows a new link until MetaApi has connected it to the broker, then reads the balance and matches the symbols */
async function finishLink(uid: string, tries = 18): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const link = await linkOf(uid);
    if (!link || link.status !== 'CONNECTING') return;
    try {
      const st = await mt5AccountState(link);
      if (st.state === 'DEPLOY_FAILED' || st.connection === 'DISCONNECTED_FROM_BROKER') {
        await deleteMt5Account(link).catch(() => {});
        await linkRef(uid).update({ status: 'FAILED', message: 'MT5 could not sign in. Check the login, the master (trading) password and the server name.', checkedAt: now() });
        await tell(uid, '⚠️ MT5 not linked', 'MT5 could not sign in with those details. Check the login, the master (trading) password and the server name, then try again.');
        return;
      }
      if (st.state === 'DEPLOYED' && st.connection === 'CONNECTED') {
        const [info, list] = await Promise.all([mt5AccountInfo(link), mt5Symbols(link)]);
        const symbols = Object.fromEntries(AGENT_MARKETS.map(m => [m.symbol, matchSymbol(m.symbol, list)]));
        await linkRef(uid).update({ status: 'CONNECTED', broker: info.broker, currency: info.currency, balance: info.balance, symbols, message: '', checkedAt: now() });
        await tell(uid, '🔗 MT5 linked', `Your MT5 account ${link.login} (${link.server}) is linked. The agent now places its trades there, sized to your risk per trade.`);
        return;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 10_000));
  }
  await linkRef(uid).update({ status: 'FAILED', message: 'MT5 took too long to connect. Try again in a few minutes.', checkedAt: now() }).catch(() => {});
}

/** Removes the trader's MT5 link (account deletion, Disconnect): deleted at MetaApi first, then here */
export async function unlinkMt5(uid: string, opts: { force?: boolean } = {}): Promise<void> {
  const link = await linkOf(uid);
  if (!link) return;
  try {
    if (mt5Configured()) await deleteMt5Account(link);
  } catch (err) {
    // Account deletion still removes the link here (the MetaApi account is logged so it can be removed by hand)
    if (!opts.force) throw err;
    console.warn('[MarketX Agent] MetaApi account could not be removed on account deletion; remove it in the MetaApi dashboard.');
  }
  await linkRef(uid).delete();
}

// ---------------------------------------------------------------------------
// The agent loop (lead worker)
// ---------------------------------------------------------------------------
let ticking = false;

/** Fills, closes and cancels live orders/trades from fresh 1-minute candles (one fetch per market) */
async function manageTrades(deps: AgentDeps) {
  const snap = await db().collection(TRADES).where('state', 'in', ['PENDING', 'OPEN']).get();
  const live = snap.docs.map(d => d.data() as AgentTrade);
  const bySymbol = new Map<string, AgentTrade[]>();
  for (const t of live) bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) || []), t]);
  for (const [symbol, list] of bySymbol) {
    const bars = await deps.getBars(symbol).catch(() => null);
    for (const t of list) {
      const step = stepTrade(t, bars || []);
      if (step.cancelled) {
        const note = step.cancelled === 'MISSED' ? 'Cancelled: price reached TP1 before the order filled.' : 'Cancelled: the order did not fill in time.';
        const ok = await cancelPending(t, note, { scanFrom: step.scanFrom });
        if (ok) await pushLog(t.uid, [logEntry('CANCEL', `${t.symbol} ${t.timeframe}: ${note.replace('Cancelled: ', 'order cancelled, ').replace(/\.$/, '')}.${t.credits ? ` ${t.credits} credits refunded.` : ''}`, t.id)]);
        continue;
      }
      let cur = t;
      if (step.filled) {
        const res = await fillTrade(t, step.filled);
        if (res !== 'OK') continue;
        cur = { ...t, state: 'OPEN', filledAt: step.filled.at };
        const text = `🎯 ${t.symbol} order filled: ${sideText(t).replace(' LIMIT', '')} at ${fmtPrice(t.entry)}, stop ${fmtPrice(t.stop)}, target ${fmtPrice(t.target)}.`;
        await pushLog(t.uid, [logEntry('FILL', text, t.id)]);
        await tell(t.uid, `🎯 Agent trade opened on ${t.symbol}`, text, { tradeId: t.id, mail: true, rows: [['Trade', `${sideText(t).replace(' LIMIT', '')} ${mt5Name(t.symbol)} · ${t.timeframe}`], ['Stop', fmtPrice(t.stop)], ['Target', fmtPrice(t.target)]] });
      }
      if (step.closed) {
        await closeTrade(cur, step.closed, step.closed.kind === 'TP' ? 'Target reached.' : step.closed.kind === 'SL' ? 'Stop reached.' : 'Closed at the market: open too long.');
        continue;
      }
      if (step.scanFrom !== t.scanFrom || step.filled) {
        await tradeRef(t.id).update({ scanFrom: step.scanFrom, updatedAt: now() }).catch(() => {});
      }
    }
  }
}

/** Ends runs whose time is up, then lets each running agent look for its next trade */
async function runAgents(deps: AgentDeps, onlyUid?: string) {
  const q = db().collection(AGENTS).where('run.state', '==', 'RUNNING');
  const agents = (await q.get()).docs.map(d => d.data() as AgentDoc).filter(a => !onlyUid || a.uid === onlyUid);
  const t = now();
  const due: AgentDoc[] = [];
  for (const a of agents) {
    if (!a.run) continue;
    if (t >= a.run.endsAt) {
      await endRun(a.uid, 'TIME_UP');
      continue;
    }
    // The agent's subscription ended (not renewed): the run stops, open trades keep their stop and target
    const u = (await userRef(a.uid).get()).data() as UserDoc | undefined;
    if (!agentSubActive(u as any, t)) {
      await endRun(a.uid, 'SUB_ENDED');
      continue;
    }
    if (onlyUid || t - (a.run.lastScanAt || 0) >= SCAN_GAP_MS) due.push(a);
  }
  if (!due.length) return;
  const liveSnap = await db().collection(TRADES).where('state', 'in', ['PENDING', 'OPEN']).get();
  const live = liveSnap.docs.map(d => d.data() as AgentTrade);
  // Every market/timeframe once, however many agents watch it
  const wanted = new Set<string>();
  const room = new Map<string, number>();
  const today = marketMailDay(t);
  for (const a of due) {
    const run = a.run!;
    const placed = run.day === today ? run.placedToday : 0;
    const active = live.filter(x => x.uid === a.uid).length;
    const left = Math.min(run.settings.tradesPerDay - placed, run.settings.tradesPerDay - active);
    room.set(a.uid, left);
    if (left <= 0) continue;
    for (const s of run.settings.markets) for (const tf of run.settings.timeframes) wanted.add(`${s}|${tf}`);
  }
  const scans = new Map<string, AgentSetup | null>();
  const keys = [...wanted];
  for (let i = 0; i < keys.length; i += SCAN_CONCURRENCY) {
    await Promise.all(
      keys.slice(i, i + SCAN_CONCURRENCY).map(async k => {
        const [s, tf] = k.split('|');
        scans.set(k, await deps.scan(s, tf).catch(() => null));
      })
    );
  }
  for (const a of due) {
    const run = a.run!;
    const left = room.get(a.uid) || 0;
    if (left <= 0) {
      await agentRef(a.uid).update({ 'run.lastScanAt': t }).catch(() => {});
      continue;
    }
    const busy = new Set(live.filter(x => x.uid === a.uid).map(x => x.symbol));
    const pick = pickSetup(run.settings, scans, busy, new Set(a.seen || []));
    if (!pick) {
      await agentRef(a.uid).update({ 'run.lastScanAt': t }).catch(() => {});
      continue;
    }
    await placeOrder(a, pick, today);
  }
}

/** Places one order for an agent: its credits are charged in the same transaction (refunded if it never fills) */
async function placeOrder(a: AgentDoc, pick: NonNullable<ReturnType<typeof pickSetup>>, today: string) {
  const run = a.run!;
  const s = pick.setup;
  const user = (await userRef(a.uid).get()).data() as UserDoc | undefined;
  if (!user || user.status === 'banned' || user.status === 'suspended') {
    await endRun(a.uid, 'STOPPED');
    return;
  }
  const free = !!user.emailVerified && isUnlimitedEmail(user.email);
  if (!free && (user.credits?.available ?? 0) < run.perTrade) {
    await endRun(a.uid, 'NO_CREDITS');
    return;
  }
  const entry = orderPrice(s.entry);
  const target = s.targets[s.targets.length - 1];
  const risk = Math.abs(entry - s.stop);
  const long = s.direction === 'LONG';
  // Levels must make sense for the side (the engine guarantees it; checked again before anything is placed)
  if (!finite(entry) || !finite(s.stop) || !finite(target) || !risk || (long ? !(s.stop < entry && target > entry) : !(s.stop > entry && target < entry))) return;
  const tfMs = tfMinutes(pick.timeframe) * 60e3;
  const t0 = now();
  const trade: AgentTrade = {
    id: id('at'), uid: a.uid, runId: run.id, symbol: pick.symbol, name: pick.symbol, timeframe: pick.timeframe, direction: s.direction,
    entry, entryMin: s.entry.min, entryMax: s.entry.max, stop: s.stop, target, tp1: s.targets[0], quality: Math.round(s.quality),
    rr: Number((Math.abs(target - entry) / risk).toFixed(2)), riskPct: run.settings.riskPct, state: 'PENDING', credits: free ? 0 : run.perTrade,
    createdAt: t0, updatedAt: t0, expiresAt: t0 + PENDING_CANDLES * tfMs, holdMs: MAX_CANDLES * tfMs, scanFrom: Math.floor(t0 / 60e3) * 60e3, execution: 'TRACKED',
  };
  const placed = await db().runTransaction(async tx => {
    const [as, us] = await Promise.all([tx.get(agentRef(a.uid)), tx.get(userRef(a.uid))]);
    const cur = as.data() as AgentDoc | undefined;
    const u = us.data() as UserDoc | undefined;
    if (!cur?.run || cur.run.state !== 'RUNNING' || cur.run.id !== run.id || !u) return false;
    if ((cur.seen || []).includes(pick.key)) return false;
    const placedToday = cur.run.day === today ? cur.run.placedToday : 0;
    if (placedToday >= cur.run.settings.tradesPerDay) return false;
    const cost = free ? 0 : run.perTrade;
    if (cost > (u.credits?.available ?? 0)) return 'NO_CREDITS' as const;
    // Campaign credits first, then the ordinary balance, then bought credits
    const campaign = campaignPool(u.credits);
    const bought = purchasedPool(u.credits);
    const fromCampaign = Math.min(campaign, cost);
    const ordinary = Math.max(0, (u.credits?.available ?? 0) - campaign - bought);
    const fromPurchased = Math.min(bought, Math.max(0, cost - fromCampaign - ordinary));
    if (cost) {
      tx.update(userRef(a.uid), {
        'credits.available': FieldValue.increment(-cost),
        ...(fromCampaign ? { 'credits.campaign': campaign - fromCampaign } : {}),
        ...(fromPurchased ? { 'credits.purchased': bought - fromPurchased } : {}),
        // The last campaign credit restarts the daily refill clock (same rule as an analysis)
        ...(fromCampaign && campaign - fromCampaign === 0 ? { 'credits.lastDailyReset': now() } : {}),
      });
    }
    tx.set(tradeRef(trade.id), { ...trade, credits: cost, campaignCharged: fromCampaign, purchasedCharged: fromPurchased });
    tx.update(agentRef(a.uid), {
      'run.day': today, 'run.placedToday': placedToday + 1, 'run.lastScanAt': t0, 'run.creditsUsed': FieldValue.increment(cost),
      seen: [pick.key, ...(cur.seen || [])].slice(0, SEEN_MAX), updatedAt: t0,
    });
    return true;
  });
  if (placed === 'NO_CREDITS') {
    await endRun(a.uid, 'NO_CREDITS');
    return;
  }
  if (!placed) return;
  const text = `📝 Order placed: ${orderLine(trade)}. Quality ${trade.quality}/100, ${trade.rr}R to the target. ${trade.credits ? `${trade.credits} credits used (refunded if it doesn't fill).` : ''}`.trim();
  await pushLog(a.uid, [logEntry('ORDER', text, trade.id)]);
  await tell(a.uid, `📝 Agent order on ${trade.symbol}`, text, { tradeId: trade.id });
  await mt5Open(trade, s.price).catch(err => console.warn('[MarketX Agent] MT5 order failed:', err?.message || err));
}

async function tick(deps: AgentDeps) {
  if (ticking) return;
  ticking = true;
  try {
    await manageTrades(deps);
    await runAgents(deps);
  } catch (err: any) {
    console.warn('[MarketX Agent] cycle failed:', err?.message || err);
  } finally {
    ticking = false;
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
function runView(run: AgentRun | null, trades: AgentTrade[]): AgentRunView | null {
  if (!run) return null;
  const { day: _d, placedToday: _p, lowCreditsAt: _l, ...rest } = run;
  return { ...rest, stats: agentStats(trades.filter(t => t.runId === run.id)) };
}

export function registerTradingAgentRoutes(app: Express, deps: AgentDeps & { closePrice?: (symbol: string) => Promise<number | null> }, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  if (isFirebaseConfigured() && IS_LEAD_WORKER) {
    setTimeout(() => {
      tick(deps);
      setInterval(() => tick(deps), TICK_MS).unref();
    }, BOOT_DELAY_MS).unref();
  }

  const throttle = createKeyedThrottle({ windowMs: 60_000, max: 20 });
  const guard = (req: Request, res: Response, next: NextFunction) => {
    if (throttle.hit(getUser(res).uid)) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many changes. Please wait a minute.' });
    next();
  };
  const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) =>
    fn(req, res).catch(err => {
      console.error(`[MarketX Agent] ${req.method} ${req.path} failed:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
    });
  const ready = (_req: Request, res: Response, next: NextFunction) => {
    if (!isFirebaseConfigured()) return res.status(503).json({ error: 'UNAVAILABLE', message: 'The trading agent is not available right now.' });
    next();
  };

  const state = async (uid: string) => {
    const [snap, trades, user, link] = await Promise.all([agentRef(uid).get(), tradesOf(uid), userRef(uid).get(), linkOf(uid)]);
    const a = snap.data() as AgentDoc | undefined;
    const u = user.data() as UserDoc | undefined;
    const free = !!u?.emailVerified && isUnlimitedEmail(u?.email || '');
    const sub = (u as any)?.agentSub as { active?: boolean; plan?: string; expiresAt?: number } | undefined;
    const pay = getPaymentsPublicConfig();
    return {
      settings: a?.settings || DEFAULT_AGENT_SETTINGS,
      run: runView(a?.run || null, trades),
      trades: trades.slice(0, 60).map(toView),
      stats: agentStats(trades),
      log: (a?.log || []).slice(0, 40),
      markets: AGENT_MARKETS,
      pricing: AGENT_PRICING,
      minQuality: AGENT_MIN_QUALITY,
      backtest: AGENT_BACKTEST,
      credits: free ? null : Math.max(0, u?.credits?.available ?? 0),
      // The agent's own subscription ($30 a month, yearly 18% off); staff accounts don't need one
      subscription: {
        active: agentSubActive(u as any),
        staff: free,
        plan: sub?.plan || null,
        expiresAt: sub?.expiresAt || null,
        monthlyUsd: pay.agentMonthlyAmount,
        yearlyUsd: pay.agentYearlyAmount,
        yearlyDiscountPct: pay.agentYearlyDiscountPct,
        payments: pay.enabled,
      },
      // MT5 link: never the password or MetaApi's account id
      mt5: {
        available: mt5Configured(),
        link: link
          ? { status: link.status, login: link.login, server: link.server, broker: link.broker || null, currency: link.currency || null, balance: link.balance ?? null, symbols: link.symbols || {}, message: link.message || '', linkedAt: link.linkedAt }
          : null,
      },
    };
  };

  app.get('/api/agent', limiter, requireAuth, ready, wrap(async (_req, res) => {
    res.json(await state(getUser(res).uid));
  }));

  app.put('/api/agent/settings', limiter, requireAuth, ready, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const v = normalizeAgentSettings(req.body?.settings);
    if (v.ok === false) return res.status(400).json({ error: 'BAD_SETTINGS', message: v.message });
    const a = (await agentRef(uid).get()).data() as AgentDoc | undefined;
    if (a?.run?.state === 'RUNNING') return res.status(409).json({ error: 'AGENT_RUNNING', message: 'Stop the agent to change its settings.' });
    await agentRef(uid).set({ uid, settings: v.settings, updatedAt: now(), ...(a ? {} : { run: null, log: [], seen: [] }) }, { merge: true });
    res.json(await state(uid));
  }));

  app.post('/api/agent/start', limiter, requireAuth, ready, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const v = normalizeAgentSettings(req.body?.settings);
    if (v.ok === false) return res.status(400).json({ error: 'BAD_SETTINGS', message: v.message });
    const s = v.settings;
    const price = AGENT_PRICING[s.duration];
    const t = now();
    const run: AgentRun = {
      id: id('ar'), state: 'RUNNING', startedAt: t, endsAt: t + price.days * 86400e3, settings: s, perTrade: price.perTrade,
      maxCredits: agentMaxCost(s), creditsUsed: 0, day: marketMailDay(t), placedToday: 0, lastScanAt: 0,
    };
    const result = await db().runTransaction(async tx => {
      const [as, us] = await Promise.all([tx.get(agentRef(uid)), tx.get(userRef(uid))]);
      const a = as.data() as AgentDoc | undefined;
      const u = us.data() as UserDoc | undefined;
      if (!u) return 'NO_ACCOUNT';
      if (!agentSubActive(u as any)) return 'NO_SUB';
      if (a?.run?.state === 'RUNNING') return 'RUNNING';
      const free = !!u.emailVerified && isUnlimitedEmail(u.email);
      if (!free && (u.credits?.available ?? 0) < price.perTrade) return 'NO_CREDITS';
      tx.set(agentRef(uid), { uid, settings: s, run, log: a?.log || [], seen: a?.seen || [], updatedAt: t });
      return 'OK';
    });
    if (result === 'NO_SUB') return res.status(402).json({ error: 'AGENT_SUB_REQUIRED', message: 'The Trading Agent needs its subscription. Subscribe to switch it on.' });
    if (result === 'RUNNING') return res.status(409).json({ error: 'AGENT_RUNNING', message: 'The agent is already running.' });
    if (result === 'NO_CREDITS') return res.status(402).json({ error: 'NO_CREDITS', message: `You need at least ${price.perTrade} credits (one trade) to start a ${price.label.toLowerCase()} run.` });
    if (result !== 'OK') return res.status(409).json({ error: 'NO_ACCOUNT', message: 'Account not initialised. Please sign in again.' });
    const ends = new Date(run.endsAt).toLocaleString('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const text = `${price.label} run started: ${s.markets.join(', ')} on ${s.timeframes.join(' and ')}, risk ${s.riskPct}% a trade, up to ${s.tradesPerDay} trade${s.tradesPerDay === 1 ? '' : 's'} a day. Runs until ${ends} WAT. ${price.perTrade} credits a trade, taken when the agent places it and refunded if it never fills.`;
    await pushLog(uid, [logEntry('START', text)]);
    tell(uid, '🤖 Trading agent is on', text, { mail: true, rows: [['Run', price.label], ['Risk a trade', `${s.riskPct}%`], ['Most it can cost', `${run.maxCredits} credits`]] }).catch(() => {});
    // First look straight away on the lead worker (others: within the next cycle)
    if (IS_LEAD_WORKER) runAgents(deps, uid).catch(err => console.warn('[MarketX Agent] first scan failed:', err?.message || err));
    res.json(await state(uid));
  }));

  // ---- MT5 link (MetaApi). The password is only passed through to MetaApi: never stored, logged or returned.
  const linkThrottle = createKeyedThrottle({ windowMs: 60 * 60_000, max: 6 });
  app.post('/api/agent/mt5/connect', limiter, requireAuth, ready, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    if (!mt5Configured()) return res.status(503).json({ error: 'MT5_NOT_CONFIGURED', message: 'MT5 linking is not available yet.' });
    const u = (await userRef(uid).get()).data() as UserDoc | undefined;
    if (!agentSubActive(u as any)) return res.status(402).json({ error: 'AGENT_SUB_REQUIRED', message: 'Linking MT5 needs the Trading Agent subscription.' });
    if (linkThrottle.hit(uid)) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many link attempts. Please try again later.' });
    const login = String(req.body?.login ?? '').trim();
    const server = String(req.body?.server ?? '').trim();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!/^\d{3,20}$/.test(login)) return res.status(400).json({ error: 'BAD_LOGIN', message: 'Your MT5 login is the account number (digits only).' });
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._()\-]{2,79}$/.test(server)) return res.status(400).json({ error: 'BAD_SERVER', message: 'Type the broker server exactly as MT5 shows it, e.g. Exness-MT5Real8.' });
    if (password.length < 4 || password.length > 64 || /[\u0000-\u001F]/.test(password)) return res.status(400).json({ error: 'BAD_PASSWORD', message: 'Type your MT5 master (trading) password.' });
    if (req.body?.consent !== true) return res.status(400).json({ error: 'CONSENT_REQUIRED', message: 'Tick the box to let the agent place trades on this account.' });
    const existing = await linkOf(uid);
    if (existing && existing.status !== 'FAILED') return res.status(409).json({ error: 'MT5_LINKED', message: 'An MT5 account is already linked. Disconnect it first.' });
    if (existing) await unlinkMt5(uid).catch(() => {});
    let created: Mt5Link;
    try {
      created = await createMt5Account({ login, password, server, name: `MarketX ${uid.slice(0, 8)}` });
    } catch (err) {
      const msg = err instanceof Mt5Error ? err.message : 'Could not reach MT5. Please try again.';
      return res.status(err instanceof Mt5Error && err.code === 'MT5_ERROR' ? 400 : 502).json({ error: 'MT5_LINK_FAILED', message: msg });
    }
    const doc: Mt5LinkDoc = { uid, ...created, status: 'CONNECTING', login: maskLogin(login), server, linkedAt: now() };
    await linkRef(uid).set(doc);
    finishLink(uid).catch(err => console.warn('[MarketX Agent] MT5 link check failed:', err?.message || err));
    res.json(await state(uid));
  }));

  const refreshThrottle = createKeyedThrottle({ windowMs: 60_000, max: 3 });
  app.post('/api/agent/mt5/refresh', limiter, requireAuth, ready, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const link = await linkOf(uid);
    if (!link) return res.status(404).json({ error: 'NOT_LINKED', message: 'No MT5 account is linked.' });
    if (refreshThrottle.hit(uid)) return res.status(429).json({ error: 'TOO_SOON', message: 'Checked a moment ago. Try again in a minute.' });
    if (link.status === 'CONNECTING') await finishLink(uid, 1).catch(() => {});
    else if (link.status === 'CONNECTED' && mt5Configured()) {
      try {
        const [info, list] = await Promise.all([mt5AccountInfo(link), mt5Symbols(link)]);
        await linkRef(uid).update({ balance: info.balance, currency: info.currency, broker: info.broker, symbols: Object.fromEntries(AGENT_MARKETS.map(m => [m.symbol, matchSymbol(m.symbol, list)])), checkedAt: now() });
      } catch {}
    }
    res.json(await state(uid));
  }));

  app.delete('/api/agent/mt5', limiter, requireAuth, ready, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    try {
      await unlinkMt5(uid);
    } catch {
      return res.status(502).json({ error: 'MT5_UNLINK_FAILED', message: 'Could not disconnect right now. Please try again.' });
    }
    res.json(await state(uid));
  }));

  app.post('/api/agent/stop', limiter, requireAuth, ready, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const closeOpen = req.body?.closeOpen === true && deps.closePrice ? (t: AgentTrade) => deps.closePrice!(t.symbol) : undefined;
    const ended = await endRun(uid, 'STOPPED', { closeOpen });
    if (!ended) return res.status(409).json({ error: 'NOT_RUNNING', message: 'The agent is not running.' });
    res.json(await state(uid));
  }));
}

export const __agentInternals = { tick, manageTrades, runAgents, closeTrade, fillTrade, endRun };
