import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, X } from 'lucide-react';
import { useVoiceInput } from '../components/VoiceInput';
import { normalizeSpokenPrompt } from '../utils/voice';
import { MattSpeaker, type MattVoice } from './mattVoice';

// Talk back with Matt (owner-specified, Matt only): a full-screen voice conversation. Matt (a glossy orb with two eyes,
// after the owner's reference) says hello, then listens, answers out loud and listens again, until the trader closes it.
// Every turn is also written down here and saved into the Matt chat like typed messages.
// Speed (owner-requested): one request per turn (/api/matt/talk: the words, Matt's answer and his first sentence already
// spoken), the rest of the answer fetched while the first sentence plays, and the turn ends ~0.8s after the trader stops.

/** One spoken part of Matt's answer, signed so the server will speak it */
export interface TalkPart {
  text: string;
  token: string | null;
}
export interface TalkResult {
  /** What the trader said, as written down */
  heard?: string;
  reply?: string;
  parts?: TalkPart[];
  /** The first part, already spoken (WAV, base64) */
  audio?: string | null;
  error?: string;
  /** Nothing clear was said: just listen again */
  noSpeech?: boolean;
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
/** A conversation turn ends this long after the trader stops talking */
const TALK_SILENCE_MS = 800;
const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');

async function speakPart(part: TalkPart, voice: MattVoice): Promise<string | null> {
  if (!part.token) return null;
  try {
    const r = await fetch('/api/matt/speak', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: part.text, token: part.token, voice }),
    });
    const d = await r.json().catch(() => null);
    return r.ok && d?.audio ? d.audio : null;
  } catch {
    return null;
  }
}

export const MattTalk: React.FC<{
  ctx: AudioContext | null;
  /** Matt's voice, chosen in Matt settings */
  voice: MattVoice;
  /** One turn: the trader's words (text) or clip (audio) to Matt; saves both sides in the chat */
  talk: (input: { text?: string; audio?: string }) => Promise<TalkResult>;
  onClose: () => void;
}> = ({ ctx, voice, talk, onClose }) => {
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
  /** Each turn has its own number: tapping Matt to interrupt drops the rest of the old turn */
  const turn = useRef(0);
  const orb = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const set = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };
  const add = (l: Omit<Line, 'id'>) => setLines(x => [...x, { ...l, id: lineId() }].slice(-60));

  // ---- listening ----------------------------------------------------------------------------------------------
  const listenRef = useRef<() => void>(() => {});
  const sendRef = useRef<(input: { text?: string; audio?: string }) => void>(() => {});
  const voiceIn = useVoiceInput(
    {
      // Words from the browser's own recognition (desktop, Android)
      onFinal: t => {
        if (!alive.current) return;
        silent.current = 0;
        const text = normalizeSpokenPrompt(t, { commands: false });
        if (!text.trim()) return listenRef.current();
        add({ who: 'you', text });
        sendRef.current({ text });
      },
      // A recorded clip (iPhone, iPad, other phones): written down together with Matt's answer, in one request
      onAudio: audio => {
        if (!alive.current) return;
        sendRef.current({ audio });
      },
      onError: message => {
        if (!alive.current) return;
        if (/didn't catch/i.test(message) && ++silent.current <= MAX_SILENT) return listenRef.current();
        set('idle');
        setNote(/didn't catch/i.test(message) ? 'Tap Matt when you want to talk.' : message);
      },
    },
    { silenceMs: TALK_SILENCE_MS, recognitionOnAndroid: true, lang: 'en-US' }
  );
  const voiceInRef = useRef(voiceIn);
  voiceInRef.current = voiceIn;
  const listen = useCallback(() => {
    if (!alive.current) return;
    turn.current++;
    setNote(null);
    set('listening');
    voiceInRef.current.start({ ctx: speaker.current?.context || null });
  }, []);
  listenRef.current = listen;
  useEffect(() => {
    if (voiceIn.state === 'transcribing' && phaseRef.current === 'listening') set('hearing');
  }, [voiceIn.state]);

  // ---- speaking -----------------------------------------------------------------------------------------------
  /** Plays Matt's answer part by part: the first is already here, the others are fetched side by side while it plays */
  const playParts = useCallback(async (parts: TalkPart[], firstAudio: string | null | undefined, myTurn: number) => {
    const v = voiceRef.current;
    const audios = parts.map((p, i) => (i === 0 && firstAudio ? Promise.resolve(firstAudio) : speakPart(p, v)));
    for (let i = 0; i < parts.length; i++) {
      if (!alive.current || turn.current !== myTurn) return;
      const a = await audios[i];
      if (!alive.current || turn.current !== myTurn) return;
      try {
        if (a) await speaker.current!.playWav(a);
        else await speaker.current!.speakOnDevice(parts[i].text, v);
      } catch {
        await speaker.current!.speakOnDevice(parts[i].text, v).catch(() => {});
      }
    }
  }, []);

  const send = useCallback(async (input: { text?: string; audio?: string }) => {
    const myTurn = ++turn.current;
    set('thinking');
    const r = await talk(input);
    if (!alive.current || turn.current !== myTurn) return;
    if (r.noSpeech) {
      if (++silent.current <= MAX_SILENT) return listen();
      set('idle');
      return setNote('Tap Matt when you want to talk.');
    }
    silent.current = 0;
    if (r.heard && input.audio) add({ who: 'you', text: r.heard });
    if (r.error || !r.reply) {
      add({ who: 'matt', text: r.error || 'Matt hit a snag. Please try again.', error: true });
      set('idle');
      setNote('Tap Matt to try again.');
      return;
    }
    add({ who: 'matt', text: r.reply });
    set('speaking');
    await playParts(r.parts?.length ? r.parts : [{ text: r.reply, token: null }], r.audio, myTurn);
    if (alive.current && turn.current === myTurn && phaseRef.current === 'speaking') listen();
  }, [listen, playParts, talk]);
  sendRef.current = send;

  // ---- open: Matt says hello, then listens ----------------------------------------------------------------------
  useEffect(() => {
    alive.current = true;
    (async () => {
      // On Android the browser's recognition is used: ask for the mic first so the permission prompt always shows
      if (isAndroid() && navigator.mediaDevices?.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop())).catch(() => {});
      }
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
      turn.current++;
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

  // The orb moves with the voice (Matt's while he speaks, the trader's while they talk). Kept light so phones stay cool:
  // about 30 updates a second, only transform/opacity (no repaints), nothing at all while quiet or with the screen hidden.
  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    let shown = -1;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 33 || document.visibilityState !== 'visible') return;
      last = t;
      const p = phaseRef.current;
      const lv = p === 'speaking' ? speaker.current?.level(t) || 0 : p === 'listening' ? voiceInRef.current.levelRef.current : 0;
      smooth += (lv - smooth) * 0.35;
      if (smooth < 0.004) smooth = 0;
      if (Math.abs(smooth - shown) < 0.01) return;
      shown = smooth;
      if (orb.current) orb.current.style.transform = `scale(${(1 + smooth * 0.1).toFixed(3)})`;
      if (glow.current) {
        glow.current.style.opacity = (0.35 + smooth * 0.65).toFixed(3);
        glow.current.style.transform = `scale(${(1 + smooth * 0.25).toFixed(3)})`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** Tap Matt: interrupt him, send what you said so far, or start listening again */
  const tapOrb = () => {
    const p = phaseRef.current;
    if (p === 'speaking') {
      turn.current++;
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
        <span className="w-9" aria-hidden="true" />
        <span className="text-[13px] font-semibold tracking-wide text-slate-300">Talk with Matt</span>
        <button type="button" onClick={onClose} aria-label="End the conversation" title="End" className="w-9 h-9 rounded-full bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center cursor-pointer">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="relative flex-1 min-h-0 flex flex-col items-center">
        <div className="flex-1 min-h-[14rem] flex flex-col items-center justify-center gap-6 w-full">
          <button type="button" onClick={tapOrb} aria-label={status} className="mx-orb-wrap relative cursor-pointer focus:outline-none" style={{ WebkitTapHighlightColor: 'transparent' }}>
            <span ref={glow} className="mx-orb-glow" aria-hidden="true" />
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
