// ===========================================================================
// Admin → Credits (owner-specified): the owner gifts credits to a trader found by email, MarketX ID, username or
// account id. Credits are added inside a Firestore transaction into the campaign pool (spent first, before the daily
// analyses, like every reward), the trader gets a notification + email, and each gift is kept in adminGifts.
// ===========================================================================
import type { Express, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase';
import { sendEmail } from './mailer';
import { addNotificationInTx, isUnlimitedEmail, loadUserInTx, saveNormalized, siteLink, type UserDoc } from './account';
import { adminLog, requireAdmin } from './admin';

export const MAX_ADMIN_GIFT = 10_000;
const giftsCol = () => db().collection('adminGifts');
const clean = (s: unknown, n: number) =>
  String(s ?? '')
    .replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);

/** Email, MarketX ID (Solana address), @username or account id → the account id */
export async function findTrader(raw: unknown): Promise<string | null> {
  const q = String(raw ?? '').trim();
  if (!q || q.length > 254) return null;
  if (q.includes('@') && !q.startsWith('@')) {
    const c = await db().collection('credentials').doc(q.toLowerCase()).get();
    return c.exists ? String(c.data()?.uid || '') || null : null;
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q)) {
    const t = await db().collection('traderIds').doc(q).get();
    if (t.exists && t.data()?.uid) return String(t.data()!.uid);
  }
  if (/^[\w-]{6,128}$/.test(q) && (await db().collection('users').doc(q).get()).exists) return q;
  const name = q.replace(/^@/, '').toLowerCase();
  if (/^[a-z0-9_]{2,30}$/.test(name)) {
    const n = await db().collection('usernames').doc(name).get();
    if (n.exists && n.data()?.uid) return String(n.data()!.uid);
  }
  return null;
}

function summary(uid: string, u: UserDoc) {
  return {
    uid,
    username: u.username,
    displayName: u.displayName,
    email: u.email,
    status: u.status || 'active',
    unlimited: isUnlimitedEmail(u.email),
    plan: u.subscription?.active ? u.subscription.plan : 'free',
    credits: {
      available: Number(u.credits?.available) || 0,
      bonus: Math.max(0, Math.min(Number(u.credits?.campaign) || 0, Number(u.credits?.available) || 0)),
      dailyRemaining: Number(u.credits?.dailyRemaining) || 0,
      dailyLimit: Number(u.credits?.dailyLimit) || 0,
    },
  };
}

export function registerAdminCreditRoutes(app: Express) {
  const wrap =
    (fn: (req: Request, res: Response) => Promise<any>) =>
    (req: Request, res: Response) =>
      fn(req, res).catch(err => {
        console.error(`[MarketX Admin] ${req.method} ${req.path} failed:`, err?.message || err);
        if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
      });

  app.get('/api/admin/credits/lookup', requireAdmin, wrap(async (req, res) => {
    const uid = await findTrader(req.query.q);
    const snap = uid ? await db().collection('users').doc(uid).get() : null;
    if (!uid || !snap?.exists) return res.status(404).json({ error: 'NOT_FOUND', message: 'No trader matches that email, MarketX ID, username or account id.' });
    res.json({ user: summary(uid, snap.data() as UserDoc) });
  }));

  app.post('/api/admin/credits/gift', requireAdmin, wrap(async (req, res) => {
    const amount = Math.floor(Number(req.body?.amount));
    if (!Number.isFinite(amount) || amount < 1 || amount > MAX_ADMIN_GIFT) {
      return res.status(400).json({ error: 'INVALID_AMOUNT', message: `Enter between 1 and ${MAX_ADMIN_GIFT.toLocaleString()} credits.` });
    }
    const note = clean(req.body?.note, 240);
    const uid = await findTrader(req.body?.q ?? req.body?.uid);
    if (!uid) return res.status(404).json({ error: 'NOT_FOUND', message: 'No trader matches that email, MarketX ID, username or account id.' });
    const now = Date.now();
    const giftRef = giftsCol().doc(`${now}-${Math.random().toString(36).slice(2, 8)}`);
    const result = await db().runTransaction(async tx => {
      const loaded = await loadUserInTx(tx, uid);
      if (!loaded) return { status: 404, body: { error: 'NOT_FOUND', message: 'This account no longer exists.' } };
      const u = loaded.doc;
      if (u.status === 'banned') return { status: 409, body: { error: 'BANNED', message: 'This account is banned. Unban it before gifting credits.' } };
      if (isUnlimitedEmail(u.email)) return { status: 409, body: { error: 'UNLIMITED', message: 'This account already has unlimited credits.' } };
      saveNormalized(tx, loaded);
      tx.update(loaded.ref, {
        'credits.available': FieldValue.increment(amount),
        // Gifted credits join the bonus pool: spent first, daily analyses kept for after
        'credits.campaign': Math.max(0, u.credits.campaign ?? 0) + amount,
      });
      tx.set(giftRef, { uid, username: u.username, email: u.email, amount, note, at: now });
      addNotificationInTx(tx, uid, {
        type: 'reward',
        title: `+${amount} credits from the MarketX team`,
        message: note || `${amount} credits were added to your account. They are used first, and your daily analyses are kept for after they run out.`,
      });
      return { status: 200, body: { success: true, user: summary(uid, { ...u, credits: { ...u.credits, available: u.credits.available + amount, campaign: (u.credits.campaign ?? 0) + amount } }) }, email: u.email, username: u.username };
    });
    if (result.status !== 200) return res.status(result.status).json(result.body);
    adminLog('credits_gift', { uid, amount });
    const r = result as { email: string; username: string };
    void sendEmail(
      r.email,
      `You received ${amount} credits from MarketX`,
      [
        `Hello @${r.username},`,
        `The MarketX team added ${amount.toLocaleString()} credits to your account.`,
        ...(note ? [note] : []),
        'These credits are used first, one per analysis. Your daily analyses are kept for when they run out.',
      ],
      { cta: { label: 'Use your credits', url: siteLink('/') } }
    );
    res.json(result.body);
  }));

  app.get('/api/admin/credits/gifts', requireAdmin, wrap(async (_req, res) => {
    const snap = await giftsCol().orderBy('at', 'desc').limit(50).get();
    const gifts = snap.docs.map(d => d.data() as any);
    res.json({ gifts, maxAmount: MAX_ADMIN_GIFT });
  }));
}
