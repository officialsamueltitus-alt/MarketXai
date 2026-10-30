import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, ExternalLink, Gift, Loader2, Send, XCircle } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

// Reward programs the admin creates (server/rewardPrograms.ts), shown in the notification center's Rewards tab.
// INFO programs are a card with links; SUBMIT programs take proof (a link + a note) that the admin approves for credits.

interface ProgramView {
  id: string;
  title: string;
  body: string;
  links: Array<{ label: string; url: string }>;
  button: { label: string; url: string } | null;
  mode: 'INFO' | 'SUBMIT';
  reward: number;
  askFor: string;
  endsAt: number | null;
  full: boolean;
  mine: null | { link: string; note: string; status: 'pending' | 'approved' | 'rejected'; reviewNote: string | null; creditsAwarded: number; canResubmit: boolean };
}

const safeHref = (u: string) => (/^https:\/\//i.test(u) ? u : undefined);

const ProgramCard: React.FC<{ p: ProgramView; onChange: (p: ProgramView) => void }> = ({ p, onChange }) => {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const days = p.endsAt ? Math.max(0, Math.floor((p.endsAt - Date.now()) / 86400000)) : null;
  const mine = p.mine;
  const canSend = p.mode === 'SUBMIT' && !p.full && (!mine || mine.canResubmit);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await apiFetch<{ submission: ProgramView['mine'] }>(`/api/rewards/programs/${encodeURIComponent(p.id)}/submit`, {
        method: 'POST',
        body: JSON.stringify({ link: link.trim(), note: note.trim() }),
      });
      onChange({ ...p, mine: r.submission });
      setOpen(false);
      setLink('');
      setNote('');
    } catch (err: any) {
      setError(err?.message || 'Could not send your entry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative mt-3 overflow-hidden rounded-2xl border border-cyan-400/20 p-3.5">
      <span aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(120%_140%_at_0%_0%,rgba(34,211,238,0.18),transparent_60%),radial-gradient(120%_140%_at_100%_100%,rgba(139,92,246,0.18),transparent_60%)]" />
      <div className="relative flex items-center gap-2">
        <span className="h-5 px-2 rounded-full bg-white/[0.12] text-[10px] font-semibold uppercase tracking-wider text-white inline-flex items-center gap-1">
          <Gift className="w-3 h-3" /> Program
        </span>
        {days !== null && <span className="ml-auto text-[11px] text-slate-300 tabular-nums">{days > 0 ? `${days}d left` : 'Ends today'}</span>}
      </div>
      <div className="relative mt-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-white leading-snug">{p.title}</p>
          {p.body && <p className="mt-1 text-xs text-slate-300 leading-relaxed whitespace-pre-line break-words">{p.body}</p>}
        </div>
        {p.mode === 'SUBMIT' && p.reward > 0 && (
          <span className="shrink-0 h-10 px-2.5 rounded-xl bg-white/[0.1] text-white inline-flex flex-col items-center justify-center leading-none">
            <span className="text-sm font-bold tabular-nums">+{p.reward}</span>
            <span className="text-[9px] uppercase tracking-wider text-slate-300 mt-0.5">credits</span>
          </span>
        )}
      </div>

      {p.links.length > 0 && (
        <div className="relative mt-2.5 flex flex-wrap gap-1.5">
          {p.links.map(l => (
            <a key={l.url} href={safeHref(l.url)} target="_blank" rel="noopener noreferrer nofollow" className="h-7 px-2.5 rounded-full bg-white/[0.08] text-[11px] text-white hover:bg-white/[0.14] inline-flex items-center gap-1">
              {l.label} <ExternalLink className="w-3 h-3 text-slate-400" />
            </a>
          ))}
        </div>
      )}
      {p.button && (
        <a href={safeHref(p.button.url)} target="_blank" rel="noopener noreferrer nofollow" className="relative mt-3 inline-flex h-8 px-3.5 rounded-xl bg-white text-slate-950 text-xs font-semibold items-center gap-1.5">
          {p.button.label} <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}

      {p.mode === 'SUBMIT' && (
        <div className="relative mt-3">
          {p.askFor && <p className="text-[11px] text-slate-400">To enter: {p.askFor}</p>}
          {mine && (
            <p className={`mt-2 text-xs flex items-start gap-1.5 ${mine.status === 'approved' ? 'text-emerald-300' : mine.status === 'rejected' ? 'text-rose-300' : 'text-amber-200'}`}>
              {mine.status === 'approved' ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : mine.status === 'rejected' ? <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <Clock className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
              <span>
                {mine.status === 'approved'
                  ? mine.creditsAwarded > 0
                    ? `Approved: +${mine.creditsAwarded} credits added.`
                    : 'Approved. Thank you for taking part.'
                  : mine.status === 'rejected'
                    ? `Not approved${mine.reviewNote ? `: ${mine.reviewNote}` : '.'}`
                    : 'Sent. Waiting for review.'}
              </span>
            </p>
          )}
          {p.full && !mine && <p className="mt-2 text-xs text-slate-400">Every reward of this program has been given.</p>}
          {canSend && !open && (
            <button type="button" onClick={() => setOpen(true)} className="mt-2 h-8 px-3.5 rounded-xl bg-white/[0.1] text-white text-xs font-semibold hover:bg-white/[0.16] inline-flex items-center gap-1.5 cursor-pointer">
              <Send className="w-3.5 h-3.5" /> {mine ? 'Send new proof' : 'Enter'}
            </button>
          )}
          {canSend && open && (
            <form onSubmit={submit} className="mt-2 space-y-2">
              <input
                value={link}
                onChange={e => setLink(e.target.value.slice(0, 500))}
                placeholder="https:// link to your proof"
                inputMode="url"
                aria-label="Link to your proof"
                className="w-full h-9 px-3 rounded-xl bg-black/20 border border-white/[0.1] text-xs text-white placeholder:text-slate-500"
              />
              <textarea
                value={note}
                onChange={e => setNote(e.target.value.slice(0, 500))}
                placeholder="A short note (optional)"
                rows={2}
                aria-label="Note"
                className="w-full px-3 py-2 rounded-xl bg-black/20 border border-white/[0.1] text-xs text-white placeholder:text-slate-500 resize-none"
              />
              {error && <p className="text-[11px] text-rose-300">{error}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={busy || !link.trim()} className="h-8 px-3.5 rounded-xl bg-white text-slate-950 text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer">
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Send
                </button>
                <button type="button" onClick={() => setOpen(false)} className="h-8 px-3 rounded-xl text-xs text-slate-400 hover:text-white cursor-pointer">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};

/** The live programs (loads when the Rewards tab opens); reports whether any are showing */
export const RewardProgramCards: React.FC<{ onCount?: (n: number) => void }> = ({ onCount }) => {
  const [programs, setPrograms] = useState<ProgramView[]>([]);
  const load = useCallback(async () => {
    try {
      const r = await apiFetch<{ programs: ProgramView[] }>('/api/rewards/programs');
      setPrograms(r.programs || []);
      onCount?.((r.programs || []).length);
    } catch {
      setPrograms([]);
      onCount?.(0);
    }
  }, [onCount]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <>
      {programs.map(p => (
        <ProgramCard key={p.id} p={p} onChange={next => setPrograms(list => list.map(x => (x.id === next.id ? next : x)))} />
      ))}
    </>
  );
};
