// ===========================================================================
// MarketX ID: every trader (new and existing) has their own Solana address. It co-signs the readable result record of
// each of their trades, so searching the address on Solscan lists every trade they took on MarketX and its result.
//
// The address is derived, never stored: ed25519 seed = HMAC-SHA256(secret, "marketx-trader-id-v1:" + uid). The secret is
// TRADER_ID_SECRET if set, else generated once and kept in Firestore adminConfig/traderIds (never sent to any client).
// Changing the secret changes every ID, so it is set once and left alone. The ID never pays anything: the proof wallet
// pays every fee and, once, the small rent deposit that makes the account exist on Solana (see activateTraderIds).
// Nothing on chain names the trader; the public checker (/checker) shows the public profile behind an ID.
// ===========================================================================
import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { db, isFirebaseConfigured } from './firebase';
import { isUnlimitedEmail, requireAuth, type UserDoc } from './account';
import { base58Encode, memoStatus, RENT_EXEMPT_EMPTY, submitActivation, walletBalance, type ProofWallet } from './solana';
import { IS_LEAD_WORKER } from './workers';
import { clientIp, createKeyedThrottle } from './security';

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const CONFIG = () => db().collection('adminConfig').doc('traderIds');

let secretP: Promise<Buffer> | null = null;
function secret(): Promise<Buffer> {
  if (!secretP) {
    const env = String(process.env.TRADER_ID_SECRET || '').trim();
    secretP = env
      ? Promise.resolve(Buffer.from(env, 'utf8'))
      : db()
          .runTransaction(async tx => {
            const cur = (await tx.get(CONFIG())).data() as { secret?: string } | undefined;
            if (cur?.secret) return Buffer.from(cur.secret, 'base64');
            const fresh = crypto.randomBytes(32);
            tx.set(CONFIG(), { secret: fresh.toString('base64'), createdAt: Date.now() });
            return fresh;
          })
          .catch(err => {
            secretP = null;
            throw err;
          });
  }
  return secretP;
}

const cache = new Map<string, ProofWallet>();
/** The trader's signing key (server only); its address is their MarketX ID */
export async function traderKey(uid: string): Promise<ProofWallet> {
  const hit = cache.get(uid);
  if (hit) return hit;
  const seed = crypto.createHmac('sha256', await secret()).update(`marketx-trader-id-v1:${uid}`).digest();
  const key = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, seed]), format: 'der', type: 'pkcs8' });
  const spki = crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }) as Buffer;
  const publicKey = Uint8Array.from(spki.subarray(spki.length - 32));
  const w: ProofWallet = { address: base58Encode(publicKey), publicKey, sign: m => Uint8Array.from(crypto.sign(null, Buffer.from(m), key)) };
  if (cache.size > 5000) cache.clear();
  cache.set(uid, w);
  return w;
}

export const traderId = async (uid: string) => (await traderKey(uid)).address;

// ---------------------------------------------------------------------------
// Index (ID -> account, for the public checker) and activation on Solana
// ---------------------------------------------------------------------------
// An address with no SOL "does not exist" on explorers. So each ID is activated once, the first time its owner opens
// it: the proof wallet sends it the rent-exempt minimum (about 0.00089 SOL) with a memo the ID co-signs. From then on
// Solscan shows the account, its first transaction, and every trade record after it.
const INDEX = 'traderIds';
const ACTIVATIONS_PER_DAY = Math.max(1, Number(process.env.ID_ACTIVATIONS_PER_DAY) || 300);
/** The proof wallet keeps at least this much for proofs after paying an activation */
const KEEP_LAMPORTS = 200_000;
export interface TraderIdDoc {
  id: string;
  uid: string;
  createdAt: number;
  /** QUEUED -> SENT -> ACTIVE */
  state: 'QUEUED' | 'SENT' | 'ACTIVE';
  tx?: string | null;
  sentAt?: number;
  activatedAt?: number;
  lastError?: string | null;
}

/** Records the ID in the index (once) and queues its activation */
export async function ensureTraderId(uid: string): Promise<TraderIdDoc> {
  const id = await traderId(uid);
  const ref = db().collection(INDEX).doc(id);
  return db().runTransaction(async tx => {
    const cur = (await tx.get(ref)).data() as TraderIdDoc | undefined;
    if (cur) return cur;
    const doc: TraderIdDoc = { id, uid, createdAt: Date.now(), state: 'QUEUED' };
    tx.set(ref, doc);
    return doc;
  });
}

/** Lead worker, under the proof lease: activates queued IDs (and confirms sent ones). Returns how many became active. */
export async function activateTraderIds(payer: ProofWallet | null): Promise<number> {
  if (!payer) return 0;
  const col = db().collection(INDEX);
  const pending = (await col.where('state', 'in', ['QUEUED', 'SENT']).limit(30).get()).docs.map(d => d.data() as TraderIdDoc);
  if (!pending.length) return 0;
  const day = new Date().toISOString().slice(0, 10);
  const dayRef = db().collection('adminConfig').doc('traderIdActivations');
  let done = 0;
  let balance: number | null | undefined;
  for (const d of pending.sort((a, b) => a.createdAt - b.createdAt).slice(0, 10)) {
    const ref = col.doc(d.id);
    const now = Date.now();
    if (d.state === 'SENT' && d.tx) {
      const st = await memoStatus(d.tx).catch(() => ({ state: 'UNKNOWN' as const }));
      if (st.state === 'CONFIRMED') {
        await ref.update({ state: 'ACTIVE', activatedAt: now, lastError: null });
        done++;
        continue;
      }
      if (st.state === 'UNKNOWN' && now - (d.sentAt || 0) < 3 * 60_000) continue;
    }
    // Already holds enough (activated before, or someone sent it SOL): nothing to pay
    const has = await walletBalance(d.id);
    if (has != null && has >= RENT_EXEMPT_EMPTY) {
      await ref.update({ state: 'ACTIVE', activatedAt: now, lastError: null });
      done++;
      continue;
    }
    if (balance === undefined) balance = await walletBalance(payer.address);
    if (balance == null || balance < RENT_EXEMPT_EMPTY + KEEP_LAMPORTS) {
      await ref.update({ lastError: 'Proof wallet balance too low to activate IDs.' });
      break;
    }
    const count = ((await dayRef.get()).data() as any)?.[day] || 0;
    if (count >= ACTIVATIONS_PER_DAY) break;
    try {
      const memo = `MarketX ID ${d.id} is active. MarketX trades and results are listed here.`;
      const tx = await submitActivation(payer, await traderKey(d.uid), RENT_EXEMPT_EMPTY, memo);
      await ref.update({ state: 'SENT', tx, sentAt: now, lastError: null });
      await dayRef.set({ [day]: count + 1 }, { merge: true });
      balance -= RENT_EXEMPT_EMPTY + 10_000;
    } catch (err: any) {
      await ref.update({ lastError: String(err?.message || 'send failed').replace(/https?:\/\/\S+/g, '[rpc]').slice(0, 160) });
      break;
    }
  }
  if (done) console.log(`[MarketX ID] ${done} MarketX ID(s) active on Solana`);
  return done;
}

/** Once: every existing trader gets their ID indexed (so the checker finds it) and queued for activation */
async function indexExistingTraders() {
  const flag = db().collection('adminConfig').doc('traderIdIndex');
  if ((await flag.get()).data()?.done) return;
  const users = await db().collection('users').get();
  let n = 0;
  for (const u of users.docs) {
    await ensureTraderId(u.id).catch(() => {});
    n++;
  }
  await flag.set({ done: true, at: Date.now(), count: n });
  console.log(`[MarketX ID] indexed ${n} trader ID(s)`);
}

/** Public profile behind a MarketX ID (never email, credits, plan details or the account id) */
export async function publicProfile(id: string) {
  const idx = (await db().collection(INDEX).doc(id).get()).data() as TraderIdDoc | undefined;
  if (!idx) return null;
  const u = (await db().collection('users').doc(idx.uid).get()).data() as UserDoc | undefined;
  if (!u || u.status === 'banned' || u.status === 'suspended') return null;
  const now = Date.now();
  const staff = !!u.emailVerified && isUnlimitedEmail(u.email);
  const pro = !!u.subscription?.active && (!u.subscription.expiresAt || u.subscription.expiresAt > now);
  const records = (await db().collection('trackRecord').where('uid', '==', idx.uid).get()).docs.map(d => d.data() as any);
  // One result per signal, newest first
  const seen = new Set<string>();
  const uniq = records.sort((a, b) => b.closedAt - a.closedAt).filter(r => { const k = r.signalKey || r.id; if (seen.has(k)) return false; seen.add(k); return true; });
  const wins = uniq.filter(r => r.outcome === 'WIN').length;
  const losses = uniq.filter(r => r.outcome === 'LOSS').length;
  const avatar = typeof u.avatarUrl === 'string' && /^(https:\/\/|data:image\/(png|jpe?g|webp);base64,)/.test(u.avatarUrl) ? u.avatarUrl : null;
  return {
    id,
    username: u.username,
    displayName: u.displayName,
    avatarUrl: avatar,
    verified: staff || pro,
    joinedAt: u.joinedAt,
    onSolana: idx.state === 'ACTIVE',
    solscan: `https://solscan.io/account/${id}`,
    record: { results: uniq.length, wins, losses, missed: uniq.filter(r => r.outcome === 'MISSED').length, winRate: wins + losses ? Math.round((wins / (wins + losses)) * 100) : null },
    recent: uniq.slice(0, 10).map(r => ({ symbol: r.symbol, timeframe: r.timeframe, direction: r.direction, outcome: r.outcome, tpsHit: r.tpsHit, closedAt: r.closedAt })),
  };
}

export function registerTraderIdRoutes(app: Express, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  // The signed-in trader's MarketX ID and its Solscan page
  app.get('/api/trader-id', limiter, requireAuth, async (_req: Request, res: Response) => {
    if (!isFirebaseConfigured()) return res.status(503).json({ error: 'UNAVAILABLE', message: 'Not available right now.' });
    try {
      const doc = await ensureTraderId((res.locals.user as any).uid);
      res.json({ id: doc.id, solscan: `https://solscan.io/account/${doc.id}`, onSolana: doc.state === 'ACTIVE' });
    } catch {
      res.status(503).json({ error: 'UNAVAILABLE', message: 'Your MarketX ID is unavailable right now. Try again shortly.' });
    }
  });

  // Public: who is behind a MarketX ID (the /checker page). 20 lookups a minute per IP.
  const perIp = createKeyedThrottle({ windowMs: 60_000, max: 20 });
  app.get('/api/checker/:id', limiter, async (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id)) return res.status(400).json({ error: 'BAD_ID', message: 'That does not look like a MarketX ID.' });
    if (perIp.hit(clientIp(req))) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many lookups. Please wait a minute.' });
    if (!isFirebaseConfigured()) return res.status(503).json({ error: 'UNAVAILABLE', message: 'The checker is unavailable right now.' });
    try {
      const profile = await publicProfile(id);
      if (!profile) return res.status(404).json({ error: 'NOT_FOUND', message: 'No MarketX trader has this ID.' });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ profile });
    } catch {
      res.status(503).json({ error: 'UNAVAILABLE', message: 'The checker is unavailable right now. Try again shortly.' });
    }
  });

  if (isFirebaseConfigured() && IS_LEAD_WORKER) setTimeout(() => indexExistingTraders().catch(err => console.warn('[MarketX ID] indexing failed:', err?.message || err)), 45_000).unref();
}
