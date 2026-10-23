import React, { useState } from 'react';
import { CheckCircle2, Coins, Gift, Loader2, Search } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { Badge, Card, Empty, ErrorNote, Spinner, Stat, fmtNum, timeAgo, useAdminData } from './ui';

// Admin → Credits (owner-specified): find a trader by email, MarketX ID, username or account id and gift them credits.
// Gifted credits are spent first (before the daily analyses); the trader gets a notification and an email.
export const CreditsSection: React.FC = () => {
  const gifts = useAdminData<any>(() => apiFetch('/api/admin/credits/gifts'));
  const [q, setQ] = useState('');
  const [user, setUser] = useState<any>(null);
  const [finding, setFinding] = useState(false);
  const [amount, setAmount] = useState('10');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const max = gifts.data?.maxAmount ?? 10000;

  const find = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setFinding(true);
    setMsg(null);
    setUser(null);
    try {
      const r = await apiFetch<{ user: any }>(`/api/admin/credits/lookup?q=${encodeURIComponent(q.trim())}`);
      setUser(r.user);
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message || 'No trader found.' });
    } finally {
      setFinding(false);
    }
  };
  const send = async () => {
    const n = Number(amount);
    if (!user || !(n >= 1 && n <= max)) return;
    setSending(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ user: any }>('/api/admin/credits/gift', { method: 'POST', body: JSON.stringify({ q: user.uid, amount: n, note }) });
      setUser(r.user);
      setNote('');
      setMsg({ ok: true, text: `Sent ${fmtNum(n)} credits to @${r.user.username}. They were notified by email.` });
      gifts.reload();
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message || 'Could not send the credits.' });
    } finally {
      setSending(false);
    }
  };
  const total = (gifts.data?.gifts || []).reduce((s: number, g: any) => s + (Number(g.amount) || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Recent gifts" value={fmtNum(gifts.data?.gifts?.length || 0)} hint="last 50" icon={Gift} />
        <Stat label="Credits gifted" value={fmtNum(total)} hint="in those gifts" icon={Coins} tone="bg-emerald-500/15 text-emerald-300" />
      </div>
      <Card title="Gift credits to a trader">
        <form onSubmit={find} className="flex gap-2 max-w-xl">
          <label className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Email, MarketX ID, @username or account id"
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white"
            />
          </label>
          <button type="submit" disabled={finding || !q.trim()} className="h-10 px-4 rounded-full bg-white text-slate-950 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
            {finding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Find
          </button>
        </form>

        {user && (
          <div className="mt-4 max-w-xl rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">
                  {user.displayName} <span className="text-slate-500 font-normal">@{user.username}</span>
                </p>
                <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Badge tone={user.plan === 'free' ? 'gray' : 'violet'}>{user.plan}</Badge>
                {user.status !== 'active' && <Badge tone="red">{user.status}</Badge>}
                {user.unlimited && <Badge tone="violet">Unlimited</Badge>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Credits', user.credits.available],
                ['Bonus (spent first)', user.credits.bonus],
                ['Daily left', `${user.credits.dailyRemaining}/${user.credits.dailyLimit}`],
              ].map(([l, v]) => (
                <div key={String(l)} className="rounded-xl bg-black/20 border border-white/[0.05] py-2">
                  <p className="text-sm font-semibold text-white">{typeof v === 'number' ? fmtNum(v) : v}</p>
                  <p className="text-[10px] text-slate-500">{l}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[120px_1fr] gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={max}
                value={amount}
                onChange={e => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                aria-label="Credits"
                className="h-10 px-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white"
              />
              <input
                value={note}
                onChange={e => setNote(e.target.value.slice(0, 240))}
                placeholder="Message to the trader (optional)"
                className="h-10 px-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[5, 10, 25, 50, 100].map(n => (
                <button key={n} type="button" onClick={() => setAmount(String(n))} className={`h-7 px-3 rounded-full text-xs cursor-pointer ${Number(amount) === n ? 'bg-white text-slate-950' : 'bg-white/[0.05] text-slate-300'}`}>
                  {n}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={send}
              disabled={sending || user.unlimited || user.status === 'banned' || !(Number(amount) >= 1 && Number(amount) <= max)}
              className="h-10 px-5 rounded-full bg-emerald-500 text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />} Gift {fmtNum(Number(amount) || 0)} credits
            </button>
            <p className="text-[11px] text-slate-500">Gifted credits are used first, before the trader's daily analyses. The trader gets a notification and an email.</p>
          </div>
        )}
        {msg && (
          <p className={`mt-3 text-xs inline-flex items-center gap-1.5 ${msg.ok ? 'text-emerald-300' : 'text-red-300'}`}>
            {msg.ok && <CheckCircle2 className="w-3.5 h-3.5" />} {msg.text}
          </p>
        )}
      </Card>

      <Card title="Latest gifts">
        {gifts.loading && !gifts.data ? (
          <Spinner />
        ) : gifts.error ? (
          <ErrorNote message={gifts.error} onRetry={gifts.reload} />
        ) : gifts.data?.gifts?.length ? (
          <ul className="space-y-2">
            {gifts.data.gifts.map((g: any, i: number) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <Gift className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                <span className="flex-1 min-w-0 truncate text-slate-300">
                  <span className="text-white font-semibold">+{fmtNum(g.amount)}</span> to <span className="text-white font-semibold">@{g.username || 'deleted'}</span>
                  {g.email ? <span className="text-slate-500"> · {g.email}</span> : null}
                  {g.note ? <span className="text-slate-500"> · “{g.note}”</span> : null}
                </span>
                <span className="text-[10px] text-slate-500 shrink-0">{timeAgo(g.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No credits gifted yet.</Empty>
        )}
      </Card>
    </div>
  );
};
