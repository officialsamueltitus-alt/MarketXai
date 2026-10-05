// Phone / desktop notifications (web push): the device's own notification with its own sound, even when MarketX is
// closed. Android and desktop browsers work straight away; iPhone and iPad need MarketX added to the Home Screen
// (iOS 16.4+) and opened from there. The switch is per device; the server keeps one subscription per device.
import { apiFetch } from './apiClient';

export type PushState = 'unsupported' | 'ios-install' | 'off' | 'on' | 'blocked';
const FLAG = 'mx.push';

const isIOS = () => typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const standalone = () =>
  typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true);
const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function flag(v?: boolean): boolean {
  try {
    if (v !== undefined) localStorage.setItem(FLAG, v ? 'on' : 'off');
    return localStorage.getItem(FLAG) === 'on';
  } catch {
    return false;
  }
}

function keyBytes(b64: string): Uint8Array {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) => !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i]);

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  return existing || navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

let keyCache: Promise<string | null> | null = null;
function serverKey(): Promise<string | null> {
  if (!keyCache) keyCache = apiFetch<{ enabled: boolean; publicKey: string | null }>('/api/push/key').then(r => (r.enabled ? r.publicKey : null)).catch(() => (keyCache = null));
  return keyCache;
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return isIOS() && !standalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted' || !flag()) return 'off';
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

async function subscribe(): Promise<boolean> {
  const key = await serverKey();
  if (!key) return false;
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const want = keyBytes(key);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older server key would be refused by the push service: renew it
  if (sub && !sameKey(sub.options?.applicationServerKey, want)) {
    await sub.unsubscribe().catch(() => {});
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  await apiFetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
  return true;
}

/** Asks once for permission (must run from a tap), then links this device to the signed-in trader */
export async function enablePush(): Promise<PushState> {
  if (!supported()) return pushState();
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'off';
  flag(true);
  try {
    const ok = await subscribe();
    if (!ok) flag(false);
    return ok ? 'on' : 'off';
  } catch (err) {
    flag(false);
    throw err;
  }
}

export async function disablePush(): Promise<PushState> {
  flag(false);
  if (!supported()) return pushState();
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await apiFetch('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return pushState();
}

/** After sign-in: a device that has notifications on is linked to whoever is signed in now (and renewed if needed) */
export async function syncPush(): Promise<void> {
  try {
    if (supported() && flag() && Notification.permission === 'granted') await subscribe();
  } catch {}
}

/** Before sign-out: this device stops getting the trader's notices (the switch stays on for the next sign-in) */
export async function unlinkPush(): Promise<void> {
  try {
    if (!supported()) return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await apiFetch('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
  } catch {}
}

export async function sendTestPush(): Promise<{ ok: boolean; message?: string }> {
  try {
    const r = await apiFetch<{ ok: boolean }>('/api/push/test', { method: 'POST' });
    return { ok: r.ok };
  } catch (e: any) {
    return { ok: false, message: e?.message };
  }
}

/** Messages from the service worker: a push arrived (refresh now) or a notification was tapped (open its link) */
export function onPushMessages(handlers: { push: () => void; open: (url: string) => void }): () => void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
  const fn = (e: MessageEvent) => {
    const d = e.data || {};
    if (d.type === 'mx-push') handlers.push();
    else if (d.type === 'mx-open' && typeof d.url === 'string' && d.url.startsWith('/')) handlers.open(d.url);
  };
  navigator.serviceWorker.addEventListener('message', fn);
  return () => navigator.serviceWorker.removeEventListener('message', fn);
}
