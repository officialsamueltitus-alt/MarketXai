import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { db, isFirebaseConfigured } from './firebase';
import { sendEmail } from './mailer';
import { getUser, notifyActivity, requireAuth, siteLink, userRef, type UserDoc } from './account';
import { IS_LEAD_WORKER } from './workers';
import { createKeyedThrottle } from './security';

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

export type AlertKind = 'ENTRY' | 'TP1' | 'TP2' | 'TP3' | 'SL' | 'MISSED';
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
  endedReason?: 'SL' | 'TP3' | 'MISSED' | 'EXPIRED' | 'TURNED_OFF';
}
export interface Bar { t: number; o: number; h: number; l: number; c: number }
export interface PriceAlertDeps {
  /** Recent 1-minute candles for a symbol (oldest first), or null when the feed is unavailable */
  getBars: (symbol: string) => Promise<Bar[] | null>;
}

const OFFERS = 'alertOffers';
const ALERTS = 'priceAlerts';
const MAX_ACTIVE_PER_USER = 25;
const OFFER_EMAIL_DELAY_MS = Math.max(1000, Number(process.env.ALERT_OFFER_EMAIL_DELAY_MS) || 15 * 60 * 1000);
const OFFER_EMAIL_GAP_MS = 6 * 60 * 60 * 1000;
const TICK_MS = Math.max(2000, Number(process.env.ALERT_TICK_MS) || 15_000);
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
  };
}

export function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return String(p);
  const d = p >= 1000 ? 2 : p >= 100 ? 2 : p >= 1 ? 4 : 6;
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

const side = (a: AlertLevels) => (a.direction === 'LONG' ? (a.execution === 'MARKET' ? 'BUY' : 'BUY LIMIT') : a.execution === 'MARKET' ? 'SELL' : 'SELL LIMIT');

/**
 * Walks candles (oldest first) and returns the new level hits for an alert, in the order they happened.
 * Before the entry fills, reaching the first target means the move happened without the trader (MISSED).
 * After entry: the stop loss closes the alert; the targets fire in turn and the last one closes it.
 */
export function evaluateBars(
  a: Pick<PriceAlert, 'direction' | 'entry' | 'stop' | 'tps' | 'entered' | 'hits' | 'createdAt'> & { scanFrom?: number },
  bars: Bar[]
): { hits: AlertHit[]; entered: boolean; closed: boolean } {
  const long = a.direction === 'LONG';
  const done = new Set(a.hits.map(h => h.kind));
  const hits: AlertHit[] = [];
  let entered = a.entered;
  let closed = done.has('SL') || done.has('MISSED') || done.has(`TP${a.tps.length}` as AlertKind);
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
    const reached = (p: number) => (long ? b.h >= p : b.l <= p);
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
    if (long ? b.l <= a.stop : b.h >= a.stop) {
      hits.push({ kind: 'SL', at: b.t, price: a.stop });
      closed = true;
      break;
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

function hitMessage(a: AlertLevels, h: AlertHit): { title: string; message: string; subject: string; lines: string[] } {
  const sym = a.symbol;
  const tf = a.timeframe ? ` (${a.timeframe})` : '';
  switch (h.kind) {
    case 'ENTRY':
      return {
        title: `🎯 ${sym} reached your entry zone`,
        message: `${side(a)}${tf}: price is in your entry zone ${fmtPrice(a.entry.min)} to ${fmtPrice(a.entry.max)}. Stop ${fmtPrice(a.stop)}, first target ${fmtPrice(a.tps[0])}.`,
        subject: `🎯 ${sym} reached your entry zone`,
        lines: [`Price just reached the entry zone of your ${side(a)} setup on ${sym}${tf}.`, 'Check the chart and your plan before you act.'],
      };
    case 'SL':
      return {
        title: `🛑 ${sym} hit your stop loss`,
        message: `${side(a)}${tf}: price reached the stop loss at ${fmtPrice(a.stop)}. This alert is now closed.`,
        subject: `🛑 ${sym} hit your stop loss`,
        lines: [`Price reached the stop loss of your ${side(a)} setup on ${sym}${tf}.`, 'This alert is now closed. Losses are part of trading: stick to your risk plan.'],
      };
    case 'MISSED':
      return {
        title: `⏭️ ${sym} moved without your entry`,
        message: `Price reached the first target (${fmtPrice(a.tps[0])}) before your entry filled, so this setup no longer applies. Alert closed.`,
        subject: `${sym} moved before your entry filled`,
        lines: [`Price reached the first target of your ${side(a)} setup on ${sym}${tf} before the entry zone was touched.`, 'The setup no longer applies, so the alert is closed. Ask MarketX for a fresh analysis.'],
      };
    default: {
      const n = Number(h.kind.slice(2));
      const last = n === a.tps.length;
      return {
        title: `✅ ${sym} hit TP${n}`,
        message: `${side(a)}${tf}: target ${n} at ${fmtPrice(h.price)} reached.${last ? ' Every target is done, alert closed.' : ''}`,
        subject: `✅ ${sym} hit take profit ${n}`,
        lines: [`Price reached take profit ${n} (${fmtPrice(h.price)}) of your ${side(a)} setup on ${sym}${tf}.`, last ? 'That was the final target, so this alert is now closed.' : 'MarketX keeps watching the next target for you.'],
      };
    }
  }
}

function levelRows(a: AlertLevels): [string, string][] {
  return [
    ['Setup', `${side(a)} · ${a.symbol}${a.timeframe ? ` · ${a.timeframe}` : ''}`],
    ['Entry zone', `${fmtPrice(a.entry.min)} to ${fmtPrice(a.entry.max)}`],
    ['Stop loss', fmtPrice(a.stop)],
    ...a.tps.map((p, i) => [`TP${i + 1}`, fmtPrice(p)] as [string, string]),
  ];
}

// ---------------------------------------------------------------------------
// Offers: recorded as a signal is served (wraps res.json on /api/market/analyze; the analysis itself is untouched)
// ---------------------------------------------------------------------------
async function saveOffer(uid: string, id: string, levels: AlertLevels) {
  const now = Date.now();
  const offer: AlertOffer = { ...levels, id, uid, createdAt: now, expiresAt: now + alertHorizonMs(levels.timeframe), emailPending: true, emailAt: now + OFFER_EMAIL_DELAY_MS };
  await db().collection(OFFERS).doc(id).set(offer);
}

export function alertOfferMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isFirebaseConfigured()) return next();
  const json = res.json.bind(res);
  res.json = (body: any) => {
    try {
      const uid = (res.locals.user as any)?.uid as string | undefined;
      const s = body?.strategy;
      const levels = uid && res.statusCode < 400 ? levelsFromStrategy(s) : null;
      if (uid && levels) {
        const id = `of_${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`;
        s.alertOffer = { id };
        saveOffer(uid, id, levels).catch(err => console.warn('[MarketX Alerts] offer save failed:', err?.message || err));
      }
    } catch {}
    return json(body);
  };
  next();
}

// ---------------------------------------------------------------------------
// Client view
// ---------------------------------------------------------------------------
function toClient(a: PriceAlert) {
  return {
    id: a.id, offerId: a.offerId, symbol: a.symbol, name: a.name, timeframe: a.timeframe, direction: a.direction, execution: a.execution,
    entry: a.entry, stop: a.stop, tps: a.tps, createdAt: a.createdAt, expiresAt: a.expiresAt, active: a.active, entered: a.entered,
    hits: a.hits, endedReason: a.endedReason || null,
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
      ...(closed ? { endedReason: last === 'SL' ? 'SL' : last === 'MISSED' ? 'MISSED' : 'TP3' } : {}),
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
  for (const a of alerts) {
    const { hits, entered, closed } = evaluateBars(a, bars);
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
    if (closed) watched.delete(a.id);
    for (const h of fresh) {
      const m = hitMessage(a, h);
      await notifyActivity(
        a.uid,
        { type: 'market', title: m.title, message: m.message, actionType: 'open_alerts', actionPayload: { alertId: a.id } } as any,
        { subject: m.subject, lines: m.lines, options: { rows: levelRows(a), cta: { label: 'Open price alerts', url: siteLink('/?alerts=1') } } }
      );
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
      if (!us.exists || o.expiresAt <= now) return null;
      const u = us.data() as UserDoc;
      if (u.emailPrefs?.activity === false || u.status === 'banned' || u.status === 'suspended') return null;
      if ((u.alertMailAt || 0) > now - OFFER_EMAIL_GAP_MS) return null;
      tx.update(userRef(offer.uid), { alertMailAt: now });
      return u.email;
    });
    if (!decision) continue;
    const ok = await sendEmail(decision, `Want a price alert for your ${offer.symbol} setup?`, [
      `Your ${side(offer)} setup on ${offer.symbol}${offer.timeframe ? ` (${offer.timeframe})` : ''} is ready.`,
      'Turn on a price alert and MarketX will watch the market for you, then notify you the moment price reaches the entry zone, the stop loss or a target.',
    ], {
      rows: levelRows(offer),
      cta: { label: 'Turn on price alert', url: siteLink(`/?alert=${encodeURIComponent(offer.id)}`) },
      note: 'You only get the alerts you turn on. Manage them any time with /price-alerts in the chat.',
      priority: 'low',
    }).catch(() => false);
    if (ok) sent++;
  }
  return sent;
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
    res.json({ enabled: !!(snap.data() as UserDoc | undefined)?.alerts?.enabled, alerts });
  }));

  app.post('/api/alerts/consent', limiter, requireAuth, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const enabled = req.body?.enabled === true;
    await userRef(uid).update({ alerts: { enabled, at: Date.now() } });
    if (!enabled) {
      const snap = await db().collection(ALERTS).where('uid', '==', uid).get();
      const now = Date.now();
      await Promise.all(snap.docs.filter(d => (d.data() as PriceAlert).active).map(d => d.ref.update({ active: false, endedReason: 'TURNED_OFF', updatedAt: now })));
    }
    res.json({ enabled, alerts: await listAlerts(uid) });
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
    const mine = (await db().collection(ALERTS).where('uid', '==', uid).get()).docs.map(d => d.data() as PriceAlert);
    const id = `al_${offerId}`;
    const existing = mine.find(a => a.id === id);
    if (existing?.active) return res.json({ alert: toClient(existing), alerts: await listAlerts(uid) });
    if (existing && existing.hits.some(h => ['SL', 'MISSED', `TP${existing.tps.length}`].includes(h.kind))) {
      return res.status(409).json({ error: 'ENDED', message: 'This setup has already played out.' });
    }
    if (mine.filter(a => a.active && a.expiresAt > Date.now()).length >= MAX_ACTIVE_PER_USER) {
      return res.status(429).json({ error: 'TOO_MANY_ALERTS', message: `You can have up to ${MAX_ACTIVE_PER_USER} active alerts. Turn one off first.` });
    }
    const now = Date.now();
    const { id: _o, uid: _u, createdAt: _c, expiresAt, emailPending: _e, emailAt: _a, alertId: _al, ...levels } = offer;
    const alert: PriceAlert = {
      ...(levels as AlertLevels),
      // Turned back on: watch from now (moves while it was off are not reported late)
      id, uid, offerId, createdAt: now, updatedAt: now, expiresAt, active: true,
      entered: existing?.entered || offer.execution === 'MARKET', hits: existing?.hits || [],
    };
    await db().collection(ALERTS).doc(id).set(alert);
    await db().collection(OFFERS).doc(offerId).update({ emailPending: false, alertId: id }).catch(() => {});
    if (IS_LEAD_WORKER) watched.set(id, alert);
    res.json({ alert: toClient(alert), alerts: await listAlerts(uid) });
  }));

  app.delete('/api/alerts/:id', limiter, requireAuth, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const id = String(req.params.id || '');
    if (!/^al_of_[a-z0-9]{8,40}$/.test(id)) return res.status(400).json({ error: 'BAD_REQUEST', message: 'Alert not found.' });
    const ref = db().collection(ALERTS).doc(id);
    const snap = await ref.get();
    const a = snap.data() as PriceAlert | undefined;
    if (!a || a.uid !== uid) return res.status(404).json({ error: 'NOT_FOUND', message: 'Alert not found.' });
    if (a.active) await ref.update({ active: false, endedReason: 'TURNED_OFF', updatedAt: Date.now() });
    watched.delete(a.id);
    res.json({ alerts: await listAlerts(uid) });
  }));
}

// Exposed for tests
export const __alertsInternals = { tick, syncAlerts, watched };
