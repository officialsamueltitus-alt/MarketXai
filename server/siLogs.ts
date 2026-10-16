// ===========================================================================
// Matt and Fundamental Analysis history for the admin console (server-side only, owner-specified).
//
//   mattLogs/{id}         -> one Matt message: who, question, reply, outcome, pair, when
//   fundamentalLogs/{id}  -> one fundamental read or recheck: who, question, event, most likely, outcome, when
//   siDaily/{YYYY-MM-DD}  -> per-day counters by outcome + per-trader counts (the admin charts read these)
//
// Never sent to traders, never given to Matt or any engine. Kept KEEP_DAYS (90) days, swept daily by the lead worker,
// and removed with the trader's account. Writing never throws and never delays a reply.
// ===========================================================================
import { db, isFirebaseConfigured } from './firebase';
import { IS_LEAD_WORKER } from './workers';
import { dayKey } from './tracking';

export const KEEP_DAYS = 90;
export type MattOutcome = 'ANSWERED' | 'OFFLINE' | 'PRIVATE' | 'PAUSED' | 'REPLACED';
export type FundamentalOutcome = 'OK' | 'NOT_FUNDAMENTAL' | 'UNAVAILABLE' | 'ERROR';

const clip = (s: unknown, n: number) =>
  String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, n);
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const usernames = new Map<string, { name: string | null; at: number }>();
async function usernameOf(uid: string): Promise<string | null> {
  const hit = usernames.get(uid);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.name;
  const snap = await db().collection('users').doc(uid).get();
  const name = snap.exists ? (snap.data() as any).username || null : null;
  usernames.set(uid, { name, at: Date.now() });
  if (usernames.size > 2000) usernames.delete(usernames.keys().next().value as string);
  return name;
}

async function bump(kind: 'matt' | 'fundamental', outcome: string, uid: string) {
  const day = dayKey();
  const ref = db().collection('siDaily').doc(day);
  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const d: any = snap.exists ? snap.data() : { day };
    const counts = (d[kind] = d[kind] || {});
    counts.total = (counts.total || 0) + 1;
    counts[outcome] = (counts[outcome] || 0) + 1;
    const people = (d[`${kind}Users`] = d[`${kind}Users`] || {});
    people[uid] = (people[uid] || 0) + 1;
    tx.set(ref, d);
  });
}

/** One Matt message (question + what Matt replied) */
export function logMatt(
  uid: string,
  entry: { question: string; reply: string; outcome: MattOutcome; pair?: string | null; fromCard?: boolean; strikes?: number; pausedUntil?: number | null }
): void {
  if (!isFirebaseConfigured()) return;
  (async () => {
    const id = newId();
    await db()
      .collection('mattLogs')
      .doc(id)
      .set({
        id,
        uid,
        username: await usernameOf(uid).catch(() => null),
        ts: Date.now(),
        question: clip(entry.question, 600),
        reply: clip(entry.reply, 2000),
        outcome: entry.outcome,
        pair: entry.pair ? clip(entry.pair, 30) : null,
        fromCard: !!entry.fromCard,
        ...(entry.strikes != null ? { strikes: entry.strikes } : {}),
        ...(entry.pausedUntil ? { pausedUntil: entry.pausedUntil } : {}),
      });
    await bump('matt', entry.outcome, uid);
  })().catch(err => console.warn('[MarketX SI logs] Matt log failed:', err?.message || err));
}

/** One fundamental read or recheck */
export function logFundamental(
  uid: string,
  entry: {
    kind: 'READ' | 'RECHECK';
    question: string;
    outcome: FundamentalOutcome;
    ms: number;
    cached?: boolean;
    report?: {
      event?: string;
      currency?: string;
      status?: string;
      mostLikely?: { outcome?: string; probability?: number; impact?: string };
      data?: { actual?: string; forecast?: string };
      confidence?: number;
      pairs?: Array<{ symbol: string; bias: string }>;
      recheck?: { state?: string; headline?: string };
      web?: boolean;
    } | null;
  }
): void {
  if (!isFirebaseConfigured()) return;
  (async () => {
    const id = newId();
    const r = entry.report || null;
    await db()
      .collection('fundamentalLogs')
      .doc(id)
      .set({
        id,
        uid,
        username: await usernameOf(uid).catch(() => null),
        ts: Date.now(),
        kind: entry.kind,
        question: clip(entry.question, 300),
        outcome: entry.outcome,
        ms: Math.max(0, Math.round(entry.ms)),
        cached: !!entry.cached,
        ...(r
          ? {
              event: clip(r.event, 120),
              currency: clip(r.currency, 6),
              status: clip(r.status, 12),
              mostLikely: clip(r.mostLikely?.outcome, 160),
              probability: Number(r.mostLikely?.probability) || 0,
              impact: clip(r.mostLikely?.impact, 12),
              actual: clip(r.data?.actual, 30),
              forecast: clip(r.data?.forecast, 30),
              confidence: Number(r.confidence) || 0,
              pairsFor: (r.pairs || []).filter(p => p.bias === 'FOR').map(p => clip(p.symbol, 20)).slice(0, 8),
              pairsAgainst: (r.pairs || []).filter(p => p.bias === 'AGAINST').map(p => clip(p.symbol, 20)).slice(0, 8),
              recheckState: clip(r.recheck?.state, 16) || null,
              recheckHeadline: clip(r.recheck?.headline, 200) || null,
              web: !!r.web,
            }
          : {}),
      });
    await bump('fundamental', entry.outcome, uid);
  })().catch(err => console.warn('[MarketX SI logs] fundamental log failed:', err?.message || err));
}

/** Removes entries older than KEEP_DAYS (lead worker, daily) */
export async function sweepSiLogs(now = Date.now()): Promise<number> {
  const cutoff = now - KEEP_DAYS * 86400000;
  let removed = 0;
  for (const col of ['mattLogs', 'fundamentalLogs']) {
    for (let round = 0; round < 20; round++) {
      const snap = await db().collection(col).where('ts', '<', cutoff).limit(400).get();
      if (snap.empty) break;
      await Promise.all(snap.docs.map(d => d.ref.delete()));
      removed += snap.size;
    }
  }
  const old = await db().collection('siDaily').where('day', '<', dayKey(cutoff)).limit(200).get();
  await Promise.all(old.docs.map(d => d.ref.delete()));
  return removed;
}

export function startSiLogSweep() {
  if (!isFirebaseConfigured() || !IS_LEAD_WORKER) return;
  const run = () => sweepSiLogs().catch(err => console.warn('[MarketX SI logs] sweep failed:', err?.message || err));
  setTimeout(run, 5 * 60_000).unref();
  setInterval(run, 24 * 3600_000).unref();
}
