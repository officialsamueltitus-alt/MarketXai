// Admin console: Matt and Fundamental Analysis usage + history (server/siLogs.ts, GET /api/admin/si/:tool)
import React, { useEffect, useState } from 'react';
import { Activity, CalendarDays, CalendarRange, ChevronDown, Loader2, Search, ShieldAlert, Users, X } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { Badge, Card, ColumnChart, ConfirmDialog, Empty, ErrorNote, RankBars, Spinner, Stat, fmtDateTime, fmtNum, timeAgo, useAdminData } from './ui';

type Tool = 'matt' | 'fundamental';

const OUTCOMES: Record<Tool, { value: string; label: string; tone: 'green' | 'amber' | 'red' | 'violet' | 'gray' }[]> = {
  matt: [
    { value: 'ANSWERED', label: 'Answered', tone: 'green' },
    { value: 'OFFLINE', label: 'Answered from the guide', tone: 'violet' },
    { value: 'PRIVATE', label: 'Private (strike)', tone: 'red' },
    { value: 'PAUSED', label: 'Paused', tone: 'amber' },
    { value: 'REPLACED', label: 'Reply blocked', tone: 'red' },
  ],
  fundamental: [
    { value: 'OK', label: 'Read served', tone: 'green' },
    { value: 'NOT_FUNDAMENTAL', label: 'Not fundamental', tone: 'gray' },
    { value: 'UNAVAILABLE', label: 'Unavailable', tone: 'amber' },
    { value: 'ERROR', label: 'Error', tone: 'red' },
  ],
};
// Markdown symbols dropped for reading (the reply is shown as plain text, never as HTML)
const plain = (t: string) => String(t || '').replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s+/gm, '');
const outcomeOf = (tool: Tool, v: string) => OUTCOMES[tool].find(o => o.value === v) || { value: v, label: v, tone: 'gray' as const };

const RECHECK: Record<string, [string, 'green' | 'amber' | 'violet']> = {
  STILL_VALID: ['Still valid', 'green'],
  CHANGED: ['Changed', 'amber'],
  RELEASED: ['Released', 'violet'],
};

// ---------------------------------------------------------------------------
// History rows
// ---------------------------------------------------------------------------
const MattRow: React.FC<{ r: any; onUser: (u: string) => void }> = ({ r, onUser }) => {
  const [open, setOpen] = useState(false);
  const o = outcomeOf('matt', r.outcome);
  return (
    <li className="py-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500 tabular-nums" title={fmtDateTime(r.ts)}>{timeAgo(r.ts)}</span>
        {r.username ? (
          <button type="button" onClick={() => onUser(r.username)} className="font-medium text-indigo-300 hover:underline cursor-pointer">@{r.username}</button>
        ) : (
          <span className="text-slate-500">(deleted)</span>
        )}
        <Badge tone={o.tone}>{o.label}</Badge>
        {r.pair && <Badge>{r.pair}</Badge>}
        {r.fromCard && <Badge tone="violet">From an Ask Matt button</Badge>}
        {r.pausedUntil && <span className="text-amber-300">paused until {fmtDateTime(r.pausedUntil)}</span>}
      </div>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="mt-1.5 w-full text-left flex items-start gap-2 cursor-pointer group">
        <p className={`flex-1 min-w-0 text-sm text-slate-200 ${open ? 'whitespace-pre-wrap break-words' : 'line-clamp-2'}`}>{r.question || '(no text)'}</p>
        <ChevronDown className={`w-4 h-4 mt-0.5 shrink-0 text-slate-500 group-hover:text-white transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-2 rounded-2xl bg-white/[0.03] border border-white/[0.06] p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Matt replied</p>
          <p className="mt-1 text-[13px] text-slate-300 whitespace-pre-wrap break-words leading-relaxed">{plain(r.reply) || '(empty)'}</p>
        </div>
      )}
    </li>
  );
};

const FundamentalRow: React.FC<{ r: any; onUser: (u: string) => void }> = ({ r, onUser }) => {
  const [open, setOpen] = useState(false);
  const o = outcomeOf('fundamental', r.outcome);
  const re = r.recheckState ? RECHECK[r.recheckState] : null;
  return (
    <li className="py-3 min-w-0">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500 tabular-nums" title={fmtDateTime(r.ts)}>{timeAgo(r.ts)}</span>
        {r.username ? (
          <button type="button" onClick={() => onUser(r.username)} className="font-medium text-indigo-300 hover:underline cursor-pointer">@{r.username}</button>
        ) : (
          <span className="text-slate-500">(deleted)</span>
        )}
        <Badge tone={r.kind === 'RECHECK' ? 'violet' : 'gray'}>{r.kind === 'RECHECK' ? 'Recheck' : 'Read'}</Badge>
        <Badge tone={o.tone}>{o.label}</Badge>
        {re && <Badge tone={re[1]}>{re[0]}</Badge>}
        {r.cached && <Badge>Reused (10 min)</Badge>}
        {r.ms > 0 && !r.cached && <span className="text-slate-500 tabular-nums">{(r.ms / 1000).toFixed(1)}s</span>}
      </div>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="mt-1.5 w-full text-left flex items-start gap-2 cursor-pointer group">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white font-medium truncate">{r.event || r.question || '(no question)'}</p>
          {r.mostLikely && (
            <p className="text-xs text-slate-400 truncate">
              Most likely: {r.mostLikely} ({r.probability}%){r.currency ? ` · ${r.currency}` : ''}
              {r.actual ? ` · Actual ${r.actual}${r.forecast ? ` vs ${r.forecast}` : ''}` : r.forecast ? ` · Forecast ${r.forecast}` : ''}
            </p>
          )}
        </div>
        <ChevronDown className={`w-4 h-4 mt-0.5 shrink-0 text-slate-500 group-hover:text-white transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <dl className="mt-2 rounded-2xl bg-white/[0.03] border border-white/[0.06] p-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-slate-500">Asked</dt>
          <dd className="text-slate-200 break-words">{r.question || '(none)'}</dd>
          {r.status && (
            <>
              <dt className="text-slate-500">Status</dt>
              <dd className="text-slate-200">{r.status.toLowerCase()}{r.impact ? ` · ${r.impact.toLowerCase()} for ${r.currency || 'the currency'}` : ''}</dd>
            </>
          )}
          {r.pairsFor?.length > 0 && (
            <>
              <dt className="text-slate-500">For</dt>
              <dd className="text-emerald-300 break-words">{r.pairsFor.join(', ')}</dd>
            </>
          )}
          {r.pairsAgainst?.length > 0 && (
            <>
              <dt className="text-slate-500">Against</dt>
              <dd className="text-rose-300 break-words">{r.pairsAgainst.join(', ')}</dd>
            </>
          )}
          {r.confidence > 0 && (
            <>
              <dt className="text-slate-500">Confidence</dt>
              <dd className="text-slate-200">{r.confidence}%{r.web ? ' · web searched' : ''}</dd>
            </>
          )}
          {r.recheckHeadline && (
            <>
              <dt className="text-slate-500">Recheck</dt>
              <dd className="text-slate-200 break-words">{r.recheckHeadline}</dd>
            </>
          )}
        </dl>
      )}
    </li>
  );
};

// ---------------------------------------------------------------------------
// History list with filters and "Load more"
// ---------------------------------------------------------------------------
const History: React.FC<{ tool: Tool; first: { logs: any[]; next: number | null }; user: string; outcome: string; onUser: (u: string) => void; onOutcome: (o: string) => void }> = ({
  tool,
  first,
  user,
  outcome,
  onUser,
  onOutcome,
}) => {
  const [logs, setLogs] = useState(first.logs);
  const [next, setNext] = useState(first.next);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(user);
  useEffect(() => {
    setLogs(first.logs);
    setNext(first.next);
  }, [first]);
  useEffect(() => setDraft(user), [user]);
  const more = async () => {
    if (!next || busy) return;
    setBusy(true);
    try {
      const q = new URLSearchParams({ before: String(next), limit: '40', ...(outcome ? { outcome } : {}), ...(user ? { user } : {}) });
      const r = await apiFetch<any>(`/api/admin/si/${tool}?${q}`);
      setLogs(l => [...l, ...r.logs]);
      setNext(r.next);
    } catch {
    } finally {
      setBusy(false);
    }
  };
  const Row = tool === 'matt' ? MattRow : FundamentalRow;
  return (
    <Card title={tool === 'matt' ? 'Conversation history' : 'Read history'}>
      <div className="flex flex-col sm:flex-row gap-2 mb-2">
        <form
          className="relative flex-1 min-w-0"
          onSubmit={e => {
            e.preventDefault();
            onUser(draft.trim().replace(/^@/, ''));
          }}
        >
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="Filter by username, then press Enter"
            aria-label="Filter by username"
            className="w-full h-10 pl-9 pr-9 rounded-xl bg-white/[0.03] border border-white/[0.08] focus:border-indigo-400/60 focus:outline-none text-sm text-white"
          />
          {user && (
            <button type="button" onClick={() => onUser('')} aria-label="Clear the username filter" className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full text-slate-400 hover:text-white inline-flex items-center justify-center cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </form>
        <select
          value={outcome}
          onChange={e => onOutcome(e.target.value)}
          aria-label="Filter by outcome"
          className="h-10 px-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-sm text-slate-200 cursor-pointer"
        >
          <option value="">All outcomes</option>
          {OUTCOMES[tool].map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {logs.length ? (
        <ul className="divide-y divide-white/[0.05]">
          {logs.map(r => (
            <Row key={r.id} r={r} onUser={onUser} />
          ))}
        </ul>
      ) : (
        <Empty>{user || outcome ? 'Nothing matches these filters.' : tool === 'matt' ? 'No Matt conversations yet.' : 'No fundamental reads yet.'}</Empty>
      )}
      {next && (
        <button
          type="button"
          onClick={more}
          disabled={busy}
          className="mt-3 w-full h-10 rounded-xl border border-white/[0.08] text-xs font-medium text-slate-300 hover:bg-white/[0.05] inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Load more
        </button>
      )}
      <p className="mt-3 text-[11px] text-slate-500">Kept for 90 days. Removed when a trader deletes their account. Never shown to traders.</p>
    </Card>
  );
};

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
const SiSection: React.FC<{ tool: Tool }> = ({ tool }) => {
  const [user, setUser] = useState('');
  const [outcome, setOutcome] = useState('');
  const [clearing, setClearing] = useState<{ uid: string; username: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error, loading, reload } = useAdminData<any>(() => {
    const q = new URLSearchParams({ limit: '40', ...(outcome ? { outcome } : {}), ...(user ? { user } : {}) });
    return apiFetch(`/api/admin/si/${tool}?${q}`);
  }, [tool, user, outcome]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;
  const s = data.stats;
  const unit = tool === 'matt' ? ' messages' : ' reads';
  const served = tool === 'matt' ? (s.outcomes.ANSWERED || 0) + (s.outcomes.OFFLINE || 0) : s.outcomes.OK || 0;
  const pickUser = (u: string) => {
    setUser(u);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  };

  const clearGuard = async () => {
    if (!clearing) return;
    setBusy(true);
    try {
      await apiFetch(`/api/admin/si/matt/${encodeURIComponent(clearing.uid)}/clear`, { method: 'POST' });
      setClearing(null);
      reload();
    } catch {
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Today" value={fmtNum(s.today)} hint={`${fmtNum(s.usersToday)} trader${s.usersToday === 1 ? '' : 's'}`} icon={Activity} />
        <Stat label="Last 7 days" value={fmtNum(s.week)} hint={unit.trim()} icon={CalendarDays} />
        <Stat label="Last 30 days" value={fmtNum(s.month)} hint={`${s.month ? Math.round((served / s.month) * 100) : 0}% served`} icon={CalendarRange} />
        <Stat label="Traders (30d)" value={fmtNum(s.usersMonth)} hint={tool === 'matt' ? 'used Matt' : 'used Fundamental Analysis'} icon={Users} tone="bg-emerald-500/15 text-emerald-300" />
      </div>

      <Card title={`${tool === 'matt' ? 'Matt messages' : 'Fundamental reads'} per day · last 30 days`}>
        <ColumnChart ariaLabel={`${tool === 'matt' ? 'Matt messages' : 'Fundamental reads'} per day over the last 30 days`} data={s.series.map((d: any) => ({ label: d.day, value: d.total }))} unit={unit} />
      </Card>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Outcomes · 30 days">
          <RankBars rows={OUTCOMES[tool].map(o => ({ name: o.label, count: s.outcomes[o.value] || 0 })).filter(r => r.count > 0)} />
        </Card>
        <Card title="Most active traders · 30 days">
          {s.topUsers.length ? (
            <ol className="space-y-2">
              {s.topUsers.map((u: any) => (
                <li key={u.uid} className="flex items-center justify-between gap-3 text-sm">
                  <button type="button" onClick={() => pickUser(u.username)} className="text-indigo-300 hover:underline truncate cursor-pointer">@{u.username}</button>
                  <span className="text-slate-300 tabular-nums">{fmtNum(u.count)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>No usage yet.</Empty>
          )}
        </Card>
        {tool === 'matt' ? (
          <Card title="Markets asked about · recent">
            <RankBars rows={s.topPairs || []} />
          </Card>
        ) : (
          <Card title="Releases read · recent">
            <RankBars rows={s.topEvents || []} />
            <p className="mt-3 text-[11px] text-slate-500">
              {fmtNum(s.rechecks || 0)} recheck{s.rechecks === 1 ? '' : 's'} and {fmtNum(s.cached || 0)} reused read{s.cached === 1 ? '' : 's'} in the last {fmtNum(s.sample || 0)}
              {s.avgSeconds != null ? ` · a fresh read takes ${s.avgSeconds}s on average` : ''}.
            </p>
          </Card>
        )}
      </div>

      {tool === 'matt' && (
        <Card title={<span className="inline-flex items-center gap-1.5"><ShieldAlert className="w-4 h-4 text-amber-300" /> Private-question strikes and pauses</span>}>
          {s.guarded?.length ? (
            <ul className="divide-y divide-white/[0.05]">
              {s.guarded.map((g: any) => (
                <li key={g.uid} className="py-2.5 flex flex-wrap items-center gap-2 text-sm">
                  <button type="button" onClick={() => pickUser(g.username)} className="text-indigo-300 hover:underline cursor-pointer">@{g.username}</button>
                  {g.pausedUntil ? <Badge tone="amber">Paused until {fmtDateTime(g.pausedUntil)}</Badge> : <Badge tone="red">{g.strikes} strike{g.strikes === 1 ? '' : 's'}</Badge>}
                  {g.level > 0 && <Badge>{g.level} pause{g.level === 1 ? '' : 's'} so far</Badge>}
                  {g.lastAt && <span className="text-xs text-slate-500">last {timeAgo(g.lastAt)}</span>}
                  <button
                    type="button"
                    onClick={() => setClearing({ uid: g.uid, username: g.username })}
                    className="ml-auto h-8 px-3 rounded-full border border-white/[0.1] text-xs text-slate-300 hover:bg-white/[0.05] cursor-pointer"
                  >
                    {g.pausedUntil ? 'Lift pause' : 'Clear strikes'}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No trader has a strike or a pause.</Empty>
          )}
        </Card>
      )}

      <History tool={tool} first={data} user={user} outcome={outcome} onUser={setUser} onOutcome={setOutcome} />

      <ConfirmDialog
        open={!!clearing}
        title={`Reset Matt for @${clearing?.username || ''}?`}
        body="Their strikes are cleared and any pause is lifted now. The next private question starts again from the first warning."
        confirmLabel="Reset"
        busy={busy}
        onConfirm={clearGuard}
        onCancel={() => setClearing(null)}
      />
    </div>
  );
};

export const MattAdminSection: React.FC = () => <SiSection tool="matt" />;
export const FundamentalAdminSection: React.FC = () => <SiSection tool="fundamental" />;
