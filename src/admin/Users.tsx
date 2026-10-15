import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ShieldOff, ShieldCheck, Ban, Trash2, Mail, Crown, ChevronRight } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { ActivityList } from './Overview';
import {
  Badge,
  Card,
  ColumnChart,
  ConfirmDialog,
  Empty,
  ErrorNote,
  RankBars,
  Segmented,
  Spinner,
  Stat,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtNum,
  timeAgo,
  useAdminData,
} from './ui';

type Action = 'suspend' | 'unsuspend' | 'ban' | 'unban' | 'delete';

export const StatusBadge: React.FC<{ status: string }> = ({ status }) =>
  status === 'suspended' ? (
    <Badge tone="amber">
      <ShieldOff className="w-3 h-3" /> Suspended
    </Badge>
  ) : status === 'banned' ? (
    <Badge tone="red">
      <Ban className="w-3 h-3" /> Banned
    </Badge>
  ) : (
    <Badge tone="green">
      <ShieldCheck className="w-3 h-3" /> Active
    </Badge>
  );

const Avatar: React.FC<{ u: any; size?: number }> = ({ u, size = 36 }) =>
  u.avatarUrl ? (
    <img src={u.avatarUrl} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />
  ) : (
    <span
      className="rounded-full bg-indigo-500/20 text-indigo-200 font-semibold flex items-center justify-center shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {(u.username || u.email || '?').slice(0, 1).toUpperCase()}
    </span>
  );

const ACTION_COPY: Record<Action, { title: string; body: string; label: string; danger: boolean }> = {
  suspend: {
    title: 'Suspend this account?',
    body: 'They are signed out and cannot sign in until you reinstate them. Their data is kept. They will receive an email explaining that their account is suspended and how to contact support.',
    label: 'Suspend account',
    danger: true,
  },
  unsuspend: { title: 'Reinstate this account?', body: 'They can sign in again and will receive a reinstatement email.', label: 'Reinstate', danger: false },
  ban: {
    title: 'Ban this account?',
    body: 'They are signed out, cannot sign in, and their email cannot be used to sign up again. They will receive an email explaining the ban and how to contact support.',
    label: 'Ban account',
    danger: true,
  },
  unban: { title: 'Lift this ban?', body: 'They can sign in again, their email is allowed again, and they will receive a reinstatement email.', label: 'Lift ban', danger: false },
  delete: {
    title: 'Delete this account permanently?',
    body: 'Their profile, chats, credits and notifications are erased and cannot be recovered. Payment records are kept. They will receive an email explaining that their account was deleted and how to contact support.',
    label: 'Delete permanently',
    danger: true,
  },
};

const UserDetail: React.FC<{ uid: string; onClose: () => void; onChanged: () => void; onMessage: (target: string) => void }> = ({
  uid,
  onClose,
  onChanged,
  onMessage,
}) => {
  const { data, error, loading, reload } = useAdminData<any>(() => apiFetch(`/api/admin/users/${uid}`), [uid]);
  const [pending, setPending] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !pending && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, pending]);

  // The page behind the sheet stays put while the sheet scrolls
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prev;
    };
  }, []);

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ emailed: boolean }>(`/api/admin/users/${uid}/action`, { method: 'POST', body: JSON.stringify({ action: pending, reason }) });
      setNote(`Done. ${r.emailed ? 'The user has been emailed.' : 'The email could not be sent (check the email settings).'}`);
      setPending(null);
      setReason('');
      onChanged();
      if (pending === 'delete') setTimeout(onClose, 900);
      else reload();
    } catch (e: any) {
      setNote(e?.message || 'Action failed.');
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const u = data?.user;
  return createPortal(
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="User details">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60 mx-fade-in cursor-default" />
      <aside className="mx-sheet absolute inset-x-0 bottom-0 max-h-[92dvh] sm:inset-y-3 sm:right-3 sm:left-auto sm:bottom-3 sm:max-h-none sm:w-[560px] rounded-t-3xl sm:rounded-3xl bg-[var(--mx-bg-2)] border border-white/[0.08] overflow-y-auto overscroll-contain">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-5 py-4 bg-[var(--mx-bg-2)]/95 backdrop-blur border-b border-white/[0.06]">
          <span className="text-sm font-semibold text-white">User details</span>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] inline-flex items-center justify-center cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {loading && !data && <Spinner />}
          {error && <ErrorNote message={error} onRetry={reload} />}
          {u && (
            <>
              <div className="flex items-center gap-3">
                <Avatar u={u} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-lg font-semibold text-white truncate">{u.displayName || u.username}</span>
                    <StatusBadge status={u.status} />
                    {u.proActive && (
                      <Badge tone="violet">
                        <Crown className="w-3 h-3" /> Pro {u.plan}
                      </Badge>
                    )}
                  </div>
                  <div className="text-sm text-slate-400 truncate">
                    @{u.username} · {u.email}
                  </div>
                  <div className="text-xs text-slate-500">
                    Joined {fmtDate(u.joinedAt)} · Last active {timeAgo(u.lastActiveAt)}
                  </div>
                  {u.signup && (
                    <div className="text-xs text-slate-500 break-all" title={u.signup.userAgent || ''}>
                      Signed up from {u.signup.ip || 'unknown IP'}
                      {u.signup.userAgent ? ` · ${/iPhone|iPad/.test(u.signup.userAgent) ? 'iOS' : /Android/.test(u.signup.userAgent) ? 'Android' : /Mac OS/.test(u.signup.userAgent) ? 'Mac' : /Windows/.test(u.signup.userAgent) ? 'Windows' : /Linux/.test(u.signup.userAgent) ? 'Linux' : 'Other device'}` : ''}
                    </div>
                  )}
                </div>
              </div>

              {note && <p className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2.5">{note}</p>}
              {u.status !== 'active' && u.statusReason && (
                <p className="text-xs text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5">
                  Internal note: {u.statusReason} ({fmtDateTime(u.statusAt)})
                </p>
              )}

              <div className="grid grid-cols-3 gap-2">
                <Stat label="Today" value={fmtNum(data.usage.today)} />
                <Stat label="7 days" value={fmtNum(data.usage.week)} />
                <Stat label="30 days" value={fmtNum(data.usage.month)} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="All prompts" value={fmtNum(data.usage.total)} />
                <Stat label="Credits" value={fmtNum(u.credits)} />
                <Stat label="Daily left" value={`${u.dailyRemaining}/${u.dailyLimit}`} />
              </div>

              <Card title="Prompts per day · 30 days">
                <ColumnChart height={120} ariaLabel="This user's prompts per day" data={data.usage.series.map((d: any) => ({ label: d.day, value: d.prompts }))} unit=" prompts" />
              </Card>
              <Card title="Most prompted pairs">
                <RankBars rows={data.usage.topPairs} />
              </Card>

              <Card title="Payments">
                {data.payments.length ? (
                  <ul className="divide-y divide-white/[0.05]">
                    {data.payments.map((p: any) => (
                      <li key={p.reference} className="py-2 flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0">
                          <span className="block text-slate-200">Pro {p.plan}</span>
                          <span className="block text-xs text-slate-500">{fmtDateTime(p.createdAt)}</span>
                        </span>
                        <span className="text-right shrink-0">
                          <span className="block text-slate-200 tabular-nums">{fmtMoney(p.amount, p.currency)}</span>
                          <Badge tone={p.status === 'fulfilled' ? 'green' : p.status === 'pending' ? 'gray' : 'amber'}>{p.status}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No payments.</p>
                )}
              </Card>

              <Card title="Activity">{data.activity.length ? <ActivityList items={data.activity} showUser={false} /> : <p className="text-sm text-slate-500">No activity yet.</p>}</Card>

              <Card title="Account actions">
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => onMessage(u.email)} className="h-11 rounded-xl border border-white/[0.1] text-sm text-slate-200 hover:bg-white/[0.05] inline-flex items-center justify-center gap-2 cursor-pointer">
                    <Mail className="w-4 h-4" /> Send notice
                  </button>
                  {u.status === 'suspended' ? (
                    <button type="button" onClick={() => setPending('unsuspend')} className="h-11 rounded-xl bg-emerald-500/15 text-emerald-300 text-sm font-medium hover:bg-emerald-500/20 cursor-pointer">
                      Reinstate
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={u.status === 'banned'}
                      onClick={() => setPending('suspend')}
                      className="h-11 rounded-xl bg-amber-500/15 text-amber-300 text-sm font-medium hover:bg-amber-500/20 disabled:opacity-40 inline-flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ShieldOff className="w-4 h-4" /> Suspend
                    </button>
                  )}
                  {u.status === 'banned' ? (
                    <button type="button" onClick={() => setPending('unban')} className="h-11 rounded-xl bg-emerald-500/15 text-emerald-300 text-sm font-medium hover:bg-emerald-500/20 cursor-pointer">
                      Lift ban
                    </button>
                  ) : (
                    <button type="button" onClick={() => setPending('ban')} className="h-11 rounded-xl bg-rose-500/15 text-rose-300 text-sm font-medium hover:bg-rose-500/20 inline-flex items-center justify-center gap-2 cursor-pointer">
                      <Ban className="w-4 h-4" /> Ban
                    </button>
                  )}
                  <button type="button" onClick={() => setPending('delete')} className="h-11 rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-500 inline-flex items-center justify-center gap-2 cursor-pointer">
                    <Trash2 className="w-4 h-4" /> Delete
                  </button>
                </div>
              </Card>
            </>
          )}
        </div>
      </aside>

      {pending && (
        <ConfirmDialog
          open
          title={ACTION_COPY[pending].title}
          body={ACTION_COPY[pending].body}
          confirmLabel={ACTION_COPY[pending].label}
          danger={ACTION_COPY[pending].danger}
          busy={busy}
          onConfirm={run}
          onCancel={() => setPending(null)}
        >
          {['suspend', 'ban', 'delete'].includes(pending) && (
            <label className="block mt-4">
              <span className="text-xs text-slate-400">Internal note (not sent to the user)</span>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Why this action was taken"
                className="mt-1.5 w-full rounded-xl bg-white/[0.03] border border-white/[0.08] focus:border-white/25 focus:outline-none p-3 text-sm text-white placeholder:text-slate-600 resize-none"
              />
            </label>
          )}
        </ConfirmDialog>
      )}
    </div>,
    document.body
  );
};

export const UsersSection: React.FC<{ onMessage: (target: string) => void }> = ({ onMessage }) => {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'' | 'pro' | 'suspended' | 'banned'>('');
  const [selected, setSelected] = useState<string | null>(null);
  const { data, error, loading, reload } = useAdminData<any>(
    () => apiFetch(`/api/admin/users?q=${encodeURIComponent(query)}&status=${status}`),
    [query, status]
  );

  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <label className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search username, name or email"
            aria-label="Search users"
            className="w-full h-11 pl-10 pr-3 rounded-2xl bg-[var(--mx-surface)] border border-white/[0.08] focus:border-white/25 focus:outline-none text-sm text-white placeholder:text-slate-600"
          />
        </label>
        <Segmented
          label="Filter users"
          value={status}
          onChange={v => setStatus(v as typeof status)}
          options={[
            { value: '', label: 'All' },
            { value: 'pro', label: 'Pro' },
            { value: 'suspended', label: 'Suspended' },
            { value: 'banned', label: 'Banned' },
          ]}
        />
      </div>

      {error && <ErrorNote message={error} onRetry={reload} />}
      <Card title={data ? `${fmtNum(data.total)} user${data.total === 1 ? '' : 's'}` : 'Users'}>
        {loading && !data ? (
          <Spinner />
        ) : !data?.users.length ? (
          <Empty>No users match.</Empty>
        ) : (
          <ul className="-mx-2 divide-y divide-white/[0.05]">
            {data.users.map((u: any) => (
              <li key={u.uid}>
                <button
                  type="button"
                  onClick={() => setSelected(u.uid)}
                  className="w-full text-left px-2 py-3 rounded-2xl hover:bg-white/[0.03] transition-colors grid grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_minmax(0,2fr)_110px_90px_110px_auto] items-center gap-3 cursor-pointer"
                >
                  <Avatar u={u} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-white truncate">@{u.username}</span>
                    <span className="block text-xs text-slate-500 truncate">{u.email}</span>
                  </span>
                  <span className="hidden sm:block">
                    <StatusBadge status={u.status} />
                  </span>
                  <span className="hidden sm:block">{u.proActive ? <Badge tone="violet">Pro</Badge> : <Badge>Free</Badge>}</span>
                  <span className="hidden sm:block text-xs text-slate-400 tabular-nums">{fmtNum(u.usageTotal)} prompts</span>
                  <span className="flex items-center gap-2 text-[11px] text-slate-500">
                    <span className="sm:hidden">{u.status !== 'active' ? <StatusBadge status={u.status} /> : timeAgo(u.lastActiveAt || u.joinedAt)}</span>
                    <span className="hidden sm:inline">{timeAgo(u.lastActiveAt || u.joinedAt)}</span>
                    <ChevronRight className="w-4 h-4" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {selected && <UserDetail uid={selected} onClose={() => setSelected(null)} onChanged={reload} onMessage={t => { setSelected(null); onMessage(t); }} />}
    </div>
  );
};
