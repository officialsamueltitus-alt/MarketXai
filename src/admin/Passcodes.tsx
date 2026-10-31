import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, RefreshCw, Copy, Check, Mail, Lock, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { Badge, Card, Empty, ErrorNote, Spinner, fmtDateTime, fmtNum, timeAgo, useAdminData } from './ui';

interface Report {
  batch: number;
  size: number;
  generated: boolean;
  redeemed: number;
  waiting: number;
  available: number;
  expiredReturned: number;
  full: boolean;
  ttlHours: number;
  consistent: boolean;
  waitingList: Array<{ email: string; code: string; reservedAt: number; expiresAt: number; emailSent: boolean; attempts: number; locked: boolean }>;
  recentRedeemed: Array<{ email: string; code: string; redeemedAt: number }>;
  updatedAt: number;
}

const timeLeft = (ts: number, now: number) => {
  const m = Math.max(0, Math.ceil((ts - now) / 60000));
  if (m <= 0) return 'expiring now';
  return m < 60 ? `${m}m left` : `${Math.floor(m / 60)}h ${m % 60}m left`;
};

// Invite pass codes: live seat counts for the current batch, the codes waiting to be entered, and recent redemptions
export const PasscodesCard: React.FC = () => {
  const { data, error, loading, reload } = useAdminData<Report>(() => apiFetch('/api/admin/passcodes'));
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState<string | null>(null);

  // Keep it current: refetch and tick the countdowns every 30 seconds
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      if (!document.hidden) reloadRef.current();
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  const copy = (code: string) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(code);
    setTimeout(() => setCopied(null), 1500);
  };

  const title = (
    <span className="inline-flex items-center gap-2">
      <KeyRound className="w-4 h-4 text-cyan-300" /> Pass codes{data ? ` · batch ${data.batch}` : ''}
    </span>
  );
  const action = (
    <button
      type="button"
      onClick={() => {
        setNow(Date.now());
        reload();
      }}
      className="h-8 px-3 rounded-full text-xs text-slate-300 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] inline-flex items-center gap-1.5 cursor-pointer"
      aria-label="Refresh pass codes"
    >
      <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
    </button>
  );

  if (loading && !data) return <Card title={title}><Spinner /></Card>;
  if (error && !data) return <Card title={title}><ErrorNote message={error} onRetry={reload} /></Card>;
  if (!data) return null;
  const pct = (n: number) => `${(n / Math.max(1, data.size)) * 100}%`;

  return (
    <Card title={title} action={action}>
      {/* Seat bar: redeemed, waiting, available */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-300">
          <span className="text-2xl font-semibold text-white tabular-nums">{fmtNum(data.available)}</span> of {fmtNum(data.size)} seats open
        </p>
        {data.full ? <Badge tone="red">All seats taken, sign-ups closed</Badge> : <Badge tone="green">Sign-ups open</Badge>}
      </div>
      <div className="mt-3 h-2.5 rounded-full bg-white/[0.06] overflow-hidden flex" role="img" aria-label={`${data.redeemed} redeemed, ${data.waiting} waiting, ${data.available} available`}>
        <span className="h-full bg-emerald-400" style={{ width: pct(data.redeemed) }} />
        <span className="h-full bg-amber-400" style={{ width: pct(data.waiting) }} />
      </div>
      <ul className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        {[
          { label: 'Redeemed', value: data.redeemed, dot: 'bg-emerald-400', hint: 'Account created' },
          { label: 'Waiting', value: data.waiting, dot: 'bg-amber-400', hint: `${data.ttlHours}h to enter it` },
          { label: 'Open', value: data.available, dot: 'bg-white/30', hint: 'Free for new sign-ups' },
          { label: 'Expired, returned', value: data.expiredReturned, dot: 'bg-slate-600', hint: 'Unused, seat reissued' },
        ].map(s => (
          <li key={s.label} className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 min-w-0">
            <span className="flex items-center gap-1.5 text-slate-400">
              <span className={`w-2 h-2 rounded-full ${s.dot}`} /> {s.label}
            </span>
            <span className="block mt-1 text-lg font-semibold text-white tabular-nums">{fmtNum(s.value)}</span>
            <span className="block text-[11px] text-slate-500 truncate">{s.hint}</span>
          </li>
        ))}
      </ul>
      {data.full && (
        <p className="mt-3 text-xs text-amber-200 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Every seat in batch {data.batch} is taken. Raise ACCESS_CODE_BATCH on the server to open a new batch of {data.size}.
        </p>
      )}
      {!data.generated && <p className="mt-3 text-xs text-slate-500">This batch's codes are created on the first sign-up.</p>}
      {!data.consistent && (
        <p className="mt-3 text-xs text-amber-200 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> The batch counter and the code records disagree; the numbers above are read from the code records.
        </p>
      )}

      <div className="mt-5 grid lg:grid-cols-2 gap-4">
        <div className="min-w-0">
          <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-2">Waiting to be entered ({data.waiting})</h3>
          {data.waitingList.length ? (
            <ul className="divide-y divide-white/[0.05]">
              {data.waitingList.map(w => (
                <li key={w.email} className="py-2.5 flex items-center gap-3 min-w-0">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-200 truncate">{w.email}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                      <span className="tabular-nums">{timeLeft(w.expiresAt, now)}</span>
                      <span className="inline-flex items-center gap-1">
                        <Mail className="w-3 h-3" /> {w.emailSent ? 'code emailed' : 'email pending'}
                      </span>
                      {w.attempts > 0 && <span>{w.attempts} wrong tr{w.attempts === 1 ? 'y' : 'ies'}</span>}
                      {w.locked && (
                        <span className="inline-flex items-center gap-1 text-amber-300">
                          <Lock className="w-3 h-3" /> locked
                        </span>
                      )}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => copy(w.code)}
                    className="shrink-0 h-8 px-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] font-mono text-xs text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
                    title="Copy this pass code"
                    aria-label={`Copy pass code for ${w.email}`}
                  >
                    {w.code}
                    {copied === w.code ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 text-slate-500" />}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No codes are waiting.</Empty>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="text-xs font-medium uppercase tracking-wider text-slate-500 mb-2">Recently redeemed</h3>
          {data.recentRedeemed.length ? (
            <ul className="divide-y divide-white/[0.05]">
              {data.recentRedeemed.map(r => (
                <li key={r.code} className="py-2.5 flex items-center gap-3 min-w-0">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-slate-200 truncate">{r.email || 'Account'}</span>
                    <span className="block text-[11px] text-slate-500" title={fmtDateTime(r.redeemedAt)}>
                      Joined {timeAgo(r.redeemedAt)}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-slate-500">{r.code}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No codes redeemed yet.</Empty>
          )}
        </div>
      </div>
      <p className="mt-4 text-[11px] text-slate-500">
        Updated {new Date(data.updatedAt).toLocaleTimeString()} · refreshes every 30 seconds. Codes left unused for {data.ttlHours} hours expire and their seat reopens.
      </p>
    </Card>
  );
};
