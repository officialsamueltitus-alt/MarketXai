import type { Express, Request, Response } from 'express';
import { db } from './firebase';
import { addNotification, requireAuth, userRef } from './account';
import { requireAdmin } from './admin';
import { createKeyedThrottle } from './security';
import { sendEmail } from './mailer';

// ---------------------------------------------------------------------------
// Support chat: one conversation per user, answered from the admin console.
//   supportThreads/{uid}                 -> { uid, username, email, status, lastMessageAt, lastFrom, preview,
//                                             unreadForAdmin, unreadForUser, createdAt }
//   supportThreads/{uid}/messages/{id}   -> { id, from: 'user' | 'admin', text, ts }
// All reads/writes go through these routes (Firestore rules deny direct client access).
// ---------------------------------------------------------------------------

export type SupportStatus = 'open' | 'answered' | 'closed';
const MAX_TEXT = 2000;
const threads = () => db().collection('supportThreads');
const threadRef = (uid: string) => threads().doc(uid);
const messagesCol = (uid: string) => threadRef(uid).collection('messages');
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Spam protection per account: 8 messages / minute and 60 / day
const perMinute = createKeyedThrottle({ windowMs: 60 * 1000, max: 8 });
const perDay = createKeyedThrottle({ windowMs: 24 * 60 * 60 * 1000, max: 60 });

/** Trims, collapses runs of blank lines and strips control characters. */
function cleanText(raw: unknown): string {
  // Text only: anything else (an object, an array) is treated as empty, never stored as "[object Object]"
  return (typeof raw === 'string' ? raw : '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT);
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<any>) =>
  (req: Request, res: Response) =>
    fn(req, res).catch(err => {
      console.error(`[MarketX Support] ${req.method} ${req.path} failed:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
    });

async function listMessages(uid: string, limit = 150) {
  const snap = await messagesCol(uid).orderBy('ts', 'desc').limit(limit).get();
  return snap.docs.map(d => d.data()).reverse();
}

export function registerSupportRoutes(app: Express, limiter: any) {
  // ---- User side ----------------------------------------------------------
  app.get('/api/support', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = res.locals.user;
    const t = await threadRef(uid).get();
    const messages = t.exists ? await listMessages(uid) : [];
    if (t.exists && (t.data() as any).unreadForUser) await threadRef(uid).update({ unreadForUser: 0 });
    res.json({ success: true, status: t.exists ? (t.data() as any).status : null, messages });
  }));

  // Lightweight badge count for the Settings row
  app.get('/api/support/unread', limiter, requireAuth, wrap(async (req, res) => {
    const t = await threadRef(res.locals.user.uid).get();
    res.json({ success: true, unread: t.exists ? Number((t.data() as any).unreadForUser) || 0 : 0 });
  }));

  app.post('/api/support/messages', limiter, requireAuth, wrap(async (req, res) => {
    const user = res.locals.user;
    const text = cleanText(req.body?.text);
    if (!text) return res.status(400).json({ error: 'EMPTY', message: 'Type a message first.' });
    const waitMin = perMinute.hit(user.uid) || perDay.hit(user.uid);
    if (waitMin) return res.status(429).json({ error: 'RATE_LIMITED', message: `You're sending messages quickly. Try again in ${waitMin} minute${waitMin === 1 ? '' : 's'}.` });

    const profile = await userRef(user.uid).get();
    const p: any = profile.exists ? profile.data() : {};
    const now = Date.now();
    const msg = { id: newId(), from: 'user' as const, text, ts: now };
    await db().runTransaction(async tx => {
      const t = await tx.get(threadRef(user.uid));
      const prev: any = t.exists ? t.data() : null;
      tx.set(threadRef(user.uid), {
        uid: user.uid,
        username: p.username || null,
        displayName: p.displayName || null,
        email: user.email,
        status: 'open',
        lastMessageAt: now,
        lastFrom: 'user',
        preview: text.slice(0, 140),
        unreadForAdmin: (prev?.unreadForAdmin || 0) + 1,
        unreadForUser: 0,
        createdAt: prev?.createdAt || now,
      });
      tx.set(messagesCol(user.uid).doc(msg.id), msg);
    });
    res.json({ success: true, message: msg });
  }));

  // ---- Admin side ---------------------------------------------------------
  app.get('/api/admin/support/threads', requireAdmin, wrap(async (req, res) => {
    const status = String(req.query.status || 'all');
    const snap = await threads().orderBy('lastMessageAt', 'desc').limit(200).get();
    let list = snap.docs.map(d => d.data() as any);
    if (status === 'open' || status === 'answered' || status === 'closed') list = list.filter(t => t.status === status);
    const unreadTotal = snap.docs.reduce((a, d) => a + (Number((d.data() as any).unreadForAdmin) || 0), 0);
    res.json({ success: true, threads: list, unreadTotal });
  }));

  app.get('/api/admin/support/threads/:uid', requireAdmin, wrap(async (req, res) => {
    const uid = String(req.params.uid);
    if (!/^[\w-]{1,128}$/.test(uid)) return res.status(400).json({ error: 'INVALID_ID' });
    const t = await threadRef(uid).get();
    if (!t.exists) return res.status(404).json({ error: 'NOT_FOUND', message: 'Conversation not found.' });
    if ((t.data() as any).unreadForAdmin) await threadRef(uid).update({ unreadForAdmin: 0 });
    res.json({ success: true, thread: { ...t.data(), unreadForAdmin: 0 }, messages: await listMessages(uid, 300) });
  }));

  app.post('/api/admin/support/threads/:uid/reply', requireAdmin, wrap(async (req, res) => {
    const uid = String(req.params.uid);
    if (!/^[\w-]{1,128}$/.test(uid)) return res.status(400).json({ error: 'INVALID_ID' });
    const text = cleanText(req.body?.text);
    if (!text) return res.status(400).json({ error: 'EMPTY', message: 'Type a reply first.' });
    const now = Date.now();
    const msg = { id: newId(), from: 'admin' as const, text, ts: now };
    const thread = await db().runTransaction(async tx => {
      const t = await tx.get(threadRef(uid));
      if (!t.exists) return null;
      const d: any = t.data();
      tx.update(threadRef(uid), {
        status: 'answered',
        lastMessageAt: now,
        lastFrom: 'admin',
        preview: text.slice(0, 140),
        unreadForUser: (d.unreadForUser || 0) + 1,
        unreadForAdmin: 0,
      });
      tx.set(messagesCol(uid).doc(msg.id), msg);
      return d;
    });
    if (!thread) return res.status(404).json({ error: 'NOT_FOUND', message: 'Conversation not found.' });

    // Let the user know on the site (notification centre) and by email
    await addNotification(uid, {
      type: 'system',
      title: 'Support replied',
      message: text.length > 160 ? `${text.slice(0, 157)}…` : text,
      actionType: 'open_support',
    } as any).catch(() => {});
    let emailed = false;
    if (req.body?.email !== false && thread.email) {
      emailed =
        (await sendEmail(thread.email, 'MarketX Support replied to your message', ['Our support team replied to your message:', text], {
          cta: { label: 'Open the conversation', url: `${(process.env.APP_URL || 'https://marketx.world').replace(/\/+$/, '')}/?support=1` },
          note: 'Reply from Settings → Support chat on MarketX.',
        }).catch(() => false)) !== false;
    }
    res.json({ success: true, message: msg, emailed });
  }));

  app.post('/api/admin/support/threads/:uid/status', requireAdmin, wrap(async (req, res) => {
    const uid = String(req.params.uid);
    const status = String(req.body?.status || '') as SupportStatus;
    if (!/^[\w-]{1,128}$/.test(uid) || !['open', 'answered', 'closed'].includes(status)) return res.status(400).json({ error: 'INVALID' });
    const t = await threadRef(uid).get();
    if (!t.exists) return res.status(404).json({ error: 'NOT_FOUND' });
    await threadRef(uid).update({ status });
    res.json({ success: true, status });
  }));
}
