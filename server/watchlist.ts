import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { db, isFirebaseConfigured } from './firebase';
import { sendPush } from './webPush';
import { claimMarketMail, getUser, notifyActivity, requireAuth, siteLink, userRef, type UserDoc } from './account';
import { requirePro, requireProToEnable } from './proAccess';
import { IS_LEAD_WORKER } from './workers';
import { createKeyedThrottle } from './security';
import { fmtPrice } from './priceAlerts';
import { inWords, lockBlocks, tradeLockFor, tradeLockOn } from './signalLock';
import { SUPPORTED_TIMEFRAMES, timeframeMinutes } from '../src/utils/timeframe';
import { normalizeRdmTimeframes, rdmFrames, rdmLabel, withDefaults, type AnalysisMode } from '../src/utils/preferences';

// ===========================================================================
// Watchlist (/watchlist): the trader approves monitoring once, then adds pairs. Each pair is checked first (MarketX
// must be able to read its live price and candles), then scanned continuously by the server on the chosen timeframe
// ("RDM" = every timeframe). When a setup is building or ready, the trader gets a site notification and an email, and
// prompts MarketX for the full plan.
//
//   watchItems/{id} -> one pair on a trader's watchlist, with its latest scan result and the setups already notified
//
// Cost: scanning never calls the AI engine. It reads candles and runs the same zone engine the analysis uses
// (read-only, through `deps.scan`), so it costs nothing per scan. Only the lead worker runs the scanner; every pair
// and timeframe is scanned once per cycle no matter how many traders watch it, and each setup notifies only once
// (decided inside a transaction, so restarts or a second worker never duplicate it).
// ===========================================================================

export type WatchStatus = 'SCANNING' | 'SETUP' | 'BUILDING' | 'WAITING' | 'NO_DATA';
export interface WatchSetup {
  key: string;
  kind: 'READY' | 'BUILDING';
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  score: number;
  /** Distance from the live price to the entry side of the zone, in percent */
  distancePct: number;
  foundAt: number;
  /** Confirmation mode: READY = price confirmed at the zone; BUILDING = the zone is waiting for that confirmation */
  confirmation?: boolean;
  /** Strategy mode: found by the trader's own strategy (its name) */
  strategy?: string;
}
export interface WatchItem {
  id: string;
  uid: string;
  symbol: string;
  name: string;
  type: string;
  /** A supported timeframe ("15M", "1H", "4H"...) or "RDM" (every timeframe) */
  timeframe: string;
  /** RDM only: the timeframes it scans, from the trader's Preference Mode ([] or missing = all) */
  rdmFrames?: string[];
  /** Analysis mode from Preference Mode (missing = NORMAL): CONFIRMATION is only ready once price confirms at the zone */
  analysisMode?: AnalysisMode;
  /** Strategy mode: the trader's saved strategy the pair is scanned with (missing/null = the general engine) */
  strategyId?: string | null;
  addedAt: number;
  updatedAt: number;
  active: boolean;
  status: WatchStatus;
  statusText: string;
  price: number | null;
  priceAt: number | null;
  scannedAt: number | null;
  nextScanAt: number;
  setup: WatchSetup | null;
  /** Setup keys already sent to the trader (newest last) */
  notified: string[];
}

/** What the engine read on one timeframe (built from a MarketMap by server.ts) */
export interface ScanZone {
  kind: 'DEMAND' | 'SUPPLY';
  proximal: number;
  low: number;
  high: number;
  fresh: boolean;
  liveFirstTouch?: boolean;
  priceInside: boolean;
  distanceAtr: number;
  score: number;
  territory?: 'PREMIUM' | 'DISCOUNT';
}
export interface ScanFrame {
  timeframe: string;
  price: number;
  equilibrium: number;
  plan: { direction: 'LONG' | 'SHORT'; score: number; entry: { min: number; max: number; optimal: number } } | null;
  zones: ScanZone[];
  /** Confirmation mode: the plan (if any) is confirmed; otherwise what the zone is waiting for */
  confirm?: { state: 'CONFIRMED' | 'WAITING_PATTERN' | 'WAITING_TAP' | 'NONE'; direction?: 'LONG' | 'SHORT'; zone?: { low: number; high: number; kind: 'DEMAND' | 'SUPPLY' } };
}
export interface WatchlistDeps {
  /** The market a query names ("EURUSD", "gold", "$WIF", a contract address), or null when nothing is listed */
  resolve: (query: string) => Promise<{ symbol: string; name: string; type: string } | null>;
  /** Live price, or null when no live quote can be read right now */
  quote: (symbol: string) => Promise<{ price: number; change24h: number } | null>;
  /** Number of candles readable on a timeframe (0 = no chart data) */
  candles: (symbol: string, timeframe: string) => Promise<number>;
  /** Engine read for each timeframe asked (null entries = no data on that timeframe) */
  scan: (symbol: string, timeframes: string[], mode?: AnalysisMode, strategyId?: string | null) => Promise<Array<ScanFrame | null> & { strategyName?: string }>;
  /** Minimum plan score for an RDM pick (same bar as the RDM analysis) */
  rdmMinScore: number;
}

const ITEMS = 'watchItems';
export const MAX_PAIRS = 12;
const TICK_MS = Math.max(2000, Number(process.env.WATCH_TICK_MS) || 30_000);
const SYNC_MS = Math.max(2000, Number(process.env.WATCH_SYNC_MS) || 30_000);
const BOOT_DELAY_MS = Math.max(500, Number(process.env.WATCH_BOOT_MS) || 25_000);
/** Floor between two scans of one pair (tests lower it) */
const MIN_SCAN_GAP_MS = Math.max(1000, Number(process.env.WATCH_MIN_GAP_MS) || 2 * 60_000);
const MAX_SCAN_GAP_MS = 30 * 60_000;
const RDM_SCAN_GAP_MS = Math.max(MIN_SCAN_GAP_MS, Number(process.env.WATCH_RDM_GAP_MS) || 10 * 60_000);
/** A fresh zone this close to price (in ATRs) counts as a setup building */
const BUILD_MAX_ATR = 2.5;
const BUILD_MIN_SCORE = 55;
const READY_MIN_SCORE = 60;
const FETCH_CONCURRENCY = 3;
const VERIFY_TIMEOUT_MS = 8000;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const now = () => Date.now();

export function isWatchTimeframe(tf: string): boolean {
  return tf === 'RDM' || SUPPORTED_TIMEFRAMES.includes(tf);
}

/** How often a pair is scanned: about once per candle of its timeframe, between 2 and 30 minutes (RDM: 10 minutes) */
export function scanGapMs(tf: string): number {
  if (tf === 'RDM') return RDM_SCAN_GAP_MS;
  return Math.min(MAX_SCAN_GAP_MS, Math.max(MIN_SCAN_GAP_MS, timeframeMinutes(tf) * 60_000));
}

const tfLabel = (tf: string, frames?: string[]) => (tf === 'RDM' ? rdmWhere(frames) : tf);
/** "every timeframe", or the trader's RDM choice ("1H, 4H, 1D") */
function rdmWhere(frames?: string[]): string {
  const c = normalizeRdmTimeframes(frames || []);
  return !c || !c.length ? 'every timeframe' : rdmLabel(c);
}
const sideWord = (d: 'LONG' | 'SHORT') => (d === 'LONG' ? 'BUY' : 'SELL');
const pctText = (n: number) => `${n < 0.1 ? n.toFixed(2) : n.toFixed(1)}%`;

/**
 * Reads the scan of a pair and returns what the trader should know: a setup ready (a valid plan from the engine),
 * a setup building (a fresh zone on the right side of the range that price is approaching), or nothing yet.
 */
export function summarizeScan(frames: Array<ScanFrame | null>, opts: { rdm: boolean; rdmMinScore: number; confirmation?: boolean; strategyName?: string }): {
  status: WatchStatus;
  setup: Omit<WatchSetup, 'foundAt'> | null;
  price: number | null;
} {
  const loaded = frames.filter((f): f is ScanFrame => !!f && finite(f.price));
  if (!loaded.length) return { status: 'NO_DATA', setup: null, price: null };
  const price = loaded[0].price;
  const tfWeight = (tf: string) => Math.log2(Math.max(1, timeframeMinutes(tf))) * 0.5;
  // A trader's own strategy: any valid trade its rules find is ready (the rules decide quality, not the engine's score)
  const minReady = opts.strategyName ? 0 : opts.rdm ? Math.max(READY_MIN_SCORE, opts.rdmMinScore) : READY_MIN_SCORE;

  // Ready: a plan the engine accepted (fresh, confirmed, levels untouched, price not run away)
  const ready = loaded
    .filter(f => f.plan && f.plan.score >= minReady && finite(f.plan.entry.optimal))
    .sort((a, b) => b.plan!.score + tfWeight(b.timeframe) - (a.plan!.score + tfWeight(a.timeframe)))[0];
  if (ready) {
    const p = ready.plan!;
    const edge = p.direction === 'LONG' ? p.entry.max : p.entry.min;
    const inZone = ready.price >= p.entry.min && ready.price <= p.entry.max;
    const distancePct = inZone ? 0 : Math.abs((ready.price - edge) / ready.price) * 100;
    return {
      status: 'SETUP',
      price,
      setup: {
        key: `${opts.strategyName ? 'RS' : opts.confirmation ? 'RC' : 'R'}|${ready.timeframe}|${p.direction}|${p.entry.optimal.toPrecision(6)}`,
        kind: 'READY',
        timeframe: ready.timeframe,
        direction: p.direction,
        score: Math.round(p.score),
        distancePct: Number(distancePct.toFixed(3)),
        ...(opts.strategyName ? { strategy: opts.strategyName } : opts.confirmation ? { confirmation: true } : {}),
      },
    };
  }
  // A trader's own strategy only reports trades its rules found
  if (opts.strategyName) return { status: 'WAITING', setup: null, price };

  // Confirmation mode: price is at a zone (or heading to a valid one) and the lower timeframe has not confirmed yet
  if (opts.confirmation) {
    const waiting = loaded
      .filter(f => f.confirm?.zone && (f.confirm.state === 'WAITING_PATTERN' || f.confirm.state === 'WAITING_TAP'))
      .sort((a, b) => (a.confirm!.state === 'WAITING_PATTERN' ? 0 : 1) - (b.confirm!.state === 'WAITING_PATTERN' ? 0 : 1) || tfWeight(b.timeframe) - tfWeight(a.timeframe))[0];
    if (waiting) {
      const c = waiting.confirm!;
      const z = c.zone!;
      const inZone = waiting.price >= z.low && waiting.price <= z.high;
      const edge = z.kind === 'DEMAND' ? z.high : z.low;
      const distancePct = inZone || c.state === 'WAITING_PATTERN' ? 0 : Math.abs((waiting.price - edge) / waiting.price) * 100;
      const zoneScore = waiting.zones.find(x => x.low === z.low && x.high === z.high)?.score;
      return {
        status: 'BUILDING',
        price,
        setup: {
          key: `C|${waiting.timeframe}|${z.kind}|${z.low.toPrecision(6)}|${c.state === 'WAITING_PATTERN' ? 'AT' : 'TO'}`,
          kind: 'BUILDING',
          timeframe: waiting.timeframe,
          direction: z.kind === 'DEMAND' ? 'LONG' : 'SHORT',
          score: Math.round(zoneScore ?? 0),
          distancePct: Number(distancePct.toFixed(3)),
          confirmation: true,
        },
      };
    }
  }

  // Building: price drifting toward a fresh zone (demand only in discount, supply only in premium)
  let best: { f: ScanFrame; z: ScanZone } | null = null;
  for (const f of loaded) {
    for (const z of f.zones) {
      if (!(z.fresh || z.liveFirstTouch) || z.score < BUILD_MIN_SCORE || !(z.distanceAtr <= BUILD_MAX_ATR)) continue;
      const rightSide = z.territory
        ? (z.kind === 'DEMAND' ? z.territory === 'DISCOUNT' : z.territory === 'PREMIUM')
        : z.kind === 'DEMAND' ? z.high <= f.equilibrium : z.low >= f.equilibrium;
      if (!rightSide) continue;
      // Demand sits below price, supply above (a zone price already broke through is not a setup)
      if (z.kind === 'DEMAND' ? z.low > f.price : z.high < f.price) continue;
      const rank = (x: { f: ScanFrame; z: ScanZone }) => x.z.distanceAtr - tfWeight(x.f.timeframe) * 0.2 - x.z.score / 400;
      if (!best || rank({ f, z }) < rank(best)) best = { f, z };
    }
  }
  if (best) {
    const { f, z } = best;
    const distancePct = z.priceInside ? 0 : Math.abs((f.price - z.proximal) / f.price) * 100;
    return {
      status: 'BUILDING',
      price,
      setup: {
        key: `B|${f.timeframe}|${z.kind}|${z.proximal.toPrecision(6)}`,
        kind: 'BUILDING',
        timeframe: f.timeframe,
        direction: z.kind === 'DEMAND' ? 'LONG' : 'SHORT',
        score: Math.round(z.score),
        distancePct: Number(distancePct.toFixed(3)),
      },
    };
  }
  return { status: 'WAITING', setup: null, price };
}

export function statusText(status: WatchStatus, setup: Omit<WatchSetup, 'foundAt'> | null, tf: string, frames?: string[]): string {
  if (status === 'SCANNING') return `Scanning ${tf === 'RDM' ? rdmWhere(frames) : `the ${tf}`}…`;
  if (status === 'NO_DATA') return 'Live data is unavailable right now. Retrying shortly.';
  if (status === 'WAITING' || !setup) return tf === 'RDM' ? `Watching ${rdmWhere(frames)} · no setup yet` : `Watching the ${tf} · no setup yet`;
  const where = setup.distancePct === 0 ? 'price is in the zone now' : `price ${pctText(setup.distancePct)} away`;
  if (status === 'SETUP') return `${sideWord(setup.direction)} setup ${setup.confirmation ? 'confirmed' : 'ready'} on the ${setup.timeframe}${setup.strategy ? ` · ${setup.strategy}` : ''} · ${where}`;
  if (setup.confirmation) return `${sideWord(setup.direction)} zone on the ${setup.timeframe} · waiting for confirmation · ${where}`;
  return `${sideWord(setup.direction)} setup building on the ${setup.timeframe} · ${where}`;
}

function toClient(w: WatchItem) {
  return {
    id: w.id, symbol: w.symbol, name: w.name, type: w.type, timeframe: w.timeframe, addedAt: w.addedAt, active: w.active,
    status: w.status, statusText: w.statusText, price: w.price, priceAt: w.priceAt, scannedAt: w.scannedAt,
    nextScanAt: w.nextScanAt, setup: w.setup, analysisMode: modeOf(w), strategy: !!w.strategyId,
    ...(w.timeframe === 'RDM' ? { rdmFrames: normalizeRdmTimeframes(w.rdmFrames || []) || [] } : {}),
  };
}

async function listItems(uid: string) {
  const snap = await db().collection(ITEMS).where('uid', '==', uid).get();
  return snap.docs.map(d => d.data() as WatchItem).sort((a, b) => a.addedAt - b.addedAt).map(toClient);
}

// ---------------------------------------------------------------------------
// Notices
// ---------------------------------------------------------------------------
async function sendNotice(item: WatchItem, setup: WatchSetup) {
  const tf = setup.timeframe;
  const side = sideWord(setup.direction);
  const where = setup.distancePct === 0 ? 'Price is in the zone right now.' : `Price is ${pctText(setup.distancePct)} from the zone.`;
  const ready = setup.kind === 'READY';
  const confirmed = !!setup.confirmation;
  const title = ready
    ? `${confirmed ? '✅' : '🎯'} ${side} setup ${confirmed ? 'confirmed' : 'ready'} on ${item.symbol} · ${tf}${setup.strategy ? ` (${setup.strategy})` : ''}`
    : confirmed
      ? `👀 ${side} zone on ${item.symbol} · ${tf}, waiting for confirmation`
      : `👀 ${side} setup building on ${item.symbol} · ${tf}`;
  const message = ready
    ? `${confirmed ? 'Price confirmed the zone. ' : ''}${where} Ask MarketX to analyze ${item.symbol} on the ${tf} for the full plan.`
    : confirmed
      ? `${where} MarketX tells you the moment price confirms it.`
      : `${where} MarketX keeps watching and tells you when it is ready.`;
  // Emails share the trader's small daily market allowance with price alerts; the site notice always goes out
  const mail = (await claimMarketMail(item.uid).catch(() => false))
    ? {
        subject: title,
        lines: [
          ready
            ? `A ${side} setup is ${confirmed ? 'confirmed' : 'ready'} on ${item.symbol} (${tf}). ${where}`
            : confirmed
              ? `A ${side} zone on ${item.symbol} (${tf}) is waiting for confirmation. ${where}`
              : `A ${side} setup is building on ${item.symbol} (${tf}). ${where}`,
        ],
        options: {
          rows: [['Setup quality', `${setup.score}/100`], ...(item.price ? [['Price', fmtPrice(item.price)] as [string, string]] : [])] as [string, string][],
          cta: { label: ready ? 'Get the plan' : 'Open this pair', url: siteLink(`/?watchlist=1&focus=${encodeURIComponent(item.id)}`) },
        },
      }
    : undefined;
  await notifyActivity(
    item.uid,
    { type: 'market', title, message, actionType: 'open_watchlist', actionPayload: { itemId: item.id, symbol: item.symbol, timeframe: tf } } as any,
    mail
  );
  // Phone / desktop notification on every device the trader turned it on (plays the device's own sound)
  sendPush(item.uid, { title, body: message, url: `/?watchlist=1&focus=${encodeURIComponent(item.id)}`, tag: `wl-${item.id}`, kind: 'watchlist' }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------
const watched = new Map<string, WatchItem>();
let lastSync = 0;
let ticking = false;

function framesFor(tf: string, rdm?: string[]): string[] {
  return tf === 'RDM' ? rdmFrames(rdm) : [tf];
}
/** Same-scan key: pairs on RDM with a different timeframe choice are scanned separately */
const modeOf = (w: WatchItem): AnalysisMode => (w.analysisMode === 'CONFIRMATION' ? 'CONFIRMATION' : 'NORMAL');
const scanKey = (w: WatchItem) => `${w.symbol}|${w.timeframe}|${w.strategyId ? `S:${w.strategyId}` : modeOf(w)}${w.timeframe === 'RDM' ? '|' + framesFor('RDM', w.rdmFrames).join(',') : ''}`;

/** The trader's scan settings from Preference Mode: RDM timeframes ([] = all) and analysis mode */
async function scanPrefs(uid: string): Promise<{ rdm: string[]; mode: AnalysisMode; strategyId: string | null }> {
  const doc = (await userRef(uid).get()).data() as UserDoc | undefined;
  const p = withDefaults((doc as any)?.preferences);
  const sm = (doc as any)?.strategyMode;
  return { rdm: p.rdmTimeframes, mode: p.analysisMode, strategyId: sm?.enabled && typeof sm.strategyId === 'string' ? sm.strategyId : null };
}

/** Strategy mode changed (on, off, another strategy, or its rules edited): the trader's pairs scan with it from now on */
export async function syncWatchStrategy(uid: string, strategyId: string | null) {
  if (!isFirebaseConfigured()) return;
  const snap = await db().collection(ITEMS).where('uid', '==', uid).get();
  const t = now();
  await Promise.all(
    snap.docs.map(d => {
      const w = d.data() as WatchItem;
      const next: Partial<WatchItem> = {
        strategyId, setup: null, nextScanAt: t, updatedAt: t,
        ...(w.active ? { status: 'SCANNING' as WatchStatus, statusText: statusText('SCANNING', null, w.timeframe, w.rdmFrames) } : {}),
      };
      if (IS_LEAD_WORKER && w.active) watched.set(w.id, { ...w, ...next } as WatchItem);
      return d.ref.update(next);
    })
  );
}

/**
 * Preference Mode changed the RDM timeframes or the analysis mode: the trader's pairs scan the new way from now on
 * (RDM pairs take the new timeframes; every pair takes the mode) and are rescanned.
 */
export async function syncWatchPrefs(uid: string, prefs: { rdmFrames: string[]; mode: AnalysisMode }) {
  if (!isFirebaseConfigured()) return;
  const frames = normalizeRdmTimeframes(prefs.rdmFrames) || [];
  const snap = await db().collection(ITEMS).where('uid', '==', uid).get();
  const t = now();
  await Promise.all(
    snap.docs.map(d => {
      const w = d.data() as WatchItem;
      const rdm = w.timeframe === 'RDM';
      const changed = modeOf(w) !== prefs.mode || (rdm && (normalizeRdmTimeframes(w.rdmFrames || []) || []).join(',') !== frames.join(','));
      if (!changed) return null;
      const next: Partial<WatchItem> = {
        ...(rdm ? { rdmFrames: frames } : {}),
        analysisMode: prefs.mode, setup: null, nextScanAt: t, updatedAt: t,
        ...(w.active ? { status: 'SCANNING' as WatchStatus, statusText: statusText('SCANNING', null, w.timeframe, rdm ? frames : undefined) } : { statusText: `Paused · ${tfLabel(w.timeframe, frames)}` }),
      };
      if (IS_LEAD_WORKER && w.active) watched.set(w.id, { ...w, ...next } as WatchItem);
      return d.ref.update(next);
    })
  );
}

/** Saves a scan result; notifies when it found a setup the trader has not heard about (decided in a transaction) */
/**
 * Trade lock: while the trader's own trade on this pair and the setup's timeframe is still running (or the other side is
 * cooling down after its stop loss), the new setup is not announced; the pair says why and is scanned fresh again later.
 */
async function holdForRunningTrade(item: Pick<WatchItem, 'uid' | 'symbol'>, result: ReturnType<typeof summarizeScan>): Promise<ReturnType<typeof summarizeScan>> {
  const setup = result.setup;
  if (!setup) return result;
  try {
    if (!(await tradeLockOn(item.uid))) return result;
    const lock = await tradeLockFor(item.uid, item.symbol, setup.timeframe);
    if (!lockBlocks(lock, setup.direction)) return result;
    const running = lock!.kind === 'RUNNING';
    const side = sideWord(running ? lock!.trade.direction : lock!.stopped.direction);
    return {
      ...result,
      status: 'WAITING',
      setup: null,
      heldText: running
        ? `Your ${side} on the ${setup.timeframe} is still running · no new setup until it ends`
        : `Your ${side} on the ${setup.timeframe} hit its stop · no flip for about ${inWords(lock!.until - Date.now())}`,
    } as ReturnType<typeof summarizeScan>;
  } catch {
    return result;
  }
}

async function applyScan(itemId: string, result: ReturnType<typeof summarizeScan>, deps: WatchlistDeps): Promise<WatchItem | null> {
  const ref = db().collection(ITEMS).doc(itemId);
  const t = now();
  const outcome = await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const cur = snap.data() as WatchItem;
    const setup: WatchSetup | null = result.setup
      ? { ...result.setup, foundAt: cur.setup?.key === result.setup.key ? cur.setup.foundAt : t }
      : null;
    // A building zone that turns ready is a new notice; the same key never repeats
    const fresh = !!setup && !cur.notified.includes(setup.key);
    const notified = fresh ? [...cur.notified, setup!.key].slice(-30) : cur.notified;
    const next: Partial<WatchItem> = {
      status: result.status,
      statusText: (result as { heldText?: string }).heldText || statusText(result.status, result.setup, cur.timeframe, cur.rdmFrames),
      price: result.price ?? cur.price,
      priceAt: result.price ? t : cur.priceAt,
      scannedAt: t,
      nextScanAt: t + (result.status === 'NO_DATA' ? Math.min(scanGapMs(cur.timeframe), 5 * 60_000) : scanGapMs(cur.timeframe)),
      setup,
      notified,
      updatedAt: t,
    };
    tx.update(ref, next);
    return { item: { ...cur, ...next } as WatchItem, notify: fresh && cur.active ? setup : null };
  });
  if (!outcome) return null;
  if (outcome.notify) await sendNotice(outcome.item, outcome.notify).catch(err => console.warn('[MarketX Watchlist] notice failed:', err?.message || err));
  return outcome.item;
}

async function scanFrames(symbol: string, tf: string, deps: WatchlistDeps, rdm?: string[], mode: AnalysisMode = 'NORMAL', strategyId?: string | null) {
  const opts = { rdm: tf === 'RDM', rdmMinScore: deps.rdmMinScore, confirmation: !strategyId && mode === 'CONFIRMATION' };
  try {
    const frames = await Promise.race([
      deps.scan(symbol, framesFor(tf, rdm), mode, strategyId || null),
      new Promise<Array<ScanFrame | null>>(r => setTimeout(() => r([]), 25_000)),
    ]);
    return summarizeScan(frames, { ...opts, ...(strategyId ? { strategyName: (frames as any).strategyName || 'your strategy' } : {}) });
  } catch {
    return summarizeScan([], opts);
  }
}

/** Scans one pair now (used right after it is added and by "Scan now") */
export async function scanItemNow(itemId: string, deps: WatchlistDeps): Promise<WatchItem | null> {
  const snap = await db().collection(ITEMS).doc(itemId).get();
  if (!snap.exists) return null;
  const item = snap.data() as WatchItem;
  const result = await scanFrames(item.symbol, item.timeframe, deps, item.rdmFrames, modeOf(item), item.strategyId);
  const saved = await applyScan(itemId, await holdForRunningTrade(item, result), deps);
  if (saved && IS_LEAD_WORKER && saved.active) watched.set(saved.id, saved);
  return saved;
}

async function syncItems(full = false) {
  const col = db().collection(ITEMS);
  const started = now();
  const snap = full ? await col.where('active', '==', true).get() : await col.where('updatedAt', '>', lastSync - 5000).get();
  for (const d of snap.docs) {
    const w = d.data() as WatchItem;
    if (w.active) watched.set(w.id, w);
    else watched.delete(w.id);
  }
  lastSync = started;
}

async function tick(deps: WatchlistDeps) {
  if (ticking) return;
  ticking = true;
  try {
    const t = now();
    // One scan per pair and timeframe, shared by every trader watching it
    const groups = new Map<string, WatchItem[]>();
    for (const w of watched.values()) {
      if (!w.active || w.nextScanAt > t) continue;
      const k = scanKey(w);
      (groups.get(k) || groups.set(k, []).get(k)!).push(w);
    }
    const keys = [...groups.keys()];
    for (let i = 0; i < keys.length; i += FETCH_CONCURRENCY) {
      await Promise.all(
        keys.slice(i, i + FETCH_CONCURRENCY).map(async k => {
          const items = groups.get(k)!;
          const result = await scanFrames(items[0].symbol, items[0].timeframe, deps, items[0].rdmFrames, modeOf(items[0]), items[0].strategyId);
          for (const w of items) {
            try {
              const saved = await applyScan(w.id, await holdForRunningTrade(w, result), deps);
              if (saved?.active) watched.set(saved.id, saved);
              else watched.delete(w.id);
            } catch (err: any) {
              console.warn('[MarketX Watchlist] save failed:', err?.message || err);
            }
          }
        })
      );
    }
  } catch (err: any) {
    console.warn('[MarketX Watchlist] scan cycle failed:', err?.message || err);
  } finally {
    ticking = false;
  }
}

/** Turns the watchlist on or off for a trader (off pauses every pair; the list is kept) */
export async function setWatchlistEnabled(uid: string, enabled: boolean) {
  const t = now();
  await userRef(uid).update({ watchlist: { enabled, at: t } });
  const snap = await db().collection(ITEMS).where('uid', '==', uid).get();
  await Promise.all(
    snap.docs.map(d => {
      const w = d.data() as WatchItem;
      if (enabled && !w.active) return d.ref.update({ active: true, status: 'SCANNING', statusText: statusText('SCANNING', null, w.timeframe, w.rdmFrames), nextScanAt: t, updatedAt: t });
      if (!enabled && w.active) return d.ref.update({ active: false, updatedAt: t });
      return null;
    })
  );
  if (IS_LEAD_WORKER) {
    for (const d of snap.docs) {
      const w = d.data() as WatchItem;
      if (enabled) watched.set(w.id, { ...w, active: true, nextScanAt: t });
      else watched.delete(w.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export function registerWatchlistRoutes(app: Express, deps: WatchlistDeps, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  if (isFirebaseConfigured() && IS_LEAD_WORKER) {
    const boot = async () => {
      try {
        await syncItems(true);
        console.log(`[MarketX Watchlist] watching ${watched.size} pair(s)`);
      } catch (err: any) {
        console.warn('[MarketX Watchlist] initial load failed:', err?.message || err);
      }
      setInterval(() => syncItems().catch(err => console.warn('[MarketX Watchlist] sync failed:', err?.message || err)), SYNC_MS).unref();
      setInterval(() => tick(deps), TICK_MS).unref();
    };
    setTimeout(boot, BOOT_DELAY_MS).unref();
  }

  const throttle = createKeyedThrottle({ windowMs: 60_000, max: 30 });
  const guard = (req: Request, res: Response, next: NextFunction) => {
    const wait = throttle.hit(getUser(res).uid);
    if (wait) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many watchlist changes. Please wait a minute.' });
    next();
  };
  const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) =>
    fn(req, res).catch(err => {
      console.error(`[MarketX Watchlist] ${req.method} ${req.path} failed:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
    });
  const enabledFor = async (uid: string) => !!((await userRef(uid).get()).data() as UserDoc | undefined)?.watchlist?.enabled;
  const validId = (id: string) => /^wl_[a-f0-9]{16}$/.test(id);
  const ownItem = async (uid: string, id: string) => {
    if (!validId(id)) return null;
    const snap = await db().collection(ITEMS).doc(id).get();
    const w = snap.data() as WatchItem | undefined;
    return w && w.uid === uid ? w : null;
  };

  app.get('/api/watchlist', limiter, requireAuth, requirePro, wrap(async (_req, res) => {
    const { uid } = getUser(res);
    const [enabled, items] = await Promise.all([enabledFor(uid), listItems(uid)]);
    res.json({ enabled, items, max: MAX_PAIRS, checkedAt: now() });
  }));

  app.post('/api/watchlist/consent', limiter, requireAuth, guard, requireProToEnable, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const enabled = req.body?.enabled === true;
    await setWatchlistEnabled(uid, enabled);
    // Pairs that were paused start scanning again straight away
    if (enabled) {
      const items = await listItems(uid);
      items.filter(i => i.status === 'SCANNING').slice(0, MAX_PAIRS).forEach(i => scanItemNow(i.id, deps).catch(() => {}));
    }
    res.json({ enabled, items: await listItems(uid), max: MAX_PAIRS });
  }));

  // Add a pair: confirm MarketX can read its live price and chart first, then save it and scan it
  app.post('/api/watchlist', limiter, requireAuth, guard, requirePro, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const query = (typeof req.body?.query === 'string' ? req.body.query : '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const timeframe = typeof req.body?.timeframe === 'string' ? req.body.timeframe.trim().toUpperCase() : '';
    if (!query) return res.status(400).json({ error: 'BAD_REQUEST', message: 'Type a pair to watch, for example EURUSD, gold or BTC.' });
    if (!isWatchTimeframe(timeframe)) return res.status(400).json({ error: 'BAD_TIMEFRAME', message: 'Pick a timeframe, or RDM to scan every timeframe.' });
    if (!(await enabledFor(uid))) return res.status(409).json({ error: 'WATCHLIST_OFF', message: 'Turn on the watchlist first.' });
    const mine = (await db().collection(ITEMS).where('uid', '==', uid).get()).docs.map(d => d.data() as WatchItem);
    if (mine.length >= MAX_PAIRS) return res.status(429).json({ error: 'WATCHLIST_FULL', message: `You can watch up to ${MAX_PAIRS} pairs. Remove one first.` });

    const asset = await deps.resolve(query).catch(() => null);
    if (!asset) return res.status(404).json({ error: 'UNKNOWN_ASSET', message: `MarketX couldn't find a live market for "${query}". Check the pair, or try its ticker (e.g. EURUSD, XAUUSD, BTC).` });
    if (mine.some(w => w.symbol === asset.symbol)) return res.status(409).json({ error: 'ALREADY_WATCHING', message: `${asset.symbol} is already on your watchlist.` });

    // RDM scans the timeframes chosen in Preference Mode, and every pair scans in the trader's analysis mode
    const sp = await scanPrefs(uid);
    const rdm = timeframe === 'RDM' ? sp.rdm : undefined;
    // Real-time check: a live quote and a readable chart on the timeframe it will be scanned on (RDM: 1H, or the
    // first chosen timeframe of an hour or more)
    const rdmList = framesFor('RDM', rdm);
    const verifyTf = timeframe === 'RDM' ? (rdmList.includes('1H') ? '1H' : rdmList.find(f => timeframeMinutes(f) >= 60) || rdmList[rdmList.length - 1]) : timeframe;
    const timeout = <T,>(p: Promise<T>, fallback: T) => Promise.race([p.catch(() => fallback), new Promise<T>(r => setTimeout(() => r(fallback), VERIFY_TIMEOUT_MS))]);
    const [quote, bars] = await Promise.all([timeout(deps.quote(asset.symbol), null), timeout(deps.candles(asset.symbol, verifyTf), 0)]);
    if (!quote || !finite(quote.price)) {
      return res.status(422).json({ error: 'NO_LIVE_PRICE', message: `MarketX can't read a live price for ${asset.symbol} right now, so it wasn't added. Try again in a moment.` });
    }
    if (!(bars >= 40)) {
      return res.status(422).json({ error: 'NO_LIVE_CHART', message: `MarketX can't read enough ${verifyTf} chart data for ${asset.symbol} right now, so it wasn't added.` });
    }

    const t = now();
    const item: WatchItem = {
      // One id per trader and market, so two quick taps on Add can never save the same pair twice
      id: `wl_${crypto.createHash('sha256').update(`${uid}|${asset.symbol}`).digest('hex').slice(0, 16)}`,
      uid,
      symbol: asset.symbol.slice(0, 32),
      name: String(asset.name || asset.symbol).slice(0, 60),
      type: String(asset.type || '').slice(0, 16),
      timeframe,
      ...(rdm ? { rdmFrames: rdm } : {}),
      analysisMode: sp.mode,
      ...(sp.strategyId ? { strategyId: sp.strategyId } : {}),
      addedAt: t,
      updatedAt: t,
      active: true,
      status: 'SCANNING',
      statusText: statusText('SCANNING', null, timeframe, rdm),
      price: quote.price,
      priceAt: t,
      scannedAt: null,
      nextScanAt: t + scanGapMs(timeframe),
      setup: null,
      notified: [],
    };
    const ref = db().collection(ITEMS).doc(item.id);
    const created = await db().runTransaction(async tx => {
      if ((await tx.get(ref)).exists) return false;
      tx.set(ref, item);
      return true;
    });
    if (!created) return res.status(409).json({ error: 'ALREADY_WATCHING', message: `${item.symbol} is already on your watchlist.` });
    if (IS_LEAD_WORKER) watched.set(item.id, item);
    // First scan straight away (the trader sees "Scanning…" until it lands)
    scanItemNow(item.id, deps).catch(err => console.warn('[MarketX Watchlist] first scan failed:', err?.message || err));
    res.json({ item: toClient(item), verified: { symbol: item.symbol, name: item.name, price: quote.price, change24h: Number(quote.change24h) || 0, bars }, items: await listItems(uid), max: MAX_PAIRS });
  }));

  // Change the timeframe of a pair (rescans it)
  app.patch('/api/watchlist/:id', limiter, requireAuth, guard, requirePro, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const timeframe = typeof req.body?.timeframe === 'string' ? req.body.timeframe.trim().toUpperCase() : '';
    if (!isWatchTimeframe(timeframe)) return res.status(400).json({ error: 'BAD_TIMEFRAME', message: 'Pick a timeframe, or RDM to scan every timeframe.' });
    const w = await ownItem(uid, String(req.params.id || ''));
    if (!w) return res.status(404).json({ error: 'NOT_FOUND', message: 'That pair is not on your watchlist.' });
    const t = now();
    const rdm = timeframe === 'RDM' ? (await scanPrefs(uid)).rdm : [];
    // A paused pair keeps its new timeframe and is scanned when the watchlist is turned back on
    await db().collection(ITEMS).doc(w.id).update({
      timeframe, rdmFrames: rdm, setup: null, nextScanAt: t + scanGapMs(timeframe), updatedAt: t,
      ...(w.active ? { status: 'SCANNING', statusText: statusText('SCANNING', null, timeframe, rdm) } : { status: 'WAITING', statusText: `Paused · ${tfLabel(timeframe, rdm)}` }),
    });
    if (IS_LEAD_WORKER && w.active) watched.set(w.id, { ...w, timeframe, rdmFrames: rdm, nextScanAt: t + scanGapMs(timeframe) });
    if (w.active) scanItemNow(w.id, deps).catch(() => {});
    res.json({ items: await listItems(uid), max: MAX_PAIRS });
  }));

  // Scan a pair again now (at most once a minute per pair)
  const rescan = createKeyedThrottle({ windowMs: 60_000, max: 1 });
  app.post('/api/watchlist/:id/scan', limiter, requireAuth, guard, requirePro, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const w = await ownItem(uid, String(req.params.id || ''));
    if (!w) return res.status(404).json({ error: 'NOT_FOUND', message: 'That pair is not on your watchlist.' });
    if (!w.active) return res.status(409).json({ error: 'WATCHLIST_OFF', message: 'Turn on the watchlist first.' });
    if (rescan.hit(w.id)) return res.status(429).json({ error: 'TOO_SOON', message: 'This pair was just scanned. Try again in a minute.' });
    await scanItemNow(w.id, deps);
    res.json({ items: await listItems(uid), max: MAX_PAIRS });
  }));

  app.delete('/api/watchlist/:id', limiter, requireAuth, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const w = await ownItem(uid, String(req.params.id || ''));
    if (!w) return res.status(404).json({ error: 'NOT_FOUND', message: 'That pair is not on your watchlist.' });
    await db().collection(ITEMS).doc(w.id).delete();
    watched.delete(w.id);
    res.json({ items: await listItems(uid), max: MAX_PAIRS });
  }));
}

// Exposed for tests
export const __watchInternals = { tick, syncItems, watched, summarizeScan };
