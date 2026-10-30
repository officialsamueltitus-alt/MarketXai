import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase';
import { sendEmail } from './mailer';
import { logActivity } from './tracking';
import {
  requireAuth,
  getUser,
  userRef,
  loadUserInTx,
  saveNormalized,
  readAccountState,
  addNotificationInTx,
  PRO_DAILY_LIMIT,
  FREE_DAILY_LIMIT,
  STARTING_CREDITS,
} from './account';
import { couponForCheckout, countCouponUse } from './coupons';
import { createKeyedThrottle } from './security';

type ProPlan = 'monthly' | 'yearly';
/**
 * Retired (owner-specified): the Trading Agent is part of Pro now. These plans are no longer sold; they stay here only
 * so a checkout started before the change is still verified and honoured until it expires.
 */
type AgentPlan = 'agent_monthly' | 'agent_yearly';
/** Credit packs: one-time purchases, added to the trader's bought credits */
type PackPlan = 'pack_50' | 'pack_150' | 'pack_400' | 'pack_1000';
type Plan = ProPlan | AgentPlan | PackPlan;
/** Credits and USD price of each pack (bigger packs cost less per credit) */
export const CREDIT_PACKS: Record<PackPlan, { credits: number; usd: number }> = {
  pack_50: { credits: 50, usd: 5 },
  pack_150: { credits: 150, usd: 12 },
  pack_400: { credits: 400, usd: 28 },
  pack_1000: { credits: 1000, usd: 60 },
};
const PACKS = Object.keys(CREDIT_PACKS) as PackPlan[];
const PLANS: Plan[] = ['monthly', 'yearly', 'agent_monthly', 'agent_yearly', ...PACKS];
/** Plans a new checkout can buy */
const ON_SALE = (p: Plan) => !isAgentPlan(p);
export const isAgentPlan = (p: Plan): p is AgentPlan => p === 'agent_monthly' || p === 'agent_yearly';
export const isPackPlan = (p: Plan): p is PackPlan => p in CREDIT_PACKS;
const readPlan = (v: unknown): Plan => (PLANS.includes(v as Plan) ? (v as Plan) : 'monthly');

const PLAN_DURATION_MS: Record<Plan, number> = {
  // The `monthly` id is the 3-month Pro plan (owner-specified); the id is kept for stored payments, coupons and subscriptions
  monthly: 90 * 24 * 60 * 60 * 1000,
  yearly: 365 * 24 * 60 * 60 * 1000,
  agent_monthly: 30 * 24 * 60 * 60 * 1000,
  agent_yearly: 365 * 24 * 60 * 60 * 1000,
  pack_50: 0,
  pack_150: 0,
  pack_400: 0,
  pack_1000: 0,
};
const planName = (p: Plan) =>
  isPackPlan(p) ? `${CREDIT_PACKS[p].credits} credit pack` : isAgentPlan(p) ? `Trading Agent ${p === 'agent_yearly' ? 'Yearly' : 'Monthly'}` : proPlanName(p);
/** "Pro 3 months" / "Pro Yearly" */
export const proPlanName = (p: string) => `Pro ${p === 'yearly' ? 'Yearly' : '3 months'}`;

// Plans are priced in USD and charged in the currency the Paystack account supports
// (NGN for Nigerian merchants, which also unlocks bank transfer and USSD).
// Pro (owner-specified): $30 for 3 months; a year is $200 less 12% ($176). New setting names, so an old monthly price set
// in the environment can't override them.
const PRO_QUARTER_USD = Number(process.env.PRO_QUARTER_PRICE_USD) || 30;
const PRO_YEARLY_BASE_USD = Number(process.env.PRO_YEARLY_BASE_USD) || 200;
const YEARLY_DISCOUNT_PCT = Math.min(90, Math.max(0, Number(process.env.PRO_YEARLY_OFF_PERCENT) || 12));
const PAYMENT_CHANNELS = ['card', 'bank_transfer', 'ussd', 'bank', 'qr', 'mobile_money'];

/** Retired Trading Agent plan prices (only for checkouts started before it joined Pro) */
const AGENT_MONTHLY_USD = 30;
const AGENT_YEARLY_DISCOUNT_PCT = 18;

function usdPrices() {
  const monthly = PRO_QUARTER_USD;
  const yearly = Math.round(PRO_YEARLY_BASE_USD * (1 - YEARLY_DISCOUNT_PCT / 100) * 100) / 100;
  const agent_monthly = AGENT_MONTHLY_USD;
  const agent_yearly = Math.round(AGENT_MONTHLY_USD * 12 * (1 - AGENT_YEARLY_DISCOUNT_PCT / 100) * 100) / 100;
  return { monthly, yearly, agent_monthly, agent_yearly, ...Object.fromEntries(PACKS.map(p => [p, CREDIT_PACKS[p].usd])) } as Record<Plan, number>;
}

function chargeCurrency(): string {
  return (process.env.PAYSTACK_CHARGE_CURRENCY || 'NGN').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'NGN';
}

// Live USD → charge-currency rate (open.er-api.com, no key), cached and refreshed in the background
const RATE_TTL_MS = 60 * 60 * 1000;
let cachedRate: { currency: string; rate: number; at: number } | null = null;

// One refresh at a time, and after a failure wait a minute before asking again (no request storm while it's down)
const RATE_RETRY_MS = 60 * 1000;
let rateRefresh: Promise<void> | null = null;
let rateFailedAt = 0;

function refreshRate(): Promise<void> {
  const currency = chargeCurrency();
  if (currency === 'USD') return Promise.resolve();
  if (rateRefresh) return rateRefresh;
  if (Date.now() - rateFailedAt < RATE_RETRY_MS) return Promise.resolve();
  rateRefresh = (async () => {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(8000) });
      const data: any = res.ok ? await res.json() : null;
      const rate = Number(data?.rates?.[currency]);
      if (rate > 0) {
        cachedRate = { currency, rate, at: Date.now() };
        rateFailedAt = 0;
      } else {
        rateFailedAt = Date.now();
        console.warn(`[MarketX Payments] exchange rate refresh failed: HTTP ${res.status}`);
      }
    } catch (err: any) {
      rateFailedAt = Date.now();
      console.warn('[MarketX Payments] exchange rate refresh failed:', err?.message || err);
    } finally {
      rateRefresh = null;
    }
  })();
  return rateRefresh;
}

function currentRate(): number | null {
  const currency = chargeCurrency();
  if (currency === 'USD') return 1;
  if (cachedRate && cachedRate.currency === currency) {
    if (Date.now() - cachedRate.at > RATE_TTL_MS) refreshRate();
    return cachedRate.rate;
  }
  refreshRate();
  // Optional manual fallback, e.g. USD_NGN_RATE=1550, used only until the live rate loads
  const manual = Number(process.env[`USD_${currency}_RATE`]);
  return manual > 0 ? manual : null;
}

// Amounts in the charge currency's minor unit (kobo/cents). Non-USD prices round up to a whole 10 units.
function toMinorAmount(usdAmount: number, currency: string, rate: number | null): number | null {
  return rate == null ? null : currency === 'USD' ? Math.round(usdAmount * 100) : Math.ceil((usdAmount * rate) / 10) * 10 * 100;
}

function getPricing() {
  const usd = usdPrices();
  const currency = chargeCurrency();
  const rate = currentRate();
  const minor = Object.fromEntries(PLANS.map(p => [p, toMinorAmount(usd[p], currency, rate)])) as Record<Plan, number | null>;
  return { usd, currency, rate, ...minor };
}

/** A plan's USD price after a coupon's percent off (cents rounded) */
const discountedUsd = (usd: number, pct: number) => Math.round(usd * (1 - pct / 100) * 100) / 100;

/** What a plan costs with a coupon: the USD price and what Paystack charges (major units), exactly as the checkout prices it */
export function planPrice(plan: Plan, pct: number): { usd: number; fullUsd: number; charge: number | null; currency: string; pct: number } {
  const p = getPricing();
  const fullUsd = p.usd[plan];
  const usd = discountedUsd(fullUsd, pct);
  const minor = toMinorAmount(usd, p.currency, p.rate);
  return { usd, fullUsd, charge: minor == null ? null : minor / 100, currency: p.currency, pct };
}

export function getPaymentsPublicConfig() {
  const publicKey = process.env.PAYSTACK_PUBLIC_KEY || '';
  const enabled = !!publicKey && !!process.env.PAYSTACK_SECRET_KEY;
  const pricing = getPricing();
  return {
    enabled,
    publicKey: enabled ? publicKey : '',
    // Display prices (USD) and what Paystack will actually charge
    currency: 'USD',
    // `monthly` = the 3-month plan
    monthlyAmount: pricing.usd.monthly,
    periodMonths: 3,
    yearlyBaseAmount: PRO_YEARLY_BASE_USD,
    yearlyDiscountPct: YEARLY_DISCOUNT_PCT,
    yearlyAmount: pricing.usd.yearly,
    chargeCurrency: pricing.currency,
    chargeMonthlyAmount: pricing.monthly != null ? pricing.monthly / 100 : null,
    chargeYearlyAmount: pricing.yearly != null ? pricing.yearly / 100 : null,
    // Credit packs (one-time)
    creditPacks: PACKS.map(p => ({ id: p, credits: CREDIT_PACKS[p].credits, usd: CREDIT_PACKS[p].usd, charge: pricing[p] != null ? (pricing[p] as number) / 100 : null })),
    // Plan benefits as enforced by the server, so the UI never over-promises
    benefits: {
      freeDailyAnalyses: FREE_DAILY_LIMIT,
      proDailyAnalyses: PRO_DAILY_LIMIT,
      startingCredits: STARTING_CREDITS,
    },
  };
}

async function paystackVerify(reference: string): Promise<any | null> {
  const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.status ? body.data : null;
}

// Idempotently grants the plan for a verified successful transaction
interface FulfillResult {
  granted: boolean;
  uid?: string;
  plan?: Plan;
  email?: string;
  error?: string;
  charged?: string;
  expiresAt?: number;
  reference?: string;
  coupon?: { code: string; pct: number } | null;
}

async function fulfillPayment(reference: string, tx: any): Promise<FulfillResult> {
  const paymentRef = db().collection('payments').doc(reference);
  return db().runTransaction(async t => {
    const paySnap = await t.get(paymentRef);
    if (!paySnap.exists) return { granted: false, error: 'UNKNOWN_REFERENCE' };
    const payment = paySnap.data()!;
    if (payment.status === 'fulfilled') return { granted: false, uid: payment.uid, plan: payment.plan };

    if (tx.status !== 'success') return { granted: false, error: 'NOT_PAID' };
    if (Number(tx.amount) < Number(payment.amount) || String(tx.currency).toUpperCase() !== payment.currency) {
      t.update(paymentRef, { status: 'mismatch', paystack: { amount: tx.amount, currency: tx.currency } });
      return { granted: false, error: 'AMOUNT_MISMATCH' };
    }

    const loaded = await loadUserInTx(t, payment.uid);
    if (!loaded) return { granted: false, error: 'NO_ACCOUNT' };
    saveNormalized(t, loaded);

    const plan = payment.plan as Plan;
    const now = Date.now();
    if (isPackPlan(plan)) {
      // Credit pack: the credits go to the trader's bought credits (spendable, never giftable)
      const n = CREDIT_PACKS[plan].credits;
      t.update(loaded.ref, { 'credits.available': FieldValue.increment(n), 'credits.purchased': FieldValue.increment(n) });
      t.update(paymentRef, { status: 'fulfilled', fulfilledAt: now, paidAt: tx.paid_at || null, channel: tx.channel || null, credits: n });
      addNotificationInTx(t, payment.uid, {
        type: 'credit',
        title: `${n} credits added`,
        message: `Payment confirmed. ${n} credits are in your balance: the trading agent uses them, and analyses do once your daily ones run out.`,
        actionType: 'open_credits',
      } as any);
      return { granted: true, uid: payment.uid, plan, email: loaded.doc.email, charged: `${(Number(payment.amount) / 100).toLocaleString('en-US')} ${payment.currency}`, reference, coupon: null };
    }
    if (isAgentPlan(plan)) {
      // Trading Agent subscription: its own expiry, renewals extend it (Pro and daily analyses are untouched)
      const cur = (loaded.doc as any).agentSub as { active?: boolean; expiresAt?: number; startDate?: number } | undefined;
      const live = !!cur?.active && (cur.expiresAt || 0) > now;
      const until = (live ? cur!.expiresAt! : now) + PLAN_DURATION_MS[plan];
      t.update(loaded.ref, {
        agentSub: { plan, active: true, startDate: live ? cur!.startDate || now : now, expiresAt: until, price: Number(payment.usdAmount) || 0, paystackRef: reference },
      });
      t.update(paymentRef, { status: 'fulfilled', fulfilledAt: now, paidAt: tx.paid_at || null, channel: tx.channel || null });
      addNotificationInTx(t, payment.uid, {
        type: 'credit',
        title: `${planName(plan)} activated`,
        message: 'Payment confirmed. Your Trading Agent is unlocked: set it up and switch it on.',
        actionType: 'open_agent',
      } as any);
      return { granted: true, uid: payment.uid, plan, email: loaded.doc.email, charged: `${(Number(payment.amount) / 100).toLocaleString('en-US')} ${payment.currency}`, expiresAt: until, reference, coupon: null };
    }
    const sub = loaded.doc.subscription;
    // Renewals extend from the current expiry instead of resetting it
    const base = sub.active && sub.expiresAt > now ? sub.expiresAt : now;
    t.update(loaded.ref, {
      subscription: {
        plan,
        active: true,
        startDate: sub.active ? sub.startDate : now,
        expiresAt: base + PLAN_DURATION_MS[plan],
        price: Number(payment.usdAmount) || Number(payment.amount) / 100,
        paystackRef: reference,
      },
      'credits.dailyLimit': PRO_DAILY_LIMIT,
      'credits.dailyRemaining': PRO_DAILY_LIMIT,
      'credits.lastDailyReset': now,
    });
    t.update(paymentRef, { status: 'fulfilled', fulfilledAt: now, paidAt: tx.paid_at || null, channel: tx.channel || null });
    addNotificationInTx(t, payment.uid, {
      type: 'credit',
      title: `MarketX ${proPlanName(plan)} activated`,
      message: `Payment confirmed. ${PRO_DAILY_LIMIT} daily analyses and your verified badge are now active.`,
    });
    return {
      granted: true,
      uid: payment.uid,
      plan,
      email: loaded.doc.email,
      charged: `${(Number(payment.amount) / 100).toLocaleString('en-US')} ${payment.currency}`,
      expiresAt: base + PLAN_DURATION_MS[plan],
      reference,
      coupon: payment.coupon || null,
    };
  });
}

function notifyPaymentEmail(result: FulfillResult) {
  if (!result.granted || !result.plan) return;
  if (result.coupon?.code && !isAgentPlan(result.plan) && !isPackPlan(result.plan)) countCouponUse(result.coupon.code, result.plan);
  if (result.uid) {
    logActivity(result.uid, { type: 'payment', title: `Paid for ${planName(result.plan)}`, detail: result.charged || '' });
  }
  if (isPackPlan(result.plan)) {
    const n = CREDIT_PACKS[result.plan].credits;
    sendEmail(
      result.email,
      `${n} MarketX credits added`,
      ['Thank you for your payment. Your credits are in your balance.', 'The trading agent uses them for its trades, and analyses use them once your daily ones run out.'],
      {
        rows: [
          ['Pack', `${n} credits`],
          ['Amount paid', result.charged || '-'],
          ['Reference', result.reference || '-'],
        ],
        cta: { label: 'See your credits', url: `${(process.env.APP_URL || 'https://marketx.world').replace(/\/+$/, '')}/` },
        note: 'Keep this email as your receipt.',
      }
    );
    return;
  }
  if (isAgentPlan(result.plan)) {
    sendEmail(
      result.email,
      `Your MarketX ${planName(result.plan)} plan is active`,
      ['Thank you for your payment. Your Trading Agent is unlocked.', 'Open the agent, set it up and switch it on. Credits are used per trade it takes.'],
      {
        rows: [
          ['Plan', planName(result.plan)],
          ['Amount paid', result.charged || '-'],
          ['Active until', result.expiresAt ? new Date(result.expiresAt).toDateString() : '-'],
          ['Reference', result.reference || '-'],
        ],
        cta: { label: 'Open the trading agent', url: `${(process.env.APP_URL || 'https://marketx.world').replace(/\/+$/, '')}/agents` },
        note: 'Keep this email as your receipt.',
      }
    );
    return;
  }
  sendEmail(
    result.email,
    `Your MarketX Pro ${result.plan} plan is active`,
    ['Thank you for your payment. Your Pro plan is now active.', `You now get ${PRO_DAILY_LIMIT} analyses every day and a verified trader badge.`],
    {
      rows: [
        ['Plan', proPlanName(result.plan)],
        ['Amount paid', result.charged || '-'],
        ...(result.coupon?.code ? ([['Coupon', `${result.coupon.code} (${result.coupon.pct}% off)`]] as [string, string][]) : []),
        ['Active until', result.expiresAt ? new Date(result.expiresAt).toDateString() : '-'],
        ['Reference', result.reference || '-'],
      ],
      cta: { label: 'Start analysing', url: (process.env.APP_URL || 'https://marketx.world').replace(/\/+$/, '') },
      note: 'Keep this email as your receipt.',
    }
  );
}

export function registerPaymentRoutes(app: Express, limiter: any) {
  refreshRate();
  setInterval(refreshRate, RATE_TTL_MS).unref();

  // At most 10 checkouts a minute per trader (each creates a pending payment record)
  const checkoutThrottle = createKeyedThrottle({ windowMs: 60_000, max: 10 });
  // Creates a server-owned payment reference with the server-defined price
  app.post('/api/payments/initialize', limiter, requireAuth, async (req: Request, res: Response) => {
    try {
      if (checkoutThrottle.hit(getUser(res).uid)) {
        return res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many checkout attempts. Please wait a minute.' });
      }
      const config = getPaymentsPublicConfig();
      if (!config.enabled) {
        return res.status(503).json({ error: 'PAYMENTS_DISABLED', message: 'Payments are not available yet.' });
      }
      const plan: Plan = readPlan(req.body?.plan);
      if (!ON_SALE(plan)) {
        return res.status(400).json({ error: 'PLAN_RETIRED', message: 'The Trading Agent is part of Pro now. Choose a Pro plan to use it.' });
      }
      // Coupon (optional): priced here on the server, and only while the code is live. A code that doesn't work is
      // refused, never silently charged at the full price.
      const rawCoupon = typeof req.body?.coupon === 'string' ? req.body.coupon.trim() : '';
      let coupon: { code: string; pct: number } | null = null;
      if (rawCoupon && (isAgentPlan(plan) || isPackPlan(plan))) {
        return res.status(400).json({ error: 'COUPON_NOT_FOR_PLAN', message: 'Coupons apply to Pro plans only.' });
      }
      if (rawCoupon && !isAgentPlan(plan) && !isPackPlan(plan)) {
        const c = await couponForCheckout(rawCoupon, plan);
        if ('error' in c) return res.status(400).json({ error: c.error, message: c.message });
        coupon = { code: c.coupon.code, pct: c.pct };
      }
      const pricing = getPricing();
      if (pricing[plan] == null) {
        await refreshRate();
        return res.status(503).json({ error: 'RATE_UNAVAILABLE', message: 'Checkout is warming up. Please try again in a few seconds.' });
      }
      const user = getUser(res);
      const userSnap = await userRef(user.uid).get();
      if (!userSnap.exists) return res.status(404).json({ error: 'NO_ACCOUNT' });

      const reference = `mx_${plan}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
      const fullUsd = pricing.usd[plan];
      const usdAmount = coupon ? discountedUsd(fullUsd, coupon.pct) : fullUsd;
      const amount = coupon ? toMinorAmount(usdAmount, pricing.currency, pricing.rate)! : pricing[plan];
      await db().collection('payments').doc(reference).set({
        uid: user.uid,
        email: user.email,
        plan,
        amount,
        currency: pricing.currency,
        usdAmount,
        ...(coupon ? { coupon: { code: coupon.code, pct: coupon.pct }, fullUsdAmount: fullUsd } : {}),
        exchangeRate: pricing.rate,
        status: 'pending',
        createdAt: Date.now(),
      });
      res.json({
        success: true,
        reference,
        amount,
        currency: pricing.currency,
        channels: PAYMENT_CHANNELS,
        email: user.email,
        publicKey: config.publicKey,
        ...(coupon ? { coupon: { code: coupon.code, pct: coupon.pct }, usdAmount, fullUsdAmount: fullUsd } : {}),
      });
    } catch (err: any) {
      console.error('[MarketX Payments] initialize failed:', err?.message || err);
      res.status(500).json({ error: 'SERVER_ERROR', message: 'Could not start checkout. Please try again.' });
    }
  });

  // Called by the browser after Paystack's success callback; the server re-verifies with Paystack
  app.post('/api/payments/verify', limiter, requireAuth, async (req: Request, res: Response) => {
    try {
      const reference = String(req.body?.reference || '');
      if (!/^mx_(monthly|yearly|agent_monthly|agent_yearly|pack_(?:50|150|400|1000))_\d+_[a-f0-9]{10}$/.test(reference)) {
        return res.status(400).json({ error: 'INVALID_REFERENCE' });
      }
      const user = getUser(res);
      const paySnap = await db().collection('payments').doc(reference).get();
      if (!paySnap.exists || paySnap.data()!.uid !== user.uid) {
        return res.status(404).json({ error: 'UNKNOWN_REFERENCE' });
      }
      const tx = await paystackVerify(reference);
      if (!tx) return res.status(402).json({ error: 'NOT_VERIFIED', message: 'Payment could not be verified yet.' });
      const result = await fulfillPayment(reference, tx);
      if (result.error) {
        return res.status(402).json({ error: result.error, message: 'Payment was not completed.' });
      }
      notifyPaymentEmail(result);
      res.json({ success: true, ...(await readAccountState(user)) });
    } catch (err: any) {
      console.error('[MarketX Payments] verify failed:', err?.message || err);
      res.status(500).json({ error: 'SERVER_ERROR', message: 'Could not verify payment. If you were charged, it will be applied automatically.' });
    }
  });

  // Paystack webhook (Dashboard → Settings → API Keys & Webhooks → Webhook URL: <site>/api/payments/webhook)
  app.post('/api/payments/webhook', async (req: Request, res: Response) => {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const raw: Buffer | undefined = (req as any).rawBody;
    const signature = String(req.headers['x-paystack-signature'] || '');
    if (!secret || !raw || !signature) return res.sendStatus(400);

    const expected = crypto.createHmac('sha512', secret).update(raw).digest('hex');
    const valid =
      expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!valid) return res.sendStatus(401);

    res.sendStatus(200); // acknowledge immediately; Paystack retries on non-2xx
    try {
      const event = req.body;
      if (event?.event !== 'charge.success' || !event?.data?.reference) return;
      const reference = String(event.data.reference);
      // Re-verify with the API rather than trusting the payload alone
      const tx = await paystackVerify(reference);
      if (!tx) return;
      notifyPaymentEmail(await fulfillPayment(reference, tx));
    } catch (err: any) {
      console.error('[MarketX Payments] webhook handling failed:', err?.message || err);
    }
  });
}
