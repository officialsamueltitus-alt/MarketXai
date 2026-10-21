import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Lock, Mic, Square, X } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { clipToWav, toBase64 } from '../utils/voice';

// Voice input (owner-specified, free): the mic in the Ask SI box and in Matt.
// 1) The browser's own speech recognition where it exists (live words while you talk, nothing leaves the browser for us).
// 2) Otherwise (or if it fails with a network/service error) a short recording, cut off by silence, converted to 16 kHz
//    WAV and written down by the server (POST /api/voice/transcribe). Nothing is kept.
// Either way the words land in the input and are sent like a typed message.

export type VoiceState = 'idle' | 'listening' | 'transcribing';

const MAX_MS = 30_000;
const SILENCE_MS = 1600;
const NO_SPEECH_MS = 7000;
const NO_SPEECH = "Didn't catch that. Tap the mic and try again.";

const recognitionCtor = (): any =>
  typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
const canRecord = () =>
  typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof (window as any).MediaRecorder !== 'undefined' && !!((window as any).AudioContext || (window as any).webkitAudioContext);
/** After a network/service error the browser's recognition is skipped for the rest of the visit */
let recognitionBroken = false;

export const voiceSupported = () => !!recognitionCtor() || canRecord();

interface Handlers {
  /** Words so far, while the trader is still talking (browser recognition only) */
  onInterim?: (text: string) => void;
  /** The words, once the trader stops */
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
}

export function useVoiceInput(handlers: Handlers) {
  const h = useRef(handlers);
  h.current = handlers;
  const [state, setState] = useState<VoiceState>('idle');
  const [elapsed, setElapsed] = useState(0);
  /** 0..1 loudness for the waveform (read by VoiceWave without re-rendering the input) */
  const levelRef = useRef(0);
  const session = useRef<{ stop: () => void; cancel: () => void } | null>(null);
  const [supported] = useState(voiceSupported);

  const finish = useCallback(() => {
    session.current = null;
    levelRef.current = 0;
    setState('idle');
  }, []);

  useEffect(() => () => session.current?.cancel(), []);
  useEffect(() => {
    if (state !== 'listening') return setElapsed(0);
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => clearInterval(id);
  }, [state]);

  const startRecorder = useCallback(async () => {
    if (!canRecord()) {
      finish();
      h.current.onError?.("Voice input isn't available in this browser. Please type your message.");
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let recorder: MediaRecorder | null = null;
    let raf = 0;
    let spoke = false;
    const chunks: Blob[] = [];
    const cleanup = () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
      ctx?.close().catch(() => {});
      stream = null;
      ctx = null;
    };
    const stopRec = () => {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else {
        cleanup();
        finish();
      }
    };
    session.current = {
      stop: stopRec,
      cancel: () => {
        cancelled = true;
        stopRec();
      },
    };
    setState('listening');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (err: any) {
      finish();
      if (!cancelled) h.current.onError?.(err?.name === 'NotAllowedError' ? 'Allow microphone access in your browser to talk to MarketX.' : "Couldn't reach your microphone.");
      return;
    }
    if (cancelled) {
      cleanup();
      finish();
      return;
    }
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    ctx = new AC();
    ctx.resume?.().catch(() => {});
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const MR: typeof MediaRecorder = (window as any).MediaRecorder;
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MR.isTypeSupported?.(m));
    recorder = new MR(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = e => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      cleanup();
      if (cancelled) return finish();
      if (!spoke || !chunks.length) {
        finish();
        h.current.onError?.(NO_SPEECH);
        return;
      }
      setState('transcribing');
      try {
        const wav = await clipToWav(new Blob(chunks, { type: recorder?.mimeType || mime || 'audio/webm' }));
        const r = await apiFetch<{ text: string }>('/api/voice/transcribe', {
          method: 'POST',
          body: JSON.stringify({ audio: toBase64(wav), mimeType: 'audio/wav' }),
        });
        finish();
        if (r?.text) h.current.onFinal(r.text);
        else h.current.onError?.(NO_SPEECH);
      } catch (err: any) {
        finish();
        h.current.onError?.(err?.message || 'Voice input is busy right now. Please type your message or try again.');
      }
    };
    recorder.start(250);
    const t0 = performance.now();
    let lastLoud = t0;
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      levelRef.current = Math.min(1, rms * 7);
      const now = performance.now();
      if (rms > 0.03) {
        spoke = true;
        lastLoud = now;
      }
      if ((spoke && now - lastLoud > SILENCE_MS) || (!spoke && now - t0 > NO_SPEECH_MS) || now - t0 > MAX_MS) return stopRec();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }, [finish]);

  const startRecognition = useCallback(
    (Rec: any) => {
      const rec = new Rec();
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let finalText = '';
      let interim = '';
      let cancelled = false;
      let fellBack = false;
      let errored = false;
      let raf = 0;
      // No raw audio here: the waveform breathes on its own and jumps as words arrive
      const breathe = () => {
        levelRef.current = Math.max(0.08, levelRef.current * 0.92);
        raf = requestAnimationFrame(breathe);
      };
      const limit = setTimeout(() => rec.stop(), MAX_MS);
      rec.onstart = () => {
        setState('listening');
        raf = requestAnimationFrame(breathe);
      };
      rec.onresult = (e: any) => {
        interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const piece = e.results[i][0]?.transcript || '';
          if (e.results[i].isFinal) finalText += piece;
          else interim += piece;
        }
        levelRef.current = 0.55 + Math.random() * 0.45;
        h.current.onInterim?.(`${finalText}${interim}`.trim());
      };
      rec.onerror = (e: any) => {
        const err = String(e?.error || '');
        if (err === 'aborted') return;
        if (['network', 'service-not-allowed', 'language-not-supported', 'bad-grammar'].includes(err) && canRecord() && !cancelled) {
          // The browser's speech service isn't reachable: record and let MarketX write it down instead
          recognitionBroken = true;
          fellBack = true;
          return;
        }
        errored = true;
        if (err === 'not-allowed') h.current.onError?.('Allow microphone access in your browser to talk to MarketX.');
        else if (err === 'audio-capture') h.current.onError?.("Couldn't reach your microphone.");
        else if (err === 'no-speech') h.current.onError?.(NO_SPEECH);
        else h.current.onError?.('Voice input stopped. Please try again.');
      };
      rec.onend = () => {
        clearTimeout(limit);
        cancelAnimationFrame(raf);
        if (fellBack) {
          session.current = null;
          startRecorder();
          return;
        }
        const text = `${finalText}${interim}`.trim();
        finish();
        if (cancelled) return;
        if (text) h.current.onFinal(text);
        else if (!errored) h.current.onError?.(NO_SPEECH);
      };
      session.current = {
        stop: () => rec.stop(),
        cancel: () => {
          cancelled = true;
          try {
            rec.abort();
          } catch {
            finish();
          }
        },
      };
      setState('listening');
      try {
        rec.start();
      } catch {
        session.current = null;
        startRecorder();
      }
    },
    [finish, startRecorder]
  );

  const start = useCallback(() => {
    if (session.current) return;
    const Rec = recognitionCtor();
    if (Rec && !recognitionBroken) startRecognition(Rec);
    else startRecorder();
  }, [startRecognition, startRecorder]);

  const stop = useCallback(() => session.current?.stop(), []);
  const cancel = useCallback(() => session.current?.cancel(), []);
  const toggle = useCallback(() => (session.current ? session.current.stop() : start()), [start]);

  return { state, elapsed, levelRef, supported, start, stop, cancel, toggle };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const BAR_WEIGHTS = [0.45, 0.75, 1, 0.8, 0.55, 0.9, 0.6];

/** Live waveform: bars follow the voice (or breathe while waiting); updates the DOM directly, no re-renders */
export const VoiceWave: React.FC<{ levelRef: React.MutableRefObject<number>; className?: string; barClass?: string }> = ({ levelRef, className = '', barClass = 'bg-white' }) => {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const smooth = BAR_WEIGHTS.map(() => 0.2);
    const tick = (t: number) => {
      const lv = levelRef.current;
      bars.current.forEach((el, i) => {
        if (!el) return;
        const wobble = 0.65 + 0.35 * Math.sin(t / 140 + i * 1.7);
        const target = 0.16 + Math.min(1, lv * BAR_WEIGHTS[i] * wobble * 1.25) * 0.84;
        smooth[i] += (target - smooth[i]) * 0.35;
        el.style.transform = `scaleY(${smooth[i].toFixed(3)})`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [levelRef]);
  return (
    <span className={`inline-flex items-center gap-[3px] h-5 ${className}`} aria-hidden="true">
      {BAR_WEIGHTS.map((_, i) => (
        <span key={i} ref={el => {
            bars.current[i] = el;
          }} className={`w-[3px] h-full rounded-full origin-center ${barClass}`} style={{ transform: 'scaleY(0.2)' }} />
      ))}
    </span>
  );
};

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** The mic button: Mic → glowing stop while listening → spinner while the words are written down */
export const VoiceMicButton: React.FC<{ state: VoiceState; onClick: () => void; disabled?: boolean; className?: string; locked?: boolean }> = ({
  state,
  onClick,
  disabled,
  className = '',
  locked = false,
}) => {
  const listening = state === 'listening';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || state === 'transcribing'}
      className={`relative h-9 w-9 rounded-full flex items-center justify-center transition active:scale-95 shrink-0 cursor-pointer disabled:cursor-not-allowed ${
        listening
          ? 'text-white bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-[0_6px_20px_-6px_rgba(168,85,247,0.8)] mx-voice-ring'
          : state === 'transcribing'
            ? 'text-violet-200 bg-violet-500/15'
            : 'text-slate-300 hover:text-white hover:bg-white/[0.08] disabled:opacity-40'
      } ${className}`}
      title={locked ? 'Voice input is a Pro feature' : listening ? 'Stop and send' : state === 'transcribing' ? 'Writing it down…' : 'Speak your message'}
      aria-label={locked ? 'Speak your message (Pro)' : listening ? 'Stop listening and send' : 'Speak your message'}
      aria-pressed={listening}
    >
      {listening ? <Square className="w-3 h-3 fill-current" /> : state === 'transcribing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-[17px] h-[17px]" />}
      {locked && <Lock className="absolute top-0.5 right-0.5 w-3 h-3 p-[1px] rounded-full bg-[var(--mx-bg-2)] text-amber-300" aria-hidden="true" />}
    </button>
  );
};

/** Shown in the input's bottom row while voice is on: cancel, live waveform, "Listening 0:04" */
export const VoiceStatus: React.FC<{ state: VoiceState; elapsed: number; levelRef: React.MutableRefObject<number>; onCancel: () => void }> = ({
  state,
  elapsed,
  levelRef,
  onCancel,
}) => (
  <div className="mx-fade-in flex items-center gap-2 min-w-0" role="status" aria-live="polite">
    <button
      type="button"
      onClick={onCancel}
      disabled={state === 'transcribing'}
      className="h-8 w-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] disabled:opacity-40 cursor-pointer shrink-0"
      aria-label="Cancel voice message"
      title="Cancel"
    >
      <X className="w-4 h-4" />
    </button>
    <span className="h-8 pl-2.5 pr-3 rounded-full bg-violet-500/10 border border-violet-400/20 inline-flex items-center gap-2.5 min-w-0">
      {state === 'listening' ? (
        <VoiceWave levelRef={levelRef} barClass="bg-gradient-to-t from-violet-400 to-fuchsia-300" />
      ) : (
        <Loader2 className="w-3.5 h-3.5 text-violet-300 animate-spin" />
      )}
      <span className="text-[12px] font-medium text-violet-100 whitespace-nowrap">{state === 'listening' ? 'Listening' : 'Writing it down…'}</span>
      {state === 'listening' && <span className="text-[11px] font-mono tabular-nums text-violet-300/80">{mmss(elapsed)}</span>}
    </span>
  </div>
);
