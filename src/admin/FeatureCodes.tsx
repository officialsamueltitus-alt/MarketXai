import React, { useState } from 'react';
import { KeyRound, Loader2, Plus, Trash2, X } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { Badge, Card, ConfirmDialog, Empty, ErrorNote, Spinner, fmtDateTime, fmtNum, useAdminData } from './ui';

// Feature codes (owner-specified): a code that unlocks ONE Pro feature free for some days, and nothing else. Traders
// type it in the Plans window's coupon box (or open /?pricing=1&coupon=CODE). One use per person.

type State = 'LIVE' | 'OFF' | 'SCHEDULED' | 'EXPIRED' | 'USED_UP';
interface AdminCode {
  code: string;
  feature: string;
  label: string;
  days: number;
  maxUses: number;
  uses: number;
  active: boolean;
  startsAt: number | null;
  endsAt: number | null;
  note: string;
  state: State;
  createdAt: number;
}
const BADGE: Record<State, { tone: 'green' | 'amber' | 'violet' | 'gray'; label: string }> = {
  LIVE: { tone: 'green', label: 'Live' },
  SCHEDULED: { tone: 'violet', label: 'Scheduled' },
  EXPIRED: { tone: 'gray', label: 'Ended' },
  USED_UP: { tone: 'gray', label: 'Used up' },
  OFF: { tone: 'amber', label: 'Off' },
};
const fromLocal = (v: string) => (v ? new Date(v).getTime() : null);
const field = 'h-10 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] px-3 text-sm text-white outline-none focus:border-indigo-400/50 placeholder:text-slate-600';

export const FeatureCodesSection: React.FC = () => {
  const { data, error, loading, reload } = useAdminData(() => apiFetch<{ codes: AdminCode[]; features: Array<{ id: string; label: string }> }>('/api/admin/feature-codes'));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ code: '', feature: 'agent', days: '7', maxUses: '0', startsAt: '', endsAt: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<AdminCode | null>(null);

  const create = async () => {
    setSaving(true);
    setFormError(null);
    try {
      await apiFetch('/api/admin/feature-codes', {
        method: 'POST',
        body: JSON.stringify({
          code: draft.code,
          feature: draft.feature,
          days: Number(draft.days),
          maxUses: Number(draft.maxUses) || 0,
          startsAt: fromLocal(draft.startsAt),
          endsAt: fromLocal(draft.endsAt),
          note: draft.note,
          active: true,
        }),
      });
      setOpen(false);
      setDraft(d => ({ ...d, code: '', note: '' }));
      reload();
    } catch (e: any) {
      setFormError(e?.message || 'Could not create the code.');
    } finally {
      setSaving(false);
    }
  };
  const toggle = async (c: AdminCode) => {
    setBusy(c.code);
    try {
      await apiFetch(`/api/admin/feature-codes/${encodeURIComponent(c.code)}`, { method: 'PATCH', body: JSON.stringify({ active: !c.active }) });
      reload();
    } catch {
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!toDelete) return;
    try {
      await apiFetch(`/api/admin/feature-codes/${encodeURIComponent(toDelete.code)}`, { method: 'DELETE' });
    } catch {}
    setToDelete(null);
    reload();
  };

  return (
    <div className="mt-6">
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-violet-300" /> Feature codes
          </span>
        }
        action={
          !open && (
            <button type="button" onClick={() => setOpen(true)} className="h-8 px-3 rounded-full bg-white text-slate-950 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> New feature code
            </button>
          )
        }
      >
        <p className="text-xs text-slate-500 mb-3">
          A feature code unlocks one Pro feature free for the days you choose. It works for that feature only (not the rest of Pro). Traders type it in the coupon box of the Plans window. Each person can use a code once.
        </p>

        {open && (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 mb-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">New feature code</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs text-slate-400 space-y-1">
                <span>Code</span>
                <input value={draft.code} onChange={e => setDraft(d => ({ ...d, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24) }))} placeholder="AGENT7" className={`${field} font-mono tracking-wider`} />
              </label>
              <label className="text-xs text-slate-400 space-y-1">
                <span>Feature it unlocks</span>
                <select value={draft.feature} onChange={e => setDraft(d => ({ ...d, feature: e.target.value }))} className={field}>
                  {(data?.features || []).map(f => (
                    <option key={f.id} value={f.id} className="bg-slate-900">
                      {f.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-400 space-y-1">
                <span>Days free</span>
                <input value={draft.days} inputMode="numeric" onChange={e => setDraft(d => ({ ...d, days: e.target.value.replace(/\D/g, '').slice(0, 3) }))} className={field} />
              </label>
              <label className="text-xs text-slate-400 space-y-1">
                <span>Most people who can use it (0 = no limit)</span>
                <input value={draft.maxUses} inputMode="numeric" onChange={e => setDraft(d => ({ ...d, maxUses: e.target.value.replace(/\D/g, '').slice(0, 7) }))} className={field} />
              </label>
              <label className="text-xs text-slate-400 space-y-1">
                <span>Starts (optional)</span>
                <input type="datetime-local" value={draft.startsAt} onChange={e => setDraft(d => ({ ...d, startsAt: e.target.value }))} className={field} />
              </label>
              <label className="text-xs text-slate-400 space-y-1">
                <span>Ends (optional)</span>
                <input type="datetime-local" value={draft.endsAt} onChange={e => setDraft(d => ({ ...d, endsAt: e.target.value }))} className={field} />
              </label>
            </div>
            <label className="text-xs text-slate-400 space-y-1 block">
              <span>Your note (only you see it)</span>
              <input value={draft.note} onChange={e => setDraft(d => ({ ...d, note: e.target.value.slice(0, 120) }))} placeholder="e.g. for the YouTube giveaway" className={field} />
            </label>
            {formError && <p className="text-xs text-rose-300">{formError}</p>}
            <button type="button" onClick={create} disabled={saving || draft.code.length < 3 || !Number(draft.days)} className="h-9 px-4 rounded-full bg-white text-slate-950 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Create code
            </button>
          </div>
        )}

        {loading && !data ? (
          <Spinner />
        ) : error ? (
          <ErrorNote message={error} onRetry={reload} />
        ) : !data?.codes.length ? (
          <Empty>No feature codes yet.</Empty>
        ) : (
          <div className="space-y-2">
            {data.codes.map(c => (
              <div key={c.code} className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-2 first:border-0 first:pt-0">
                <span className="font-mono text-sm font-semibold tracking-wider text-white">{c.code}</span>
                <Badge tone={BADGE[c.state].tone}>{BADGE[c.state].label}</Badge>
                <span className="text-xs text-slate-300">
                  {c.label} · {c.days} day{c.days === 1 ? '' : 's'}
                </span>
                <span className="text-xs text-slate-500">
                  used {fmtNum(c.uses)}
                  {c.maxUses ? ` of ${fmtNum(c.maxUses)}` : ''}
                  {c.endsAt ? ` · ends ${fmtDateTime(c.endsAt)}` : ''}
                  {c.note ? ` · ${c.note}` : ''}
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  <button type="button" onClick={() => toggle(c)} disabled={busy === c.code} className="h-7 px-3 rounded-full bg-white/[0.06] text-xs text-slate-200 hover:bg-white/[0.12] disabled:opacity-50 cursor-pointer">
                    {c.active ? 'Turn off' : 'Turn on'}
                  </button>
                  <button type="button" onClick={() => setToDelete(c)} aria-label={`Delete ${c.code}`} className="w-7 h-7 rounded-full text-slate-400 hover:text-rose-300 hover:bg-white/[0.06] inline-flex items-center justify-center cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <ConfirmDialog
        open={!!toDelete}
        title={`Delete ${toDelete?.code || ''}?`}
        body="The code stops working at once. Features already unlocked with it stay unlocked until their days run out."
        confirmLabel="Delete code"
        danger
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
};
