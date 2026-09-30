// Timeframe helpers shared by the server strategy engine and the client (same parsing on both sides)
const SUPPORTED = ['1M', '3M', '5M', '15M', '30M', '1H', '2H', '4H', '6H', '8H', '12H', '1D', '1W'];

/** Minutes in a normalised timeframe ("15M", "4H", "1D", "1W"). */
export function timeframeMinutes(tf: string): number {
  const m = /^(\d+)([MHDW])$/.exec(tf);
  if (!m) return 240;
  const n = Number(m[1]);
  return m[2] === 'M' ? n : m[2] === 'H' ? n * 60 : m[2] === 'D' ? n * 1440 : n * 10080;
}

/** Snaps any timeframe to the nearest supported one (e.g. "3H" → "4H", "45M" → "30M"). */
export function normalizeTimeframe(tf: string | null | undefined): string {
  const clean = String(tf || '').trim().toUpperCase();
  if (SUPPORTED.includes(clean)) return clean;
  if (!/^\d+[MHDW]$/.test(clean)) return '4H';
  const target = timeframeMinutes(clean);
  let best = '4H';
  let bestDiff = Infinity;
  for (const s of SUPPORTED) {
    const d = Math.abs(Math.log(timeframeMinutes(s) / target));
    if (d < bestDiff) {
      bestDiff = d;
      best = s;
    }
  }
  return best;
}

/** Reads a timeframe written in the prompt ("on the 1H", "15 min", "H4", "daily", "weekly"). */
export function timeframeFromPrompt(text: string): string | null {
  const t = ` ${String(text || '').toLowerCase()} `;
  let m = /(?:^|[^a-z0-9])(\d{1,2})\s*(?:m|min|mins|minute|minutes)(?![a-z0-9])/.exec(t);
  if (m) return normalizeTimeframe(`${m[1]}M`);
  m = /(?:^|[^a-z0-9])(\d{1,2})\s*(?:h|hr|hrs|hour|hours)(?![a-z0-9])/.exec(t);
  if (m) return normalizeTimeframe(`${m[1]}H`);
  m = /(?:^|[^a-z0-9])(\d)\s*(?:d|day|days)(?![a-z0-9])/.exec(t);
  if (m) return normalizeTimeframe(`${m[1]}D`);
  m = /(?:^|[^a-z0-9])(\d)\s*(?:w|wk|week|weeks)(?![a-z0-9])/.exec(t);
  if (m) return normalizeTimeframe(`${m[1]}W`);
  m = /(?:^|[^a-z0-9])([mhdw])(\d{1,2})(?![a-z0-9])/.exec(t); // MT4 style: M15, H1, H4, D1, W1
  if (m) return normalizeTimeframe(`${m[2]}${m[1].toUpperCase()}`);
  if (/\bhourly\b/.test(t)) return '1H';
  if (/\bdaily\b/.test(t)) return '1D';
  if (/\bweekly\b/.test(t)) return '1W';
  return null;
}
