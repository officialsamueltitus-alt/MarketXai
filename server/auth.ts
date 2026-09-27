import crypto from 'crypto';
import type { Express, Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { FieldValue } from 'firebase-admin/firestore';
import { db, isFirebaseConfigured } from './firebase';
import { sendEmail } from './mailer';
import {
  AuthedUser,
  UserDoc,
  createUserIfMissing,
  readAccountState,
  requireAuth,
  getUser,
  userRef,
} from './account';
import {
  clearSessionCookie,
  hashPassword,
  hashToken,
  isSessionConfigured,
  newOneTimeToken,
  setSessionCookie,
  verifyPassword,
} from './session';

// Own authentication (no Firebase Auth). Firestore is only the store:
//   credentials/{emailLower} -> { uid, passwordHash?, googleSub? }   (server-only, never sent to clients)
//   authTokens/{sha256(token)} -> { uid, type: 'verify' | 'reset', expiresAt }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD = 8;
const VERIFY_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

const credentialsRef = (email: string) => db().collection('credentials').doc(email.toLowerCase());
const tokenRef = (hash: string) => db().collection('authTokens').doc(hash);

let googleClient: OAuth2Client | null = null;
export function getGoogleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID || '';
}

export function isAuthConfigured(): boolean {
  return isFirebaseConfigured() && isSessionConfigured();
}

function siteUrl(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0];
  return `${proto}://${req.get('host')}`;
}

// Stricter per-IP limiter for credential endpoints (brute-force protection)
const authAttempts = new Map<string, { count: number; resetAt: number }>();
function authLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
  const now = Date.now();
  const rec = authAttempts.get(ip);
  if (!rec || now > rec.resetAt) {
    authAttempts.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return next();
  }
  rec.count++;
  if (rec.count > 30) {
    return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many attempts. Please wait a few minutes and try again.' });
  }
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of authAttempts) if (now > rec.resetAt) authAttempts.delete(ip);
}, 10 * 60 * 1000).unref();

function requireConfigured(req: Request, res: Response, next: NextFunction) {
  if (!isAuthConfigured()) {
    return res.status(503).json({ error: 'AUTH_NOT_CONFIGURED', message: 'Accounts are not configured on this server yet.' });
  }
  next();
}

// Accounts created before this auth system (Firebase Auth era) are adopted by email
async function findLegacyUid(email: string): Promise<string | null> {
  const snap = await db().collection('users').where('email', '==', email).limit(1).get();
  return snap.docs[0]?.id || null;
}

async function signIn(res: Response, uid: string) {
  const snap = await userRef(uid).get();
  const doc = snap.data() as UserDoc;
  setSessionCookie(res, uid, doc.sessionVersion || 0);
  const user: AuthedUser = { uid, email: doc.email, emailVerified: !!doc.emailVerified };
  return readAccountState(user);
}

async function sendVerificationEmail(req: Request, uid: string, email: string) {
  const { token, hash } = newOneTimeToken();
  await tokenRef(hash).set({ uid, email, type: 'verify', expiresAt: Date.now() + VERIFY_TTL_MS });
  const link = `${siteUrl(req)}/api/auth/verify-email?token=${token}`;
  await sendEmail(email, 'Verify your MarketX email', [
    'Welcome to MarketX! Please confirm your email address to secure your account:',
    link,
    'This link expires in 3 days.',
  ]);
}

export function registerAuthRoutes(app: Express) {
  const wrap =
    (fn: (req: Request, res: Response) => Promise<any>) =>
    (req: Request, res: Response) =>
      fn(req, res).catch(err => {
        console.error(`[MarketX Auth] ${req.method} ${req.path} failed:`, err?.message || err);
        if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
      });

  app.post('/api/auth/signup', authLimiter, requireConfigured, wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const username = typeof req.body?.username === 'string' ? req.body.username : undefined;
    const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName : undefined;

    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'INVALID_EMAIL', message: 'Please enter a valid email address.' });
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: 'WEAK_PASSWORD', message: `Password must be at least ${MIN_PASSWORD} characters.` });
    }

    const passwordHash = await hashPassword(password);
    const legacyUid = await findLegacyUid(email);
    const uid = legacyUid || crypto.randomUUID();

    const created = await db().runTransaction(async tx => {
      const cred = await tx.get(credentialsRef(email));
      if (cred.exists) return false;
      tx.set(credentialsRef(email), { uid, passwordHash, createdAt: Date.now() });
      return true;
    });
    if (!created) {
      return res.status(409).json({ error: 'EMAIL_TAKEN', message: 'An account with this email already exists. Sign in instead.' });
    }

    await createUserIfMissing({ uid, email, emailVerified: false }, username, displayName);
    sendVerificationEmail(req, uid, email).catch(err => console.warn('[MarketX Auth] Verification email failed:', err?.message));
    res.json({ success: true, ...(await signIn(res, uid)) });
  }));

  app.post('/api/auth/login', authLimiter, requireConfigured, wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const cred = EMAIL_RE.test(email) ? await credentialsRef(email).get() : null;
    const data = cred?.exists ? cred.data()! : null;

    if (data && !data.passwordHash && data.googleSub) {
      return res.status(400).json({ error: 'USE_GOOGLE', message: 'This account uses Google sign-in. Continue with Google, or reset your password to add one.' });
    }
    // Always run a hash comparison so response time doesn't reveal whether the email exists
    const ok = await verifyPassword(password, data?.passwordHash || 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
    if (!data || !ok) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' });
    }
    await createUserIfMissing({ uid: data.uid, email, emailVerified: false });
    res.json({ success: true, ...(await signIn(res, data.uid)) });
  }));

  // Google Identity Services: the browser sends Google's ID token; we verify it ourselves
  app.post('/api/auth/google', authLimiter, requireConfigured, wrap(async (req, res) => {
    const clientId = getGoogleClientId();
    if (!clientId) return res.status(503).json({ error: 'GOOGLE_NOT_CONFIGURED', message: 'Google sign-in is not available yet.' });
    const credential = String(req.body?.credential || '');
    googleClient ||= new OAuth2Client(clientId);

    let payload: any;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: 'GOOGLE_INVALID', message: 'Google sign-in failed. Please try again.' });
    }
    const email = String(payload?.email || '').toLowerCase();
    if (!email || !payload?.email_verified) {
      return res.status(401).json({ error: 'GOOGLE_UNVERIFIED', message: 'Your Google account email is not verified.' });
    }

    const legacyUid = await findLegacyUid(email);
    const uid = await db().runTransaction(async tx => {
      const cred = await tx.get(credentialsRef(email));
      if (cred.exists) {
        const data = cred.data()!;
        if (!data.googleSub) tx.update(credentialsRef(email), { googleSub: payload.sub });
        return data.uid as string;
      }
      const newUid = legacyUid || crypto.randomUUID();
      tx.set(credentialsRef(email), { uid: newUid, googleSub: payload.sub, createdAt: Date.now() });
      return newUid;
    });

    await createUserIfMissing({ uid, email, emailVerified: true, name: payload.name, picture: payload.picture });
    // Google proves ownership of the address
    await userRef(uid).update({ emailVerified: true });
    res.json({ success: true, ...(await signIn(res, uid)) });
  }));

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(res);
    res.json({ success: true });
  });

  app.post('/api/auth/forgot-password', authLimiter, requireConfigured, wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    // Same response whether or not the account exists
    res.json({ success: true, message: 'If an account exists for that email, a reset link has been sent.' });
    if (!EMAIL_RE.test(email)) return;
    const cred = await credentialsRef(email).get();
    if (!cred.exists) return;
    const { token, hash } = newOneTimeToken();
    await tokenRef(hash).set({ uid: cred.data()!.uid, email, type: 'reset', expiresAt: Date.now() + RESET_TTL_MS });
    await sendEmail(email, 'Reset your MarketX password', [
      'We received a request to reset your MarketX password. Open this link to choose a new one:',
      `${siteUrl(req)}/?reset=${token}`,
      "This link expires in 1 hour. If you didn't request it, you can ignore this email.",
    ]);
  }));

  app.post('/api/auth/reset-password', authLimiter, requireConfigured, wrap(async (req, res) => {
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: 'WEAK_PASSWORD', message: `Password must be at least ${MIN_PASSWORD} characters.` });
    }
    const passwordHash = await hashPassword(password);
    const uid = await db().runTransaction(async tx => {
      const ref = tokenRef(hashToken(token));
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data()! : null;
      if (!data || data.type !== 'reset' || data.expiresAt < Date.now()) return null;
      tx.delete(ref);
      tx.set(credentialsRef(data.email), { passwordHash }, { merge: true });
      // Resetting via email also proves ownership; sign out every other session
      tx.update(userRef(data.uid), { sessionVersion: FieldValue.increment(1), emailVerified: true });
      return data.uid as string;
    });
    if (!uid) return res.status(400).json({ error: 'INVALID_TOKEN', message: 'This reset link is invalid or has expired. Request a new one.' });
    res.json({ success: true, ...(await signIn(res, uid)) });
  }));

  app.get('/api/auth/verify-email', wrap(async (req, res) => {
    const token = String(req.query.token || '');
    if (!isAuthConfigured() || !token) return res.redirect('/?verified=0');
    const ok = await db().runTransaction(async tx => {
      const ref = tokenRef(hashToken(token));
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data()! : null;
      if (!data || data.type !== 'verify' || data.expiresAt < Date.now()) return false;
      tx.delete(ref);
      tx.update(userRef(data.uid), { emailVerified: true });
      return true;
    });
    res.redirect(ok ? '/?verified=1' : '/?verified=0');
  }));

  app.post('/api/auth/resend-verification', authLimiter, requireAuth, wrap(async (req, res) => {
    const user = getUser(res);
    if (user.emailVerified) return res.json({ success: true, message: 'Your email is already verified.' });
    await sendVerificationEmail(req, user.uid, user.email);
    res.json({ success: true, message: `Verification email sent to ${user.email}.` });
  }));
}
