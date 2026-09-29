import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db, isFirebaseConfigured } from './firebase';
import { hashPassword, signWithServerSecret, verifyPassword } from './session';
import { sendEmail } from './mailer';
import { perWorkerAtLeast } from './workers';
import { addNotification, invalidateAuthCache, siteLink, UserDoc, userRef, usernameRef } from './account';
import { deleteAccountData, setEmailBanned } from './auth';
import { passcodeReport } from './access';
import { approveSubmission, listSubmissions, rejectSubmission } from './campaigns';
import { dayKey, logActivity } from './tracking';
import { clientIp } from './security';

// ===========================================================================
// MarketX admin console API (/api/admin/*), served to the /admin page.
// - Its own password: the default below until a custom one is set (stored as a scrypt hash in
//   adminConfig/auth). "Reset to default" deletes the custom hash. If the custom password is ever
//   lost, deleting adminConfig/auth in the Firebase console restores the default.
// - Its own session: a short-lived, HMAC-signed, httpOnly, SameSite=Strict cookie scoped to /api/admin,
//   invalidated whenever the password changes or is reset.
// - Brute-force protection: per-IP lockout after repeated failures plus a global failure ceiling.
// ===========================================================================

const DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || '@MarketX.Adminaccess123';
const COOKIE = 'mx_admin';
const COOKIE_PATH = '/api/admin';
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const MIN_PASSWORD = 10;
const SUPPORT_EMAIL = 'help.marketx@gmail.com';

const authRef = () => db().collection('adminConfig').doc('auth');
const bannerRef = () => db().collection('siteConfig').doc('banner');
const broadcastImageRef = (id: string) => db().collection('broadcastImages').doc(id);

// Broadcast pictures: raster images only (no SVG, which can carry script), checked by their file signature.
// Two copies: a light display copy (at most 700 KB, one Firestore document) shown in notifications, the banner and
// embedded in emails, and the untouched original (up to 10 MB, split across 700 KB documents) opened on tap.
export const BROADCAST_IMAGE_MAX_BYTES = 700 * 1024;
export const BROADCAST_FULL_MAX_BYTES = 10 * 1024 * 1024;
const FULL_CHUNK_BYTES = 700 * 1024;
const fullChunkRef = (id: string, n: number) => db().collection('broadcastImages').doc(`${id}__full_${n}`);
const IMAGE_SIGNATURES: Array<[string, (b: Buffer) => boolean]> = [
  ['image/jpeg', b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/gif', b => b.subarray(0, 4).toString('latin1') === 'GIF8'],
  ['image/webp', b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];
export function parseBroadcastImage(raw: unknown, maxBytes = BROADCAST_IMAGE_MAX_BYTES): { data: Buffer; contentType: string } | { error: string } | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const m = typeof raw === 'string' ? /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(raw) : null;
  if (!m) return { error: 'The picture must be a JPG, PNG, GIF or WebP image.' };
  const data = Buffer.from(m[2], 'base64');
  if (!data.length) return { error: 'The picture is empty.' };
  if (data.length > maxBytes) return { error: `The picture is too large (${maxBytes >= 1024 * 1024 ? `${Math.round(maxBytes / 1048576)} MB` : `${Math.round(maxBytes / 1024)} KB`} max).` };
  const sig = IMAGE_SIGNATURES.find(([, test]) => test(data));
  if (!sig) return { error: 'That file is not a valid image.' };
  // Trust the bytes, not the label
  return { data, contentType: sig[0] };
}

interface AdminAuth {
  passwordHash?: string;
  custom?: boolean;
  version?: number;
  updatedAt?: number;
}

let defaultHash: Promise<string> | null = null;
const getDefaultHash = () => (defaultHash ||= hashPassword(DEFAULT_PASSWORD));

async function readAuth(): Promise<AdminAuth> {
  const snap = await authRef().get();
  return snap.exists ? (snap.data() as AdminAuth) : {};
}

// ---------------------------------------------------------------------------
// Session cookie
// ---------------------------------------------------------------------------
function makeToken(version: number): string | null {
  const exp = Date.now() + SESSION_TTL_MS;
  const nonce = crypto.randomBytes(9).toString('base64url');
  const sig = signWithServerSecret(`${exp}.${version}.${nonce}`);
  return sig ? `${exp}.${version}.${nonce}.${sig}` : null;
}

function readToken(req: Request): { exp: number; version: number } | null {
  const header = req.headers.cookie || '';
  const raw = header
    .split(';')
    .map(p => p.trim())
    .find(p => p.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [exp, version, nonce, sig] = decodeURIComponent(raw.slice(COOKIE.length + 1)).split('.');
  const expected = signWithServerSecret(`${exp}.${version}.${nonce}`);
  if (!expected || !sig || expected.length !== sig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  if (Number(exp) < Date.now()) return null;
  return { exp: Number(exp), version: Number(version) };
}

function setCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: COOKIE_PATH,
    maxAge: SESSION_TTL_MS,
  });
}

function clearCookie(res: Response) {
  res.clearCookie(COOKIE, { path: COOKIE_PATH, httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isFirebaseConfigured()) return res.status(503).json({ error: 'NOT_CONFIGURED', message: 'The database is not configured.' });
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'ADMIN_AUTH_REQUIRED', message: 'Admin sign-in required.' });
  try {
    const auth = await readAuth();
    if ((auth.version || 0) !== token.version) {
      clearCookie(res);
      return res.status(401).json({ error: 'ADMIN_SESSION_EXPIRED', message: 'Your admin session has ended. Sign in again.' });
    }
    next();
  } catch (err: any) {
    res.status(500).json({ error: 'SERVER_ERROR', message: 'Could not verify the admin session.' });
  }
}

// ---------------------------------------------------------------------------
// Brute-force protection
// ---------------------------------------------------------------------------
const failures = new Map<string, { count: number; until: number; first: number }>();
let globalFails: number[] = [];
const IP_MAX = perWorkerAtLeast(5);
const IP_LOCK_MS = 15 * 60 * 1000;
const GLOBAL_MAX = perWorkerAtLeast(25);


function lockState(ip: string): number {
  const now = Date.now();
  globalFails = globalFails.filter(t => now - t < IP_LOCK_MS);
  if (globalFails.length >= GLOBAL_MAX) return Math.ceil(IP_LOCK_MS / 60000);
  const rec = failures.get(ip);
  if (rec && rec.until > now) return Math.ceil((rec.until - now) / 60000);
  return 0;
}

function recordFailure(ip: string) {
  const now = Date.now();
  globalFails.push(now);
  const rec = failures.get(ip);
  if (!rec || now - rec.first > IP_LOCK_MS) {
    failures.set(ip, { count: 1, until: 0, first: now });
    return;
  }
  rec.count++;
  if (rec.count >= IP_MAX) rec.until = now + IP_LOCK_MS;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of failures) if (rec.until < now && now - rec.first > IP_LOCK_MS) failures.delete(ip);
}, IP_LOCK_MS).unref();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const wrap =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  (req: Request, res: Response) =>
    fn(req, res).catch(err => {
      console.error(`[MarketX Admin] ${req.method} ${req.path} failed:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
    });

async function allUsers(): Promise<UserDoc[]> {
  const snap = await db().collection('users').limit(5000).get();
  return snap.docs.map(d => ({ ...(d.data() as UserDoc), uid: (d.data() as UserDoc).uid || d.id }));
}

function lastDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(dayKey(Date.now() - i * 86400000));
  return out;
}

async function dailyDocs(days: string[]) {
  const snaps = await Promise.all(days.map(d => db().collection('usageDaily').doc(d).get()));
  return snaps.map((s, i) => {
    const d: any = s.exists ? s.data() : {};
    return {
      day: days[i],
      analyses: d.analyses || 0,
      chats: d.chats || 0,
      signups: d.signups || 0,
      signins: d.signins || 0,
      pairs: (d.pairs || {}) as Record<string, { name: string; count: number }>,
      users: (d.users || {}) as Record<string, number>,
    };
  });
}

function topPairs(rows: { pairs: Record<string, { name: string; count: number }> }[], limit = 10) {
  const agg: Record<string, { name: string; count: number }> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.pairs)) agg[k] = { name: v.name, count: (agg[k]?.count || 0) + v.count };
  return Object.values(agg)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function isProActive(u: UserDoc) {
  return !!u.subscription?.active && (!u.subscription.expiresAt || u.subscription.expiresAt > Date.now());
}

function publicUser(u: UserDoc) {
  return {
    uid: u.uid,
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    avatarUrl: u.avatarUrl || null,
    joinedAt: u.joinedAt,
    status: u.status || 'active',
    statusReason: u.statusReason || '',
    statusAt: u.statusAt || null,
    plan: isProActive(u) ? u.subscription.plan : 'free',
    proActive: isProActive(u),
    expiresAt: u.subscription?.expiresAt || 0,
    credits: u.credits?.available ?? 0,
    dailyRemaining: u.credits?.dailyRemaining ?? 0,
    dailyLimit: u.credits?.dailyLimit ?? 0,
    emailVerified: !!u.emailVerified,
    lastActiveAt: u.lastActiveAt || null,
    usageTotal: u.usageTotal || 0,
  };
}

async function findUser(target: string): Promise<UserDoc | null> {
  const t = String(target || '').trim().toLowerCase().replace(/^@/, '');
  if (!t) return null;
  if (t.includes('@')) {
    const cred = await db().collection('credentials').doc(t).get();
    const uid = cred.exists ? cred.data()?.uid : null;
    if (uid) {
      const snap = await userRef(uid).get();
      if (snap.exists) return snap.data() as UserDoc;
    }
    const q = await db().collection('users').where('email', '==', t).limit(1).get();
    return q.docs[0] ? (q.docs[0].data() as UserDoc) : null;
  }
  const name = await usernameRef(t).get();
  if (!name.exists) return null;
  const snap = await userRef(name.data()!.uid).get();
  return snap.exists ? (snap.data() as UserDoc) : null;
}

function adminLog(action: string, detail: Record<string, any>) {
  db()
    .collection('adminLog')
    .doc(`${Date.now()}-${crypto.randomBytes(3).toString('hex')}`)
    .set({ action, ...detail, at: Date.now() })
    .catch(() => {});
}

const supportCta = (subject: string) => ({
  label: `Contact ${SUPPORT_EMAIL}`,
  url: `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`,
});

// Moderation emails: clear, courteous, and pointing to support for the reason
function moderationEmail(action: 'suspend' | 'unsuspend' | 'ban' | 'unban' | 'delete', u: UserDoc) {
  const handle = u.username ? `@${u.username}` : u.email;
  const date = new Date().toUTCString().replace(' GMT', ' UTC');
  const contact = `If you would like to know why this action was taken, or you believe it was made in error, please email our support team at ${SUPPORT_EMAIL}. Include your username (${handle}) and we will review your account and respond as soon as possible.`;
  switch (action) {
    case 'suspend':
      return {
        subject: 'Your MarketX account has been suspended',
        lines: [
          `Hello ${u.displayName || handle},`,
          `We're writing to let you know that your MarketX account (${handle}) has been temporarily suspended, effective ${date}.`,
          'While your account is suspended you will not be able to sign in or use MarketX. Your data remains intact during this time.',
          contact,
        ],
        options: { cta: supportCta(`Account suspension: ${handle}`), note: 'This is an automated notice from the MarketX team.' },
      };
    case 'unsuspend':
    case 'unban':
      return {
        subject: 'Your MarketX account has been reinstated',
        lines: [
          `Hello ${u.displayName || handle},`,
          `Good news: your MarketX account (${handle}) has been reinstated and you can sign in and use MarketX again.`,
          `Thank you for your patience. If you have any questions, reach us any time at ${SUPPORT_EMAIL}.`,
        ],
        options: { cta: { label: 'Sign in to MarketX', url: (process.env.APP_URL || 'https://marketx.world').replace(/\/+$/, '') } },
      };
    case 'ban':
      return {
        subject: 'Your MarketX account has been banned',
        lines: [
          `Hello ${u.displayName || handle},`,
          `We're writing to inform you that your MarketX account (${handle}) has been banned, effective ${date}. You will no longer be able to sign in, and this email address cannot be used to create a new account.`,
          contact,
        ],
        options: { cta: supportCta(`Account ban: ${handle}`), note: 'This is an automated notice from the MarketX team.' },
      };
    case 'delete':
      return {
        subject: 'Your MarketX account has been deleted',
        lines: [
          `Hello ${u.displayName || handle},`,
          `We're writing to let you know that your MarketX account (${handle}) was deleted by the MarketX team on ${date}. Your profile, chat history, credits and notifications have been removed.`,
          contact,
        ],
        options: { cta: supportCta(`Account deletion: ${handle}`), note: 'This is an automated notice from the MarketX team.' },
      };
  }
}

// Sequential email queue so broadcasts never flood the SMTP account
const mailQueue: Array<() => Promise<unknown>> = [];
let mailRunning = false;
function queueMail(job: () => Promise<unknown>) {
  mailQueue.push(job);
  if (mailRunning) return;
  mailRunning = true;
  (async () => {
    while (mailQueue.length) {
      const next = mailQueue.shift()!;
      await next().catch(() => {});
      await new Promise(r => setTimeout(r, 350));
    }
    mailRunning = false;
  })();
}

// ===========================================================================
// Routes
// ===========================================================================
export function registerAdminRoutes(app: Express) {
  // Keep the console out of search engines and caches
  app.use(['/admin', '/api/admin'], (req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Public: the current site banner (if any)
  app.get('/api/site/banner', wrap(async (req, res) => {
    if (!isFirebaseConfigured()) return res.json({ banner: null });
    const snap = await bannerRef().get();
    const b: any = snap.exists ? snap.data() : null;
    const live = b && b.active && (!b.expiresAt || b.expiresAt > Date.now());
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.json({ banner: live ? { id: b.id, title: b.title, message: b.message, tone: b.tone, link: b.link || null, image: b.image || null } : null });
  }));

  const sendImage = (res: Response, contentType: string, data: Buffer, name: string) => {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${name}.${contentType.split('/')[1].replace('jpeg', 'jpg')}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(data);
  };
  const IMAGE_TYPE = /^image\/(jpeg|png|gif|webp)$/;

  // Public: the full, original picture (opened when someone taps it); falls back to the display copy
  app.get('/api/broadcast-image/:id/full', wrap(async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^bc-\d{10,15}-[0-9a-f]{6}$/.test(id) || !isFirebaseConfigured()) return res.status(404).end();
    const snap = await broadcastImageRef(id).get();
    const img: any = snap.exists ? snap.data() : null;
    if (!img) return res.status(404).end();
    const chunks = Math.min(20, Math.floor(Number(img.fullChunks) || 0));
    if (chunks > 0 && IMAGE_TYPE.test(img.fullContentType)) {
      const parts = await Promise.all(Array.from({ length: chunks }, (_, n) => fullChunkRef(id, n).get()));
      if (parts.every(p => p.exists && typeof (p.data() as any)?.data === 'string')) {
        return sendImage(res, img.fullContentType, Buffer.concat(parts.map(p => Buffer.from((p.data() as any).data, 'base64'))), `marketx-${id}`);
      }
    }
    if (typeof img.data !== 'string' || !IMAGE_TYPE.test(img.contentType)) return res.status(404).end();
    sendImage(res, img.contentType, Buffer.from(img.data, 'base64'), `marketx-${id}`);
  }));

  // Public: a broadcast picture (shown in notifications, the banner and email clients)
  app.get('/api/broadcast-image/:id', wrap(async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^bc-\d{10,15}-[0-9a-f]{6}$/.test(id) || !isFirebaseConfigured()) return res.status(404).end();
    const snap = await broadcastImageRef(id).get();
    const img: any = snap.exists ? snap.data() : null;
    if (!img || typeof img.data !== 'string' || !/^image\/(jpeg|png|gif|webp)$/.test(img.contentType)) return res.status(404).end();
    res.setHeader('Content-Type', img.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(Buffer.from(img.data, 'base64'));
  }));

  // --- Auth ---------------------------------------------------------------
  app.post('/api/admin/login', wrap(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isFirebaseConfigured()) return res.status(503).json({ error: 'NOT_CONFIGURED', message: 'The database is not configured.' });
    const ip = clientIp(req);
    const locked = lockState(ip);
    if (locked) return res.status(429).json({ error: 'LOCKED', message: `Too many attempts. Try again in ${locked} minutes.` });

    const password = String(req.body?.password || '');
    const auth = await readAuth();
    const hash = auth.passwordHash || (await getDefaultHash());
    const ok = password.length > 0 && (await verifyPassword(password, hash));
    if (!ok) {
      recordFailure(ip);
      console.warn(`[MarketX Admin] failed sign-in from ${ip}`);
      return res.status(401).json({ error: 'INVALID_PASSWORD', message: 'Incorrect admin password.' });
    }
    failures.delete(ip);
    const token = makeToken(auth.version || 0);
    if (!token) return res.status(503).json({ error: 'NOT_CONFIGURED', message: 'SESSION_SECRET is not configured.' });
    setCookie(res, token);
    adminLog('login', { ip });
    res.json({ success: true, custom: !!auth.custom });
  }));

  app.post('/api/admin/logout', (req, res) => {
    clearCookie(res);
    res.json({ success: true });
  });

  app.get('/api/admin/session', requireAdmin, wrap(async (req, res) => {
    const auth = await readAuth();
    res.json({ success: true, custom: !!auth.custom, updatedAt: auth.updatedAt || null });
  }));

  // Change to a custom password (requires the current one); signs out other admin sessions
  app.post('/api/admin/password', requireAdmin, wrap(async (req, res) => {
    const current = String(req.body?.current || '');
    const next = String(req.body?.next || '');
    const auth = await readAuth();
    if (!(await verifyPassword(current, auth.passwordHash || (await getDefaultHash())))) {
      return res.status(401).json({ error: 'INVALID_PASSWORD', message: 'Your current password is incorrect.' });
    }
    const strong = next.length >= MIN_PASSWORD && /[A-Za-z]/.test(next) && /\d/.test(next);
    if (!strong) {
      return res.status(400).json({ error: 'WEAK_PASSWORD', message: `Use at least ${MIN_PASSWORD} characters with letters and numbers.` });
    }
    const version = (auth.version || 0) + 1;
    await authRef().set({ passwordHash: await hashPassword(next), custom: true, version, updatedAt: Date.now() });
    setCookie(res, makeToken(version)!);
    adminLog('password_changed', { ip: clientIp(req) });
    res.json({ success: true, custom: true });
  }));

  // Reset to the default password; signs out other admin sessions
  app.post('/api/admin/password/reset', requireAdmin, wrap(async (req, res) => {
    if (String(req.body?.confirm || '') !== 'RESET') return res.status(400).json({ error: 'CONFIRM_REQUIRED', message: 'Type RESET to confirm.' });
    const auth = await readAuth();
    const version = (auth.version || 0) + 1;
    await authRef().set({ custom: false, version, updatedAt: Date.now() });
    setCookie(res, makeToken(version)!);
    adminLog('password_reset_default', { ip: clientIp(req) });
    res.json({ success: true, custom: false });
  }));

  // --- Overview -----------------------------------------------------------
  app.get('/api/admin/overview', requireAdmin, wrap(async (req, res) => {
    const now = Date.now();
    const [users, days, paySnap, codes, recentSnap] = await Promise.all([
      allUsers(),
      dailyDocs(lastDays(30)),
      db().collection('payments').limit(2000).get(),
      passcodeReport(),
      db().collection('activityLog').orderBy('ts', 'desc').limit(15).get(),
    ]);
    const sum = (rows: typeof days, f: 'analyses' | 'chats' | 'signups' | 'signins') => rows.reduce((a, r) => a + r[f], 0);
    const prompts = (rows: typeof days) => sum(rows, 'analyses') + sum(rows, 'chats');
    const payments = paySnap.docs.map(d => d.data() as any).filter(p => p.status === 'fulfilled');
    const revenueUsd = payments.reduce((a, p) => a + (Number(p.usdAmount) || 0), 0);
    const revenueUsd30 = payments.filter(p => (p.fulfilledAt || 0) > now - 30 * 86400000).reduce((a, p) => a + (Number(p.usdAmount) || 0), 0);

    res.json({
      users: {
        total: users.length,
        new7d: users.filter(u => u.joinedAt > now - 7 * 86400000).length,
        activeToday: users.filter(u => (u.lastActiveAt || 0) > now - 86400000).length,
        pro: users.filter(isProActive).length,
        suspended: users.filter(u => u.status === 'suspended').length,
        banned: users.filter(u => u.status === 'banned').length,
      },
      usage: {
        today: prompts(days.slice(-1)),
        week: prompts(days.slice(-7)),
        month: prompts(days),
        series: days.map(d => ({ day: d.day, prompts: d.analyses + d.chats, signups: d.signups })),
      },
      revenue: { totalUsd: Math.round(revenueUsd * 100) / 100, last30Usd: Math.round(revenueUsd30 * 100) / 100, payments: payments.length },
      passcodes: { batch: codes.batch, size: codes.size, redeemed: codes.redeemed, waiting: codes.waiting, available: codes.available, full: codes.full },
      topPairs: topPairs(days.slice(-7), 6),
      recent: recentSnap.docs.map(d => d.data()),
    });
  }));

  // --- Pass codes: live counts, codes waiting to be entered and recent redemptions ---
  app.get('/api/admin/passcodes', requireAdmin, wrap(async (req, res) => {
    res.json(await passcodeReport());
  }));

  // --- Users --------------------------------------------------------------
  app.get('/api/admin/users', requireAdmin, wrap(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase().replace(/^@/, '');
    const status = String(req.query.status || '');
    let list = (await allUsers()).map(publicUser);
    if (q) list = list.filter(u => [u.username, u.email, u.displayName].some(v => String(v || '').toLowerCase().includes(q)));
    if (status === 'pro') list = list.filter(u => u.proActive);
    else if (status) list = list.filter(u => u.status === status);
    list.sort((a, b) => (b.lastActiveAt || b.joinedAt || 0) - (a.lastActiveAt || a.joinedAt || 0));
    res.json({ users: list.slice(0, 500), total: list.length });
  }));

  app.get('/api/admin/users/:uid', requireAdmin, wrap(async (req, res) => {
    const uid = String(req.params.uid || '');
    if (!/^[\w-]{6,128}$/.test(uid)) return res.status(400).json({ error: 'INVALID' });
    const snap = await userRef(uid).get();
    if (!snap.exists) return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
    const u = snap.data() as UserDoc;
    const [usageSnap, actSnap, paySnap] = await Promise.all([
      userRef(uid).collection('meta').doc('usage').get(),
      userRef(uid).collection('activity').orderBy('ts', 'desc').limit(60).get(),
      db().collection('payments').where('uid', '==', uid).get(),
    ]);
    const usage: any = usageSnap.exists ? usageSnap.data() : { byDay: {}, pairs: {}, total: 0 };
    const byDay = usage.byDay || {};
    const count = (n: number) => lastDays(n).reduce((a, d) => a + (byDay[d] || 0), 0);
    const meta = (u as any).signupMeta;
    res.json({
      user: {
        ...publicUser(u),
        // Where the account was registered from (recorded by the sign-up guard)
        signup: meta ? { ip: meta.ip || null, userAgent: String(meta.userAgent || '').slice(0, 200), at: meta.at || null } : null,
      },
      usage: {
        today: count(1),
        week: count(7),
        month: count(30),
        total: usage.total || 0,
        analyses: usage.analyses || 0,
        chats: usage.chats || 0,
        series: lastDays(30).map(d => ({ day: d, prompts: byDay[d] || 0 })),
        topPairs: Object.values((usage.pairs || {}) as Record<string, { name: string; count: number }>)
          .sort((a, b) => b.count - a.count)
          .slice(0, 8),
      },
      activity: actSnap.docs.map(d => d.data()),
      payments: paySnap.docs
        .map(d => ({ reference: d.id, ...(d.data() as any) }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .map(p => ({ reference: p.reference, plan: p.plan, amount: p.amount / 100, currency: p.currency, usdAmount: p.usdAmount || null, status: p.status, createdAt: p.createdAt, channel: p.channel || null })),
    });
  }));

  // Suspend / unsuspend / ban / unban / delete, each followed by an email to the user
  app.post('/api/admin/users/:uid/action', requireAdmin, wrap(async (req, res) => {
    const uid = String(req.params.uid || '');
    const action = String(req.body?.action || '') as 'suspend' | 'unsuspend' | 'ban' | 'unban' | 'delete';
    const reason = String(req.body?.reason || '').slice(0, 500);
    if (!['suspend', 'unsuspend', 'ban', 'unban', 'delete'].includes(action)) return res.status(400).json({ error: 'INVALID_ACTION' });
    const snap = await userRef(uid).get();
    if (!snap.exists) return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
    const u = snap.data() as UserDoc;

    if (action === 'delete') {
      await deleteAccountData(uid, u.email);
    } else {
      const status = action === 'suspend' ? 'suspended' : action === 'ban' ? 'banned' : 'active';
      await userRef(uid).update({
        status,
        statusReason: status === 'active' ? '' : reason,
        statusAt: Date.now(),
        // Suspending or banning signs the user out everywhere
        ...(status !== 'active' ? { sessionVersion: FieldValue.increment(1) } : {}),
      });
      invalidateAuthCache(uid);
      if (action === 'ban') await setEmailBanned(u.email, true);
      if (action === 'unban') await setEmailBanned(u.email, false);
      logActivity(uid, { type: 'admin', title: `Account ${status === 'active' ? 'reinstated' : status} by admin`, detail: reason }, u.username);
    }
    const mail = moderationEmail(action, u);
    const sent = await sendEmail(u.email, mail.subject, mail.lines, mail.options);
    adminLog(`user_${action}`, { uid, email: u.email, username: u.username, reason });
    res.json({ success: true, emailed: sent !== false });
  }));

  // --- Usage analytics ----------------------------------------------------
  app.get('/api/admin/usage', requireAdmin, wrap(async (req, res) => {
    const days = await dailyDocs(lastDays(30));
    const sum = (rows: typeof days) => rows.reduce((a, r) => a + r.analyses + r.chats, 0);
    const userTotals: Record<string, number> = {};
    for (const r of days) for (const [uid, n] of Object.entries(r.users)) userTotals[uid] = (userTotals[uid] || 0) + n;
    const top = Object.entries(userTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    const snaps = await Promise.all(top.map(([uid]) => userRef(uid).get()));
    res.json({
      totals: {
        today: sum(days.slice(-1)),
        week: sum(days.slice(-7)),
        month: sum(days),
        analysesMonth: days.reduce((a, r) => a + r.analyses, 0),
        chatsMonth: days.reduce((a, r) => a + r.chats, 0),
        signupsMonth: days.reduce((a, r) => a + r.signups, 0),
        signinsMonth: days.reduce((a, r) => a + r.signins, 0),
        activeUsersMonth: Object.keys(userTotals).length,
      },
      series: days.map(d => ({ day: d.day, prompts: d.analyses + d.chats, analyses: d.analyses, chats: d.chats })),
      topPairs: { day: topPairs(days.slice(-1)), week: topPairs(days.slice(-7)), month: topPairs(days) },
      topUsers: top.map(([uid, n], i) => {
        const u = snaps[i].exists ? (snaps[i].data() as UserDoc) : null;
        return { uid, username: u?.username || '(deleted)', email: u?.email || '', prompts: n };
      }),
    });
  }));

  // --- Subscriptions & revenue --------------------------------------------
  app.get('/api/admin/subscriptions', requireAdmin, wrap(async (req, res) => {
    const now = Date.now();
    const [users, paySnap] = await Promise.all([allUsers(), db().collection('payments').limit(3000).get()]);
    const byUid = new Map(users.map(u => [u.uid, u]));
    const payments = paySnap.docs
      .map(d => ({ reference: d.id, ...(d.data() as any) }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const fulfilled = payments.filter(p => p.status === 'fulfilled');
    const byCurrency: Record<string, number> = {};
    for (const p of fulfilled) byCurrency[p.currency] = (byCurrency[p.currency] || 0) + p.amount / 100;
    const within = (ms: number) => fulfilled.filter(p => (p.fulfilledAt || p.createdAt || 0) > now - ms);
    const usd = (rows: any[]) => Math.round(rows.reduce((a, p) => a + (Number(p.usdAmount) || 0), 0) * 100) / 100;
    const active = users.filter(isProActive);
    res.json({
      summary: {
        activeSubscribers: active.length,
        monthly: active.filter(u => u.subscription.plan === 'monthly').length,
        yearly: active.filter(u => u.subscription.plan === 'yearly').length,
        expiringSoon: active.filter(u => u.subscription.expiresAt && u.subscription.expiresAt - now < 7 * 86400000).length,
        revenueUsdTotal: usd(fulfilled),
        revenueUsd30d: usd(within(30 * 86400000)),
        revenueUsd7d: usd(within(7 * 86400000)),
        byCurrency,
        paymentsCount: fulfilled.length,
      },
      subscribers: active
        .map(u => ({ uid: u.uid, username: u.username, email: u.email, plan: u.subscription.plan, startDate: u.subscription.startDate, expiresAt: u.subscription.expiresAt, price: u.subscription.price }))
        .sort((a, b) => (a.expiresAt || 0) - (b.expiresAt || 0)),
      payments: payments.slice(0, 300).map(p => {
        const u = byUid.get(p.uid);
        return {
          reference: p.reference,
          username: u?.username || null,
          email: p.email,
          plan: p.plan,
          amount: p.amount / 100,
          currency: p.currency,
          usdAmount: p.usdAmount || null,
          status: p.status,
          channel: p.channel || null,
          createdAt: p.createdAt,
        };
      }),
    });
  }));

  // --- X campaign participants -------------------------------------------
  app.get('/api/admin/campaign', requireAdmin, wrap(async (req, res) => {
    const now = Date.now();
    const users = await allUsers();
    const safeLink = (u: unknown) => (typeof u === 'string' && /^https:\/\/(x|twitter)\.com\/[^\s<>"']+$/i.test(u) ? u : null);
    const participants = users
      .filter(u => !!u.xShareReward)
      .map(u => {
        const r = u.xShareReward!;
        const status = r.previouslyClaimed ? 'duplicate' : r.status === 'credited' ? 'credited' : now >= r.unlockAt ? 'ready' : 'pending';
        return {
          uid: u.uid,
          username: u.username,
          email: u.email,
          joinedAt: r.sharedAt || null,
          unlockAt: r.unlockAt || null,
          status,
          creditsAwarded: r.previouslyClaimed ? 0 : Number(r.creditsAwarded) || 0,
          campaignCreditsLeft: Math.max(0, Math.min(u.credits?.campaign ?? 0, u.credits?.available ?? 0)),
          tweetUrl: safeLink(r.tweetUrl),
          accountStatus: u.status || 'active',
        };
      })
      .sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0));
    const credited = participants.filter(p => p.status === 'credited');
    res.json({
      summary: {
        participants: participants.length,
        credited: credited.length,
        pending: participants.filter(p => p.status === 'pending' || p.status === 'ready').length,
        duplicates: participants.filter(p => p.status === 'duplicate').length,
        creditsAwarded: credited.reduce((a, p) => a + p.creditsAwarded, 0),
        creditsUnused: credited.reduce((a, p) => a + p.campaignCreditsLeft, 0),
        joined7d: participants.filter(p => (p.joinedAt || 0) > now - 7 * 86400000).length,
      },
      participants,
    });
  }));

  // --- Explain MarketX campaign: review submitted posts, approve (50 credits) or decline ---
  app.get('/api/admin/campaign/submissions', requireAdmin, wrap(async (req, res) => {
    res.json(await listSubmissions());
  }));
  app.post('/api/admin/campaign/submissions/:id/approve', requireAdmin, wrap(async (req, res) => {
    const r = await approveSubmission(String(req.params.id || '').slice(0, 200));
    if ('error' in r) return res.status(r.status).json({ error: r.error, message: r.message });
    adminLog('campaign_approved', { id: r.submission.id, user: r.submission.username, credits: r.submission.creditsAwarded });
    res.json({ success: true });
  }));
  app.post('/api/admin/campaign/submissions/:id/reject', requireAdmin, wrap(async (req, res) => {
    const r = await rejectSubmission(String(req.params.id || '').slice(0, 200), String(req.body?.reason || ''));
    if ('error' in r) return res.status(r.status).json({ error: r.error, message: r.message });
    adminLog('campaign_rejected', { id: r.submission.id, user: r.submission.username });
    res.json({ success: true });
  }));

  // --- Broadcasts ---------------------------------------------------------
  app.post('/api/admin/broadcast', requireAdmin, wrap(async (req, res) => {
    const mode = String(req.body?.mode || '') as 'banner' | 'general' | 'individual';
    const title = String(req.body?.title || '').trim().slice(0, 120);
    const message = String(req.body?.message || '').trim().slice(0, 3000);
    const sendMail = req.body?.email !== false;
    if (!['banner', 'general', 'individual'].includes(mode)) return res.status(400).json({ error: 'INVALID_MODE', message: 'Choose a notice type.' });
    if (!title || !message) return res.status(400).json({ error: 'INVALID', message: 'Add a title and a message.' });

    const id = `bc-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    const lines = message.split(/\n{2,}/).map(l => l.trim()).filter(Boolean);
    // Optional call-to-action link, https only
    const rawLink = String(req.body?.link || '').trim();
    const link = /^https:\/\/[^\s<>"']+$/i.test(rawLink) ? rawLink.slice(0, 300) : null;
    // Optional picture: stored once, then shown in the notification, the banner and the email
    const parsed = parseBroadcastImage(req.body?.image);
    if (parsed && 'error' in parsed) return res.status(400).json({ error: 'INVALID_IMAGE', message: parsed.error });
    const picture = parsed as { data: Buffer; contentType: string } | null;
    // The untouched original, opened in full when tapped (optional; the display copy stands in without it)
    const parsedFull = picture ? parseBroadcastImage(req.body?.imageFull, BROADCAST_FULL_MAX_BYTES) : null;
    if (parsedFull && 'error' in parsedFull) return res.status(400).json({ error: 'INVALID_IMAGE', message: parsedFull.error });
    const full = parsedFull as { data: Buffer; contentType: string } | null;
    let image: string | null = null;
    if (picture) {
      const fullChunks = full ? Math.ceil(full.data.length / FULL_CHUNK_BYTES) : 0;
      for (let n = 0; n < fullChunks; n++) {
        await fullChunkRef(id, n).set({ id, n, data: full!.data.subarray(n * FULL_CHUNK_BYTES, (n + 1) * FULL_CHUNK_BYTES).toString('base64') });
      }
      await broadcastImageRef(id).set({
        id,
        contentType: picture.contentType,
        data: picture.data.toString('base64'),
        bytes: picture.data.length,
        ...(full ? { fullContentType: full.contentType, fullBytes: full.data.length, fullChunks } : {}),
        createdAt: Date.now(),
      });
      image = `/api/broadcast-image/${id}`;
    }
    const mailImage = picture ? { data: picture.data, contentType: picture.contentType, alt: title, href: siteLink(`/api/broadcast-image/${id}/full`) } : undefined;

    if (mode === 'banner') {
      const tone = ['info', 'success', 'warning'].includes(req.body?.tone) ? req.body.tone : 'info';
      const hours = Math.max(0, Math.min(24 * 90, Number(req.body?.durationHours) || 0));
      await bannerRef().set({ id, title, message: message.slice(0, 280), tone, link, image, active: true, createdAt: Date.now(), expiresAt: hours ? Date.now() + hours * 3600000 : null });
      await db().collection('broadcasts').doc(id).set({ id, mode, title, message, tone, image, recipients: 'site', sentAt: Date.now() });
      adminLog('banner_set', { id, title });
      return res.json({ success: true, recipients: 0 });
    }

    let targets: UserDoc[];
    if (mode === 'individual') {
      const u = await findUser(String(req.body?.target || ''));
      if (!u) return res.status(404).json({ error: 'NOT_FOUND', message: 'No user found with that username or email.' });
      targets = [u];
    } else {
      targets = (await allUsers()).filter(u => u.status !== 'banned');
    }

    // Fan out in chunks so a broadcast to thousands of users never floods the database with writes at once
    for (let i = 0; i < targets.length; i += 100) {
      await Promise.all(
        targets
          .slice(i, i + 100)
          .map(u => addNotification(u.uid, { type: 'announcement', title, message, ...(link ? { link } : {}), ...(image ? { image } : {}) }).catch(() => {}))
      );
    }
    if (sendMail) {
      for (const u of targets) {
        queueMail(() =>
          sendEmail(u.email, title, [`Hello ${u.displayName || `@${u.username}`},`, ...lines], {
            note: 'You are receiving this message because you have a MarketX account.',
            priority: 'bulk',
            ...(link ? { cta: { label: 'Learn more', url: link } } : {}),
            ...(mailImage ? { image: mailImage } : {}),
          })
        );
      }
    }
    await db()
      .collection('broadcasts')
      .doc(id)
      .set({
        id,
        mode,
        title,
        message,
        email: sendMail,
        link,
        image,
        recipients: targets.length,
        target: mode === 'individual' ? `@${targets[0].username} (${targets[0].email})` : 'all users',
        sentAt: Date.now(),
      });
    adminLog(`broadcast_${mode}`, { id, title, recipients: targets.length });
    res.json({ success: true, recipients: targets.length, emailsQueued: sendMail ? targets.length : 0 });
  }));

  app.get('/api/admin/broadcasts', requireAdmin, wrap(async (req, res) => {
    const [snap, banner] = await Promise.all([db().collection('broadcasts').orderBy('sentAt', 'desc').limit(30).get(), bannerRef().get()]);
    const b: any = banner.exists ? banner.data() : null;
    res.json({
      broadcasts: snap.docs.map(d => d.data()),
      banner: b && b.active && (!b.expiresAt || b.expiresAt > Date.now()) ? b : null,
    });
  }));

  app.delete('/api/admin/banner', requireAdmin, wrap(async (req, res) => {
    await bannerRef().set({ active: false, clearedAt: Date.now() }, { merge: true });
    adminLog('banner_cleared', {});
    res.json({ success: true });
  }));
}
