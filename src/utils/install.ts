// "Add MarketX to your home screen" (owner-specified): after sign-in the app offers to install MarketX as a web app.
// Chrome, Edge and Samsung Internet fire `beforeinstallprompt`, which is kept here (from the first moment the app loads)
// so the Install button can open the browser's own install window. iPhone/iPad and other browsers get the steps instead.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    // Keep the browser's own mini bar away: MarketX asks at the right moment instead
    e.preventDefault();
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    try {
      localStorage.setItem(INSTALLED_KEY, String(Date.now()));
    } catch {}
    notify();
  });
}

const DISMISS_KEY = 'mx.install.dismissedAt';
const INSTALLED_KEY = 'mx.install.installedAt';
/** After "Not now" the request waits this long before it shows again */
export const INSTALL_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export const isStandalone = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches || (navigator as any).standalone === true);

export type InstallPlatform = 'prompt' | 'ios-safari' | 'ios-other' | 'android' | 'mac-safari' | 'none';
export function installPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'none';
  if (deferred) return 'prompt';
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? 'ios-other' : 'ios-safari';
  if (/Android/.test(ua)) return 'android';
  if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return 'mac-safari';
  return 'none';
}

/** Should the request show now: not installed, not running as the app, not snoozed, and there's a way to install */
export function shouldAskInstall(): boolean {
  if (isStandalone()) return false;
  try {
    if (localStorage.getItem(INSTALLED_KEY)) return false;
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (at && Date.now() - at < INSTALL_SNOOZE_MS) return false;
  } catch {}
  return installPlatform() !== 'none';
}

export function snoozeInstall() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {}
}

/** Opens the browser's install window (Chrome, Edge, Samsung); 'unavailable' when the browser gave none */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
  if (outcome === 'accepted') {
    try {
      localStorage.setItem(INSTALLED_KEY, String(Date.now()));
    } catch {}
  }
  notify();
  return outcome;
}

export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
