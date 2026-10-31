import React, { useEffect, useState } from 'react';
import { ArrowRight, BarChart3, CheckCircle2, Crown, Gift, Loader2, Trophy, UserPlus, Users } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { Badge, Card, Empty, ErrorNote, Segmented, Spinner, Stat, fmtDateTime, fmtNum, timeAgo, useAdminData } from './ui';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (m: string) => `${MONTHS[Number(m.split('-')[1]) - 1] || m} ${m.split('-')[0]}`;

const Who: React.FC<{ r: any; onBlock?: (uid: string, on: boolean) => void }> = ({ r, onBlock }) => (
  <div className="flex items-center gap-2 min-w-0">
    <span className="w-7 h-7 rounded-full overflow-hidden bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-[11px] font-semibold text-white shrink-0">
      {r.avatarUrl ? <img src={r.avatarUrl} alt="" className="w-full h-full object-cover" /> : String(r.displayName || r.username || '?').slice(0, 1).toUpperCase()}
    </span>
    <div className="min-w-0">
      <p className="text-xs font-semibold text-white truncate">
        {r.displayName || r.username} <span className="text-slate-500 font-normal">@{r.username}</span>
      </p>
      <p className="text-[10px] text-slate-500 truncate">{r.email}</p>
    </div>
    <div className="flex gap-1 shrink-0">
      {r.staff && <Badge tone="violet">Staff</Badge>}
      {r.hidden && <Badge tone="gray">Hidden</Badge>}
      {r.blocked && <Badge tone="red">Kept off</Badge>}
      {onBlock && !r.staff && (
        <button
          type="button"
          onClick={() => onBlock(r.uid, !r.blocked)}
          title={r.blocked ? 'Show this trader on the public boards again' : 'Keep this trader off the public boards for good'}
          className="h-5 px-2 rounded-full text-[10px] font-semibold bg-white/[0.05] text-slate-300 hover:bg-white/[0.12] cursor-pointer"
        >
          {r.blocked ? 'Allow' : 'Keep off'}
        </button>
      )}
      {r.status && r.status !== 'active' && <Badge tone="red">{r.status}</Badge>}
    </div>
  </div>
);

const Person: React.FC<{ p: any }> = ({ p }) => (
  <div className="flex items-center gap-2 min-w-0">
    <span className="w-7 h-7 rounded-full overflow-hidden bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-[11px] font-semibold text-white shrink-0">
      {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" /> : String(p.displayName || p.username || '?').slice(0, 1).toUpperCase()}
    </span>
    <div className="min-w-0">
      <p className="text-xs font-semibold text-white truncate">
        {p.deleted ? <span className="text-slate-500">Deleted account</span> : p.displayName || p.username} {p.username && <span className="text-slate-500 font-normal">@{p.username}</span>}
      </p>
      {p.email && <p className="text-[10px] text-slate-500 truncate">{p.email}</p>}
    </div>
  </div>
);

/** Every invited sign-up: who joined, who invited them, when, and the credits it earned (newest first, paged) */
const InvitedSignups: React.FC<{ first: any[]; firstNext: number | null }> = ({ first, firstNext }) => {
  const [list, setList] = useState<any[]>(first);
  const [next, setNext] = useState<number | null>(firstNext);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setList(first);
    setNext(firstNext);
  }, [first, firstNext]);
  const more = async () => {
    if (!next) return;
    setBusy(true);
    try {
      const d = await apiFetch<any>(`/api/admin/leaderboard?board=referrals&before=${next}`);
      setList(l => [...l, ...d.recent]);
      setNext(d.nextBefore);
    } catch {
      /* keep the list */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Invited sign-ups" action={<span className="text-[11px] text-slate-500">{fmtNum(list.length)}{next ? '+' : ''} shown</span>}>
      {list.length ? (
        <>
          <ul className="space-y-2">
            {list.map((r: any, i: number) => (
              <li key={`${r.at}-${i}`} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">Joined</p>
                    <Person p={r.joined} />
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-600 rotate-180 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">Invited by</p>
                    <Person p={r.inviter} />
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                  <UserPlus className="w-3 h-3 text-emerald-300" />
                  <span title={fmtDateTime(r.at)}>{fmtDateTime(r.at)}</span>
                  <span>· {timeAgo(r.at)}</span>
                  {r.credits > 0 && <span className="ml-auto"><Badge tone="green">+{r.credits} credits</Badge></span>}
                </div>
              </li>
            ))}
          </ul>
          {next && (
            <button type="button" onClick={more} disabled={busy} className="mt-3 w-full h-9 rounded-full bg-white/[0.05] text-xs font-semibold text-slate-200 hover:bg-white/[0.1] disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-2">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Load more
            </button>
          )}
        </>
      ) : (
        <Empty>No invited sign-ups yet.</Empty>
      )}
    </Card>
  );
};

/** Admin, Leaderboard: both boards with full detail (emails included; never shown to traders) */
export const LeaderboardAdminSection: React.FC = () => {
  const [board, setBoard] = useState<'usage' | 'referrals'>('usage');
  const [month, setMonth] = useState<string>('');
  const { data, error, loading, reload } = useAdminData<any>(
    () => apiFetch(`/api/admin/leaderboard?board=${board}${board === 'usage' && month ? `&month=${month}` : ''}`),
    [board, month]
  );
  const toggleBlock = (uid: string, on: boolean) => {
    if (on && !window.confirm('Keep this trader off the public leaderboards? They stay hidden even if they switch themselves back on.')) return;
    apiFetch('/api/admin/leaderboard/block', { method: 'POST', body: JSON.stringify({ uid, blocked: on }) })
      .then(reload)
      .catch(() => {});
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Board"
          value={board}
          onChange={v => setBoard(v as typeof board)}
          options={[
            { value: 'usage', label: 'Usage (monthly)' },
            { value: 'referrals', label: 'Referrals' },
          ]}
        />
        {board === 'usage' && data?.months && (
          <select
            aria-label="Month"
            value={month || data.month}
            onChange={e => setMonth(e.target.value)}
            className="h-9 px-3 rounded-full bg-white/[0.04] border border-white/[0.08] text-xs text-white"
          >
            {data.months.map((m: string) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </select>
        )}
      </div>
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorNote message={error} onRetry={reload} />
      ) : !data ? null : data.board === 'usage' ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Stat label="Traders on the board" value={fmtNum(data.rows.length)} icon={Users} />
            <Stat label="Points" value={fmtNum(data.total.points)} icon={Trophy} tone="bg-amber-500/15 text-amber-300" />
            <Stat label="Analyses" value={fmtNum(data.total.analyses)} icon={BarChart3} tone="bg-violet-500/15 text-violet-300" />
            <Stat label="Questions" value={fmtNum(data.total.questions)} tone="bg-emerald-500/15 text-emerald-300" />
            <Stat label="Matt + Fundamentals" value={fmtNum(data.total.matt + data.total.fundamentals)} tone="bg-sky-500/15 text-sky-300" />
          </div>
          {data.winners?.length > 0 && (
            <Card title={`Winners · ${monthLabel(data.month)}`} action={data.finalizedAt ? <span className="text-[11px] text-slate-500">Closed {fmtDateTime(data.finalizedAt)}</span> : undefined}>
              <div className="grid sm:grid-cols-3 gap-3">
                {data.winners.map((w: any) => (
                  <div key={w.rank} className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3">
                    <span className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${w.rank === 1 ? 'bg-amber-400/20 text-amber-300' : w.rank === 2 ? 'bg-slate-300/15 text-slate-200' : 'bg-orange-400/15 text-orange-300'}`}>
                      {w.rank === 1 ? <Crown className="w-4 h-4" /> : w.rank}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{w.displayName || w.username} <span className="text-slate-500 font-normal">@{w.username}</span></p>
                      {w.email && <p className="text-[10px] text-slate-500 truncate">{w.email}</p>}
                      <p className="text-[11px] text-slate-300 tabular-nums">{fmtNum(w.points)} pts · {w.tier?.label}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
          <Card
            title={`Usage leaderboard · ${monthLabel(data.month)}`}
            action={<span className="text-[11px] text-slate-500">{data.month === data.months?.[0] ? `Live · resets ${fmtDateTime(data.resetsAt)}` : data.finalizedAt ? 'Final standings' : 'Month over'}</span>}
          >
            {data.rows.length ? (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs min-w-[780px]">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-500 text-left">
                    <tr>
                      <th className="py-2 px-1 w-10">#</th>
                      <th className="py-2 px-1 w-14" title="Place on the public board (staff, hidden and kept-off accounts are not ranked there)">Public</th>
                      <th className="py-2 px-1">Trader</th>
                      <th className="py-2 px-1 text-right">Points</th>
                      <th className="py-2 px-1">Level</th>
                      <th className="py-2 px-1 text-right">Analyses</th>
                      <th className="py-2 px-1 text-right">Questions</th>
                      <th className="py-2 px-1 text-right">Fund.</th>
                      <th className="py-2 px-1 text-right">Matt</th>
                      <th className="py-2 px-1 text-right">Days</th>
                      <th className="py-2 px-1">Top market</th>
                      <th className="py-2 px-1">Last</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r: any) => (
                      <tr key={r.uid} className="border-t border-white/[0.05]">
                        <td className="py-2 px-1 font-semibold text-slate-400">{r.rank}</td>
                        <td className="py-2 px-1 font-semibold text-violet-200 tabular-nums">{r.publicRank ? `#${r.publicRank}` : '–'}</td>
                        <td className="py-2 px-1 max-w-[260px]"><Who r={r} onBlock={toggleBlock} /></td>
                        <td className="py-2 px-1 text-right font-semibold text-white tabular-nums">{fmtNum(r.points)}</td>
                        <td className="py-2 px-1 text-slate-300">{r.tier?.label}</td>
                        <td className="py-2 px-1 text-right tabular-nums">{fmtNum(r.analyses)}</td>
                        <td className="py-2 px-1 text-right tabular-nums">{fmtNum(r.questions)}</td>
                        <td className="py-2 px-1 text-right tabular-nums">{fmtNum(r.fundamentals)}</td>
                        <td className="py-2 px-1 text-right tabular-nums">{fmtNum(r.matt)}</td>
                        <td className="py-2 px-1 text-right tabular-nums">{r.activeDays}</td>
                        <td className="py-2 px-1 text-slate-300">{r.topPair || '–'}</td>
                        <td className="py-2 px-1 text-slate-500">{timeAgo(r.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>No usage recorded for this month yet.</Empty>
            )}
            <p className="mt-3 text-[11px] text-slate-500">
              Staff, hidden, suspended and banned accounts are listed here but never shown on the public board.
            </p>
          </Card>
        </>
      ) : (
        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-4">
          <Card title="Referral leaderboard · all time">
            {data.rows.length ? (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-xs min-w-[520px]">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-500 text-left">
                    <tr>
                      <th className="py-2 px-1 w-10">#</th>
                      <th className="py-2 px-1">Trader</th>
                      <th className="py-2 px-1 text-right">Invited</th>
                      <th className="py-2 px-1 text-right">This month</th>
                      <th className="py-2 px-1 text-right">Credits earned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r: any) => (
                      <tr key={r.uid} className="border-t border-white/[0.05]">
                        <td className="py-2 px-1 font-semibold text-slate-400">{r.rank}</td>
                        <td className="py-2 px-1 max-w-[260px]"><Who r={r} onBlock={toggleBlock} /></td>
                        <td className="py-2 px-1 text-right font-semibold text-white tabular-nums">{fmtNum(r.invited)}</td>
                        <td className="py-2 px-1 text-right tabular-nums">{fmtNum(r.thisMonth)}</td>
                        <td className="py-2 px-1 text-right tabular-nums">{fmtNum(r.earned)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>Nobody has joined with an invite link yet.</Empty>
            )}
          </Card>
          <InvitedSignups first={data.recent} firstNext={data.nextBefore} />
        </div>
      )}
    </div>
  );
};

/** Admin, Invite rewards: the owner turns the program on/off and sets the credits per invite (off by default) */
export const InviteRewardsSection: React.FC = () => {
  const { data, error, loading, reload } = useAdminData<any>(() => apiFetch('/api/admin/invite-rewards'));
  const [enabled, setEnabled] = useState(false);
  const [credits, setCredits] = useState('0');
  const [cap, setCap] = useState('20');
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (!data) return;
    setEnabled(!!data.settings.enabled);
    setCredits(String(data.settings.credits ?? 0));
    setCap(String(data.settings.maxPerMonth ?? 20));
  }, [data]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;
  const dirty = enabled !== !!data.settings.enabled || Number(credits) !== Number(data.settings.credits) || Number(cap) !== Number(data.settings.maxPerMonth);
  const save = async () => {
    setSaving(true);
    setNote(null);
    try {
      await apiFetch('/api/admin/invite-rewards', { method: 'PUT', body: JSON.stringify({ enabled, credits: Number(credits), maxPerMonth: Number(cap) }) });
      setNote({ ok: true, text: enabled ? `Saved. Every new invite now earns ${Number(credits)} credits.` : 'Saved. Invites are counted but earn no credits.' });
      reload();
    } catch (err: any) {
      setNote({ ok: false, text: err?.message || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Invited sign-ups" value={fmtNum(data.stats.total)} hint="all time" icon={UserPlus} />
        <Stat label="This month" value={fmtNum(data.stats.thisMonth)} icon={Users} tone="bg-cyan-500/15 text-cyan-300" />
        <Stat label="Credits given" value={fmtNum(data.stats.credits)} hint="all time" icon={Gift} tone="bg-emerald-500/15 text-emerald-300" />
      </div>
      <Card title="Invite reward program">
        <div className="space-y-4 max-w-lg">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled(v => !v)}
            className="w-full flex items-center gap-3 p-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] text-left cursor-pointer hover:border-white/[0.16]"
          >
            <span className="flex-1">
              <span className="block text-sm font-semibold text-white">{enabled ? 'Program on' : 'Program off'}</span>
              <span className="block text-[11px] text-slate-400">
                {enabled ? 'Traders earn credits when someone joins with their invite link.' : 'Invites are still counted on the referrals board, but nobody earns credits.'}
              </span>
            </span>
            <span className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-white/15'}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
            </span>
          </button>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-slate-400">Credits per invite</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={data.maxCredits}
                value={credits}
                onChange={e => setCredits(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                className="mt-1 w-full h-10 px-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-400">Rewarded invites per trader per month (0 = no cap)</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={1000}
                value={cap}
                onChange={e => setCap(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                className="mt-1 w-full h-10 px-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white"
              />
            </label>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Credits are added when the invited trader activates their account with their pass code (the same one-device, one-email checks as every
            sign-up). They join the campaign pool: spent first, before the daily analyses. Changes apply to new invites only, never to past ones.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty || (enabled && Number(credits) < 1)}
              className="h-10 px-5 rounded-full bg-white text-slate-950 text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Save
            </button>
            {enabled && Number(credits) < 1 && <span className="text-[11px] text-amber-300">Set at least 1 credit to turn it on.</span>}
            {note && <span className={`text-[11px] ${note.ok ? 'text-emerald-300' : 'text-red-300'}`}>{note.text}</span>}
          </div>
          {data.settings.updatedAt && <p className="text-[10px] text-slate-600">Last changed {fmtDateTime(data.settings.updatedAt)}</p>}
        </div>
      </Card>
    </div>
  );
};
