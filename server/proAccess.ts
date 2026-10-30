import type { NextFunction, Request, Response } from 'express';
import { getUser, isUnlimitedEmail, userRef, type UserDoc } from './account';
import { DEFAULT_PREFERENCES, withDefaults, type Preferences } from '../src/utils/preferences';
import type { ProFeature } from '../src/utils/proFeatures';

// ===========================================================================
// Pro features (owner-specified): open to everyone until 1 November 2026 (Africa/Lagos midnight), then Pro only:
//   Watchlist, Trade Journal, Strategy Builder, Fundamental Analysis (incl. Check fundamental, Recheck and the daily
//   news alerts), Preference Mode (incl. confirmation mode, trade types, the RDM timeframe choice and the calculator)
//   chart screenshot analyses and the Trading Agent (server/tradingAgent.ts `agentAccess`; credits still per trade).
// Free for everyone, always: price alerts (Auto and Manual), the track record and the RDM timeframe.
// Free accounts can't open, turn on or use the Pro ones (every route checks, before any credit is used), their saved
// preferences are ignored (defaults apply), and a sweep switches off what they still have running. Their data is kept
// for when they upgrade. PRO_GATE_AT (ms) overrides the date for tests.
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

/** When a feature pass (a feature code the trader redeemed, server/featureCodes.ts) for this one feature runs out (0 = none) */
export const featurePassUntil = (doc: UserDoc | undefined, f: ProFeature): number => Number((doc as any)?.featurePasses?.[f]) || 0;

/** Whether this account may use ONE Pro feature: Pro features in general, or a live feature pass for just that feature */
export const hasFeature = (doc: UserDoc | undefined, f: ProFeature, now = Date.now()) => hasProFeatures(doc, now) || featurePassUntil(doc, f) > now;

/** The feature passes still running, for the app ({feature: until}) */
export function livePasses(doc: UserDoc | undefined, now = Date.now()): Partial<Record<ProFeature, number>> {
  const raw = ((doc as any)?.featurePasses || {}) as Record<string, number>;
  return Object.fromEntries(Object.entries(raw).filter(([, until]) => Number(until) > now)) as Partial<Record<ProFeature, number>>;
}

export const PRO_REQUIRED = {
  error: 'PRO_REQUIRED',
  message: 'This is a Pro feature. Upgrade to Pro to keep using it.',
};

/** Route guard for one feature: 402 PRO_REQUIRED once the free period has ended, unless Pro or a pass for that feature */
export const requireFeature = (f: ProFeature) => (req: Request, res: Response, next: NextFunction) => proGuard(PRO_REQUIRED.message, f)(req, res, next);

/** The same guard with a message naming the feature */
export const proGuard = (message: string, f: ProFeature) => async (_req: Request, res: Response, next: NextFunction) => {
  if (!proGateActive()) return next();
  let allowed = false;
  try {
    allowed = hasFeature((await userRef(getUser(res).uid).get()).data() as UserDoc | undefined, f);
  } catch {
    return res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
  }
  if (allowed) return next();
  res.status(402).json({ error: PRO_REQUIRED.error, message });
};

/** Turning one feature on is Pro (or its pass) only after the free period; turning it off always works */
export const requireFeatureToEnable = (f: ProFeature) => (req: Request, res: Response, next: NextFunction) => {
  if (req.body?.enabled !== true) return next();
  return requireFeature(f)(req, res, next);
};

/** The preferences that apply to this trader: their own on Pro (or before the gate), the defaults otherwise */
export function effectivePreferences(doc: UserDoc | undefined, now = Date.now()): Preferences {
  return hasFeature(doc, 'preference', now) ? withDefaults((doc as any)?.preferences) : withDefaults(DEFAULT_PREFERENCES);
}
