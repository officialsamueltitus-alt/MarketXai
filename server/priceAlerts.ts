import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { db, isFirebaseConfigured } from './firebase';
import { sendEmail } from './mailer';
import { sendPush } from './webPush';
import { claimMarketMail, getUser, nextMarketMail, notifyActivity, requireAuth, siteLink, userRef, type UserDoc } from './account';
import { effectivePreferences, hasProFeatures } from './proAccess';
import { IS_LEAD_WORKER } from './workers';
import { createKeyedThrottle } from './security';
import { archiveAlertOutcome, openAutoJournal, progressAutoJournal, signalKey } from './journal';
import { exactPrice } from '../src/utils/formatPrice';
import { CLOSE_WARNING_MS, STYLE_INFO, closeByText } from '../src/utils/tradeStyle';

// ===========================================================================
// Price alerts (/price-alerts): after a trader approves live alerts, MarketX watches the market for the setups they
// choose and notifies them (site notification + email) when price reaches the entry zone (POI), the stop loss or a
// take profit. Everything runs on the server, so phones do no work at all.
//
//   alertOffers/{id}  -> every LONG / SHORT signal served, with its levels (the only source of alert levels, so a
//                        client can never plant arbitrary numbers). Unused offers trigger one "Want an alert?" email.
//   priceAlerts/{id}  -> the alerts traders turned on (id = al_{offerId}: one alert per signal)
//
// Scale: only the lead worker runs the monitor. It keeps the active alerts in memory (synced incrementally from
// Firestore), fetches ONE series of 1-minute candles per symbol per cycle (shared by every alert on that symbol and
// cached), checks each candle's high and low so quick wicks are never missed, and writes only when a level is hit,
// inside a transaction (no duplicate notifications even with several workers or restarts).
// ===========================================================================

/** END: the trade type's close time (day: 9:00 PM WAT, swing: Friday 9:00 PM WAT) came first; price = the price then */
/** HALF: Secure half (Preference Mode): +1R reached, take half off and move the stop to entry. BE: the runner came back
 *  to entry after HALF (closed at break-even, half already banked) */
export type AlertKind = 'ENTRY' | 'TP1' | 'TP2' | 'TP3' | 'SL' | 'MISSED' | 'END' | 'HALF' | 'BE';
export interface AlertHit { kind: AlertKind; at: number; price: number }
export interface AlertLevels {
  symbol: string;
  name: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  execution: 'LIMIT' | 'MARKET';
  entry: { min: number; max: number; optimal: number };
  stop: number;
  tps: number[];
  /** Strategy mode: the trader's own strategy that produced the signal (its results stay out of MarketX's own record) */
  userStrategy?: string;
  /** Trade type of the signal (Preference Mode) */
  tradeStyle?: 'SCALP' | 'DAY' | 'SWING';
  /** Day / swing trade: when it must be closed (epoch ms); still open then = ENDED at that price */
  closeBy?: number;
}
export interface AlertOffer extends AlertLevels {
  id: string;
  uid: string;
  createdAt: number;
  expiresAt: number;
  emailPending: boolean;
  emailAt: number;
  alertId?: string;
}
export interface PriceAlert extends AlertLevels {
  id: string;
  uid: string;
  offerId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  active: boolean;
  entered: boolean;
  hits: AlertHit[];
  endedReason?: 'SL' | 'TP3' | 'MISSED' | 'EXPIRED' | 'TURNED_OFF' | 'ENDED' | 'BE';
  /** Secure half (owner-specified, Preference Mode, chosen when the alert starts): the +1R price where half is taken off
   *  and the stop moves to entry */
  secureHalf?: number;
  /** The "close it by 9:00 PM WAT" heads-up was sent */
  closeWarned?: boolean;
  /** Every served copy of this same signal (each result card): they all show this one alert */
  offerIds?: string[];
}
export interface Bar { t: number; o: number; h: number; l: number; c: number }
export interface PriceAlertDeps {
  /** Recent 1-minute candles for a symbol (oldest first), or null when the feed is unavailable */
  getBars: (symbol: string) => Promise<Bar[] | null>;
  /** Live quote for a symbol (shown on the trader's active alerts when they refresh), or null */
  getQuote?: (symbol: string) => Promise<{ price: number; change24h: number } | null>;
}

const OFFERS = 'alertOffers';
const ALERTS = 'priceAlerts';
const MAX_ACTIVE_PER_USER = 25;
const OFFER_EMAIL_DELAY_MS = Math.max(1000, Number(process.env.ALERT_OFFER_EMAIL_DELAY_MS) || 15 * 60 * 1000);
const OFFER_EMAIL_GAP_MS = 6 * 60 * 60 * 1000;
const TICK_MS = Math.max(2000, Number(process.env.ALERT_TICK_MS) || 5_000);
const SYNC_MS = Math.max(2000, Number(process.env.ALERT_SYNC_MS) || 20_000);
const OFFER_SWEEP_MS = Math.max(2000, Number(process.env.ALERT_OFFER_SWEEP_MS) || 2 * 60 * 1000);
const BOOT_DELAY_MS = Math.max(500, Number(process.env.ALERT_BOOT_MS) || 20_000);
const FETCH_CONCURRENCY = 6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Minutes in a timeframe label ("15m", "1H", "4H", "1D", "1W"; "15M" also means minutes) */
export function tfMinutes(tf: string): number {
  const m = /^\s*(\d+)\s*(m|min|h|d|w)/i.exec(String(tf || ''));
  if (!m) return 60;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  return u === 'h' ? n * 60 : u === 'd' ? n * 1440 : u === 'w' ? n * 10080 : n;
}

/** How long an alert keeps watching: about 100 candles of its timeframe, between 6 hours and 21 days */
export function alertHorizonMs(tf: string): number {
  return Math.min(21 * 86400e3, Math.max(6 * 3600e3, tfMinutes(tf) * 100 * 60e3));
}

export function levelsFromStrategy(s: any): AlertLevels | null {
  if (!s || (s.tradeType !== 'LONG' && s.tradeType !== 'SHORT')) return null;
  const tps = (Array.isArray(s.takeProfits) ? s.takeProfits : []).map((t: any) => Number(t?.price)).filter(finite).slice(0, 3);
  const entry = { min: Number(s.entryZone?.min), max: Number(s.entryZone?.max), optimal: Number(s.entryZone?.optimal) };
  const stop = Number(s.stopLoss?.price);
  if (!finite(entry.min) || !finite(entry.max) || !finite(entry.optimal) || !finite(stop) || !tps.length) return null;
  if (entry.min > entry.max) [entry.min, entry.max] = [entry.max, entry.min];
  const long = s.tradeType === 'LONG';
  // Levels must make sense for the direction, or the alert could fire nonsense
  if (long ? !(stop < entry.min && tps.every((p: number) => p > entry.max)) : !(stop > entry.max && tps.every((p: number) => p < entry.min))) return null;
  return {
    symbol: String(s.symbol || '').slice(0, 32),
    name: String(s.name || s.symbol || '').slice(0, 60),
    timeframe: String(s.timeframe || '').slice(0, 8),
    direction: s.tradeType,
    execution: s.execution === 'MARKET' ? 'MARKET' : 'LIMIT',
    entry,
    stop,
    tps,
    ...(s.userStrategy?.name ? { userStrategy: String(s.userStrategy.name).slice(0, 48) } : {}),
    ...(['SCALP', 'DAY', 'SWING'].includes(s.tradeStyle?.style) ? { tradeStyle: s.tradeStyle.style } : {}),
    ...(finite(s.tradeStyle?.closeBy) ? { closeBy: s.tradeStyle.closeBy } : {}),
  };
}

/** How long an alert keeps watching: its timeframe's horizon, and never past its close time (+1h to record the end) */
const alertExpiry = (l: AlertLevels, from: number) => Math.min(from + alertHorizonMs(l.timeframe), l.closeBy ? l.closeBy + 3600e3 : Infinity);
/** Secure half: the +1R price (entry + one risk, in the trade's direction) */
export function secureHalfPrice(a: Pick<AlertLevels, 'direction' | 'entry' | 'stop'>): number | undefined {
  const e = a.entry.optimal;
  if (!finite(e) || !finite(a.stop) || e === a.stop) return undefined;
  const p = a.direction === 'LONG' ? e + Math.abs(e - a.stop) : e - Math.abs(e - a.stop);
  return finite(p) ? Number(p.toPrecision(10)) : undefined;
}
const styleLabel = (a: AlertLevels) => (a.tradeStyle ? STYLE_INFO[a.tradeStyle].label : 'Trade');
/** R of a trade closed at a price, from its own levels */
export function rAtPrice(a: Pick<AlertLevels, 'direction' | 'entry' | 'stop'>, price: number): number | null {
  const e = a.entry.optimal;
  if (!finite(e) || !finite(a.stop) || e === a.stop || !finite(price)) return null;
  return Number((((price - e) * (a.direction === 'LONG' ? 1 : -1)) / Math.abs(e - a.stop)).toFixed(2));
}
const rWords = (r: number | null) => (r === null ? '' : ` (${r > 0 ? '+' : ''}${r.toFixed(2)}R)`);

/** Prices in alert notices and emails, exactly as the levels and feeds give them (never rounded) */
export function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return String(p);
  return exactPrice(p);
}

const side = (a: AlertLevels) => (a.direction === 'LONG' ? (a.execution === 'MARKET' ? 'BUY' : 'BUY LIMIT') : a.execution === 'MARKET' ? 'SELL' : 'SELL LIMIT');

const FIAT = new Set('USD EUR GBP JPY CHF CAD AUD NZD SEK NOK DKK PLN CZK HUF TRY ZAR MXN BRL CNH CNY HKD SGD INR KRW THB IDR MYR PHP ILS SAR AED NGN KES GHS EGP RUB CLP COP ARS TWD'.split(' '));
/**
 * How far price must trade THROUGH a stop or target before MarketX counts it (owner-specified, fair to both sides).
 * MarketX reads one feed (e.g. Binance BTC/USDT); a trader's broker (e.g. MT5 BTCUSD) quotes its own price, often a
 * little away from it, so a wick that only just touches a level on our feed may never reach it at the broker. A level
 * counts once price passes it by a small margin sized to the market, capped at 15% of the trade's risk so it never
 * swamps a tight stop. Stops and targets use the same margin (no bias towards wins); Deriv synthetics are the broker's
 * own feed, so they count on touch.
 */
export function levelTolerance(symbol: string | undefined, level: number, risk: number): number {
  const sym = String(symbol || '').toUpperCase().trim();
  let pct: number;
  if (/^(BOOM|CRASH|VOLATILITY|JUMP|STEP|RANGE BREAK|DEX)\b/.test(sym)) pct = 0;
  else if (/^(XAU|XAG|XPT|XPD)\//.test(sym)) pct = 0.001;
  else if (/^[A-Z]{3}\/[A-Z]{3}$/.test(sym) && FIAT.has(sym.slice(0, 3)) && FIAT.has(sym.slice(4))) pct = 0.00008;
  else if (/\//.test(sym) && !/^(WTI|BRENT|NGAS|COPPER)\b/.test(sym)) pct = 0.0006;
  else pct = 0.0003;
  if (!pct || !finite(level) || !finite(risk) || risk <= 0) return 0;
  return Math.min(Math.abs(level) * pct, risk * 0.15);
}

/**
 * Walks candles (oldest first) and returns the new level hits for an alert, in the order they happened.
 * Before the entry fills, reaching the first target means the move happened without the trader (MISSED).
 * After entry: the stop loss closes the alert; the targets fire in turn and the last one closes it.
 */
export function evaluateBars(
  a: Pick<PriceAlert, 'direction' | 'entry' | 'stop' | 'tps' | 'entered' | 'hits' | 'createdAt'> & { scanFrom?: number; symbol?: string; secureHalf?: number },
  bars: Bar[]
): { hits: AlertHit[]; entered: boolean; closed: boolean } {
  const long = a.direction === 'LONG';
  // Stops and targets count once price trades through them by the market's margin (see levelTolerance)
  const risk = Math.abs((a.entry?.optimal ?? (a.entry.min + a.entry.max) / 2) - a.stop);
  const tol = (p: number) => levelTolerance(a.symbol, p, risk);
  const done = new Set(a.hits.map(h => h.kind));
  const hits: AlertHit[] = [];
  let entered = a.entered;
  let closed = done.has('SL') || done.has('BE') || done.has('MISSED') || done.has('END') || done.has(`TP${a.tps.length}` as AlertKind);
  // Secure half: once +1R is reached (on an earlier candle), the runner's stop sits at entry
  const half = finite(a.secureHalf) ? (a.secureHalf as number) : null;
  let halfDone = done.has('HALF');
  const be = a.entry?.optimal ?? (a.entry.min + a.entry.max) / 2;
  // Only candles from the alert's creation on, and (in the monitor) only the ones not scanned yet
  const fromT = Math.max(Math.floor(a.createdAt / 60e3) * 60e3, a.scanFrom || 0);
  let lo = 0, hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t < fromT) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo; i < bars.length; i++) {
    const b = bars[i];
    if (closed) break;
    if (!(b.t >= fromT) || !finite(b.h) || !finite(b.l)) continue;
    const reached = (p: number) => (long ? b.h >= p + tol(p) : b.l <= p - tol(p));
    if (!entered) {
      if (long ? b.l <= a.entry.max : b.h >= a.entry.min) {
        entered = true;
        hits.push({ kind: 'ENTRY', at: b.t, price: long ? Math.min(a.entry.max, Math.max(a.entry.min, b.l)) : Math.max(a.entry.min, Math.min(a.entry.max, b.h)) });
      } else {
        if (reached(a.tps[0])) {
          hits.push({ kind: 'MISSED', at: b.t, price: a.tps[0] });
          closed = true;
        }
        continue;
      }
    }
    if (halfDone ? (long ? b.l <= be - tol(be) : b.h >= be + tol(be)) : long ? b.l <= a.stop - tol(a.stop) : b.h >= a.stop + tol(a.stop)) {
      hits.push(halfDone ? { kind: 'BE', at: b.t, price: be } : { kind: 'SL', at: b.t, price: a.stop });
      closed = true;
      break;
    }
    // Stop checked first (same candle = stop); +1R then moves the stop to entry from the next candle on
    if (half !== null && !halfDone && reached(half)) {
      hits.push({ kind: 'HALF', at: b.t, price: half });
      halfDone = true;
    }
    for (let i = 0; i < a.tps.length; i++) {
      const kind = `TP${i + 1}` as AlertKind;
      if (done.has(kind) || hits.some(h => h.kind === kind)) continue;
      if (!reached(a.tps[i])) break;
      hits.push({ kind, at: b.t, price: a.tps[i] });
      if (i === a.tps.length - 1) closed = true;
    }
  }
  return { hits, entered, closed };
}

function hitMessage(a: AlertLevels, h: AlertHit & { entered?: boolean; live?: number }): { title: string; message: string; subject: string; lines: string[] } {
  const sym = a.symbol;
  // The price at the moment MarketX saw the hit (latest 1-minute candle close), so the trader can compare with their chart
  const now = finite(h.live) && h.kind !== 'END' ? ` Price now ${fmtPrice(h.live!)}.` : '';
  const tf = a.timeframe ? ` (${a.timeframe})` : '';
  switch (h.kind) {
    case 'ENTRY':
      return {
        title: `🎯 ${sym} reached your entry zone`,
        message: `${side(a)}${tf}: price is in your entry zone ${fmtPrice(a.entry.min)} to ${fmtPrice(a.entry.max)}.${now} Stop ${fmtPrice(a.stop)}, first target ${fmtPrice(a.tps[0])}.`,
        subject: `🎯 ${sym} reached your entry zone`,
        lines: [`Price just reached the entry zone of your ${side(a)} setup on ${sym}${tf}.`, 'Check the chart and your plan before you act.'],
      };
    case 'HALF':
      return {
        title: `🔒 ${sym}: secure half now`,
        message: `${side(a)}${tf}: price reached +1R (${fmtPrice(h.price)}).${now} Take half off and move your stop to entry (${fmtPrice(a.entry.optimal)}). The rest runs to the targets.`,
        subject: `🔒 ${sym}: take half and move your stop to entry`,
        lines: [`Price reached +1R (${fmtPrice(h.price)}) on your ${side(a)} setup on ${sym}${tf}.`, `Take half off and move your stop to entry (${fmtPrice(a.entry.optimal)}). The rest runs to the targets.`],
      };
    case 'BE':
      return {
        title: `🔒 ${sym}: runner closed at entry`,
        message: `${side(a)}${tf}: price came back to your entry (${fmtPrice(a.entry.optimal)}) after you secured half at +1R. The trade ends +0.50R. Alert closed.`,
        subject: `🔒 ${sym}: runner closed at entry (+0.50R)`,
        lines: [`Price came back to the entry of your ${side(a)} setup on ${sym}${tf} after half was secured at +1R.`, 'The rest closed at break-even: the trade ends +0.50R. This alert is now closed.'],
      };
    case 'SL':
      return {
        title: `🛑 ${sym} hit your stop loss`,
        message: `${side(a)}${tf}: price reached the stop loss at ${fmtPrice(a.stop)}.${now} This alert is now closed.`,
        subject: `🛑 ${sym} hit your stop loss`,
        lines: [`Price reached the stop loss of your ${side(a)} setup on ${sym}${tf}.`, 'This alert is now closed. Losses are part of trading: stick to your risk plan.'],
      };
    case 'END': {
      const label = styleLabel(a);
      const when = a.closeBy ? closeByText(a.closeBy) : 'the close';
      if (!h.entered) {
        return {
          title: `⏰ ${sym}: ${label.toLowerCase()} closed before your entry`,
          message: `${side(a)}${tf}: ${when} came before price reached the entry zone, so this setup is cancelled. Alert closed.`,
          subject: `${sym}: ${label.toLowerCase()} closed before your entry`,
          lines: [`The ${label.toLowerCase()} close (${when}) came before price reached the entry of your ${side(a)} setup on ${sym}${tf}.`, 'The setup is cancelled and the alert is closed.'],
        };
      }
      const r = rAtPrice(a, h.price);
      return {
        title: `⏰ Close your ${sym} trade now`,
        message: `${label} close (${when}): close your ${side(a)}${tf} trade now, in profit or in loss. Price ${fmtPrice(h.price)}${rWords(r)}. MarketX recorded it as ended.`,
        subject: `⏰ ${label} close: close your ${sym} trade now`,
        lines: [`It's the ${label.toLowerCase()} close (${when}). Close your ${side(a)} trade on ${sym}${tf} now, in profit or in loss.`, `Price was ${fmtPrice(h.price)}${rWords(r)}. MarketX recorded the trade as ended at that price.`],
      };
    }
    case 'MISSED':
      return {
        title: `⏭️ ${sym} moved without your entry`,
        message: `Price reached the first target (${fmtPrice(a.tps[0])}) before your entry filled, so this setup no longer applies.${now} Alert closed.`,
        subject: `${sym} moved before your entry filled`,
        lines: [`Price reached the first target of your ${side(a)} setup on ${sym}${tf} before the entry zone was touched.`, 'The setup no longer applies, so the alert is closed. Ask MarketX for a fresh analysis.'],
      };
    default: {
      const n = Number(h.kind.slice(2));
      const last = n === a.tps.length;
      return {
        title: `✅ ${sym} hit TP${n}`,
        message: `${side(a)}${tf}: target ${n} at ${fmtPrice(h.price)} reached.${now}${last ? ' Every target is done, alert closed.' : ''}`,
        subject: `✅ ${sym} hit take profit ${n}`,
        lines: [`Price reached take profit ${n} (${fmtPrice(h.price)}) of your ${side(a)} setup on ${sym}${tf}.`, last ? 'That was the final target, so this alert is now closed.' : 'MarketX keeps watching the next target for you.'],
      };
    }
  }
}

/** At most three rows in an alert email: the level that was hit and what matters next (the full plan is on the site) */
function mailRows(a: AlertLevels, h: AlertHit): [string, string][] {
  const setup: [string, string] = ['Setup', `${side(a)} · ${a.symbol}${a.timeframe ? ` · ${a.timeframe}` : ''}`];
  if (h.kind === 'ENTRY') return [setup, ['Stop loss', fmtPrice(a.stop)], ['TP1', fmtPrice(a.tps[0])]];
  if (h.kind === 'SL') return [setup, ['Stop loss', fmtPrice(a.stop)]];
  if (h.kind === 'HALF') return [setup, ['+1R', fmtPrice(h.price)], ['New stop (entry)', fmtPrice(a.entry.optimal)]];
  if (h.kind === 'BE') return [setup, ['Closed at entry', fmtPrice(h.price)], ['Result', '+0.50R']];
  if (h.kind === 'MISSED') return [setup, ['TP1', fmtPrice(a.tps[0])]];
  if (h.kind === 'END') return [setup, ['Closed at', fmtPrice(h.price)]];
  const n = Number(h.kind.slice(2));
  return [setup, [`TP${n}`, fmtPrice(h.price)], ...(a.tps[n] ? [[`TP${n + 1}`, fmtPrice(a.tps[n])] as [string, string]] : [])];
}

// ---------------------------------------------------------------------------
// Offers: recorded as a signal is served (wraps res.json on /api/market/analyze; the analysis itself is untouched)
// ---------------------------------------------------------------------------
export function alertOfferMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isFirebaseConfigured()) return next();
  const json = res.json.bind(res);
  res.json = ((body: any) => {
    let pending: Promise<void> | null = null;
    try {
      const uid = (res.locals.user as any)?.uid as string | undefined;
      const s = body?.strategy;
      const levels = uid && res.statusCode < 400 ? levelsFromStrategy(s) : null;
      if (uid && levels) {
        const id = `of_${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`;
        s.alertOffer = { id };
        pending = recordOffer(uid, id, levels, s.alertOffer);
      }
    } catch {}
    if (!pending) return json(body);
    // Auto mode starts the alert before the result goes out, so the card already shows it (never held for long)
    Promise.race([pending.catch(err => console.warn('[MarketX Alerts] offer save failed:', err?.message || err)), new Promise(r => setTimeout(r, 2500))]).then(() => json(body));
    return res;
  }) as typeof res.json;
  next();
}

/** Saves the offer; in Auto mode the alert starts at once, exactly as if the trader had tapped it (price alerts are free) */
async function recordOffer(uid: string, id: string, levels: AlertLevels, view: { id: string; auto?: boolean; autoSkipped?: string }) {
  const now = Date.now();
  const offer: AlertOffer = { ...levels, id, uid, createdAt: now, expiresAt: alertExpiry(levels, now), emailPending: true, emailAt: now + OFFER_EMAIL_DELAY_MS };
  await db().collection(OFFERS).doc(id).set(offer);
  const user = (await userRef(uid).get()).data() as UserDoc | undefined;
  if (!user?.alerts?.enabled || user.alerts.mode !== 'AUTO') return;
  const started = await startAlert(uid, offer);
  if ('alert' in started) view.auto = true;
  else view.autoSkipped = started.error;
}

type StartResult = { alert: PriceAlert } | { error: 'ENDED' | 'TOO_MANY_ALERTS'; message: string };

/** Starts watching an offer (tapped by the trader, or by itself in Auto mode); the journal, track record and notices follow it */
async function startAlert(uid: string, offer: AlertOffer): Promise<StartResult> {
  const mine = (await db().collection(ALERTS).where('uid', '==', uid).get()).docs.map(d => d.data() as PriceAlert);
  // The same signal served again (same pair, timeframe and levels) is the SAME alert: never a second alert, journal trade
  // or track record result
  const own = `al_${offer.id}`;
  const key = signalKey(offer);
  const twin = mine.some(a => a.id === own) ? null : mine.filter(a => signalKey(a) === key).sort((a, b) => Number(b.active) - Number(a.active) || a.createdAt - b.createdAt)[0];
  const id = twin ? twin.id : own;
  const existing = mine.find(a => a.id === id);
  if (existing?.active) {
    if (!twin) return { alert: existing };
    const offerIds = [...new Set([...(existing.offerIds || [existing.offerId]), offer.id])].slice(-20);
    await db().collection(ALERTS).doc(id).update({ offerIds });
    await db().collection(OFFERS).doc(offer.id).update({ emailPending: false, alertId: id }).catch(() => {});
    return { alert: { ...existing, offerIds } };
  }
  if (existing && existing.hits.some(h => ['SL', 'BE', 'MISSED', 'END', `TP${existing.tps.length}`].includes(h.kind))) {
    return { error: 'ENDED', message: 'This setup has already played out.' };
  }
  if (offer.closeBy && offer.closeBy <= Date.now()) {
    return { error: 'ENDED', message: `This ${styleLabel(offer).toLowerCase()} has passed its close time (${closeByText(offer.closeBy)}).` };
  }
  if (mine.filter(a => a.active && a.expiresAt > Date.now()).length >= MAX_ACTIVE_PER_USER) {
    return { error: 'TOO_MANY_ALERTS', message: `You can have up to ${MAX_ACTIVE_PER_USER} active alerts. Turn one off first.` };
  }
  const now = Date.now();
  const { id: offerId, uid: _u, createdAt: _c, expiresAt, emailPending: _e, emailAt: _a, alertId: _al, ...levels } = offer;
  const owner = (await userRef(uid).get().catch(() => null))?.data() as UserDoc | undefined;
  // Secure half (Preference Mode): fixed when the alert first starts, so a later change never rewrites a running trade
  const secureHalf = existing ? existing.secureHalf : effectivePreferences(owner as any).secureHalf ? secureHalfPrice(offer) : undefined;
  const alert: PriceAlert = {
    ...(levels as AlertLevels),
    // Turned back on: watch from now (moves while it was off are not reported late)
    id, uid, offerId: existing?.offerId || offerId, offerIds: [...new Set([...(existing?.offerIds || (existing ? [existing.offerId] : [])), offerId])].slice(-20),
    createdAt: now, updatedAt: now, expiresAt, active: true,
    entered: existing?.entered || offer.execution === 'MARKET', hits: existing?.hits || [],
    ...(secureHalf ? { secureHalf } : {}),
  };
  await db().collection(ALERTS).doc(id).set(alert);
  await db().collection(OFFERS).doc(offerId).update({ emailPending: false, alertId: id }).catch(() => {});
  if (IS_LEAD_WORKER) watched.set(id, alert);
  // The trade goes into the journal by itself (the Trade Journal is Pro after the free period); the alert scores it when it ends
  if (hasProFeatures(owner)) await openAutoJournal(alert).catch(err => console.warn('[MarketX Journal] auto log failed:', err?.message || err));
  return { alert };
}

// ---------------------------------------------------------------------------
// Client view
// ---------------------------------------------------------------------------
function toClient(a: PriceAlert) {
  return {
    id: a.id, offerId: a.offerId, offerIds: a.offerIds || [a.offerId], symbol: a.symbol, name: a.name, timeframe: a.timeframe, direction: a.direction, execution: a.execution,
    entry: a.entry, stop: a.stop, tps: a.tps, createdAt: a.createdAt, expiresAt: a.expiresAt, active: a.active, entered: a.entered,
    hits: a.hits, endedReason: a.endedReason || null, tradeStyle: a.tradeStyle || null, closeBy: a.closeBy || null,
    secureHalf: a.secureHalf || null,
  };
}

async function listAlerts(uid: string) {
  const snap = await db().collection(ALERTS).where('uid', '==', uid).get();
  const now = Date.now();
  return snap.docs
    .map(d => d.data() as PriceAlert)
    .map(a => (a.active && a.expiresAt < now ? { ...a, active: false, endedReason: 'EXPIRED' as const } : a))
    .sort((x, y) => Number(y.active) - Number(x.active) || y.createdAt - x.createdAt)
    .slice(0, 30)
    .map(toClient);
}

// ---------------------------------------------------------------------------
// Monitor (lead worker only)
// ---------------------------------------------------------------------------
const watched = new Map<string, PriceAlert>();
/** Stops watching an alert at once (the duplicate cleanup removed it) */
export const forgetAlert = (id: string) => watched.delete(id);
let lastSync = 0;
let ticking = false;

async function syncAlerts(full = false) {
  const col = db().collection(ALERTS);
  const started = Date.now();
  const snap = full ? await col.where('active', '==', true).get() : await col.where('updatedAt', '>', lastSync - 5000).get();
  for (const d of snap.docs) {
    const a = d.data() as PriceAlert;
    if (a.active && a.expiresAt > Date.now()) watched.set(a.id, a);
    else watched.delete(a.id);
  }
  lastSync = started;
}

const endReasonOf = (k: AlertKind): NonNullable<PriceAlert['endedReason']> => (k === 'SL' ? 'SL' : k === 'BE' ? 'BE' : k === 'MISSED' ? 'MISSED' : k === 'END' ? 'ENDED' : 'TP3');

/**
 * Day / swing trades: candles up to the close time are checked as usual; once the close time has passed (and a candle
 * covers it), a trade still open ends there at the price then (END). 30 minutes before, the trader is told to close it.
 */
function closeHit(a: PriceAlert, bars: Bar[], now: number): AlertHit | null {
  if (!a.closeBy || now < a.closeBy) return null;
  const before = bars.filter(b => b.t < a.closeBy!);
  const last = before[before.length - 1];
  // Only once the feed has reached the close (the minute just before it is in)
  if (!last || last.t < a.closeBy - 120_000) return null;
  return { kind: 'END', at: a.closeBy, price: last.c };
}

async function warnClose(a: PriceAlert) {
  const ref = db().collection(ALERTS).doc(a.id);
  const first = await db().runTransaction(async tx => {
    const cur = (await tx.get(ref)).data() as PriceAlert | undefined;
    if (!cur?.active || cur.closeWarned) return false;
    tx.update(ref, { closeWarned: true, updatedAt: Date.now() });
    return true;
  });
  a.closeWarned = true;
  if (!first) return;
  const label = styleLabel(a);
  const when = closeByText(a.closeBy!);
  const title = `⏰ ${a.symbol}: close by ${when.split(',')[0]}`;
  const message = a.entered
    ? `${label}: your ${side(a)} ${a.symbol} trade must be closed by ${when}, in profit or in loss. Still open then = recorded as ended at that price.`
    : `${label}: if your ${side(a)} ${a.symbol} entry hasn't filled by ${when}, the setup is cancelled.`;
  await notifyActivity(a.uid, { type: 'market', title, message, actionType: 'open_alerts', actionPayload: { alertId: a.id } } as any);
  sendPush(a.uid, { title, body: message, url: `/?alerts=1&focus=${encodeURIComponent(a.id)}`, tag: `al-${a.id}`, kind: 'alert' }).catch(() => {});
}

async function recordHits(alert: PriceAlert, hits: AlertHit[], entered: boolean, closed: boolean): Promise<AlertHit[]> {
  const ref = db().collection(ALERTS).doc(alert.id);
  return db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return [];
    const cur = snap.data() as PriceAlert;
    if (!cur.active) return [];
    const have = new Set(cur.hits.map(h => h.kind));
    const fresh = hits.filter(h => !have.has(h.kind));
    if (!fresh.length) return [];
    const last = fresh[fresh.length - 1].kind;
    tx.update(ref, {
      hits: [...cur.hits, ...fresh],
      entered: cur.entered || entered,
      active: !closed,
      ...(closed ? { endedReason: endReasonOf(last) } : {}),
      updatedAt: Date.now(),
    });
    return fresh;
  });
}

async function checkSymbol(symbol: string, alerts: PriceAlert[], deps: PriceAlertDeps) {
  let bars: Bar[] | null = null;
  try {
    bars = await deps.getBars(symbol);
  } catch {
    bars = null;
  }
  if (!bars?.length) return;
  // The newest candle is still forming, so the next cycle starts from it again
  const scanFrom = bars[bars.length - 1].t;
  const live = bars[bars.length - 1].c;
  const nowT = Date.now();
  for (const a of alerts) {
    // A day / swing trade is only judged on candles before its close time
    const ev = evaluateBars(a, a.closeBy ? bars.filter(b => b.t < a.closeBy!) : bars);
    let { hits, closed } = ev;
    const { entered } = ev;
    if (!closed) {
      const end = closeHit(a, bars, nowT);
      if (end) {
        hits = [...hits, end];
        closed = true;
      } else if (a.closeBy && !a.closeWarned && nowT >= a.closeBy - CLOSE_WARNING_MS && nowT < a.closeBy) {
        await warnClose(a).catch(err => console.warn('[MarketX Alerts] close warning failed:', err?.message || err));
      }
    }
    if (!hits.length) {
      (a as PriceAlert & { scanFrom?: number }).scanFrom = scanFrom;
      continue;
    }
    let fresh: AlertHit[] = [];
    try {
      fresh = await recordHits(a, hits, entered, closed);
    } catch (err: any) {
      // Not saved: the next cycle scans these candles again
      console.warn('[MarketX Alerts] hit record failed:', err?.message || err);
      continue;
    }
    (a as PriceAlert & { scanFrom?: number }).scanFrom = scanFrom;
    // Keep the in-memory copy in step (the next sync confirms it)
    a.hits = [...a.hits, ...fresh];
    a.entered = a.entered || entered;
    if (closed) {
      watched.delete(a.id);
      // The finished signal joins the track record (once: the record id is the alert id)
      const last = a.hits[a.hits.length - 1]?.kind;
      const endedReason = endReasonOf(last as AlertKind);
      archiveAlertOutcome({ ...a, active: false, endedReason }).catch(err => console.warn('[MarketX Alerts] track record write failed:', err?.message || err));
    }
    // A target reached while later ones are still watched: the journal trade is a win from now on (updated at each TP)
    else if (fresh.some(h => /^TP\d$/.test(h.kind) || h.kind === 'HALF')) {
      progressAutoJournal(a).catch(err => console.warn('[MarketX Journal] live score failed:', err?.message || err));
    }
    // Every hit gets its own site notification; the email is one short message per alert per cycle, and only
    // while the trader's daily market email allowance lasts (shared with the watchlist)
    for (const h of fresh) {
      const m = hitMessage(a, { ...h, entered: a.entered, live });
      await notifyActivity(a.uid, { type: 'market', title: m.title, message: m.message, actionType: 'open_alerts', actionPayload: { alertId: a.id } } as any);
    }
    if (fresh.length) {
      // One phone / desktop notification per alert per cycle (the newest hit; the tag replaces older ones)
      const last = hitMessage(a, { ...fresh[fresh.length - 1], entered: a.entered, live });
      sendPush(a.uid, { title: last.title, body: last.message, url: `/?alerts=1&focus=${encodeURIComponent(a.id)}`, tag: `al-${a.id}`, kind: 'alert' }).catch(() => {});
    }
    if (fresh.length && (await claimMarketMail(a.uid).catch(() => false))) {
      const msgs = fresh.map(h => hitMessage(a, { ...h, entered: a.entered, live }));
      const lead = msgs[msgs.length - 1];
      await notifyActivity(a.uid, null, {
        subject: lead.subject,
        lines: msgs.length > 1 ? msgs.map(m => m.lines[0]) : lead.lines,
        options: { rows: mailRows(a, fresh[fresh.length - 1]), cta: { label: 'Open this alert', url: siteLink(`/?alerts=1&focus=${encodeURIComponent(a.id)}`) } },
      });
    }
  }
}

async function tick(deps: PriceAlertDeps) {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    const bySymbol = new Map<string, PriceAlert[]>();
    const expired: PriceAlert[] = [];
    for (const a of watched.values()) {
      if (a.expiresAt <= now) expired.push(a);
      else (bySymbol.get(a.symbol) || bySymbol.set(a.symbol, []).get(a.symbol)!).push(a);
    }
    for (const a of expired) {
      watched.delete(a.id);
      db().collection(ALERTS).doc(a.id).update({ active: false, endedReason: 'EXPIRED', updatedAt: now }).catch(() => {});
      archiveAlertOutcome({ ...a, active: false, endedReason: 'EXPIRED' }).catch(() => {});
    }
    const symbols = [...bySymbol.keys()];
    for (let i = 0; i < symbols.length; i += FETCH_CONCURRENCY) {
      await Promise.all(symbols.slice(i, i + FETCH_CONCURRENCY).map(s => checkSymbol(s, bySymbol.get(s)!, deps)));
    }
  } catch (err: any) {
    console.warn('[MarketX Alerts] monitor cycle failed:', err?.message || err);
  } finally {
    ticking = false;
  }
}

/** Storage stays small: expired setups and alerts that finished over 30 days ago are removed */
export async function cleanupAlertStorage(): Promise<number> {
  const now = Date.now();
  const [offers, oldAlerts] = await Promise.all([
    db().collection(OFFERS).where('expiresAt', '<', now).limit(300).get(),
    db().collection(ALERTS).where('updatedAt', '<', now - 30 * 86400e3).limit(300).get(),
  ]);
  const doomed = [...offers.docs, ...oldAlerts.docs.filter(d => !(d.data() as PriceAlert).active)];
  await Promise.all(doomed.map(d => d.ref.delete().catch(() => {})));
  return doomed.length;
}

/** One "Want a price alert?" email per unused signal, at most one every 6 hours per trader */
export async function sweepAlertOfferEmails(): Promise<number> {
  const now = Date.now();
  const snap = await db().collection(OFFERS).where('emailPending', '==', true).get();
  let sent = 0;
  for (const d of snap.docs) {
    const offer = d.data() as AlertOffer;
    if (offer.emailAt > now) continue;
    const decision = await db().runTransaction(async tx => {
      const [os, us] = await Promise.all([tx.get(d.ref), tx.get(userRef(offer.uid))]);
      if (!os.exists) return null;
      const o = os.data() as AlertOffer;
      if (!o.emailPending || o.alertId) return null;
      tx.update(d.ref, { emailPending: false });
      // A day / swing trade past (or near) its close time is not worth an invitation
      if (!us.exists || o.expiresAt <= now || (o.closeBy && o.closeBy - now < CLOSE_WARNING_MS)) return null;
      const u = us.data() as UserDoc;
      if (u.emailPrefs?.activity === false || u.status === 'banned' || u.status === 'suspended') return null;
      if ((u.alertMailAt || 0) > now - OFFER_EMAIL_GAP_MS) return null;
      // Invitations are optional: they use the shared daily allowance only while room is left for real alert hits
      const budget = nextMarketMail(u, true, now);
      if (!budget) return null;
      tx.update(userRef(offer.uid), { alertMailAt: now, marketMail: budget });
      return u.email;
    });
    if (!decision) continue;
    const ok = await sendEmail(decision, `Want a price alert for your ${offer.symbol} setup?`, [
      `Turn on a price alert for your ${side(offer)} setup on ${offer.symbol}${offer.timeframe ? ` (${offer.timeframe})` : ''} and MarketX tells you when price reaches the entry, the stop or a target.`,
    ], {
      cta: { label: 'Turn on price alert', url: siteLink(`/?alert=${encodeURIComponent(offer.id)}`) },
      priority: 'low',
    }).catch(() => false);
    if (ok) sent++;
  }
  return sent;
}

/** Off stops every active alert */
export type AlertMode = 'AUTO' | 'MANUAL';
export const readAlertMode = (v: unknown): AlertMode | null => (v === 'AUTO' || v === 'MANUAL' ? v : null);

/** Approves (true) or switches off (false) live price alerts; the Auto / Manual choice is kept (or set when given) */
export async function setAlertsEnabled(uid: string, enabled: boolean, mode?: AlertMode | null) {
  const cur = ((await userRef(uid).get()).data() as UserDoc | undefined)?.alerts;
  const keep = mode || cur?.mode;
  await userRef(uid).update({ alerts: { enabled, at: Date.now(), ...(keep ? { mode: keep } : {}) } });
  if (enabled) return;
  const snap = await db().collection(ALERTS).where('uid', '==', uid).get();
  const now = Date.now();
  await Promise.all(
    snap.docs
      .filter(d => (d.data() as PriceAlert).active)
      .map(async d => {
        const a = d.data() as PriceAlert;
        await d.ref.update({ active: false, endedReason: 'TURNED_OFF', updatedAt: now });
        watched.delete(a.id);
        await archiveAlertOutcome({ ...a, active: false, endedReason: 'TURNED_OFF' }).catch(() => {});
      })
  );
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export function registerPriceAlertRoutes(app: Express, deps: PriceAlertDeps, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  if (isFirebaseConfigured() && IS_LEAD_WORKER) {
    const boot = async () => {
      try {
        await syncAlerts(true);
        console.log(`[MarketX Alerts] watching ${watched.size} active alert(s)`);
      } catch (err: any) {
        console.warn('[MarketX Alerts] initial load failed:', err?.message || err);
      }
      setInterval(() => syncAlerts().catch(err => console.warn('[MarketX Alerts] sync failed:', err?.message || err)), SYNC_MS).unref();
      setInterval(() => tick(deps), TICK_MS).unref();
      setInterval(
        () => sweepAlertOfferEmails().then(n => n && console.log(`[MarketX Alerts] sent ${n} alert invitation email(s)`)).catch(err => console.warn('[MarketX Alerts] offer email sweep failed:', err?.message || err)),
        OFFER_SWEEP_MS
      ).unref();
      setInterval(() => cleanupAlertStorage().catch(err => console.warn('[MarketX Alerts] cleanup failed:', err?.message || err)), 60 * 60 * 1000).unref();
    };
    setTimeout(boot, BOOT_DELAY_MS).unref();
  }

  const throttle = createKeyedThrottle({ windowMs: 60_000, max: 40 });
  const guard = (req: Request, res: Response, next: NextFunction) => {
    const wait = throttle.hit(getUser(res).uid);
    if (wait) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many alert changes. Please wait a minute.' });
    next();
  };
  const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) =>
    fn(req, res).catch(err => {
      console.error(`[MarketX Alerts] ${req.method} ${req.path} failed:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
    });

  app.get('/api/alerts', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const [snap, alerts] = await Promise.all([userRef(uid).get(), listAlerts(uid)]);
    // ?live=1 (the panel's refresh): the live price of every market with an active alert, fetched now
    const live: Record<string, { price: number; change24h: number }> = {};
    if (req.query.live === '1' && deps.getQuote) {
      const symbols = [...new Set(alerts.filter(a => a.active).map(a => a.symbol))].slice(0, 12);
      await Promise.all(
        symbols.map(async sym => {
          const q = await Promise.race([deps.getQuote!(sym).catch(() => null), new Promise<null>(r => setTimeout(() => r(null), 5000))]);
          if (q && finite(q.price)) live[sym] = { price: q.price, change24h: Number(q.change24h) || 0 };
        })
      );
    }
    const cfg = (snap.data() as UserDoc | undefined)?.alerts;
    res.json({ enabled: !!cfg?.enabled, mode: cfg?.mode || null, alerts, live, checkedAt: Date.now() });
  }));

  app.post('/api/alerts/consent', limiter, requireAuth, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const enabled = req.body?.enabled === true;
    const mode = readAlertMode(req.body?.mode);
    if (req.body?.mode !== undefined && !mode) return res.status(400).json({ error: 'BAD_REQUEST', message: 'Choose Auto or Manual.' });
    await setAlertsEnabled(uid, enabled, mode);
    const cfg = ((await userRef(uid).get()).data() as UserDoc | undefined)?.alerts;
    res.json({ enabled, mode: cfg?.mode || null, alerts: await listAlerts(uid) });
  }));

  // Auto: every signal served from now on is watched by itself; Manual: the trader taps "Get price alert"
  app.post('/api/alerts/mode', limiter, requireAuth, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const mode = readAlertMode(req.body?.mode);
    if (!mode) return res.status(400).json({ error: 'BAD_REQUEST', message: 'Choose Auto or Manual.' });
    const cfg = ((await userRef(uid).get()).data() as UserDoc | undefined)?.alerts;
    if (!cfg?.enabled) return res.status(409).json({ error: 'ALERTS_OFF', message: 'Turn on price alerts first.' });
    await userRef(uid).update({ alerts: { ...cfg, mode } });
    res.json({ enabled: true, mode });
  }));

  app.post('/api/alerts', limiter, requireAuth, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const offerId = String(req.body?.offerId || '');
    if (!/^of_[a-z0-9]{8,40}$/.test(offerId)) return res.status(400).json({ error: 'BAD_REQUEST', message: 'That setup could not be found.' });
    const user = (await userRef(uid).get()).data() as UserDoc | undefined;
    if (!user?.alerts?.enabled) return res.status(409).json({ error: 'ALERTS_OFF', message: 'Turn on price alerts first.' });
    // The offer is written as the analysis is served; allow a moment if the trader taps straight away
    let offerSnap = await db().collection(OFFERS).doc(offerId).get();
    for (let i = 0; i < 3 && !offerSnap.exists; i++) {
      await new Promise(r => setTimeout(r, 400));
      offerSnap = await db().collection(OFFERS).doc(offerId).get();
    }
    const offer = offerSnap.data() as AlertOffer | undefined;
    if (!offer || offer.uid !== uid) return res.status(404).json({ error: 'NOT_FOUND', message: 'That setup could not be found.' });
    if (offer.expiresAt <= Date.now()) return res.status(410).json({ error: 'EXPIRED', message: 'This setup is too old to watch. Ask MarketX for a fresh analysis.' });
    const started = await startAlert(uid, offer);
    if ('error' in started) return res.status(started.error === 'ENDED' ? 409 : 429).json(started);
    res.json({ alert: toClient(started.alert), alerts: await listAlerts(uid) });
  }));

  app.delete('/api/alerts/:id', limiter, requireAuth, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const id = String(req.params.id || '');
    if (!/^al_of_[a-z0-9]{8,40}$/.test(id)) return res.status(400).json({ error: 'BAD_REQUEST', message: 'Alert not found.' });
    const ref = db().collection(ALERTS).doc(id);
    const snap = await ref.get();
    const a = snap.data() as PriceAlert | undefined;
    if (!a || a.uid !== uid) return res.status(404).json({ error: 'NOT_FOUND', message: 'Alert not found.' });
    if (a.active) {
      await ref.update({ active: false, endedReason: 'TURNED_OFF', updatedAt: Date.now() });
      // A target already reached stays in the track record
      await archiveAlertOutcome({ ...a, active: false, endedReason: 'TURNED_OFF' }).catch(() => {});
    }
    watched.delete(a.id);
    res.json({ alerts: await listAlerts(uid) });
  }));
}

// Exposed for tests
export const __alertsInternals = { tick, syncAlerts, watched };
