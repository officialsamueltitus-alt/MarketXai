// ===========================================================================
// Leaderboard (usage this month + referrals) and invite links (owner-specified).
//
//   leaderboards/{YYYY-MM}/entries/{uid}  -> monthly usage points (server/usageMonthly.ts), a fresh board each month;
//                                            once the month is over: finalRank (everyone), publicRank (listed), tierId
//   leaderboards/{YYYY-MM}                -> { finalizedAt, traders, winners: top 3 listed (uid server-only) }
//
// Live board: each worker keeps one Firestore listener on this month's top LIVE_LIMIT entries (reads only what changes),
// so the board a trader sees is current to the second; the app refreshes it every few seconds while it is open.
// When a month ends the lead worker freezes it (finalizeMonth): every entry gets its final standing and tier, and the
// month's top 3 are kept as "past months winners".
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
import { IS_LEAD_WORKER } from './workers';
import { addNotificationInTx, getUser, isUnlimitedEmail, loadUserInTx, requireAuth, saveNormalized, type UserDoc } from './account';
import { adminLog, requireAdmin } from './admin';
import { canonicalEmail } from './signupGuard';
import { clientIp, createKeyedThrottle } from './security';
import { safeAvatar } from './trust';
import { bestStreak, entriesCol, isMonthKey, monthKey, nextMonthStart, previousMonth, tierOf, USAGE_POINTS, ACTIVE_DAY_BONUS } from './usageMonthly';

const BOARD_SIZE = 50;
const LIVE_LIMIT = 200;
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
// Accounts the owner keeps off the boards for good (owner-specified). Matched by a one-way fingerprint of the email, so no
// address is written in the code; more are blocked from Admin → Leaderboard (users.leaderboardBlocked).
const blockKey = (email: string) => crypto.createHash('sha256').update(`marketx-lbblock:${String(email || '').trim().toLowerCase()}`).digest('hex');
const BLOCKED_KEYS = new Set(['e833992946340b3be1b820fefd2751654fc7ba2cbd0a3faa93169a1edac3e423']);
// Same, by MarketX ID (fingerprinted too): matched once against the ID index, then the account carries leaderboardBlocked
const idBlockKey = (id: string) => crypto.createHash('sha256').update(`marketx-lbblock-id:${id}`).digest('hex');
const BLOCKED_ID_KEYS = new Set(['825bd36169856e88a0b3f0b64111ac81122c2283aeb09d31711f78196d837c28']);
/** Kept off every public board, whatever the trader's own switch says */
export const leaderboardBlocked = (u: Partial<UserDoc> | undefined) => !!u && (!!(u as any).leaderboardBlocked || (!!u.email && BLOCKED_KEYS.has(blockKey(u.email))));
const listable = (u: UserDoc | undefined): u is UserDoc =>
  !!u && !blocked(u) && !(u as any).leaderboardHidden && !leaderboardBlocked(u) && !isUnlimitedEmail(u.email);

async function loadUsers(uids: string[]): Promise<Map<string, UserDoc>> {
  const out = new Map<string, UserDoc>();
  const ids = [...new Set(uids.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 100) {
    const snaps = await db().getAll(...ids.slice(i, i + 100).map(id => users().doc(id)));
    snaps.forEach(s => s.exists && out.set(s.id, s.data() as UserDoc));
  }
  return out;
}

// Who is on the live board: profiles cached for a short while (a new name or picture shows within PEOPLE_TTL)
const PEOPLE_TTL = 90_000;
const people = new Map<string, { at: number; u: UserDoc | null }>();
async function peopleFor(uids: string[]): Promise<Map<string, UserDoc>> {
  const now = Date.now();
  const stale = uids.filter(id => !people.has(id) || now - people.get(id)!.at > PEOPLE_TTL);
  if (stale.length) {
    const got = await loadUsers(stale);
    for (const id of stale) people.set(id, { at: now, u: got.get(id) || null });
    if (people.size > 4000) for (const [k, v] of people) if (now - v.at > PEOPLE_TTL) people.delete(k);
  }
  const out = new Map<string, UserDoc>();
  for (const id of uids) {
    const u = people.get(id)?.u;
    if (u) out.set(id, u);
  }
  return out;
}

// ---- Live listener on this month's top entries (one per worker, closed after LIVE_IDLE_MS without a viewer) ----
const LIVE_IDLE_MS = 15 * 60_000;
type LiveState = { month: string; entries: any[]; ok: boolean; ready: Promise<void>; unsub: () => void; usedAt: number };
let live: LiveState | null = null;
function watchMonth(month: string): LiveState {
  let done!: () => void;
  const state: LiveState = { month, entries: [], ok: false, ready: new Promise<void>(r => (done = r)), unsub: () => {}, usedAt: Date.now() };
  state.unsub = entriesCol(month)
    .orderBy('points', 'desc')
    .limit(LIVE_LIMIT)
    .onSnapshot(
      snap => {
        state.entries = snap.docs.map(d => ({ uid: d.id, ...(d.data() as any) }));
        state.ok = true;
        done();
      },
      err => {
        console.warn('[MarketX Leaderboard] live board listener stopped:', err?.message || err);
        state.ok = false;
        if (live === state) live = null;
        done();
      }
    );
  return state;
}
async function liveEntries(month: string): Promise<any[]> {
  if (!live || live.month !== month) {
    live?.unsub();
    live = watchMonth(month);
  }
  const state = live;
  state.usedAt = Date.now();
  await Promise.race([state.ready, new Promise(r => setTimeout(r, 5000))]);
  if (state.ok) return state.entries;
  const snap = await entriesCol(month).orderBy('points', 'desc').limit(LIVE_LIMIT).get();
  return snap.docs.map(d => ({ uid: d.id, ...(d.data() as any) }));
}
setInterval(() => {
  if (live && Date.now() - live.usedAt > LIVE_IDLE_MS) {
    live.unsub();
    live = null;
  }
}, 60_000).unref();

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
  const current = month === monthKey();
  const raw = current && size <= LIVE_LIMIT
    ? await liveEntries(month)
    : (await entriesCol(month).orderBy('points', 'desc').limit(size + 60).get()).docs.map(d => ({ uid: d.id, ...(d.data() as any) }));
  const entries = raw.filter(e => (Number(e.points) || 0) > 0);
  const who = current ? await peopleFor(entries.map(e => e.uid)) : await loadUsers(entries.map(e => e.uid));
  let pub = 0;
  const rows = entries
    .filter(e => (opts.admin ? who.has(e.uid) : listable(who.get(e.uid))))
    .slice(0, size)
    .map((e, i) => {
      const u = who.get(e.uid)!;
      // publicRank: the place on the public board (admin view lists everyone, so its rank can differ)
      const publicRank = listable(u) ? ++pub : null;
      return { uid: e.uid, rank: i + 1, publicRank, ...personOf(u), ...usageRow(e), user: u };
    });
  return rows;
}

/** Where a trader stands this month on the public board (live): their place among listed traders */
async function liveStanding(uid: string, month: string) {
  const entries = (await liveEntries(month)).filter(e => (Number(e.points) || 0) > 0);
  const who = await peopleFor(entries.map(e => e.uid));
  const mine = entries.find(e => e.uid === uid) || null;
  const e: any = mine || ((await entriesCol(month).doc(uid).get()).data() ?? null);
  const points = Number(e?.points) || 0;
  let rank: number | null = null;
  if (points > 0) {
    const above = entries.filter(x => x.uid !== uid && (Number(x.points) || 0) > points && listable(who.get(x.uid))).length;
    if (mine || entries.length < LIVE_LIMIT) rank = above + 1;
    else {
      // Below the live window: count everyone above, less the window's traders who are not on the public board
      try {
        const c = await (entriesCol(month).where('points', '>', points) as any).count().get();
        const offBoard = entries.filter(x => !listable(who.get(x.uid))).length;
        rank = Math.max(above, Number(c.data().count) - offBoard) + 1;
      } catch {
        rank = null;
      }
    }
  }
  return { rank, ...usageRow(e || {}) };
}

// ---- Month end: freeze the board (final standings, tiers, the month's top 3) ----
const monthRef = (month: string) => db().collection('leaderboards').doc(month);
/** The first instant of a month (00:00 on the 1st, site time zone) */
export function monthStart(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return nextMonthStart(Date.UTC(y, m - 2, 15));
}
export async function finalizeMonth(month: string): Promise<boolean> {
  if (!isMonthKey(month) || month >= monthKey()) return false;
  const m = await monthRef(month).get();
  if (m.exists && (m.data() as any)?.finalizedAt) return false;
  const snap = await entriesCol(month).orderBy('points', 'desc').get();
  const docs = snap.docs.filter(d => (Number((d.data() as any).points) || 0) > 0);
  const who = await loadUsers(docs.map(d => d.id));
  const winners: any[] = [];
  let pub = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db().batch();
    docs.slice(i, i + 400).forEach((d, k) => {
      const e = d.data() as any;
      const u = who.get(d.id);
      const publicRank = listable(u) ? ++pub : null;
      if (publicRank && publicRank <= 3 && u) winners.push({ uid: d.id, rank: publicRank, ...personOf(u), points: Number(e.points) || 0, tier: tierOf(Number(e.points) || 0) });
      batch.update(d.ref, { finalRank: i + k + 1, publicRank, tierId: tierOf(Number(e.points) || 0).id });
    });
    await batch.commit();
  }
  await monthRef(month).set({ month, finalizedAt: Date.now(), traders: docs.length, listed: pub, winners }, { merge: true });
  winnersCache = null;
  return true;
}
if (IS_LEAD_WORKER && isFirebaseConfigured()) {
  const sweep = async () => {
    for (let m = previousMonth(monthKey()), i = 0; i < 3; i++, m = previousMonth(m)) {
      await finalizeMonth(m).catch(err => console.warn(`[MarketX Leaderboard] could not close ${m}:`, err?.message || err));
    }
  };
  setTimeout(sweep, 60_000).unref();
  setInterval(sweep, 60 * 60_000).unref();
}

/** Past months winners (public: no uids), newest first, the last 12 months */
let winnersCache: { at: number; v: any[] } | null = null;
async function pastWinners(): Promise<Array<{ month: string; traders: number; top: any[] }>> {
  if (winnersCache && Date.now() - winnersCache.at < 10 * 60_000) return winnersCache.v;
  const months: string[] = [];
  for (let m = previousMonth(monthKey()), i = 0; i < 12; i++, m = previousMonth(m)) months.push(m);
  const snaps = await db().getAll(...months.map(monthRef));
  const v: Array<{ month: string; traders: number; top: any[] }> = [];
  for (const [i, snap] of snaps.entries()) {
    const d: any = snap.exists ? snap.data() : null;
    if (d?.winners?.length) {
      v.push({ month: months[i], traders: Number(d.listed ?? d.traders) || 0, top: d.winners.map(({ uid: _u, ...w }: any) => w) });
    } else if (i === 0 && !d?.finalizedAt) {
      // Last month before the lead worker closed it: read it straight from the entries
      const top = await usageBoard(months[0], 3);
      if (top.length) v.push({ month: months[0], traders: top.length, top: top.map(r => ({ rank: r.rank, username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl, verified: r.verified, points: r.points, tier: r.tier })) });
    }
  }
  winnersCache = { at: Date.now(), v };
  return v;
}

/** A trader's own standing every month (profile): points, tier and place on the public board */
export async function myStandings(uid: string) {
  const now = monthKey();
  const months: string[] = [];
  for (let m = now, i = 0; i < 12; i++, m = previousMonth(m)) months.push(m);
  const snaps = await db().getAll(...months.map(m => entriesCol(m).doc(uid)));
  const out: Array<{ month: string; current: boolean; points: number; tier: ReturnType<typeof tierOf>; rank: number | null; activeDays: number; analyses: number }> = [];
  for (const [i, snap] of snaps.entries()) {
    const month = months[i];
    if (i === 0) {
      const st = await liveStanding(uid, month);
      if (st.points > 0) out.push({ month, current: true, points: st.points, tier: st.tier, rank: st.rank, activeDays: st.activeDays, analyses: st.analyses });
      continue;
    }
    const e: any = snap.exists ? snap.data() : null;
    const points = Number(e?.points) || 0;
    if (!points) continue;
    let rank: number | null = typeof e.publicRank === 'number' ? e.publicRank : null;
    if (rank == null && typeof e.finalRank !== 'number') {
      // Not closed yet: everyone above, as the board stood
      try {
        rank = Number((await (entriesCol(month).where('points', '>', points) as any).count().get()).data().count) + 1;
      } catch {
        rank = null;
      }
    }
    out.push({ month, current: false, points, tier: tierOf(points), rank, activeDays: Object.keys(e.days || {}).length, analyses: Number(e.analyses) || 0 });
  }
  return out;
}
async function referralBoard(size: number, opts: { admin?: boolean } = {}) {
  const snap = await users().orderBy('referral.invited', 'desc').limit(size + 30).get();
  const month = monthKey();
  const picked = snap.docs
    .map(d => ({ uid: d.id, user: d.data() as UserDoc }))
    .filter(r => Number((r.user as any).referral?.invited) > 0 && (opts.admin || listable(r.user)))
    .slice(0, size);
  // Each inviter's level this month (from the usage board)
  const usage = picked.length ? await db().getAll(...picked.map(r => entriesCol(month).doc(r.uid))) : [];
  const pts = new Map(usage.map(u => [u.id, Number((u.data() as any)?.points) || 0]));
  return picked.map((r, i) => {
    const ref: any = (r.user as any).referral || {};
    return {
      uid: r.uid,
      rank: i + 1,
      ...personOf(r.user),
      invited: Number(ref.invited) || 0,
      thisMonth: Number(ref.months?.[month]) || 0,
      earned: Number(ref.earned) || 0,
      tier: tierOf(pts.get(r.uid) || 0),
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
    const lockedOff = leaderboardBlocked(meDoc);
    const hidden = !!meDoc?.leaderboardHidden || lockedOff;
    if (board === 'usage') {
      const month = monthKey();
      const [rows, mine, winners] = await Promise.all([
        // Live: the listener keeps the entries current; the rows are rebuilt at most every few seconds per worker
        cached(`u:${month}`, 3_000, () => usageBoard(month, BOARD_SIZE)),
        liveStanding(me, month),
        pastWinners(),
      ]);
      // Shown in the list: the rank there is the one on the trader's card too
      const listed = rows.find(r => r.uid === me);
      if (listed) mine.rank = listed.rank;
      const prev = previousMonth(month);
      const last = winners.find(w => w.month === prev);
      return res.json({
        board,
        month,
        startsAt: monthStart(month),
        resetsAt: nextMonthStart(),
        updatedAt: Date.now(),
        scoring: { points: USAGE_POINTS, activeDay: ACTIVE_DAY_BONUS },
        // (when another trader was last active stays private)
        rows: strip(rows, me).map(({ publicRank: _p, lastAt: _l, ...r }) => r),
        me: { ...mine, hidden, ...(lockedOff ? { locked: true } : {}) },
        lastMonth: { month: prev, top: last?.top || [] },
        pastWinners: winners,
      });
    }
    const rows = await cached('r', 10_000, () => referralBoard(BOARD_SIZE));
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
      updatedAt: Date.now(),
      // Other traders' earned credits stay private (only counts are public)
      rows: strip(rows, me).map(({ earned: _e, ...r }) => r),
      me: { rank, invited, thisMonth: Number(ref.months?.[monthKey()]) || 0, earned: Number(ref.earned) || 0, hidden, ...(lockedOff ? { locked: true } : {}) },
      program: { enabled: program.enabled, credits: program.enabled ? program.credits : 0 },
    });
  }));

  // Show or hide me on the boards
  app.post('/api/leaderboard/visibility', limiter, ready, requireAuth, throttle, wrap(async (req, res) => {
    const hidden = req.body?.hidden === true;
    const ref = users().doc(getUser(res).uid);
    // An account kept off the boards stays off
    if (!hidden && leaderboardBlocked((await ref.get()).data() as UserDoc)) return res.json({ success: true, hidden: true, locked: true });
    await ref.update({ leaderboardHidden: hidden });
    people.delete(getUser(res).uid);
    cache.clear();
    res.json({ success: true, hidden });
  }));

  // My standing every month (profile): points, tier, place
  const standingsCache = new Map<string, { at: number; v: any }>();
  app.get('/api/leaderboard/standings', limiter, ready, requireAuth, throttle, wrap(async (_req, res) => {
    const uid = getUser(res).uid;
    const hit = standingsCache.get(uid);
    if (hit && Date.now() - hit.at < 20_000) return res.json(hit.v);
    const [months, meDoc] = await Promise.all([myStandings(uid), users().doc(uid).get()]);
    const d: any = meDoc.data() || {};
    const v = { months, hidden: !!d.leaderboardHidden || leaderboardBlocked(d), best: months.reduce((b: any, m) => (!b || m.points > b.points ? { month: m.month, points: m.points, tier: m.tier, rank: m.rank } : b), null) };
    standingsCache.set(uid, { at: Date.now(), v });
    if (standingsCache.size > 2000) standingsCache.delete(standingsCache.keys().next().value as string);
    res.json(v);
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

  app.post('/api/admin/leaderboard/block', requireAdmin, wrap(async (req, res) => {
    const uid = String(req.body?.uid || '');
    if (!/^[\w-]{6,128}$/.test(uid)) return res.status(400).json({ error: 'INVALID' });
    if (!(await users().doc(uid).get()).exists) return res.status(404).json({ error: 'NOT_FOUND', message: 'User not found.' });
    const on = req.body?.blocked === true;
    await setLeaderboardBlocked(uid, on);
    adminLog(on ? 'leaderboard_block' : 'leaderboard_unblock', { uid });
    res.json({ success: true, blocked: on });
  }));

  app.get('/api/admin/leaderboard', requireAdmin, wrap(async (req, res) => {
    const board = req.query.board === 'referrals' ? 'referrals' : 'usage';
    const adminRow = (r: any) => {
      const u: UserDoc = r.user;
      const { user: _u, ...rest } = r;
      return { ...rest, email: u.email, status: u.status || 'active', hidden: !!(u as any).leaderboardHidden, blocked: leaderboardBlocked(u), staff: isUnlimitedEmail(u.email) };
    };
    if (board === 'usage') {
      const month = isMonthKey(req.query.month) ? String(req.query.month) : monthKey();
      const months: string[] = [];
      for (let m = monthKey(), i = 0; i < 12; i++, m = previousMonth(m)) months.push(m);
      const [rows, mdoc] = await Promise.all([usageBoard(month, 200, { admin: true }), monthRef(month).get()]);
      const total = rows.reduce(
        (t, r) => ({ points: t.points + r.points, analyses: t.analyses + r.analyses, questions: t.questions + r.questions, fundamentals: t.fundamentals + r.fundamentals, matt: t.matt + r.matt }),
        { points: 0, analyses: 0, questions: 0, fundamentals: 0, matt: 0 }
      );
      const md: any = mdoc.exists ? mdoc.data() : null;
      return res.json({
        board,
        month,
        months,
        resetsAt: nextMonthStart(),
        rows: rows.map(adminRow),
        total,
        finalizedAt: md?.finalizedAt || null,
        winners: (md?.winners || []).map((w: any) => ({ ...w, email: rows.find(r => r.uid === w.uid)?.user.email || null })),
      });
    }
    // Who joined, who invited them and when (newest first, 100 a page, ?before=<at> for the next page)
    const before = Number(req.query.before);
    let q = db().collection('referrals').orderBy('at', 'desc');
    if (Number.isFinite(before) && before > 0) q = q.where('at', '<', before);
    const [rows, recentSnap] = await Promise.all([req.query.before ? Promise.resolve([]) : referralBoard(100, { admin: true }), q.limit(100).get()]);
    const recent = recentSnap.docs.map(d => d.data() as any);
    const who = await loadUsers(recent.flatMap(r => [String(r.uid || ''), String(r.referrerUid || '')]));
    const card = (id: string, fallback?: string) => {
      const u = who.get(id);
      return u ? { username: u.username, displayName: u.displayName, email: u.email, avatarUrl: safeAvatar(u.avatarUrl) } : { username: fallback || null, displayName: null, email: null, avatarUrl: null, deleted: true };
    };
    res.json({
      board,
      rows: rows.map(adminRow),
      recent: recent.map(r => ({
        at: r.at,
        month: r.month,
        credits: Number(r.credits) || 0,
        joined: card(String(r.uid || ''), r.username),
        inviter: card(String(r.referrerUid || '')),
      })),
      nextBefore: recent.length === 100 ? recent[recent.length - 1].at : null,
    });
  }));
}

/** Account deletion: the trader's leaderboard rows, invite code and referral records */
export async function deleteLeaderboardData(uid: string, code?: string | null) {
  const tasks: Promise<unknown>[] = [];
  for (let m = monthKey(), i = 0; i < 24; i++, m = previousMonth(m)) tasks.push(entriesCol(m).doc(uid).delete());
  if (code) tasks.push(codeRef(code).delete());
  tasks.push(db().collection('referrals').doc(uid).delete());
  // Out of the past months winners too
  tasks.push(
    (async () => {
      const months: string[] = [];
      for (let m = previousMonth(monthKey()), i = 0; i < 24; i++, m = previousMonth(m)) months.push(m);
      for (const snap of await db().getAll(...months.map(monthRef))) {
        const w: any[] = (snap.data() as any)?.winners || [];
        if (w.some(x => x.uid === uid)) await snap.ref.update({ winners: w.filter(x => x.uid !== uid) });
      }
    })()
  );
  await Promise.allSettled(tasks);
  people.delete(uid);
  winnersCache = null;
  cache.clear();
}

/** Admin: keep an account off (or back on) the public boards */
export async function setLeaderboardBlocked(uid: string, on: boolean) {
  await users().doc(uid).update({ leaderboardBlocked: on });
  people.delete(uid);
  cache.clear();
}

/** Lead worker: accounts blocked by MarketX ID get the flag (re-checked every 6h, so a newly indexed ID is caught) */
async function applyIdBlocks() {
  const snap = await db().collection('traderIds').get();
  for (const d of snap.docs) {
    if (!BLOCKED_ID_KEYS.has(idBlockKey(d.id))) continue;
    const uid = String((d.data() as any).uid || '');
    if (!uid) continue;
    const u = await users().doc(uid).get();
    if (u.exists && !(u.data() as any).leaderboardBlocked) await users().doc(uid).update({ leaderboardBlocked: true });
  }
  cache.clear();
}
if (IS_LEAD_WORKER && isFirebaseConfigured()) {
  const run = () => applyIdBlocks().catch(err => console.warn('[MarketX Leaderboard] id blocks failed:', err?.message || err));
  setTimeout(run, 45_000).unref();
  setInterval(run, 6 * 60 * 60_000).unref();
}

/** Sign-up: is this invite code one MarketX can credit? (an account in good standing owns it) */
export async function inviteCodeValid(code: string): Promise<boolean> {
  const c = await codeRef(code).get();
  const uid = c.exists ? String(c.data()?.uid || '') : '';
  if (!uid) return false;
  const u = await users().doc(uid).get();
  return u.exists && !blocked(u.data() as UserDoc);
}
