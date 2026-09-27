import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase';

// ---------------------------------------------------------------------------
// Usage & activity tracking for the admin console (server-side only).
//   usageDaily/{YYYY-MM-DD}   -> { day, analyses, chats, signups, signins, pairs: { KEY: { name, count } }, users: { uid: count } }
//   users/{uid}/meta/usage    -> { byDay: { day: n }, pairs, total, analyses, chats, lastAt }
//   users/{uid}/activity/{id} -> per-user activity feed
//   activityLog/{id}          -> global recent activity feed
// Days are UTC.
// ---------------------------------------------------------------------------

export type ActivityType =
  | 'signup'
  | 'signin'
  | 'analysis'
  | 'chat'
  | 'payment'
  | 'gift'
  | 'profile'
  | 'reward'
  | 'deleted'
  | 'admin';

export const dayKey = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);
export const pairKey = (symbol: string) =>
  String(symbol || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '_')
    .slice(0, 40);

const users = () => db().collection('users');
const KEEP_DAYS = 120;

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Appends to the user's activity feed and the global feed. Never throws. */
export async function logActivity(
  uid: string,
  entry: { type: ActivityType; title: string; detail?: string },
  username?: string | null
): Promise<void> {
  try {
    const ts = Date.now();
    const id = newId();
    if (username === undefined) {
      const snap = await users().doc(uid).get();
      username = snap.exists ? (snap.data() as any).username || null : null;
    }
    const payload = { id, uid, username: username || null, type: entry.type, title: entry.title.slice(0, 160), detail: (entry.detail || '').slice(0, 300), ts };
    await Promise.all([users().doc(uid).collection('activity').doc(id).set(payload), db().collection('activityLog').doc(id).set(payload)]);
  } catch (err: any) {
    console.warn('[MarketX Tracking] activity log failed:', err?.message || err);
  }
}

/** Counts a daily event (signups, signins) in the global daily document. */
export async function bumpDaily(field: 'signups' | 'signins'): Promise<void> {
  try {
    const ref = db().collection('usageDaily').doc(dayKey());
    await db().runTransaction(async tx => {
      const snap = await tx.get(ref);
      const d: any = snap.exists ? snap.data() : { day: dayKey(), analyses: 0, chats: 0, signups: 0, signins: 0, pairs: {}, users: {} };
      d[field] = (d[field] || 0) + 1;
      tx.set(ref, d);
    });
  } catch (err: any) {
    console.warn('[MarketX Tracking] daily counter failed:', err?.message || err);
  }
}

/** Records one successful prompt (analysis or chat) for the global and per-user usage stats. */
export async function recordUsage(uid: string, kind: 'analysis' | 'chat', symbol?: string | null): Promise<void> {
  try {
    const day = dayKey();
    const now = Date.now();
    const key = symbol ? pairKey(symbol) : null;
    const dRef = db().collection('usageDaily').doc(day);
    const uRef = users().doc(uid).collection('meta').doc('usage');
    await db().runTransaction(async tx => {
      const [d, u] = [await tx.get(dRef), await tx.get(uRef)];
      const dd: any = d.exists ? d.data() : { day, analyses: 0, chats: 0, signups: 0, signins: 0, pairs: {}, users: {} };
      dd[kind === 'analysis' ? 'analyses' : 'chats'] = (dd[kind === 'analysis' ? 'analyses' : 'chats'] || 0) + 1;
      dd.pairs = dd.pairs || {};
      dd.users = dd.users || {};
      if (key) dd.pairs[key] = { name: symbol, count: (dd.pairs[key]?.count || 0) + 1 };
      dd.users[uid] = (dd.users[uid] || 0) + 1;
      tx.set(dRef, dd);

      const uu: any = u.exists ? u.data() : { byDay: {}, pairs: {}, total: 0, analyses: 0, chats: 0 };
      uu.byDay = uu.byDay || {};
      uu.pairs = uu.pairs || {};
      uu.byDay[day] = (uu.byDay[day] || 0) + 1;
      const cutoff = dayKey(now - KEEP_DAYS * 86400000);
      for (const k of Object.keys(uu.byDay)) if (k < cutoff) delete uu.byDay[k];
      uu.total = (uu.total || 0) + 1;
      uu[kind === 'analysis' ? 'analyses' : 'chats'] = (uu[kind === 'analysis' ? 'analyses' : 'chats'] || 0) + 1;
      if (key) uu.pairs[key] = { name: symbol, count: (uu.pairs[key]?.count || 0) + 1 };
      uu.lastAt = now;
      tx.set(uRef, uu);
    });
    await users()
      .doc(uid)
      .update({ lastActiveAt: now, usageTotal: FieldValue.increment(1) })
      .catch(() => {});
  } catch (err: any) {
    console.warn('[MarketX Tracking] usage record failed:', err?.message || err);
  }
}

/** Marks the user as recently active (sign-ins, etc.). */
export function touchUser(uid: string) {
  users()
    .doc(uid)
    .update({ lastActiveAt: Date.now() })
    .catch(() => {});
}
