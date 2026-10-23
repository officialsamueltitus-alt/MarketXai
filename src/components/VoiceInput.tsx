import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Lock, Mic, Square, X } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { clipToWav, toBase64 } from '../utils/voice';

// Voice input (owner-specified, free): the mic in the Ask SI box and in Matt.
// 1) The browser's own speech recognition where it exists (live words while you talk, nothing leaves the browser for us).
// 2) Otherwise (or if it fails with a network/service error) a short recording, cut off by silence, converted to 16 kHz
//    WAV and written down by the server (POST /api/voice/transcribe). Nothing is kept.
// Either way the words land in the input and are sent like a typed message.

export type VoiceState = 'idle' | 'starting' | 'listening' | 'transcribing';

const MAX_MS = 30_000;
/** The recording ends this long after the trader stops talking (phones record, so this is their reply delay) */
const SILENCE_MS = 950;
const NO_SPEECH_MS = 7000;
/** A tap on Stop always ends the session within this time, even if the browser never answers */
const STOP_GRACE_MS = 2500;
/** The browser's recognition must really start by then, else MarketX records instead */
const START_GRACE_MS = 5000;
const NO_SPEECH = "Didn't catch that. Tap the mic and try again.";
const MIC_BLOCKED = 'Allow microphone access for MarketX in your browser settings, then tap the mic again.';

const recognitionCtor = (): any =>
  typeof window === 'undefined' ? null : (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
const audioCtor = (): typeof AudioContext | null => (typeof window === 'undefined' ? null : (window as any).AudioContext || (window as any).webkitAudioContext || null);
const canRecord = () =>
  typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof (window as any).MediaRecorder !== 'undefined' && !!audioCtor();
/**
 * Phones and tablets (iOS, iPadOS, Android, every browser on them): the browser's own speech service there can start
 * without a proper microphone prompt, hang, or ignore Stop. They record with the microphone instead, which always asks
 * for permission and stops the moment the trader taps Stop.
 */
const isMobileDevice = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle/i.test(ua) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
};
/** After a network/service error the browser's recognition is skipped for the rest of the visit */
let recognitionBroken = false;

export const voiceSupported = () => canRecord() || (!isMobileDevice() && !!recognitionCtor());

interface Handlers {
  /** Words so far, while the trader is still talking (browser recognition only) */
  onInterim?: (text: string) => void;
  /** The words, once the trader stops */
  onFinal: (text: string) => void;
  onError?: (message: string) => void;
}

interface Session {
  stop: () => void;
  cancel: () => void;
}

export function useVoiceInput(handlers: Handlers) {
  const h = useRef(handlers);
  h.current = handlers;
  const [state, setState] = useState<VoiceState>('idle');
  const [elapsed, setElapsed] = useState(0);
  /** 0..1 loudness for the waveform (read by VoiceWave without re-rendering the input) */
  const levelRef = useRef(0);
  const session = useRef<Session | null>(null);
  const [supported] = useState(voiceSupported);

  /** Ends the given session once (later calls from a stale session are ignored) */
  const finishFor = useCallback((s: Session | null) => {
    if (s && session.current !== s) return;
    session.current = null;
    levelRef.current = 0;
    setState('idle');
  }, []);

  useEffect(() => () => session.current?.cancel(), []);
  // Leaving the page or the app releases the microphone at once (phones keep the mic light on otherwise)
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && session.current?.cancel();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);
  useEffect(() => {
    if (state !== 'listening') return setElapsed(0);
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    return () => clearInterval(id);
  }, [state]);

  /**
   * Records with the microphone and lets MarketX write the words down. `ctx` is created inside the tap itself
   * (iOS only lets audio run when it starts from a tap).
   */
  const startRecorder = useCallback(
    (ctx: AudioContext | null, keepCtx = false) => {
      if (!canRecord()) {
        if (!keepCtx) ctx?.close().catch(() => {});
        h.current.onError?.("Voice input isn't available in this browser. Please type your message.");
        return;
      }
      let cancelled = false;
      let stopRequested = false;
      let ended = false;
      let stream: MediaStream | null = null;
      let recorder: MediaRecorder | null = null;
      let raf = 0;
      let graceTimer = 0;
      let spoke = false;
      /** False while the level meter only reads silence (a suspended audio engine): then only Stop or the time limit end it */
      let meterWorks = false;
      let startedAt = 0;
      const chunks: Blob[] = [];
      let micNode: MediaStreamAudioSourceNode | null = null;
      const cleanup = () => {
        cancelAnimationFrame(raf);
        try {
          micNode?.disconnect();
        } catch {
          /* already gone */
        }
        micNode = null;
        clearTimeout(graceTimer);
        stream?.getTracks().forEach(t => t.stop());
        // A context lent by the caller (Matt's talk back, unlocked in a tap) stays open for the next turn
        if (!keepCtx) ctx?.close().catch(() => {});
        stream = null;
        ctx = null;
      };
      const me: Session = {
        stop: () => {
          stopRequested = true;
          if (!recorder || recorder.state === 'inactive') {
            // Still waiting for the microphone: nothing was recorded, so just close
            cancelled = true;
            cleanup();
            finishFor(me);
            return;
          }
          try {
            recorder.stop();
          } catch {
            /* handled by the grace timer */
          }
          // Some phones never fire onstop: end it anyway with what was recorded
          clearTimeout(graceTimer);
          graceTimer = window.setTimeout(() => onStopped(), STOP_GRACE_MS);
        },
        cancel: () => {
          cancelled = true;
          me.stop();
        },
      };
      session.current = me;
      setState('starting');

      const onStopped = async () => {
        if (ended) return;
        ended = true;
        cleanup();
        if (cancelled) return finishFor(me);
        const long = performance.now() - startedAt > 600;
        // A manual Stop sends what was said; an automatic stop needs speech first (when the meter can hear it)
        if (!chunks.length || !long || (meterWorks && !spoke && !stopRequested)) {
          finishFor(me);
          h.current.onError?.(NO_SPEECH);
          return;
        }
        if (session.current === me) setState('transcribing');
        try {
          const wav = await clipToWav(new Blob(chunks, { type: recorder?.mimeType || chunks[0]?.type || 'audio/webm' }));
          const r = await apiFetch<{ text: string }>('/api/voice/transcribe', {
            method: 'POST',
            body: JSON.stringify({ audio: toBase64(wav), mimeType: 'audio/wav' }),
            // The server answers within 12s; never leave "Writing it down" spinning
            timeoutMs: 15_000,
          });
          if (session.current !== me) return;
          finishFor(me);
          if (r?.text) h.current.onFinal(r.text);
          else h.current.onError?.(NO_SPEECH);
        } catch (err: any) {
          if (session.current !== me) return;
          finishFor(me);
          h.current.onError?.(err?.message || 'Voice input is busy right now. Please type your message or try again.');
        }
      };

      (async () => {
        try {
          // This is what shows the browser's "Allow microphone?" prompt
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch (err: any) {
          cleanup();
          if (session.current !== me) return;
          finishFor(me);
          if (!cancelled) {
            const name = String(err?.name || '');
            h.current.onError?.(
              name === 'NotAllowedError' || name === 'SecurityError'
                ? MIC_BLOCKED
                : name === 'NotFoundError' || name === 'OverconstrainedError'
                  ? 'No microphone was found on this device.'
                  : "Couldn't reach your microphone. Close other apps using it and try again."
            );
          }
          return;
        }
        if (cancelled || session.current !== me) {
          cleanup();
          return;
        }
        let analyser: AnalyserNode | null = null;
        try {
          if (!ctx) {
            const AC = audioCtor();
            ctx = AC ? new AC() : null;
          }
          if (ctx) {
            ctx.resume?.().catch(() => {});
            analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            micNode = ctx.createMediaStreamSource(stream);
            micNode.connect(analyser);
          }
        } catch {
          analyser = null;
        }
        const MR: typeof MediaRecorder = (window as any).MediaRecorder;
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find(m => MR.isTypeSupported?.(m));
        try {
          recorder = new MR(stream, mime ? { mimeType: mime } : undefined);
        } catch {
          try {
            recorder = new MR(stream);
          } catch {
            cleanup();
            finishFor(me);
            h.current.onError?.("Voice input isn't available in this browser. Please type your message.");
            return;
          }
        }
        recorder.ondataavailable = e => {
          if (e.data?.size) chunks.push(e.data);
        };
        recorder.onstop = () => {
          // The last chunk can arrive just after onstop on some browsers
          setTimeout(() => onStopped(), 60);
        };
        try {
          recorder.start(250);
        } catch {
          recorder.start();
        }
        startedAt = performance.now();
        setState('listening');
        let lastLoud = startedAt;
        // Speech is judged against the room, not a fixed level: phones boost the mic (auto gain), so a quiet room can sit
        // above a fixed threshold (never "silent", the clip ran on) or a soft voice below it (never "spoke")
        let floor = -1;
        let peak = 0;
        let loudRun = 0;
        const buf = new Float32Array(analyser ? analyser.fftSize : 0);
        const tick = () => {
          if (ended || stopRequested) return;
          const now = performance.now();
          let rms = 0;
          if (analyser) {
            analyser.getFloatTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
            rms = Math.sqrt(sum / buf.length);
            if (rms > 0.0005) meterWorks = true;
          }
          // Without a working meter the bars just breathe
          levelRef.current = meterWorks ? Math.min(1, rms * 7) : 0.25 + 0.2 * Math.sin(now / 180);
          if (meterWorks) {
            if (floor < 0) floor = rms;
            const voiceAt = Math.min(0.06, Math.max(0.012, floor * 3));
            // Once the trader has spoken, a drop well under their own level counts as silence too
            const loud = rms > Math.max(voiceAt, spoke ? peak * 0.14 : 0);
            // Background level: follows quieter frames down at once and drifts up slowly between words (not on speech)
            floor = rms < floor ? rms : loud ? floor : floor + (rms - floor) * 0.01;
            loudRun = loud ? loudRun + 1 : 0;
            if (loudRun >= 3) {
              spoke = true;
              peak = Math.max(peak * 0.995, rms);
            }
            if (spoke && loud) lastLoud = now;
          }
          if (now - startedAt > MAX_MS || (meterWorks && spoke && now - lastLoud > SILENCE_MS) || (meterWorks && !spoke && now - startedAt > NO_SPEECH_MS)) {
            me.stop();
            return;
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })();
    },
    [finishFor]
  );

  /** The browser's own speech recognition (desktop): live words while the trader talks */
  const startRecognition = useCallback(
    (Rec: any) => {
      let rec: any;
      try {
        rec = new Rec();
      } catch {
        return startRecorder(null);
      }
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let finalText = '';
      let interim = '';
      let cancelled = false;
      let fellBack = false;
      let errored = false;
      let started = false;
      let ended = false;
      let raf = 0;
      let graceTimer = 0;
      // No raw audio here: the waveform breathes on its own and jumps as words arrive
      const breathe = () => {
        levelRef.current = Math.max(0.08, levelRef.current * 0.92);
        raf = requestAnimationFrame(breathe);
      };
      const limit = window.setTimeout(() => me.stop(), MAX_MS);
      // The browser said nothing back: record with the microphone instead
      const startWatch = window.setTimeout(() => {
        if (started || ended) return;
        fellBack = canRecord();
        if (!fellBack) errored = true;
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
        onEnd();
        if (!fellBack) h.current.onError?.("Voice input didn't start. Please try again or type your message.");
      }, START_GRACE_MS);
      const onEnd = () => {
        if (ended) return;
        ended = true;
        clearTimeout(limit);
        clearTimeout(startWatch);
        clearTimeout(graceTimer);
        cancelAnimationFrame(raf);
        if (fellBack && !cancelled) {
          if (session.current === me) session.current = null;
          startRecorder(null);
          return;
        }
        const text = `${finalText}${interim}`.trim();
        finishFor(me);
        if (cancelled) return;
        if (text) h.current.onFinal(text);
        else if (!errored) h.current.onError?.(NO_SPEECH);
      };
      rec.onstart = () => {
        started = true;
        clearTimeout(startWatch);
        if (session.current === me) setState('listening');
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
        if (!cancelled) h.current.onInterim?.(`${finalText}${interim}`.trim());
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
        if (cancelled) return;
        if (err === 'not-allowed') h.current.onError?.(MIC_BLOCKED);
        else if (err === 'audio-capture') h.current.onError?.("Couldn't reach your microphone.");
        else if (err === 'no-speech') h.current.onError?.(NO_SPEECH);
        else h.current.onError?.('Voice input stopped. Please try again.');
      };
      rec.onend = onEnd;
      const me: Session = {
        stop: () => {
          if (!started) {
            cancelled = true;
            try {
              rec.abort();
            } catch {
              /* ignore */
            }
            return onEnd();
          }
          try {
            rec.stop();
          } catch {
            /* the grace timer ends it */
          }
          // Stop always works: if the browser doesn't finish in time, end it here with the words heard so far
          clearTimeout(graceTimer);
          graceTimer = window.setTimeout(() => {
            try {
              rec.abort();
            } catch {
              /* ignore */
            }
            onEnd();
          }, STOP_GRACE_MS);
        },
        cancel: () => {
          cancelled = true;
          try {
            rec.abort();
          } catch {
            /* ignore */
          }
          onEnd();
        },
      };
      session.current = me;
      setState('starting');
      try {
        rec.start();
      } catch {
        ended = true;
        clearTimeout(limit);
        clearTimeout(startWatch);
        session.current = null;
        startRecorder(null);
      }
    },
    [finishFor, startRecorder]
  );

  /** `ctx`: an audio context the caller already unlocked in a tap (kept open); otherwise one is made here */
  const start = useCallback((opts?: { ctx?: AudioContext | null }) => {
    if (session.current) return;
    const Rec = recognitionCtor();
    if (Rec && !recognitionBroken && !isMobileDevice()) return startRecognition(Rec);
    if (opts?.ctx) {
      opts.ctx.resume?.().catch(() => {});
      return startRecorder(opts.ctx, true);
    }
    // Created and resumed right here, inside the tap, so iOS lets it hear the microphone
    let ctx: AudioContext | null = null;
    try {
      const AC = audioCtor();
      ctx = AC ? new AC() : null;
      ctx?.resume?.().catch(() => {});
    } catch {
      ctx = null;
    }
    startRecorder(ctx);
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
  const listening = state === 'listening' || state === 'starting';
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

/** Shown in the input's bottom row while voice is on: cancel, live waveform, "Listening 0:04" (shrinks to fit narrow phones) */
export const VoiceStatus: React.FC<{ state: VoiceState; elapsed: number; levelRef: React.MutableRefObject<number>; onCancel: () => void }> = ({
  state,
  elapsed,
  levelRef,
  onCancel,
}) => (
  <div className="mx-fade-in flex flex-1 items-center gap-1.5 min-w-0 overflow-hidden" role="status" aria-live="polite">
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
    <span className="h-8 max-w-full pl-2 pr-2.5 rounded-full bg-violet-500/10 border border-violet-400/20 inline-flex items-center gap-2 min-w-0 overflow-hidden">
      {state === 'listening' ? (
        <VoiceWave levelRef={levelRef} className="shrink-0" barClass="bg-gradient-to-t from-violet-400 to-fuchsia-300" />
      ) : (
        <Loader2 className="w-3.5 h-3.5 shrink-0 text-violet-300 animate-spin" />
      )}
      <span className="text-[12px] font-medium text-violet-100 whitespace-nowrap truncate min-w-0">
        {state === 'listening' ? 'Listening' : state === 'starting' ? 'Allow the mic' : 'Writing it down…'}
      </span>
      {state === 'listening' && <span className="shrink-0 text-[11px] font-mono tabular-nums text-violet-300/80">{mmss(elapsed)}</span>}
    </span>
  </div>
);
