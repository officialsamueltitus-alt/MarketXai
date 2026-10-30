import React, { useState } from 'react';
import { Loader2, Mail, Pencil, Plus, Ticket, Trash2, X } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { Badge, Card, ConfirmDialog, Empty, ErrorNote, Spinner, Stat, fmtDateTime, fmtNum, useAdminData } from './ui';

type State = 'LIVE' | 'OFF' | 'SCHEDULED' | 'EXPIRED';
interface AdminCoupon {
  code: string;
  monthlyPct: number;
  yearlyPct: number;
  active: boolean;
  startsAt: number | null;
  endsAt: number | null;
  title: string;
  text: string;
  banner: boolean;
  mailAt: number | null;
  mail: { state: 'SENDING' | 'SENT' | null; sent: number; doneAt: number | null } | null;
  uses?: { monthly?: number; yearly?: number };
  state: State;
  createdAt: number;
}

const STATE_BADGE: Record<State, { tone: 'green' | 'amber' | 'violet' | 'gray'; label: string }> = {
  LIVE: { tone: 'green', label: 'Live' },
  SCHEDULED: { tone: 'violet', label: 'Scheduled' },
  EXPIRED: { tone: 'gray', label: 'Ended' },
  OFF: { tone: 'amber', label: 'Off' },
};

// <input type="datetime-local"> works in the browser's local time
const toLocalInput = (t: number | null) => {
  if (!t) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).getTime() : null);

interface Draft {
  code: string;
  monthlyPct: string;
  yearlyPct: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
  banner: boolean;
  title: string;
  text: string;
}
const EMPTY: Draft = { code: '', monthlyPct: '', yearlyPct: '', startsAt: '', endsAt: '', active: true, banner: false, title: '', text: '' };
const draftOf = (c: AdminCoupon): Draft => ({
  code: c.code,
  monthlyPct: String(c.monthlyPct || ''),
  yearlyPct: String(c.yearlyPct || ''),
  startsAt: toLocalInput(c.startsAt),
  endsAt: toLocalInput(c.endsAt),
  active: c.active,
  banner: c.banner,
  title: c.title || '',
  text: c.text || '',
});

const input =
  'h-10 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] px-3 text-sm text-white outline-none focus:border-indigo-400/50 placeholder:text-slate-600';

const Switch: React.FC<{ on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }> = ({ on, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 cursor-pointer ${on ? 'bg-emerald-500' : 'bg-white/[0.12]'}`}
  >
    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${on ? 'translate-x-5' : ''}`} />
  </button>
);

// Coupons (owner-specified): create codes with a percent off 3 months / Yearly, switch them on and off. The server only
// accepts a code while it is live (on, after its start, before its end) and prices the checkout with it.
export const CouponsSection: React.FC = () => {
  const { data, error, loading, reload } = useAdminData(() => apiFetch<{ coupons: AdminCoupon[] }>('/api/admin/coupons'));
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<AdminCoupon | null>(null);

  const coupons = data?.coupons || [];
  const live = coupons.filter(c => c.state === 'LIVE').length;
  const used = coupons.reduce((n, c) => n + (c.uses?.monthly || 0) + (c.uses?.yearly || 0), 0);

  const openNew = () => {
    setDraft(EMPTY);
    setFormError(null);
    setEditing('new');
  };
  const openEdit = (c: AdminCoupon) => {
    setDraft(draftOf(c));
    setFormError(null);
    setEditing(c.code);
  };
  const save = async () => {
    setFormError(null);
    const body = {
      monthlyPct: Number(draft.monthlyPct) || 0,
      yearlyPct: Number(draft.yearlyPct) || 0,
      startsAt: fromLocalInput(draft.startsAt),
      endsAt: fromLocalInput(draft.endsAt),
      active: draft.active,
      banner: draft.banner,
      title: draft.title,
      text: draft.text,
    };
    setSaving(true);
    try {
      if (editing === 'new') await apiFetch('/api/admin/coupons', { method: 'POST', body: JSON.stringify({ code: draft.code, ...body }) });
      else await apiFetch(`/api/admin/coupons/${encodeURIComponent(String(editing))}`, { method: 'PATCH', body: JSON.stringify(body) });
      setEditing(null);
      reload();
    } catch (e: any) {
      setFormError(e?.message || 'Could not save the coupon.');
    } finally {
      setSaving(false);
    }
  };
  const toggle = async (c: AdminCoupon, active: boolean) => {
    setBusyCode(c.code);
    try {
      await apiFetch(`/api/admin/coupons/${encodeURIComponent(c.code)}`, { method: 'PATCH', body: JSON.stringify({ active }) });
      reload();
    } catch {
    } finally {
      setBusyCode(null);
    }
  };
  const remove = async () => {
    if (!toDelete) return;
    setBusyCode(toDelete.code);
    try {
      await apiFetch(`/api/admin/coupons/${encodeURIComponent(toDelete.code)}`, { method: 'DELETE' });
      setToDelete(null);
      reload();
    } catch {
    } finally {
      setBusyCode(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Stat label="Coupons" value={fmtNum(coupons.length)} icon={Ticket} />
        <Stat label="Live now" value={fmtNum(live)} tone="text-emerald-300" />
        <Stat label="Paid checkouts with a code" value={fmtNum(used)} />
      </div>

      <Card
        title="Coupon codes"
        action={
          <button type="button" onClick={openNew} className="h-9 px-3.5 rounded-xl bg-white text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-slate-200 cursor-pointer">
            <Plus className="w-3.5 h-3.5" /> New coupon
          </button>
        }
      >
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">
          A code works only while it is on, after its start and before its end. The checkout charges the discounted price; switching a code off stops it at
          once. With "Show on the site" on, every visitor gets the promo pop-up while the code is live.
        </p>

        {editing && (
          <div className="mb-5 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">{editing === 'new' ? 'New coupon' : `Edit ${editing}`}</p>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close" className="w-8 h-8 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.08] inline-flex items-center justify-center cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-[11px] text-slate-400">Code</span>
                <input
                  className={`${input} mt-1 font-mono tracking-[0.12em] uppercase disabled:opacity-60`}
                  value={draft.code}
                  disabled={editing !== 'new'}
                  placeholder="E.G. MKXCMAS01"
                  onChange={e => setDraft({ ...draft, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24) })}
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">% off 3 months</span>
                <input className={`${input} mt-1`} inputMode="numeric" value={draft.monthlyPct} placeholder="0 to 90" onChange={e => setDraft({ ...draft, monthlyPct: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">% off Yearly</span>
                <input className={`${input} mt-1`} inputMode="numeric" value={draft.yearlyPct} placeholder="0 to 90" onChange={e => setDraft({ ...draft, yearlyPct: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">Starts (optional)</span>
                <input type="datetime-local" className={`${input} mt-1`} value={draft.startsAt} onChange={e => setDraft({ ...draft, startsAt: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">Ends (optional)</span>
                <input type="datetime-local" className={`${input} mt-1`} value={draft.endsAt} onChange={e => setDraft({ ...draft, endsAt: e.target.value })} />
              </label>
              <div className="flex items-end gap-5 pb-2">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <Switch on={draft.active} onChange={v => setDraft({ ...draft, active: v })} label="Coupon on" /> On
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <Switch on={draft.banner} onChange={v => setDraft({ ...draft, banner: v })} label="Show on the site" /> Show on the site
                </label>
              </div>
            </div>
            {draft.banner && (
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] text-slate-400">Pop-up title</span>
                  <input className={`${input} mt-1`} maxLength={80} value={draft.title} placeholder="The MarketX Christmas Promo is live" onChange={e => setDraft({ ...draft, title: e.target.value })} />
                </label>
                <label className="block">
                  <span className="text-[11px] text-slate-400">Pop-up text</span>
                  <input className={`${input} mt-1`} maxLength={220} value={draft.text} placeholder="A short, catchy line" onChange={e => setDraft({ ...draft, text: e.target.value })} />
                </label>
              </div>
            )}
            {formError && <p className="text-xs text-rose-300">{formError}</p>}
            <div className="flex justify-end">
              <button
                type="button"
                disabled={saving || (editing === 'new' && draft.code.length < 3)}
                onClick={save}
                className="h-10 px-5 rounded-xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 disabled:opacity-40 inline-flex items-center gap-2 cursor-pointer"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />} {editing === 'new' ? 'Create coupon' : 'Save changes'}
              </button>
            </div>
          </div>
        )}

        {loading && !data ? (
          <Spinner />
        ) : error ? (
          <ErrorNote message={error} onRetry={reload} />
        ) : !coupons.length ? (
          <Empty>No coupons yet. Create one to offer a discount on Pro.</Empty>
        ) : (
          <div className="space-y-2.5">
            {coupons.map(c => {
              const badge = STATE_BADGE[c.state];
              return (
                <div key={c.code} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold tracking-[0.14em] text-white">{c.code}</span>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      {c.banner && <Badge tone="violet">Pop-up on site</Badge>}
                    </div>
                    <p className="mt-1.5 text-xs text-slate-300">
                      {[c.monthlyPct > 0 && `${c.monthlyPct}% off 3 months`, c.yearlyPct > 0 && `${c.yearlyPct}% off Yearly`].filter(Boolean).join(' · ')}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {c.startsAt ? `From ${fmtDateTime(c.startsAt)}` : 'From now'} · {c.endsAt ? `until ${fmtDateTime(c.endsAt)}` : 'no end date'} · used{' '}
                      {fmtNum(c.uses?.monthly || 0)} monthly, {fmtNum(c.uses?.yearly || 0)} yearly
                    </p>
                    {c.mailAt && (
                      <p className="mt-1 text-[11px] text-slate-500 inline-flex items-center gap-1">
                        <Mail className="w-3 h-3" />
                        {c.mail?.state === 'SENT'
                          ? `Announcement emailed to ${fmtNum(c.mail.sent)} traders on ${fmtDateTime(c.mail.doneAt)}`
                          : c.mail?.state === 'SENDING'
                            ? `Announcement sending (${fmtNum(c.mail.sent)} so far)`
                            : `Announcement email to every trader on ${fmtDateTime(c.mailAt)}`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch on={c.active} disabled={busyCode === c.code} onChange={v => toggle(c, v)} label={`${c.code} on or off`} />
                    <button type="button" onClick={() => openEdit(c)} aria-label={`Edit ${c.code}`} className="w-9 h-9 rounded-xl text-slate-400 hover:text-white hover:bg-white/[0.08] inline-flex items-center justify-center cursor-pointer">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => setToDelete(c)} aria-label={`Delete ${c.code}`} className="w-9 h-9 rounded-xl text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 inline-flex items-center justify-center cursor-pointer">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!toDelete}
        title={`Delete ${toDelete?.code || ''}?`}
        body="The code stops working at once and is removed. Payments already made with it are not affected."
        confirmLabel="Delete coupon"
        danger
        busy={busyCode === toDelete?.code}
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
};
