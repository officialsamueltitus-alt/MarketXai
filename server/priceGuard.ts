// ===========================================================================
// Price guard (owner-specified: live prices only, never an invented price or level). Runs on every written answer that
// leaves the server (analyses, Strategy Builder write-ups, question answers, Matt), after the answer is written:
//   1. "Price is now X" style claims are checked against the live price; a wrong one is corrected to the live price.
//   2. In trade write-ups, a sentence naming a price level that is not part of the verified plan (entry, stop, targets,
//      zones, Fibonacci, range, live price...) is removed, so the text can never point a trader at an invented level.
// It never changes the levels themselves, and never touches the analysis instructions.
// ===========================================================================
import { exactPrice } from '../src/utils/formatPrice';

const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;

/** Every finite number inside a result object (levels, zones, Fibonacci, ranges, live price...) */
export function numbersIn(obj: unknown, out: number[] = [], depth = 0): number[] {
  if (depth > 6 || obj == null) return out;
  if (typeof obj === 'number') {
    if (Number.isFinite(obj) && obj > 0) out.push(obj);
  } else if (Array.isArray(obj)) {
    for (const v of obj.slice(0, 400)) numbersIn(v, out, depth + 1);
  } else if (typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) numbersIn(v, out, depth + 1);
  }
  return out;
}

const parse = (s: string) => Number(s.replace(/,/g, ''));
/** Digits that carry meaning (a price like 96,452.78 has 7; a ratio like 0.618 has 3) */
const sigDigits = (s: string) => s.replace(/[^0-9]/g, '').replace(/^0+/, '').length;

// Phrases that state the price right now
const CLAIM = new RegExp(
  String.raw`\b((?:is |are |was )?(?:currently |now )?(?:trading|trades|sits|sitting|priced|quoted|changing hands|hovering)\s+(?:at|around|near|close to|just (?:above|below))|(?:current|live|spot|last|latest) price(?: of [A-Z0-9/ ]{2,15})?(?: is| of| at| sits at| stands at)?|price is (?:currently |now )?(?:at |around |near )?|is (?:currently|now) (?:at|around|near)|now at)\s*(?:~|≈|about|roughly|approximately)?\s*\$?\s*(${NUM})`,
  'gi'
);

/** Corrects "trading at X" claims that are off the live price by more than `tol` (0.6% by default) */
export function fixPriceClaims(text: string, live: number | null | undefined, tol = 0.006): string {
  if (!text || !live || !(live > 0)) return text;
  return text.replace(CLAIM, (whole, lead: string, num: string) => {
    const v = parse(num);
    if (!Number.isFinite(v) || v <= 0) return whole;
    // Only numbers that read as this market's price (not percentages, ratios or other markets)
    if (v < live * 0.2 || v > live * 5) return whole;
    if (Math.abs(v - live) / live <= tol) return whole;
    return whole.slice(0, whole.length - num.length) + exactPrice(live);
  });
}

/**
 * Removes sentences that name a price level (a number that reads as this market's price, with 4+ significant digits)
 * that is not one of the verified numbers. R multiples, percentages, ATR counts and ratios are left alone.
 * Returns the cleaned text and how many sentences were removed.
 */
export function dropUnknownLevels(text: string, known: number[], price: number, tol = 0.0015): { text: string; removed: string[] } {
  if (!text || !(price > 0)) return { text, removed: [] };
  const ks = known.filter(k => k > price * 0.3 && k < price * 3);
  const isKnown = (v: number) => ks.some(k => Math.abs(v - k) / k <= tol);
  const tokenRe = new RegExp(String.raw`(?<![\w.:/-])(${NUM})(?!\w|\.\d|\s*(?:R\b|%|x\b|×|ATR\b|R:R|bps|pips?\b|candles?\b|bars?\b|days?\b|hours?\b))`, 'g');
  const unknownIn = (sentence: string) => {
    // A crossed-out number (~~96,079.88~~) is an old level shown for comparison, not a level to act on
    sentence = sentence.replace(/~~[^~]*~~/g, ' ');
    for (const m of sentence.matchAll(tokenRe)) {
      const raw = m[1];
      const v = parse(raw);
      if (!Number.isFinite(v) || v < price * 0.5 || v > price * 2) continue;
      if (sigDigits(raw) < 4) continue;
      if (!isKnown(v)) return true;
    }
    return false;
  };
  const removed: string[] = [];
  const lines = text.split('\n').map(line => {
    if (!unknownIn(line)) return line;
    // Keep the sentences of the line that are fine
    const parts = line.split(/(?<=[.!?])\s+(?=[A-Z*(#\-])/);
    const kept = parts.filter(p => {
      if (!unknownIn(p)) return true;
      removed.push(p.trim());
      return false;
    });
    return kept.join(' ');
  });
  return { text: lines.filter((l, i) => !(l.trim() === '' && text.split('\n')[i].trim() !== '')).join('\n'), removed };
}

/** Both checks on a trade result's text fields (message + detailed thesis), against its own verified numbers */
export function guardResultText(body: any, live: number | null): { removed: string[] } {
  const s = body?.strategy;
  const price = Number(s?.currentPrice) || Number(live) || 0;
  const removed: string[] = [];
  const isTrade = s && (s.tradeType === 'LONG' || s.tradeType === 'SHORT' || s.tradeType === 'NO_SIGNAL');
  const known = isTrade ? [...numbersIn(s), ...(live && live > 0 ? [live] : [])] : [];
  const clean = (t: unknown) => {
    if (typeof t !== 'string' || !t) return t;
    // "Price now" claims are judged against the live feed price (a chart's own price can differ in chart mode)
    let out = fixPriceClaims(t, (live && live > 0 ? live : 0) || price);
    if (isTrade && price > 0) {
      const d = dropUnknownLevels(out, known, price);
      out = d.text;
      removed.push(...d.removed);
    }
    return out;
  };
  if (typeof body?.message === 'string') body.message = clean(body.message);
  if (s && typeof s.detailedThesis === 'string') s.detailedThesis = clean(s.detailedThesis);
  return { removed };
}
