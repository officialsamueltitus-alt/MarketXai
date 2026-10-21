// Voice input helpers (owner-specified, free): turn what the trader said into the prompt they meant, and the small
// audio pieces the recorder fallback needs (16 kHz mono WAV for the server's speech-to-text).

const NUM: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', eight: '8', twelve: '12', fifteen: '15', thirty: '30',
};
const NUM_WORDS = Object.keys(NUM).join('|');

// Currency names as people say them → ISO codes (longest names first so "australian dollar" wins over "dollar")
const CURRENCIES: [string, string][] = [
  ['australian dollar|aussie dollar|aussie|aud', 'AUD'],
  ['new zealand dollar|kiwi dollar|kiwi|nzd', 'NZD'],
  ['canadian dollar|loonie|cad', 'CAD'],
  ['swiss franc|swissy|franc|chf', 'CHF'],
  ['japanese yen|yen|jpy', 'JPY'],
  ['british pound|pound sterling|pounds|pound|sterling|gbp', 'GBP'],
  ['euros|euro|eur', 'EUR'],
  ['us dollars|us dollar|u\\.s\\. dollar|american dollar|dollars|dollar|usd', 'USD'],
];
const CUR_ALT = CURRENCIES.map(([n]) => n).join('|');
const codeOf = (name: string) => CURRENCIES.find(([n]) => new RegExp(`^(?:${n})$`, 'i').test(name))?.[1] || null;

/** Spoken tool requests ("open my watchlist") → the slash command id they mean */
const TOOL_WORDS: [RegExp, string][] = [
  [/^watch ?list$/, 'watchlist'],
  [/^(price )?alerts?$/, 'alerts'],
  [/^(trade |trading )?journal$/, 'journal'],
  [/^track ?record$/, 'trackrecord'],
  [/^strategy builder$/, 'strategy'],
  [/^preferences?( mode)?$|^preference mode$|^settings$/, 'preference'],
  [/^fundamental analysis$|^fundamentals?$/, 'fundamental'],
  [/^token safety$|^safety check$/, 'safety'],
  [/^matt$/, 'matt'],
];

export function voiceCommand(text: string): string | null {
  const m = /^(?:please\s+|hey marketx,?\s+)?(?:open|show(?: me)?|go to|launch|take me to|bring up)\s+(?:my\s+|the\s+)?([a-z ]+?)[.!?]*$/i.exec(text.trim());
  if (!m) return null;
  const what = m[1].toLowerCase().trim();
  for (const [re, id] of TOOL_WORDS) if (re.test(what)) return id;
  return null;
}

/**
 * Cleans up what the speech engine wrote so MarketX reads it like a typed prompt:
 * "analyze euro dollar on the four-hour chart" → "Analyze EURUSD on the 4 hour chart",
 * "fundamental analysis on CPI" → "/fundamental-analysis CPI".
 */
export function normalizeSpokenPrompt(raw: string, opts: { commands?: boolean } = {}): string {
  let t = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.。]+$/, '');
  if (!t) return '';

  // Spelled-out letters: "e u r u s d" / "e.u.r." → "EURUSD"
  t = t.replace(/\b(?:[a-z]\.?\s+){2,}[a-z]\b\.?/gi, m => m.replace(/[\s.]/g, '').toUpperCase());

  // Currency pairs: "euro dollar", "pound against the yen", "dollar slash yen", "aussie dollar"
  t = t.replace(new RegExp(`\\b(${CUR_ALT})\\s*(?:\\/|-|slash|versus|vs\\.?|against)?\\s*(?:the\\s+)?(${CUR_ALT})\\b`, 'gi'), (all, a, b) => {
    const x = codeOf(a);
    const y = codeOf(b);
    return x && y && x !== y ? `${x}${y}` : all;
  });
  t = t.replace(/\bcable\b/gi, 'GBPUSD');

  // Indices, metals
  t = t
    .replace(/\bnas(?:daq)?\s*(?:one hundred|hundred|100)\b/gi, 'NAS100')
    .replace(/\b(?:us\s*(?:thirty|30)|dow jones|the dow)\b/gi, 'US30')
    .replace(/\b(?:s\s*(?:and|&)\s*p|s&p)\s*(?:five hundred|500)?\b/gi, 'SPX500')
    .replace(/\b(?:dax|germany|ger)\s*(?:forty|40)\b/gi, 'GER40')
    .replace(/\b(?:xau|gold)\s*(?:\/|slash|versus|vs|against)?\s*(?:usd|us dollars?|dollars?)\b/gi, 'XAUUSD')
    .replace(/\b(?:xag|silver)\s*(?:\/|slash|versus|vs|against)\s*(?:usd|us dollars?|dollars?)\b/gi, 'XAGUSD');

  // Timeframes: "four-hour" / "fifteen minute" / "4-hour" → "4 hour" (the server reads "4 hour", "15 min", "daily")
  t = t
    .replace(new RegExp(`\\b(${NUM_WORDS})(?:\\s|-)(minutes?|mins?|hours?|hrs?|days?|weeks?)\\b`, 'gi'), (_, n, u) => `${NUM[n.toLowerCase()]} ${u}`)
    .replace(/\b(\d{1,2})-(minutes?|mins?|hours?|hrs?|days?|weeks?)\b/gi, '$1 $2')
    .replace(/\b(an|one) hour chart\b/gi, '1 hour chart');

  // Tools by voice
  if (opts.commands !== false) {
    const fa = /^(?:please\s+)?(?:do\s+(?:a\s+)?)?(?:run\s+(?:a\s+)?)?(?:fundamental analysis|check fundamentals?)\s+(?:on|of|for|about)?\s*(.+)$/i.exec(t);
    if (fa && fa[1].trim()) return `/fundamental-analysis ${fa[1].trim()}`;
    const ts = /^(?:please\s+)?(?:token safety|safety check|run a safety check|rug check)\s+(?:on|of|for)?\s*(.+)$/i.exec(t);
    if (ts && ts[1].trim()) return `/token-safety ${ts[1].trim()}`;
  }
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---------------------------------------------------------------------------
// Audio for the recorder fallback
// ---------------------------------------------------------------------------
export const VOICE_SAMPLE_RATE = 16000;

/** Mono 16-bit PCM WAV */
export function encodeWav(samples: Float32Array, sampleRate = VOICE_SAMPLE_RATE): ArrayBuffer {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Decodes a recorded clip (webm/ogg/mp4) and resamples it to 16 kHz mono */
export async function clipToWav(blob: Blob): Promise<ArrayBuffer> {
  const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
  const ctx = new AC();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const length = Math.max(1, Math.ceil(decoded.duration * VOICE_SAMPLE_RATE));
    const off = new OfflineAudioContext(1, length, VOICE_SAMPLE_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return encodeWav(rendered.getChannelData(0));
  } finally {
    ctx.close().catch(() => {});
  }
}
