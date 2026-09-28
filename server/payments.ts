import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
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

type Plan = 'monthly' | 'yearly';

const PLAN_DURATION_MS: Record<Plan, number> = {
  monthly: 30 * 24 * 60 * 60 * 1000,
  yearly: 365 * 24 * 60 * 60 * 1000,
};

// Plans are priced in USD and charged in the currency the Paystack account supports
// (NGN for Nigerian merchants, which also unlocks bank transfer and USSD).
const YEARLY_DISCOUNT_PCT = Math.min(90, Math.max(0, Number(process.env.PRO_YEARLY_DISCOUNT_PERCENT) || 8));
const PAYMENT_CHANNELS = ['card', 'bank_transfer', 'ussd', 'bank', 'qr', 'mobile_money'];

function usdPrices() {
  const monthly = Number(process.env.PRO_MONTHLY_PRICE_USD) || 20;
  const yearly = Math.round(monthly * 12 * (1 - YEARLY_DISCOUNT_PCT / 100) * 100) / 100;
  return { monthly, yearly };
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
function getPricing() {
  const usd = usdPrices();
  const currency = chargeCurrency();
  const rate = currentRate();
  const toMinor = (usdAmount: number) =>
    rate == null ? null : currency === 'USD' ? Math.round(usdAmount * 100) : Math.ceil((usdAmount * rate) / 10) * 10 * 100;
  return { usd, currency, rate, monthly: toMinor(usd.monthly), yearly: toMinor(usd.yearly) };
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
    monthlyAmount: pricing.usd.monthly,
    yearlyAmount: pricing.usd.yearly,
    chargeCurrency: pricing.currency,
    chargeMonthlyAmount: pricing.monthly != null ? pricing.monthly / 100 : null,
    chargeYearlyAmount: pricing.yearly != null ? pricing.yearly / 100 : null,
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
      title: `MarketX Pro ${plan === 'yearly' ? 'Yearly' : 'Monthly'} activated`,
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
    };
  });
}

function notifyPaymentEmail(result: FulfillResult) {
  if (!result.granted || !result.plan) return;
  if (result.uid) {
    logActivity(result.uid, { type: 'payment', title: `Paid for Pro ${result.plan === 'yearly' ? 'Yearly' : 'Monthly'}`, detail: result.charged || '' });
  }
  sendEmail(
    result.email,
    `Your MarketX Pro ${result.plan} plan is active`,
    ['Thank you for your payment. Your Pro plan is now active.', `You now get ${PRO_DAILY_LIMIT} analyses every day and a verified trader badge.`],
    {
      rows: [
        ['Plan', `Pro ${result.plan === 'yearly' ? 'Yearly' : 'Monthly'}`],
        ['Amount paid', result.charged || '-'],
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

  // Creates a server-owned payment reference with the server-defined price
  app.post('/api/payments/initialize', limiter, requireAuth, async (req: Request, res: Response) => {
    try {
      const config = getPaymentsPublicConfig();
      if (!config.enabled) {
        return res.status(503).json({ error: 'PAYMENTS_DISABLED', message: 'Payments are not available yet.' });
      }
      const plan: Plan = req.body?.plan === 'yearly' ? 'yearly' : 'monthly';
      const pricing = getPricing();
      if (pricing.monthly == null || pricing.yearly == null) {
        await refreshRate();
        return res.status(503).json({ error: 'RATE_UNAVAILABLE', message: 'Checkout is warming up. Please try again in a few seconds.' });
      }
      const user = getUser(res);
      const userSnap = await userRef(user.uid).get();
      if (!userSnap.exists) return res.status(404).json({ error: 'NO_ACCOUNT' });

      const reference = `mx_${plan}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
      const amount = plan === 'yearly' ? pricing.yearly : pricing.monthly;
      await db().collection('payments').doc(reference).set({
        uid: user.uid,
        email: user.email,
        plan,
        amount,
        currency: pricing.currency,
        usdAmount: plan === 'yearly' ? pricing.usd.yearly : pricing.usd.monthly,
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
      if (!/^mx_(monthly|yearly)_\d+_[a-f0-9]{10}$/.test(reference)) {
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
