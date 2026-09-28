import crypto from 'crypto';
import type { Request, Response } from 'express';
import { db } from './firebase';
import { clientIp } from './security';

// ===========================================================================
// Sign-up abuse protection: one device, one email, one IP.
//
// Every sign-up (email or Google) and every pass-code redemption is tied to what we can see of the device:
//   device  - a random id in a long-lived httpOnly cookie (mx_did), set on first contact
//   client  - a random id the app keeps in localStorage (survives some cookie clearing)
//   fpnet   - a browser fingerprint combined with the network (/24 IPv4, /48 IPv6), which still matches
//             in a private window or after clearing site data on the same connection, without blocking
//             strangers who happen to own the same phone model elsewhere
//   ip      - the client IP (Render/Cloudflare edge header), limited per rolling window
// Each signal is stored as a keyed hash (HMAC with the server secret) in signupGuards/{hash}, bound to the
// canonical email that first used it. A signal bound to a different person blocks the sign-up.
// Bindings from a sign-up that was never completed are released once its pass code expires; bindings of a
// real account are permanent (deleting the account and registering a new email on the same device fails).
// Email aliases (Gmail dots, +tags, googlemail.com) count as the same address; disposable inboxes are refused.
// ===========================================================================

export type GuardKind = 'device' | 'client' | 'fpnet' | 'ip';

export interface DeviceSignals {
  ip: string | null;
  deviceId: string; // cookie id (always present: created when missing)
  clientId: string | null;
  fingerprint: string | null;
  userAgent: string;
}

export interface SignupMeta {
  ip: string | null;
  userAgent: string;
  deviceId: string;
  at: number;
}

interface GuardEntry {
  email: string; // canonical
  raw: string; // address as typed
  at: number;
  active: boolean; // true once the account exists
}

interface GuardDoc {
  kind: GuardKind;
  entries: GuardEntry[];
  updatedAt: number;
}

const DEVICE_COOKIE = 'mx_did';
const DEVICE_COOKIE_MAX_AGE = 2 * 365 * 24 * 3600 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const FP_RE = /^[a-f0-9]{64}$/;

/** Accounts allowed per IP inside the window (0 disables the IP rule). Default: one. */
const perIpLimit = () => {
  const v = Number(process.env.SIGNUP_ACCOUNTS_PER_IP);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 1;
};
/** IPs are reassigned over time, so an IP binding only counts for this many days. */
const ipWindowMs = () => {
  const v = Number(process.env.SIGNUP_IP_WINDOW_DAYS);
  return (Number.isFinite(v) && v > 0 ? v : 30) * 24 * 3600 * 1000;
};

const guardRef = (key: string) => db().collection('signupGuards').doc(key);
const secret = () => process.env.SESSION_SECRET || 'marketx-dev-secret';
const keyFor = (kind: GuardKind, value: string) => crypto.createHmac('sha256', secret()).update(`${kind}:${value}`).digest('hex');

// ---------------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------------
/** One address per person: lower case, no +tag, and Gmail's dots / googlemail.com folded. */
export function canonicalEmail(email: string): string {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at).split('+')[0];
  let domain = e.slice(at + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

const DISPOSABLE = new Set(
  (
    '10minutemail.com 10minutemail.net 20minutemail.com 33mail.com anonbox.net burnermail.io byom.de ' +
    'discard.email disposableemailaddresses.com dispostable.com dropmail.me emailondeck.com fakeinbox.com ' +
    'fakemail.net getairmail.com getnada.com nada.email guerrillamail.com guerrillamail.net guerrillamail.org ' +
    'guerrillamail.biz guerrillamail.de guerrillamailblock.com grr.la sharklasers.com spam4.me pokemail.net ' +
    'harakirimail.com inboxkitten.com mail-temp.com mail.tm mailcatch.com maildrop.cc mailinator.com ' +
    'mailinator.net mailinator2.com mailnesia.com mailpoof.com mintemail.com moakt.com mohmal.com mytemp.email ' +
    'mytrashmail.com nowmymail.com spambox.us spamgourmet.com temp-mail.org temp-mail.io tempmail.com ' +
    'tempmail.net tempmail.plus tempmailo.com tempr.email tempail.com throwawaymail.com trashmail.com ' +
    'trashmail.de trashmail.net trashmail.io wegwerfmail.de yopmail.com yopmail.net yopmail.fr cool.fr.nf ' +
    'jetable.org emailfake.com fexpost.com fextemp.com linshiyouxiang.net 1secmail.com 1secmail.org ' +
    '1secmail.net emailtemporanea.com mailto.plus tmpmail.org tmpmail.net tmpeml.com minuteinbox.com'
  ).split(/\s+/)
);

export function isDisposableEmail(email: string): boolean {
  const domain = String(email || '').trim().toLowerCase().split('@')[1] || '';
  if (!domain) return false;
  // Also catch subdomains (x.mailinator.com)
  return [...DISPOSABLE].some(d => domain === d || domain.endsWith(`.${d}`));
}

// ---------------------------------------------------------------------------
// Device signals
// ---------------------------------------------------------------------------
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** /24 for IPv4, /48 for IPv6 (a household, office or mobile cell), '' when unknown. */
export function networkOf(ip: string | null): string {
  if (!ip) return '';
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.split('.').slice(0, 3).join('.');
  if (ip.includes(':')) return ip.toLowerCase().split(':').slice(0, 3).join(':');
  return ip;
}

/** Reads (and on first contact sets) the device cookie, plus the client-sent id and fingerprint. */
export function readDeviceSignals(req: Request, res: Response): DeviceSignals {
  let deviceId = readCookie(req, DEVICE_COOKIE);
  if (!deviceId || !ID_RE.test(deviceId)) {
    deviceId = crypto.randomBytes(18).toString('base64url');
    res.cookie(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: DEVICE_COOKIE_MAX_AGE,
    });
  }
  const dev = (req.body && typeof req.body.device === 'object' && req.body.device) || {};
  const clientId = typeof dev.id === 'string' && ID_RE.test(dev.id) ? dev.id : null;
  const fingerprint = typeof dev.fp === 'string' && FP_RE.test(dev.fp) ? dev.fp : null;
  const ipRaw = clientIp(req);
  const ip = ipRaw && ipRaw !== 'unknown' ? ipRaw.slice(0, 64) : null;
  return { ip, deviceId, clientId, fingerprint, userAgent: String(req.headers['user-agent'] || '').slice(0, 200) };
}

export function signupMetaOf(s: DeviceSignals): SignupMeta {
  return { ip: s.ip, userAgent: s.userAgent, deviceId: s.deviceId, at: Date.now() };
}

export type GuardKey = { kind: GuardKind; key: string };

export function keysOf(s: DeviceSignals): GuardKey[] {
  const out: GuardKey[] = [{ kind: 'device', key: keyFor('device', s.deviceId) }];
  if (s.clientId) out.push({ kind: 'client', key: keyFor('client', s.clientId) });
  if (s.fingerprint && s.ip) out.push({ kind: 'fpnet', key: keyFor('fpnet', `${s.fingerprint}@${networkOf(s.ip)}`) });
  if (s.ip && perIpLimit() > 0) out.push({ kind: 'ip', key: keyFor('ip', s.ip) });
  return out;
}

// ---------------------------------------------------------------------------
// Check + reserve
// ---------------------------------------------------------------------------
export type GuardVerdict =
  | { ok: true }
  | { ok: false; error: 'DEVICE_USED' | 'NETWORK_USED' | 'DISPOSABLE_EMAIL' | 'ALIAS_IN_USE'; message: string };

const DEVICE_USED = {
  ok: false as const,
  error: 'DEVICE_USED' as const,
  message: 'This device has already been used to register a MarketX account. Each device can register one account. Sign in with that account instead.',
};
const NETWORK_USED = {
  ok: false as const,
  error: 'NETWORK_USED' as const,
  message: 'An account was already registered from this network recently. Each connection can register one account. Sign in with that account instead, or contact support.',
};

/**
 * Whether an entry still holds its slot. `stillWaiting(raw)` says if that address still has a live pending
 * sign-up (entries of sign-ups whose pass code expired unredeemed are released).
 */
async function entryHolds(e: GuardEntry, kind: GuardKind, now: number, stillWaiting: (raw: string) => Promise<boolean>): Promise<boolean> {
  if (kind === 'ip' && now - e.at > ipWindowMs()) return false;
  if (e.active) return true;
  // Just bound: its pending sign-up may still be being created, so it always holds for a while
  if (now - e.at < 10 * 60 * 1000) return true;
  return stillWaiting(e.raw);
}

/**
 * Checks the device/network/alias rules and, when allowed, binds this device to the email (as pending).
 * `emailInUse(canonical)` returns the address of another account or live sign-up using the same canonical email.
 */
export async function reserveSignup(
  email: string,
  s: DeviceSignals,
  helpers: {
    stillWaiting: (rawEmail: string) => Promise<boolean>;
    aliasOwner: (canonical: string, rawEmail: string) => Promise<string | null>;
  }
): Promise<GuardVerdict> {
  const raw = String(email).trim().toLowerCase();
  const canon = canonicalEmail(raw);
  if (isDisposableEmail(raw)) {
    return { ok: false, error: 'DISPOSABLE_EMAIL', message: 'Temporary or disposable email addresses cannot be used. Please sign up with your own email.' };
  }
  const other = await helpers.aliasOwner(canon, raw);
  if (other) {
    return {
      ok: false,
      error: 'ALIAS_IN_USE',
      message: 'An account already exists for this email address (dots and +tags count as the same address). Sign in with that account instead.',
    };
  }

  const keys = keysOf(s);
  const now = Date.now();
  const limitOf = (kind: GuardKind) => (kind === 'ip' ? perIpLimit() : 1);
  const rejectFor = (kind: GuardKind) => (kind === 'ip' || kind === 'fpnet' ? NETWORK_USED : DEVICE_USED);

  // 1. Decide which existing bindings still hold (needs async look-ups, so outside the transaction)
  const snaps = await Promise.all(keys.map(k => guardRef(k.key).get()));
  const seen: Array<Set<string>> = [];
  const holding: Array<Set<string>> = [];
  for (let i = 0; i < keys.length; i++) {
    const doc = snaps[i].exists ? (snaps[i].data() as GuardDoc) : null;
    const seenHere = new Set<string>();
    const holdHere = new Set<string>();
    for (const e of doc?.entries || []) {
      if (e.email === canon) continue;
      seenHere.add(e.email);
      if (await entryHolds(e, keys[i].kind, now, helpers.stillWaiting)) holdHere.add(e.email);
    }
    seen.push(seenHere);
    holding.push(holdHere);
    if (holdHere.size >= limitOf(keys[i].kind)) return rejectFor(keys[i].kind);
  }

  // 2. Bind atomically; anything added by a parallel sign-up since step 1 counts as holding
  return db().runTransaction(async tx => {
    const fresh = await Promise.all(keys.map(k => tx.get(guardRef(k.key))));
    const next: GuardDoc[] = [];
    for (let i = 0; i < keys.length; i++) {
      const { kind } = keys[i];
      const doc = fresh[i].exists ? (fresh[i].data() as GuardDoc) : null;
      const entries = doc?.entries || [];
      const others = entries.filter(e => e.email !== canon && (holding[i].has(e.email) || !seen[i].has(e.email)));
      if (others.length >= limitOf(kind)) return rejectFor(kind);
      const mine = entries.find(e => e.email === canon);
      next.push({
        kind,
        // Released bindings are dropped; mine is added or refreshed
        entries: [...others, { email: canon, raw, at: mine?.at || now, active: !!mine?.active }].slice(-20),
        updatedAt: now,
      });
    }
    keys.forEach((k, i) => tx.set(guardRef(k.key), next[i]));
    return { ok: true } as GuardVerdict;
  });
}

/** Marks bindings for the email as a real account (permanent): the sign-up device's keys plus the redeeming device's. */
export async function activateSignup(email: string, keys: GuardKey[]): Promise<void> {
  const canon = canonicalEmail(email);
  const raw = String(email).trim().toLowerCase();
  const now = Date.now();
  const unique = keys.filter((k, i) => k && typeof k.key === 'string' && /^[a-f0-9]{64}$/.test(k.key) && keys.findIndex(x => x.key === k.key) === i).slice(0, 12);
  await Promise.all(
    unique.map(k =>
      db().runTransaction(async tx => {
        const ref = guardRef(k.key);
        const snap = await tx.get(ref);
        const doc = snap.exists ? (snap.data() as GuardDoc) : null;
        const rest = (doc?.entries || []).filter(e => e.email !== canon);
        const mine = (doc?.entries || []).find(e => e.email === canon);
        tx.set(ref, { kind: k.kind, entries: [...rest, { email: canon, raw, at: mine?.at || now, active: true }].slice(-20), updatedAt: now } as GuardDoc);
      })
    )
  );
}

/** Frees this device's pending (never activated) bindings for an email, e.g. when the batch was full. */
export async function releasePendingSignup(email: string, s: DeviceSignals): Promise<void> {
  const canon = canonicalEmail(email);
  await Promise.all(
    keysOf(s).map(k =>
      db().runTransaction(async tx => {
        const ref = guardRef(k.key);
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const doc = snap.data() as GuardDoc;
        const entries = (doc.entries || []).filter(e => e.email !== canon || e.active);
        tx.set(ref, { ...doc, entries, updatedAt: Date.now() });
      })
    )
  );
}
