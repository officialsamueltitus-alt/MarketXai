import React, { useEffect, useState } from 'react';
import { Megaphone, Send, Users, User, Flag, X, Info, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { AnnouncementBody } from '../components/AnnouncementModal';
import { Badge, Card, ConfirmDialog, Empty, fmtDateTime, useAdminData } from './ui';

type Mode = 'banner' | 'general' | 'individual';

const MODES: Array<{ value: Mode; label: string; short: string; icon: React.ElementType }> = [
  { value: 'banner', label: 'Banner notice', short: 'Banner', icon: Flag },
  { value: 'general', label: 'General notice', short: 'Everyone', icon: Users },
  { value: 'individual', label: 'Individual notice', short: 'One user', icon: User },
];
type Tone = 'info' | 'success' | 'warning';

const TONE_STYLE: Record<Tone, { cls: string; icon: React.ElementType }> = {
  info: { cls: 'bg-indigo-500/12 border-indigo-400/25 text-indigo-100', icon: Info },
  success: { cls: 'bg-emerald-500/12 border-emerald-400/25 text-emerald-100', icon: CheckCircle2 },
  warning: { cls: 'bg-amber-500/12 border-amber-400/25 text-amber-100', icon: AlertTriangle },
};

export const BannerPreview: React.FC<{ title: string; message: string; tone: Tone }> = ({ title, message, tone }) => {
  const { cls, icon: Icon } = TONE_STYLE[tone];
  return (
    <div className={`flex items-start gap-2.5 rounded-2xl border px-3.5 py-2.5 text-sm ${cls}`}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">
        <span className="font-semibold">{title || 'Banner title'}</span>
        {message && <span className="opacity-80"> · {message}</span>}
      </span>
    </div>
  );
};

export const BroadcastSection: React.FC<{ initialTarget?: string | null }> = ({ initialTarget }) => {
  const [mode, setMode] = useState<Mode>(initialTarget ? 'individual' : 'general');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState(initialTarget || '');
  const [tone, setTone] = useState<Tone>('info');
  const [duration, setDuration] = useState('24');
  const [link, setLink] = useState('');
  const [email, setEmail] = useState(true);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const history = useAdminData<any>(() => apiFetch('/api/admin/broadcasts'));

  useEffect(() => {
    if (initialTarget) {
      setMode('individual');
      setTarget(initialTarget);
    }
  }, [initialTarget]);

  const linkOk = !link.trim() || /^https:\/\/[^\s<>"']+$/i.test(link.trim());
  const valid = title.trim() && message.trim() && (mode !== 'individual' || target.trim()) && linkOk;

  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await apiFetch<any>('/api/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify({ mode, title, message, target, tone, durationHours: Number(duration) || 0, link, email }),
      });
      setResult({
        ok: true,
        text:
          mode === 'banner'
            ? 'Banner is live on the site.'
            : `Sent to ${r.recipients} user${r.recipients === 1 ? '' : 's'}${r.emailsQueued ? `; ${r.emailsQueued} email${r.emailsQueued === 1 ? '' : 's'} on the way` : ''}.`,
      });
      setTitle('');
      setMessage('');
      setLink('');
      history.reload();
    } catch (e: any) {
      setResult({ ok: false, text: e?.message || 'Could not send.' });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const clearBanner = async () => {
    await apiFetch('/api/admin/banner', { method: 'DELETE' }).catch(() => {});
    history.reload();
  };

  const inputCls =
    'w-full rounded-xl bg-white/[0.03] border border-white/[0.08] focus:border-white/25 focus:outline-none px-3.5 text-sm text-white placeholder:text-slate-600';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 min-w-0">
      <Card title="Compose" className="lg:col-span-3">
        {/* Notice type: three tiles that fit any width */}
        <div role="radiogroup" aria-label="Notice type" className="grid grid-cols-3 gap-2">
          {MODES.map(({ value, label, short, icon: Icon }) => {
            const active = mode === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={label}
                onClick={() => {
                  setMode(value);
                  setResult(null);
                }}
                className={`min-w-0 rounded-2xl border px-2 py-2.5 sm:px-3 sm:py-3 flex flex-col sm:flex-row items-center sm:items-start gap-1.5 sm:gap-2.5 text-center sm:text-left transition-colors cursor-pointer ${
                  active ? 'border-indigo-400/40 bg-indigo-500/[0.1] text-white' : 'border-white/[0.07] bg-white/[0.02] text-slate-400 hover:text-white hover:bg-white/[0.04]'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 sm:mt-0.5 ${active ? 'text-indigo-300' : ''}`} />
                <span className="min-w-0 text-xs sm:text-[13px] font-medium leading-tight">
                  <span className="sm:hidden">{short}</span>
                  <span className="hidden sm:inline">{label}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-500 flex items-start gap-1.5 leading-relaxed">
          {mode === 'banner' ? (
            <>
              <Flag className="w-3.5 h-3.5 mt-0.5 shrink-0" /> A slim banner shown across the site to every visitor until it expires or you remove it.
            </>
          ) : mode === 'general' ? (
            <>
              <Users className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Goes to every user's notification center{email ? ' and their email inbox' : ''}.
            </>
          ) : (
            <>
              <User className="w-3.5 h-3.5 mt-0.5 shrink-0" /> Goes to one user's notification center{email ? ' and their email inbox' : ''}.
            </>
          )}
        </p>

        <div className="mt-4 space-y-3">
          {mode === 'individual' && (
            <label className="block">
              <span className="text-xs text-slate-400">Recipient (username or email)</span>
              <input value={target} onChange={e => setTarget(e.target.value)} placeholder="@username or name@email.com" className={`${inputCls} mt-1.5 h-11`} />
            </label>
          )}
          <label className="block">
            <span className="text-xs text-slate-400">Title</span>
            <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder={mode === 'banner' ? 'Scheduled maintenance' : 'Subject of your message'} className={`${inputCls} mt-1.5 h-11`} />
          </label>
          <label className="block">
            <span className="flex justify-between text-xs text-slate-400">
              <span>Message</span>
              <span className="tabular-nums">{message.length}/{mode === 'banner' ? 280 : 3000}</span>
            </span>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              maxLength={mode === 'banner' ? 280 : 3000}
              rows={mode === 'banner' ? 3 : 7}
              placeholder={mode === 'banner' ? 'Keep it short: one or two sentences.' : 'Write your message. Leave a blank line between paragraphs.'}
              className={`${inputCls} mt-1.5 py-3 resize-y leading-relaxed`}
            />
          </label>

          {mode === 'banner' ? (
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs text-slate-400">Style</span>
                <select value={tone} onChange={e => setTone(e.target.value as Tone)} className={`${inputCls} mt-1.5 h-11 bg-[var(--mx-surface)]`}>
                  <option value="info">Info</option>
                  <option value="success">Success</option>
                  <option value="warning">Warning</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">Show for</span>
                <select value={duration} onChange={e => setDuration(e.target.value)} className={`${inputCls} mt-1.5 h-11 bg-[var(--mx-surface)]`}>
                  <option value="6">6 hours</option>
                  <option value="24">24 hours</option>
                  <option value="72">3 days</option>
                  <option value="168">7 days</option>
                  <option value="0">Until removed</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-slate-400">Link (optional)</span>
                <input value={link} onChange={e => setLink(e.target.value)} placeholder="https://" className={`${inputCls} mt-1.5 h-11`} />
              </label>
            </div>
          ) : (
            <>
            <label className="block">
              <span className="text-xs text-slate-400">Link (optional, https)</span>
              <input value={link} onChange={e => setLink(e.target.value)} placeholder="https://" className={`${inputCls} mt-1.5 h-11`} />
            </label>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input type="checkbox" className="sr-only peer" checked={email} onChange={e => setEmail(e.target.checked)} />
              <span
                aria-hidden="true"
                className="relative w-9 h-5 rounded-full bg-white/[0.12] peer-checked:bg-indigo-500 transition-colors after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400"
              />
              <span className="text-sm text-slate-300">Also send by email</span>
            </label>
            </>
          )}

          {mode === 'banner' && (
            <div>
              <span className="text-xs text-slate-400">Preview</span>
              <div className="mt-1.5">
                <BannerPreview title={title} message={message} tone={tone} />
              </div>
            </div>
          )}

          {mode !== 'banner' && (title || message) && (
            <div>
              <span className="text-xs text-slate-400">How users will see it</span>
              <div className="mt-1.5 rounded-2xl border border-indigo-400/25 bg-gradient-to-br from-indigo-500/[0.12] to-transparent p-3.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-200">MarketX Team · Announcement</span>
                <p className="mt-1.5 text-sm font-semibold text-white break-words">{title || 'Title'}</p>
                <div className="mt-1 text-xs text-slate-300 leading-relaxed">
                  <AnnouncementBody message={message || 'Your message'} />
                </div>
              </div>
            </div>
          )}
          {link.trim() && !linkOk && <p className="text-xs text-rose-300">Links must start with https://</p>}

          {result && (
            <p className={`text-xs rounded-xl p-2.5 border ${result.ok ? 'text-emerald-200 bg-emerald-500/10 border-emerald-500/20' : 'text-rose-200 bg-rose-500/10 border-rose-500/20'}`}>
              {result.text}
            </p>
          )}

          <button
            type="button"
            disabled={!valid || busy}
            onClick={() => setConfirm(true)}
            className="w-full h-12 rounded-2xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'banner' ? <Megaphone className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            {mode === 'banner' ? 'Publish banner' : mode === 'general' ? 'Send to all users' : 'Send to user'}
          </button>
        </div>
      </Card>

      <div className="lg:col-span-2 space-y-4 min-w-0">
        <Card title="Live banner">
          {history.data?.banner ? (
            <div className="space-y-3">
              <BannerPreview title={history.data.banner.title} message={history.data.banner.message} tone={history.data.banner.tone} />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>{history.data.banner.expiresAt ? `Until ${fmtDateTime(history.data.banner.expiresAt)}` : 'Until removed'}</span>
                <button type="button" onClick={clearBanner} className="inline-flex items-center gap-1 text-rose-300 hover:text-rose-200 cursor-pointer">
                  <X className="w-3.5 h-3.5" /> Remove
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No banner is showing.</p>
          )}
        </Card>
        <Card title="Recent broadcasts">
          {history.data?.broadcasts?.length ? (
            <ul className="space-y-2">
              {history.data.broadcasts.map((b: any) => (
                <li key={b.id} className="min-w-0 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-sm font-medium text-slate-100 leading-snug break-words">{b.title}</span>
                    <Badge tone={b.mode === 'banner' ? 'amber' : b.mode === 'general' ? 'violet' : 'gray'}>
                      {b.mode === 'banner' ? 'Banner' : b.mode === 'general' ? 'Everyone' : 'One user'}
                    </Badge>
                  </div>
                  {b.message && <p className="mt-1 text-xs text-slate-400 leading-relaxed line-clamp-2 break-words">{b.message}</p>}
                  <div className="mt-1.5 text-[11px] text-slate-500 break-all">
                    {fmtDateTime(b.sentAt)} · {b.mode === 'banner' ? 'site banner' : b.mode === 'general' ? `${b.recipients} users` : b.target}
                    {b.mode !== 'banner' && (b.email ? ' · email' : ' · in-app only')}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing sent yet.</Empty>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirm}
        title={mode === 'banner' ? 'Publish this banner?' : mode === 'general' ? 'Send to all users?' : 'Send this notice?'}
        body={
          mode === 'banner'
            ? 'It replaces any banner currently showing and appears for every visitor.'
            : mode === 'general'
              ? `Every user gets it in their notification center${email ? ' and by email (sent gradually to protect your Gmail sending limit)' : ''}.`
              : `"${target}" gets it in their notification center${email ? ' and by email' : ''}.`
        }
        confirmLabel={mode === 'banner' ? 'Publish' : 'Send now'}
        busy={busy}
        onConfirm={send}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
};
