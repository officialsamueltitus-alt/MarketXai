// Matt: MarketX's help assistant, on its own page (/matt), styled like Ask SI. Answers about MarketX, the trader's account,
// events and promos, and the markets. Private platform questions get "Not available" (and repeated ones pause Matt; decided
// by the server). The conversation stays on this device only, tagged with its trader (another account on the same device never sees it).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, BookOpen, Coins, Gift, Loader2, Lock, Plus, Sparkles, Square, UserRound } from 'lucide-react';
import { LazyMarkdown } from '../components/LazyMarkdown';
import { MattMark } from '../components/AskMattButton';
import { ModeSwitch } from '../components/ModeSwitch';
import { takeMattAsk } from '../utils/matt';
import { applyTheme, readThemePref } from '../utils/theme';

interface Msg {
  id: string;
  role: 'user' | 'matt';
  text: string;
  at: number;
  /** "Not available" replies are shown muted */
  private?: boolean;
  error?: boolean;
}
export const MATT_STORE = 'mx.matt.v1';
const MAX_KEEP = 40;
const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
/** The kept conversation, only when it belongs to `owner` (the signed-in trader); anything else is dropped */
const load = (owner: string): Msg[] => {
  try {
    const v = JSON.parse(localStorage.getItem(MATT_STORE) || 'null');
    if (!v || typeof v !== 'object' || Array.isArray(v) || v.owner !== owner || !Array.isArray(v.msgs)) {
      localStorage.removeItem(MATT_STORE);
      return [];
    }
    return v.msgs.filter((m: any) => m && (m.role === 'user' || m.role === 'matt') && typeof m.text === 'string').slice(-MAX_KEEP);
  } catch {
    return [];
  }
};
const save = (owner: string, msgs: Msg[]) => {
  try {
    localStorage.setItem(MATT_STORE, JSON.stringify({ owner, msgs: msgs.slice(-MAX_KEEP) }));
  } catch {}
};
const forget = () => {
  try {
    localStorage.removeItem(MATT_STORE);
  } catch {}
};
const dateText = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

const SUGGESTIONS = [
  { icon: Sparkles, tint: 'text-violet-300 bg-violet-500/10', title: 'How does RDM work?', desc: 'Scanning many timeframes at once', q: 'How does the RDM timeframe work, and when should I use it?' },
  { icon: Coins, tint: 'text-amber-300 bg-amber-500/10', title: 'My credits and plan', desc: 'Balance, daily analyses, refill time', q: 'How many credits and analyses do I have left, and when do they refill?' },
  { icon: BookOpen, tint: 'text-cyan-300 bg-cyan-500/10', title: 'What moves EUR/USD?', desc: 'Drivers, sessions and today', q: 'What moves EUR/USD, and when is it most active?' },
  { icon: Gift, tint: 'text-emerald-300 bg-emerald-500/10', title: 'Promos and rewards', desc: 'Bonuses and events running now', q: 'What promos, rewards or events are running on MarketX right now?' },
];

export default function MattPage() {
  useEffect(() => applyTheme(readThemePref()), []);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  /** Who this conversation belongs to (from the server); nothing is kept on the device until it is known */
  const [owner, setOwner] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const contextRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;

  useEffect(() => {
    if (owner) save(owner, msgs);
  }, [owner, msgs]);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy]);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  const send = useCallback(async (text: string) => {
    const q = text.trim().slice(0, 1500);
    if (!q || busy) return;
    const user: Msg = { id: newId(), role: 'user', text: q, at: Date.now() };
    const history = [...msgsRef.current.filter(m => !m.error), user];
    setMsgs(history);
    setInput('');
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const reply = (m: Partial<Msg>) => setMsgs(cur => [...cur, { id: newId(), role: 'matt', text: '', at: Date.now(), ...m }]);
    try {
      const res = await fetch('/api/matt/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-10).map(m => ({ role: m.role, text: m.text })), context: contextRef.current }),
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        setSignedOut(true);
        reply({ text: 'Sign in to MarketX to chat with Matt.', error: true });
      } else if (res.status === 403 && data?.pausedUntil) {
        setPausedUntil(data.pausedUntil);
        reply({ text: data.message || 'Matt is paused for your account.', private: true });
      } else if (!res.ok || !data?.reply) {
        reply({ text: data?.message || 'Matt hit a snag. Please try again.', error: true });
      } else {
        if (data.pausedUntil) setPausedUntil(data.pausedUntil);
        reply({ text: String(data.reply), private: !!data.private });
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') reply({ text: 'Connection lost. Check your internet and try again.', error: true });
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [busy]);

  // Who is signed in (and whether Matt is paused) first: only that trader's kept conversation is restored. Then, when
  // arriving from an "Ask Matt" button, that question is asked straight away.
  useEffect(() => {
    const ask = takeMattAsk();
    fetch('/api/matt/status', { credentials: 'include' })
      .then(async r => {
        const d = await r.json().catch(() => null);
        if (r.status === 401) {
          setSignedOut(true);
          forget();
        } else if (d && typeof d.owner === 'string') {
          // Anything already sent while this check ran stays, after the kept conversation
          const kept = load(d.owner);
          const merged = [...kept, ...msgsRef.current.filter(m => !kept.some(k => k.id === m.id))];
          msgsRef.current = merged;
          setMsgs(merged);
          setOwner(d.owner);
        }
        if (d?.pausedUntil) setPausedUntil(d.pausedUntil);
      })
      .catch(() => {})
      .finally(() => {
        if (!ask) return;
        contextRef.current = ask.context;
        setTopic(ask.label || null);
        send(ask.q);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newChat = () => {
    abortRef.current?.abort();
    contextRef.current = undefined;
    setTopic(null);
    setMsgs([]);
    setInput('');
    taRef.current?.focus();
  };
  const paused = !!pausedUntil && pausedUntil > Date.now();
  const empty = msgs.length === 0 && !busy;
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }, []);

  return (
    <div className="mx-backdrop relative h-[100dvh] flex flex-col text-slate-100 overflow-hidden">
      {/* Top bar */}
      {/* Top row (owner-specified): no bar, border or background, the icons float on the page; the chat fades out under them */}
      <header className="shrink-0 h-14 px-3 sm:px-5 flex items-center justify-between gap-2 bg-transparent mt-[env(safe-area-inset-top)]">
        <ModeSwitch active="matt" bare />
        <div className="flex items-center gap-2 min-w-0">
          <MattMark className="w-7 h-7" />
          <span className="text-[15px] font-semibold text-white leading-none">Matt</span>
        </div>
        <button type="button" onClick={newChat} className="inline-flex items-center gap-1.5 h-9 px-1 text-sm text-slate-400 hover:text-white transition-colors cursor-pointer">
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New chat</span>
        </button>
      </header>

      {/* Conversation */}
      <div ref={feedRef} className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-6 pt-4 pb-8 [mask-image:linear-gradient(to_bottom,transparent_0,#000_28px)] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0,#000_28px)]">
        <div className="max-w-3xl mx-auto space-y-5 sm:space-y-6">
          {topic && !empty && (
            <div className="flex justify-center">
              <span className="inline-flex items-center gap-1.5 px-3 h-7 rounded-full bg-white/[0.04] border border-white/[0.08] text-[11px] text-slate-400">
                <MattMark className="w-3.5 h-3.5 text-[8px]" /> About: <span className="text-slate-200">{topic}</span>
              </span>
            </div>
          )}

          {empty && (
            <div className="min-h-[60vh] flex flex-col justify-center py-8">
              <div className="text-center mb-8 mx-rise">
                <MattMark className="w-14 h-14 text-2xl mx-auto mb-5 shadow-[0_0_0_8px_rgba(139,92,246,0.12)]" />
                <h1 className="text-[1.75rem] leading-tight sm:text-4xl font-semibold tracking-tight text-white">{greeting}, I'm Matt</h1>
                <p className="text-sm sm:text-[15px] text-slate-400 mt-2.5">Ask me anything about MarketX, your account, or the markets.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left max-w-2xl mx-auto w-full">
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={s.title}
                    type="button"
                    disabled={paused || signedOut}
                    onClick={() => send(s.q)}
                    className="mx-card mx-rise group flex items-start gap-3 p-3.5 text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ animationDelay: `${80 + i * 60}ms` }}
                  >
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${s.tint}`}>
                      <s.icon className="w-[18px] h-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-100">{s.title}</span>
                      <span className="block text-[13px] text-slate-500 mt-0.5 leading-snug">{s.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {msgs.map(m =>
            m.role === 'user' ? (
              <div key={m.id} className="flex justify-end mx-fade-in">
                <div className="max-w-[92%] sm:max-w-[85%] rounded-3xl rounded-br-lg bg-white/[0.07] px-4 py-2.5 text-[15px] leading-relaxed text-slate-100 whitespace-pre-wrap break-words">{m.text}</div>
              </div>
            ) : (
              <div key={m.id} className="flex gap-3 mx-fade-in">
                <MattMark className="w-7 h-7 text-xs mt-0.5" />
                <div
                  className={`min-w-0 flex-1 text-[15px] leading-relaxed break-words ${
                    m.error ? 'text-rose-300' : m.private ? 'px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/[0.08] text-slate-300' : 'text-slate-100'
                  }`}
                >
                  <div className={`prose max-w-none ${m.private ? 'flex gap-2 items-start' : ''}`}>
                    {m.private && <Lock className="w-3.5 h-3.5 mt-[5px] shrink-0 text-slate-500" />}
                    <div className="min-w-0">
                      <LazyMarkdown>{m.text}</LazyMarkdown>
                    </div>
                  </div>
                </div>
              </div>
            )
          )}

          {busy && (
            <div className="flex gap-3 items-center mx-fade-in" aria-live="polite">
              <MattMark className="w-7 h-7 text-xs" />
              <span className="inline-flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Matt is thinking…
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 px-3 sm:px-6 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
        <div className="max-w-3xl mx-auto">
          {paused ? (
            <div className="p-4 rounded-3xl border border-amber-400/20 bg-amber-500/[0.06] text-sm text-amber-100 flex items-start gap-2.5">
              <Lock className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Matt is paused for your account until <b>{dateText(pausedUntil!)}</b> after repeated questions about private platform details. Everything else on MarketX works as usual.
              </span>
            </div>
          ) : signedOut ? (
            <a href="/" className="flex items-center justify-center gap-2 p-4 rounded-3xl border border-white/[0.1] bg-white/[0.04] text-sm text-slate-200 hover:bg-white/[0.07] transition">
              <UserRound className="w-4 h-4" /> Sign in to MarketX to chat with Matt
            </a>
          ) : (
            <form
              onSubmit={e => {
                e.preventDefault();
                send(input);
              }}
              className="mx-composer"
            >
              <textarea
                ref={taRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                maxLength={1500}
                placeholder="Ask Matt about MarketX, your account or a market"
                aria-label="Message Matt"
                className="block w-full bg-transparent text-[15px] leading-6 resize-none focus:outline-none px-4 pt-3.5 pb-1 max-h-[200px] min-h-[52px]"
              />
              <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
                <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border border-violet-400/25 bg-violet-500/10 text-[11px] font-medium text-violet-200">
                  <MattMark className="w-3.5 h-3.5 text-[8px]" /> Matt · free
                </span>
                {busy ? (
                  <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop" title="Stop" className="h-9 w-9 rounded-full flex items-center justify-center bg-white text-slate-950 hover:bg-slate-200 cursor-pointer">
                    <Square className="w-3.5 h-3.5" fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim()}
                    aria-label="Send"
                    title="Send (Enter)"
                    className={`h-9 w-9 rounded-full flex items-center justify-center transition active:scale-95 shrink-0 ${
                      input.trim() ? 'bg-white text-slate-950 hover:bg-slate-200 cursor-pointer shadow-[0_0_0_4px_rgba(139,92,246,0.15)]' : 'bg-white/[0.06] text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                )}
              </div>
            </form>
          )}
          <p className="text-center text-[11px] text-slate-500 mt-2">Matt explains MarketX and the markets. It is not financial advice.</p>
        </div>
      </div>
    </div>
  );
}
