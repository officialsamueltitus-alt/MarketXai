// ===========================================================================
// On-chain signal proofs: every LONG / SHORT signal MarketX serves is sealed the moment it is served, and the seals are
// written to Solana in batches so anyone can check a signal existed, unedited, at that time.
//
// 1. Seal: the signal's levels (symbol, timeframe, side, entry, stop, targets, time) are written as canonical JSON and
//    hashed: SHA-256("marketx-signal-v1\n" + json). The proof id and hash go out with the signal (strategy.proof).
// 2. Batch (lead worker, every PROOF_BATCH_MS, default 1 min, only when new seals exist): the seals become the leaves of a
//    Merkle tree (leaf = SHA-256(0x00 || hash), node = SHA-256(0x01 || left || right), an odd node moves up as is).
// 3. Anchor: the tree's root goes into a Solana Memo transaction from the proof wallet
//    ("MarketX proof v1 <batch> <root> n=<count>"). One transaction per batch, whatever the number of signals: a fraction
//    of a cent. With no wallet configured, batches wait and are anchored once one is added.
// 4. Verify: GET /api/proofs/:id (public) returns the sealed JSON, the hash, the Merkle path, the root and the transaction.
//    The /proof/<id> page recomputes everything in the browser and links the transaction on a Solana explorer.
// 5. Result, in plain words ("sealed now, readable later", owner-specified): the lead worker follows each sealed trade on
//    1-minute candles (same rules as price alerts). When it ends (all targets, stop, or TP1 before entry) or REVEAL_AFTER_MS
//    (24h) after it was served, whichever comes first, one more memo writes the trade itself and its result in readable
//    text: pair, side, entry, stop, targets, time, result, fingerprint and the proof page link. Live signals never go on
//    chain readable, so nobody can copy them for free; the earlier seal proves the levels were not changed.
// Nothing here changes an analysis; the trader's identity is never part of a proof.
// ===========================================================================
import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { db, isFirebaseConfigured } from './firebase';
import { IS_LEAD_WORKER } from './workers';
import { createKeyedThrottle, clientIp } from './security';
import { loadProofWallet, memoStatus, rpcHost, submitMemo, walletBalance, type ProofWallet } from './solana';
import { evaluateBars, type AlertHit, type Bar } from './priceAlerts';
import { exactPrice } from '../src/utils/formatPrice';
import { traderKey } from './traderId';

const PROOFS = 'signalProofs';
const BATCHES = 'proofBatches';
const PREFIX = 'marketx-signal-v1\n';
const BATCH_MS = Math.max(5_000, Number(process.env.PROOF_BATCH_MS) || 60_000);
const BATCH_MAX = 4000;
/** Lamports a memo costs (5,000 per signature) plus headroom; below this the anchor waits for a top-up */
const MIN_LAMPORTS = 20_000;
/** Waiting batches are retried this often (new batches still form every BATCH_MS) */
const ANCHOR_RETRY_MS = Math.max(5_000, Number(process.env.PROOF_RETRY_MS) || 10 * 60_000);
/** A sent transaction not seen on chain after this long is sent again (its blockhash has expired by then) */
const RESEND_AFTER_MS = 3 * 60_000;
/** A trade still running this long after it was served gets its readable record anyway (result so far) */
const REVEAL_AFTER_MS = Math.max(60_000, Number(process.env.REVEAL_AFTER_MS) || 24 * 3600e3);
/** How often the lead worker follows the trades that are not revealed yet */
const TRACK_MS = Math.max(5_000, Number(process.env.REVEAL_TRACK_MS) || 5 * 60_000);
/** No fresh price data this long after the reveal time (feed down, market closed): the record says the result is unknown */
const NO_DATA_AFTER_MS = 72 * 3600e3;
/** Candles count as fresh when the last one is at most this old; a result is never decided on stale data */
const FRESH_MS = 10 * 60_000;
const REVEALS_PER_RUN = 20;
const NEW_REVEAL: Reveal = { state: 'TRACKING', entered: false, hits: [], scanFrom: 0 };
/** Candle series tried in turn: the first one reaching back to where the check starts is used (feeds return ~300 bars) */
const TRACK_TFS = ['1M', '15M', '1H', '4H'];
const SITE = String(process.env.APP_URL || 'https://marketx.world').replace(/\/+$/, '');

export interface SignalPayload {
  v: 1;
  id: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  execution: string;
  entry: { min: number; max: number; optimal: number };
  stop: number;
  targets: number[];
  issuedAt: number;
}
export type ResultCode = 'WIN' | 'LOSS' | 'MISSED' | 'NOT_TRIGGERED' | 'OPEN' | 'NO_DATA';
export interface Reveal {
  /** TRACKING: following the trade; DUE: result known, waiting to be written; SENT: memo sent, confirming; POSTED: on chain */
  state: 'TRACKING' | 'DUE' | 'SENT' | 'POSTED';
  entered: boolean;
  hits: AlertHit[];
  scanFrom: number;
  result?: { code: ResultCode; text: string; final: boolean; at: number };
  memo?: string;
  tx?: string;
  sentAt?: number;
  slot?: number | null;
  postedAt?: number;
  tries?: number;
  lastError?: string;
}
export interface SignalProof {
  id: string;
  hash: string;
  canonical: string;
  issuedAt: number;
  batched: boolean;
  batchId?: string;
  reveal?: Reveal;
  /** Who got the signal (server only, never returned): their MarketX ID co-signs the readable record */
  uid?: string | null;
}
export interface ProofBatch {
  id: string;
  root: string;
  count: number;
  leaves: Array<{ id: string; hash: string }>;
  createdAt: number;
  memo: string;
  anchor: { status: 'PENDING' | 'ANCHORED' | 'NO_WALLET' | 'LOW_BALANCE' | 'FAILED'; tx?: string; slot?: number | null; at?: number; wallet?: string; tries?: number; sentAt?: number; lastError?: string; lastTryAt?: number };
}

const sha = (...parts: Buffer[]) => crypto.createHash('sha256').update(Buffer.concat(parts)).digest();
const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : NaN);

/** Canonical JSON of a signal (fixed key order, plain numbers) and its hash */
export function sealSignal(strategy: any, id: string, issuedAt = Date.now()): { payload: SignalPayload; canonical: string; hash: string } | null {
  if (!strategy || (strategy.tradeType !== 'LONG' && strategy.tradeType !== 'SHORT')) return null;
  const e = strategy.entryZone || {};
  const payload: SignalPayload = {
    v: 1,
    id,
    symbol: String(strategy.symbol || '').slice(0, 40),
    timeframe: String(strategy.timeframe || '').slice(0, 8),
    direction: strategy.tradeType,
    execution: String(strategy.execution || 'LIMIT').slice(0, 10),
    entry: { min: num(e.min), max: num(e.max), optimal: num(e.optimal) },
    stop: num(strategy.stopLoss?.price),
    targets: (Array.isArray(strategy.takeProfits) ? strategy.takeProfits : []).map((t: any) => num(t?.price)).slice(0, 3),
    issuedAt,
  };
  if (!payload.symbol || [payload.entry.optimal, payload.stop, ...payload.targets].some(n => !(n > 0)) || !payload.targets.length) return null;
  const canonical = JSON.stringify(payload);
  return { payload, canonical, hash: sha(Buffer.from(PREFIX + canonical, 'utf8')).toString('hex') };
}

const leafOf = (hashHex: string) => sha(Buffer.from([0]), Buffer.from(hashHex, 'hex'));
const nodeOf = (l: Buffer, r: Buffer) => sha(Buffer.from([1]), l, r);

/** Merkle root of the seal hashes, and (when asked) the path for one leaf: [{ side, hash }] from the leaf up */
export function merkle(hashes: string[], index = -1): { root: string; path: Array<{ side: 'L' | 'R'; hash: string }> } {
  if (!hashes.length) return { root: '', path: [] };
  let level = hashes.map(leafOf);
  let idx = index;
  const path: Array<{ side: 'L' | 'R'; hash: string }> = [];
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        next.push(nodeOf(level[i], level[i + 1]));
        if (idx === i) path.push({ side: 'R', hash: level[i + 1].toString('hex') });
        else if (idx === i + 1) path.push({ side: 'L', hash: level[i].toString('hex') });
      } else next.push(level[i]);
    }
    if (idx >= 0) idx = Math.floor(idx / 2);
    level = next;
  }
  return { root: level[0].toString('hex'), path };
}

// ---------------------------------------------------------------------------
// Sealing as signals are served (wraps res.json on /api/market/analyze; the analysis itself is untouched)
// ---------------------------------------------------------------------------
export function signalProofMiddleware(_req: Request, res: Response, next: NextFunction) {
  if (!isFirebaseConfigured()) return next();
  const json = res.json.bind(res);
  res.json = ((body: any) => {
    try {
      const s = body?.strategy;
      if (res.statusCode < 400 && s && (s.tradeType === 'LONG' || s.tradeType === 'SHORT') && !s.proof) {
        const id = `sp_${Date.now().toString(36)}${crypto.randomBytes(8).toString('hex')}`;
        const sealed = sealSignal(s, id);
        if (sealed) {
          s.proof = { id, hash: sealed.hash, issuedAt: sealed.payload.issuedAt };
          const uid = ((res.locals.user as any)?.uid as string | undefined) || null;
          const doc: SignalProof = { id, hash: sealed.hash, canonical: sealed.canonical, issuedAt: sealed.payload.issuedAt, batched: false, reveal: { state: 'TRACKING', entered: false, hits: [], scanFrom: 0 }, uid };
          db().collection(PROOFS).doc(id).set(doc).catch(err => console.warn('[MarketX Proofs] seal save failed:', err?.message || err));
        }
      }
    } catch {}
    return json(body);
  }) as typeof res.json;
  next();
}

// ---------------------------------------------------------------------------
// Batching and anchoring (lead worker)
// ---------------------------------------------------------------------------
let wallet: ProofWallet | null | undefined;
const proofWallet = () => (wallet === undefined ? (wallet = loadProofWallet()) : wallet);

/** Short, safe error text for the admin view (never a URL, key or token) */
const safeError = (err: any) => String(err?.message || 'error').replace(/https?:\/\/\S+/g, '[rpc]').replace(/[A-Za-z0-9]{40,}/g, '…').slice(0, 160);

async function anchorBatch(b: ProofBatch): Promise<ProofBatch['anchor']> {
  const w = proofWallet();
  const now = Date.now();
  const tries = (b.anchor.tries || 0) + 1;
  if (!w) return { status: 'NO_WALLET', tries, lastTryAt: now, lastError: 'No proof wallet is set (the wallet key is missing or unreadable).' };
  // Sent before but not confirmed then: look it up first, so a batch is never written twice
  if (b.anchor.tx && b.anchor.status !== 'ANCHORED') {
    try {
      const st = await memoStatus(b.anchor.tx);
      if (st.state === 'CONFIRMED') {
        console.log(`[MarketX Proofs] batch ${b.id} confirmed on Solana: ${b.anchor.tx}`);
        return { status: 'ANCHORED', tx: b.anchor.tx, slot: st.slot, at: now, wallet: w.address, tries };
      }
      if (st.state === 'UNKNOWN' && now - (b.anchor.sentAt || 0) < RESEND_AFTER_MS) {
        return { ...b.anchor, status: 'PENDING', tries, lastTryAt: now, lastError: 'Sent, waiting for confirmation.' };
      }
    } catch (err: any) {
      return { ...b.anchor, status: 'FAILED', tries, lastTryAt: now, lastError: `Status check failed: ${safeError(err)}` };
    }
  }
  const balance = await walletBalance(w.address);
  if (balance != null && balance < MIN_LAMPORTS) {
    console.warn(`[MarketX Proofs] proof wallet ${w.address} is low on SOL (${balance} lamports); batch ${b.id} waits.`);
    return { status: 'LOW_BALANCE', wallet: w.address, tries, lastTryAt: now, lastError: `Wallet balance ${balance} lamports; needs at least ${MIN_LAMPORTS}.` };
  }
  let signature: string;
  try {
    signature = await submitMemo(w, b.memo);
  } catch (err: any) {
    console.warn(`[MarketX Proofs] anchoring batch ${b.id} failed (${safeError(err)}); retrying in ${Math.round(ANCHOR_RETRY_MS / 60000)} min.`);
    return { status: 'FAILED', wallet: w.address, tries, lastTryAt: now, lastError: safeError(err) };
  }
  // Accepted by the network: wait a little for confirmation; if it is slow, the next retry checks this same signature
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, i < 3 ? 1500 : 3000));
    const st = await memoStatus(signature).catch(() => ({ state: 'UNKNOWN' as const }));
    if (st.state === 'CONFIRMED') {
      console.log(`[MarketX Proofs] batch ${b.id} (${b.count} signals) anchored on Solana via ${rpcHost()}: ${signature}`);
      return { status: 'ANCHORED', tx: signature, slot: st.slot, at: Date.now(), wallet: w.address, tries };
    }
    if (st.state === 'FAILED') return { status: 'FAILED', wallet: w.address, tries, lastTryAt: now, lastError: 'The memo transaction failed on chain.' };
  }
  return { status: 'PENDING', tx: signature, sentAt: now, wallet: w.address, tries, lastTryAt: now, lastError: 'Sent, waiting for confirmation.' };
}

const WAITING = ['PENDING', 'NO_WALLET', 'LOW_BALANCE', 'FAILED'];
/** Anchors every batch that isn't on chain yet (oldest first, up to 5 per run) */
/** Runs fn while holding a short Firestore lease, so only one worker batches or sends at a time (null: another holds it) */
async function withProofLease<T>(fn: () => Promise<T>): Promise<T | null> {
  const lease = db().collection('adminConfig').doc('proofLease');
  const mine = await db().runTransaction(async tx => {
    const cur = (await tx.get(lease)).data() as { until?: number } | undefined;
    if ((cur?.until || 0) > Date.now()) return false;
    tx.set(lease, { until: Date.now() + 180_000 });
    return true;
  });
  if (!mine) return null;
  try {
    return await fn();
  } finally {
    await lease.set({ until: 0 }).catch(() => {});
  }
}

export async function anchorWaiting(): Promise<number> {
  return (await withProofLease(anchorWaitingLocked)) ?? 0;
}
async function anchorWaitingLocked(): Promise<number> {
  let anchored = 0;
  const waiting = (await db().collection(BATCHES).where('anchor.status', 'in', WAITING).get()).docs.map(d => d.data() as ProofBatch);
  for (const b of waiting.sort((x, y) => x.createdAt - y.createdAt).slice(0, 5)) {
    const anchor = await anchorBatch(b);
    await db().collection(BATCHES).doc(b.id).update({ anchor });
    if (anchor.status === 'ANCHORED') anchored++;
    if (anchor.status === 'NO_WALLET' || anchor.status === 'LOW_BALANCE') break;
  }
  return anchored;
}

/** Proof wallet and batches, for the admin console (public wallet address only, never the key) */
export async function proofStatus() {
  const w = proofWallet();
  const [balance, waitingSnap, lastSnap] = await Promise.all([
    w ? walletBalance(w.address) : Promise.resolve(null),
    db().collection(BATCHES).where('anchor.status', 'in', WAITING).get(),
    db().collection(BATCHES).where('anchor.status', '==', 'ANCHORED').get(),
  ]);
  const waiting = waitingSnap.docs.map(d => d.data() as ProofBatch).sort((a, b) => b.createdAt - a.createdAt);
  const anchored = lastSnap.docs.map(d => d.data() as ProofBatch).sort((a, b) => (b.anchor.at || 0) - (a.anchor.at || 0));
  const pick = (b: ProofBatch) => ({ id: b.id, count: b.count, createdAt: b.createdAt, status: b.anchor.status, tx: b.anchor.tx || null, tries: b.anchor.tries || 0, lastTryAt: b.anchor.lastTryAt || null, lastError: b.anchor.lastError || null, at: b.anchor.at || null });
  const unbatched = (await db().collection(PROOFS).where('batched', '==', false).get()).docs.length;
  const [tracking, due, posted] = await Promise.all(
    [['TRACKING'], ['DUE', 'SENT'], ['POSTED']].map(states => db().collection(PROOFS).where('reveal.state', 'in', states).get())
  );
  const lastPosted = posted.docs
    .map(d => d.data() as SignalProof)
    .sort((a, b) => (b.reveal?.postedAt || 0) - (a.reveal?.postedAt || 0))
    .slice(0, 5)
    .map(p => ({ id: p.id, tx: p.reveal?.tx || null, at: p.reveal?.postedAt || null, result: p.reveal?.result?.text || null }));
  const dueErrors = due.docs.map(d => (d.data() as SignalProof).reveal?.lastError).filter(Boolean);
  return {
    wallet: w ? { address: w.address, lamports: balance } : null,
    rpcHost: rpcHost(),
    batchEveryMin: Math.round(BATCH_MS / 60000),
    retryEveryMin: Math.round(ANCHOR_RETRY_MS / 60000),
    minLamports: MIN_LAMPORTS,
    unbatched,
    waiting: waiting.slice(0, 10).map(pick),
    waitingCount: waiting.length,
    anchoredCount: anchored.length,
    lastAnchored: anchored.slice(0, 5).map(pick),
    reveals: { tracking: tracking.docs.length, waiting: due.docs.length, posted: posted.docs.length, revealAfterHours: Math.round(REVEAL_AFTER_MS / 3600e3), lastError: dueErrors[0] || null, last: lastPosted },
  };
}

let cycleRunning = false;
/** Batches any new seals and anchors waiting batches now (admin "Anchor now"); one run at a time */
export async function runProofCycleNow(): Promise<{ batched: number; anchored: number; revealed: number; busy?: boolean }> {
  if (cycleRunning) return { batched: 0, anchored: 0, revealed: 0, busy: true };
  cycleRunning = true;
  try {
    return await runProofCycle();
  } finally {
    cycleRunning = false;
  }
}

/** One cycle: batch the new seals, then anchor every batch that isn't on chain yet. Returns what was done. */
export async function runProofCycle(): Promise<{ batched: number; anchored: number; revealed: number }> {
  return (await withProofLease(runProofCycleLocked)) ?? { batched: 0, anchored: 0, revealed: 0 };
}
async function runProofCycleLocked(): Promise<{ batched: number; anchored: number; revealed: number }> {
  let batched = 0;
  const fresh = (await db().collection(PROOFS).where('batched', '==', false).get()).docs
    .map(d => d.data() as SignalProof)
    .sort((a, b) => a.issuedAt - b.issuedAt || a.id.localeCompare(b.id))
    .slice(0, BATCH_MAX);
  if (fresh.length) {
    const id = `pb_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${crypto.randomBytes(4).toString('hex')}`;
    const { root } = merkle(fresh.map(p => p.hash));
    const batch: ProofBatch = {
      id,
      root,
      count: fresh.length,
      leaves: fresh.map(p => ({ id: p.id, hash: p.hash })),
      createdAt: Date.now(),
      memo: `MarketX proof v1 ${id} ${root} n=${fresh.length}`,
      anchor: { status: 'PENDING' },
    };
    await db().collection(BATCHES).doc(id).set(batch);
    for (let i = 0; i < fresh.length; i += 400) {
      const w = db().batch();
      // Seals made by an older version get followed too, so they also get their readable record
      for (const p of fresh.slice(i, i + 400)) w.update(db().collection(PROOFS).doc(p.id), { batched: true, batchId: id, ...(p.reveal ? {} : { reveal: NEW_REVEAL }) });
      await w.commit();
    }
    batched = fresh.length;
  }
  const anchored = await anchorWaitingLocked();
  const revealed = await postRevealsLocked();
  return { batched, anchored, revealed };
}

// ---------------------------------------------------------------------------
// Readable result records ("sealed now, readable later")
// ---------------------------------------------------------------------------
export interface SignalProofDeps {
  /** Recent candles of a timeframe ('1M', '15M', '1H', '4H') for a symbol (oldest first), or null when unavailable */
  getBars?: (symbol: string, tf: string) => Promise<Bar[] | null>;
}
const utc = (t: number) => `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** The trade's result in plain words, from its level hits. final = the trade is over (all targets, stop, or missed). */
export function revealResult(hits: AlertHit[], entered: boolean, targets: number, final: boolean, now: number): NonNullable<Reveal['result']> {
  const at = (k: string) => hits.find(h => h.kind === k)?.at;
  const missed = at('MISSED');
  if (missed) return { code: 'MISSED', text: `Missed, TP1 was reached before the entry (${utc(missed)})`, final: true, at: missed };
  const tps = hits.filter(h => /^TP\d$/.test(h.kind)).sort((a, b) => Number(a.kind.slice(2)) - Number(b.kind.slice(2)));
  const best = tps[tps.length - 1];
  const sl = at('SL');
  if (sl && best) return { code: 'WIN', text: `Win, TP${best.kind.slice(2)} hit (${utc(best.at)}), then the stop loss`, final: true, at: sl };
  if (sl) return { code: 'LOSS', text: `Loss, stop loss hit (${utc(sl)})`, final: true, at: sl };
  if (best && Number(best.kind.slice(2)) >= targets) return { code: 'WIN', text: `Win, every target hit, TP${targets} at ${utc(best.at)}`, final: true, at: best.at };
  if (best) return { code: 'WIN', text: `Win so far, TP${best.kind.slice(2)} hit (${utc(best.at)}), still running at ${utc(now)}`, final, at: now };
  if (entered) return { code: 'OPEN', text: `Open, entry filled (${utc(at('ENTRY') || now)}), no target or stop by ${utc(now)}`, final, at: now };
  return { code: 'NOT_TRIGGERED', text: `Not triggered, the entry was not reached by ${utc(now)}`, final, at: now };
}

const sideText = (p: SignalPayload) => `${p.direction === 'LONG' ? 'BUY' : 'SELL'}${p.execution === 'MARKET' ? '' : ' LIMIT'}`;
/** The readable memo: the trade itself, its result, its fingerprint and where to verify it (always under 500 bytes) */
export function revealMemo(p: SignalPayload, hash: string, result: NonNullable<Reveal['result']>): string {
  const e = p.entry;
  const parts = [
    'MarketX signal result',
    `${p.symbol.slice(0, 24)} ${p.timeframe}`.trim(),
    sideText(p),
    `Entry ${exactPrice(e.optimal)}${e.min !== e.max ? ` (${exactPrice(e.min)} to ${exactPrice(e.max)})` : ''}`,
    `SL ${exactPrice(p.stop)}`,
    p.targets.map((t, i) => `TP${i + 1} ${exactPrice(t)}`).join(', '),
    `Issued ${utc(p.issuedAt)}`,
    `Result: ${result.text}`,
    `Fingerprint ${hash}`,
    `Verify ${SITE}/proof/${p.id}`,
  ];
  let memo = parts.join(' | ');
  // Very long prices (tiny meme coins): drop the entry band first, then the link, never the levels or the fingerprint
  if (Buffer.byteLength(memo) > 500) memo = parts.map((x, i) => (i === 3 ? `Entry ${exactPrice(e.optimal)}` : x)).join(' | ');
  if (Buffer.byteLength(memo) > 500) memo = parts.slice(0, -1).map((x, i) => (i === 3 ? `Entry ${exactPrice(e.optimal)}` : x)).join(' | ');
  return Buffer.from(memo).subarray(0, 500).toString('utf8').replace(/�$/, '');
}

/**
 * Once: every seal made before readable records existed gets followed too, so each trader's whole history (all their
 * trades so far) ends up readable under their MarketX ID. Older trades are checked on coarser candles when needed.
 */
export async function backfillReveals(): Promise<number> {
  const flag = db().collection('adminConfig').doc('revealBackfill');
  if ((await flag.get()).data()?.done) return 0;
  let n = 0;
  const snap = await db().collection(PROOFS).get();
  const missing = snap.docs.filter(d => !(d.data() as SignalProof).reveal);
  for (let i = 0; i < missing.length; i += 400) {
    const w = db().batch();
    for (const d of missing.slice(i, i + 400)) w.update(d.ref, { reveal: NEW_REVEAL });
    await w.commit();
    n += Math.min(400, missing.length - i);
  }
  await flag.set({ done: true, at: Date.now(), count: n });
  if (n) console.log(`[MarketX Proofs] ${n} earlier signal(s) will get their readable result record`);
  return n;
}

let trackRunning = false;
/** Follows every trade that is not revealed yet on 1-minute candles (one series per symbol) and marks results due */
export async function trackReveals(deps: SignalProofDeps, now = Date.now()): Promise<number> {
  if (trackRunning || !deps.getBars) return 0;
  trackRunning = true;
  try {
    const open = (await db().collection(PROOFS).where('reveal.state', '==', 'TRACKING').limit(1000).get()).docs.map(d => d.data() as SignalProof);
    const bySymbol = new Map<string, Array<{ p: SignalProof; s: SignalPayload }>>();
    for (const p of open) {
      let s: SignalPayload;
      try {
        s = JSON.parse(p.canonical);
      } catch {
        continue;
      }
      (bySymbol.get(s.symbol) || bySymbol.set(s.symbol, []).get(s.symbol)!).push({ p, s });
    }
    let due = 0;
    const symbols = [...bySymbol.keys()];
    for (let i = 0; i < symbols.length; i += 4) {
      await Promise.all(
        symbols.slice(i, i + 4).map(async sym => {
          // Series fetched once per symbol and timeframe; each trade uses the finest one reaching back to its last check
          const group = bySymbol.get(sym)!;
          const series = new Map<string, Promise<Bar[] | null>>();
          const fetchTf = (tf: string) => {
            if (!series.has(tf)) series.set(tf, deps.getBars!(sym, tf).catch(() => null));
            return series.get(tf)!;
          };
          for (const { p, s } of group) {
            const r = p.reveal!;
            const update: Partial<Reveal> = {};
            let entered = r.entered;
            let hits = r.hits || [];
            let closed = false;
            const startT = Math.max(Math.floor(s.issuedAt / 60e3) * 60e3, r.scanFrom || 0);
            // Only candles that cover the whole stretch since the last check: a gap could hide a hit
            let bars: Bar[] | null = null;
            for (const tf of TRACK_TFS) {
              const got = await fetchTf(tf);
              if (got?.length && got[0].t <= startT) {
                bars = got;
                break;
              }
            }
            const usable = !!bars;
            if (usable) {
              const ev = evaluateBars({ direction: s.direction, entry: s.entry, stop: s.stop, tps: s.targets, entered, hits, createdAt: s.issuedAt, scanFrom: r.scanFrom }, bars!);
              entered = ev.entered;
              hits = [...hits, ...ev.hits];
              closed = ev.closed;
              Object.assign(update, { entered, hits, scanFrom: bars![bars!.length - 1].t });
            }
            const revealAt = s.issuedAt + REVEAL_AFTER_MS;
            const lastT = usable ? bars![bars!.length - 1].t : 0;
            // "Still running at <time>": the end of the last candle checked, never past now
            const seenUntil = Math.min(now, lastT + 60_000);
            if (closed || (now >= revealAt && lastT >= revealAt - FRESH_MS && seenUntil > s.issuedAt)) {
              Object.assign(update, { state: 'DUE', result: revealResult(hits, entered, s.targets.length, closed, seenUntil) });
              due++;
            } else if (now >= revealAt + NO_DATA_AFTER_MS) {
              Object.assign(update, { state: 'DUE', result: hits.length ? revealResult(hits, entered, s.targets.length, false, now) : { code: 'NO_DATA', text: 'Result unknown, no complete price data was available', final: false, at: now } });
              due++;
            }
            if (Object.keys(update).length) await db().collection(PROOFS).doc(p.id).update(Object.fromEntries(Object.entries(update).map(([k, v]) => [`reveal.${k}`, v])));
          }
        })
      );
    }
    return due;
  } finally {
    trackRunning = false;
  }
}

/**
 * Who got a signal sealed before seals carried it: the price-alert offer recorded with the same signal (same symbol and
 * levels, within seconds). Saved on the proof (null when there is no match) so it is looked up once.
 */
async function ownerOf(p: SignalProof, s: SignalPayload): Promise<string | null> {
  let uid: string | null = null;
  try {
    // The proof and its offer are made in the same response, milliseconds apart; identical levels can come up for several
    // traders, so the closest one wins and a tie between two different traders is left unmatched
    const snap = await db().collection('alertOffers').where('createdAt', '>=', s.issuedAt - 3_000).where('createdAt', '<=', s.issuedAt + 3_000).get();
    const same = (a: number, b: number) => Math.abs(a - b) <= Math.abs(b) * 1e-9;
    const match = snap.docs
      .map(d => d.data() as any)
      .filter(o => o.uid && o.symbol === s.symbol && o.direction === s.direction && same(Number(o.stop), s.stop) && same(Number(o.entry?.optimal), s.entry.optimal))
      .map(o => ({ uid: String(o.uid), gap: Math.abs(Number(o.createdAt) - s.issuedAt) }))
      .sort((x, y) => x.gap - y.gap);
    if (match.length && !match.some(m => m.uid !== match[0].uid && m.gap - match[0].gap < 50)) uid = match[0].uid;
  } catch {
    return null;
  }
  await db().collection(PROOFS).doc(p.id).update({ uid }).catch(() => {});
  return uid;
}

/** Writes the readable records that are due (after their seal is on Solana); call under the proof lease */
async function postRevealsLocked(): Promise<number> {
  const w = proofWallet();
  if (!w) return 0;
  const waiting = (await db().collection(PROOFS).where('reveal.state', 'in', ['DUE', 'SENT']).limit(200).get()).docs
    .map(d => d.data() as SignalProof)
    .sort((a, b) => (a.reveal?.result?.at || 0) - (b.reveal?.result?.at || 0))
    .slice(0, REVEALS_PER_RUN);
  if (!waiting.length) return 0;
  const anchoredBatch = new Map<string, boolean>();
  const isAnchored = async (batchId?: string) => {
    if (!batchId) return false;
    if (!anchoredBatch.has(batchId)) anchoredBatch.set(batchId, ((await db().collection(BATCHES).doc(batchId).get()).data() as ProofBatch | undefined)?.anchor.status === 'ANCHORED');
    return anchoredBatch.get(batchId)!;
  };
  let balance: number | null | undefined;
  let posted = 0;
  const sent: string[] = [];
  for (const p of waiting) {
    const r = p.reveal!;
    const ref = db().collection(PROOFS).doc(p.id);
    const now = Date.now();
    // Sent before: look it up first, so a record is never written twice
    if (r.state === 'SENT' && r.tx) {
      const st = await memoStatus(r.tx).catch(() => ({ state: 'UNKNOWN' as const }));
      if (st.state === 'CONFIRMED') {
        await ref.update({ 'reveal.state': 'POSTED', 'reveal.slot': st.slot, 'reveal.postedAt': now, 'reveal.lastError': null });
        posted++;
        continue;
      }
      if (st.state === 'UNKNOWN' && now - (r.sentAt || 0) < RESEND_AFTER_MS) continue;
    }
    // The seal comes first: the readable record only goes out once its batch is on chain
    if (!(await isAnchored(p.batchId))) continue;
    if (balance === undefined) balance = await walletBalance(w.address);
    if (balance != null && balance < MIN_LAMPORTS) {
      await ref.update({ 'reveal.lastError': `Wallet balance ${balance} lamports; needs at least ${MIN_LAMPORTS}.` });
      break;
    }
    let s: SignalPayload;
    try {
      s = JSON.parse(p.canonical);
    } catch {
      continue;
    }
    const memo = r.memo || revealMemo(s, p.hash, r.result!);
    try {
      // The trader's MarketX ID co-signs, so the record is listed under their ID on any explorer
      const uid = p.uid === undefined ? await ownerOf(p, s) : p.uid;
      const cosigners = uid ? [await traderKey(uid)] : [];
      const tx = await submitMemo(w, memo, cosigners);
      await ref.update({ 'reveal.state': 'SENT', 'reveal.memo': memo, 'reveal.tx': tx, 'reveal.sentAt': now, 'reveal.tries': (r.tries || 0) + 1, 'reveal.lastError': null });
      sent.push(p.id);
    } catch (err: any) {
      await ref.update({ 'reveal.memo': memo, 'reveal.tries': (r.tries || 0) + 1, 'reveal.lastError': safeError(err) });
      console.warn(`[MarketX Proofs] result record for ${p.id} failed (${safeError(err)}); retrying on the next cycle.`);
      break;
    }
  }
  // Give the new ones a few seconds to confirm; slower ones are confirmed on the next cycle
  if (sent.length) {
    await new Promise(r => setTimeout(r, 4000));
    for (const id of sent) {
      const tx = ((await db().collection(PROOFS).doc(id).get()).data() as SignalProof).reveal?.tx;
      const st = tx ? await memoStatus(tx).catch(() => ({ state: 'UNKNOWN' as const })) : { state: 'UNKNOWN' as const };
      if (st.state === 'CONFIRMED') {
        await db().collection(PROOFS).doc(id).update({ 'reveal.state': 'POSTED', 'reveal.slot': st.slot, 'reveal.postedAt': Date.now() });
        posted++;
      } else if (st.state === 'FAILED') {
        await db().collection(PROOFS).doc(id).update({ 'reveal.state': 'DUE', 'reveal.tx': null, 'reveal.lastError': 'The memo transaction failed on chain.' });
      }
    }
  }
  if (posted) console.log(`[MarketX Proofs] ${posted} readable result record(s) written on Solana`);
  return posted;
}

/** What the public proof page may show about the result (the readable record and its transaction) */
async function publicTraderId(p: SignalProof): Promise<string | null> {
  if (!p.uid) return null;
  try {
    return (await traderKey(p.uid)).address;
  } catch {
    return null;
  }
}
function publicReveal(p: SignalProof) {
  const r = p.reveal;
  if (!r) return null;
  const decided = r.state !== 'TRACKING';
  return {
    state: r.state === 'POSTED' ? 'POSTED' : decided ? 'POSTING' : 'TRACKING',
    revealAt: p.issuedAt + REVEAL_AFTER_MS,
    result: decided && r.result ? { code: r.result.code, text: r.result.text, final: r.result.final } : null,
    memo: r.state === 'POSTED' ? r.memo || null : null,
    tx: r.state === 'POSTED' ? r.tx || null : null,
    at: r.postedAt || null,
  };
}

export function registerSignalProofRoutes(app: Express, limiter: (req: Request, res: Response, next: NextFunction) => void, deps: SignalProofDeps = {}) {
  if (isFirebaseConfigured() && IS_LEAD_WORKER) {
    const w = proofWallet();
    console.log(w ? `[MarketX Proofs] proof wallet ${w.address}; batches every ${Math.round(BATCH_MS / 60000)} min` : '[MarketX Proofs] no proof wallet set: signals are sealed and batched, anchoring waits for SOLANA_PROOF_SECRET_KEY');
    const cycle = () => {
      if (cycleRunning) return;
      cycleRunning = true;
      runProofCycle()
        .then(r => (r.batched || r.anchored) && console.log(`[MarketX Proofs] cycle: ${r.batched} sealed signal(s) batched, ${r.anchored} batch(es) anchored, ${r.revealed} result(s) written`))
        .catch(err => console.warn('[MarketX Proofs] cycle failed:', err?.message || err))
        .finally(() => (cycleRunning = false));
    };
    // Waiting batches are retried every few minutes, not only when the next batch forms
    const retry = () => {
      if (cycleRunning) return;
      cycleRunning = true;
      anchorWaiting()
        .then(n => n && console.log(`[MarketX Proofs] retry: ${n} batch(es) anchored`))
        .catch(err => console.warn('[MarketX Proofs] retry failed:', err?.message || err))
        .finally(() => (cycleRunning = false));
    };
    setTimeout(cycle, Math.min(BATCH_MS, 5 * 60_000)).unref();
    setInterval(cycle, BATCH_MS).unref();
    setInterval(retry, ANCHOR_RETRY_MS).unref();
    // Follows the sealed trades; results that are due are written by the next cycle
    const track = () =>
      trackReveals(deps)
        .then(n => n && console.log(`[MarketX Proofs] ${n} trade result(s) ready to be written`))
        .catch(err => console.warn('[MarketX Proofs] result tracking failed:', err?.message || err));
    if (deps.getBars) setInterval(track, TRACK_MS).unref();
    setTimeout(() => backfillReveals().catch(err => console.warn('[MarketX Proofs] backfill failed:', err?.message || err)), 30_000).unref();
  }

  const perIp = createKeyedThrottle({ windowMs: 60_000, max: 30 });
  const ID = /^sp_[a-z0-9]{8,40}$/;
  // Public: everything needed to verify one signal (no account, no personal data)
  app.get('/api/proofs/:id', limiter, async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    if (!ID.test(id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'Proof not found.' });
    if (perIp.hit(clientIp(req))) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many lookups. Please wait a minute.' });
    try {
      const p = (await db().collection(PROOFS).doc(id).get()).data() as SignalProof | undefined;
      if (!p) return res.status(404).json({ error: 'NOT_FOUND', message: 'Proof not found.' });
      let batch: any = null;
      if (p.batchId) {
        const b = (await db().collection(BATCHES).doc(p.batchId).get()).data() as ProofBatch | undefined;
        if (b) {
          const index = b.leaves.findIndex(l => l.id === p.id);
          const { root, path } = merkle(b.leaves.map(l => l.hash), index);
          batch = {
            id: b.id,
            count: b.count,
            root,
            rootMatches: root === b.root,
            path,
            memo: b.memo,
            createdAt: b.createdAt,
            // The signer is visible on any explorer, but the page never advertises the wallet itself
            anchor: { status: b.anchor.status === 'ANCHORED' ? 'ANCHORED' : 'WAITING', tx: b.anchor.tx || null, slot: b.anchor.slot ?? null, at: b.anchor.at || null },
          };
        }
      }
      res.json({ proof: { id: p.id, hash: p.hash, canonical: p.canonical, prefix: PREFIX, issuedAt: p.issuedAt, status: batch?.anchor.status === 'ANCHORED' ? 'ANCHORED' : batch ? 'BATCHED' : 'SEALED' }, batch, reveal: publicReveal(p), traderId: await publicTraderId(p) });
    } catch {
      res.status(503).json({ error: 'UNAVAILABLE', message: 'Proofs are unavailable right now. Try again shortly.' });
    }
  });
}

export const __proofInternals = { PREFIX, leafOf, nodeOf, resetWallet: () => (wallet = undefined), trackReveals, backfillReveals };
