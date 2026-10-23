// Matt talks back (owner-specified, Matt only): plays Matt's spoken replies and measures how loud they are, so the orb
// moves with his voice. The voice comes from the server (POST /api/matt/speak); if that is busy, the device's own voice
// reads the words instead, so the conversation never stops.

export type MattVoice = 'female' | 'male';
// Matt settings are kept on this device
const VOICE_KEY = 'mx.matt.voice';

export function readMattVoice(): MattVoice {
  try {
    return localStorage.getItem(VOICE_KEY) === 'male' ? 'male' : 'female';
  } catch {
    return 'female';
  }
}
export function saveMattVoice(v: MattVoice) {
  try {
    localStorage.setItem(VOICE_KEY, v);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
}

/** Matt settings: the mic in Matt on or off (on unless the trader switched it off) */
const MIC_KEY = 'mx.matt.mic';
export function readMattMic(): boolean {
  try {
    return localStorage.getItem(MIC_KEY) !== 'off';
  } catch {
    return true;
  }
}
export function saveMattMic(on: boolean) {
  try {
    localStorage.setItem(MIC_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the choice lasts for this visit */
  }
}

export const audioCtor = (): typeof AudioContext | null =>
  typeof window === 'undefined' ? null : (window as any).AudioContext || (window as any).webkitAudioContext || null;

/** Made inside the tap that opens talk back (iOS only plays sound from a context started by a tap) */
export function unlockedContext(): AudioContext | null {
  try {
    const AC = audioCtor();
    const ctx = AC ? new AC() : null;
    if (!ctx) return null;
    ctx.resume?.().catch(() => {});
    // A silent blip right away keeps iOS from muting later playback
    const b = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(ctx.destination);
    src.start(0);
    return ctx;
  } catch {
    return null;
  }
}

// Phones (owner-reported fix): Matt's voice plays through an <audio> element unlocked inside the tap, not through Web Audio.
// iPhones mute Web Audio when the ring/silent switch is on and route it to the earpiece after the mic was used; an audio
// element plays on the loudspeaker either way, on iOS, Android and Safari alike. The orb still follows the voice: the
// loudness is read from the WAV's own samples (no audio routed through Web Audio).

/** A tiny silent WAV, played inside the tap so later playback is allowed (iOS / Android autoplay rules) */
function silentWav(): string {
  const n = 800;
  const b = new Uint8Array(44 + n * 2);
  const v = new DataView(b.buffer);
  const w = (o: number, t: string) => [...t].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * 2, true);
  let bin = '';
  b.forEach(x => (bin += String.fromCharCode(x)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

/** Made inside the tap that opens talk back or plays a sample, so Matt's voice can play on phones */
export function unlockedAudio(): HTMLAudioElement | null {
  try {
    if (typeof Audio === 'undefined') return null;
    const a = new Audio();
    a.setAttribute('playsinline', '');
    (a as any).playsInline = true;
    a.preload = 'auto';
    a.src = silentWav();
    a.play().catch(() => {});
    return a;
  } catch {
    return null;
  }
}

/** iOS only lets the device voice speak after it has spoken once inside a tap */
export function unlockSpeech() {
  try {
    if (typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

/** Safari 16.4+: play Matt on the loudspeaker; back to automatic before listening */
export function setAudioSession(type: 'playback' | 'auto') {
  try {
    const s = (navigator as any).audioSession;
    if (s && s.type !== type) s.type = type;
  } catch {
    /* not supported */
  }
}

/** Loudness of a 16-bit PCM WAV every 50 ms (0..1), for the orb */
function envelopeOf(bytes: Uint8Array): Float32Array | null {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const rate = v.getUint32(24, true) || 24000;
    const channels = v.getUint16(22, true) || 1;
    let o = 12;
    while (o + 8 <= bytes.length) {
      const id = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
      const size = v.getUint32(o + 4, true);
      if (id === 'data') {
        const start = o + 8;
        const samples = Math.floor(Math.min(size, bytes.length - start) / 2 / channels);
        const step = Math.max(1, Math.round(rate * 0.05));
        const out = new Float32Array(Math.ceil(samples / step));
        for (let i = 0; i < out.length; i++) {
          let sum = 0;
          let n = 0;
          for (let j = i * step; j < Math.min(samples, (i + 1) * step); j += 4) {
            const x = v.getInt16(start + j * 2 * channels, true) / 32768;
            sum += x * x;
            n++;
          }
          out[i] = n ? Math.min(1, Math.sqrt(sum / n) * 5) : 0;
        }
        return out;
      }
      o += 8 + size + (size % 2);
    }
  } catch {
    /* no envelope: the orb uses a talking rhythm */
  }
  return null;
}

// American English voices only (owner-specified: a US accent, never British). Named voices across iOS/macOS, Android
// (Google's en-us-x-… voices), Windows and Chrome, so a male choice stays male even on the device's own voice.
const FEMALE = /female|samantha|allison|ava|susan|zira|joanna|jenny|aria|michelle|emma|salli|kimberly|nicole|nicky|victoria|karen|google us english|x-sfg|x-tpf|x-tpc|x-iog|x-iob/i;
const MALE = /\bmale\b|alex\b|aaron|fred|tom\b|david|mark|guy|ryan|matthew|joey|justin|eric|christopher|steffan|evan|nathan|x-iom|x-iol|x-tpd/i;

function deviceVoice(kind: MattVoice): { voice: SpeechSynthesisVoice | null; matched: boolean } {
  const all = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : [];
  const us = all.filter(v => /^en[-_]US/i.test(v.lang));
  const pool = us.length ? us : all.filter(v => /^en/i.test(v.lang) && !/GB|AU|IE|IN|ZA|NZ/i.test(v.lang));
  const want = kind === 'male' ? MALE : FEMALE;
  const other = kind === 'male' ? FEMALE : MALE;
  const exact = pool.find(v => want.test(v.name) && !other.test(v.name));
  if (exact) return { voice: exact, matched: true };
  return { voice: pool.find(v => !other.test(v.name)) || pool[0] || null, matched: false };
}

export class MattSpeaker {
  private ctx: AudioContext | null;
  private el: HTMLAudioElement | null;
  private env: Float32Array | null = null;
  private playing = false;
  private synthOn = false;
  private stopFn: (() => void) | null = null;

  constructor(ctx: AudioContext | null, el?: HTMLAudioElement | null) {
    this.ctx = ctx;
    this.el = el || null;
  }

  /** 0..1 loudness of what Matt is saying right now */
  level(t: number): number {
    if (this.playing && this.el) {
      if (this.env) return this.env[Math.min(this.env.length - 1, Math.floor(this.el.currentTime / 0.05))] || 0;
      return 0.35 + 0.3 * Math.abs(Math.sin(t / 110));
    }
    // The device's own voice gives no audio to measure: a gentle talking rhythm instead
    if (this.synthOn) return 0.35 + 0.3 * Math.abs(Math.sin(t / 110)) * (0.6 + 0.4 * Math.sin(t / 370));
    return 0;
  }

  get speaking() {
    return this.playing || this.synthOn;
  }

  /** Plays a WAV (base64) on the loudspeaker; resolves when it ends or is stopped, rejects if it can't play */
  async playWav(b64: string): Promise<void> {
    this.stop();
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    if (!this.el) {
      try {
        this.el = new Audio();
        this.el.setAttribute('playsinline', '');
      } catch {
        this.el = null;
      }
    }
    const el = this.el;
    if (!el) throw new Error('no audio');
    this.env = envelopeOf(bytes);
    setAudioSession('playback');
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: unknown) => {
        if (settled) return;
        settled = true;
        el.onended = null;
        el.onerror = null;
        this.playing = false;
        this.stopFn = null;
        // Released a moment later: Safari can still be reading the end of the clip
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        if (err) reject(err);
        else resolve();
      };
      el.onended = () => done();
      el.onerror = () => done(new Error('audio error'));
      this.stopFn = () => {
        try {
          el.pause();
        } catch {
          /* ignore */
        }
        done();
      };
      el.src = url;
      this.playing = true;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(err => done(err));
    });
  }

  /** The device's own voice (when the server voice is busy); resolves when done or stopped */
  speakOnDevice(text: string, kind: MattVoice): Promise<void> {
    if (typeof speechSynthesis === 'undefined' || !text) return Promise.resolve();
    this.stop();
    setAudioSession('playback');
    return new Promise<void>(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      const { voice, matched } = deviceVoice(kind);
      if (voice) u.voice = voice;
      // Always US English, even when the device has no US voice of that kind
      u.lang = 'en-US';
      u.rate = 1.04;
      // No named voice of that kind on this device: the pitch keeps Matt male (or female) anyway
      u.pitch = kind === 'male' ? (matched ? 0.95 : 0.72) : matched ? 1.05 : 1.2;
      let finished = false;
      // Some browsers never fire onend: a time limit from the length of the text
      const limit = window.setTimeout(() => done(), 4000 + text.length * 90);
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(limit);
        this.synthOn = false;
        this.stopFn = null;
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      this.synthOn = true;
      this.stopFn = () => {
        try {
          speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
        done();
      };
      speechSynthesis.speak(u);
    });
  }

  stop() {
    this.stopFn?.();
  }

  close() {
    this.stop();
    try {
      if (this.el) {
        this.el.removeAttribute('src');
        this.el.load();
      }
    } catch {
      /* ignore */
    }
    this.el = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  /** The AudioContext made in the tap (the recorder measures the mic with it) */
  get context() {
    return this.ctx;
  }
}
