// ===========================================================================
// Monthly usage points for the leaderboard (owner-specified: resets at the end of every month, site time zone).
//
//   leaderboards/{YYYY-MM}/entries/{uid} -> { uid, month, points, analyses, questions, matt, fundamentals,
//                                             days: { "07": n }, pairs: { KEY: { name, count } }, today, lastAt }
//
// A new month is a new collection, so the board starts from zero at 00:00 on the 1st (CREDIT_RESET_TZ) with nothing
// to sweep. Points come only from real use, each kind capped per day so nobody can farm the board with cheap messages.
// Recording never throws and never delays a reply. No other module is imported here except storage (no cycles).
// ===========================================================================
import { db, isFirebaseConfigured } from './firebase';
import { CREDIT_RESET_TZ } from './dailyReset';

export type UsageKind = 'analysis' | 'question' | 'fundamental' | 'matt';

/** Points per action, and how many of each count per day (more are still recorded, they just don't score) */
export const USAGE_POINTS: Record<UsageKind, number> = { analysis: 10, fundamental: 8, question: 4, matt: 2 };
export const USAGE_DAILY_CAP: Record<UsageKind, number> = { analysis: 40, fundamental: 15, question: 25, matt: 15 };
/** The first scored action of a day adds an active-day bonus */
export const ACTIVE_DAY_BONUS = 5;

const FIELD: Record<UsageKind, 'analyses' | 'questions' | 'fundamentals' | 'matt'> = {
  analysis: 'analyses',
  question: 'questions',
  fundamental: 'fundamentals',
  matt: 'matt',
};

const fmt = new Intl.DateTimeFormat('en-US', { timeZone: CREDIT_RESET_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function wallParts(at: number) {
  const p: Record<string, number> = {};
  for (const x of fmt.formatToParts(new Date(at))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return p;
}
const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10": the leaderboard month at an instant, in the site time zone */
export function monthKey(at = Date.now()): string {
  const p = wallParts(at);
  return `${p.year}-${pad(p.month)}`;
}
/** Day of the month ("07") in the site time zone */
export function monthDay(at = Date.now()): string {
  return pad(wallParts(at).day);
}
export const isMonthKey = (m: unknown): m is string => typeof m === 'string' && /^20\d\d-(0[1-9]|1[0-2])$/.test(m);

/** The instant the month after `at` begins (00:00 on the 1st, site time zone): when the board resets */
export function nextMonthStart(at = Date.now()): number {
  const p = wallParts(at);
  const wall = Date.UTC(p.month === 12 ? p.year + 1 : p.year, p.month === 12 ? 0 : p.month, 1);
  const offset = (t: number) => {
    const q = wallParts(t);
    return Date.UTC(q.year, q.month - 1, q.day, q.hour % 24, q.minute, q.second) - Math.floor(t / 1000) * 1000;
  };
  return wall - offset(wall - offset(at));
}
/** The month before a month key */
export function previousMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${pad(mo - 1)}`;
}

export const entriesCol = (month: string) => db().collection('leaderboards').doc(month).collection('entries');

const pairKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);

/** Counts one action for this month's leaderboard (fire and forget) */
export function recordMonthly(uid: string, kind: UsageKind, symbol?: string | null): Promise<void> {
  if (!uid || !isFirebaseConfigured() || !USAGE_POINTS[kind]) return Promise.resolve();
  const now = Date.now();
  const month = monthKey(now);
  const day = monthDay(now);
  const ref = entriesCol(month).doc(uid);
  return db()
    .runTransaction(async tx => {
      const snap = await tx.get(ref);
      const e: any = snap.exists ? snap.data() : { uid, month, points: 0, analyses: 0, questions: 0, fundamentals: 0, matt: 0, days: {}, pairs: {} };
      e.days = e.days || {};
      e.pairs = e.pairs || {};
      // Today's counts per kind (for the daily caps); a new day starts fresh
      const today = e.today && e.today.day === day ? e.today : { day, analysis: 0, question: 0, fundamental: 0, matt: 0, scored: false };
      const field = FIELD[kind];
      e[field] = (e[field] || 0) + 1;
      today[kind] = (today[kind] || 0) + 1;
      if (today[kind] <= USAGE_DAILY_CAP[kind]) {
        e.points = (e.points || 0) + USAGE_POINTS[kind];
        if (!today.scored) {
          today.scored = true;
          e.points += ACTIVE_DAY_BONUS;
        }
      }
      e.days[day] = (e.days[day] || 0) + 1;
      const key = symbol ? pairKey(symbol) : '';
      if (key) {
        e.pairs[key] = { name: String(symbol).slice(0, 24), count: (e.pairs[key]?.count || 0) + 1 };
        // Keep the 12 most used markets
        const keys = Object.keys(e.pairs);
        if (keys.length > 12) {
          keys.sort((a, b) => e.pairs[a].count - e.pairs[b].count);
          for (const k of keys.slice(0, keys.length - 12)) delete e.pairs[k];
        }
      }
      e.today = today;
      e.lastAt = now;
      tx.set(ref, e);
    })
    .catch(err => console.warn('[MarketX Leaderboard] usage record failed:', err?.message || err));
}

/** The longest run of consecutive active days in a month's `days` map */
export function bestStreak(days: Record<string, number> | undefined): number {
  const on = Object.keys(days || {})
    .map(Number)
    .filter(n => n >= 1 && n <= 31)
    .sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let prev = -1;
  for (const d of on) {
    run = d === prev + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** Levels (owner-specified look: a reason to come back every month) */
export const TIERS = [
  { id: 'ROOKIE', label: 'Rookie', min: 0 },
  { id: 'EXPLORER', label: 'Explorer', min: 100 },
  { id: 'ANALYST', label: 'Analyst', min: 300 },
  { id: 'STRATEGIST', label: 'Strategist', min: 700 },
  { id: 'MARKET_PRO', label: 'Market Pro', min: 1500 },
  { id: 'LEGEND', label: 'Legend', min: 3000 },
] as const;
export function tierOf(points: number) {
  let i = 0;
  for (let k = 0; k < TIERS.length; k++) if (points >= TIERS[k].min) i = k;
  const next = TIERS[i + 1] || null;
  return { id: TIERS[i].id, label: TIERS[i].label, min: TIERS[i].min, next: next ? { label: next.label, min: next.min } : null };
}
