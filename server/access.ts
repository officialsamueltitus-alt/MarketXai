import crypto from 'crypto';
import type { Transaction } from 'firebase-admin/firestore';
import { db } from './firebase';

// ---------------------------------------------------------------------------
// Invite-only access: a fixed batch of one-time pass codes.
//   accessBatches/batch-N   -> { batch, codes: string[], next, createdAt }  (server-only, never sent to clients)
//   accessCodes/{code}      -> { status: 'reserved' | 'redeemed', email, uid?, reservedAt, redeemedAt? }
//   pendingSignups/{email}  -> a sign-up waiting for its pass code; the account is only created on redeem
// Each code is reserved for exactly one email, emailed once, and expires when redeemed.
// When every code in the batch is reserved, new sign-ups are refused until the next batch.
// ---------------------------------------------------------------------------

export const ACCESS_BATCH = Math.max(1, Math.floor(Number(process.env.ACCESS_CODE_BATCH) || 1));
const BATCH_SIZE = 50;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I lookalikes
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
const SEND_CLAIM_MS = 2 * 60 * 1000;

export interface PendingSignup {
  email: string;
  code: string;
  batch: number;
  passwordHash?: string;
  googleSub?: string;
  username?: string;
  displayName?: string;
  name?: string;
  picture?: string;
  createdAt: number;
  codeEmailSentAt?: number | null;
  codeEmailClaimAt?: number | null;
  attempts?: number;
  lockedUntil?: number;
}

const batchRef = () => db().collection('accessBatches').doc(`batch-${ACCESS_BATCH}`);
const codeRef = (code: string) => db().collection('accessCodes').doc(code);
export const pendingRef = (email: string) => db().collection('pendingSignups').doc(email.toLowerCase());

function newCode(): string {
  const bytes = crypto.randomBytes(8);
  const chars = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
  return `MX-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** Normalises user input ("mx 7k2p-q9xd", "MX7K2PQ9XD") to the stored "MX-7K2P-Q9XD" form. */
export function normalizeCode(input: string): string {
  const raw = String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const body = raw.startsWith('MX') ? raw.slice(2) : raw;
  return body.length === 8 ? `MX-${body.slice(0, 4)}-${body.slice(4)}` : raw;
}

function codesMatch(a: string, b: string): boolean {
  const x = Buffer.from(normalizeCode(a));
  const y = Buffer.from(normalizeCode(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Generates the batch's codes once; later calls are no-ops. */
export async function ensureAccessBatch(): Promise<void> {
  await db().runTransaction(async tx => {
    const snap = await tx.get(batchRef());
    if (snap.exists) return;
    const codes = new Set<string>();
    while (codes.size < BATCH_SIZE) codes.add(newCode());
    tx.set(batchRef(), { batch: ACCESS_BATCH, size: BATCH_SIZE, codes: [...codes], next: 0, createdAt: Date.now() });
  });
}

export type ReserveResult =
  | { status: 'created'; pending: PendingSignup }
  | { status: 'exists'; pending: PendingSignup }
  | { status: 'full' };

/** Reserves the next unused code for this email and records the pending sign-up (atomic). */
export async function createPendingSignup(
  email: string,
  data: Omit<PendingSignup, 'email' | 'code' | 'batch' | 'createdAt'>
): Promise<ReserveResult> {
  await ensureAccessBatch();
  return db().runTransaction(async tx => {
    const pRef = pendingRef(email);
    const existing = await tx.get(pRef);
    if (existing.exists) return { status: 'exists', pending: existing.data() as PendingSignup };
    const batchSnap = await tx.get(batchRef());
    const batch = batchSnap.data() as { codes: string[]; next: number };
    if (!batch || batch.next >= batch.codes.length) return { status: 'full' };

    const code = batch.codes[batch.next];
    const now = Date.now();
    const pending: PendingSignup = {
      ...data,
      email: email.toLowerCase(),
      code,
      batch: ACCESS_BATCH,
      createdAt: now,
      codeEmailSentAt: null,
      codeEmailClaimAt: null,
      attempts: 0,
      lockedUntil: 0,
    };
    tx.update(batchRef(), { next: batch.next + 1 });
    tx.set(codeRef(code), { code, batch: ACCESS_BATCH, status: 'reserved', email: pending.email, reservedAt: now });
    tx.set(pRef, pending);
    return { status: 'created', pending };
  });
}

/**
 * Emails the pass code exactly once per sign-up. A short claim prevents concurrent double sends;
 * if delivery fails the claim is released so a later attempt can deliver it (still only once).
 */
export async function sendPasscodeOnce(email: string, send: (code: string) => Promise<boolean | void>): Promise<boolean> {
  const claimed = await db().runTransaction(async tx => {
    const snap = await tx.get(pendingRef(email));
    if (!snap.exists) return null;
    const p = snap.data() as PendingSignup;
    if (p.codeEmailSentAt) return null;
    if (p.codeEmailClaimAt && Date.now() - p.codeEmailClaimAt < SEND_CLAIM_MS) return null;
    tx.update(pendingRef(email), { codeEmailClaimAt: Date.now() });
    return p.code;
  });
  if (!claimed) return false;
  const ok = (await send(claimed)) !== false;
  await pendingRef(email)
    .update(ok ? { codeEmailSentAt: Date.now(), codeEmailClaimAt: null } : { codeEmailClaimAt: null })
    .catch(() => {});
  return ok;
}

export type RedeemCheck =
  | { status: 'ok'; pending: PendingSignup }
  | { status: 'no_pending' }
  | { status: 'locked'; retryInMin: number }
  | { status: 'invalid'; attemptsLeft: number };

/** Checks a code against the pending sign-up, counting failures and locking after too many. */
export async function checkPasscode(email: string, code: string): Promise<RedeemCheck> {
  return db().runTransaction(async tx => {
    const ref = pendingRef(email);
    const snap = await tx.get(ref);
    if (!snap.exists) return { status: 'no_pending' };
    const p = snap.data() as PendingSignup;
    const now = Date.now();
    if ((p.lockedUntil || 0) > now) return { status: 'locked', retryInMin: Math.ceil(((p.lockedUntil || 0) - now) / 60000) };
    if (codesMatch(code, p.code)) return { status: 'ok', pending: p };
    const attempts = (p.attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      tx.update(ref, { attempts: 0, lockedUntil: now + LOCK_MS });
      return { status: 'locked', retryInMin: Math.ceil(LOCK_MS / 60000) };
    }
    tx.update(ref, { attempts });
    return { status: 'invalid', attemptsLeft: MAX_ATTEMPTS - attempts };
  });
}

/** Marks the code as used and removes the pending sign-up (run inside the account-creation transaction). */
export function consumePasscodeInTx(tx: Transaction, pending: PendingSignup, uid: string) {
  tx.set(codeRef(pending.code), { status: 'redeemed', uid, redeemedAt: Date.now() }, { merge: true });
  tx.delete(pendingRef(pending.email));
}

export function batchFullMessage(): string {
  return `Dear Trader, every seat in MarketX Batch ${ACCESS_BATCH} has now been allocated. Kindly await the release of Batch ${
    ACCESS_BATCH + 1
  } to access MarketX. Thank you for your patience; we'll be opening new seats soon.`;
}
