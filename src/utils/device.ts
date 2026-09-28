// Device signals sent with sign-up, sign-in and pass-code requests so the server can enforce
// "one device, one email". Nothing here identifies a person: a random id kept on this device and a hash of
// stable browser characteristics (never sent anywhere else).

const ID_KEY = 'mx_device_id';

function randomId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A random id stored on this device (created on first use). */
export function getDeviceId(): string | undefined {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      id = randomId();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

function canvasSignal(): string {
  try {
    const c = document.createElement('canvas');
    c.width = 220;
    c.height = 40;
    const g = c.getContext('2d');
    if (!g) return '';
    g.textBaseline = 'top';
    g.font = "16px 'Arial'";
    g.fillStyle = '#f60';
    g.fillRect(100, 1, 62, 20);
    g.fillStyle = '#069';
    g.fillText('MarketX device check', 2, 15);
    g.fillStyle = 'rgba(102, 204, 0, 0.7)';
    g.fillText('MarketX device check', 4, 17);
    return c.toDataURL();
  } catch {
    return '';
  }
}

let cachedFp: Promise<string | undefined> | null = null;

/** SHA-256 of stable browser/device characteristics (same in a private window on this device). */
export function getDeviceFingerprint(): Promise<string | undefined> {
  if (cachedFp) return cachedFp;
  cachedFp = (async () => {
    try {
      const n = navigator as any;
      const parts = [
        n.userAgent,
        n.platform,
        n.language,
        (n.languages || []).join(','),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        `${screen.width}x${screen.height}x${screen.colorDepth}`,
        window.devicePixelRatio,
        n.hardwareConcurrency,
        n.deviceMemory,
        n.maxTouchPoints,
        canvasSignal(),
      ].join('|');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts));
      return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return undefined;
    }
  })();
  return cachedFp;
}

/** `{ id, fp }` for request bodies. */
export async function deviceSignals(): Promise<{ id?: string; fp?: string }> {
  return { id: getDeviceId(), fp: await getDeviceFingerprint() };
}
