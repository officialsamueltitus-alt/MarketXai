// One price format for every card, chart, email and share text. Owner-specified: prices show exactly as their source
// sends them, never rounded. Only thousands separators are added, and tiny meme-coin prices are written out in full
// (0.0000009645, never 9.645e-7).

/** Decimal places for prices around `ref` (kept for layout helpers, e.g. chart axis labels; not used to round prices) */
export function priceDigits(ref: number): number {
  const a = Math.abs(Number(ref));
  if (!Number.isFinite(a) || a === 0) return 2;
  if (a >= 10) return 2;
  if (a >= 1) return 4;
  if (a >= 0.01) return 5;
  return Math.min(12, Math.ceil(-Math.log10(a)) + 3);
}

/** Writes a number out in plain decimal digits (no exponent), keeping every digit it has */
function plainDigits(abs: number): string {
  const s = abs.toString();
  // JavaScript writes very small and very large numbers as d.ddde±x
  const m = /^(\d)(?:\.(\d+))?e([+-]\d+)$/i.exec(s);
  if (!m) return s;
  const digits = m[1] + (m[2] || '');
  const e = Number(m[3]);
  return e < 0 ? `0.${'0'.repeat(-e - 1)}${digits}` : digits + '0'.repeat(Math.max(0, e - (digits.length - 1)));
}

/**
 * A price exactly as fetched: every digit the source sent, with thousands separators. Floating-point noise from
 * arithmetic (0.30000000000000004) is cleaned at 15 significant digits, beyond anything a market feed sends.
 */
export function exactPrice(p: number | null | undefined): string {
  const n = Number(p);
  if (!Number.isFinite(n)) return '-';
  const clean = Number(n.toPrecision(15));
  const abs = Math.abs(clean);
  const text = plainDigits(abs);
  const [int, frac] = text.split('.');
  return `${clean < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac ? `.${frac}` : ''}`;
}

/** Every price on the site: shown exactly as fetched (the `ref` argument is kept for older callers and ignored) */
export function formatMarketPrice(p: number | null | undefined, _ref?: number): string {
  return exactPrice(p);
}
