// Notification chime for new watchlist setups, synthesised with Web Audio (no audio file to download).
// Browsers only allow sound after the reader has touched the page, so the audio is unlocked on the first tap or key.
// The on/off choice is per device (localStorage); phones that support it also get a short vibration.

const KEY = 'mx.watchSound';
type Ctx = AudioContext;
let ctx: Ctx | null = null;

export function watchSoundOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setWatchSound(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {}
}

function audio(): Ctx | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const C = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!C) return null;
  try {
    ctx = new C() as Ctx;
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Unlocks audio on the first tap or key press (iOS needs a sound started inside a user gesture) */
export function primeSound() {
  if (typeof window === 'undefined') return;
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    const c = audio();
    if (!c) return;
    c.resume?.().catch(() => {});
    try {
      const src = c.createBufferSource();
      src.buffer = c.createBuffer(1, 1, 22050);
      src.connect(c.destination);
      src.start(0);
    } catch {}
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

/** "ready": a bright rising three-note chime; "building": a softer two-note one */
export function playChime(kind: 'ready' | 'building', force = false) {
  if (!force && !watchSoundOn()) return;
  try {
    (navigator as any).vibrate?.(kind === 'ready' ? [40, 50, 70] : 35);
  } catch {}
  const c = audio();
  if (!c) return;
  if (c.state === 'suspended') c.resume?.().catch(() => {});
  const notes = kind === 'ready' ? [880, 1108.73, 1318.51] : [659.25, 880];
  const t0 = c.currentTime + 0.02;
  const master = c.createGain();
  master.gain.value = kind === 'ready' ? 0.2 : 0.14;
  master.connect(c.destination);
  notes.forEach((f, i) => {
    const t = t0 + i * 0.11;
    for (const [type, mult, level] of [['sine', 1, 1], ['triangle', 2, 0.18]] as const) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = f * mult;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.75);
    }
  });
}
