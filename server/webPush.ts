import type { Express, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { db, isFirebaseConfigured } from './firebase';
import { getUser, requireAuth } from './account';
import { createKeyedThrottle } from './security';

// ---------------------------------------------------------------------------
// Web push (phone and desktop notifications, with the device's own sound, even when MarketX is closed).
// No SDK: VAPID (RFC 8292, ES256 JWT) and payload encryption (RFC 8291, aes128gcm) with Node's crypto.
//
// Keys: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (base64url, raw P-256) if set; otherwise a key pair is generated once
// and kept server-side in Firestore adminConfig/webPush, so it works with no setup and stays stable across deploys.
// Subscriptions live in pushSubs/{sha256(endpoint)} (uid, endpoint, keys). The server only ever POSTs to the browsers'
// own push services (allowlisted hosts), never to an arbitrary URL. Dead subscriptions (404/410/403) are removed.
// ---------------------------------------------------------------------------

const SUBS = 'pushSubs';
const MAX_SUBS_PER_USER = 8;
const SEND_TIMEOUT_MS = 10_000;
const b64u = (b: Buffer) => b.toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url');

/** Push services of Chrome/Edge/Android (FCM), Firefox, Safari/iOS and Windows */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function isPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && PUSH_HOSTS.some(r => r.test(u.hostname));
  } catch {
    return false;
  }
}

type Vapid = { publicKey: string; privateKey: crypto.KeyObject };
let vapid: Promise<Vapid | null> | null = null;

function keyFromRaw(pub: Buffer, d: Buffer): crypto.KeyObject {
  return crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)), d: b64u(d) }, format: 'jwk' });
}

/** Creates a fresh VAPID key pair as base64url raw keys */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

async function loadVapid(): Promise<Vapid | null> {
  const envPub = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPriv = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  if (envPub && envPriv) {
    try {
      return { publicKey: envPub, privateKey: keyFromRaw(unb64u(envPub), unb64u(envPriv)) };
    } catch {
      console.warn('[MarketX Push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not a valid P-256 pair; using the stored keys');
    }
  }
  if (!isFirebaseConfigured()) return null;
  const ref = db().collection('adminConfig').doc('webPush');
  const keys = await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const cur = snap.data() as { publicKey?: string; privateKey?: string } | undefined;
    if (cur?.publicKey && cur.privateKey) return cur as { publicKey: string; privateKey: string };
    const fresh = generateVapidKeys();
    tx.set(ref, { ...fresh, createdAt: Date.now() });
    return fresh;
  });
  return { publicKey: keys.publicKey, privateKey: keyFromRaw(unb64u(keys.publicKey), unb64u(keys.privateKey)) };
}

function getVapid(): Promise<Vapid | null> {
  if (!vapid) {
    vapid = loadVapid().catch(err => {
      console.warn('[MarketX Push] keys unavailable:', err?.message || err);
      vapid = null;
      return null;
    });
  }
  return vapid;
}

/** VAPID Authorization header for one push service origin (RFC 8292) */
export function vapidAuth(endpoint: string, v: Vapid, now = Date.now()): string {
  const subject = process.env.VAPID_SUBJECT || (process.env.SMTP_USER ? `mailto:${process.env.SMTP_USER}` : 'https://marketx.world');
  const head = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: v.privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.publicKey}`;
}

const hmac = (key: Buffer, data: Buffer) => crypto.createHmac('sha256', key).update(data).digest();

/** Encrypts a payload for one subscription (RFC 8291, aes128gcm, single record) */
export function encryptPayload(payload: Buffer, p256dh: string, auth: string): Buffer {
  const uaPublic = unb64u(p256dh);
  const authSecret = unb64u(auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('bad subscription keys');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]));
  const salt = crypto.randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(65, 20);
  return Buffer.concat([header, asPublic, body]);
}

type Sub = { uid: string; endpoint: string; keys: { p256dh: string; auth: string }; createdAt: number; lastOkAt?: number };
const subId = (endpoint: string) => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 40);

export type PushMessage = { title: string; body: string; url: string; tag?: string; kind?: 'watchlist' | 'alert' | 'test' };

/** Sends a notification to every device the trader turned push on; never throws */
export async function sendPush(uid: string, msg: PushMessage): Promise<number> {
  if (!isFirebaseConfigured()) return 0;
  try {
    const v = await getVapid();
    if (!v) return 0;
    const snap = await db().collection(SUBS).where('uid', '==', uid).get();
    if (snap.empty) return 0;
    const payload = Buffer.from(JSON.stringify({ title: msg.title.slice(0, 120), body: msg.body.slice(0, 300), url: msg.url, tag: msg.tag, kind: msg.kind }));
    let ok = 0;
    await Promise.all(
      snap.docs.map(async d => {
        const s = d.data() as Sub;
        if (!isPushEndpoint(s.endpoint)) return d.ref.delete().catch(() => {});
        try {
          const r = await fetch(s.endpoint, {
            method: 'POST',
            headers: {
              Authorization: vapidAuth(s.endpoint, v),
              'Content-Encoding': 'aes128gcm',
              'Content-Type': 'application/octet-stream',
              TTL: '3600',
              Urgency: 'high',
              ...(msg.tag ? { Topic: crypto.createHash('sha256').update(msg.tag).digest('base64url').slice(0, 32) } : {}),
            },
            body: encryptPayload(payload, s.keys.p256dh, s.keys.auth),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          });
          if (r.status === 404 || r.status === 410 || r.status === 403) await d.ref.delete().catch(() => {});
          else if (r.ok) {
            ok++;
            if (!s.lastOkAt || Date.now() - s.lastOkAt > 86400e3) d.ref.update({ lastOkAt: Date.now() }).catch(() => {});
          }
        } catch {}
      })
    );
    return ok;
  } catch (err: any) {
    console.warn('[MarketX Push] send failed:', err?.message || err);
    return 0;
  }
}

export function registerPushRoutes(app: Express, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  const throttle = createKeyedThrottle({ windowMs: 60_000, max: 20 });
  const testThrottle = createKeyedThrottle({ windowMs: 3600_000, max: 6 });
  const guard = (req: Request, res: Response, next: NextFunction) => {
    if (throttle.hit(getUser(res).uid)) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Please wait a minute.' });
    next();
  };
  const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) =>
    fn(req, res).catch(err => {
      console.error(`[MarketX Push] ${req.method} ${req.path} failed:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
    });

  app.get('/api/push/key', limiter, wrap(async (_req, res) => {
    const v = await getVapid();
    res.json({ enabled: !!v, publicKey: v?.publicKey || null });
  }));

  app.post('/api/push/subscribe', limiter, requireAuth, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const sub = req.body?.subscription;
    const endpoint = sub?.endpoint;
    const p256dh = sub?.keys?.p256dh;
    const auth = sub?.keys?.auth;
    if (!isPushEndpoint(endpoint)) return res.status(400).json({ error: 'BAD_SUBSCRIPTION', message: 'This browser’s notification service is not supported.' });
    const okKey = (k: unknown, n: number) => typeof k === 'string' && /^[A-Za-z0-9_-]+={0,2}$/.test(k) && unb64u(k).length === n;
    if (!okKey(p256dh, 65) || !(typeof auth === 'string' && unb64u(auth).length >= 16 && unb64u(auth).length <= 32)) {
      return res.status(400).json({ error: 'BAD_SUBSCRIPTION', message: 'The notification subscription is not valid.' });
    }
    // One device belongs to whoever is signed in on it now (a shared phone never gets the previous trader's notices)
    await db().collection(SUBS).doc(subId(endpoint)).set({ uid, endpoint, keys: { p256dh, auth }, createdAt: Date.now() });
    const mine = await db().collection(SUBS).where('uid', '==', uid).get();
    const extra = mine.docs.sort((a, b) => (b.data() as Sub).createdAt - (a.data() as Sub).createdAt).slice(MAX_SUBS_PER_USER);
    await Promise.all(extra.map(d => d.ref.delete().catch(() => {})));
    res.json({ ok: true });
  }));

  app.post('/api/push/unsubscribe', limiter, requireAuth, guard, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const endpoint = req.body?.endpoint;
    if (typeof endpoint === 'string' && endpoint.length <= 1000) {
      const ref = db().collection(SUBS).doc(subId(endpoint));
      const snap = await ref.get();
      if (snap.exists && (snap.data() as Sub).uid === uid) await ref.delete();
    }
    res.json({ ok: true });
  }));

  app.post('/api/push/test', limiter, requireAuth, wrap(async (_req, res) => {
    const { uid } = getUser(res);
    const wait = testThrottle.hit(uid);
    if (wait) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: `You can send another test in ${wait} min.` });
    const sent = await sendPush(uid, { title: '🔔 MarketX notifications are on', body: 'Watchlist setups and price alerts will reach this device, even when MarketX is closed.', url: '/', tag: 'mx-test', kind: 'test' });
    res.json({ ok: sent > 0, sent });
  }));
}
