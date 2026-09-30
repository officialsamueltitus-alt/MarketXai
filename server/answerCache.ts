// Answers to questions, reused when someone asks the same thing again (shared by every worker via Firestore, with an
// in-memory copy in front). Live prices are never reused: for a question about a pair the caller re-fetches the price
// and shows it above the stored explanation. Only engine-written answers are stored, never the offline fallback.
import { createHash } from 'crypto';
import { db, firebaseStatus } from './firebase';
import { SharedCache } from './aiGate';

/** General questions ("what is a liquidity sweep?") stay valid for a week */
export const GENERAL_ANSWER_TTL_MS = 7 * 24 * 3600e3;
/** Questions about a pair carry today's news, so they are reused for 6 hours on the same calendar day */
export const PAIR_ANSWER_TTL_MS = 6 * 3600e3;

/** Questions about right now ("why is the market down today?") go stale fast, so they are reused for 20 minutes only */
export const TIME_SENSITIVE_TTL_MS = 20 * 60e3;
const TIME_SENSITIVE = /\b(today|tonight|now|right now|currently|current|latest|recent|recently|this (week|morning|afternoon|evening)|yesterday|breaking|news|just now|at the moment)\b/i;

/** How long an answer to this question may be reused */
export function answerTtl(question: string, aboutPair: boolean): number {
  const timely = TIME_SENSITIVE.test(String(question || ''));
  if (aboutPair) return timely ? 60 * 60e3 : PAIR_ANSWER_TTL_MS;
  return timely ? TIME_SENSITIVE_TTL_MS : GENERAL_ANSWER_TTL_MS;
}

const memory = new SharedCache<{ text: string; at: number; exp: number }>(60 * 60_000, 2000);
const col = () => db().collection('answerCache');

/** Same question, same answer: case, spacing, punctuation and polite filler do not matter. */
export function answerKey(question: string, scope = ''): string {
  const norm = String(question || '')
    .toLowerCase()
    .replace(/\b(please|pls|plz|kindly|hey|hi|hello)\b/g, ' ')
    .replace(/[^a-z0-9$/.%\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s.?]+$/, '')
    .trim()
    .slice(0, 400);
  return createHash('sha256').update(`${norm}|${scope}`).digest('hex').slice(0, 40);
}

const storageReady = () => {
  try {
    return !firebaseStatus();
  } catch {
    return false;
  }
};

export async function getCachedAnswer(key: string): Promise<{ text: string; at: number } | null> {
  const hit = memory.get(key);
  if (hit && hit.exp > Date.now()) return { text: hit.text, at: hit.at };
  if (!storageReady()) return null;
  try {
    const snap: any = await Promise.race([col().doc(key).get(), new Promise(r => setTimeout(() => r(null), 1500))]);
    const d = snap?.exists ? snap.data() : null;
    if (!d || typeof d.text !== 'string' || !(d.expiresAt > Date.now())) return null;
    const value = { text: d.text, at: Number(d.at) || Date.now() };
    memory.set(key, { ...value, exp: Number(d.expiresAt) });
    return value;
  } catch {
    return null;
  }
}

export function saveAnswer(key: string, text: string, ttlMs: number, meta: { symbol?: string } = {}): void {
  const clean = String(text || '').slice(0, 20000);
  if (clean.trim().length < 20) return;
  const at = Date.now();
  memory.set(key, { text: clean, at, exp: at + ttlMs });
  if (!storageReady()) return;
  col()
    .doc(key)
    .set({ text: clean, at, expiresAt: at + ttlMs, symbol: meta.symbol || null })
    .catch(() => {});
}

/** Removes expired answers (lead worker, hourly). */
export async function sweepExpiredAnswers(): Promise<number> {
  if (!storageReady()) return 0;
  try {
    const snap = await col().where('expiresAt', '<', Date.now()).limit(300).get();
    await Promise.all(snap.docs.map((d: any) => d.ref.delete().catch(() => {})));
    return snap.size;
  } catch {
    return 0;
  }
}
