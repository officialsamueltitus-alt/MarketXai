import type { Express, Request, Response, NextFunction } from 'express';
import { FieldValue, Transaction, DocumentReference } from 'firebase-admin/firestore';
import { db, isFirebaseConfigured } from './firebase';
import { isSessionConfigured, readSessionCookie, verifySessionToken } from './session';
import { sendEmail } from './mailer';
import type {
  UserProfile,
  CreditState,
  XShareReward,
  AppNotification,
  ChatSession,
  SavedAnalysis,
  CreditGift,
} from '../src/types';

// ---------------------------------------------------------------------------
// Credit & plan rules (server is the single source of truth)
// ---------------------------------------------------------------------------
export const FREE_DAILY_LIMIT = 3;
export const PRO_DAILY_LIMIT = 10;
export const STARTING_CREDITS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const X_SHARE_WAIT_MS = 10 * 60 * 60 * 1000;
const X_SHARE_CREDITS = 10;
const UNLIMITED_VALUE = 999999;

const UNLIMITED_EMAILS = new Set(
  ['tcrypt3@gmail.com', ...(process.env.UNLIMITED_EMAILS || '').split(',')]
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
);

export interface AuthedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

export interface UserDoc {
  uid: string;
  email: string;
  username: string;
  usernameLower: string;
  displayName: string;
  avatarUrl: string | null;
  joinedAt: number;
  subscription: UserProfile['subscription'];
  credits: {
    available: number;
    dailyLimit: number;
    dailyRemaining: number;
    lastDailyReset: number;
  };
  xShareReward: XShareReward | null;
  emailVerified?: boolean;
  // Incremented to invalidate every existing session (e.g. after a password reset)
  sessionVersion?: number;
}

// Unlimited access requires a verified email so nobody can claim it by registering the address
export function isUnlimited(user: AuthedUser): boolean {
  return user.emailVerified && UNLIMITED_EMAILS.has(user.email.toLowerCase());
}

const userRef = (uid: string) => db().collection('users').doc(uid);
const usernameRef = (lower: string) => db().collection('usernames').doc(lower);

export function sanitizeUsername(raw: string): string {
  return (raw || '').trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
}

// Apply subscription expiry and the strict 24h daily quota renewal (no rollover)
function normalizeUser(doc: UserDoc, now: number): { doc: UserDoc; changed: boolean } {
  let changed = false;
  const next: UserDoc = { ...doc, subscription: { ...doc.subscription }, credits: { ...doc.credits } };

  if (next.subscription.active && next.subscription.expiresAt > 0 && now > next.subscription.expiresAt) {
    next.subscription = { ...next.subscription, active: false, plan: 'free' };
    changed = true;
  }

  const targetLimit = next.subscription.active ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;
  if (now - next.credits.lastDailyReset >= DAY_MS) {
    next.credits.dailyLimit = targetLimit;
    next.credits.dailyRemaining = targetLimit;
    next.credits.lastDailyReset = now;
    changed = true;
  } else if (next.credits.dailyLimit !== targetLimit) {
    const adjusted = next.credits.dailyRemaining + (targetLimit - next.credits.dailyLimit);
    next.credits.dailyRemaining = Math.max(0, Math.min(targetLimit, adjusted));
    next.credits.dailyLimit = targetLimit;
    changed = true;
  }
  return { doc: next, changed };
}

export function toClientState(doc: UserDoc, user: AuthedUser) {
  const vip = isUnlimited(user);
  const profile: UserProfile = {
    id: doc.uid,
    username: doc.username,
    displayName: doc.displayName,
    email: doc.email,
    avatarUrl: doc.avatarUrl || undefined,
    joinedAt: doc.joinedAt,
    isVerified: vip || doc.subscription.active,
    emailVerified: !!doc.emailVerified,
    subscription: vip
      ? { plan: 'yearly', active: true, startDate: doc.joinedAt, expiresAt: 0, price: 0 }
      : doc.subscription,
  };
  const credits: CreditState = vip
    ? {
        availableCredits: UNLIMITED_VALUE,
        dailyUsageLimit: UNLIMITED_VALUE,
        dailyUsageRemaining: UNLIMITED_VALUE,
        lastDailyResetTime: doc.credits.lastDailyReset,
      }
    : {
        availableCredits: doc.credits.available,
        dailyUsageLimit: doc.credits.dailyLimit,
        dailyUsageRemaining: doc.credits.dailyRemaining,
        lastDailyResetTime: doc.credits.lastDailyReset,
      };
  return { profile, credits, xShareReward: doc.xShareReward || null, unlimited: vip };
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
const notificationsCol = (uid: string) => userRef(uid).collection('notifications');

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addNotificationInTx(
  tx: Transaction,
  uid: string,
  n: Omit<AppNotification, 'id' | 'timestamp' | 'read'>
) {
  const id = newId('notif');
  tx.set(notificationsCol(uid).doc(id), { ...n, id, timestamp: Date.now(), read: false });
}

export async function addNotification(uid: string, n: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) {
  const id = newId('notif');
  await notificationsCol(uid).doc(id).set({ ...n, id, timestamp: Date.now(), read: false });
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!isFirebaseConfigured() || !isSessionConfigured()) {
    return res.status(503).json({ error: 'AUTH_NOT_CONFIGURED', message: 'Accounts are not configured on this server yet.' });
  }
  const session = verifySessionToken(readSessionCookie(req) || '');
  if (!session) {
    return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Please sign in to continue.' });
  }
  try {
    const snap = await userRef(session.uid).get();
    const doc = snap.exists ? (snap.data() as UserDoc) : null;
    if (!doc || (doc.sessionVersion || 0) !== session.v) {
      return res.status(401).json({ error: 'AUTH_INVALID', message: 'Your session has expired. Please sign in again.' });
    }
    res.locals.user = {
      uid: session.uid,
      email: (doc.email || '').toLowerCase(),
      emailVerified: !!doc.emailVerified,
    } as AuthedUser;
    next();
  } catch (err: any) {
    console.error('[MarketX Auth] Session lookup failed:', err?.message || err);
    return res.status(500).json({ error: 'SERVER_ERROR', message: 'Could not verify your session. Please try again.' });
  }
}

const getUser = (res: Response) => res.locals.user as AuthedUser;

interface LoadedUser {
  ref: DocumentReference;
  doc: UserDoc;
  changed: boolean;
}

// Reads the user doc inside a transaction and applies expiry/quota renewal in memory.
// Firestore requires every read before any write, so callers persist with saveNormalized()
// only after all of their reads are done.
async function loadUserInTx(tx: Transaction, uid: string): Promise<LoadedUser | null> {
  const ref = userRef(uid);
  const snap = await tx.get(ref);
  if (!snap.exists) return null;
  const { doc, changed } = normalizeUser(snap.data() as UserDoc, Date.now());
  return { ref, doc, changed };
}

function saveNormalized(tx: Transaction, loaded: LoadedUser) {
  if (loaded.changed) tx.set(loaded.ref, loaded.doc);
}

// ---------------------------------------------------------------------------
// Account creation
// ---------------------------------------------------------------------------
export async function createUserIfMissing(user: AuthedUser, requestedUsername?: string, requestedName?: string): Promise<UserDoc> {
  const base =
    sanitizeUsername(requestedUsername || '') ||
    sanitizeUsername((user.email.split('@')[0] || 'trader').slice(0, 16)) ||
    'trader';
  const padded = base.length >= 3 ? base : `${base}trader`.slice(0, 20);

  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = attempt === 0 ? padded : `${padded.slice(0, 15)}${Math.floor(1000 + Math.random() * 9000)}`;
    try {
      return await db().runTransaction(async tx => {
        const ref = userRef(user.uid);
        const existing = await tx.get(ref);
        if (existing.exists) return existing.data() as UserDoc;

        const nameSnap = await tx.get(usernameRef(candidate));
        if (nameSnap.exists) throw new Error('USERNAME_TAKEN');

        const now = Date.now();
        const doc: UserDoc = {
          uid: user.uid,
          email: user.email,
          username: candidate,
          usernameLower: candidate,
          displayName: (requestedName || user.name || `${candidate} Trader`).trim().slice(0, 40),
          avatarUrl: user.picture || null,
          joinedAt: now,
          subscription: { plan: 'free', active: false, startDate: now, expiresAt: 0, price: 0 },
          credits: {
            available: STARTING_CREDITS,
            dailyLimit: FREE_DAILY_LIMIT,
            dailyRemaining: FREE_DAILY_LIMIT,
            lastDailyReset: now,
          },
          xShareReward: null,
          emailVerified: user.emailVerified,
          sessionVersion: 0,
        };
        tx.set(ref, doc);
        tx.set(usernameRef(candidate), { uid: user.uid });
        addNotificationInTx(tx, user.uid, {
          type: 'system',
          title: 'Welcome to MarketX',
          message: `Your account is ready with ${STARTING_CREDITS} AI credits and ${FREE_DAILY_LIMIT} daily analyses.`,
        });
        addNotificationInTx(tx, user.uid, {
          type: 'reward',
          title: `Campaign: Share Your Profile on X (+${X_SHARE_CREDITS} Credits)`,
          message: `Share your trader card on X to earn ${X_SHARE_CREDITS} AI credits after 10 hours.`,
          actionType: 'open_campaign',
        });
        return doc;
      });
    } catch (err: any) {
      if (err?.message !== 'USERNAME_TAKEN') throw err;
    }
  }
  throw new Error('Could not allocate a unique username');
}

// Credits the X share reward once its 10-hour window has passed
async function settleXShareReward(user: AuthedUser): Promise<boolean> {
  const credited = await db().runTransaction(async tx => {
    const loaded = await loadUserInTx(tx, user.uid);
    if (!loaded) return false;
    const reward = loaded.doc.xShareReward;
    saveNormalized(tx, loaded);
    if (!reward || reward.status !== 'pending' || Date.now() < reward.unlockAt) return false;
    tx.update(loaded.ref, {
      'credits.available': FieldValue.increment(reward.creditsAwarded),
      xShareReward: { ...reward, status: 'credited', notifiedOnSite: true, notifiedEmail: true },
    });
    addNotificationInTx(tx, user.uid, {
      type: 'reward',
      title: `+${reward.creditsAwarded} Credits Added to Your Account`,
      message: `You have been credited with ${reward.creditsAwarded} AI credits for sharing your profile on X.`,
    });
    return true;
  });
  if (credited) {
    sendEmail(user.email, `You earned ${X_SHARE_CREDITS} MarketX credits`, [
      `Thanks for sharing MarketX on X! ${X_SHARE_CREDITS} AI credits have been added to your account.`,
    ]);
  }
  return credited;
}

async function readAccountState(user: AuthedUser) {
  const doc = await db().runTransaction(async tx => {
    const loaded = await loadUserInTx(tx, user.uid);
    if (!loaded) return null;
    saveNormalized(tx, loaded);
    return loaded.doc;
  });
  if (!doc) return null;
  const giftsSnap = await userRef(user.uid).collection('giftsSent').orderBy('timestamp', 'desc').limit(10).get();
  const recentGifts = giftsSnap.docs.map(d => d.data() as CreditGift);
  return { ...toClientState(doc, user), recentGifts };
}

// ---------------------------------------------------------------------------
// Analysis credit charging (used by /api/market/analyze)
// ---------------------------------------------------------------------------
export async function chargeAnalysisCredit(req: Request, res: Response, next: NextFunction) {
  const user = getUser(res);
  if (isUnlimited(user)) return next();
  try {
    const charged = await db().runTransaction(async tx => {
      const loaded = await loadUserInTx(tx, user.uid);
      if (!loaded) return { ok: false as const, reason: 'NO_ACCOUNT' };
      const c = loaded.doc.credits;
      saveNormalized(tx, loaded);
      if (c.dailyRemaining <= 0 && c.available <= 0) return { ok: false as const, reason: 'NO_CREDITS' };
      const dailyDelta = c.dailyRemaining > 0 ? 1 : 0;
      const availableDelta = c.available > 0 ? 1 : 0;
      tx.update(loaded.ref, {
        'credits.dailyRemaining': c.dailyRemaining - dailyDelta,
        'credits.available': c.available - availableDelta,
      });
      return { ok: true as const, dailyDelta, availableDelta };
    });

    if (!charged.ok) {
      return res.status(charged.reason === 'NO_CREDITS' ? 402 : 409).json({
        error: charged.reason,
        message:
          charged.reason === 'NO_CREDITS'
            ? 'You have used all your credits. Refill or upgrade to continue.'
            : 'Account not initialised. Please sign in again.',
      });
    }

    // Refund the credit if the analysis request fails
    res.on('finish', () => {
      if (res.statusCode < 400) return;
      userRef(user.uid)
        .update({
          'credits.dailyRemaining': FieldValue.increment(charged.dailyDelta),
          'credits.available': FieldValue.increment(charged.availableDelta),
        })
        .catch(err => console.warn('[MarketX Credits] Refund failed:', err?.message || err));
    });
    next();
  } catch (err: any) {
    console.error('[MarketX Credits] Charge failed:', err?.message || err);
    res.status(500).json({ error: 'CREDIT_CHECK_FAILED', message: 'Could not verify your credits. Please try again.' });
  }
}

// ---------------------------------------------------------------------------
// History sanitising (Firestore documents are limited to 1 MiB)
// ---------------------------------------------------------------------------
const MAX_SESSION_BYTES = 900_000;
const SAFE_ID = /^[\w.-]{1,100}$/;

function sanitizeSession(raw: any, id: string): ChatSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const messages = Array.isArray(raw.messages) ? raw.messages : [];
  const cleaned = messages.map((m: any) => {
    const { chartImage, ...rest } = m || {};
    if (rest.strategy && typeof rest.strategy === 'object') {
      const { chartImageThumbnail, ...strategy } = rest.strategy;
      rest.strategy = strategy;
    }
    // In-flight placeholders are not worth persisting as "searching"
    if (rest.status === 'searching' || rest.status === 'analyzing') rest.status = 'error';
    return rest;
  });
  const session: ChatSession = {
    id,
    title: String(raw.title || 'MarketX Analysis').slice(0, 120),
    symbol: raw.symbol ? String(raw.symbol).slice(0, 40) : undefined,
    bias: raw.bias,
    lastMessage: String(raw.lastMessage || '').slice(0, 500),
    updatedAt: Number(raw.updatedAt) || Date.now(),
    messages: cleaned,
  };
  while (session.messages.length > 0 && Buffer.byteLength(JSON.stringify(session)) > MAX_SESSION_BYTES) {
    session.messages.shift();
  }
  return JSON.parse(JSON.stringify(session)); // drop undefined values Firestore rejects
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export function registerAccountRoutes(app: Express, limiter: any) {
  const wrap =
    (fn: (req: Request, res: Response) => Promise<any>) =>
    (req: Request, res: Response) =>
      fn(req, res).catch(err => {
        console.error(`[MarketX API] ${req.method} ${req.path} failed:`, err?.message || err);
        if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
      });

  app.get('/api/account', limiter, requireAuth, wrap(async (req, res) => {
    const user = getUser(res);
    await settleXShareReward(user);
    const state = await readAccountState(user);
    if (!state) return res.status(404).json({ error: 'NO_ACCOUNT' });
    res.json({ success: true, ...state });
  }));

  app.put('/api/account/profile', limiter, requireAuth, wrap(async (req, res) => {
    const user = getUser(res);
    const displayName = String(req.body?.displayName || '').trim().slice(0, 40);
    const username = sanitizeUsername(String(req.body?.username || ''));
    const avatarUrl = req.body?.avatarUrl ? String(req.body.avatarUrl) : null;

    if (!displayName) return res.status(400).json({ error: 'INVALID', message: 'Display name is required.' });
    if (username.length < 3) return res.status(400).json({ error: 'INVALID', message: 'Username must be at least 3 characters (letters, numbers, _).' });
    if (avatarUrl && !/^(https:\/\/|data:image\/(png|jpe?g|webp);base64,)/.test(avatarUrl)) {
      return res.status(400).json({ error: 'INVALID', message: 'Unsupported profile picture format.' });
    }
    if (avatarUrl && avatarUrl.length > 300_000) {
      return res.status(400).json({ error: 'INVALID', message: 'Profile picture is too large.' });
    }

    await db().runTransaction(async tx => {
      const loaded = await loadUserInTx(tx, user.uid);
      if (!loaded) throw new Error('NO_ACCOUNT');
      const current = loaded.doc;
      if (username !== current.usernameLower) {
        const taken = await tx.get(usernameRef(username));
        if (taken.exists && taken.data()?.uid !== user.uid) {
          const e: any = new Error('USERNAME_TAKEN');
          e.status = 409;
          throw e;
        }
        tx.delete(usernameRef(current.usernameLower));
        tx.set(usernameRef(username), { uid: user.uid });
      }
      saveNormalized(tx, loaded);
      tx.update(loaded.ref, { displayName, username, usernameLower: username, avatarUrl });
    }).catch(err => {
      if (err?.message === 'USERNAME_TAKEN') {
        res.status(409).json({ error: 'USERNAME_TAKEN', message: `@${username} is already taken.` });
        return;
      }
      throw err;
    });
    if (res.headersSent) return;
    res.json({ success: true, ...(await readAccountState(user)) });
  }));

  // --- History (chat sessions & saved setups) ---
  app.get('/api/history', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const [sessionsSnap, analysesSnap] = await Promise.all([
      userRef(uid).collection('sessions').orderBy('updatedAt', 'desc').limit(100).get(),
      userRef(uid).collection('meta').doc('analyses').get(),
    ]);
    res.json({
      success: true,
      sessions: sessionsSnap.docs.map(d => d.data()),
      analyses: (analysesSnap.data()?.items as SavedAnalysis[]) || [],
    });
  }));

  app.put('/api/history/sessions/:id', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const id = String(req.params.id);
    if (!SAFE_ID.test(id)) return res.status(400).json({ error: 'INVALID_ID' });
    const session = sanitizeSession(req.body, id);
    if (!session) return res.status(400).json({ error: 'INVALID_SESSION' });
    await userRef(uid).collection('sessions').doc(id).set(session);
    res.json({ success: true });
  }));

  app.delete('/api/history/sessions/:id', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const id = String(req.params.id);
    if (!SAFE_ID.test(id)) return res.status(400).json({ error: 'INVALID_ID' });
    await userRef(uid).collection('sessions').doc(id).delete();
    res.json({ success: true });
  }));

  app.delete('/api/history/sessions', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    await db().recursiveDelete(userRef(uid).collection('sessions'));
    res.json({ success: true });
  }));

  app.put('/api/history/analyses', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const items = Array.isArray(req.body?.analyses) ? req.body.analyses.slice(0, 500) : [];
    await userRef(uid).collection('meta').doc('analyses').set({ items: JSON.parse(JSON.stringify(items)) });
    res.json({ success: true });
  }));

  // --- Notifications ---
  app.get('/api/notifications', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const snap = await notificationsCol(uid).orderBy('timestamp', 'desc').limit(50).get();
    res.json({ success: true, notifications: snap.docs.map(d => d.data()) });
  }));

  app.post('/api/notifications/read-all', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const snap = await notificationsCol(uid).where('read', '==', false).limit(200).get();
    const batch = db().batch();
    snap.docs.forEach(d => batch.update(d.ref, { read: true }));
    await batch.commit();
    res.json({ success: true });
  }));

  app.post('/api/notifications/:id/read', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const id = String(req.params.id);
    if (!SAFE_ID.test(id)) return res.status(400).json({ error: 'INVALID_ID' });
    const ref = notificationsCol(uid).doc(id);
    if ((await ref.get()).exists) await ref.update({ read: true });
    res.json({ success: true });
  }));

  app.delete('/api/notifications/:id', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const id = String(req.params.id);
    if (!SAFE_ID.test(id)) return res.status(400).json({ error: 'INVALID_ID' });
    await notificationsCol(uid).doc(id).delete();
    res.json({ success: true });
  }));

  app.delete('/api/notifications', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    await db().recursiveDelete(notificationsCol(uid));
    res.json({ success: true });
  }));

  // --- Gift credits to another user ---
  app.post('/api/credits/gift', limiter, requireAuth, wrap(async (req, res) => {
    const user = getUser(res);
    const toUsername = sanitizeUsername(String(req.body?.toUsername || ''));
    const amount = Number(req.body?.amount);
    const note = req.body?.note ? String(req.body.note).slice(0, 140) : undefined;

    if (!toUsername) return res.status(400).json({ error: 'INVALID', message: 'Enter a recipient username.' });
    if (!Number.isInteger(amount) || amount < 1 || amount > 1000) {
      return res.status(400).json({ error: 'INVALID', message: 'Gift amount must be a whole number between 1 and 1000.' });
    }

    const vip = isUnlimited(user);
    const result = await db().runTransaction(async tx => {
      const sender = await loadUserInTx(tx, user.uid);
      if (!sender) return { error: 'NO_ACCOUNT', message: 'Account not found.' };
      const target = await tx.get(usernameRef(toUsername));
      if (!target.exists) return { error: 'NOT_FOUND', message: `No MarketX user named @${toUsername}.` };
      const toUid = target.data()!.uid as string;
      if (toUid === user.uid) return { error: 'INVALID', message: 'You cannot gift credits to yourself.' };
      const recipient = await loadUserInTx(tx, toUid);
      if (!recipient) return { error: 'NOT_FOUND', message: `No MarketX user named @${toUsername}.` };
      if (!vip && sender.doc.credits.available < amount) {
        return { error: 'INSUFFICIENT', message: `Insufficient balance. You have ${sender.doc.credits.available} credits.` };
      }

      saveNormalized(tx, sender);
      saveNormalized(tx, recipient);
      if (!vip) tx.update(sender.ref, { 'credits.available': FieldValue.increment(-amount) });
      tx.update(recipient.ref, { 'credits.available': FieldValue.increment(amount) });

      const gift: CreditGift = {
        id: newId('gift'),
        fromUsername: sender.doc.username,
        toUsername: recipient.doc.username,
        amount,
        timestamp: Date.now(),
        ...(note ? { note } : {}),
      };
      tx.set(sender.ref.collection('giftsSent').doc(gift.id), gift);
      tx.set(recipient.ref.collection('giftsReceived').doc(gift.id), gift);
      addNotificationInTx(tx, toUid, {
        type: 'credit',
        title: `🎁 @${sender.doc.username} sent you ${amount} credits`,
        message: note ? `"${note}"` : `${amount} AI credits have been added to your balance.`,
      });
      return { gift, recipientEmail: recipient.doc.email, senderUsername: sender.doc.username };
    });

    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'INSUFFICIENT' ? 402 : 400;
      return res.status(status).json(result);
    }
    sendEmail(result.recipientEmail, `@${result.senderUsername} gifted you ${amount} MarketX credits`, [
      `@${result.senderUsername} just sent you ${amount} AI credits on MarketX.`,
      ...(note ? [`Their note: "${note}"`] : []),
    ]);
    res.json({ success: true, gift: result.gift, ...(await readAccountState(user)) });
  }));

  // --- X share campaign: user is sent to X with a pre-written post; credits unlock 10h later (server-timed, once per account) ---
  app.post('/api/rewards/x-share', limiter, requireAuth, wrap(async (req, res) => {
    const user = getUser(res);
    const result = await db().runTransaction(async tx => {
      const loaded = await loadUserInTx(tx, user.uid);
      if (!loaded) return { error: 'NO_ACCOUNT', message: 'Account not found.' };
      if (loaded.doc.xShareReward) return { error: 'ALREADY_CLAIMED', message: 'You have already joined this campaign.' };

      const now = Date.now();
      const reward: XShareReward = {
        id: newId('x-share'),
        username: loaded.doc.username,
        email: loaded.doc.email,
        sharedAt: now,
        unlockAt: now + X_SHARE_WAIT_MS,
        creditsAwarded: X_SHARE_CREDITS,
        status: 'pending',
        notifiedOnSite: false,
        notifiedEmail: false,
      };
      saveNormalized(tx, loaded);
      tx.update(loaded.ref, { xShareReward: reward });
      return { reward };
    });

    if ('error' in result) return res.status(result.error === 'NO_ACCOUNT' ? 404 : 409).json(result);
    res.json({ success: true, ...(await readAccountState(user)) });
  }));
}

// Shared helpers for the payments module
export { userRef, usernameRef, loadUserInTx, saveNormalized, readAccountState, getUser };
