import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, Loader2, X, CreditCard, Coins, LineChart, UserRound, Bug } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { MarketXIcon } from './MarketXIcon';

interface SupportMessage {
  id: string;
  from: 'user' | 'admin';
  text: string;
  ts: number;
  pending?: boolean;
  failed?: boolean;
}

interface SupportChatProps {
  isOpen: boolean;
  onClose: () => void;
  displayName?: string;
  /** Called after the conversation has been read (clears the unread badge) */
  onRead?: () => void;
}

const TOPICS: Array<{ label: string; icon: React.ElementType; text: string }> = [
  { label: 'Billing & Pro', icon: CreditCard, text: 'Hi, I have a question about my Pro plan / billing: ' },
  { label: 'Credits', icon: Coins, text: 'Hi, I have a question about my credits: ' },
  { label: 'An analysis', icon: LineChart, text: 'Hi, I have a question about an analysis: ' },
  { label: 'Account & login', icon: UserRound, text: 'Hi, I need help with my account: ' },
  { label: 'Report a bug', icon: Bug, text: 'Hi, I found a problem: ' },
];

const POLL_MS = 12_000;
const MAX_LEN = 2000;

const dayLabel = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
};
const timeLabel = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Modern in-app support chat. One conversation per account, answered by the MarketX team from the admin console. */
export const SupportChat: React.FC<SupportChatProps> = ({ isOpen, onClose, displayName, onRead }) => {
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  const load = useCallback(async (initial = false) => {
    try {
      const data = await apiFetch<{ messages: SupportMessage[] }>('/api/support');
      setMessages(prev => {
        const pending = prev.filter(m => m.pending || m.failed);
        return [...(data.messages || []), ...pending];
      });
      onReadRef.current?.();
      if (initial) setError(null);
    } catch (err: any) {
      if (initial) setError(err?.message || 'Could not load your conversation.');
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  // Load on open, then poll for replies while the window is open and the tab is visible
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    load(true);
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_MS);
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => {
      clearInterval(id);
      clearTimeout(t);
    };
  }, [isOpen, load]);

  // Escape closes (stable listener; reads the latest onClose from a ref)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // Keep the newest message in view
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, loading]);

  // Auto-grow the composer
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(140, el.scrollHeight)}px`;
  }, [text]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    const temp: SupportMessage = { id: `tmp-${Date.now()}`, from: 'user', text: body, ts: Date.now(), pending: true };
    setMessages(prev => [...prev, temp]);
    setText('');
    setSending(true);
    setError(null);
    try {
      const data = await apiFetch<{ message: SupportMessage }>('/api/support/messages', { method: 'POST', body: JSON.stringify({ text: body }) });
      setMessages(prev => prev.map(m => (m.id === temp.id ? data.message : m)));
    } catch (err: any) {
      setMessages(prev => prev.map(m => (m.id === temp.id ? { ...m, pending: false, failed: true } : m)));
      setError(err?.message || 'Message not sent. Check your connection and try again.');
      setText(body);
    } finally {
      setSending(false);
    }
  };

  if (!isOpen || typeof document === 'undefined') return null;

  const firstName = (displayName || '').trim().split(/\s+/)[0];
  let lastDay = '';

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Support chat">
      <button type="button" aria-label="Close support chat" onClick={onClose} className="absolute inset-0 bg-black/70 mx-fade-in cursor-default" />

      <section className="mx-pop-in relative w-full sm:max-w-[440px] h-[92dvh] sm:h-[680px] sm:max-h-[88dvh] flex flex-col rounded-t-[28px] sm:rounded-[28px] bg-[var(--mx-bg-2)] border border-white/[0.08] shadow-[0_30px_90px_-20px_rgba(0,0,0,0.85)] overflow-hidden">
        {/* Header */}
        <header className="shrink-0 flex items-center gap-3 px-4 sm:px-5 pt-4 pb-3.5 border-b border-white/[0.06]">
          <span className="relative w-10 h-10 rounded-2xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0">
            <MarketXIcon size="sm" />
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-[var(--mx-bg-2)]" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-white leading-tight">MarketX Support</h2>
            <p className="text-xs text-slate-400 mt-0.5">We usually reply within a few hours</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Conversation */}
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4 space-y-1.5" aria-live="polite">
          {loading ? (
            <div className="h-full flex items-center justify-center text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <>
              {/* Welcome */}
              <div className="flex items-end gap-2 mb-3">
                <span className="w-7 h-7 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0">
                  <MarketXIcon size="xs" />
                </span>
                <div className="max-w-[82%] rounded-2xl rounded-bl-md bg-white/[0.05] border border-white/[0.06] px-3.5 py-2.5 text-sm text-slate-200 leading-relaxed">
                  Hi{firstName ? ` ${firstName}` : ''} 👋 How can we help today? Send us a message and the MarketX team will get back to you here and by email.
                </div>
              </div>

              {messages.length === 0 && (
                <div className="pt-1 pb-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-2 px-0.5">Popular topics</p>
                  <div className="flex flex-wrap gap-1.5">
                    {TOPICS.map(({ label, icon: Icon, text: t }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => {
                          setText(t);
                          inputRef.current?.focus();
                        }}
                        className="h-8 px-3 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-xs text-slate-200 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Icon className="w-3.5 h-3.5 text-slate-400" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map(m => {
                const day = dayLabel(m.ts);
                const showDay = day !== lastDay;
                lastDay = day;
                const mine = m.from === 'user';
                return (
                  <React.Fragment key={m.id}>
                    {showDay && (
                      <div className="flex items-center gap-3 py-2 text-[11px] text-slate-500">
                        <span className="flex-1 h-px bg-white/[0.06]" />
                        {day}
                        <span className="flex-1 h-px bg-white/[0.06]" />
                      </div>
                    )}
                    <div className={`flex items-end gap-2 ${mine ? 'justify-end' : ''}`}>
                      {!mine && (
                        <span className="w-7 h-7 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center shrink-0">
                          <MarketXIcon size="xs" />
                        </span>
                      )}
                      <div className={`max-w-[80%] flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                        <div
                          className={`px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                            mine
                              ? 'rounded-2xl rounded-br-md bg-indigo-500 text-white'
                              : 'rounded-2xl rounded-bl-md bg-white/[0.05] border border-white/[0.06] text-slate-200'
                          } ${m.pending ? 'opacity-70' : ''} ${m.failed ? 'ring-1 ring-rose-400/70' : ''}`}
                        >
                          {m.text}
                        </div>
                        <span className="mt-1 px-1 text-[10px] text-slate-500 tabular-nums">
                          {m.failed ? 'Not sent' : m.pending ? 'Sending…' : `${mine ? '' : 'Support · '}${timeLabel(m.ts)}`}
                        </span>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </>
          )}
        </div>

        {/* Composer */}
        <footer className="shrink-0 border-t border-white/[0.06] px-3 sm:px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {error && <p className="px-1 pb-2 text-xs text-rose-300">{error}</p>}
          <form
            onSubmit={e => {
              e.preventDefault();
              send();
            }}
            className="flex items-end gap-2 rounded-[22px] bg-white/[0.04] border border-white/[0.08] focus-within:border-indigo-400/50 p-1.5 pl-3.5 transition-colors"
          >
            <textarea
              ref={inputRef}
              value={text}
              onChange={e => setText(e.target.value.slice(0, MAX_LEN))}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder="Write a message…"
              aria-label="Message"
              className="flex-1 min-w-0 bg-transparent resize-none py-2 text-[15px] leading-6 text-white placeholder:text-slate-500 focus:outline-none max-h-[140px]"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              aria-label="Send"
              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition active:scale-95 ${
                text.trim() && !sending ? 'bg-white text-slate-950 hover:bg-slate-200 cursor-pointer' : 'bg-white/[0.06] text-slate-500 cursor-not-allowed'
              }`}
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
            </button>
          </form>
          <p className="mt-2 text-center text-[10px] text-slate-500">
            {text.length > MAX_LEN - 200 ? `${MAX_LEN - text.length} characters left · ` : ''}Enter to send · Shift + Enter for a new line
          </p>
        </footer>
      </section>
    </div>,
    document.body
  );
};

export default SupportChat;
