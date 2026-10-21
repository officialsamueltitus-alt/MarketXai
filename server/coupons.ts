// ===========================================================================
// Coupon codes (owner-specified): percent off Pro Monthly / Yearly, created and switched on/off by the admin.
//
//   coupons/{CODE} -> { code, monthlyPct, yearlyPct, active, startsAt, endsAt, title, text, banner, mailAt, mail, uses }
//
// A code only ever works while it is LIVE: switched on, after startsAt and before endsAt (server time). The checkout
// (`/api/payments/initialize`) prices the plan with the coupon on the server; the browser never sends an amount.
// Turning a code off, or its end date passing, stops it at once (nothing is cached for checks or checkouts).
// A coupon with `banner` shows the promo pop-up on the site while LIVE; one with `mailAt` is announced by email to every
// trader ONCE (lead worker, claimed with a lease, resumes after a restart from the last trader it reached).
// The Christmas promo (MKXCMAS01) is seeded once; deleting it in Admin never brings it back.
// ===========================================================================
import type { Express, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db, isFirebaseConfigured } from './firebase';
import { sendEmail, isMailerConfigured } from './mailer';
import { IS_LEAD_WORKER } from './workers';
import { requireAdmin } from './admin';
import { planPrice } from './payments';

export type CouponPlan = 'monthly' | 'yearly';
export type CouponState = 'LIVE' | 'OFF' | 'SCHEDULED' | 'EXPIRED';

export interface Coupon {
  code: string;
  monthlyPct: number;
  yearlyPct: number;
  active: boolean;
  startsAt: number | null;
  endsAt: number | null;
  title: string;
  text: string;
  banner: boolean;
  mailAt: number | null;
  mail?: { state?: 'SENDING' | 'SENT'; sent?: number; lastUid?: string; leaseUntil?: number; doneAt?: number };
  uses?: { monthly?: number; yearly?: number };
  createdAt: number;
  updatedAt: number;
}

export const MAX_PCT = 90;
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{2,23}$/;
const SITE_TZ = 'Africa/Lagos';
const couponRef = (code: string) => db().collection('coupons').doc(code);

export const normalizeCode = (raw: unknown): string =>
  String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .slice(0, 24);

export const isValidCode = (code: string) => CODE_RE.test(code);

const clampPct = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(MAX_PCT, Math.max(0, n)) : 0;
};
const cleanText = (v: unknown, n: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);
const timeOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function couponState(c: Pick<Coupon, 'active' | 'startsAt' | 'endsAt'>, now = Date.now()): CouponState {
  if (!c.active) return 'OFF';
  if (c.startsAt && now < c.startsAt) return 'SCHEDULED';
  if (c.endsAt && now > c.endsAt) return 'EXPIRED';
  return 'LIVE';
}

export const couponPct = (c: Pick<Coupon, 'monthlyPct' | 'yearlyPct'>, plan: CouponPlan) => (plan === 'yearly' ? c.yearlyPct : c.monthlyPct);

const dateText = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: SITE_TZ });

export async function getCoupon(raw: unknown): Promise<Coupon | null> {
  const code = normalizeCode(raw);
  if (!isValidCode(code) || !isFirebaseConfigured()) return null;
  const snap = await couponRef(code).get();
  return snap.exists ? (snap.data() as Coupon) : null;
}

/** The coupon a checkout may use right now for that plan, or why not (a message the trader can read) */
export async function couponForCheckout(raw: unknown, plan: CouponPlan, now = Date.now()): Promise<{ coupon: Coupon; pct: number } | { error: string; message: string }> {
  const code = normalizeCode(raw);
  const c = isValidCode(code) ? await getCoupon(code) : null;
  const state = c ? couponState(c, now) : 'OFF';
  if (!c || state === 'OFF') return { error: 'COUPON_INVALID', message: "That coupon code isn't valid." };
  if (state === 'SCHEDULED') return { error: 'COUPON_NOT_STARTED', message: `This code starts on ${dateText(c.startsAt!)}.` };
  if (state === 'EXPIRED') return { error: 'COUPON_EXPIRED', message: 'This coupon code has expired.' };
  const pct = couponPct(c, plan);
  if (pct <= 0) return { error: 'COUPON_PLAN', message: `This code doesn't apply to the ${plan === 'yearly' ? 'Yearly' : 'Monthly'} plan.` };
  return { coupon: c, pct };
}

/** Counts a paid checkout that used the coupon (after the plan was granted) */
export function countCouponUse(code: string, plan: CouponPlan) {
  if (!isValidCode(code)) return;
  couponRef(code)
    .update({ [`uses.${plan}`]: FieldValue.increment(1) })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// The Christmas promo (owner-specified): 30% off Monthly, 25% off Yearly, 10 Nov to 20 Dec 2026 (Lagos time), banner
// on the site while it runs, and one email to every trader on 10 Nov.
// ---------------------------------------------------------------------------
export const CHRISTMAS_CODE = 'MKXCMAS01';
const LAGOS = (iso: string) => Date.parse(`${iso}+01:00`);
export const CHRISTMAS: Omit<Coupon, 'createdAt' | 'updatedAt'> = {
  code: CHRISTMAS_CODE,
  monthlyPct: 30,
  yearlyPct: 25,
  active: true,
  startsAt: LAGOS('2026-11-10T00:00:00'),
  endsAt: LAGOS('2026-12-20T23:59:59'),
  title: 'The MarketX Christmas Promo is live',
  text: 'Unwrap MarketX Pro for less: 30% off Monthly and 25% off Yearly. Your edge for the new year starts now.',
  banner: true,
  mailAt: LAGOS('2026-11-10T09:00:00'),
};

export async function seedCoupons(now = Date.now()) {
  if (!isFirebaseConfigured()) return;
  const flag = db().collection('adminConfig').doc('couponSeeds');
  await db().runTransaction(async t => {
    const [f, c] = await Promise.all([t.get(flag), t.get(couponRef(CHRISTMAS_CODE))]);
    if ((f.data() as any)?.christmas2026) return;
    if (!c.exists) t.set(couponRef(CHRISTMAS_CODE), { ...CHRISTMAS, uses: { monthly: 0, yearly: 0 }, createdAt: now, updatedAt: now });
    t.set(flag, { christmas2026: now }, { merge: true });
  });
}

// ---------------------------------------------------------------------------
// One announcement email per coupon, to every trader, once
// ---------------------------------------------------------------------------
const siteUrl = () => (process.env.APP_URL || 'https://marketx.world').replace(/\/+$/, '');
const LEASE_MS = 10 * 60_000;

export function promoMail(c: Coupon, name: string) {
  const offers: [string, string][] = [];
  if (c.monthlyPct > 0) offers.push(['Pro Monthly', `${c.monthlyPct}% off`]);
  if (c.yearlyPct > 0) offers.push(['Pro Yearly', `${c.yearlyPct}% off`]);
  if (c.endsAt) offers.push(['Offer ends', dateText(c.endsAt)]);
  const christmas = c.code === CHRISTMAS_CODE;
  const subject = christmas ? '🎄 The MarketX Christmas Promo is live: up to 30% off Pro' : `${c.title} · code ${c.code}`;
  const lines = christmas
    ? [
        `Hello ${name},`,
        "Christmas came early on MarketX. 🎄 For a limited time, MarketX Pro is yours for less, so you can walk into the new year with the full power of the Super Intelligence system for every market.",
        'Unwrap more analyses every day, your verified trader badge and every Pro tool: the watchlist that hunts setups for you, your trade journal, the Strategy Builder, Fundamental Analysis, Preference Mode and chart screenshot analysis.',
        'Open Plans on MarketX, enter the code below at checkout, and the discount is applied before you pay.',
      ]
    : [`Hello ${name},`, c.text || `Use the code below for a discount on MarketX Pro.`, 'Open Plans on MarketX, enter the code at checkout, and the discount is applied before you pay.'];
  return {
    subject,
    lines,
    options: {
      rows: offers,
      code: c.code,
      cta: { label: christmas ? 'Claim my Christmas offer' : 'Claim the offer', url: `${siteUrl()}/?pricing=1&coupon=${encodeURIComponent(c.code)}` },
      note: christmas
        ? `Offer valid until ${c.endsAt ? dateText(c.endsAt) : 'the end of the promo'} (Lagos time). Happy holidays from the MarketX team.`
        : 'You are receiving this message because you have a MarketX account.',
      priority: 'bulk' as const,
    },
  };
}

/** Sends due announcements (lead worker). Resumable: progress is saved as it goes, under a lease. */
export async function sweepCouponMail(now = Date.now(), send = sendEmail): Promise<number> {
  if (!isFirebaseConfigured() || !isMailerConfigured()) return 0;
  const snap = await db().collection('coupons').limit(200).get();
  let total = 0;
  for (const d of snap.docs) {
    const c = d.data() as Coupon;
    if (!c.mailAt || c.mailAt > now || c.mail?.state === 'SENT' || couponState(c, now) !== 'LIVE') continue;
    // Claim it (one worker at a time); a lease left by a stopped worker runs out and the next sweep carries on
    const claimed = await db().runTransaction(async t => {
      const cur = (await t.get(d.ref)).data() as Coupon | undefined;
      if (!cur || cur.mail?.state === 'SENT' || (cur.mail?.leaseUntil || 0) > Date.now()) return null;
      t.update(d.ref, { 'mail.state': 'SENDING', 'mail.leaseUntil': Date.now() + LEASE_MS });
      return cur;
    });
    if (!claimed) continue;
    const users = (await db().collection('users').get()).docs
      .map(u => ({ id: u.id, ...(u.data() as any) }))
      .filter(u => u.email && u.status !== 'banned' && u.status !== 'suspended' && !u.deleted)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let lastUid = claimed.mail?.lastUid || '';
    let sent = claimed.mail?.sent || 0;
    let since = 0;
    for (const u of users) {
      if (u.id <= lastUid) continue;
      const m = promoMail(claimed, u.displayName || (u.username ? `@${u.username}` : 'trader'));
      if (await send(u.email, m.subject, m.lines, m.options).catch(() => false)) sent++;
      lastUid = u.id;
      total++;
      if (++since >= 20) {
        since = 0;
        await d.ref.update({ 'mail.lastUid': lastUid, 'mail.sent': sent, 'mail.leaseUntil': Date.now() + LEASE_MS });
      }
    }
    await d.ref.update({ 'mail.state': 'SENT', 'mail.lastUid': lastUid, 'mail.sent': sent, 'mail.doneAt': Date.now(), 'mail.leaseUntil': 0 });
    console.log(`[MarketX Coupons] ${claimed.code} announcement sent to ${sent} trader(s)`);
  }
  return total;
}

export function startCoupons() {
  if (!isFirebaseConfigured() || !IS_LEAD_WORKER) return;
  seedCoupons().catch(err => console.warn('[MarketX Coupons] seed failed:', err?.message || err));
  const every = Math.max(2000, Number(process.env.COUPON_MAIL_SWEEP_MS) || 5 * 60_000);
  const run = () => sweepCouponMail().catch(err => console.warn('[MarketX Coupons] announcement failed:', err?.message || err));
  setTimeout(run, Math.min(every, 60_000)).unref();
  setInterval(run, every).unref();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const publicView = (c: Coupon) => ({
  code: c.code,
  monthlyPct: c.monthlyPct,
  yearlyPct: c.yearlyPct,
  endsAt: c.endsAt,
  title: c.title,
  text: c.text,
});

/** Admin input → coupon fields (validated); `partial` keeps fields that were not sent */
function couponInput(b: any, partial: boolean): Partial<Coupon> | { error: string } {
  const out: Partial<Coupon> = {};
  if (!partial || 'monthlyPct' in b) out.monthlyPct = clampPct(b.monthlyPct);
  if (!partial || 'yearlyPct' in b) out.yearlyPct = clampPct(b.yearlyPct);
  if (!partial || 'active' in b) out.active = b.active !== false;
  if (!partial || 'startsAt' in b) out.startsAt = timeOrNull(b.startsAt);
  if (!partial || 'endsAt' in b) out.endsAt = timeOrNull(b.endsAt);
  if (!partial || 'title' in b) out.title = cleanText(b.title, 80);
  if (!partial || 'text' in b) out.text = cleanText(b.text, 220);
  if (!partial || 'banner' in b) out.banner = !!b.banner;
  if (out.startsAt && out.endsAt && out.endsAt <= out.startsAt) return { error: 'The end date must be after the start date.' };
  return out;
}

export function registerCouponRoutes(app: Express, checkLimiter: any) {
  const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) =>
    fn(req, res).catch(err => {
      console.error(`[MarketX Coupons] ${req.method} ${req.path} failed:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
    });

  // Public: try a code (the Plans window). Says exactly why a code doesn't work.
  app.post('/api/coupons/check', checkLimiter, wrap(async (req, res) => {
    const code = normalizeCode(req.body?.code);
    if (!isValidCode(code)) return res.status(400).json({ error: 'COUPON_INVALID', message: "That coupon code isn't valid." });
    const [m, y] = await Promise.all([couponForCheckout(code, 'monthly'), couponForCheckout(code, 'yearly')]);
    if ('error' in m && 'error' in y) {
      const e = m.error === 'COUPON_PLAN' ? y : m;
      return res.status(400).json({ error: e.error, message: e.message });
    }
    const c = ('coupon' in m ? m.coupon : (y as any).coupon) as Coupon;
    // Same pricing as the checkout (payments.ts), so the preview and the charge always agree
    const price = (plan: CouponPlan, pct: number) => (pct > 0 ? planPrice(plan, pct) : null);
    res.json({
      valid: true,
      coupon: publicView(c),
      prices: { monthly: price('monthly', c.monthlyPct), yearly: price('yearly', c.yearlyPct) },
    });
  }));

  // Public: the promo pop-up (a LIVE coupon with the banner on, newest first). The coupons are read at most every 20s
  // per worker; start and end times are checked on every request, so the pop-up appears and goes exactly on time.
  let promoCache: { at: number; coupons: Coupon[] } | null = null;
  app.get('/api/promo', wrap(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!isFirebaseConfigured()) return res.json({ promo: null });
    if (!promoCache || Date.now() - promoCache.at > 20_000) {
      const snap = await db().collection('coupons').where('banner', '==', true).limit(50).get();
      promoCache = { at: Date.now(), coupons: snap.docs.map(d => d.data() as Coupon) };
    }
    const now = Date.now();
    const live = promoCache.coupons.filter(c => couponState(c, now) === 'LIVE').sort((a, b) => (b.startsAt || b.createdAt) - (a.startsAt || a.createdAt));
    res.json({ promo: live[0] ? publicView(live[0]) : null });
  }));

  // --- Admin --------------------------------------------------------------
  app.get('/api/admin/coupons', requireAdmin, wrap(async (_req, res) => {
    const snap = await db().collection('coupons').limit(200).get();
    const now = Date.now();
    const coupons = snap.docs
      .map(d => d.data() as Coupon)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(c => ({ ...c, state: couponState(c, now), mail: c.mail ? { state: c.mail.state || null, sent: c.mail.sent || 0, doneAt: c.mail.doneAt || null } : null }));
    res.json({ coupons });
  }));

  app.post('/api/admin/coupons', requireAdmin, wrap(async (req, res) => {
    const code = normalizeCode(req.body?.code);
    if (!isValidCode(code)) return res.status(400).json({ error: 'INVALID_CODE', message: 'Use 3 to 24 letters, numbers, - or _.' });
    const input = couponInput(req.body || {}, false);
    if ('error' in input) return res.status(400).json({ error: 'INVALID', message: input.error });
    if (!input.monthlyPct && !input.yearlyPct) return res.status(400).json({ error: 'INVALID', message: `Give at least one plan a discount (1 to ${MAX_PCT}%).` });
    const now = Date.now();
    const created = await db().runTransaction(async t => {
      if ((await t.get(couponRef(code))).exists) return false;
      t.set(couponRef(code), { code, ...input, mailAt: null, uses: { monthly: 0, yearly: 0 }, createdAt: now, updatedAt: now });
      return true;
    });
    if (!created) return res.status(409).json({ error: 'EXISTS', message: 'That code already exists.' });
    promoCache = null;
    res.json({ success: true });
  }));

  app.patch('/api/admin/coupons/:code', requireAdmin, wrap(async (req, res) => {
    const code = normalizeCode(req.params.code);
    if (!isValidCode(code)) return res.status(400).json({ error: 'INVALID_CODE' });
    const input = couponInput(req.body || {}, true);
    if ('error' in input) return res.status(400).json({ error: 'INVALID', message: input.error });
    const r = await db().runTransaction(async t => {
      const snap = await t.get(couponRef(code));
      if (!snap.exists) return 'MISSING';
      const next = { ...(snap.data() as Coupon), ...input };
      if (!next.monthlyPct && !next.yearlyPct) return 'NO_PCT';
      if (next.startsAt && next.endsAt && next.endsAt <= next.startsAt) return 'DATES';
      t.update(couponRef(code), { ...input, updatedAt: Date.now() });
      return 'OK';
    });
    if (r === 'MISSING') return res.status(404).json({ error: 'NOT_FOUND', message: 'No such code.' });
    if (r === 'NO_PCT') return res.status(400).json({ error: 'INVALID', message: `Give at least one plan a discount (1 to ${MAX_PCT}%).` });
    if (r === 'DATES') return res.status(400).json({ error: 'INVALID', message: 'The end date must be after the start date.' });
    promoCache = null;
    res.json({ success: true });
  }));

  app.delete('/api/admin/coupons/:code', requireAdmin, wrap(async (req, res) => {
    const code = normalizeCode(req.params.code);
    if (!isValidCode(code)) return res.status(400).json({ error: 'INVALID_CODE' });
    await couponRef(code).delete();
    promoCache = null;
    res.json({ success: true });
  }));
}
