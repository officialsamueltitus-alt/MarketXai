import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase';
import { requireAdmin } from './admin';
import { addNotificationInTx, getUser, isUnlimitedEmail, requireAuth, userRef, type UserDoc } from './account';
import { couponState, isValidCode, normalizeCode } from './coupons';
import { isProDoc } from './proAccess';
import { createKeyedThrottle } from './security';
import { PRO_FEATURES, type ProFeature } from '../src/utils/proFeatures';

// ===========================================================================
// Feature codes (owner-specified, Admin → Coupons → Feature codes): a code that unlocks ONE Pro feature for free for a
// number of days, and nothing else (not full Pro, no discount).
//
//   featureCodes/{CODE}        -> {code, feature, days, maxUses (0 = no limit), uses, active, startsAt, endsAt, note}
//   featureCodes/{CODE}/claims/{sha256(email)} -> one redeem per person per code (survives a deleted account)
//   users.featurePasses.{feature} = until (ms); renewing adds the days on top of a pass still running
//
//   Checked everywhere through `hasFeature(doc, feature)` in server/proAccess.ts (the routes, the sweep that pauses tools
//   on free accounts, the app's locks via `profile.featurePasses`). Traders type the code in the Plans window's coupon box
//   (`/api/coupons/check` answers `kind: 'feature'`) or open `/?pricing=1&coupon=CODE`. Codes share one namespace with
//   discount coupons, so the same code can never be both.
// ===========================================================================

export interface FeatureCode {
  code: string;
  feature: ProFeature;
  days: number;
  maxUses: number;
  uses: number;
  active: boolean;
  startsAt: number | null;
  endsAt: number | null;
  /** Admin's own note (never shown to traders) */
  note: string;
  createdAt: number;
  updatedAt: number;
}

export const MAX_PASS_DAYS = 365;
const DAY = 86_400_000;
const codeRef = (code: string) => db().collection('featureCodes').doc(code);
const claimRef = (code: string, email: string) =>
  codeRef(code).collection('claims').doc(crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex'));

export const isFeature = (f: unknown): f is ProFeature => typeof f === 'string' && f in PRO_FEATURES;
export const featureLabel = (f: ProFeature) => PRO_FEATURES[f];

const timeOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const int = (v: unknown, lo: number, hi: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= lo && n <= hi ? n : null;
};

/** LIVE (on, started, not ended, uses left), else why not */
export function featureCodeState(c: FeatureCode, now = Date.now()): 'LIVE' | 'OFF' | 'SCHEDULED' | 'EXPIRED' | 'USED_UP' {
  const s = couponState(c, now);
  if (s !== 'LIVE') return s;
  return c.maxUses > 0 && c.uses >= c.maxUses ? 'USED_UP' : 'LIVE';
}

/** A live feature code, for the coupon box (null = not a feature code, or not usable now) */
export async function liveFeatureCode(code: string): Promise<FeatureCode | null> {
  if (!isValidCode(code)) return null;
  const snap = await codeRef(code).get();
  if (!snap.exists) return null;
  const c = snap.data() as FeatureCode;
  return featureCodeState(c) === 'LIVE' ? c : null;
}

export const featureCodeExists = async (code: string) => (await codeRef(code).get()).exists;

export const featureCodeView = (c: FeatureCode) => ({ code: c.code, feature: c.feature, label: featureLabel(c.feature), days: c.days });

type RedeemResult = { ok: true; feature: ProFeature; label: string; until: number; days: number } | { ok: false; status: number; error: string; message: string };

/** Redeems a code for this trader (transaction): the pass for that one feature starts (or grows) */
export async function redeemFeatureCode(uid: string, raw: unknown, now = Date.now()): Promise<RedeemResult> {
  const code = normalizeCode(raw);
  const bad = { ok: false as const, status: 400, error: 'CODE_INVALID', message: "That code isn't valid." };
  if (!isValidCode(code)) return bad;
  return db().runTransaction(async (tx): Promise<RedeemResult> => {
    const [cs, us] = await Promise.all([tx.get(codeRef(code)), tx.get(userRef(uid))]);
    if (!cs.exists || !us.exists) return bad;
    const c = cs.data() as FeatureCode;
    const u = us.data() as UserDoc;
    const state = featureCodeState(c, now);
    // A code that hasn't started reads like an unknown one (upcoming promos can't be discovered)
    if (state === 'OFF' || state === 'SCHEDULED') return bad;
    if (state === 'EXPIRED') return { ok: false, status: 400, error: 'CODE_EXPIRED', message: 'This code has expired.' };
    if (state === 'USED_UP') return { ok: false, status: 400, error: 'CODE_USED_UP', message: 'This code has been fully used.' };
    if ((u.emailVerified && isUnlimitedEmail(u.email)) || isProDoc(u, now)) {
      return { ok: false, status: 409, error: 'ALREADY_PRO', message: `Your Pro plan already includes ${featureLabel(c.feature)}.` };
    }
    const claim = claimRef(code, u.email);
    if ((await tx.get(claim)).exists) return { ok: false, status: 409, error: 'CODE_USED', message: 'You have already used this code.' };
    const current = Number((u as any).featurePasses?.[c.feature]) || 0;
    const until = Math.max(current, now) + c.days * DAY;
    tx.update(userRef(uid), { [`featurePasses.${c.feature}`]: until });
    tx.set(claim, { at: now, uid, until });
    tx.update(codeRef(code), { uses: FieldValue.increment(1), updatedAt: now });
    const end = new Date(until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
    addNotificationInTx(tx, uid, {
      type: 'reward',
      title: `${featureLabel(c.feature)} unlocked`,
      message: `Code ${code}: ${featureLabel(c.feature)} is yours free until ${end}. It unlocks this feature only.`,
    } as any);
    return { ok: true, feature: c.feature, label: featureLabel(c.feature), until, days: c.days };
  });
}

/** Admin input → fields (validated); `partial` keeps fields that were not sent */
function codeInput(b: any, partial: boolean): Partial<FeatureCode> | { error: string } {
  const out: Partial<FeatureCode> = {};
  if (!partial || 'feature' in b) {
    if (!isFeature(b.feature)) return { error: 'Pick the feature the code unlocks.' };
    out.feature = b.feature;
  }
  if (!partial || 'days' in b) {
    const d = int(b.days, 1, MAX_PASS_DAYS);
    if (d === null) return { error: `Days must be 1 to ${MAX_PASS_DAYS}.` };
    out.days = d;
  }
  if (!partial || 'maxUses' in b) {
    const m = int(b.maxUses ?? 0, 0, 1_000_000);
    if (m === null) return { error: 'Uses must be 0 (no limit) or more.' };
    out.maxUses = m;
  }
  if (!partial || 'active' in b) out.active = b.active !== false;
  if (!partial || 'startsAt' in b) out.startsAt = timeOrNull(b.startsAt);
  if (!partial || 'endsAt' in b) out.endsAt = timeOrNull(b.endsAt);
  if (!partial || 'note' in b) out.note = String(b.note ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (out.startsAt && out.endsAt && out.endsAt <= out.startsAt) return { error: 'The end date must be after the start date.' };
  return out;
}

export function registerFeatureCodeRoutes(app: Express, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) =>
    fn(req, res).catch(err => {
      console.error(`[MarketX Feature codes] ${req.method} ${req.path} failed:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
    });
  const throttle = createKeyedThrottle({ windowMs: 60_000, max: 10 });

  app.post('/api/feature-codes/redeem', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    if (throttle.hit(uid)) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many tries. Please wait a minute.' });
    const r = await redeemFeatureCode(uid, req.body?.code);
    if (r.ok === false) return res.status(r.status).json({ error: r.error, message: r.message });
    res.json(r);
  }));

  // --- Admin --------------------------------------------------------------
  app.get('/api/admin/feature-codes', requireAdmin, wrap(async (_req, res) => {
    const snap = await db().collection('featureCodes').limit(300).get();
    const now = Date.now();
    const codes = snap.docs
      .map(d => d.data() as FeatureCode)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(c => ({ ...c, label: featureLabel(c.feature), state: featureCodeState(c, now) }));
    res.json({ codes, features: Object.entries(PRO_FEATURES).map(([id, label]) => ({ id, label })) });
  }));

  app.post('/api/admin/feature-codes', requireAdmin, wrap(async (req, res) => {
    const code = normalizeCode(req.body?.code);
    if (!isValidCode(code)) return res.status(400).json({ error: 'INVALID_CODE', message: 'Use 3 to 24 letters, numbers, - or _.' });
    const input = codeInput(req.body || {}, false);
    if ('error' in input) return res.status(400).json({ error: 'INVALID', message: input.error });
    const now = Date.now();
    const created = await db().runTransaction(async t => {
      const [mine, coupon] = await Promise.all([t.get(codeRef(code)), t.get(db().collection('coupons').doc(code))]);
      if (mine.exists || coupon.exists) return false;
      t.set(codeRef(code), { code, ...input, uses: 0, createdAt: now, updatedAt: now });
      return true;
    });
    if (!created) return res.status(409).json({ error: 'EXISTS', message: 'That code is already used by a coupon or feature code.' });
    res.json({ success: true });
  }));

  app.patch('/api/admin/feature-codes/:code', requireAdmin, wrap(async (req, res) => {
    const code = normalizeCode(req.params.code);
    if (!isValidCode(code)) return res.status(400).json({ error: 'INVALID_CODE' });
    const input = codeInput(req.body || {}, true);
    if ('error' in input) return res.status(400).json({ error: 'INVALID', message: input.error });
    const r = await db().runTransaction(async t => {
      const snap = await t.get(codeRef(code));
      if (!snap.exists) return 'MISSING';
      const next = { ...(snap.data() as FeatureCode), ...input };
      if (next.startsAt && next.endsAt && next.endsAt <= next.startsAt) return 'DATES';
      t.update(codeRef(code), { ...input, updatedAt: Date.now() });
      return 'OK';
    });
    if (r === 'MISSING') return res.status(404).json({ error: 'NOT_FOUND', message: 'No such code.' });
    if (r === 'DATES') return res.status(400).json({ error: 'INVALID', message: 'The end date must be after the start date.' });
    res.json({ success: true });
  }));

  // Deleting a code stops new redeems; passes already given run to their end
  app.delete('/api/admin/feature-codes/:code', requireAdmin, wrap(async (req, res) => {
    const code = normalizeCode(req.params.code);
    if (!isValidCode(code)) return res.status(400).json({ error: 'INVALID_CODE' });
    await db().recursiveDelete(codeRef(code));
    res.json({ success: true });
  }));
}
