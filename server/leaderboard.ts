// ===========================================================================
// Leaderboard (usage this month + referrals) and invite links (owner-specified).
//
//   leaderboards/{YYYY-MM}/entries/{uid}  -> monthly usage points (server/usageMonthly.ts), a fresh board each month
//   users.referral                        -> { code, invited, earned, months: { "2026-10": n } }; users.referredBy
//   referralCodes/{CODE}                  -> { uid, at }  (the invite link's code, random, never the account id)
//   referrals/{newUid}                    -> { uid, referrerUid, at, month, credits }  (one per account that joined)
//   referralClaims/{sha256(canonical email)} -> one invite counted per person, ever (deleted + re-made accounts too)
//   adminConfig/inviteRewards             -> { enabled, credits, maxPerMonth }  (OFF until the owner turns it on)
//   adminConfig/inviteStats               -> { total, credits, months: {...} }
//
// A referral is recorded only when an invited sign-up redeems its pass code (the same one-device / one-email guard
// as every sign-up). Rewards are given only while the admin has the program on, inside the same transaction, as
// campaign credits (spent first, like every reward). Public boards show display name, username, picture and badge
// only: never emails, ids or who invited whom. Traders can hide themselves from the boards.
// ===========================================================================
import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db, isFirebaseConfigured } from './firebase';
import { addNotificationInTx, getUser, isUnlimitedEmail, loadUserInTx, requireAuth, saveNormalized, type UserDoc } from './account';
import { adminLog, requireAdmin } from './admin';
import { canonicalEmail } from './signupGuard';
import { clientIp, createKeyedThrottle } from './security';
import { safeAvatar } from './trust';
import { bestStreak, entriesCol, isMonthKey, monthKey, nextMonthStart, previousMonth, tierOf, USAGE_POINTS, ACTIVE_DAY_BONUS } from './usageMonthly';

const BOARD_SIZE = 50;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_INVITE_CREDITS = 500;

const users = () => db().collection('users');
const codeRef = (code: string) => db().collection('referralCodes').doc(code);
const settingsRef = () => db().collection('adminConfig').doc('inviteRewards');
const statsRef = () => db().collection('adminConfig').doc('inviteStats');
const claimRef = (email: string) =>
  db()
    .collection('referralClaims')
    .doc(crypto.createHash('sha256').update(`marketx-referral:${canonicalEmail(email)}`).digest('hex'));

export interface InviteRewards {
  enabled: boolean;
  credits: number;
  /** Rewarded invites per inviter per month (0 = no cap) */
  maxPerMonth: number;
  updatedAt?: number;
}
const DEFAULT_REWARDS: InviteRewards = { enabled: false, credits: 0, maxPerMonth: 20 };

function cleanRewards(v: any): InviteRewards {
  const credits = Math.max(0, Math.min(MAX_INVITE_CREDITS, Math.floor(Number(v?.credits) || 0)));
  return {
    // A program with no credits gives nothing, so it reads as off
    enabled: v?.enabled === true && credits > 0,
    credits,
    maxPerMonth: Math.max(0, Math.min(1000, Math.floor(Number(v?.maxPerMonth ?? DEFAULT_REWARDS.maxPerMonth) || 0))),
    ...(typeof v?.updatedAt === 'number' ? { updatedAt: v.updatedAt } : {}),
  };
}
let rewardsCache: { at: number; v: InviteRewards } | null = null;
export async function readInviteRewards(fresh = false): Promise<InviteRewards> {
  if (!fresh && rewardsCache && Date.now() - rewardsCache.at < 15_000) return rewardsCache.v;
  const snap = await settingsRef().get();
  const v = snap.exists ? cleanRewards(snap.data()) : { ...DEFAULT_REWARDS };
  rewardsCache = { at: Date.now(), v };
  return v;
}

/** "mx 7k2p q9xd" / "MX7K2PQ9XD" → "7K2PQ9XD"; null when it can't be a code */
export function normalizeRefCode(raw: unknown): string | null {
  const s = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{6,12}$/.test(s) ? s : null;
}
function newCode(): string {
  return Array.from(crypto.randomBytes(8), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** The trader's invite code (made once, on first ask) */
export async function ensureReferralCode(uid: string): Promise<string> {
  const snap = await users().doc(uid).get();
  const have = (snap.data() as any)?.referral?.code;
  if (typeof have === 'string' && have) return have;
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const made = await db().runTransaction(async tx => {
      const [c, u] = [await tx.get(codeRef(code)), await tx.get(users().doc(uid))];
      if (!u.exists) throw new Error('no account');
      const existing = (u.data() as any)?.referral?.code;
      if (existing) return existing as string;
      if (c.exists) return null;
      tx.set(codeRef(code), { uid, at: Date.now() });
      tx.update(users().doc(uid), { 'referral.code': code });
      return code;
    });
    if (made) return made;
  }
  throw new Error('could not make an invite code');
}

const blocked = (u: Partial<UserDoc> | undefined) => !u || u.status === 'banned' || u.status === 'suspended';

/**
 * Records that a new account joined with an invite code (called once, right after the pass code made the account).
 * Never throws: a bad or unknown code just means no referral.
 */
export async function recordReferral(newUid: string, rawCode: unknown, email: string): Promise<boolean> {
  const code = normalizeRefCode(rawCode);
  if (!code || !isFirebaseConfigured()) return false;
  try {
    const settings = await readInviteRewards(true);
    const now = Date.now();
    const month = monthKey(now);
    const result = await db().runTransaction(async tx => {
      const c = await tx.get(codeRef(code));
      const referrerUid = c.exists ? String(c.data()?.uid || '') : '';
      if (!referrerUid || referrerUid === newUid) return null;
      const already = await tx.get(db().collection('referrals').doc(newUid));
      const claim = await tx.get(claimRef(email));
      if (already.exists || claim.exists) return null;
      const statsSnap = await tx.get(statsRef());
      const loaded = await loadUserInTx(tx, referrerUid);
      const joined = await tx.get(users().doc(newUid));
      if (!loaded || blocked(loaded.doc) || !joined.exists) return null;
      const ref: any = (loaded.doc as any).referral || {};
      const rewardedThisMonth = Number(ref.rewardedMonths?.[month] || 0);
      const capped = settings.maxPerMonth > 0 && rewardedThisMonth >= settings.maxPerMonth;
      const credits = settings.enabled && !capped ? settings.credits : 0;
      const newName = String((joined.data() as any)?.username || '');

      saveNormalized(tx, loaded);
      tx.update(loaded.ref, {
        'referral.invited': FieldValue.increment(1),
        [`referral.months.${month}`]: FieldValue.increment(1),
        'referral.lastAt': now,
        ...(credits
          ? {
              'referral.earned': FieldValue.increment(credits),
              [`referral.rewardedMonths.${month}`]: FieldValue.increment(1),
              'credits.available': FieldValue.increment(credits),
              // Reward credits join the campaign pool: spent first, daily analyses kept for after
              'credits.campaign': Math.max(0, loaded.doc.credits.campaign ?? 0) + credits,
            }
          : {}),
      });
      tx.update(users().doc(newUid), { referredBy: referrerUid });
      tx.set(db().collection('referrals').doc(newUid), { uid: newUid, referrerUid, at: now, month, credits, username: newName });
      tx.set(claimRef(email), { at: now, uid: newUid, referrerUid });
      const st: any = statsSnap.exists ? statsSnap.data() : {};
      tx.set(statsRef(), {
        total: (Number(st.total) || 0) + 1,
        credits: (Number(st.credits) || 0) + credits,
        months: { ...(st.months || {}), [month]: (Number(st.months?.[month]) || 0) + 1 },
      });
      addNotificationInTx(tx, referrerUid, {
        type: 'reward',
        title: credits ? `+${credits} credits: @${newName || 'a trader'} joined with your invite` : `@${newName || 'A trader'} joined with your invite`,
        message: credits
          ? `Thanks for inviting a trader to MarketX. ${credits} invite credits were added. They are used first, and your daily analyses are kept for after they run out.`
          : 'Thanks for inviting a trader to MarketX. It counts on the referrals leaderboard.',
      });
      return { referrerUid, credits };
    });
    return !!result;
  } catch (err: any) {
    console.warn('[MarketX Referrals] could not record a referral:', err?.message || err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------
type Person = { username: string; displayName: string; avatarUrl: string | null; verified: boolean };
function personOf(u: UserDoc): Person {
  const now = Date.now();
  const staff = !!u.emailVerified && isUnlimitedEmail(u.email);
  const pro = !!u.subscription?.active && (!u.subscription.expiresAt || u.subscription.expiresAt > now);
  return { username: u.username, displayName: u.displayName, avatarUrl: safeAvatar(u.avatarUrl), verified: staff || pro };
}
/** Shown on public boards: not banned/suspended, not hidden by the trader, not unlimited staff (they don't compete) */
const listable = (u: UserDoc | undefined): u is UserDoc => !!u && !blocked(u) && !(u as any).leaderboardHidden && !isUnlimitedEmail(u.email);

async function loadUsers(uids: string[]): Promise<Map<string, UserDoc>> {
  const out = new Map<string, UserDoc>();
  const snaps = await Promise.all(uids.map(id => users().doc(id).get()));
  snaps.forEach((s, i) => s.exists && out.set(uids[i], s.data() as UserDoc));
  return out;
}

function topPair(pairs: Record<string, { name: string; count: number }> | undefined): string | null {
  const list = Object.values(pairs || {});
  if (!list.length) return null;
  return list.sort((a, b) => b.count - a.count)[0].name;
}
function usageRow(e: any) {
  return {
    points: Number(e.points) || 0,
    tier: tierOf(Number(e.points) || 0),
    analyses: Number(e.analyses) || 0,
    questions: Number(e.questions) || 0,
    fundamentals: Number(e.fundamentals) || 0,
    matt: Number(e.matt) || 0,
    activeDays: Object.keys(e.days || {}).length,
    streak: bestStreak(e.days),
    topPair: topPair(e.pairs),
    lastAt: Number(e.lastAt) || null,
  };
}

/** A month's usage board (internal: carries uids; the public route strips them) */
async function usageBoard(month: string, size: number, opts: { admin?: boolean } = {}) {
  const snap = await entriesCol(month).orderBy('points', 'desc').limit(size + 30).get();
  const entries = snap.docs.map(d => ({ uid: d.id, ...(d.data() as any) })).filter(e => (Number(e.points) || 0) > 0);
  const people = await loadUsers(entries.map(e => e.uid));
  const rows = entries
    .filter(e => (opts.admin ? people.has(e.uid) : listable(people.get(e.uid))))
    .slice(0, size)
    .map((e, i) => ({ uid: e.uid, rank: i + 1, ...personOf(people.get(e.uid)!), ...usageRow(e), user: people.get(e.uid)! }));
  return rows;
}
async function referralBoard(size: number, opts: { admin?: boolean } = {}) {
  const snap = await users().orderBy('referral.invited', 'desc').limit(size + 30).get();
  const month = monthKey();
  return snap.docs
    .map(d => ({ uid: d.id, user: d.data() as UserDoc }))
    .filter(r => Number((r.user as any).referral?.invited) > 0 && (opts.admin || listable(r.user)))
    .slice(0, size)
    .map((r, i) => {
      const ref: any = (r.user as any).referral || {};
      return {
        uid: r.uid,
        rank: i + 1,
        ...personOf(r.user),
        invited: Number(ref.invited) || 0,
        thisMonth: Number(ref.months?.[month]) || 0,
        earned: Number(ref.earned) || 0,
        user: r.user,
      };
    });
}

// One read per board per worker every 30s serves every viewer
const cache = new Map<string, { at: number; v: any }>();
async function cached<T>(key: string, ms: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ms) return hit.v;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 50) cache.delete(cache.keys().next().value as string);
  return v;
}
const strip = <T extends { uid: string; user: UserDoc }>(rows: T[], me: string) =>
  rows.map(({ uid, user: _u, ...rest }) => ({ ...rest, ...(uid === me ? { isMe: true } : {}) }));

async function myUsage(uid: string, month: string) {
  const s = await entriesCol(month).doc(uid).get();
  const e: any = s.exists ? s.data() : null;
  const points = Number(e?.points) || 0;
  let rank: number | null = null;
  if (points > 0) {
    try {
      const c = await (entriesCol(month).where('points', '>', points) as any).count().get();
      rank = Number(c.data().count) + 1;
    } catch {
      rank = null;
    }
  }
  return { rank, ...usageRow(e || {}) };
}

export function registerLeaderboardRoutes(app: Express, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  const wrap =
    (fn: (req: Request, res: Response) => Promise<any>) =>
    (req: Request, res: Response) =>
      fn(req, res).catch(err => {
        console.error(`[MarketX Leaderboard] ${req.method} ${req.path} failed:`, err?.message || err);
        if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
      });
  const ready = (_req: Request, res: Response, next: NextFunction) =>
    isFirebaseConfigured() ? next() : res.status(503).json({ error: 'UNAVAILABLE', message: 'The leaderboard is not available right now.' });
  const perTrader = createKeyedThrottle({ windowMs: 60_000, max: 40 });
  const throttle = (req: Request, res: Response, next: NextFunction) =>
    perTrader.hit(getUser(res).uid) ? res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many requests. Wait a moment.' }) : next();

  // Either board, plus where the signed-in trader stands
  app.get('/api/leaderboard', limiter, ready, requireAuth, throttle, wrap(async (req, res) => {
    const me = getUser(res).uid;
    const board = req.query.board === 'referrals' ? 'referrals' : 'usage';
    const meDoc = (await users().doc(me).get()).data() as any;
    const hidden = !!meDoc?.leaderboardHidden;
    if (board === 'usage') {
      const month = monthKey();
      const prev = previousMonth(month);
      const [rows, mine, last] = await Promise.all([
        cached(`u:${month}`, 30_000, () => usageBoard(month, BOARD_SIZE)),
        myUsage(me, month),
        cached(`u:${prev}:top`, 10 * 60_000, () => usageBoard(prev, 3)),
      ]);
      // Shown in the list: the rank there is the one on the trader's card too
      const listed = rows.find(r => r.uid === me);
      if (listed) mine.rank = listed.rank;
      return res.json({
        board,
        month,
        resetsAt: nextMonthStart(),
        scoring: { points: USAGE_POINTS, activeDay: ACTIVE_DAY_BONUS },
        rows: strip(rows, me),
        me: { ...mine, hidden },
        lastMonth: { month: prev, top: strip(last, me).map(r => ({ rank: r.rank, username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl, verified: r.verified, points: r.points, tier: r.tier })) },
      });
    }
    const rows = await cached('r', 30_000, () => referralBoard(BOARD_SIZE));
    const ref = meDoc?.referral || {};
    const invited = Number(ref.invited) || 0;
    const inList = rows.find(r => r.uid === me);
    let rank: number | null = inList ? inList.rank : null;
    if (!rank && invited > 0) {
      try {
        const c = await (users().where('referral.invited', '>', invited) as any).count().get();
        rank = Number(c.data().count) + 1;
      } catch {
        rank = null;
      }
    }
    const program = await readInviteRewards();
    res.json({
      board,
      month: monthKey(),
      // Other traders' earned credits stay private (only counts are public)
      rows: strip(rows, me).map(({ earned: _e, ...r }) => r),
      me: { rank, invited, thisMonth: Number(ref.months?.[monthKey()]) || 0, earned: Number(ref.earned) || 0, hidden },
      program: { enabled: program.enabled, credits: program.enabled ? program.credits : 0 },
    });
  }));

  // Show or hide me on the boards
  app.post('/api/leaderboard/visibility', limiter, ready, requireAuth, throttle, wrap(async (req, res) => {
    const hidden = req.body?.hidden === true;
    await users().doc(getUser(res).uid).update({ leaderboardHidden: hidden });
    cache.clear();
    res.json({ success: true, hidden });
  }));

  // The trader's invite link and what it has earned
  app.get('/api/referrals/me', limiter, ready, requireAuth, throttle, wrap(async (_req, res) => {
    const uid = getUser(res).uid;
    const code = await ensureReferralCode(uid);
    const u = (await users().doc(uid).get()).data() as any;
    const ref = u?.referral || {};
    const program = await readInviteRewards();
    res.json({
      code,
      invited: Number(ref.invited) || 0,
      thisMonth: Number(ref.months?.[monthKey()]) || 0,
      earned: Number(ref.earned) || 0,
      program: { enabled: program.enabled, credits: program.enabled ? program.credits : 0 },
    });
  }));

  // Public: who sent this invite (shown on the sign-up screen). Codes are random, so they can't be guessed.
  const perIp = createKeyedThrottle({ windowMs: 60_000, max: 30 });
  app.get('/api/referrals/code/:code', limiter, ready, wrap(async (req, res) => {
    if (perIp.hit(clientIp(req))) return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many requests.' });
    const code = normalizeRefCode(req.params.code);
    const c = code ? await codeRef(code).get() : null;
    const uid = c?.exists ? String(c.data()?.uid || '') : '';
    const u = uid ? ((await users().doc(uid).get()).data() as UserDoc | undefined) : undefined;
    if (!u || blocked(u)) return res.json({ valid: false });
    const p = personOf(u);
    res.json({ valid: true, code, inviter: { displayName: p.displayName, username: p.username, avatarUrl: p.avatarUrl } });
  }));

  // ----- Admin -----
  app.get('/api/admin/invite-rewards', requireAdmin, wrap(async (_req, res) => {
    const [settings, stats] = await Promise.all([readInviteRewards(true), statsRef().get()]);
    const s: any = stats.exists ? stats.data() : {};
    res.json({ settings, stats: { total: Number(s.total) || 0, credits: Number(s.credits) || 0, thisMonth: Number(s.months?.[monthKey()]) || 0 }, maxCredits: MAX_INVITE_CREDITS });
  }));

  app.put('/api/admin/invite-rewards', requireAdmin, wrap(async (req, res) => {
    const body = req.body || {};
    const credits = Math.floor(Number(body.credits));
    if (!Number.isFinite(credits) || credits < 0 || credits > MAX_INVITE_CREDITS) {
      return res.status(400).json({ error: 'INVALID_CREDITS', message: `Credits per invite must be between 0 and ${MAX_INVITE_CREDITS}.` });
    }
    if (body.enabled === true && credits < 1) {
      return res.status(400).json({ error: 'INVALID_CREDITS', message: 'Set at least 1 credit per invite before turning the program on.' });
    }
    const maxPerMonth = Math.floor(Number(body.maxPerMonth ?? DEFAULT_REWARDS.maxPerMonth));
    if (!Number.isFinite(maxPerMonth) || maxPerMonth < 0 || maxPerMonth > 1000) {
      return res.status(400).json({ error: 'INVALID_CAP', message: 'The monthly cap must be between 0 (no cap) and 1000.' });
    }
    const next = cleanRewards({ enabled: body.enabled === true, credits, maxPerMonth, updatedAt: Date.now() });
    await settingsRef().set(next);
    rewardsCache = null;
    adminLog('invite_rewards', { enabled: next.enabled, credits: next.credits, maxPerMonth: next.maxPerMonth });
    res.json({ success: true, settings: next });
  }));

  app.get('/api/admin/leaderboard', requireAdmin, wrap(async (req, res) => {
    const board = req.query.board === 'referrals' ? 'referrals' : 'usage';
    const adminRow = (r: any) => {
      const u: UserDoc = r.user;
      const { user: _u, ...rest } = r;
      return { ...rest, email: u.email, status: u.status || 'active', hidden: !!(u as any).leaderboardHidden, staff: isUnlimitedEmail(u.email) };
    };
    if (board === 'usage') {
      const month = isMonthKey(req.query.month) ? String(req.query.month) : monthKey();
      const months: string[] = [];
      for (let m = monthKey(), i = 0; i < 12; i++, m = previousMonth(m)) months.push(m);
      const rows = await usageBoard(month, 100, { admin: true });
      const total = rows.reduce(
        (t, r) => ({ points: t.points + r.points, analyses: t.analyses + r.analyses, questions: t.questions + r.questions, fundamentals: t.fundamentals + r.fundamentals, matt: t.matt + r.matt }),
        { points: 0, analyses: 0, questions: 0, fundamentals: 0, matt: 0 }
      );
      return res.json({ board, month, months, resetsAt: nextMonthStart(), rows: rows.map(adminRow), total });
    }
    const [rows, recentSnap] = await Promise.all([referralBoard(100, { admin: true }), db().collection('referrals').orderBy('at', 'desc').limit(50).get()]);
    const recent = recentSnap.docs.map(d => d.data() as any);
    const inviters = await loadUsers([...new Set(recent.map(r => String(r.referrerUid || '')).filter(Boolean))]);
    res.json({
      board,
      rows: rows.map(adminRow),
      recent: recent.map(r => ({
        at: r.at,
        joined: r.username || null,
        inviter: inviters.get(r.referrerUid)?.username || null,
        credits: Number(r.credits) || 0,
      })),
    });
  }));
}

/** Account deletion: the trader's leaderboard rows, invite code and referral records */
export async function deleteLeaderboardData(uid: string, code?: string | null) {
  const tasks: Promise<unknown>[] = [];
  for (let m = monthKey(), i = 0; i < 24; i++, m = previousMonth(m)) tasks.push(entriesCol(m).doc(uid).delete());
  if (code) tasks.push(codeRef(code).delete());
  tasks.push(db().collection('referrals').doc(uid).delete());
  await Promise.allSettled(tasks);
  cache.clear();
}
