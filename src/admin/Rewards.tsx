import React, { useState } from 'react';
import { Check, ExternalLink, Gift, ImagePlus, Loader2, Pencil, Plus, Trash2, Video, X } from 'lucide-react';
import { prepareImages } from './Broadcast';
import { apiFetch } from '../utils/apiClient';
import { Badge, Card, ConfirmDialog, Empty, ErrorNote, Spinner, fmtDateTime, fmtNum, useAdminData } from './ui';

// Reward programs (owner-specified): programs shown as cards in the Rewards tab of every trader's notification center.
// Info only (text + links), or traders submit proof that is approved here for credits.

type State = 'LIVE' | 'OFF' | 'SCHEDULED' | 'ENDED';
interface Program {
  id: string;
  title: string;
  body: string;
  links: Array<{ label: string; url: string }>;
  button: { label: string; url: string } | null;
  image: string | null;
  video: { url: string; youtubeId: string | null } | null;
  mode: 'INFO' | 'SUBMIT';
  reward: number;
  askFor: string;
  maxRewards: number;
  rewarded: number;
  active: boolean;
  startsAt: number | null;
  endsAt: number | null;
  state: State;
  pending: number;
  createdAt: number;
}
interface Submission {
  id: string;
  username: string;
  email: string;
  link: string;
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  attempts: number;
  submittedAt: number;
  reviewNote?: string | null;
  creditsAwarded?: number;
}
const BADGE: Record<State, { tone: 'green' | 'amber' | 'violet' | 'gray'; label: string }> = {
  LIVE: { tone: 'green', label: 'Live' },
  SCHEDULED: { tone: 'violet', label: 'Scheduled' },
  ENDED: { tone: 'gray', label: 'Ended' },
  OFF: { tone: 'amber', label: 'Off' },
};
const toLocal = (t: number | null) => {
  if (!t) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => (v ? new Date(v).getTime() : null);
const field = 'h-10 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] px-3 text-sm text-white outline-none focus:border-indigo-400/50 placeholder:text-slate-600';
const safeHref = (u: string) => (/^https:\/\//i.test(u) ? u : undefined);

interface Draft {
  title: string;
  body: string;
  links: Array<{ label: string; url: string }>;
  buttonLabel: string;
  buttonUrl: string;
  /** The saved picture's address, a new upload (data URL), or null */
  image: string | null;
  video: string;
  mode: 'INFO' | 'SUBMIT';
  reward: string;
  askFor: string;
  maxRewards: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
}
const EMPTY: Draft = { title: '', body: '', links: [], buttonLabel: '', buttonUrl: '', image: null, video: '', mode: 'INFO', reward: '0', askFor: '', maxRewards: '0', startsAt: '', endsAt: '', active: true };
const draftOf = (p: Program): Draft => ({
  title: p.title,
  body: p.body,
  links: p.links.map(l => ({ ...l })),
  buttonLabel: p.button?.label || '',
  buttonUrl: p.button?.url || '',
  image: p.image || null,
  video: p.video?.url || '',
  mode: p.mode,
  reward: String(p.reward || 0),
  askFor: p.askFor || '',
  maxRewards: String(p.maxRewards || 0),
  startsAt: toLocal(p.startsAt),
  endsAt: toLocal(p.endsAt),
  active: p.active,
});

const Entries: React.FC<{ program: Program; onChanged: () => void }> = ({ program, onChanged }) => {
  const { data, error, loading, reload } = useAdminData(() => apiFetch<{ submissions: Submission[] }>(`/api/admin/reward-programs/${program.id}/submissions`), [program.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<Submission | null>(null);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (s: Submission, action: 'approve' | 'reject') => {
    setBusy(s.id);
    setMsg(null);
    try {
      await apiFetch(`/api/admin/reward-submissions/${encodeURIComponent(s.id)}/${action}`, { method: 'POST', body: JSON.stringify(action === 'reject' ? { reason } : {}) });
      setDeclining(null);
      setReason('');
      reload();
      onChanged();
    } catch (e: any) {
      setMsg(e?.message || 'Could not save.');
    } finally {
      setBusy(null);
    }
  };
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  const list = data?.submissions || [];
  return (
    <div className="mt-3 space-y-2">
      {msg && <p className="text-xs text-rose-300">{msg}</p>}
      {!list.length ? (
        <Empty>No entries yet.</Empty>
      ) : (
        list.map(s => (
          <div key={s.id} className="rounded-xl border border-white/[0.06] p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-white font-medium">@{s.username}</span>
              <span className="text-xs text-slate-500">{s.email}</span>
              <Badge tone={s.status === 'approved' ? 'green' : s.status === 'rejected' ? 'red' : 'amber'}>{s.status}</Badge>
              <span className="ml-auto text-[11px] text-slate-500">
                {fmtDateTime(s.submittedAt)}
                {s.attempts > 1 ? ` · try ${s.attempts}` : ''}
              </span>
            </div>
            <a href={safeHref(s.link)} target="_blank" rel="noopener noreferrer nofollow" className="mt-1 text-xs text-cyan-300 break-all inline-flex items-center gap-1">
              {s.link} <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
            {s.note && <p className="mt-1 text-xs text-slate-300 whitespace-pre-line">{s.note}</p>}
            {s.status === 'rejected' && s.reviewNote && <p className="mt-1 text-[11px] text-rose-300">Declined: {s.reviewNote}</p>}
            {s.status === 'pending' && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={busy === s.id} onClick={() => act(s, 'approve')} className="h-8 px-3 rounded-full bg-emerald-500/20 text-emerald-200 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer">
                  {busy === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve{program.reward ? ` (+${program.reward})` : ''}
                </button>
                <button type="button" disabled={busy === s.id} onClick={() => (setDeclining(s), setReason(''))} className="h-8 px-3 rounded-full bg-rose-500/15 text-rose-200 text-xs font-semibold inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer">
                  <X className="w-3.5 h-3.5" /> Decline
                </button>
              </div>
            )}
          </div>
        ))
      )}
      <ConfirmDialog
        open={!!declining}
        title={`Decline @${declining?.username || ''}?`}
        body="Tell them why. They can send new proof while the program is open."
        confirmLabel="Decline"
        danger
        busy={busy === declining?.id}
        onConfirm={() => declining && act(declining, 'reject')}
        onCancel={() => setDeclining(null)}
      >
        <textarea value={reason} onChange={e => setReason(e.target.value.slice(0, 300))} rows={3} placeholder="Reason" className="mt-3 w-full rounded-xl bg-white/[0.04] border border-white/[0.08] p-3 text-sm text-white" />
      </ConfirmDialog>
    </div>
  );
};

export const RewardsSection: React.FC = () => {
  const { data, error, loading, reload } = useAdminData(() => apiFetch<{ programs: Program[] }>('/api/admin/reward-programs'));
  const [editing, setEditing] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [entriesOf, setEntriesOf] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Program | null>(null);

  const save = async () => {
    setSaving(true);
    setFormError(null);
    const body = {
      title: draft.title,
      body: draft.body,
      links: draft.links.filter(l => l.url.trim() || l.label.trim()),
      button: draft.buttonUrl.trim() ? { label: draft.buttonLabel, url: draft.buttonUrl.trim() } : null,
      image: draft.image,
      video: draft.video.trim() || null,
      mode: draft.mode,
      reward: Number(draft.reward) || 0,
      askFor: draft.askFor,
      maxRewards: Number(draft.maxRewards) || 0,
      startsAt: fromLocal(draft.startsAt),
      endsAt: fromLocal(draft.endsAt),
      active: draft.active,
    };
    try {
      if (editing === 'new') await apiFetch('/api/admin/reward-programs', { method: 'POST', body: JSON.stringify(body) });
      else await apiFetch(`/api/admin/reward-programs/${encodeURIComponent(String(editing))}`, { method: 'PATCH', body: JSON.stringify(body) });
      setEditing(null);
      reload();
    } catch (e: any) {
      setFormError(e?.message || 'Could not save the program.');
    } finally {
      setSaving(false);
    }
  };
  const toggle = async (p: Program) => {
    await apiFetch(`/api/admin/reward-programs/${p.id}`, { method: 'PATCH', body: JSON.stringify({ active: !p.active }) }).catch(() => {});
    reload();
  };
  const remove = async () => {
    if (!toDelete) return;
    await apiFetch(`/api/admin/reward-programs/${toDelete.id}`, { method: 'DELETE' }).catch(() => {});
    setToDelete(null);
    reload();
  };
  const set = (patch: Partial<Draft>) => setDraft(d => ({ ...d, ...patch }));
  const [picBusy, setPicBusy] = useState(false);
  const pickPicture = async (file: File | undefined) => {
    if (!file) return;
    setPicBusy(true);
    setFormError(null);
    try {
      set({ image: (await prepareImages(file)).display });
    } catch (e: any) {
      setFormError(e?.message || 'That picture could not be used.');
    } finally {
      setPicBusy(false);
    }
  };
  const ytId = (() => {
    const m = /(?:youtu\.be\/|[?&]v=|\/(?:shorts|live|embed)\/)([A-Za-z0-9_-]{11})/.exec(draft.video);
    return m ? m[1] : null;
  })();

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  const programs = data?.programs || [];

  return (
    <div className="space-y-4">
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <Gift className="w-4 h-4 text-cyan-300" /> Reward programs
          </span>
        }
        action={
          editing === null && (
            <button type="button" onClick={() => (setDraft(EMPTY), setFormError(null), setEditing('new'))} className="h-8 px-3 rounded-full bg-white text-slate-950 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer">
              <Plus className="w-3.5 h-3.5" /> New program
            </button>
          )
        }
      >
        <p className="text-xs text-slate-500">
          Programs show as cards in the Rewards tab of every trader's notifications while they are live. Choose Info only (text and links), or Entries with
          proof: traders send a link and a note, you approve them here (credits are added) or decline with a reason. One reward per person.
        </p>

        {editing !== null && (
          <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-white">{editing === 'new' ? 'New program' : 'Edit program'}</p>
              <button type="button" onClick={() => setEditing(null)} aria-label="Close" className="text-slate-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <label className="text-xs text-slate-400 space-y-1 block">
              <span>Title</span>
              <input value={draft.title} onChange={e => set({ title: e.target.value.slice(0, 80) })} placeholder="e.g. Trade of the week" className={field} />
            </label>
            <label className="text-xs text-slate-400 space-y-1 block">
              <span>Text</span>
              <textarea value={draft.body} onChange={e => set({ body: e.target.value.slice(0, 1500) })} rows={4} placeholder="What it is and how to take part" className="w-full rounded-xl bg-white/[0.04] border border-white/[0.08] p-3 text-sm text-white" />
            </label>
            <div className="space-y-2">
              <span className="text-xs text-slate-400">Links (up to 5, https only)</span>
              {draft.links.map((l, i) => (
                <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                  <input value={l.label} onChange={e => set({ links: draft.links.map((x, j) => (j === i ? { ...x, label: e.target.value.slice(0, 40) } : x)) })} placeholder="Label" className={field} />
                  <input value={l.url} onChange={e => set({ links: draft.links.map((x, j) => (j === i ? { ...x, url: e.target.value.slice(0, 500) } : x)) })} placeholder="https://" className={field} />
                  <button type="button" onClick={() => set({ links: draft.links.filter((_, j) => j !== i) })} aria-label="Remove link" className="w-10 h-10 rounded-xl text-slate-400 hover:text-rose-300 cursor-pointer inline-flex items-center justify-center">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {draft.links.length < 5 && (
                <button type="button" onClick={() => set({ links: [...draft.links, { label: '', url: '' }] })} className="text-xs text-slate-400 hover:text-white cursor-pointer">
                  + Add a link
                </button>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-xs text-slate-400">Picture (optional)</span>
                {draft.image ? (
                  <div className="relative">
                    <img src={draft.image} alt="" className="w-full max-h-40 object-cover rounded-xl border border-white/[0.08]" />
                    <button type="button" onClick={() => set({ image: null })} aria-label="Remove picture" className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/70 text-white inline-flex items-center justify-center cursor-pointer">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <label className="h-24 rounded-xl border border-dashed border-white/[0.15] text-xs text-slate-400 flex flex-col items-center justify-center gap-1 cursor-pointer hover:bg-white/[0.03]">
                    {picBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
                    {picBusy ? 'Preparing…' : 'Add a picture (JPG, PNG, GIF, WebP)'}
                    <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={e => (pickPicture(e.target.files?.[0]), (e.target.value = ''))} />
                  </label>
                )}
              </div>
              <label className="text-xs text-slate-400 space-y-1 block">
                <span className="inline-flex items-center gap-1">
                  <Video className="w-3.5 h-3.5" /> Video link (optional)
                </span>
                <input value={draft.video} onChange={e => set({ video: e.target.value.slice(0, 500) })} placeholder="https://youtube.com/watch?v=…" className={field} />
                <span className="block text-[11px] text-slate-500">
                  {ytId
                    ? 'YouTube: the card shows its thumbnail with a play button.'
                    : draft.video.trim()
                      ? 'Not YouTube: the card shows your picture (or a Watch video tile) with a play button.'
                      : 'YouTube links show the video thumbnail; other links show a Watch video tile. Tapping opens the video.'}
                </span>
                {ytId && <img src={`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`} alt="" className="mt-1 w-full max-h-32 object-cover rounded-xl border border-white/[0.08]" />}
              </label>
            </div>
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <label className="text-xs text-slate-400 space-y-1">
                <span>Button text (optional)</span>
                <input value={draft.buttonLabel} onChange={e => set({ buttonLabel: e.target.value.slice(0, 30) })} placeholder="Join now" className={field} />
              </label>
              <label className="text-xs text-slate-400 space-y-1">
                <span>Button link</span>
                <input value={draft.buttonUrl} onChange={e => set({ buttonUrl: e.target.value.slice(0, 500) })} placeholder="https://" className={field} />
              </label>
            </div>
            <div className="flex gap-2">
              {(['INFO', 'SUBMIT'] as const).map(m => (
                <button key={m} type="button" onClick={() => set({ mode: m })} className={`h-9 px-3.5 rounded-full text-xs font-semibold cursor-pointer ${draft.mode === m ? 'bg-white text-slate-950' : 'bg-white/[0.06] text-slate-300'}`}>
                  {m === 'INFO' ? 'Info only' : 'Entries with proof'}
                </button>
              ))}
            </div>
            {draft.mode === 'SUBMIT' && (
              <div className="grid sm:grid-cols-3 gap-2">
                <label className="text-xs text-slate-400 space-y-1">
                  <span>Credits per approved entry</span>
                  <input value={draft.reward} inputMode="numeric" onChange={e => set({ reward: e.target.value.replace(/\D/g, '').slice(0, 4) })} className={field} />
                </label>
                <label className="text-xs text-slate-400 space-y-1">
                  <span>Most people rewarded (0 = no limit)</span>
                  <input value={draft.maxRewards} inputMode="numeric" onChange={e => set({ maxRewards: e.target.value.replace(/\D/g, '').slice(0, 7) })} className={field} />
                </label>
                <label className="text-xs text-slate-400 space-y-1 sm:col-span-3">
                  <span>What should they send as proof?</span>
                  <input value={draft.askFor} onChange={e => set({ askFor: e.target.value.slice(0, 200) })} placeholder="e.g. the link to your post on X tagging @_MarketX" className={field} />
                </label>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="text-xs text-slate-400 space-y-1">
                <span>Starts (optional)</span>
                <input type="datetime-local" value={draft.startsAt} onChange={e => set({ startsAt: e.target.value })} className={field} />
              </label>
              <label className="text-xs text-slate-400 space-y-1">
                <span>Ends (optional)</span>
                <input type="datetime-local" value={draft.endsAt} onChange={e => set({ endsAt: e.target.value })} className={field} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={draft.active} onChange={e => set({ active: e.target.checked })} /> On (shows while live)
            </label>
            {formError && <p className="text-xs text-rose-300">{formError}</p>}
            <button type="button" onClick={save} disabled={saving || !draft.title.trim()} className="h-9 px-4 rounded-full bg-white text-slate-950 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} {editing === 'new' ? 'Create program' : 'Save changes'}
            </button>
          </div>
        )}
      </Card>

      {!programs.length ? (
        <Empty>No programs yet.</Empty>
      ) : (
        programs.map(p => (
          <Card key={p.id}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold text-white">{p.title}</span>
              <Badge tone={BADGE[p.state].tone}>{BADGE[p.state].label}</Badge>
              <Badge tone="violet">{p.mode === 'INFO' ? 'Info only' : `Entries · +${p.reward} credits`}</Badge>
              {p.pending > 0 && <Badge tone="amber">{p.pending} waiting</Badge>}
              <span className="ml-auto flex items-center gap-1.5">
                <button type="button" onClick={() => toggle(p)} className="h-7 px-3 rounded-full bg-white/[0.06] text-xs text-slate-200 hover:bg-white/[0.12] cursor-pointer">
                  {p.active ? 'Turn off' : 'Turn on'}
                </button>
                <button type="button" onClick={() => (setDraft(draftOf(p)), setFormError(null), setEditing(p.id), window.scrollTo({ top: 0, behavior: 'smooth' }))} aria-label="Edit" className="w-7 h-7 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] inline-flex items-center justify-center cursor-pointer">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => setToDelete(p)} aria-label="Delete" className="w-7 h-7 rounded-full text-slate-400 hover:text-rose-300 hover:bg-white/[0.06] inline-flex items-center justify-center cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </span>
            </div>
            {p.body && <p className="mt-2 text-xs text-slate-400 whitespace-pre-line line-clamp-3">{p.body}</p>}
            <p className="mt-2 text-[11px] text-slate-500">
              {p.links.length} link{p.links.length === 1 ? '' : 's'}
              {p.button ? ' · button' : ''}
              {p.image ? ' · picture' : ''}
              {p.video ? ` · video${p.video.youtubeId ? ' (YouTube)' : ''}` : ''}
              {p.mode === 'SUBMIT' ? ` · rewarded ${fmtNum(p.rewarded)}${p.maxRewards ? ` of ${fmtNum(p.maxRewards)}` : ''}` : ''}
              {p.startsAt ? ` · starts ${fmtDateTime(p.startsAt)}` : ''}
              {p.endsAt ? ` · ends ${fmtDateTime(p.endsAt)}` : ''}
            </p>
            {p.mode === 'SUBMIT' && (
              <button type="button" onClick={() => setEntriesOf(entriesOf === p.id ? null : p.id)} className="mt-2 text-xs font-semibold text-cyan-300 cursor-pointer">
                {entriesOf === p.id ? 'Hide entries' : 'Review entries'}
              </button>
            )}
            {entriesOf === p.id && <Entries program={p} onChanged={reload} />}
          </Card>
        ))
      )}

      <ConfirmDialog
        open={!!toDelete}
        title={`Delete ${toDelete?.title || ''}?`}
        body="The card disappears from the Rewards tab. Entries and credits already given stay on record."
        confirmLabel="Delete program"
        danger
        onConfirm={remove}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
};
