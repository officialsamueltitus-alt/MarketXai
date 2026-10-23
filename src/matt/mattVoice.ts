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

const FEMALE = /female|samantha|victoria|karen|moira|tessa|zira|susan|serena|fiona|allison|ava|joanna|kate|libby|sonia|aria|jenny|google us english/i;
const MALE = /\bmale\b|daniel|alex\b|fred|david|mark|george|rishi|aaron|arthur|guy|ryan|thomas|oliver|google uk english male/i;

function deviceVoice(kind: MattVoice): SpeechSynthesisVoice | null {
  const all = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : [];
  const en = all.filter(v => /^en/i.test(v.lang));
  const pool = en.length ? en : all;
  const want = kind === 'male' ? MALE : FEMALE;
  const avoid = kind === 'male' ? /female/i : /\bmale\b/i;
  return pool.find(v => want.test(v.name) && !avoid.test(v.name)) || pool.find(v => !avoid.test(v.name)) || pool[0] || null;
}

export class MattSpeaker {
  private ctx: AudioContext | null;
  private analyser: AnalyserNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;
  private synthOn = false;
  private stopFn: (() => void) | null = null;

  constructor(ctx: AudioContext | null) {
    this.ctx = ctx;
    if (ctx) {
      try {
        this.analyser = ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.connect(ctx.destination);
        this.buf = new Float32Array(this.analyser.fftSize);
      } catch {
        this.analyser = null;
      }
    }
  }

  /** 0..1 loudness of what Matt is saying right now */
  level(t: number): number {
    if (this.src && this.analyser && this.buf) {
      this.analyser.getFloatTimeDomainData(this.buf);
      let sum = 0;
      for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
      return Math.min(1, Math.sqrt(sum / this.buf.length) * 5);
    }
    // The device's own voice gives no audio to measure: a gentle talking rhythm instead
    if (this.synthOn) return 0.35 + 0.3 * Math.abs(Math.sin(t / 110)) * (0.6 + 0.4 * Math.sin(t / 370));
    return 0;
  }

  get speaking() {
    return !!this.src || this.synthOn;
  }

  /** Plays a WAV (base64); resolves when it ends or is stopped */
  async playWav(b64: string): Promise<void> {
    if (!this.ctx || !this.analyser) throw new Error('no audio');
    this.stop();
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    await this.ctx.resume?.().catch(() => {});
    const buffer = await this.ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
    return new Promise<void>(resolve => {
      const src = this.ctx!.createBufferSource();
      src.buffer = buffer;
      src.connect(this.analyser!);
      this.src = src;
      const done = () => {
        if (this.src === src) this.src = null;
        this.stopFn = null;
        resolve();
      };
      src.onended = done;
      this.stopFn = () => {
        try {
          src.onended = null;
          src.stop();
        } catch {
          /* already ended */
        }
        done();
      };
      src.start();
    });
  }

  /** The device's own voice (when the server voice is busy); resolves when done or stopped */
  speakOnDevice(text: string, kind: MattVoice): Promise<void> {
    if (typeof speechSynthesis === 'undefined' || !text) return Promise.resolve();
    this.stop();
    return new Promise<void>(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      const v = deviceVoice(kind);
      if (v) u.voice = v;
      u.lang = v?.lang || 'en-US';
      u.rate = 1.02;
      u.pitch = kind === 'male' ? 0.9 : 1.08;
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
      this.analyser?.disconnect();
    } catch {
      /* ignore */
    }
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  get context() {
    return this.ctx;
  }
}
