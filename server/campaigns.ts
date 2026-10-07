import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './firebase';
import { sendEmail } from './mailer';
import { addNotificationInTx, getUser, loadUserInTx, requireAuth, saveNormalized, siteLink } from './account';

// ===========================================================================
// "Explain MarketX" campaign: users post a short video or a written explainer about MarketX on X, tag
// @_MarketX and submit the post link here. Nothing is automatic: an admin reviews each post and approves
// (50 credits, added to the campaign pool so they work past the daily limit) or declines it with a reason.
//   campaignSubmissions/{campaignId}_{uid} -> one submission per account (resubmittable after a decline)
//   campaignClaims/explain_e_{emailHash}    -> one approved reward per person, even across deleted accounts
// ===========================================================================

export const EXPLAIN_CAMPAIGN = {
  id: 'explain-marketx',
  title: 'Explain MarketX',
  reward: 50,
  handle: '@_MarketX',
  // Open until the end of 30 October 2026, Lagos time (UTC+1)
  endsAt: Date.parse('2026-10-30T23:59:59+01:00'),
  path: '/campaigns/explain-marketx',
} as const;

export type SubmissionStatus = 'pending' | 'approved' | 'rejected';
export type SubmissionFormat = 'video' | 'writeup';

export interface CampaignSubmission {
  id: string;
  campaignId: string;
  uid: string;
  username: string;
  email: string;
  postUrl: string;
  format: SubmissionFormat;
  note: string;
  status: SubmissionStatus;
  submittedAt: number;
  updatedAt: number;
  reviewedAt?: number | null;
  reviewNote?: string | null;
  creditsAwarded?: number;
  /** How many times this account has submitted (a declined post can be replaced) */
  attempts: number;
}

const submissionsCol = () => db().collection('campaignSubmissions');
const submissionRef = (uid: string) => submissionsCol().doc(`${EXPLAIN_CAMPAIGN.id}_${uid}`);
const claimRef = (email: string) =>
  db()
    .collection('campaignClaims')
    .doc('explain_e_' + crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex'));

export const campaignOpen = (now = Date.now()) => now <= EXPLAIN_CAMPAIGN.endsAt;
const MAX_ATTEMPTS = 5;

/** Accepts only a link to one post on X: https://x.com/<handle>/status/<id> (twitter.com and mobile hosts too). */
export function normalizePostUrl(raw: unknown): string | null {
  const s = String(raw || '').trim();
  const m = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{5,25})(?:[/?#][^\s<>"']*)?$/i.exec(s);
  return m ? `https://x.com/${m[1]}/status/${m[2]}` : null;
}

function publicSubmission(s: CampaignSubmission | null) {
  if (!s) return null;
  return {
    postUrl: s.postUrl,
    format: s.format,
    note: s.note,
    status: s.status,
    submittedAt: s.submittedAt,
    reviewedAt: s.reviewedAt || null,
    reviewNote: s.status === 'rejected' ? s.reviewNote || null : null,
    creditsAwarded: s.status === 'approved' ? s.creditsAwarded || EXPLAIN_CAMPAIGN.reward : 0,
    canResubmit: s.status === 'rejected' && campaignOpen() && s.attempts < MAX_ATTEMPTS,
  };
}

const campaignInfo = () => ({
  id: EXPLAIN_CAMPAIGN.id,
  title: EXPLAIN_CAMPAIGN.title,
  reward: EXPLAIN_CAMPAIGN.reward,
  handle: EXPLAIN_CAMPAIGN.handle,
  endsAt: EXPLAIN_CAMPAIGN.endsAt,
  open: campaignOpen(),
});

export function registerCampaignRoutes(app: Express, limiter: any) {
  const wrap =
    (fn: (req: Request, res: Response) => Promise<any>) =>
    (req: Request, res: Response) =>
      fn(req, res).catch(err => {
        console.error(`[MarketX Campaign] ${req.method} ${req.path} failed:`, err?.message || err);
        if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
      });

  // Public: what the campaign is and whether it is still open
  app.get('/api/campaigns/explain-marketx', limiter, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ campaign: campaignInfo() });
  });

  // Signed in: the campaign plus this account's submission (if any)
  app.get('/api/campaigns/explain-marketx/me', limiter, requireAuth, wrap(async (req, res) => {
    const user = getUser(res);
    const snap = await submissionRef(user.uid).get();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ campaign: campaignInfo(), submission: publicSubmission(snap.exists ? (snap.data() as CampaignSubmission) : null) });
  }));

  // Submit (or, after a decline, replace) the post link. Credits are never added here: an admin reviews first.
  app.post('/api/campaigns/explain-marketx/submit', limiter, requireAuth, wrap(async (req, res) => {
    const user = getUser(res);
    if (!campaignOpen()) return res.status(410).json({ error: 'CAMPAIGN_ENDED', message: 'This campaign ended on 30 October 2026.' });
    const postUrl = normalizePostUrl(req.body?.postUrl);
    if (!postUrl) {
      return res.status(400).json({ error: 'INVALID_LINK', message: 'Paste the link to your post on X, like https://x.com/yourname/status/1234567890.' });
    }
    const format: SubmissionFormat = req.body?.format === 'video' ? 'video' : 'writeup';
    const note = String(req.body?.note || '').replace(/\s+/g, ' ').trim().slice(0, 280);

    const result = await db().runTransaction(async tx => {
      const loaded = await loadUserInTx(tx, user.uid);
      if (!loaded) return { error: 'NO_ACCOUNT', status: 404, message: 'Account not found.' };
      const [subSnap, claimSnap, dupSnap] = await Promise.all([
        tx.get(submissionRef(user.uid)),
        tx.get(claimRef(loaded.doc.email)),
        tx.get(submissionsCol().where('postUrl', '==', postUrl).limit(3)),
      ]);
      if (claimSnap.exists) return { error: 'ALREADY_REWARDED', status: 409, message: 'You have already been rewarded for this campaign. It can be claimed once per person.' };
      // The same post can't be submitted by two accounts
      if (dupSnap.docs.some(d => (d.data() as CampaignSubmission).uid !== user.uid)) {
        return { error: 'DUPLICATE_POST', status: 409, message: 'This post has already been submitted by another account.' };
      }
      const existing = subSnap.exists ? (subSnap.data() as CampaignSubmission) : null;
      if (existing?.status === 'approved') return { error: 'ALREADY_REWARDED', status: 409, message: 'Your post was approved and your 50 credits were added.' };
      if (existing?.status === 'pending' && existing.postUrl === postUrl) return { submission: existing };
      if (existing && existing.attempts >= MAX_ATTEMPTS) return { error: 'TOO_MANY', status: 429, message: 'You have reached the limit of submissions for this campaign.' };
      const now = Date.now();
      const submission: CampaignSubmission = {
        id: `${EXPLAIN_CAMPAIGN.id}_${user.uid}`,
        campaignId: EXPLAIN_CAMPAIGN.id,
        uid: user.uid,
        username: loaded.doc.username,
        email: loaded.doc.email,
        postUrl,
        format,
        note,
        status: 'pending',
        submittedAt: now,
        updatedAt: now,
        reviewedAt: null,
        reviewNote: null,
        attempts: (existing?.attempts || 0) + 1,
      };
      saveNormalized(tx, loaded);
      tx.set(submissionRef(user.uid), submission);
      return { submission };
    });
    if ('error' in result) return res.status(result.status as number).json({ error: result.error, message: result.message });
    res.json({ success: true, campaign: campaignInfo(), submission: publicSubmission(result.submission as CampaignSubmission) });
  }));
}

// ---------------------------------------------------------------------------
// Admin review (routes registered by the admin module behind requireAdmin)
// ---------------------------------------------------------------------------
export async function listSubmissions() {
  const snap = await submissionsCol().where('campaignId', '==', EXPLAIN_CAMPAIGN.id).get();
  const list = snap.docs.map(d => d.data() as CampaignSubmission).sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    campaign: campaignInfo(),
    summary: {
      total: list.length,
      pending: list.filter(s => s.status === 'pending').length,
      approved: list.filter(s => s.status === 'approved').length,
      rejected: list.filter(s => s.status === 'rejected').length,
      creditsAwarded: list.filter(s => s.status === 'approved').reduce((a, s) => a + (s.creditsAwarded || 0), 0),
    },
    submissions: list.map(s => ({
      id: s.id,
      uid: s.uid,
      username: s.username,
      email: s.email,
      postUrl: normalizePostUrl(s.postUrl),
      format: s.format,
      note: s.note,
      status: s.status,
      submittedAt: s.submittedAt,
      updatedAt: s.updatedAt,
      reviewedAt: s.reviewedAt || null,
      reviewNote: s.reviewNote || null,
      creditsAwarded: s.creditsAwarded || 0,
      attempts: s.attempts,
    })),
  };
}

export type ReviewResult = { ok: true; submission: CampaignSubmission } | { ok: false; status: number; error: string; message: string };

/** Approves a pending submission: 50 credits (campaign pool), one reward per person, notification + email. */
export async function approveSubmission(id: string): Promise<ReviewResult> {
  const ref = submissionsCol().doc(String(id));
  const result = await db().runTransaction(async (tx): Promise<ReviewResult> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, status: 404, error: 'NOT_FOUND', message: 'Submission not found.' };
    const s = snap.data() as CampaignSubmission;
    if (s.status !== 'pending') return { ok: false, status: 409, error: 'ALREADY_REVIEWED', message: `This submission is already ${s.status}.` };
    const loaded = await loadUserInTx(tx, s.uid);
    if (!loaded) return { ok: false, status: 404, error: 'NO_ACCOUNT', message: 'This account no longer exists.' };
    const claim = claimRef(loaded.doc.email);
    const claimSnap = await tx.get(claim);
    if (claimSnap.exists) return { ok: false, status: 409, error: 'ALREADY_REWARDED', message: 'This person has already been rewarded for this campaign.' };
    const now = Date.now();
    const reward = EXPLAIN_CAMPAIGN.reward;
    saveNormalized(tx, loaded);
    tx.update(loaded.ref, {
      'credits.available': FieldValue.increment(reward),
      // Campaign credits are used first; the daily analyses pause (no 3:00 AM refill) until they run out
      'credits.campaign': Math.max(0, loaded.doc.credits.campaign ?? 0) + reward,
    });
    const next: CampaignSubmission = { ...s, status: 'approved', reviewedAt: now, updatedAt: now, reviewNote: null, creditsAwarded: reward };
    tx.set(ref, next);
    tx.set(claim, { at: now, campaign: EXPLAIN_CAMPAIGN.id, uid: s.uid });
    addNotificationInTx(tx, s.uid, {
      type: 'reward',
      title: `+${reward} credits: your MarketX post was approved`,
      message: `Thanks for explaining MarketX on X. ${reward} campaign credits were added. They are used first, and your daily analyses are kept for after they run out.`,
    });
    return { ok: true, submission: next };
  });
  if ('submission' in result) {
    sendEmail(
      result.submission.email,
      `Your MarketX post was approved: +${EXPLAIN_CAMPAIGN.reward} credits`,
      [
        `Hello @${result.submission.username},`,
        `Thanks for explaining MarketX on X. We reviewed your post and ${EXPLAIN_CAMPAIGN.reward} credits are now in your balance.`,
        'Campaign credits are used first, one per analysis. Your daily analyses are paused and kept for when they run out.',
      ],
      { cta: { label: 'Use your credits', url: siteLink('/') } }
    );
  }
  return result;
}

/** Declines a pending submission with a reason; the user is told and can submit a new post before the deadline. */
export async function rejectSubmission(id: string, reason: string): Promise<ReviewResult> {
  const note = String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'The post did not meet the campaign requirements.';
  const ref = submissionsCol().doc(String(id));
  const result = await db().runTransaction(async (tx): Promise<ReviewResult> => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, status: 404, error: 'NOT_FOUND', message: 'Submission not found.' };
    const s = snap.data() as CampaignSubmission;
    if (s.status !== 'pending') return { ok: false, status: 409, error: 'ALREADY_REVIEWED', message: `This submission is already ${s.status}.` };
    const now = Date.now();
    const next: CampaignSubmission = { ...s, status: 'rejected', reviewedAt: now, updatedAt: now, reviewNote: note };
    tx.set(ref, next);
    const canRetry = campaignOpen(now) && s.attempts < MAX_ATTEMPTS;
    addNotificationInTx(tx, s.uid, {
      type: 'reward',
      title: 'Your Explain MarketX post was not approved',
      message: `Reason: ${note}${canRetry ? ' You can post again and submit a new link before 30 October 2026.' : ''}`,
      // Opens the campaign page, where the decision and the resubmit form are
      actionType: 'open_explain_campaign',
    } as any);
    return { ok: true, submission: next };
  });
  if ('submission' in result) {
    const canRetry = campaignOpen() && result.submission.attempts < MAX_ATTEMPTS;
    sendEmail(
      result.submission.email,
      'Your Explain MarketX post was not approved',
      [
        `Hello @${result.submission.username},`,
        `We reviewed the post you submitted for the Explain MarketX campaign and could not approve it this time.`,
        `Reason: ${note}`,
        ...(canRetry ? ['You can publish a new post and submit its link on the campaign page before 30 October 2026.'] : []),
      ],
      { cta: { label: canRetry ? 'Open the campaign' : 'Open MarketX', url: siteLink(canRetry ? EXPLAIN_CAMPAIGN.path : '/') } }
    );
  }
  return result;
}
