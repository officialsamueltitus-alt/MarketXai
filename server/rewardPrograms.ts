import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase';
import { requireAdmin, adminLog, parseBroadcastImage } from './admin';
import { clientIp } from './security';
import { sendEmail } from './mailer';
import { addNotificationInTx, getUser, loadUserInTx, requireAuth, saveNormalized, siteLink } from './account';
import { createKeyedThrottle } from './security';

// ===========================================================================
// Reward programs (owner-specified, Admin → Rewards): programs the admin creates, shown as cards in the notification
// center's Rewards tab (next to the built-in Share on X and Explain MarketX cards). Each has a title, text, up to 5
// links, an optional button, start/end and on/off, and one of two modes:
//   INFO   -> a card only (read, open the links); nothing is submitted
//   SUBMIT -> traders send proof (a link + a note); the admin approves (credits into the campaign pool, notification +
//             email) or declines with a reason (the trader can send new proof, up to 5 times). One reward per person
//             (email hash), and an optional cap on how many people are rewarded.
//
//   rewardPrograms/{rp_…}                    -> the program
//   rewardSubmissions/{programId}_{uid}      -> one submission per trader per program (deleted with the account)
//   rewardClaims/{programId}_{sha256(email)} -> one reward per person, even across deleted accounts
// Links are https only and opened in a new tab (noopener); nothing here is ever given to an engine.
// Optional picture (uploaded by the admin, checked by its bytes like broadcast pictures, `rewardImages/{rp_…}_{rand}`, served
// at /api/reward-image/:id) and optional video link: a YouTube link shows its thumbnail with a play button (fetched through
// /api/reward-video-thumb/:id, so traders' browsers never load anything from YouTube); any other https video link shows a
// "Watch video" tile. Tapping either opens the video in a new tab.
// ===========================================================================

export type ProgramMode = 'INFO' | 'SUBMIT';
export interface RewardProgram {
  id: string;
  title: string;
  body: string;
  links: Array<{ label: string; url: string }>;
  button: { label: string; url: string } | null;
  /** The picture's address on MarketX (/api/reward-image/…), or null */
  image: string | null;
  /** A video link: YouTube (with a thumbnail) or any other https video page */
  video: { url: string; youtubeId: string | null } | null;
  mode: ProgramMode;
  /** Credits for an approved submission (SUBMIT) */
  reward: number;
  /** What to send as proof, in the admin's words (SUBMIT) */
  askFor: string;
  /** How many people can be rewarded (0 = no limit) */
  maxRewards: number;
  rewarded: number;
  active: boolean;
  startsAt: number | null;
  endsAt: number | null;
  createdAt: number;
  updatedAt: number;
}
export type RewardStatus = 'pending' | 'approved' | 'rejected';
export interface RewardSubmission {
  id: string;
  programId: string;
  uid: string;
  username: string;
  email: string;
  link: string;
  note: string;
  status: RewardStatus;
  attempts: number;
  submittedAt: number;
  updatedAt: number;
  reviewedAt?: number | null;
  reviewNote?: string | null;
  creditsAwarded?: number;
}

const MAX_ATTEMPTS = 5;
const MAX_REWARD = 1000;
const programs = () => db().collection('rewardPrograms');
const submissions = () => db().collection('rewardSubmissions');
const subId = (programId: string, uid: string) => `${programId}_${uid}`;
const claimRef = (programId: string, email: string) =>
  db().collection('rewardClaims').doc(`${programId}_${crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex')}`);
const SAFE_ID = /^rp_[a-f0-9]{12}$/;
const SAFE_SUB = /^rp_[a-f0-9]{12}_[\w-]{1,128}$/;

const text = (v: unknown, n: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, n);
const line = (v: unknown, n: number) => text(v, n).replace(/\s+/g, ' ');

/** An https link (no credentials, sane length), else null */
export function safeUrl(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 500) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}
/** A YouTube video id from any usual link form (watch, youtu.be, shorts, live, embed), else null */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      id = u.searchParams.get('v') || (/^\/(?:shorts|live|embed)\/([^/?#]+)/.exec(u.pathname)?.[1] ?? null);
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

const timeOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function programState(p: Pick<RewardProgram, 'active' | 'startsAt' | 'endsAt'>, now = Date.now()): 'LIVE' | 'OFF' | 'SCHEDULED' | 'ENDED' {
  if (!p.active) return 'OFF';
  if (p.startsAt && now < p.startsAt) return 'SCHEDULED';
  if (p.endsAt && now > p.endsAt) return 'ENDED';
  return 'LIVE';
}
const full = (p: RewardProgram) => p.mode === 'SUBMIT' && p.maxRewards > 0 && p.rewarded >= p.maxRewards;

/** Admin input → program fields (validated) */
export function programInput(b: any, partial: boolean): Partial<RewardProgram> | { error: string } {
  const out: Partial<RewardProgram> = {};
  if (!partial || 'title' in b) {
    out.title = line(b.title, 80);
    if (!out.title) return { error: 'Give the program a title.' };
  }
  if (!partial || 'body' in b) out.body = text(b.body, 1500);
  if (!partial || 'links' in b) {
    const raw = Array.isArray(b.links) ? b.links : [];
    const links: RewardProgram['links'] = [];
    for (const l of raw.slice(0, 5)) {
      if (!l || (!l.url && !l.label)) continue;
      const url = safeUrl(l.url);
      if (!url) return { error: `"${line(l.label || l.url, 40)}" is not a valid https link.` };
      links.push({ label: line(l.label, 40) || new URL(url).hostname, url });
    }
    out.links = links;
  }
  if (!partial || 'button' in b) {
    if (b.button && (b.button.url || b.button.label)) {
      const url = safeUrl(b.button.url);
      if (!url) return { error: 'The button needs a valid https link.' };
      out.button = { label: line(b.button.label, 30) || 'Open', url };
    } else out.button = null;
  }
  if (!partial || 'video' in b) {
    const raw = typeof b.video === 'string' ? b.video : b.video?.url;
    if (raw) {
      const url = safeUrl(raw);
      if (!url) return { error: 'The video needs a valid https link.' };
      out.video = { url, youtubeId: youtubeId(url) };
    } else out.video = null;
  }
  if (!partial || 'mode' in b) out.mode = b.mode === 'SUBMIT' ? 'SUBMIT' : 'INFO';
  if (!partial || 'reward' in b) {
    const r = Math.round(Number(b.reward ?? 0));
    if (!Number.isFinite(r) || r < 0 || r > MAX_REWARD) return { error: `The reward must be 0 to ${MAX_REWARD} credits.` };
    out.reward = r;
  }
  if (!partial || 'askFor' in b) out.askFor = line(b.askFor, 200);
  if (!partial || 'maxRewards' in b) {
    const m = Math.round(Number(b.maxRewards ?? 0));
    if (!Number.isFinite(m) || m < 0 || m > 1_000_000) return { error: 'The cap must be 0 (no limit) or more.' };
    out.maxRewards = m;
  }
  if (!partial || 'active' in b) out.active = b.active !== false;
  if (!partial || 'startsAt' in b) out.startsAt = timeOrNull(b.startsAt);
  if (!partial || 'endsAt' in b) out.endsAt = timeOrNull(b.endsAt);
  if (out.startsAt && out.endsAt && out.endsAt <= out.startsAt) return { error: 'The end date must be after the start date.' };
  return out;
}

const publicProgram = (p: RewardProgram) => ({
  id: p.id,
  title: p.title,
  body: p.body,
  links: p.links,
  button: p.button,
  image: p.image || null,
  video: p.video ? { url: p.video.url, thumb: p.video.youtubeId ? `/api/reward-video-thumb/${p.video.youtubeId}` : null } : null,
  mode: p.mode,
  reward: p.mode === 'SUBMIT' ? p.reward : 0,
  askFor: p.mode === 'SUBMIT' ? p.askFor : '',
  endsAt: p.endsAt,
  full: full(p),
});
const publicSubmission = (s: RewardSubmission | null, p: RewardProgram) =>
  s
    ? {
        link: s.link,
        note: s.note,
        status: s.status,
        submittedAt: s.submittedAt,
        reviewNote: s.status === 'rejected' ? s.reviewNote || null : null,
        creditsAwarded: s.status === 'approved' ? s.creditsAwarded || 0 : 0,
        canResubmit: s.status === 'rejected' && s.attempts < MAX_ATTEMPTS && programState(p) === 'LIVE' && !full(p),
      }
    : null;

type Review = { ok: true; submission: RewardSubmission; program: RewardProgram } | { ok: false; status: number; error: string; message: string };

export async function approveRewardSubmission(id: string): Promise<Review> {
  if (!SAFE_SUB.test(id)) return { ok: false, status: 404, error: 'NOT_FOUND', message: 'Submission not found.' };
  const ref = submissions().doc(id);
  const r = await db().runTransaction(async (tx): Promise<Review> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, status: 404, error: 'NOT_FOUND', message: 'Submission not found.' };
    const s = snap.data() as RewardSubmission;
    if (s.status !== 'pending') return { ok: false, status: 409, error: 'ALREADY_REVIEWED', message: `This submission is already ${s.status}.` };
    const pRef = programs().doc(s.programId);
    const ps = await tx.get(pRef);
    if (!ps.exists) return { ok: false, status: 404, error: 'NO_PROGRAM', message: 'This program was deleted.' };
    const p = ps.data() as RewardProgram;
    if (full(p)) return { ok: false, status: 409, error: 'FULL', message: 'Every reward of this program has been given. Raise the cap to approve more.' };
    const loaded = await loadUserInTx(tx, s.uid);
    if (!loaded) return { ok: false, status: 404, error: 'NO_ACCOUNT', message: 'This account no longer exists.' };
    const claim = claimRef(p.id, loaded.doc.email);
    if ((await tx.get(claim)).exists) return { ok: false, status: 409, error: 'ALREADY_REWARDED', message: 'This person was already rewarded for this program.' };
    const now = Date.now();
    const reward = p.reward;
    saveNormalized(tx, loaded);
    if (reward > 0) {
      tx.update(loaded.ref, {
        'credits.available': FieldValue.increment(reward),
        // Into the campaign pool: used first, the daily analyses wait (same as every campaign reward)
        'credits.campaign': Math.max(0, loaded.doc.credits.campaign ?? 0) + reward,
      });
    }
    const next: RewardSubmission = { ...s, status: 'approved', reviewedAt: now, updatedAt: now, reviewNote: null, creditsAwarded: reward };
    tx.set(ref, next);
    tx.set(claim, { at: now, program: p.id, uid: s.uid });
    tx.update(pRef, { rewarded: FieldValue.increment(1), updatedAt: now });
    addNotificationInTx(tx, s.uid, {
      type: 'reward',
      title: reward > 0 ? `+${reward} credits: ${p.title}` : `Approved: ${p.title}`,
      message: reward > 0 ? `Your entry was approved. ${reward} credits were added; they are used first.` : 'Your entry was approved. Thank you for taking part.',
    } as any);
    return { ok: true, submission: next, program: p };
  });
  if (r.ok) {
    sendEmail(
      r.submission.email,
      r.program.reward > 0 ? `${r.program.title}: approved, +${r.program.reward} credits` : `${r.program.title}: approved`,
      [
        `Hello @${r.submission.username},`,
        r.program.reward > 0
          ? `Your entry for ${r.program.title} was approved and ${r.program.reward} credits are now in your balance. They are used first, one per analysis.`
          : `Your entry for ${r.program.title} was approved. Thank you for taking part.`,
      ],
      { cta: { label: 'Open MarketX', url: siteLink('/') } }
    );
  }
  return r;
}

export async function rejectRewardSubmission(id: string, reason: string): Promise<Review> {
  if (!SAFE_SUB.test(id)) return { ok: false, status: 404, error: 'NOT_FOUND', message: 'Submission not found.' };
  const note = line(reason, 300) || "The entry didn't meet the program's requirements.";
  const ref = submissions().doc(id);
  const r = await db().runTransaction(async (tx): Promise<Review> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, status: 404, error: 'NOT_FOUND', message: 'Submission not found.' };
    const s = snap.data() as RewardSubmission;
    if (s.status !== 'pending') return { ok: false, status: 409, error: 'ALREADY_REVIEWED', message: `This submission is already ${s.status}.` };
    const ps = await tx.get(programs().doc(s.programId));
    const p = (ps.data() as RewardProgram) || ({ title: 'the program' } as RewardProgram);
    const now = Date.now();
    const next: RewardSubmission = { ...s, status: 'rejected', reviewedAt: now, updatedAt: now, reviewNote: note };
    tx.set(ref, next);
    addNotificationInTx(tx, s.uid, {
      type: 'reward',
      title: `Not approved: ${p.title}`,
      message: `${note}${s.attempts < MAX_ATTEMPTS ? ' You can send new proof from the Rewards tab.' : ''}`,
    } as any);
    return { ok: true, submission: next, program: p };
  });
  if (r.ok) {
    sendEmail(r.submission.email, `${r.program.title}: not approved`, [`Hello @${r.submission.username},`, `Your entry for ${r.program.title} wasn't approved: ${note}`, 'You can send new proof from the Rewards tab while the program is open.'], {
      cta: { label: 'Open MarketX', url: siteLink('/') },
    });
  }
  return r;
}

// Pictures: one Firestore document each (the display copy, at most 700 KB, checked by its bytes)
const pictures = () => db().collection('rewardImages');
async function savePicture(programId: string, raw: unknown): Promise<{ url: string } | { error: string } | null> {
  const parsed = parseBroadcastImage(raw);
  if (!parsed) return null;
  if ('error' in parsed) return parsed;
  const imgId = `${programId}_${crypto.randomBytes(4).toString('hex')}`;
  await pictures().doc(imgId).set({ id: imgId, contentType: parsed.contentType, data: parsed.data.toString('base64'), bytes: parsed.data.length, createdAt: Date.now() });
  return { url: `/api/reward-image/${imgId}` };
}
async function dropPicture(url: string | null) {
  const m = url ? /^\/api\/reward-image\/(rp_[a-f0-9]{12}_[a-f0-9]{8})$/.exec(url) : null;
  if (m) await pictures().doc(m[1]).delete().catch(() => {});
}
const sendPicture = (res: Response, type: string, data: Buffer) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.send(data);
};

export function registerRewardProgramRoutes(app: Express, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) =>
    fn(req, res).catch(err => {
      console.error(`[MarketX Rewards] ${req.method} ${req.path} failed:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
    });
  const submitThrottle = createKeyedThrottle({ windowMs: 60 * 60_000, max: 10 });

  // Public pictures: the program's picture and YouTube thumbnails (fetched here once, kept in memory)
  const picThrottle = createKeyedThrottle({ windowMs: 60_000, max: 120 });
  const picCache = new Map<string, { type: string; data: Buffer; at: number }>();
  const remember = (key: string, type: string, data: Buffer) => {
    if (picCache.size > 200) picCache.delete(picCache.keys().next().value as string);
    picCache.set(key, { type, data, at: Date.now() });
  };
  app.get('/api/reward-image/:id', wrap(async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^rp_[a-f0-9]{12}_[a-f0-9]{8}$/.test(id) || picThrottle.hit(clientIp(req))) return res.status(404).end();
    const hit = picCache.get(id);
    if (hit) return sendPicture(res, hit.type, hit.data);
    const d = (await pictures().doc(id).get()).data() as any;
    if (!d || typeof d.data !== 'string' || !/^image\/(jpeg|png|gif|webp)$/.test(d.contentType)) return res.status(404).end();
    const data = Buffer.from(d.data, 'base64');
    remember(id, d.contentType, data);
    sendPicture(res, d.contentType, data);
  }));
  app.get('/api/reward-video-thumb/:id', wrap(async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^[A-Za-z0-9_-]{11}$/.test(id) || picThrottle.hit(clientIp(req))) return res.status(404).end();
    const key = `yt:${id}`;
    const hit = picCache.get(key);
    if (hit && Date.now() - hit.at < 6 * 3600e3) return sendPicture(res, hit.type, hit.data);
    // Only thumbnails of videos a live program links to
    const list = await live();
    if (!list.some(p => p.video?.youtubeId === id)) return res.status(404).end();
    const r = await fetch(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, { signal: AbortSignal.timeout(6000) }).catch(() => null);
    if (!r || !r.ok || !/^image\/jpeg/.test(r.headers.get('content-type') || '')) return res.status(404).end();
    const data = Buffer.from(await r.arrayBuffer());
    if (!data.length || data.length > 2 * 1024 * 1024) return res.status(404).end();
    remember(key, 'image/jpeg', data);
    sendPicture(res, 'image/jpeg', data);
  }));

  // Programs read at most every 20s per worker; start/end checked on every request
  let cache: { at: number; list: RewardProgram[] } | null = null;
  const live = async () => {
    if (!cache || Date.now() - cache.at > 20_000) {
      const snap = await programs().where('active', '==', true).limit(50).get();
      cache = { at: Date.now(), list: snap.docs.map(d => d.data() as RewardProgram) };
    }
    const now = Date.now();
    return cache.list.filter(p => programState(p, now) === 'LIVE').sort((a, b) => (b.startsAt || b.createdAt) - (a.startsAt || a.createdAt));
  };

  // Signed in: the live programs and this trader's own entry in each
  app.get('/api/rewards/programs', limiter, requireAuth, wrap(async (_req, res) => {
    const { uid } = getUser(res);
    const list = await live();
    const subs = list.length ? await db().getAll(...list.map(p => submissions().doc(subId(p.id, uid)))) : [];
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      programs: list.map((p, i) => ({ ...publicProgram(p), mine: publicSubmission(subs[i]?.exists ? (subs[i].data() as RewardSubmission) : null, p) })),
    });
  }));

  app.post('/api/rewards/programs/:id/submit', limiter, requireAuth, wrap(async (req, res) => {
    const user = getUser(res);
    const id = String(req.params.id || '');
    if (!SAFE_ID.test(id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'This program is not available.' });
    const link = safeUrl(req.body?.link);
    if (!link) return res.status(400).json({ error: 'BAD_LINK', message: 'Paste the https link to your proof (a post, a video or a page).' });
    const note = text(req.body?.note, 500);
    if (submitThrottle.hit(user.uid)) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many entries. Please try again later.' });
    const ref = submissions().doc(subId(id, user.uid));
    const r = await db().runTransaction(async tx => {
      const [ps, ss] = await Promise.all([tx.get(programs().doc(id)), tx.get(ref)]);
      const p = ps.data() as RewardProgram | undefined;
      if (!p || programState(p) !== 'LIVE' || p.mode !== 'SUBMIT') return { error: 'CLOSED', message: 'This program is not taking entries.' } as const;
      if (full(p)) return { error: 'FULL', message: 'Every reward of this program has been given.' } as const;
      const loaded = await loadUserInTx(tx, user.uid);
      if (!loaded) return { error: 'NO_ACCOUNT', message: 'Please sign in again.' } as const;
      if ((await tx.get(claimRef(id, loaded.doc.email))).exists) return { error: 'ALREADY_REWARDED', message: 'You were already rewarded for this program.' } as const;
      const prev = ss.exists ? (ss.data() as RewardSubmission) : null;
      if (prev?.status === 'pending') return { error: 'PENDING', message: 'Your entry is waiting for review.' } as const;
      if (prev?.status === 'approved') return { error: 'ALREADY_REWARDED', message: 'Your entry was already approved.' } as const;
      if (prev && prev.attempts >= MAX_ATTEMPTS) return { error: 'TOO_MANY', message: 'You have sent the most entries allowed for this program.' } as const;
      const now = Date.now();
      const s: RewardSubmission = {
        id: subId(id, user.uid), programId: id, uid: user.uid, username: loaded.doc.username, email: loaded.doc.email, link, note,
        status: 'pending', attempts: (prev?.attempts || 0) + 1, submittedAt: now, updatedAt: now, reviewedAt: null, reviewNote: null,
      };
      tx.set(ref, s);
      return { s, p } as const;
    });
    if ('error' in r) return res.status(r.error === 'CLOSED' ? 404 : 409).json(r);
    res.json({ submission: publicSubmission(r.s, r.p) });
  }));

  // --- Admin --------------------------------------------------------------
  app.get('/api/admin/reward-programs', requireAdmin, wrap(async (_req, res) => {
    const [ps, pending] = await Promise.all([programs().limit(200).get(), submissions().where('status', '==', 'pending').limit(1000).get()]);
    const waiting: Record<string, number> = {};
    for (const d of pending.docs) {
      const pid = (d.data() as RewardSubmission).programId;
      waiting[pid] = (waiting[pid] || 0) + 1;
    }
    const now = Date.now();
    res.json({
      programs: ps.docs
        .map(d => d.data() as RewardProgram)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(p => ({ ...p, state: programState(p, now), pending: waiting[p.id] || 0 })),
    });
  }));

  app.post('/api/admin/reward-programs', requireAdmin, wrap(async (req, res) => {
    const input = programInput(req.body || {}, false);
    if ('error' in input) return res.status(400).json({ error: 'INVALID', message: input.error });
    const now = Date.now();
    const id = `rp_${crypto.randomBytes(6).toString('hex')}`;
    const pic = await savePicture(id, req.body?.image);
    if (pic && 'error' in pic) return res.status(400).json({ error: 'INVALID_IMAGE', message: pic.error });
    await programs().doc(id).set({ id, ...input, image: pic && 'url' in pic ? pic.url : null, rewarded: 0, createdAt: now, updatedAt: now });
    cache = null;
    adminLog('reward_program_create', { id });
    res.json({ success: true, id });
  }));

  app.patch('/api/admin/reward-programs/:id', requireAdmin, wrap(async (req, res) => {
    const id = String(req.params.id || '');
    if (!SAFE_ID.test(id)) return res.status(404).json({ error: 'NOT_FOUND' });
    const input = programInput(req.body || {}, true);
    if ('error' in input) return res.status(400).json({ error: 'INVALID', message: input.error });
    // Picture: a new upload replaces the old one, null removes it, leaving it out keeps it
    if ('image' in (req.body || {})) {
      const old = ((await programs().doc(id).get()).data() as RewardProgram | undefined)?.image || null;
      const keep = typeof req.body.image === 'string' && req.body.image === old;
      if (!keep) {
        const pic = req.body.image ? await savePicture(id, req.body.image) : null;
        if (pic && 'error' in pic) return res.status(400).json({ error: 'INVALID_IMAGE', message: pic.error });
        input.image = pic && 'url' in pic ? pic.url : null;
        await dropPicture(old);
      }
    }
    const r = await db().runTransaction(async t => {
      const snap = await t.get(programs().doc(id));
      if (!snap.exists) return 'MISSING';
      const next = { ...(snap.data() as RewardProgram), ...input };
      if (next.startsAt && next.endsAt && next.endsAt <= next.startsAt) return 'DATES';
      t.update(programs().doc(id), { ...input, updatedAt: Date.now() });
      return 'OK';
    });
    if (r === 'MISSING') return res.status(404).json({ error: 'NOT_FOUND', message: 'No such program.' });
    if (r === 'DATES') return res.status(400).json({ error: 'INVALID', message: 'The end date must be after the start date.' });
    cache = null;
    res.json({ success: true });
  }));

  // Deleting a program removes its card; entries and rewards already given stay on record
  app.delete('/api/admin/reward-programs/:id', requireAdmin, wrap(async (req, res) => {
    const id = String(req.params.id || '');
    if (!SAFE_ID.test(id)) return res.status(404).json({ error: 'NOT_FOUND' });
    await dropPicture(((await programs().doc(id).get()).data() as RewardProgram | undefined)?.image || null);
    await programs().doc(id).delete();
    cache = null;
    adminLog('reward_program_delete', { id });
    res.json({ success: true });
  }));

  app.get('/api/admin/reward-programs/:id/submissions', requireAdmin, wrap(async (req, res) => {
    const id = String(req.params.id || '');
    if (!SAFE_ID.test(id)) return res.status(404).json({ error: 'NOT_FOUND' });
    const snap = await submissions().where('programId', '==', id).limit(500).get();
    const list = snap.docs.map(d => d.data() as RewardSubmission).sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.submittedAt - a.submittedAt);
    res.json({ submissions: list });
  }));

  app.post('/api/admin/reward-submissions/:id/approve', requireAdmin, wrap(async (req, res) => {
    const r = await approveRewardSubmission(String(req.params.id || ''));
    if (r.ok === false) return res.status(r.status).json({ error: r.error, message: r.message });
    cache = null;
    adminLog('reward_approve', { id: r.submission.id, credits: r.program.reward });
    res.json({ submission: r.submission });
  }));

  app.post('/api/admin/reward-submissions/:id/reject', requireAdmin, wrap(async (req, res) => {
    const r = await rejectRewardSubmission(String(req.params.id || ''), String(req.body?.reason || ''));
    if (r.ok === false) return res.status(r.status).json({ error: r.error, message: r.message });
    adminLog('reward_reject', { id: r.submission.id });
    res.json({ submission: r.submission });
  }));
}
