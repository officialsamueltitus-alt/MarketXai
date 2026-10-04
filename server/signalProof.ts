// ===========================================================================
// On-chain signal proofs: every LONG / SHORT signal MarketX serves is sealed the moment it is served, and the seals are
// written to Solana in batches so anyone can check a signal existed, unedited, at that time.
//
// 1. Seal: the signal's levels (symbol, timeframe, side, entry, stop, targets, time) are written as canonical JSON and
//    hashed: SHA-256("marketx-signal-v1\n" + json). The proof id and hash go out with the signal (strategy.proof).
// 2. Batch (lead worker, every PROOF_BATCH_MS, default 6h, only when new seals exist): the seals become the leaves of a
//    Merkle tree (leaf = SHA-256(0x00 || hash), node = SHA-256(0x01 || left || right), an odd node moves up as is).
// 3. Anchor: the tree's root goes into a Solana Memo transaction from the proof wallet
//    ("MarketX proof v1 <batch> <root> n=<count>"). One transaction per batch, whatever the number of signals: a fraction
//    of a cent. With no wallet configured, batches wait and are anchored once one is added.
// 4. Verify: GET /api/proofs/:id (public) returns the sealed JSON, the hash, the Merkle path, the root and the transaction.
//    The /proof/<id> page recomputes everything in the browser and links the transaction on a Solana explorer.
// Nothing here changes an analysis; the trader's identity is never part of a proof.
// ===========================================================================
import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { db, isFirebaseConfigured } from './firebase';
import { IS_LEAD_WORKER } from './workers';
import { createKeyedThrottle, clientIp } from './security';
import { loadProofWallet, rpcHost, sendMemo, walletBalance, type ProofWallet } from './solana';

const PROOFS = 'signalProofs';
const BATCHES = 'proofBatches';
const PREFIX = 'marketx-signal-v1\n';
const BATCH_MS = Math.max(5_000, Number(process.env.PROOF_BATCH_MS) || 6 * 3600e3);
const BATCH_MAX = 4000;
/** Lamports a memo costs (5,000 per signature) plus headroom; below this the anchor waits for a top-up */
const MIN_LAMPORTS = 20_000;

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
export interface SignalProof {
  id: string;
  hash: string;
  canonical: string;
  issuedAt: number;
  batched: boolean;
  batchId?: string;
}
export interface ProofBatch {
  id: string;
  root: string;
  count: number;
  leaves: Array<{ id: string; hash: string }>;
  createdAt: number;
  memo: string;
  anchor: { status: 'PENDING' | 'ANCHORED' | 'NO_WALLET' | 'LOW_BALANCE' | 'FAILED'; tx?: string; slot?: number | null; at?: number; wallet?: string; tries?: number };
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
          const doc: SignalProof = { id, hash: sealed.hash, canonical: sealed.canonical, issuedAt: sealed.payload.issuedAt, batched: false };
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

async function anchorBatch(b: ProofBatch): Promise<ProofBatch['anchor']> {
  const w = proofWallet();
  if (!w) return { status: 'NO_WALLET' };
  const balance = await walletBalance(w.address);
  if (balance != null && balance < MIN_LAMPORTS) {
    console.warn(`[MarketX Proofs] proof wallet ${w.address} is low on SOL (${balance} lamports); batch ${b.id} waits.`);
    return { status: 'LOW_BALANCE', wallet: w.address, tries: (b.anchor.tries || 0) + 1 };
  }
  try {
    const { signature, slot } = await sendMemo(w, b.memo);
    console.log(`[MarketX Proofs] batch ${b.id} (${b.count} signals) anchored on Solana via ${rpcHost()}: ${signature}`);
    return { status: 'ANCHORED', tx: signature, slot, at: Date.now(), wallet: w.address, tries: (b.anchor.tries || 0) + 1 };
  } catch (err: any) {
    console.warn(`[MarketX Proofs] anchoring batch ${b.id} failed (${err?.message || 'error'}); retrying next cycle.`);
    return { status: 'FAILED', wallet: w.address, tries: (b.anchor.tries || 0) + 1 };
  }
}

/** One cycle: batch the new seals, then anchor every batch that isn't on chain yet. Returns what was done. */
export async function runProofCycle(): Promise<{ batched: number; anchored: number }> {
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
      for (const p of fresh.slice(i, i + 400)) w.update(db().collection(PROOFS).doc(p.id), { batched: true, batchId: id });
      await w.commit();
    }
    batched = fresh.length;
  }
  let anchored = 0;
  const waiting = (await db().collection(BATCHES).where('anchor.status', 'in', ['PENDING', 'NO_WALLET', 'LOW_BALANCE', 'FAILED']).get()).docs.map(d => d.data() as ProofBatch);
  for (const b of waiting.sort((x, y) => x.createdAt - y.createdAt).slice(0, 5)) {
    const anchor = await anchorBatch(b);
    await db().collection(BATCHES).doc(b.id).update({ anchor });
    if (anchor.status === 'ANCHORED') anchored++;
    if (anchor.status === 'NO_WALLET') break;
  }
  return { batched, anchored };
}

export function registerSignalProofRoutes(app: Express, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  if (isFirebaseConfigured() && IS_LEAD_WORKER) {
    const w = proofWallet();
    console.log(w ? `[MarketX Proofs] proof wallet ${w.address}; batches every ${Math.round(BATCH_MS / 60000)} min` : '[MarketX Proofs] no proof wallet set: signals are sealed and batched, anchoring waits for SOLANA_PROOF_SECRET_KEY');
    let running = false;
    const cycle = () => {
      if (running) return;
      running = true;
      runProofCycle()
        .then(r => (r.batched || r.anchored) && console.log(`[MarketX Proofs] cycle: ${r.batched} sealed signal(s) batched, ${r.anchored} batch(es) anchored`))
        .catch(err => console.warn('[MarketX Proofs] cycle failed:', err?.message || err))
        .finally(() => (running = false));
    };
    setTimeout(cycle, Math.min(BATCH_MS, 5 * 60_000)).unref();
    setInterval(cycle, BATCH_MS).unref();
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
            anchor: { status: b.anchor.status === 'ANCHORED' ? 'ANCHORED' : 'WAITING', tx: b.anchor.tx || null, slot: b.anchor.slot ?? null, at: b.anchor.at || null, wallet: b.anchor.wallet || null },
          };
        }
      }
      res.json({ proof: { id: p.id, hash: p.hash, canonical: p.canonical, prefix: PREFIX, issuedAt: p.issuedAt, status: batch?.anchor.status === 'ANCHORED' ? 'ANCHORED' : batch ? 'BATCHED' : 'SEALED' }, batch });
    } catch {
      res.status(503).json({ error: 'UNAVAILABLE', message: 'Proofs are unavailable right now. Try again shortly.' });
    }
  });
}

export const __proofInternals = { PREFIX, leafOf, nodeOf, resetWallet: () => (wallet = undefined) };
