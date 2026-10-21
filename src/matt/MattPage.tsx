// Matt: MarketX's help assistant, on its own page (/matt), styled like Ask SI. Answers about MarketX, the trader's account,
// events and promos, and the markets. Private platform questions get "Not available" (and repeated ones pause Matt; decided
// by the server). Conversations stay on this device only, tagged with their trader (another account on the same device never
// sees them); History lists the past chats to reopen or delete.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowUp, BookOpen, Coins, Gift, History, Loader2, Lock, MessageSquare, Plus, Search, Sparkles, Square, Trash2, UserRound, X } from 'lucide-react';
import { LazyMarkdown, preloadMarkdown } from '../components/LazyMarkdown';
import { MattMark } from '../components/AskMattButton';
import { ModeSwitch } from '../components/ModeSwitch';
import { takeMattAsk } from '../utils/matt';
import { normalizeSpokenPrompt } from '../utils/voice';
import { useVoiceInput, VoiceMicButton, VoiceStatus } from '../components/VoiceInput';
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
interface Chat {
  id: string;
  title: string;
  msgs: Msg[];
  updatedAt: number;
  /** "About: …" when the chat started from an Ask Matt button, and what that button handed over */
  topic?: string | null;
  context?: string;
}
/** Every chat with Matt, for one trader, on this device: {owner, chats, current} */
export const MATT_STORE = 'mx.matt.v2';
/** The single conversation kept before chat history (moved into the history once, then removed) */
const OLD_STORE = 'mx.matt.v1';
const MAX_KEEP = 40;
const MAX_CHATS = 30;
const MAX_BYTES = 1_500_000;
const newId = (p = 'm') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const cleanMsgs = (list: any): Msg[] =>
  (Array.isArray(list) ? list : []).filter((m: any) => m && (m.role === 'user' || m.role === 'matt') && typeof m.text === 'string' && typeof m.id === 'string').slice(-MAX_KEEP);
const titleOf = (msgs: Msg[]) => {
  const first = msgs.find(m => m.role === 'user')?.text.replace(/\s+/g, ' ').trim() || 'New chat';
  return first.length > 60 ? `${first.slice(0, 57).trim()}…` : first;
};

/** The kept chats, only when they belong to `owner` (the signed-in trader); anything else is dropped */
const load = (owner: string): { chats: Chat[]; current: string | null } => {
  try {
    const v = JSON.parse(localStorage.getItem(MATT_STORE) || 'null');
    let chats: Chat[] = [];
    let current: string | null = null;
    if (v && typeof v === 'object' && !Array.isArray(v) && v.owner === owner && Array.isArray(v.chats)) {
      chats = v.chats
        .filter((c: any) => c && typeof c.id === 'string')
        .map((c: any) => {
          const msgs = cleanMsgs(c.msgs);
          return { id: c.id, title: typeof c.title === 'string' && c.title ? c.title.slice(0, 80) : titleOf(msgs), msgs, updatedAt: Number(c.updatedAt) || 0, topic: typeof c.topic === 'string' ? c.topic : null, context: typeof c.context === 'string' ? c.context.slice(0, 4000) : undefined };
        })
        .filter((c: Chat) => c.msgs.length);
      current = typeof v.current === 'string' ? v.current : null;
    } else if (v) localStorage.removeItem(MATT_STORE);
    // The single conversation from before chat history becomes the first chat in it
    const old = JSON.parse(localStorage.getItem(OLD_STORE) || 'null');
    if (old && typeof old === 'object' && old.owner === owner) {
      const msgs = cleanMsgs(old.msgs);
      if (msgs.length && !chats.some(c => c.id === 'c-earlier')) {
        chats.push({ id: 'c-earlier', title: titleOf(msgs), msgs, updatedAt: msgs[msgs.length - 1].at || Date.now() });
        current = current || 'c-earlier';
      }
    }
    if (old) localStorage.removeItem(OLD_STORE);
    chats.sort((a, b) => b.updatedAt - a.updatedAt);
    return { chats: chats.slice(0, MAX_CHATS), current: chats.some(c => c.id === current) ? current : null };
  } catch {
    return { chats: [], current: null };
  }
};
const save = (owner: string, chats: Chat[], current: string | null) => {
  let list = chats.filter(c => c.msgs.length).slice(0, MAX_CHATS).map(c => ({ ...c, msgs: c.msgs.filter(m => !m.error).slice(-MAX_KEEP) }));
  // Oldest chats give way when the device's storage runs short
  while (list.length) {
    const body = JSON.stringify({ owner, chats: list, current });
    try {
      if (body.length > MAX_BYTES) throw new Error('too big');
      localStorage.setItem(MATT_STORE, body);
      return;
    } catch {
      list = list.slice(0, -1);
    }
  }
  try {
    localStorage.removeItem(MATT_STORE);
  } catch {}
};
const forget = () => {
  try {
    localStorage.removeItem(MATT_STORE);
    localStorage.removeItem(OLD_STORE);
  } catch {}
};
const dateText = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const dayGroup = (t: number) => {
  const d = new Date(t);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = (today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000;
  return diff <= 0 ? 'Today' : diff <= 1 ? 'Yesterday' : diff <= 7 ? 'Previous 7 days' : diff <= 30 ? 'Previous 30 days' : 'Older';
};
const timeText = (t: number) =>
  dayGroup(t) === 'Today' ? new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

const SUGGESTIONS = [
  { icon: Sparkles, tint: 'text-violet-300 bg-violet-500/10', title: 'How does RDM work?', desc: 'Scanning many timeframes at once', q: 'How does the RDM timeframe work, and when should I use it?' },
  { icon: Coins, tint: 'text-amber-300 bg-amber-500/10', title: 'My credits and plan', desc: 'Balance, daily analyses, refill time', q: 'How many credits and analyses do I have left, and when do they refill?' },
  { icon: BookOpen, tint: 'text-cyan-300 bg-cyan-500/10', title: 'What moves EUR/USD?', desc: 'Drivers, sessions and today', q: 'What moves EUR/USD, and when is it most active?' },
  { icon: Gift, tint: 'text-emerald-300 bg-emerald-500/10', title: 'Promos and rewards', desc: 'Bonuses and events running now', q: 'What promos, rewards or events are running on MarketX right now?' },
];

export default function MattPage() {
  useEffect(() => applyTheme(readThemePref()), []);
  const [chats, setChats] = useState<Chat[]>([]);
  /** The open chat; null = a new, empty chat (it joins the history with its first message) */
  const [currentId, setCurrentId] = useState<string | null>(null);
  /** Who these chats belong to (from the server); nothing is kept on the device until it is known */
  const [owner, setOwner] = useState<string | null>(null);
  const [input, setInput] = useState('');
  /** The chat waiting for Matt's reply (one at a time) */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [pausedUntil, setPausedUntil] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const currentRef = useRef(currentId);
  currentRef.current = currentId;

  const current = chats.find(c => c.id === currentId) || null;
  const msgs = current?.msgs || [];
  const busy = !!busyId;
  const thinkingHere = !!busyId && busyId === currentId;

  useEffect(() => {
    if (owner) save(owner, chats, currentId);
  }, [owner, chats, currentId]);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs.length, thinkingHere, currentId]);
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [input]);

  /** Adds messages to one chat (by id) and moves it to the top of the history */
  const addTo = (chatId: string, add: Msg[], extra?: Partial<Chat>) =>
    setChats(list => {
      const found = list.find(c => c.id === chatId);
      const base: Chat = found || { id: chatId, title: 'New chat', msgs: [], updatedAt: Date.now(), ...extra };
      const msgsNext = [...base.msgs.filter(m => !(m.error && add.some(a => a.role === 'user'))), ...add].slice(-MAX_KEEP);
      const next: Chat = { ...base, ...(found ? {} : extra), msgs: msgsNext, title: base.msgs.some(m => m.role === 'user') ? base.title : titleOf(msgsNext), updatedAt: Date.now() };
      return [next, ...list.filter(c => c.id !== chatId)].slice(0, MAX_CHATS);
    });

  const send = useCallback(
    async (text: string, opts?: { newChat?: boolean; topic?: string | null; context?: string }) => {
      const q = text.trim().slice(0, 1500);
      if (!q || busyId) return;
      const chatId = !opts?.newChat && currentRef.current ? currentRef.current : newId('c');
      const existing = chatsRef.current.find(c => c.id === chatId);
      const user: Msg = { id: newId(), role: 'user', text: q, at: Date.now() };
      const history = [...(existing?.msgs || []).filter(m => !m.error), user];
      const context = opts?.context ?? existing?.context;
      addTo(chatId, [user], { topic: opts?.topic ?? null, context });
      setCurrentId(chatId);
      setInput('');
      setBusyId(chatId);
      // Fetch the Markdown parser while Matt thinks, so the answer never flashes as raw text
      preloadMarkdown();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const reply = (m: Partial<Msg>) => addTo(chatId, [{ id: newId(), role: 'matt', text: '', at: Date.now(), ...m }]);
      try {
        const res = await fetch('/api/matt/chat', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: history.slice(-10).map(m => ({ role: m.role, text: m.text })), context }),
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
        setBusyId(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busyId]
  );

  // Voice (free): speak a question, the words fill the box as you talk, and Matt answers as soon as you stop
  const voiceBaseRef = useRef('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  // Voice is free until 1 Nov 2026, then Pro only (the server's status says whether this account may use it)
  const [voiceAllowed, setVoiceAllowed] = useState(true);
  const [voiceUpsell, setVoiceUpsell] = useState(false);
  const voice = useVoiceInput({
    onInterim: t => setInput(voiceBaseRef.current ? `${voiceBaseRef.current} ${t}` : t),
    onFinal: t => {
      const said = normalizeSpokenPrompt(t, { commands: false });
      send(voiceBaseRef.current ? `${voiceBaseRef.current} ${said}` : said);
    },
    onError: message => {
      setInput(voiceBaseRef.current);
      setVoiceError(message);
    },
  });
  const voiceOn = voice.state !== 'idle';
  const toggleVoice = () => {
    if (!voiceOn && !voiceAllowed) {
      setVoiceUpsell(true);
      return;
    }
    if (!voiceOn) {
      voiceBaseRef.current = input.trim();
      setVoiceError(null);
    }
    voice.toggle();
  };
  useEffect(() => {
    if (!voiceError) return;
    const t = setTimeout(() => setVoiceError(null), 4500);
    return () => clearTimeout(t);
  }, [voiceError]);

  // Who is signed in (and whether Matt is paused) first: only that trader's chats are restored. Then, when arriving from
  // an "Ask Matt" button, that question starts a new chat straight away; otherwise the last chat opens again.
  useEffect(() => {
    const ask = takeMattAsk();
    fetch('/api/matt/status', { credentials: 'include' })
      .then(async r => {
        const d = await r.json().catch(() => null);
        if (r.status === 401) {
          setSignedOut(true);
          forget();
        } else if (d && typeof d.owner === 'string') {
          setVoiceAllowed(d.voice !== false);
          const kept = load(d.owner);
          // A chat already started while this check ran stays on top of the kept ones
          const started = chatsRef.current.filter(c => !kept.chats.some(k => k.id === c.id));
          const merged = [...started, ...kept.chats].slice(0, MAX_CHATS);
          chatsRef.current = merged;
          setChats(merged);
          if (!currentRef.current && !ask && kept.current) setCurrentId(kept.current);
          setOwner(d.owner);
        }
        if (d?.pausedUntil) setPausedUntil(d.pausedUntil);
      })
      .catch(() => {})
      .finally(() => {
        if (ask) send(ask.q, { newChat: true, topic: ask.label || null, context: ask.context });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newChat = () => {
    setCurrentId(null);
    setInput('');
    setHistoryOpen(false);
    taRef.current?.focus();
  };
  const openChat = (id: string) => {
    setCurrentId(id);
    setHistoryOpen(false);
  };
  const deleteChat = (id: string) => {
    if (busyId === id) abortRef.current?.abort();
    setChats(list => list.filter(c => c.id !== id));
    if (currentId === id) setCurrentId(null);
  };
  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setHistoryOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historyOpen]);

  const paused = !!pausedUntil && pausedUntil > Date.now();
  const empty = msgs.length === 0 && !thinkingHere;
  const topic = current?.topic || null;
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }, []);
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const shown = chats.filter(c => c.msgs.length && (!f || c.title.toLowerCase().includes(f) || c.msgs.some(m => m.text.toLowerCase().includes(f))));
    const out: Array<{ label: string; items: Chat[] }> = [];
    for (const c of shown) {
      const label = dayGroup(c.updatedAt);
      const g = out.find(x => x.label === label);
      if (g) g.items.push(c);
      else out.push({ label, items: [c] });
    }
    return out;
  }, [chats, filter]);
  const chatCount = chats.filter(c => c.msgs.length).length;

  return (
    <div className="mx-backdrop relative h-[100dvh] flex flex-col text-slate-100 overflow-hidden">
      {/* Top row (owner-specified): no bar, border or background, the icons float on the page; the chat fades out under them */}
      <header className="shrink-0 h-14 px-3 sm:px-5 flex items-center justify-between gap-2 bg-transparent mt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-1">
          <ModeSwitch active="matt" bare />
          {!signedOut && (
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              aria-label="Chat history"
              title="Chat history"
              className="relative h-8 w-9 flex items-center justify-center text-slate-500 hover:text-white transition-colors cursor-pointer"
            >
              <History className="w-4 h-4" />
              {chatCount > 0 && <span className="absolute top-1 right-1.5 w-1.5 h-1.5 rounded-full bg-violet-400" aria-hidden="true" />}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 min-w-0">
          <MattMark className="w-7 h-7" />
          <span className="text-[15px] font-semibold text-white leading-none">Matt</span>
        </div>
        <button type="button" onClick={newChat} className="inline-flex items-center gap-1.5 h-9 px-1 text-sm text-slate-400 hover:text-white transition-colors cursor-pointer">
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">New chat</span>
        </button>
      </header>

      {/* Chat history */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Chat history">
          <button type="button" aria-label="Close history" onClick={() => setHistoryOpen(false)} className="absolute inset-0 bg-black/60 mx-fade-in cursor-default" />
          <aside className="relative w-[min(22rem,88vw)] h-full bg-[var(--mx-surface)] border-r border-white/[0.08] shadow-2xl flex flex-col mx-fade-in pt-[env(safe-area-inset-top)]">
            <div className="h-14 shrink-0 flex items-center justify-between gap-2 px-4">
              <span className="inline-flex items-center gap-2 text-[15px] font-semibold text-white">
                <History className="w-4 h-4 text-violet-300" /> Chats with Matt
              </span>
              <button type="button" onClick={() => setHistoryOpen(false)} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-3 pb-2 space-y-2">
              <button type="button" onClick={newChat} className="w-full h-10 rounded-xl border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-sm font-medium text-slate-100 inline-flex items-center justify-center gap-2 cursor-pointer">
                <Plus className="w-4 h-4" /> New chat
              </button>
              {chatCount > 3 && (
                <label className="flex items-center gap-2 h-9 px-3 rounded-xl bg-white/[0.03] border border-white/[0.06] text-slate-400 focus-within:border-violet-400/40">
                  <Search className="w-3.5 h-3.5 shrink-0" />
                  <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search your chats" aria-label="Search your chats" className="flex-1 min-w-0 bg-transparent text-[13px] text-slate-100 focus:outline-none" />
                </label>
              )}
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
              {groups.length === 0 ? (
                <p className="text-[13px] text-slate-500 px-3 py-6 text-center leading-relaxed">
                  {filter ? 'No chat matches that.' : 'Your chats with Matt show up here, so you can go back to any of them.'}
                </p>
              ) : (
                groups.map(g => (
                  <div key={g.label} className="mt-2">
                    <div className="px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">{g.label}</div>
                    {g.items.map(c => (
                      <div key={c.id} className={`group flex items-center gap-1 rounded-xl ${c.id === currentId ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}>
                        <button type="button" onClick={() => openChat(c.id)} className="flex-1 min-w-0 flex items-start gap-2.5 px-3 py-2 text-left cursor-pointer">
                          <MessageSquare className={`w-3.5 h-3.5 mt-[3px] shrink-0 ${c.id === currentId ? 'text-violet-300' : 'text-slate-500'}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] text-slate-100 truncate">{c.title}</span>
                            <span className="block text-[11px] text-slate-500 mt-0.5">
                              {timeText(c.updatedAt)} · {c.msgs.length} message{c.msgs.length === 1 ? '' : 's'}
                              {busyId === c.id ? ' · Matt is replying…' : ''}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteChat(c.id)}
                          aria-label={`Delete chat: ${c.title}`}
                          title="Delete chat"
                          className="w-8 h-8 mr-1 rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
            <p className="shrink-0 px-4 py-3 text-[11px] text-slate-500 border-t border-white/[0.06]">Saved on this device for your account only. Up to {MAX_CHATS} chats are kept.</p>
          </aside>
        </div>
      )}

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
                    disabled={paused || signedOut || busy}
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
              {chatCount > 0 && (
                <button type="button" onClick={() => setHistoryOpen(true)} className="mt-6 mx-auto inline-flex items-center gap-1.5 text-[13px] text-slate-400 hover:text-white cursor-pointer">
                  <History className="w-3.5 h-3.5" /> Your past chats ({chatCount})
                </button>
              )}
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

          {thinkingHere && (
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
              className={`mx-composer ${voiceOn ? 'is-listening' : ''}`}
            >
              {voiceUpsell && (
                <div className="px-3 pt-3">
                  <div className="mx-rise inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-amber-500/10 border border-amber-400/20 text-[12px] text-amber-100" role="alert">
                    <Lock className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    Voice input is a Pro feature.
                    <a href="/?pricing=1" className="font-semibold underline underline-offset-2 hover:text-white">
                      See Pro
                    </a>
                    <button type="button" onClick={() => setVoiceUpsell(false)} aria-label="Dismiss" className="ml-0.5 w-5 h-5 rounded-full hover:bg-white/[0.08] flex items-center justify-center cursor-pointer">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
              {voiceError && (
                <div className="px-3 pt-3">
                  <div className="mx-rise inline-flex items-center gap-2 px-3 py-2 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-[12px] text-slate-200" role="alert">
                    <AlertCircle className="w-3.5 h-3.5 text-violet-300 shrink-0" />
                    {voiceError}
                  </div>
                </div>
              )}
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
                placeholder={voice.state === 'listening' ? 'Listening… ask Matt anything' : voice.state === 'transcribing' ? 'Writing down what you said…' : 'Ask Matt about MarketX, your account or a market'}
                aria-label="Message Matt"
                className="block w-full bg-transparent text-[15px] leading-6 resize-none focus:outline-none px-4 pt-3.5 pb-1 max-h-[200px] min-h-[52px]"
              />
              <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
                {voiceOn ? (
                  <VoiceStatus state={voice.state} elapsed={voice.elapsed} levelRef={voice.levelRef} onCancel={voice.cancel} />
                ) : (
                  <span className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-full border border-violet-400/25 bg-violet-500/10 text-[11px] font-medium text-violet-200">
                    <MattMark className="w-3.5 h-3.5 text-[8px]" /> Matt · free
                  </span>
                )}
                <div className="flex items-center gap-1 shrink-0">
                {!busy && voice.supported && <VoiceMicButton state={voice.state} onClick={toggleVoice} locked={!voiceAllowed && !voiceOn} />}
                {voiceOn ? null : busy ? (
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
              </div>
            </form>
          )}
          <p className="text-center text-[11px] text-slate-500 mt-2">Matt explains MarketX and the markets. It is not financial advice.</p>
        </div>
      </div>
    </div>
  );
}
