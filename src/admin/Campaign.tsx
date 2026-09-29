import React, { useMemo, useState } from 'react';
import { Gift, Users, Clock, CheckCircle2, Search, ExternalLink, Coins } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { Badge, Card, Empty, ErrorNote, Segmented, Spinner, Stat, fmtDateTime, fmtNum, useAdminData } from './ui';

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

// X campaign: everyone who joined, their status, credits awarded and campaign credits still unused
export const CampaignSection: React.FC = () => {
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
