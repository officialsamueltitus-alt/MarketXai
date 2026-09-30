import type { Express, Request, Response, NextFunction } from 'express';
import { CREDIT_RESET_LABEL, CREDIT_RESET_TZ, isDailyResetDue, nextDailyReset } from './dailyReset';
import crypto from 'crypto';
import { FieldValue, Transaction, DocumentReference } from 'firebase-admin/firestore';
import { db, isFirebaseConfigured } from './firebase';
import { isSessionConfigured, readSessionCookie, verifySessionToken } from './session';
import { sendEmail, EmailOptions } from './mailer';
import { logActivity, recordUsage } from './tracking';
import { clientIp, stripReservedKeys } from './security';
import { IS_LEAD_WORKER } from './workers';
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
    /** Credits earned from the X campaign (part of `available`): the one exemption, usable after the daily limit */
    campaign?: number;
  };
  xShareReward: XShareReward | null;
  emailVerified?: boolean;
  // Incremented to invalidate every existing session (e.g. after a password reset)
  sessionVersion?: number;
  emailPrefs?: { activity: boolean };
  // Expiry timestamps already alerted, so each reminder/notice is sent once per plan period
  expiryReminderFor?: number;
  expiryNoticeFor?: number;
  // Moderation (set from the admin console)
  status?: 'active' | 'suspended' | 'banned';
  statusReason?: string;
  statusAt?: number;
  // Activity summary for the admin console
  lastActiveAt?: number;
  usageTotal?: number;
  // Price alerts: the trader's approval, and when the last "Want an alert?" email went out
  alerts?: { enabled: boolean; at: number };
  alertMailAt?: number;
}

export function blockedStatusMessage(status?: string): { code: string; message: string } | null {
  if (status === 'suspended') {
    return {
      code: 'ACCOUNT_SUSPENDED',
      message: 'Your MarketX account is currently suspended. Contact help.marketx@gmail.com to find out more.',
    };
  }
  if (status === 'banned') {
    return {
      code: 'ACCOUNT_BANNED',
      message: 'This MarketX account has been banned. Contact help.marketx@gmail.com if you believe this is a mistake.',
    };
  }
  return null;
}

export function isUnlimitedEmail(email: string): boolean {
  return UNLIMITED_EMAILS.has(String(email || '').toLowerCase());
}

// Unlimited access requires a verified email so nobody can claim it by registering the address
export function isUnlimited(user: AuthedUser): boolean {
  return user.emailVerified && UNLIMITED_EMAILS.has(user.email.toLowerCase());
}

const userRef = (uid: string) => db().collection('users').doc(uid);
const usernameRef = (lower: string) => db().collection('usernames').doc(lower);
// One X campaign claim per person, ever: keyed by a hash of the email (and the account id), so deleting the
// account and signing up again with the same email cannot claim the reward a second time
const campaignClaimRef = (key: string) => db().collection('campaignClaims').doc(key);
const emailClaimKey = (email: string) => 'e_' + crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex');

export function sanitizeUsername(raw: string): string {
  return (raw || '').trim().replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
}

// Apply subscription expiry and the daily quota refill at 3:00 AM (site time zone), no rollover
function normalizeUser(doc: UserDoc, now: number): { doc: UserDoc; changed: boolean } {
  let changed = false;
  const next: UserDoc = { ...doc, subscription: { ...doc.subscription }, credits: { ...doc.credits } };

  if (next.subscription.active && next.subscription.expiresAt > 0 && now > next.subscription.expiresAt) {
    next.subscription = { ...next.subscription, active: false, plan: 'free' };
    changed = true;
  }

  // Campaign credits pool: accounts credited before the pool existed get what is left of their reward
  if (next.credits.campaign === undefined && next.xShareReward?.status === 'credited' && next.xShareReward.creditsAwarded > 0) {
    next.credits.campaign = Math.max(0, Math.min(next.credits.available, next.xShareReward.creditsAwarded));
    changed = true;
  }
  if ((next.credits.campaign ?? 0) > next.credits.available) {
    next.credits.campaign = Math.max(0, next.credits.available);
    changed = true;
  }

  const targetLimit = next.subscription.active ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;
  if (isDailyResetDue(next.credits.lastDailyReset, now)) {
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
    emailActivity: doc.emailPrefs?.activity !== false,
    alertsEnabled: !!doc.alerts?.enabled,
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
        nextDailyResetAt: nextDailyReset(),
        resetTimeZone: CREDIT_RESET_TZ,
      }
    : {
        availableCredits: doc.credits.available,
        dailyUsageLimit: doc.credits.dailyLimit,
        dailyUsageRemaining: doc.credits.dailyRemaining,
        lastDailyResetTime: doc.credits.lastDailyReset,
        nextDailyResetAt: nextDailyReset(),
        resetTimeZone: CREDIT_RESET_TZ,
        campaignCredits: Math.max(0, doc.credits.campaign ?? 0),
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
// Activity alerts: a site notification plus an email.
// Security emails (sign-in, password, deletion) always send; activity emails respect the user's preference.
// ---------------------------------------------------------------------------
type NotificationInput = Omit<AppNotification, 'id' | 'timestamp' | 'read'>;
export interface ActivityMail {
  subject: string;
  lines: string[];
  options?: EmailOptions;
  security?: boolean;
}

export async function notifyActivity(uid: string, n: NotificationInput | null, mail?: ActivityMail): Promise<void> {
  try {
    const snap = await userRef(uid).get();
    if (!snap.exists) return;
    const doc = snap.data() as UserDoc;
    if (n) await addNotification(uid, n);
    if (mail && (mail.security || doc.emailPrefs?.activity !== false)) {
      // Activity mail is low priority (paced and deduplicated); security mail always goes first
      await sendEmail(doc.email, mail.subject, mail.lines, { ...mail.options, priority: mail.security ? 'high' : 'low' });
    }
  } catch (err: any) {
    console.warn('[MarketX Notify] failed:', err?.message || err);
  }
}

export function siteLink(path = ''): string {
  return `${(process.env.APP_URL || 'https://marketx.world').replace(/\/+$/, '')}${path}`;
}

// "Chrome on Android · 102.89.x.x" style description for security alerts
export function describeRequest(req: Request): { device: string; ip: string; when: string } {
  const ua = String(req.headers['user-agent'] || '');
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'a browser';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iPhone/iPad'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'an unknown device';
  const ip = clientIp(req);
  const when = new Date().toUTCString().replace(' GMT', ' UTC');
  return { device: `${browser} on ${os}`, ip, when };
}

// Formatters are expensive to create: build one per precision and reuse it
const NUM_FORMATS = new Map<number, Intl.NumberFormat>();
const fmtNum = (n: any) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  const d = Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 4 : 6;
  let f = NUM_FORMATS.get(d);
  if (!f) NUM_FORMATS.set(d, (f = new Intl.NumberFormat('en-US', { maximumFractionDigits: d })));
  return f.format(v);
};

// Alerts for a completed analysis/chat, derived from the response the analysis route sent
function analysisAlert(user: AuthedUser, prompt: string, body: any, remaining: number | null) {
  const left = remaining == null ? [] : ([['Analyses left today', String(remaining)]] as [string, string][]);
  const s = body?.strategy;
  recordUsage(user.uid, s?.symbol ? 'analysis' : 'chat', s?.symbol || null);
  logActivity(
    user.uid,
    s?.symbol
      ? { type: 'analysis', title: `Analyzed ${s.symbol} (${s.timeframe || ''})`.replace(' ()', ''), detail: `${s.tradeType || ''} · ${prompt.slice(0, 120)}` }
      : { type: 'chat', title: 'Asked a question', detail: prompt.slice(0, 160) }
  );
  if (s && s.symbol) {
    const tp1 = s.takeProfits?.[0]?.price;
    notifyActivity(
      user.uid,
      {
        type: 'analysis',
        title: `${s.symbol} ${s.tradeType || ''} setup ready`.replace(/\s+/g, ' ').trim(),
        message: `Entry ${fmtNum(s.entryZone?.optimal)} · Stop ${fmtNum(s.stopLoss?.price)}${tp1 ? ` · Target ${fmtNum(tp1)}` : ''} (${s.timeframe || ''})`,
      },
      {
        subject: `Your ${s.symbol} analysis is ready`,
        lines: [`MarketX finished analysing ${s.symbol} on the ${s.timeframe || ''} timeframe. Here's the plan:`],
        options: {
          rows: [
            ['Direction', String(s.tradeType || s.bias || '-')],
            ['Entry', fmtNum(s.entryZone?.optimal)],
            ['Stop loss', fmtNum(s.stopLoss?.price)],
            ...(tp1 ? ([['Target 1', fmtNum(tp1)]] as [string, string][]) : []),
            ...(s.riskRewardRatio ? ([['Risk / reward', String(s.riskRewardRatio)]] as [string, string][]) : []),
            ...(s.confidenceScore ? ([['Confidence', `${s.confidenceScore}%`]] as [string, string][]) : []),
            ...left,
          ],
          cta: { label: 'View full analysis', url: siteLink('/') },
          note: 'Always manage your risk. You can turn off activity emails in MarketX → Notifications.',
        },
      }
    );
    return;
  }
  const answer = String(body?.content || body?.message || '')
    .replace(/[#*_`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!answer) return;
  const q = prompt.trim().replace(/\s+/g, ' ');
  notifyActivity(
    user.uid,
    { type: 'system', title: 'MarketX answered your question', message: `"${q.slice(0, 100)}${q.length > 100 ? '…' : ''}"` },
    {
      subject: 'MarketX answered your question',
      lines: [`You asked: "${q.slice(0, 300)}"`, `${answer.slice(0, 700)}${answer.length > 700 ? '…' : ''}`],
      options: {
        rows: left,
        cta: { label: 'Continue the chat', url: siteLink('/') },
        note: 'You can turn off activity emails in MarketX → Notifications.',
      },
    }
  );
}

// Wraps res.json so the alert is built from what the analysis route actually returned
function attachAnalysisAlerts(req: Request, res: Response, user: AuthedUser, remaining: number | null) {
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    if (res.statusCode < 400 && body && typeof body === 'object') {
      const prompt = String(req.body?.prompt || '');
      setImmediate(() => analysisAlert(user, prompt, body, remaining));
    }
    return originalJson(body);
  }) as Response['json'];
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
// Short-lived session check cache: under heavy traffic every authenticated call would otherwise read the user
// document. Entries live 10 seconds and are dropped immediately when this server bans, suspends, resets a
// password or deletes an account (invalidateAuthCache), so revocation stays effectively instant.
const AUTH_CACHE_TTL_MS = 10_000;
const AUTH_CACHE_MAX = 20_000;
const authCache = new Map<string, { v: number; status?: string; email: string; emailVerified: boolean; exp: number }>();
export function invalidateAuthCache(uid: string) {
  authCache.delete(uid);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of authCache) if (e.exp <= now) authCache.delete(k);
}, 30_000).unref();

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!isFirebaseConfigured() || !isSessionConfigured()) {
    return res.status(503).json({ error: 'AUTH_NOT_CONFIGURED', message: 'Accounts are not configured on this server yet.' });
  }
  const session = verifySessionToken(readSessionCookie(req) || '');
  if (!session) {
    return res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Please sign in to continue.' });
  }
  try {
    let entry = authCache.get(session.uid);
    if (!entry || entry.exp <= Date.now()) {
      const snap = await userRef(session.uid).get();
      const doc = snap.exists ? (snap.data() as UserDoc) : null;
      if (!doc) {
        authCache.delete(session.uid);
        return res.status(401).json({ error: 'AUTH_INVALID', message: 'Your session has expired. Please sign in again.' });
      }
      entry = {
        v: doc.sessionVersion || 0,
        status: doc.status,
        email: (doc.email || '').toLowerCase(),
        emailVerified: !!doc.emailVerified,
        exp: Date.now() + AUTH_CACHE_TTL_MS,
      };
      if (authCache.size >= AUTH_CACHE_MAX) authCache.delete(authCache.keys().next().value as string);
      authCache.set(session.uid, entry);
    }
    if (entry.v !== session.v) {
      return res.status(401).json({ error: 'AUTH_INVALID', message: 'Your session has expired. Please sign in again.' });
    }
    const blocked = blockedStatusMessage(entry.status as any);
    if (blocked) return res.status(403).json({ error: blocked.code, message: blocked.message });
    res.locals.user = {
      uid: session.uid,
      email: entry.email,
      emailVerified: entry.emailVerified,
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
          message: `Your account is ready with ${STARTING_CREDITS} SI credits and ${FREE_DAILY_LIMIT} daily analyses.`,
        });
        addNotificationInTx(tx, user.uid, {
          type: 'reward',
          title: `Campaign: Share Your Profile on X (+${X_SHARE_CREDITS} Credits)`,
          message: `Share your trader card on X to earn ${X_SHARE_CREDITS} SI credits after 10 hours.`,
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
      // Kept in their own pool too: campaign credits still work after the daily limit, until used up
      'credits.campaign': Math.max(0, loaded.doc.credits.campaign ?? 0) + reward.creditsAwarded,
      xShareReward: { ...reward, status: 'credited', notifiedOnSite: true, notifiedEmail: true },
    });
    addNotificationInTx(tx, user.uid, {
      type: 'reward',
      title: `+${reward.creditsAwarded} Credits Added to Your Account`,
      message: `You have been credited with ${reward.creditsAwarded} SI credits for sharing your profile on X.`,
    });
    return true;
  });
  if (credited) {
    sendEmail(
      user.email,
      `You earned ${X_SHARE_CREDITS} MarketX credits`,
      [`Thanks for sharing MarketX on X! ${X_SHARE_CREDITS} SI credits have been added to your account.`],
      { cta: { label: 'Use your credits', url: siteLink('/') } }
    );
  }
  return credited;
}

// Credits every campaign reward whose 10 hour window has passed, even if the user has not come back to the site.
// The unlock time is set by the server when the user joins; settleXShareReward re-checks it inside a transaction,
// so a reward is credited once and never before its unlock time.
export async function sweepDueXShareRewards(): Promise<number> {
  const snap = await db().collection('users').where('xShareReward.status', '==', 'pending').limit(500).get();
  const now = Date.now();
  let count = 0;
  for (const d of snap.docs) {
    const u = d.data() as UserDoc;
    if (!u.xShareReward || now < u.xShareReward.unlockAt) continue;
    try {
      if (await settleXShareReward({ uid: d.id, email: u.email, emailVerified: !!u.emailVerified })) count++;
    } catch (err: any) {
      console.warn('[MarketX Campaign] could not credit', d.id, err?.message || err);
    }
  }
  return count;
}

const EXPIRY_REMINDER_MS = 3 * DAY_MS;

async function readAccountState(user: AuthedUser) {
  let planAlert: 'reminder' | 'ended' | null = null;
  const doc = await db().runTransaction(async tx => {
    planAlert = null;
    const loaded = await loadUserInTx(tx, user.uid);
    if (!loaded) return null;
    saveNormalized(tx, loaded);
    const sub = loaded.doc.subscription;
    const now = Date.now();
    if (!isUnlimited(user) && sub.expiresAt > 0) {
      if (sub.active && sub.expiresAt - now <= EXPIRY_REMINDER_MS && loaded.doc.expiryReminderFor !== sub.expiresAt) {
        tx.update(loaded.ref, { expiryReminderFor: sub.expiresAt });
        planAlert = 'reminder';
      } else if (!sub.active && sub.expiresAt <= now && loaded.doc.expiryNoticeFor !== sub.expiresAt) {
        tx.update(loaded.ref, { expiryNoticeFor: sub.expiresAt });
        planAlert = 'ended';
      }
    }
    return loaded.doc;
  });
  if (!doc) return null;
  if (planAlert === 'reminder') {
    const days = Math.max(1, Math.ceil((doc.subscription.expiresAt - Date.now()) / DAY_MS));
    notifyActivity(
      user.uid,
      {
        type: 'credit',
        title: `Your Pro plan ends in ${days} day${days === 1 ? '' : 's'}`,
        message: 'Renew now to keep 10 daily analyses and your verified badge.',
        actionType: 'open_pricing',
      },
      {
        subject: `Your MarketX Pro plan ends in ${days} day${days === 1 ? '' : 's'}`,
        lines: [
          `Your Pro plan ends on ${new Date(doc.subscription.expiresAt).toDateString()}.`,
          'Renew to keep your 10 daily analyses and verified trader badge. Renewing early adds the time on top of what you have left.',
        ],
        options: { cta: { label: 'Renew Pro', url: siteLink('/') } },
        security: true,
      }
    );
  } else if (planAlert === 'ended') {
    notifyActivity(
      user.uid,
      {
        type: 'credit',
        title: 'Your Pro plan has ended',
        message: `You're back on Free with ${FREE_DAILY_LIMIT} analyses a day. Upgrade any time to get Pro back.`,
        actionType: 'open_pricing',
      },
      {
        subject: 'Your MarketX Pro plan has ended',
        lines: [
          `Your Pro plan ended on ${new Date(doc.subscription.expiresAt).toDateString()}, so your account is back on the Free plan (${FREE_DAILY_LIMIT} analyses a day).`,
          'Upgrade again whenever you like to get 10 daily analyses and your verified badge back.',
        ],
        options: { cta: { label: 'Get Pro again', url: siteLink('/') } },
        security: true,
      }
    );
  }
  const giftsSnap = await userRef(user.uid).collection('giftsSent').orderBy('timestamp', 'desc').limit(10).get();
  const recentGifts = giftsSnap.docs.map(d => d.data() as CreditGift);
  return { ...toClientState(doc, user), recentGifts };
}

// ---------------------------------------------------------------------------
// Analysis credit charging (used by /api/market/analyze)
// ---------------------------------------------------------------------------
export async function chargeAnalysisCredit(req: Request, res: Response, next: NextFunction) {
  const user = getUser(res);
  if (isUnlimited(user)) {
    attachAnalysisAlerts(req, res, user, null);
    return next();
  }
  try {
    const charged = await db().runTransaction(async tx => {
      const loaded = await loadUserInTx(tx, user.uid);
      if (!loaded) return { ok: false as const, reason: 'NO_ACCOUNT' };
      const c = loaded.doc.credits;
      saveNormalized(tx, loaded);
      // The daily limit is a hard stop until the 3:00 AM refill. The one exemption: credits earned from the X
      // campaign keep working after it, until they are used up.
      const campaign = Math.max(0, Math.min(c.campaign ?? 0, c.available));
      let dailyDelta = 0;
      let availableDelta = 0;
      let campaignDelta = 0;
      if (c.dailyRemaining > 0) {
        dailyDelta = 1;
        // Daily use never eats into campaign credits
        availableDelta = c.available - campaign > 0 ? 1 : 0;
      } else if (campaign > 0) {
        campaignDelta = 1;
        availableDelta = 1;
      } else {
        return { ok: false as const, reason: 'DAILY_LIMIT' };
      }
      tx.update(loaded.ref, {
        'credits.dailyRemaining': c.dailyRemaining - dailyDelta,
        'credits.available': c.available - availableDelta,
        'credits.campaign': campaign - campaignDelta,
      });
      return {
        ok: true as const,
        dailyDelta,
        availableDelta,
        campaignDelta,
        campaignLeft: campaign - campaignDelta,
        remaining: c.dailyRemaining - dailyDelta,
        limit: c.dailyLimit,
      };
    });

    if (!charged.ok) {
      const limitReached = charged.reason === 'DAILY_LIMIT';
      return res.status(limitReached ? 402 : 409).json({
        error: charged.reason,
        nextDailyResetAt: limitReached ? nextDailyReset() : undefined,
        message: limitReached
          ? `You've reached today's analysis limit. Your analyses refill automatically at ${CREDIT_RESET_LABEL}.`
          : 'Account not initialised. Please sign in again.',
      });
    }

    attachAnalysisAlerts(req, res, user, charged.remaining);
    // Refund the credit if the analysis request fails
    res.on('finish', () => {
      if (res.statusCode < 400) {
        if (charged.dailyDelta && charged.remaining === 0) {
          notifyActivity(user.uid, {
            type: 'system',
            title: `You've used today's ${charged.limit} analyses`,
            message:
              charged.campaignLeft > 0
                ? `Your ${charged.campaignLeft} campaign credit${charged.campaignLeft === 1 ? '' : 's'} keep you going until they run out. Daily analyses refill at ${CREDIT_RESET_LABEL}.`
                : `New prompts are paused until your analyses refill automatically at ${CREDIT_RESET_LABEL}. Pro gives you more each day.`,
            actionType: 'open_pricing',
          });
        } else if (charged.campaignDelta && charged.campaignLeft === 0) {
          notifyActivity(user.uid, {
            type: 'system',
            title: 'Campaign credits used up',
            message: `New prompts are paused until your daily analyses refill automatically at ${CREDIT_RESET_LABEL}.`,
            actionType: 'open_pricing',
          });
        }
        return;
      }
      userRef(user.uid)
        .update({
          'credits.dailyRemaining': FieldValue.increment(charged.dailyDelta),
          'credits.available': FieldValue.increment(charged.availableDelta),
          'credits.campaign': FieldValue.increment(charged.campaignDelta),
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
const MAX_ANALYSES_BYTES = 900_000;
const MAX_SESSIONS_PER_USER = 200;
// Letters, digits, "_", "-" and "." — but never "." / ".." or Firestore-reserved "__…__" ids
const SAFE_ID = /^(?!\.{1,2}$)(?!__.*__$)[\w.-]{1,100}$/;

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
    messages: stripReservedKeys(cleaned),
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
  // Campaign rewards land on time: check every 5 minutes for rewards past their 10 hour wait
  if (isFirebaseConfigured() && IS_LEAD_WORKER) {
    const sweep = () =>
      sweepDueXShareRewards()
        .then(n => n && console.log(`[MarketX Campaign] credited ${n} campaign reward(s)`))
        .catch(err => console.warn('[MarketX Campaign] reward sweep failed:', err?.message || err));
    setTimeout(sweep, 45 * 1000).unref();
    setInterval(sweep, 5 * 60 * 1000).unref();
  }
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

    let profileChanges: string[] = [];
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
      const changes: string[] = [];
      if (username !== current.usernameLower) changes.push(`username changed from @${current.username} to @${username}`);
      if (displayName !== current.displayName) changes.push(`display name changed to "${displayName}"`);
      if ((avatarUrl || null) !== (current.avatarUrl || null)) changes.push('profile picture updated');
      profileChanges = changes;
    }).catch(err => {
      if (err?.message === 'USERNAME_TAKEN') {
        res.status(409).json({ error: 'USERNAME_TAKEN', message: `@${username} is already taken.` });
        return;
      }
      throw err;
    });
    if (res.headersSent) return;
    if (profileChanges.length) {
      const summary = profileChanges.join(', ');
      logActivity(user.uid, { type: 'profile', title: 'Updated profile', detail: summary });
      notifyActivity(
        user.uid,
        { type: 'system', title: 'Profile updated', message: summary.charAt(0).toUpperCase() + summary.slice(1) + '.' },
        {
          subject: 'Your MarketX profile was updated',
          lines: [
            `These changes were made to your profile: ${summary}.`,
            "If this wasn't you, reset your password straight away.",
          ],
          security: profileChanges.some(c => c.startsWith('username')),
        }
      );
    }
    res.json({ success: true, ...(await readAccountState(user)) });
  }));

  // --- Email preferences (activity emails can be turned off; security emails always send) ---
  app.put('/api/account/email-prefs', limiter, requireAuth, wrap(async (req, res) => {
    const user = getUser(res);
    const activity = req.body?.activity !== false;
    await userRef(user.uid).update({ emailPrefs: { activity } });
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
    // Keep a small index so one account can't grow its history without bound: the oldest
    // sessions are dropped once the cap is reached.
    const sessions = userRef(uid).collection('sessions');
    const indexRef = userRef(uid).collection('meta').doc('sessionIndex');
    await db().runTransaction(async tx => {
      const snap = await tx.get(indexRef);
      const ids: Record<string, number> = { ...((snap.exists && (snap.data() as any)?.ids) || {}) };
      ids[id] = session.updatedAt;
      const overflow = Object.keys(ids).length - MAX_SESSIONS_PER_USER;
      if (overflow > 0) {
        const oldest = Object.entries(ids)
          .filter(([k]) => k !== id)
          .sort((a, b) => a[1] - b[1])
          .slice(0, overflow);
        for (const [k] of oldest) {
          delete ids[k];
          tx.delete(sessions.doc(k));
        }
      }
      tx.set(indexRef, { ids });
      tx.set(sessions.doc(id), session);
    });
    res.json({ success: true });
  }));

  app.delete('/api/history/sessions/:id', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const id = String(req.params.id);
    if (!SAFE_ID.test(id)) return res.status(400).json({ error: 'INVALID_ID' });
    await userRef(uid).collection('sessions').doc(id).delete();
    const indexRef = userRef(uid).collection('meta').doc('sessionIndex');
    await db()
      .runTransaction(async tx => {
        const snap = await tx.get(indexRef);
        const ids = { ...((snap.exists && (snap.data() as any)?.ids) || {}) };
        if (!(id in ids)) return;
        delete ids[id];
        tx.set(indexRef, { ids });
      })
      .catch(() => {});
    res.json({ success: true });
  }));

  app.delete('/api/history/sessions', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    await db().recursiveDelete(userRef(uid).collection('sessions'));
    await userRef(uid).collection('meta').doc('sessionIndex').delete().catch(() => {});
    res.json({ success: true });
  }));

  app.put('/api/history/analyses', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const raw = Array.isArray(req.body?.analyses) ? req.body.analyses.slice(0, 500) : [];
    const items = stripReservedKeys(JSON.parse(JSON.stringify(raw)) as any[]).filter(i => i && typeof i === 'object' && !Array.isArray(i));
    // Stay under Firestore's 1 MiB document limit: drop the oldest entries (newest are first)
    while (items.length > 0 && Buffer.byteLength(JSON.stringify(items)) > MAX_ANALYSES_BYTES) items.pop();
    await userRef(uid).collection('meta').doc('analyses').set({ items });
    res.json({ success: true });
  }));

  // --- Notifications ---
  app.get('/api/notifications', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    // ?since=<ms>: only newer items (cheap background polling); otherwise the latest 50
    const since = Number(req.query.since);
    if (Number.isFinite(since) && since > 0) {
      const snap = await notificationsCol(uid).where('timestamp', '>', since).orderBy('timestamp', 'desc').limit(50).get();
      return res.json({ success: true, incremental: true, notifications: snap.docs.map(d => d.data()) });
    }
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
        message: note ? `"${note}"` : `${amount} SI credits have been added to your balance.`,
      });
      return { gift, recipientEmail: recipient.doc.email, senderUsername: sender.doc.username };
    });

    if ('error' in result) {
      const status = result.error === 'NOT_FOUND' ? 404 : result.error === 'INSUFFICIENT' ? 402 : 400;
      return res.status(status).json(result);
    }
    sendEmail(
      result.recipientEmail,
      `@${result.senderUsername} gifted you ${amount} MarketX credits`,
      [`@${result.senderUsername} just sent you ${amount} SI credits on MarketX.`, ...(note ? [`Their note: "${note}"`] : [])],
      { cta: { label: 'Use your credits', url: siteLink('/') } }
    );
    logActivity(user.uid, { type: 'gift', title: `Gifted ${amount} credits to @${result.gift.toUsername}`, detail: note || '' }, result.senderUsername);
    notifyActivity(
      user.uid,
      { type: 'credit', title: `You sent ${amount} credits to @${result.gift.toUsername}`, message: note ? `Your note: "${note}"` : 'The credits are already in their balance.' },
      {
        subject: `You gifted ${amount} MarketX credits to @${result.gift.toUsername}`,
        lines: [`${amount} SI credits were sent from your account to @${result.gift.toUsername}.`],
        options: { rows: [['Recipient', `@${result.gift.toUsername}`], ['Amount', `${amount} credits`]] },
      }
    );
    res.json({ success: true, gift: result.gift, ...(await readAccountState(user)) });
  }));

  // --- X share campaign: user is sent to X with a pre-written post; credits unlock 10h later (server-timed, once per account) ---
  app.post('/api/rewards/x-share', limiter, requireAuth, wrap(async (req, res) => {
    const user = getUser(res);
    const result = await db().runTransaction(async tx => {
      const loaded = await loadUserInTx(tx, user.uid);
      if (!loaded) return { error: 'NO_ACCOUNT', message: 'Account not found.' };
      if (loaded.doc.xShareReward) return { error: 'ALREADY_CLAIMED', message: 'You have already claimed this campaign. It can only be claimed once.' };
      const emailKey = emailClaimKey(loaded.doc.email);
      const [byEmail, byUid] = await Promise.all([tx.get(campaignClaimRef(emailKey)), tx.get(campaignClaimRef('u_' + user.uid))]);

      const now = Date.now();
      if (byEmail.exists || byUid.exists) {
        // Claimed before (e.g. on a deleted account with the same email): mark this account as completed, no credits
        const previous = (byEmail.data() || byUid.data()) as { at?: number } | undefined;
        saveNormalized(tx, loaded);
        tx.update(loaded.ref, {
          xShareReward: {
            id: newId('x-share'),
            username: loaded.doc.username,
            email: loaded.doc.email,
            sharedAt: previous?.at || now,
            unlockAt: previous?.at || now,
            creditsAwarded: 0,
            status: 'credited',
            notifiedOnSite: true,
            notifiedEmail: true,
            previouslyClaimed: true,
          } as XShareReward,
        });
        return { error: 'ALREADY_CLAIMED', message: 'This campaign was already claimed with this email. It can only be claimed once per person.' };
      }
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
      tx.set(campaignClaimRef(emailKey), { at: now, campaign: 'x-share' });
      tx.set(campaignClaimRef('u_' + user.uid), { at: now, campaign: 'x-share' });
      return { reward };
    });

    if ('error' in result) return res.status(result.error === 'NO_ACCOUNT' ? 404 : 409).json(result);
    notifyActivity(
      user.uid,
      {
        type: 'reward',
        title: `Campaign joined: +${X_SHARE_CREDITS} credits on the way`,
        message: `Your credits unlock ${new Date(result.reward!.unlockAt).toUTCString().replace(' GMT', ' UTC')}.`,
      },
      {
        subject: `You joined the MarketX X campaign (+${X_SHARE_CREDITS} credits)`,
        lines: [
          `Thanks for sharing MarketX on X! Your ${X_SHARE_CREDITS} SI credits unlock 10 hours after you posted.`,
          "We'll email you again the moment they land in your balance.",
        ],
      }
    );
    res.json({ success: true, ...(await readAccountState(user)) });
  }));
}

// Shared helpers for the payments module
export { userRef, usernameRef, loadUserInTx, saveNormalized, readAccountState, getUser };
