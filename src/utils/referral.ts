// Invite links (owner-specified): marketx.world/?ref=CODE. The code is remembered on this device for 30 days so
// the visitor can sign up later (email or Google) and still count as invited; the server checks it when the pass
// code is redeemed. Nothing here grants anything: rewards are decided on the server only.
const KEY = 'mx.ref';
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export const cleanRefCode = (raw: unknown): string | null => {
  const s = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return /^[A-Z0-9]{6,12}$/.test(s) ? s : null;
};

/** Reads ?ref= from the address (once, at load), keeps it, and removes it from the address bar */
export function captureRefFromUrl(): string | null {
  try {
    const url = new URL(window.location.href);
    const code = cleanRefCode(url.searchParams.get('ref'));
    if (!url.searchParams.has('ref')) return null;
    url.searchParams.delete('ref');
    window.history.replaceState(window.history.state, '', url.pathname + (url.search ? url.search : '') + url.hash);
    if (code) localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
    return code;
  } catch {
    return null;
  }
}

/** The invite code this device arrived with (if still fresh) */
export function storedRefCode(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!v || Date.now() - Number(v.at) > KEEP_MS) return null;
    return cleanRefCode(v.code);
  } catch {
    return null;
  }
}

export function clearRefCode() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const inviteLink = (code: string) => `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
