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
  notifyActivity,
  describeRequest,
  addNotification,
  isUnlimitedEmail,
  blockedStatusMessage,
} from './account';
import { bumpDaily, logActivity, touchUser } from './tracking';
import { readDeviceSignals, reserveSignup, releasePendingSignup, activateSignup, keysOf, signupMetaOf, canonicalEmail, type DeviceSignals } from './signupGuard';
import { clientIp, createKeyedThrottle } from './security';
import {
  batchFullMessage,
  checkPasscode,
  consumePasscodeInTx,
  createPendingSignup,
  isPendingExpired,
  PASSCODE_TTL_HOURS,
  PendingSignup,
  pendingRef,
  releaseExpiredPasscodes,
  sendPasscodeOnce,
} from './access';
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

// Links in emails never come from the request's Host header (that would allow reset-link poisoning)
function siteUrl(req: Request): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production') return 'https://marketx.world';
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0];
  return `${proto}://${req.get('host')}`;
}

// Stricter per-IP limiter for credential endpoints (brute-force protection)
const authAttempts = new Map<string, { count: number; resetAt: number }>();
function authLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = clientIp(req);
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

// Per-email limits that hold even when an attacker rotates IP addresses
const loginFailures = createKeyedThrottle({ windowMs: 15 * 60 * 1000, max: 10 });
const resetEmails = createKeyedThrottle({ windowMs: 60 * 60 * 1000, max: 3 });
const verifyEmails = createKeyedThrottle({ windowMs: 60 * 60 * 1000, max: 3 });

const TERMS_REQUIRED = {
  error: 'TERMS_REQUIRED',
  message: 'Please tick the box to accept the MarketX Terms of Service and Privacy Policy to continue.',
};
const acceptedTerms = (req: Request) => req.body?.acceptTerms === true;

const GOOGLE_NOT_REGISTERED = {
  error: 'GOOGLE_NOT_REGISTERED',
  message: 'This email was registered with an email and password, not Google. Sign in with your email and password instead.',
};

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

// Suspended/banned accounts can't sign in (checked before a session is issued)
async function blockedFor(uid: string) {
  const snap = await userRef(uid).get();
  return snap.exists ? blockedStatusMessage((snap.data() as UserDoc).status) : null;
}

// Emails banned from the console can't create a new account
const bannedRef = (email: string) => db().collection('bannedEmails').doc(email.toLowerCase());
async function isBannedEmail(email: string): Promise<boolean> {
  return (await bannedRef(email).get()).exists;
}
const BANNED_SIGNUP = {
  error: 'EMAIL_BANNED',
  message: 'This email cannot be used to create a MarketX account. Contact help.marketx@gmail.com for more information.',
};

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
  await sendEmail(
    email,
    'Welcome to MarketX: confirm your email',
    [
      'Welcome to MarketX! Your account is ready, with free AI market analyses every day.',
      'Please confirm your email address to secure your account and unlock everything.',
    ],
    { cta: { label: 'Confirm my email', url: link }, note: `This link expires in 3 days. If the button doesn't work, open: ${link}` }
  );
}

async function sendWelcomeEmail(req: Request, email: string) {
  await sendEmail(
    email,
    'Welcome to MarketX',
    [
      'Your MarketX account is ready. Ask about any market (forex, gold, crypto, stocks or synthetic indices) and get a full trade plan with entry, stop loss and targets.',
      'Tip: attach a chart screenshot and MarketX will read it for you.',
    ],
    { cta: { label: 'Start analysing', url: siteUrl(req) } }
  );
}

// Security alert on every sign-in (site notification + email)
function signInAlert(req: Request, uid: string, method: string) {
  const { device, ip, when } = describeRequest(req);
  logActivity(uid, { type: 'signin', title: `Signed in with ${method}`, detail: `${device} · ${ip}` });
  bumpDaily('signins');
  touchUser(uid);
  notifyActivity(
    uid,
    { type: 'security', title: 'New sign-in to your account', message: `${device} · ${method} · ${ip}` },
    {
      subject: 'New sign-in to your MarketX account',
      lines: ['Your MarketX account was just signed in to.'],
      options: {
        rows: [
          ['Device', device],
          ['Method', method],
          ['IP address', ip],
          ['Time', when],
        ],
        note: "If this was you, there's nothing to do. If not, reset your password right away from the sign-in screen.",
      },
      security: true,
    }
  );
}

// Emails the one-time pass code (only ever once per sign-up)
function deliverPasscode(req: Request, email: string) {
  return sendPasscodeOnce(email, code =>
    sendEmail(
      email,
      'Your MarketX access pass code',
      [
        'Welcome to MarketX. A seat has been reserved for you, and this is your personal, one-time pass code:',
        'Enter it on the pass code page to finish creating your account.',
      ],
      {
        code,
        cta: { label: 'Enter my pass code', url: `${siteUrl(req)}/access?email=${encodeURIComponent(email)}` },
        note: `This code is unique to you and works only once, so keep it private. It expires in ${PASSCODE_TTL_HOURS} hours; after that your reserved seat is released to the next person in line. If you did not sign up for MarketX, you can ignore this email.`,
      }
    )
  ).catch(err => {
    console.warn('[MarketX Access] pass code email failed:', err?.message || err);
    return false;
  });
}

function pendingResponse(res: Response, email: string, alreadySent: boolean) {
  return res.json({
    success: true,
    pending: true,
    email,
    message: alreadySent
      ? `Your pass code was already sent to ${email}. Enter it to finish creating your account.`
      : `We've sent your one-time pass code to ${email}. Enter it to finish creating your account.`,
  });
}

/** Removes an account and its data (used by self-service deletion and the admin console). */
export async function deleteAccountData(uid: string, email: string): Promise<UserDoc | null> {
  const snap = await userRef(uid).get();
  const doc = snap.exists ? (snap.data() as UserDoc) : null;
  // Log first: the global feed entry survives, the per-user copy is removed with the account
  await logActivity(uid, { type: 'deleted', title: 'Account deleted', detail: email }, doc?.username);
  await db().recursiveDelete(userRef(uid));
  await userRef(uid).delete(); // no-op if already removed
  if (doc?.usernameLower) {
    const nameRef = db().collection('usernames').doc(doc.usernameLower);
    const nameSnap = await nameRef.get();
    if (nameSnap.exists && nameSnap.data()?.uid === uid) await nameRef.delete();
  }
  const credSnap = await credentialsRef(email).get();
  if (credSnap.exists && credSnap.data()?.uid === uid) await credentialsRef(email).delete();
  const tokens = await db().collection('authTokens').where('uid', '==', uid).get();
  await Promise.all(tokens.docs.map(d => d.ref.delete()));
  return doc;
}

/** Bans or unbans an email address from creating new accounts. */
export async function setEmailBanned(email: string, banned: boolean) {
  if (banned) await bannedRef(email).set({ email: email.toLowerCase(), at: Date.now() });
  else await bannedRef(email).delete();
}

export function registerAuthRoutes(app: Express) {
  // Unused pass codes expire after 48 hours; sweep hourly so their seats return to the batch
  if (isAuthConfigured()) {
    const sweep = () => releaseExpiredPasscodes().catch(err => console.warn('[MarketX Access] expiry sweep failed:', err?.message || err));
    setTimeout(sweep, 30 * 1000).unref();
    setInterval(sweep, 60 * 60 * 1000).unref();
  }
  const wrap =
    (fn: (req: Request, res: Response) => Promise<any>) =>
    (req: Request, res: Response) =>
      fn(req, res).catch(err => {
        console.error(`[MarketX Auth] ${req.method} ${req.path} failed:`, err?.message || err);
        if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
      });

  // --- Sign-up abuse guard: one device, one email, one IP (see server/signupGuard.ts) ---
  const canonicalRef = (canon: string) => db().collection('canonicalEmails').doc(canon);
  const guardHelpers = {
    // A binding from another address still holds while that address has an account or a live pending sign-up
    stillWaiting: async (raw: string) => {
      if ((await credentialsRef(raw).get()).exists) return true;
      const p = await pendingRef(raw).get();
      return p.exists && !isPendingExpired(p.data() as PendingSignup);
    },
    // Another spelling of the same mailbox (Gmail dots, +tags) that already has an account or a live sign-up
    aliasOwner: async (canon: string, raw: string) => {
      const snap = await canonicalRef(canon).get();
      const other = snap.exists ? String(snap.data()?.email || '') : '';
      if (!other || other === raw) return null;
      if ((await credentialsRef(other).get()).exists) return other;
      const p = await pendingRef(other).get();
      return p.exists && !isPendingExpired(p.data() as PendingSignup) ? other : null;
    },
  };
  /** Checks the guard for a new sign-up; on success returns what to store on the pending sign-up. */
  const guardSignup = async (req: Request, res: Response, email: string) => {
    const signals = readDeviceSignals(req, res);
    // The owner's unlimited-access addresses are exempt (they may register from a device that has other accounts)
    if (isUnlimitedEmail(email)) return { signals, extra: { signupMeta: signupMetaOf(signals), guardKeys: [] as ReturnType<typeof keysOf> } };
    const result = await reserveSignup(email, signals, guardHelpers);
    if (!result.ok) {
      const verdict = result as { error: string; message: string };
      console.warn(`[MarketX Access] Sign-up blocked (${verdict.error}) for ${email} from ${signals.ip || 'unknown IP'}`);
      res.status(403).json({ error: verdict.error, message: verdict.message });
      return null;
    }
    await canonicalRef(canonicalEmail(email)).set({ email: email.toLowerCase(), at: Date.now() });
    return { signals, extra: { signupMeta: signupMetaOf(signals), guardKeys: keysOf(signals) } };
  };
  const releaseGuard = (email: string, signals: DeviceSignals) => releasePendingSignup(email, signals).catch(() => {});

  app.post('/api/auth/signup', authLimiter, requireConfigured, wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const username = typeof req.body?.username === 'string' ? req.body.username : undefined;
    const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName : undefined;

    if (!acceptedTerms(req)) return res.status(400).json(TERMS_REQUIRED);
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'INVALID_EMAIL', message: 'Please enter a valid email address.' });
    if (password.length < MIN_PASSWORD) {
      return res.status(400).json({ error: 'WEAK_PASSWORD', message: `Password must be at least ${MIN_PASSWORD} characters.` });
    }

    if ((await credentialsRef(email).get()).exists) {
      return res.status(409).json({ error: 'EMAIL_TAKEN', message: 'An account with this email already exists. Sign in instead.' });
    }
    if (await isBannedEmail(email)) return res.status(403).json(BANNED_SIGNUP);
    const cleanUsername = String(username || '').trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    if (cleanUsername.length >= 3 && (await db().collection('usernames').doc(cleanUsername).get()).exists) {
      return res.status(409).json({ error: 'USERNAME_TAKEN', message: `@${cleanUsername} is already taken. Try another username.` });
    }

    // One device, one email, one IP (plus alias and disposable-address checks)
    const guard = await guardSignup(req, res, email);
    if (!guard) return;

    // Invite-only: the account is created only after the emailed pass code is entered
    const passwordHash = await hashPassword(password);
    const reserved = await createPendingSignup(email, {
      passwordHash,
      username: cleanUsername || undefined,
      displayName,
      termsAcceptedAt: Date.now(),
      ...guard.extra,
    });
    if (reserved.status === 'full') {
      await releaseGuard(email, guard.signals);
      return res.status(403).json({ error: 'BATCH_FULL', message: batchFullMessage() });
    }
    if (reserved.status === 'exists') {
      // Same person coming back: confirm with their password, never re-issue or resend a sent code
      if (!reserved.pending.passwordHash || !(await verifyPassword(password, reserved.pending.passwordHash))) {
        return res.status(409).json({
          error: 'PENDING_EXISTS',
          message: 'A pass code has already been sent to this email. Enter it on the pass code page to finish signing up.',
        });
      }
      if (!reserved.pending.codeEmailSentAt) await deliverPasscode(req, email);
      return pendingResponse(res, email, !!reserved.pending.codeEmailSentAt);
    }
    await deliverPasscode(req, email);
    pendingResponse(res, email, false);
  }));

  app.post('/api/auth/login', authLimiter, requireConfigured, wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const waitMin = loginFailures.check(email);
    if (waitMin) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: `Too many failed sign-in attempts. Try again in ${waitMin} minute${waitMin === 1 ? '' : 's'}, or reset your password.` });
    }
    const cred = EMAIL_RE.test(email) ? await credentialsRef(email).get() : null;
    const data = cred?.exists ? cred.data()! : null;

    if (!data && EMAIL_RE.test(email)) {
      // Signed up but hasn't entered the pass code yet: send them to the pass code page
      const pending = await pendingRef(email).get();
      const p = pending.exists ? (pending.data() as PendingSignup) : null;
      if (p?.passwordHash && (await verifyPassword(password, p.passwordHash))) {
        loginFailures.clear(email);
        if (isPendingExpired(p)) {
          // Their 48 hours ran out: retire the old code and reserve a fresh seat if one is free (same device rules)
          const guard = await guardSignup(req, res, email);
          if (!guard) return;
          const again = await createPendingSignup(email, { passwordHash: p.passwordHash, username: p.username, displayName: p.displayName, ...guard.extra });
          if (again.status === 'full') {
            await releaseGuard(email, guard.signals);
            return res.status(403).json({ error: 'BATCH_FULL', message: batchFullMessage() });
          }
          await deliverPasscode(req, email);
          return pendingResponse(res, email, false);
        }
        if (!p.codeEmailSentAt) await deliverPasscode(req, email);
        return pendingResponse(res, email, !!p.codeEmailSentAt);
      }
    }
    if (data && !data.passwordHash && data.googleSub) {
      return res.status(400).json({ error: 'USE_GOOGLE', message: 'This account uses Google sign-in. Continue with Google, or reset your password to add one.' });
    }
    // Always run a hash comparison so response time doesn't reveal whether the email exists
    const ok = await verifyPassword(password, data?.passwordHash || 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
    if (!data || !ok) {
      loginFailures.hit(email);
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' });
    }
    loginFailures.clear(email);
    await createUserIfMissing({ uid: data.uid, email, emailVerified: false });
    const blocked = await blockedFor(data.uid);
    if (blocked) return res.status(403).json({ error: blocked.code, message: blocked.message });
    const state = await signIn(res, data.uid);
    signInAlert(req, data.uid, 'Email & password');
    res.json({ success: true, ...state });
  }));

  // Google Identity Services: the browser sends Google's ID token; we verify it ourselves
  app.post('/api/auth/google', authLimiter, requireConfigured, wrap(async (req, res) => {
    const clientId = getGoogleClientId();
    if (!clientId) return res.status(503).json({ error: 'GOOGLE_NOT_CONFIGURED', message: 'Google sign-in is not available yet.' });
    // Google sign-up and sign-in both require accepting the Terms & Privacy Policy
    if (!acceptedTerms(req)) return res.status(400).json(TERMS_REQUIRED);
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

    // Google sign-in only recognises accounts that were registered with Google (the same Google account)
    const existingCred = await credentialsRef(email).get();
    if (existingCred.exists) {
      const sub = existingCred.data()!.googleSub;
      if (!sub || sub !== payload.sub) return res.status(403).json(GOOGLE_NOT_REGISTERED);
    }

    // New Google users go through the same pass code gate (existing accounts and owner emails sign straight in)
    if (!existingCred.exists && !isUnlimitedEmail(email)) {
      if (await isBannedEmail(email)) return res.status(403).json(BANNED_SIGNUP);
      const waiting = await pendingRef(email).get();
      const w = waiting.exists ? (waiting.data() as PendingSignup) : null;
      // A pending email/password sign-up can't be taken over or finished through Google
      if (w && !isPendingExpired(w) && w.googleSub !== payload.sub) return res.status(403).json(GOOGLE_NOT_REGISTERED);
      const guard = await guardSignup(req, res, email);
      if (!guard) return;
      const reserved = await createPendingSignup(email, {
        googleSub: payload.sub,
        name: payload.name,
        picture: payload.picture,
        termsAcceptedAt: Date.now(),
        ...guard.extra,
      });
      if (reserved.status === 'full') {
        await releaseGuard(email, guard.signals);
        return res.status(403).json({ error: 'BATCH_FULL', message: batchFullMessage() });
      }
      const alreadySent = reserved.status === 'exists' && !!reserved.pending.codeEmailSentAt;
      if (!alreadySent) await deliverPasscode(req, email);
      return pendingResponse(res, email, alreadySent);
    }

    const legacyUid = await findLegacyUid(email);
    const uid = await db()
      .runTransaction(async tx => {
      const cred = await tx.get(credentialsRef(email));
      if (cred.exists) {
        const data = cred.data()!;
        if (data.googleSub !== payload.sub) throw Object.assign(new Error('not google'), { code: 'GOOGLE_NOT_REGISTERED' });
        tx.update(credentialsRef(email), { termsAcceptedAt: Date.now() });
        return data.uid as string;
      }
      const newUid = legacyUid || crypto.randomUUID();
      tx.set(credentialsRef(email), { uid: newUid, googleSub: payload.sub, createdAt: Date.now(), termsAcceptedAt: Date.now() });
      return newUid;
    })
      .catch(err => {
        if (err?.code === 'GOOGLE_NOT_REGISTERED') return null;
        throw err;
      });
    if (!uid) return res.status(403).json(GOOGLE_NOT_REGISTERED);

    const isNew = !(await userRef(uid).get()).exists;
    await createUserIfMissing({ uid, email, emailVerified: true, name: payload.name, picture: payload.picture });
    // Google proves ownership of the address
    await userRef(uid).update({ emailVerified: true });
    const blockedG = await blockedFor(uid);
    if (blockedG) return res.status(403).json({ error: blockedG.code, message: blockedG.message });
    const state = await signIn(res, uid);
    if (isNew) sendWelcomeEmail(req, email);
    else signInAlert(req, uid, 'Google');
    res.json({ success: true, ...state });
  }));

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(res);
    res.json({ success: true });
  });

  app.post('/api/auth/forgot-password', authLimiter, requireConfigured, wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    // Same response whether or not the account exists
    res.json({ success: true, message: 'If an account exists for that email, a reset link has been sent.' });
    // At most 3 reset emails per address per hour (stops inbox flooding); response is identical
    if (!EMAIL_RE.test(email) || resetEmails.hit(email)) return;
    const cred = await credentialsRef(email).get();
    if (!cred.exists) return;
    const { token, hash } = newOneTimeToken();
    await tokenRef(hash).set({ uid: cred.data()!.uid, email, type: 'reset', expiresAt: Date.now() + RESET_TTL_MS });
    const link = `${siteUrl(req)}/?reset=${token}`;
    await sendEmail(email, 'Reset your MarketX password', ['We received a request to reset your MarketX password.'], {
      cta: { label: 'Choose a new password', url: link },
      note: "This link expires in 1 hour. If you didn't request it, you can ignore this email and your password stays the same.",
    });
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
    const blockedR = await blockedFor(uid);
    if (blockedR) return res.status(403).json({ error: blockedR.code, message: blockedR.message });
    const state = await signIn(res, uid);
    const { device, ip, when } = describeRequest(req);
    notifyActivity(
      uid,
      { type: 'security', title: 'Your password was changed', message: `${device} · ${ip}. Other devices were signed out.` },
      {
        subject: 'Your MarketX password was changed',
        lines: ['The password for your MarketX account was just changed, and every other device was signed out.'],
        options: {
          rows: [
            ['Device', device],
            ['IP address', ip],
            ['Time', when],
          ],
          note: "If you didn't do this, reset your password again right away and contact help.marketx@gmail.com.",
        },
        security: true,
      }
    );
    res.json({ success: true, ...state });
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
      return data.uid as string;
    });
    if (ok) {
      addNotification(ok, { type: 'security', title: 'Email verified', message: 'Your email address is confirmed and your account is secured.' }).catch(
        () => {}
      );
    }
    res.redirect(ok ? '/?verified=1' : '/?verified=0');
  }));

  app.post('/api/auth/resend-verification', authLimiter, requireAuth, wrap(async (req, res) => {
    const user = getUser(res);
    if (user.emailVerified) return res.json({ success: true, message: 'Your email is already verified.' });
    const waitMin = verifyEmails.hit(user.uid);
    if (waitMin) {
      return res.status(429).json({ error: 'RATE_LIMITED', message: `Verification email already sent. Check your inbox (and spam), or try again in ${waitMin} minutes.` });
    }
    await sendVerificationEmail(req, user.uid, user.email);
    res.json({ success: true, message: `Verification email sent to ${user.email}.` });
  }));

  // Pass code redemption: creates the account, signs the user in and confirms by email
  app.post('/api/access/redeem', authLimiter, requireConfigured, wrap(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '');
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'INVALID_EMAIL', message: 'Enter the email you signed up with.' });
    if (!code.trim()) return res.status(400).json({ error: 'CODE_REQUIRED', message: 'Enter your pass code.' });

    const check = await checkPasscode(email, code);
    if (check.status === 'expired') {
      return res.status(410).json({
        error: 'CODE_EXPIRED',
        message: `This pass code expired because it wasn't used within ${PASSCODE_TTL_HOURS} hours, and the seat was released. Sign up again to request a new one.`,
      });
    }
    if (check.status === 'no_pending') {
      const hasAccount = (await credentialsRef(email).get()).exists;
      return res.status(hasAccount ? 409 : 404).json(
        hasAccount
          ? { error: 'ALREADY_ACTIVE', message: 'This account already has access. Sign in to continue.' }
          : { error: 'NO_PENDING', message: 'No sign-up is waiting for this email. Create an account first.' }
      );
    }
    if (check.status === 'locked') {
      return res.status(429).json({ error: 'LOCKED', message: `Too many incorrect attempts. Try again in ${check.retryInMin} minutes.` });
    }
    if (check.status === 'invalid') {
      return res.status(400).json({
        error: 'INVALID_CODE',
        message: `That pass code doesn't match. ${check.attemptsLeft} attempt${check.attemptsLeft === 1 ? '' : 's'} left.`,
      });
    }

    const pending = check.pending;
    if (await isBannedEmail(email)) return res.status(403).json(BANNED_SIGNUP);
    // The device entering the code must not already belong to someone else either
    const redeemGuard = await guardSignup(req, res, email);
    if (!redeemGuard) return;
    const uid = (await findLegacyUid(email)) || crypto.randomUUID();
    const created = await db().runTransaction(async tx => {
      const cred = await tx.get(credentialsRef(email));
      const still = await tx.get(pendingRef(email));
      if (cred.exists || !still.exists) return false;
      tx.set(credentialsRef(email), {
        uid,
        ...(pending.passwordHash ? { passwordHash: pending.passwordHash } : {}),
        ...(pending.googleSub ? { googleSub: pending.googleSub } : {}),
        ...(pending.termsAcceptedAt ? { termsAcceptedAt: pending.termsAcceptedAt } : {}),
        createdAt: Date.now(),
      });
      consumePasscodeInTx(tx, pending, uid);
      return true;
    });
    if (!created) return res.status(409).json({ error: 'ALREADY_ACTIVE', message: 'This account already has access. Sign in to continue.' });

    // The pass code arrived by email, so the address is proven
    await createUserIfMissing({ uid, email, emailVerified: true, name: pending.name, picture: pending.picture }, pending.username, pending.displayName);
    await userRef(uid).update({
      emailVerified: true,
      // Where the account was registered and activated (admin console; abuse checks)
      signupMeta: pending.signupMeta || redeemGuard.extra.signupMeta,
      redeemMeta: redeemGuard.extra.signupMeta,
    });
    await activateSignup(email, [...((pending.guardKeys as any[]) || []), ...redeemGuard.extra.guardKeys]).catch(err =>
      console.warn('[MarketX Access] could not activate device bindings:', err?.message || err)
    );
    const state = await signIn(res, uid);
    res.json({ success: true, accessGranted: true, ...state });
    logActivity(uid, { type: 'signup', title: 'Joined MarketX with a pass code', detail: `Batch ${pending.batch}` }, state?.profile?.username);
    bumpDaily('signups');
    touchUser(uid);

    addNotification(uid, {
      type: 'security',
      title: 'Access granted',
      message: 'Your pass code was accepted and your MarketX account is active.',
    }).catch(() => {});
    sendEmail(
      email,
      'Access granted: welcome to MarketX',
      [
        'Your pass code was accepted and your MarketX account is now active.',
        'Ask about any market (forex, gold, crypto, stocks or synthetic indices) and get a clear trade plan with entry, stop loss and targets, live.',
      ],
      {
        rows: [
          ['Account', email],
          ['Username', `@${state?.profile?.username || pending.username || ''}`],
          ['Status', 'Access granted'],
        ],
        cta: { label: 'Start using MarketX', url: siteUrl(req) },
        note: 'Your pass code has now expired and cannot be used again.',
      }
    );
  }));

  // Permanently deletes the account and its data. Password accounts must re-enter their password;
  // Google-only accounts confirm by typing DELETE. Payment records are kept for accounting.
  app.post('/api/account/delete', authLimiter, requireAuth, wrap(async (req, res) => {
    const user = getUser(res);
    if (String(req.body?.confirm || '') !== 'DELETE') {
      return res.status(400).json({ error: 'CONFIRM_REQUIRED', message: 'Type DELETE to confirm.' });
    }
    const credSnap = await credentialsRef(user.email).get();
    const cred = credSnap.exists ? credSnap.data()! : null;
    if (cred?.passwordHash && !(await verifyPassword(String(req.body?.password || ''), cred.passwordHash))) {
      return res.status(401).json({ error: 'INVALID_PASSWORD', message: 'That password is incorrect.' });
    }

    const doc = await deleteAccountData(user.uid, user.email);
    clearSessionCookie(res);
    res.json({ success: true });

    const { device, when } = describeRequest(req);
    sendEmail(
      user.email,
      'Your MarketX account has been deleted',
      [
        `Your MarketX account${doc?.username ? ` (@${doc.username})` : ''} and its data (chat history, saved setups, credits and notifications) have been permanently deleted.`,
        "We're sorry to see you go. You're welcome back any time. Just sign up again with this email.",
      ],
      {
        rows: [
          ['Device', device],
          ['Time', when],
        ],
        cta: { label: 'Visit MarketX', url: siteUrl(req) },
        note: "If you didn't request this, contact help.marketx@gmail.com immediately.",
      }
    );
  }));
}
