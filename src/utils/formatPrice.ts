// One price format for every card, chart and share text, readable from Bitcoin down to meme coins priced in
// billionths of a dollar (four significant digits below one cent, so 0.00000812 never shows as 0.0000).

/** Decimal places for prices around `ref` */
export function priceDigits(ref: number): number {
  const a = Math.abs(Number(ref));
  if (!Number.isFinite(a) || a === 0) return 2;
  if (a >= 10) return 2;
  if (a >= 1) return 4;
  if (a >= 0.01) return 5;
  return Math.min(12, Math.ceil(-Math.log10(a)) + 3);
}

/** Formats `p` with the precision of `ref` (the asset's current price), so every level on one card lines up. */
export function formatMarketPrice(p: number | null | undefined, ref?: number): string {
  const n = Number(p);
  if (!Number.isFinite(n)) return '-';
  const digits = priceDigits(ref ?? n);
  return Math.abs(ref ?? n) >= 10
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toFixed(digits);
}
