// ===========================================================================
// MarketX ID: every trader (new and existing) has their own Solana address. It co-signs the readable result record of
// each of their trades, so searching the address on Solscan lists every trade they took on MarketX and its result.
//
// The address is derived, never stored: ed25519 seed = HMAC-SHA256(secret, "marketx-trader-id-v1:" + uid). The secret is
// TRADER_ID_SECRET if set, else generated once and kept in Firestore adminConfig/traderIds (never sent to any client).
// Changing the secret changes every ID, so it is set once and left alone. The ID holds no SOL and pays nothing: the
// proof wallet pays the fee. Nothing on chain says who the trader is; the ID is only linked to a person if they share it.
// ===========================================================================
import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { db, isFirebaseConfigured } from './firebase';
import { requireAuth } from './account';
import { base58Encode, type ProofWallet } from './solana';

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

export function registerTraderIdRoutes(app: Express, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  // The signed-in trader's MarketX ID and its Solscan page
  app.get('/api/trader-id', limiter, requireAuth, async (_req: Request, res: Response) => {
    if (!isFirebaseConfigured()) return res.status(503).json({ error: 'UNAVAILABLE', message: 'Not available right now.' });
    try {
      const id = await traderId((res.locals.user as any).uid);
      res.json({ id, solscan: `https://solscan.io/account/${id}` });
    } catch {
      res.status(503).json({ error: 'UNAVAILABLE', message: 'Your MarketX ID is unavailable right now. Try again shortly.' });
    }
  });
}
