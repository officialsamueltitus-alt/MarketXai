import React, { useMemo, useState } from 'react';
import { Gift, Users, Clock, CheckCircle2, Search, ExternalLink, Coins, Video, PenLine, XCircle, Loader2, Megaphone } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { Badge, Card, ConfirmDialog, Empty, ErrorNote, Segmented, Spinner, Stat, fmtDateTime, fmtNum, timeAgo, useAdminData } from './ui';

type Status = 'pending' | 'ready' | 'credited' | 'duplicate';
type Filter = 'all' | 'credited' | 'pending' | 'duplicate';

interface Participant {
  uid: string;
  username: string;
  email: string;
  joinedAt: number | null;
  unlockAt: number | null;
  status: Status;
  creditsAwarded: number;
  campaignCreditsLeft: number;
  tweetUrl: string | null;
  accountStatus: string;
}

const STATUS_BADGE: Record<Status, { tone: 'green' | 'amber' | 'violet' | 'gray'; label: string }> = {
  credited: { tone: 'green', label: 'Credited' },
  pending: { tone: 'amber', label: 'Waiting 10h' },
  ready: { tone: 'violet', label: 'Unlocked, crediting now' },
  duplicate: { tone: 'gray', label: 'Already claimed before' },
};

/** Time left until a future moment, e.g. "in 3h 20m" (or "now" once passed). */
const timeUntil = (ts: number | null) => {
  const ms = (ts || 0) - Date.now();
  if (ms <= 0) return 'now';
  const m = Math.ceil(ms / 60000);
  return m < 60 ? `in ${m}m` : `in ${Math.floor(m / 60)}h ${m % 60}m`;
};

type Tab = 'explain' | 'share';

// Campaigns: review "Explain MarketX" posts, and the X share campaign's participants
export const CampaignSection: React.FC = () => {
  const [tab, setTab] = useState<Tab>('explain');
  return (
    <div className="space-y-4">
      <Segmented<Tab>
        label="Campaign"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'explain', label: 'Explain MarketX' },
          { value: 'share', label: 'Share on X' },
        ]}
      />
      {tab === 'explain' ? <ExplainReviewSection /> : <ShareCampaignSection />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Explain MarketX: every submitted post, reviewed by hand (approve = 50 credits + notification + email)
// ---------------------------------------------------------------------------
type ReviewStatus = 'pending' | 'approved' | 'rejected';
interface ExplainSubmission {
  id: string;
  uid: string;
  username: string;
  email: string;
  postUrl: string | null;
  format: 'video' | 'writeup';
  note: string;
  status: ReviewStatus;
  submittedAt: number;
  updatedAt: number;
  reviewedAt: number | null;
  reviewNote: string | null;
  creditsAwarded: number;
  attempts: number;
}
type ReviewFilter = 'pending' | 'approved' | 'rejected' | 'all';

const REVIEW_BADGE: Record<ReviewStatus, { tone: 'green' | 'amber' | 'red'; label: string }> = {
  pending: { tone: 'amber', label: 'Waiting for review' },
  approved: { tone: 'green', label: 'Approved' },
  rejected: { tone: 'red', label: 'Declined' },
};

const REJECT_REASONS = [
  'The post does not tag @_MarketXai.',
  'The post is not about MarketX, or does not explain it.',
  'The write up has no screenshots of MarketX.',
  'The link does not open, or the post was deleted or made private.',
  'The content is copied or not your own.',
];

const ExplainReviewSection: React.FC = () => {
  const { data, error, loading, reload } = useAdminData<{ campaign: any; summary: any; submissions: ExplainSubmission[] }>(() =>
    apiFetch('/api/admin/campaign/submissions')
  );
  const [filter, setFilter] = useState<ReviewFilter>('pending');
  const [query, setQuery] = useState('');
  const [approve, setApprove] = useState<ExplainSubmission | null>(null);
  const [reject, setReject] = useState<ExplainSubmission | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '');
    return (data?.submissions || []).filter(
      s => (filter === 'all' || s.status === filter) && (!q || s.username.toLowerCase().includes(q) || s.email.toLowerCase().includes(q))
    );
  }, [data, filter, query]);

  const act = async (kind: 'approve' | 'reject', s: ExplainSubmission) => {
    setBusy(true);
    setNotice(null);
    try {
      await apiFetch(`/api/admin/campaign/submissions/${encodeURIComponent(s.id)}/${kind}`, {
        method: 'POST',
        body: JSON.stringify(kind === 'reject' ? { reason } : {}),
      });
      setNotice({
        ok: true,
        text: kind === 'approve' ? `Approved @${s.username}: ${data?.campaign?.reward ?? 50} credits added, user notified.` : `Declined @${s.username}; they were told why.`,
      });
      reload();
    } catch (e: any) {
      setNotice({ ok: false, text: e?.message || 'Could not update this submission.' });
    } finally {
      setBusy(false);
      setApprove(null);
      setReject(null);
      setReason('');
    }
  };

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;
  const { summary, campaign } = data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Waiting for review" value={fmtNum(summary.pending)} hint={campaign.open ? `Open until ${fmtDateTime(campaign.endsAt)}` : 'Campaign ended'} icon={Clock} tone="bg-amber-500/15 text-amber-300" />
        <Stat label="Approved" value={fmtNum(summary.approved)} hint={`${fmtNum(summary.creditsAwarded)} credits awarded`} icon={CheckCircle2} tone="bg-emerald-500/15 text-emerald-300" />
        <Stat label="Declined" value={fmtNum(summary.rejected)} hint="Users can resubmit" icon={XCircle} tone="bg-rose-500/15 text-rose-300" />
        <Stat label="Submissions" value={fmtNum(summary.total)} hint="One per account" icon={Megaphone} tone="bg-indigo-500/15 text-indigo-300" />
      </div>

      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-violet-300" /> Explain MarketX submissions
          </span>
        }
        action={
          <a href="/campaigns/explain-marketx" target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1">
            Campaign page <ExternalLink className="w-3 h-3" />
          </a>
        }
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
          <Segmented<ReviewFilter>
            label="Filter submissions"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'pending', label: `Waiting ${summary.pending}` },
              { value: 'approved', label: `Approved ${summary.approved}` },
              { value: 'rejected', label: `Declined ${summary.rejected}` },
              { value: 'all', label: `All ${summary.total}` },
            ]}
          />
          <label className="relative sm:ml-auto sm:w-64 min-w-0">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search username or email"
              aria-label="Search submissions"
              className="w-full h-9 pl-8 pr-3 rounded-full bg-white/[0.04] border border-white/[0.08] text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-white/20"
            />
          </label>
        </div>

        {notice && (
          <p className={`mb-3 text-xs rounded-xl p-2.5 border ${notice.ok ? 'text-emerald-200 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-200 bg-rose-500/10 border-rose-500/20'}`} role="status">
            {notice.text}
          </p>
        )}

        {rows.length ? (
          <ul className="space-y-2">
            {rows.map(s => {
              const badge = REVIEW_BADGE[s.status];
              return (
                <li key={s.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5 min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-100 truncate">@{s.username}</span>
                      <span className="block text-xs text-slate-500 truncate">{s.email}</span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <Badge tone="gray">
                        <span className="inline-flex items-center gap-1">
                          {s.format === 'video' ? <Video className="w-3 h-3" /> : <PenLine className="w-3 h-3" />}
                          {s.format === 'video' ? 'Video' : 'Write up'}
                        </span>
                      </Badge>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </span>
                  </div>
                  {s.postUrl && (
                    <a
                      href={s.postUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="mt-2.5 flex items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-500/[0.06] px-3 py-2 text-sm text-sky-200 hover:bg-sky-500/[0.1] min-w-0"
                    >
                      <ExternalLink className="w-4 h-4 shrink-0" />
                      <span className="truncate">{s.postUrl.replace(/^https:\/\//, '')}</span>
                      <span className="ml-auto text-xs text-sky-300/80 shrink-0">Open post</span>
                    </a>
                  )}
                  {s.note && <p className="mt-2 text-xs text-slate-400 break-words">“{s.note}”</p>}
                  <div className="mt-2 text-[11px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span title={fmtDateTime(s.submittedAt)}>Submitted {timeAgo(s.submittedAt)}</span>
                    {s.attempts > 1 && <span>Attempt {s.attempts}</span>}
                    {s.reviewedAt && <span>Reviewed {timeAgo(s.reviewedAt)}</span>}
                    {s.status === 'approved' && <span className="text-emerald-300">+{s.creditsAwarded} credits</span>}
                  </div>
                  {s.status === 'rejected' && s.reviewNote && <p className="mt-1.5 text-xs text-rose-200/80 break-words">Reason given: {s.reviewNote}</p>}
                  {s.status === 'pending' && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setApprove(s)}
                        className="h-9 px-4 rounded-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" /> Approve +{campaign.reward}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setReason(REJECT_REASONS[0]);
                          setReject(s);
                        }}
                        className="h-9 px-4 rounded-full border border-white/[0.12] text-sm font-medium text-slate-200 hover:bg-white/[0.06] inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      >
                        <XCircle className="w-4 h-4" /> Decline
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>{data.submissions.length ? 'No submissions match this filter.' : 'No posts submitted yet.'}</Empty>
        )}
      </Card>

      <ConfirmDialog
        open={!!approve}
        title={`Approve @${approve?.username || ''}?`}
        body={`Check the post first. Approving adds ${campaign.reward} campaign credits to their balance and notifies them on the site and by email. This can't be undone.`}
        confirmLabel={`Approve +${campaign.reward}`}
        busy={busy}
        onConfirm={() => approve && act('approve', approve)}
        onCancel={() => setApprove(null)}
      />
      <ConfirmDialog
        open={!!reject}
        title={`Decline @${reject?.username || ''}?`}
        body="They are told the reason on the site and by email, and can submit a new post before the campaign ends."
        confirmLabel="Decline"
        danger
        busy={busy}
        onConfirm={() => reject && act('reject', reject)}
        onCancel={() => setReject(null)}
      >
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {REJECT_REASONS.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={`text-left text-xs rounded-full px-2.5 py-1 border cursor-pointer ${reason === r ? 'border-white/30 bg-white/[0.1] text-white' : 'border-white/[0.08] text-slate-400 hover:text-white'}`}
              >
                {r}
              </button>
            ))}
          </div>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value.slice(0, 300))}
            rows={3}
            aria-label="Reason shown to the user"
            className="w-full rounded-xl bg-white/[0.03] border border-white/[0.1] focus:border-white/25 focus:outline-none px-3 py-2 text-sm text-white"
          />
        </div>
      </ConfirmDialog>
    </div>
  );
};

// X share campaign: everyone who joined, their status, credits awarded and campaign credits still unused
const ShareCampaignSection: React.FC = () => {
  const { data, error, loading, reload } = useAdminData<{ summary: any; participants: Participant[] }>(() => apiFetch('/api/admin/campaign'));
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.participants || []).filter(p => {
      const byStatus = filter === 'all' || (filter === 'pending' ? p.status === 'pending' || p.status === 'ready' : p.status === filter);
      const byQuery = !q || p.username.toLowerCase().includes(q) || p.email.toLowerCase().includes(q);
      return byStatus && byQuery;
    });
  }, [data, filter, query]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;
  const { summary } = data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Participants" value={fmtNum(summary.participants)} hint={`${fmtNum(summary.joined7d)} in the last 7 days`} icon={Users} tone="bg-indigo-500/15 text-indigo-300" />
        <Stat label="Credited" value={fmtNum(summary.credited)} hint={`${fmtNum(summary.creditsAwarded)} credits awarded`} icon={CheckCircle2} tone="bg-emerald-500/15 text-emerald-300" />
        <Stat label="Waiting" value={fmtNum(summary.pending)} hint="Inside the 10 hour window" icon={Clock} tone="bg-amber-500/15 text-amber-300" />
        <Stat label="Campaign credits unused" value={fmtNum(summary.creditsUnused)} hint={`${fmtNum(summary.duplicates)} repeat claims blocked`} icon={Coins} tone="bg-cyan-500/15 text-cyan-300" />
      </div>

      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <Gift className="w-4 h-4 text-cyan-300" /> X campaign participants
          </span>
        }
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
          <Segmented<Filter>
            label="Filter participants"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All ${summary.participants}` },
              { value: 'credited', label: `Credited ${summary.credited}` },
              { value: 'pending', label: `Waiting ${summary.pending}` },
              { value: 'duplicate', label: `Blocked ${summary.duplicates}` },
            ]}
          />
          <label className="relative sm:ml-auto sm:w-64 min-w-0">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search username or email"
              aria-label="Search participants"
              className="w-full h-9 pl-8 pr-3 rounded-full bg-white/[0.04] border border-white/[0.08] text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-white/20"
            />
          </label>
        </div>

        {rows.length ? (
          <ul className="divide-y divide-white/[0.05]">
            {rows.map(p => {
              const badge = STATUS_BADGE[p.status];
              return (
                <li key={p.uid} className="py-3 grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_200px_140px] items-center gap-x-3 gap-y-1.5 text-sm">
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-slate-200 truncate">@{p.username}</span>
                      {p.accountStatus !== 'active' && <Badge tone="red">{p.accountStatus}</Badge>}
                    </span>
                    <span className="block text-xs text-slate-500 truncate">{p.email}</span>
                  </span>
                  <span className="justify-self-end sm:justify-self-start">
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </span>
                  <span className="col-span-2 sm:col-span-1 text-xs text-slate-400 sm:text-right tabular-nums">
                    {p.status === 'credited'
                      ? `+${p.creditsAwarded} credits · ${p.campaignCreditsLeft} left`
                      : p.status === 'duplicate'
                        ? 'No credits (one claim per person)'
                        : `Unlocks ${timeUntil(p.unlockAt)}`}
                  </span>
                  <span className="col-span-2 sm:col-span-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    <span>Joined {fmtDateTime(p.joinedAt)}</span>
                    {p.tweetUrl && (
                      <a
                        href={p.tweetUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex items-center gap-1 text-indigo-300 hover:text-indigo-200"
                      >
                        View post <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>{data.participants.length ? 'No participants match this filter.' : 'Nobody has joined the campaign yet.'}</Empty>
        )}
      </Card>
    </div>
  );
};
