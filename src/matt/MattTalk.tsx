import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, X } from 'lucide-react';
import { useVoiceInput } from '../components/VoiceInput';
import { normalizeSpokenPrompt } from '../utils/voice';
import { MattSpeaker, saveMattVoice, type MattVoice } from './mattVoice';

// Talk back with Matt (owner-specified, Matt only): a full-screen voice conversation. Matt (a glossy orb with two eyes,
// after the owner's reference) says hello, then listens, answers out loud and listens again, until the trader closes it.
// Every turn is also written down here and saved into the Matt chat like typed messages.

export interface TalkReply {
  reply?: string;
  /** Signature from the chat route that lets this reply be spoken */
  speak?: string | null;
  error?: string;
  private?: boolean;
}

type Phase = 'greeting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'idle';
interface Line {
  id: string;
  who: 'you' | 'matt';
  text: string;
  error?: boolean;
}

const lineId = () => Math.random().toString(36).slice(2, 10);
/** After this many silent turns in a row Matt stops listening and waits for a tap */
const MAX_SILENT = 2;

export const MattTalk: React.FC<{
  ctx: AudioContext | null;
  voice: MattVoice;
  onVoice: (v: MattVoice) => void;
  /** Sends the trader's words to Matt (and saves both sides in the chat) */
  ask: (text: string) => Promise<TalkReply>;
  onClose: () => void;
}> = ({ ctx, voice, onVoice, ask, onClose }) => {
  const [phase, setPhase] = useState<Phase>('greeting');
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const speaker = useRef<MattSpeaker | null>(null);
  if (!speaker.current) speaker.current = new MattSpeaker(ctx);
  const alive = useRef(true);
  const phaseRef = useRef<Phase>('greeting');
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const silent = useRef(0);
  const orb = useRef<HTMLDivElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const set = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const add = (l: Omit<Line, 'id'>) => setLines(x => [...x, { ...l, id: lineId() }].slice(-60));

  // ---- listening ----------------------------------------------------------------------------------------------
  const listenRef = useRef<() => void>(() => {});
  const voiceIn = useVoiceInput({
    onFinal: t => {
      if (!alive.current) return;
      silent.current = 0;
      handleUser(normalizeSpokenPrompt(t, { commands: false }));
    },
    onError: message => {
      if (!alive.current) return;
      if (/didn't catch/i.test(message) && ++silent.current <= MAX_SILENT) return listenRef.current();
      set('idle');
      setNote(/didn't catch/i.test(message) ? 'Tap Matt when you want to talk.' : message);
    },
  });
  const voiceInRef = useRef(voiceIn);
  voiceInRef.current = voiceIn;
  const listen = useCallback(() => {
    if (!alive.current) return;
    setNote(null);
    set('listening');
    voiceInRef.current.start({ ctx: speaker.current?.context || null });
  }, []);
  listenRef.current = listen;
  // The hook's own state: words are being written down
  useEffect(() => {
    if (voiceIn.state === 'transcribing' && phaseRef.current === 'listening') set('hearing');
  }, [voiceIn.state]);

  // ---- speaking -----------------------------------------------------------------------------------------------
  /** Says Matt's words in the chosen voice (the device's own voice if the server's is busy); then listens again */
  const say = useCallback(async (body: Record<string, unknown>, fallbackText: string, thenListen = true) => {
    if (!alive.current) return;
    set('speaking');
    let text = fallbackText;
    try {
      const r = await fetch('/api/matt/speak', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, voice: voiceRef.current }),
      });
      const d = await r.json().catch(() => null);
      if (!alive.current) return;
      if (d?.spoken) text = d.spoken;
      else if (d?.text && !fallbackText) text = d.text;
      if (r.ok && d?.audio) await speaker.current!.playWav(d.audio);
      else if (text) await speaker.current!.speakOnDevice(text, voiceRef.current);
    } catch {
      if (alive.current && text) await speaker.current!.speakOnDevice(text, voiceRef.current).catch(() => {});
    }
    if (alive.current && thenListen && phaseRef.current === 'speaking') listen();
    return text;
  }, [listen]);

  const handleUser = useCallback(async (text: string) => {
    if (!text.trim()) return listen();
    add({ who: 'you', text });
    set('thinking');
    const r = await ask(text);
    if (!alive.current) return;
    if (r.error || !r.reply) {
      add({ who: 'matt', text: r.error || 'Matt hit a snag. Please try again.', error: true });
      set('idle');
      setNote('Tap Matt to try again.');
      return;
    }
    add({ who: 'matt', text: r.reply });
    if (!r.speak) {
      // Not signed for speaking (should not happen): read it on the device
      set('speaking');
      await speaker.current!.speakOnDevice(r.reply, voiceRef.current);
      if (alive.current && phaseRef.current === 'speaking') listen();
      return;
    }
    await say({ text: r.reply, token: r.speak }, r.reply);
  }, [ask, listen, say]);

  // ---- open: Matt says hello, then listens ----------------------------------------------------------------------
  useEffect(() => {
    alive.current = true;
    (async () => {
      // The greeting line shows as soon as the server writes it (or a plain hello if it can't)
      let greeting = "Hi! I'm Matt, your MarketX guide. Ask me anything about MarketX, your account or the markets.";
      set('greeting');
      try {
        const r = await fetch('/api/matt/speak', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ greeting: true, voice: voiceRef.current }),
        });
        const d = await r.json().catch(() => null);
        if (!alive.current) return;
        if (r.status === 401) {
          add({ who: 'matt', text: 'Sign in to MarketX to talk with Matt.', error: true });
          return set('idle');
        }
        if (r.status === 402) {
          add({ who: 'matt', text: d?.message || 'Talking with Matt is a Pro feature.', error: true });
          return set('idle');
        }
        if (d?.text) greeting = d.text;
        add({ who: 'matt', text: greeting });
        set('speaking');
        if (r.ok && d?.audio) await speaker.current!.playWav(d.audio);
        else await speaker.current!.speakOnDevice(greeting, voiceRef.current);
      } catch {
        if (!alive.current) return;
        add({ who: 'matt', text: greeting });
        set('speaking');
        await speaker.current!.speakOnDevice(greeting, voiceRef.current).catch(() => {});
      }
      if (alive.current && phaseRef.current === 'speaking') listen();
    })();
    return () => {
      alive.current = false;
      voiceInRef.current.cancel();
      speaker.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes; the newest line stays in view
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: 'smooth' });
  }, [lines.length]);

  // The orb moves with the voice: Matt's while he speaks, the trader's while they talk
  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    const tick = (t: number) => {
      const p = phaseRef.current;
      const lv = p === 'speaking' ? speaker.current?.level(t) || 0 : p === 'listening' ? voiceInRef.current.levelRef.current : 0;
      smooth += (lv - smooth) * 0.25;
      const el = orb.current;
      if (el) {
        el.style.setProperty('--lv', smooth.toFixed(3));
        el.style.transform = `scale(${(1 + smooth * 0.12).toFixed(3)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** Tap Matt: interrupt him, send what you said so far, or start listening again */
  const tapOrb = () => {
    const p = phaseRef.current;
    if (p === 'speaking') {
      speaker.current?.stop();
      set('idle');
      return listen();
    }
    if (p === 'listening') return voiceInRef.current.stop();
    if (p === 'idle') {
      silent.current = 0;
      listen();
    }
  };
  const pickVoice = (v: MattVoice) => {
    if (v === voiceRef.current) return;
    saveMattVoice(v);
    onVoice(v);
  };

  const status =
    phase === 'greeting'
      ? 'Matt is joining…'
      : phase === 'listening'
        ? voiceIn.state === 'starting'
          ? 'Allow the mic to talk'
          : 'Listening… go ahead'
        : phase === 'hearing'
          ? 'Got it…'
          : phase === 'thinking'
            ? 'Matt is thinking…'
            : phase === 'speaking'
              ? 'Matt is talking · tap to interrupt'
              : note || 'Tap Matt to talk';

  return (
    <div className="mx-talk fixed inset-0 z-[70] flex flex-col text-white" role="dialog" aria-modal="true" aria-label="Talk with Matt">
      <div className="mx-talk-rings" aria-hidden="true">
        {[1, 2, 3, 4, 5].map(i => (
          <span key={i} style={{ width: `${i * 22}vmax`, height: `${i * 22}vmax` }} />
        ))}
      </div>

      <header className="relative shrink-0 h-14 mt-[env(safe-area-inset-top)] px-4 flex items-center justify-between">
        <div className="inline-flex p-0.5 rounded-full bg-white/[0.06] border border-white/[0.08]" role="radiogroup" aria-label="Matt's voice">
          {(['female', 'male'] as MattVoice[]).map(v => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={voice === v}
              onClick={() => pickVoice(v)}
              className={`h-7 px-3 rounded-full text-[12px] font-medium transition cursor-pointer ${voice === v ? 'bg-white text-slate-950' : 'text-slate-300 hover:text-white'}`}
            >
              {v === 'female' ? 'Female' : 'Male'}
            </button>
          ))}
        </div>
        <span className="text-[13px] font-semibold tracking-wide text-slate-300">Talk with Matt</span>
        <button type="button" onClick={onClose} aria-label="End the conversation" title="End" className="w-9 h-9 rounded-full bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="relative flex-1 min-h-0 flex flex-col items-center">
        <div className="flex-1 min-h-[14rem] flex flex-col items-center justify-center gap-6 w-full">
          <button type="button" onClick={tapOrb} aria-label={status} className="mx-orb-wrap relative cursor-pointer focus:outline-none" style={{ WebkitTapHighlightColor: 'transparent' }}>
            <div ref={orb} className={`mx-orb is-${phase}`}>
              <span className="mx-orb-swirl a" />
              <span className="mx-orb-swirl b" />
              <span className="mx-orb-gloss" />
              <span className="mx-orb-eyes">
                <i />
                <i />
              </span>
            </div>
          </button>
          <p className="h-5 text-[13px] text-slate-300 flex items-center gap-1.5" aria-live="polite">
            {phase === 'listening' && voiceIn.state === 'listening' && <Mic className="w-3.5 h-3.5 text-violet-300" />}
            {status}
          </p>
        </div>

        {/* Everything said, written down */}
        <div ref={feed} className="w-full max-w-xl max-h-[38vh] overflow-y-auto overscroll-contain px-5 pb-4 space-y-2.5 [mask-image:linear-gradient(to_bottom,transparent_0,#000_18px)]">
          {lines.map(l => (
            <div key={l.id} className={`flex ${l.who === 'you' ? 'justify-end' : 'justify-start'} mx-fade-in`}>
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed whitespace-pre-wrap break-words ${
                  l.who === 'you' ? 'bg-white/[0.1] text-slate-50 rounded-br-md' : l.error ? 'bg-rose-500/10 text-rose-200 rounded-bl-md' : 'bg-violet-500/[0.14] text-violet-50 rounded-bl-md'
                }`}
              >
                <span className="block text-[10px] uppercase tracking-wider font-semibold opacity-60 mb-0.5">{l.who === 'you' ? 'You' : 'Matt'}</span>
                {l.text}
              </div>
            </div>
          ))}
        </div>
      </div>

      <footer className="relative shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 flex items-center justify-center">
        <button type="button" onClick={onClose} className="h-11 px-6 rounded-full bg-rose-500/90 hover:bg-rose-500 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer shadow-[0_8px_30px_-8px_rgba(244,63,94,0.7)]">
          <X className="w-4 h-4" /> End
        </button>
      </footer>
    </div>
  );
};
