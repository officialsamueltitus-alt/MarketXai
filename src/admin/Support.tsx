import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, Loader2, Mail, MessageCircle, Search, CheckCircle2, Circle, Archive } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { ErrorNote, Spinner, timeAgo, fmtDateTime } from './ui';

type Status = 'open' | 'answered' | 'closed';
interface Thread {
  uid: string;
  username?: string | null;
  displayName?: string | null;
  email?: string;
  status: Status;
  lastMessageAt: number;
  lastFrom: 'user' | 'admin';
  preview: string;
  unreadForAdmin: number;
  createdAt?: number;
}
interface Msg {
  id: string;
  from: 'user' | 'admin';
  text: string;
  ts: number;
}

const FILTERS: Array<{ id: 'all' | Status; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'answered', label: 'Answered' },
  { id: 'closed', label: 'Closed' },
];

const STATUS_STYLE: Record<Status, string> = {
  open: 'bg-amber-500/15 text-amber-300',
  answered: 'bg-emerald-500/15 text-emerald-300',
  closed: 'bg-white/[0.06] text-slate-400',
};

const initials = (t: Thread) => (t.displayName || t.username || t.email || '?').replace(/^@/, '').slice(0, 2).toUpperCase();
const nameOf = (t: Thread) => t.displayName || (t.username ? `@${t.username}` : t.email || 'User');

// ---------------------------------------------------------------------------
// Conversation pane
// ---------------------------------------------------------------------------
const Conversation: React.FC<{ uid: string; onBack: () => void; onChanged: () => void }> = ({ uid, onBack, onChanged }) => {
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [emailUser, setEmailUser] = useState(true);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(
    async (first = false) => {
      try {
        const d = await apiFetch<{ thread: Thread; messages: Msg[] }>(`/api/admin/support/threads/${encodeURIComponent(uid)}`);
        setThread(d.thread);
        setMessages(d.messages || []);
        setError(null);
        if (first) onChanged();
      } catch (err: any) {
        if (first) setError(err?.message || 'Could not load the conversation.');
      } finally {
        if (first) setLoading(false);
      }
    },
    [uid, onChanged]
  );

  useEffect(() => {
    setLoading(true);
    setNote(null);
    load(true);
    const id = setInterval(() => !document.hidden && load(), 10_000);
    return () => clearInterval(id);
  }, [load]);

  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  }, [reply]);

  const send = async () => {
    const text = reply.trim();
    if (!text || sending) return;
    setSending(true);
    setNote(null);
    try {
      const d = await apiFetch<{ message: Msg; emailed: boolean }>(`/api/admin/support/threads/${encodeURIComponent(uid)}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text, email: emailUser }),
      });
      setMessages(prev => [...prev, d.message]);
      setReply('');
      setThread(t => (t ? { ...t, status: 'answered' } : t));
      setNote(emailUser ? (d.emailed ? 'Sent · the user was notified on MarketX and by email.' : 'Sent · notified on MarketX (email could not be sent).') : 'Sent · the user was notified on MarketX.');
      onChanged();
    } catch (err: any) {
      setNote(err?.message || 'Reply not sent. Try again.');
    } finally {
      setSending(false);
    }
  };

  const setStatus = async (status: Status) => {
    try {
      await apiFetch(`/api/admin/support/threads/${encodeURIComponent(uid)}/status`, { method: 'POST', body: JSON.stringify({ status }) });
      setThread(t => (t ? { ...t, status } : t));
      onChanged();
    } catch {}
  };

  if (loading) return <Spinner label="Loading conversation" />;
  if (error || !thread) return <div className="p-4"><ErrorNote message={error || 'Not found'} onRetry={() => load(true)} /></div>;

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-white/[0.06]">
        <button type="button" onClick={onBack} aria-label="Back to conversations" className="lg:hidden w-9 h-9 -ml-1 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] inline-flex items-center justify-center cursor-pointer">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <span className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 text-[11px] font-semibold text-white flex items-center justify-center shrink-0">{initials(thread)}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white truncate">{nameOf(thread)}</div>
          <div className="text-xs text-slate-500 truncate">{thread.email}{thread.username ? ` · @${thread.username}` : ''}</div>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-full bg-white/[0.04] border border-white/[0.06] shrink-0" role="radiogroup" aria-label="Status">
          {(['open', 'answered', 'closed'] as Status[]).map(s => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={thread.status === s}
              onClick={() => setStatus(s)}
              title={s[0].toUpperCase() + s.slice(1)}
              className={`h-7 px-2 sm:px-2.5 rounded-full text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer ${
                thread.status === s ? 'bg-white text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              {s === 'open' ? <Circle className="w-3 h-3" /> : s === 'answered' ? <CheckCircle2 className="w-3 h-3" /> : <Archive className="w-3 h-3" />}
              <span className="hidden sm:inline capitalize">{s}</span>
            </button>
          ))}
        </div>
      </header>

      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-2">
        {messages.map(m => {
          const mine = m.from === 'admin';
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : ''}`}>
              <div className={`max-w-[82%] flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                <div
                  className={`px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                    mine ? 'rounded-2xl rounded-br-md bg-indigo-500 text-white' : 'rounded-2xl rounded-bl-md bg-white/[0.05] border border-white/[0.06] text-slate-200'
                  }`}
                >
                  {m.text}
                </div>
                <span className="mt-1 px-1 text-[10px] text-slate-500">
                  {mine ? 'You (MarketX)' : nameOf(thread)} · {fmtDateTime(m.ts)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="shrink-0 border-t border-white/[0.06] p-3">
        <div className="flex items-end gap-2 rounded-2xl bg-white/[0.04] border border-white/[0.08] focus-within:border-indigo-400/50 p-1.5 pl-3.5 transition-colors">
          <textarea
            ref={inputRef}
            value={reply}
            onChange={e => setReply(e.target.value.slice(0, 2000))}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder={`Reply to ${nameOf(thread)}…`}
            aria-label="Reply"
            className="flex-1 min-w-0 bg-transparent resize-none py-1.5 text-sm leading-6 text-white placeholder:text-slate-500 focus:outline-none max-h-[160px]"
          />
          <button
            type="button"
            onClick={send}
            disabled={!reply.trim() || sending}
            aria-label="Send reply"
            className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition active:scale-95 ${
              reply.trim() && !sending ? 'bg-white text-slate-950 hover:bg-slate-200 cursor-pointer' : 'bg-white/[0.06] text-slate-500 cursor-not-allowed'
            }`}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 px-1">
          <label className="inline-flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={emailUser} onChange={e => setEmailUser(e.target.checked)} className="accent-indigo-500" />
            <Mail className="w-3.5 h-3.5" /> Also email the user
          </label>
          <span className="text-[10px] text-slate-500 hidden sm:inline">Ctrl / ⌘ + Enter to send</span>
        </div>
        {note && <p className="mt-1.5 px-1 text-xs text-slate-400">{note}</p>}
      </footer>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------
export const SupportSection: React.FC = () => {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    try {
      const d = await apiFetch<{ threads: Thread[] }>('/api/admin/support/threads');
      setThreads(d.threads || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Could not load conversations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadThreads();
    const id = setInterval(() => !document.hidden && loadThreads(), 20_000);
    return () => clearInterval(id);
  }, [loadThreads]);

  const q = query.trim().toLowerCase();
  const visible = threads.filter(
    t =>
      (filter === 'all' || t.status === filter) &&
      (!q || [t.username, t.displayName, t.email, t.preview].some(v => String(v || '').toLowerCase().includes(q)))
  );
  const counts = (s: 'all' | Status) => (s === 'all' ? threads.length : threads.filter(t => t.status === s).length);

  if (loading) return <Spinner label="Loading conversations" />;
  if (error) return <ErrorNote message={error} onRetry={loadThreads} />;

  return (
    <div className="rounded-3xl border border-white/[0.06] bg-[var(--mx-surface)] overflow-hidden lg:grid lg:grid-cols-[340px_1fr] h-[calc(100dvh-190px)] min-h-[520px]">
      {/* Inbox list */}
      <aside className={`${selected ? 'hidden lg:flex' : 'flex'} flex-col min-h-0 h-full border-r border-white/[0.06]`}>
        <div className="shrink-0 p-3 space-y-2.5 border-b border-white/[0.06]">
          <label className="relative block">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search name, email or message"
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-white/[0.03] border border-white/[0.08] focus:border-white/25 focus:outline-none text-sm text-white placeholder:text-slate-500"
            />
          </label>
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {FILTERS.map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`h-8 px-3 rounded-full text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  filter === f.id ? 'bg-white text-slate-950' : 'bg-white/[0.04] text-slate-400 hover:text-white'
                }`}
              >
                {f.label} <span className="opacity-60 tabular-nums">{counts(f.id)}</span>
              </button>
            ))}
          </div>
        </div>
        <ul className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y divide-white/[0.04]">
          {visible.length === 0 && (
            <li className="p-8 text-center text-sm text-slate-500">
              <MessageCircle className="w-6 h-6 mx-auto mb-2 opacity-60" />
              {threads.length ? 'No conversations match.' : 'No support messages yet.'}
            </li>
          )}
          {visible.map(t => (
            <li key={t.uid}>
              <button
                type="button"
                onClick={() => setSelected(t.uid)}
                className={`w-full text-left px-3.5 py-3 flex items-start gap-3 transition-colors cursor-pointer ${
                  selected === t.uid ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'
                }`}
              >
                <span className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 text-[11px] font-semibold text-white flex items-center justify-center shrink-0">{initials(t)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`text-sm truncate ${t.unreadForAdmin ? 'font-semibold text-white' : 'text-slate-200'}`}>{nameOf(t)}</span>
                    <span className="ml-auto text-[11px] text-slate-500 shrink-0">{timeAgo(t.lastMessageAt)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    <span className={`text-xs truncate ${t.unreadForAdmin ? 'text-slate-300' : 'text-slate-500'}`}>
                      {t.lastFrom === 'admin' ? 'You: ' : ''}
                      {t.preview}
                    </span>
                    {t.unreadForAdmin > 0 ? (
                      <span className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-500 text-[10px] font-bold text-white inline-flex items-center justify-center shrink-0">{t.unreadForAdmin}</span>
                    ) : (
                      <span className={`ml-auto h-5 px-1.5 rounded-full text-[10px] font-medium inline-flex items-center capitalize shrink-0 ${STATUS_STYLE[t.status]}`}>{t.status}</span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Conversation */}
      <section className={`${selected ? 'flex' : 'hidden lg:flex'} flex-col min-h-0 h-full`}>
        {selected ? (
          <Conversation key={selected} uid={selected} onBack={() => setSelected(null)} onChanged={loadThreads} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-slate-500">
            <MessageCircle className="w-8 h-8 mb-3 opacity-60" />
            <p className="text-sm">Select a conversation to read and reply.</p>
          </div>
        )}
      </section>
    </div>
  );
};
