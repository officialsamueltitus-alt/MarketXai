import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase';
import { sendEmail } from './mailer';
import {
  requireAuth,
  getUser,
  userRef,
  loadUserInTx,
  saveNormalized,
  readAccountState,
  addNotificationInTx,
  PRO_DAILY_LIMIT,
} from './account';

type Plan = 'monthly' | 'yearly';

const PLAN_DURATION_MS: Record<Plan, number> = {
  monthly: 30 * 24 * 60 * 60 * 1000,
  yearly: 365 * 24 * 60 * 60 * 1000,
};
const PLAN_BONUS_CREDITS: Record<Plan, number> = { monthly: 50, yearly: 500 };

// Prices are defined server-side in the currency's minor unit (cents/kobo), never by the browser
function getPricing() {
  const currency = (process.env.PAYSTACK_CURRENCY || 'USD').toUpperCase();
  return {
    currency,
    monthly: Number(process.env.PAYSTACK_MONTHLY_AMOUNT) || 1800,
    yearly: Number(process.env.PAYSTACK_YEARLY_AMOUNT) || 18792,
  };
}

export function getPaymentsPublicConfig() {
  const publicKey = process.env.PAYSTACK_PUBLIC_KEY || '';
  const enabled = !!publicKey && !!process.env.PAYSTACK_SECRET_KEY;
  const pricing = getPricing();
  return {
    enabled,
    publicKey: enabled ? publicKey : '',
    currency: pricing.currency,
    monthlyAmount: pricing.monthly / 100,
    yearlyAmount: pricing.yearly / 100,
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
async function fulfillPayment(reference: string, tx: any): Promise<{ granted: boolean; uid?: string; plan?: Plan; email?: string; error?: string }> {
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
        price: Number(payment.amount) / 100,
        paystackRef: reference,
      },
      'credits.available': FieldValue.increment(PLAN_BONUS_CREDITS[plan]),
      'credits.dailyLimit': PRO_DAILY_LIMIT,
      'credits.dailyRemaining': PRO_DAILY_LIMIT,
      'credits.lastDailyReset': now,
    });
    t.update(paymentRef, { status: 'fulfilled', fulfilledAt: now, paidAt: tx.paid_at || null, channel: tx.channel || null });
    addNotificationInTx(t, payment.uid, {
      type: 'credit',
      title: `MarketX Pro ${plan === 'yearly' ? 'Yearly' : 'Monthly'} activated`,
      message: `Payment confirmed. ${PLAN_BONUS_CREDITS[plan]} bonus credits and ${PRO_DAILY_LIMIT} daily analyses are now active.`,
    });
    return { granted: true, uid: payment.uid, plan, email: loaded.doc.email };
  });
}

function notifyPaymentEmail(result: { granted: boolean; plan?: Plan; email?: string }) {
  if (!result.granted || !result.plan) return;
  sendEmail(result.email, `Your MarketX Pro ${result.plan} plan is active`, [
    'Thank you for your payment. Your Pro plan is now active.',
    `You received ${PLAN_BONUS_CREDITS[result.plan]} bonus AI credits and ${PRO_DAILY_LIMIT} daily analyses.`,
  ]);
}

export function registerPaymentRoutes(app: Express, limiter: any) {
  // Creates a server-owned payment reference with the server-defined price
  app.post('/api/payments/initialize', limiter, requireAuth, async (req: Request, res: Response) => {
    try {
      const config = getPaymentsPublicConfig();
      if (!config.enabled) {
        return res.status(503).json({ error: 'PAYMENTS_DISABLED', message: 'Payments are not available yet.' });
      }
      const plan: Plan = req.body?.plan === 'yearly' ? 'yearly' : 'monthly';
      const pricing = getPricing();
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
        status: 'pending',
        createdAt: Date.now(),
      });
      res.json({ success: true, reference, amount, currency: pricing.currency, email: user.email, publicKey: config.publicKey });
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
