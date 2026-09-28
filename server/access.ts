import crypto from 'crypto';
import type { Transaction } from 'firebase-admin/firestore';
import { db } from './firebase';

// ---------------------------------------------------------------------------
// Invite-only access: a fixed batch of one-time pass codes.
//   accessBatches/batch-N   -> { batch, codes: string[], next, free: string[], createdAt }  (server-only, never sent to clients)
//   accessCodes/{code}      -> { status: 'reserved' | 'redeemed' | 'expired', email, uid?, reservedAt, redeemedAt?, expiredAt? }
//   pendingSignups/{email}  -> a sign-up waiting for its pass code; the account is only created on redeem
// Each code is reserved for exactly one email, emailed once, and expires when redeemed.
// A code that isn't redeemed within 48 hours expires: the pending sign-up is removed and the seat
// goes back to the batch with a brand-new code (the old code is dead, so it can't be reused).
// When every code in the batch is reserved, new sign-ups are refused until the next batch.
// ---------------------------------------------------------------------------

export const ACCESS_BATCH = Math.max(1, Math.floor(Number(process.env.ACCESS_CODE_BATCH) || 1));
export const ACCESS_BATCH_SIZE = 50;
const BATCH_SIZE = ACCESS_BATCH_SIZE;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O or 1/I lookalikes
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
// Long enough for the paced mail queue to deliver during a sign-up burst, so a code is never sent twice
const SEND_CLAIM_MS = 10 * 60 * 1000;
export const PASSCODE_TTL_MS = 48 * 60 * 60 * 1000;
export const PASSCODE_TTL_HOURS = PASSCODE_TTL_MS / 3600000;

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
  termsAcceptedAt?: number;
  /** Where the sign-up came from (IP, user agent, device cookie id) */
  signupMeta?: { ip: string | null; userAgent: string; deviceId: string; at: number };
  /** Device/network guard keys bound to this sign-up (made permanent when the code is redeemed) */
  guardKeys?: Array<{ kind: string; key: string }>;
  createdAt: number;
  codeEmailSentAt?: number | null;
  codeEmailClaimAt?: number | null;
  attempts?: number;
  lockedUntil?: number;
  expiresAt?: number;
}

interface BatchDoc {
  batch: number;
  size: number;
  codes: string[];
  next: number;
  free?: string[];
  createdAt: number;
}

const expiryOf = (p: PendingSignup) => p.expiresAt || (p.createdAt || 0) + PASSCODE_TTL_MS;
export const isPendingExpired = (p: PendingSignup, now = Date.now()) => expiryOf(p) <= now;

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

/**
 * Expires a pending sign-up inside a transaction: the old code is retired and the seat returns to its
 * batch with a fresh code. All reads must already be done by the caller (batchSnap may be null for
 * pending sign-ups from an older batch, whose seats are simply retired).
 */
function releaseSeatInTx(tx: Transaction, p: PendingSignup, batch: BatchDoc | null, batchDocRef: FirebaseFirestore.DocumentReference | null) {
  const now = Date.now();
  tx.set(codeRef(p.code), { status: 'expired', expiredAt: now }, { merge: true });
  tx.delete(pendingRef(p.email));
  if (batch && batchDocRef) {
    const taken = new Set([...batch.codes, ...(batch.free || [])]);
    let fresh = newCode();
    while (taken.has(fresh)) fresh = newCode();
    batch.free = [...(batch.free || []), fresh];
    batch.codes = [...batch.codes, fresh];
    tx.update(batchDocRef, { free: batch.free, codes: batch.codes });
  }
}

const batchRefFor = (n: number) => db().collection('accessBatches').doc(`batch-${n}`);

/** Expires one pending sign-up if its 48 hours are up. Returns true if it was released. */
export async function expirePendingIfDue(email: string): Promise<boolean> {
  return db().runTransaction(async tx => {
    const snap = await tx.get(pendingRef(email));
    if (!snap.exists) return false;
    const p = snap.data() as PendingSignup;
    if (!isPendingExpired(p)) return false;
    const bRef = batchRefFor(p.batch || ACCESS_BATCH);
    const bSnap = await tx.get(bRef);
    releaseSeatInTx(tx, p, bSnap.exists ? (bSnap.data() as BatchDoc) : null, bSnap.exists ? bRef : null);
    return true;
  });
}

/** Sweeps every expired pending sign-up back into its batch. Safe to run repeatedly. */
export async function releaseExpiredPasscodes(): Promise<number> {
  const snap = await db().collection('pendingSignups').get();
  const now = Date.now();
  let released = 0;
  for (const d of snap.docs) {
    const p = d.data() as PendingSignup;
    if (p?.email && isPendingExpired(p, now)) {
      if (await expirePendingIfDue(p.email).catch(() => false)) released++;
    }
  }
  if (released) console.log(`[MarketX Access] ${released} unused pass code(s) expired and returned to the batch.`);
  return released;
}

/** Seats taken in the current batch (reserved or redeemed), for the admin console. */
export function allocatedSeats(batch: Partial<BatchDoc> | undefined | null): number {
  if (!batch) return 0;
  // Seats handed out from the original list, minus seats that expired and are waiting in `free`
  return Math.max(0, (batch.next || 0) - (batch.free?.length || 0));
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
    const batchSnap = await tx.get(batchRef());
    const batch = batchSnap.data() as BatchDoc;
    const now = Date.now();
    let old = existing.exists ? (existing.data() as PendingSignup) : null;
    if (old && !isPendingExpired(old, now)) return { status: 'exists', pending: old };
    // Their earlier code lapsed: retire it (its seat goes back to the batch) and start over
    if (old && old.batch === ACCESS_BATCH && batch) releaseSeatInTx(tx, old, batch, batchRef());
    else if (old) releaseSeatInTx(tx, old, null, null);
    if (!batch) return { status: 'full' };

    let code: string;
    const update: Record<string, unknown> = {};
    if (batch.free && batch.free.length) {
      code = batch.free[0];
      update.free = batch.free.slice(1);
    } else if (batch.next < Math.min(batch.codes.length, batch.size || BATCH_SIZE)) {
      code = batch.codes[batch.next];
      update.next = batch.next + 1;
    } else {
      return { status: 'full' };
    }
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
      expiresAt: now + PASSCODE_TTL_MS,
    };
    tx.update(batchRef(), update);
    tx.set(codeRef(code), { code, batch: ACCESS_BATCH, status: 'reserved', email: pending.email, reservedAt: now });
    // Firestore rejects undefined values (e.g. a sign-up without a username)
    const clean = JSON.parse(JSON.stringify(pending)) as PendingSignup;
    tx.set(pRef, clean);
    return { status: 'created', pending: clean };
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
  | { status: 'expired' }
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
    if (isPendingExpired(p, now)) {
      const bRef = batchRefFor(p.batch || ACCESS_BATCH);
      const bSnap = await tx.get(bRef);
      releaseSeatInTx(tx, p, bSnap.exists ? (bSnap.data() as BatchDoc) : null, bSnap.exists ? bRef : null);
      return { status: 'expired' };
    }
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
