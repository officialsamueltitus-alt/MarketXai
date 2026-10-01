import type { NextFunction, Request, Response } from 'express';
import { getUser, isUnlimitedEmail, userRef, type UserDoc } from './account';

// ===========================================================================
// Pro features (owner-specified): the commands (/price-alerts, /watchlist, /trade-journal, /track-record) and the RDM
// timeframe are open to everyone until 1 November 2026 (Africa/Lagos midnight). From then on they are for Pro only:
// free accounts can't open or turn them on, and a sweep switches off what free accounts still have running (their
// pairs, trades and results are kept for when they upgrade). PRO_GATE_AT (ms) overrides the date for tests.
// ===========================================================================

/** 1 November 2026, 00:00 in Lagos (UTC+1) */
export const PRO_GATE_AT = Number(process.env.PRO_GATE_AT) || Date.UTC(2026, 9, 31, 23, 0, 0);

export const proGateActive = (now = Date.now()) => now >= PRO_GATE_AT;

/** A paid plan that hasn't run out, or a verified owner/staff account with unlimited access */
export function isProDoc(doc: UserDoc | undefined, now = Date.now()): boolean {
  if (!doc) return false;
  if (doc.emailVerified && isUnlimitedEmail(doc.email)) return true;
  const sub = doc.subscription;
  return !!sub?.active && sub.plan !== 'free' && (!sub.expiresAt || sub.expiresAt > now);
}

/** Whether this account may use the Pro features right now */
export const hasProFeatures = (doc: UserDoc | undefined, now = Date.now()) => !proGateActive(now) || isProDoc(doc, now);

export const PRO_REQUIRED = {
  error: 'PRO_REQUIRED',
  message: 'This is a Pro feature. Upgrade to Pro to keep using it.',
};

/** Route guard: 402 PRO_REQUIRED for free accounts once the free period has ended */
export function requirePro(req: Request, res: Response, next: NextFunction) {
  return proGuard(PRO_REQUIRED.message)(req, res, next);
}

/** The same guard with a message naming the feature */
export const proGuard = (message: string) => async (_req: Request, res: Response, next: NextFunction) => {
  if (!proGateActive()) return next();
  let allowed = false;
  try {
    allowed = hasProFeatures((await userRef(getUser(res).uid).get()).data() as UserDoc | undefined);
  } catch {
    return res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
  }
  if (allowed) return next();
  res.status(402).json({ error: PRO_REQUIRED.error, message });
};

/** Turning something on is Pro only after the free period; turning it off always works */
export function requireProToEnable(req: Request, res: Response, next: NextFunction) {
  if (req.body?.enabled !== true) return next();
  return requirePro(req, res, next);
}
