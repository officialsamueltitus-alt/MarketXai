// Preference Mode: the shape and defaults shared by the server (validation, storage) and the client (panel, cards).
import { SUPPORTED_TIMEFRAMES } from './timeframe';

export type Currency = 'USD' | 'NGN' | 'EUR' | 'GBP';
export type AnalysisMode = 'NORMAL' | 'CONFIRMATION';
export interface Preferences {
  timeframe: string;
  slMode: 'normal' | 'tight';
  accountSize: number | null;
  currency: Currency;
  riskPct: number;
  view: 'DETAILED' | 'SIMPLE';
  homeMarket: 'all' | 'forex' | 'stock' | 'crypto' | 'commodity';
  /** Timeframes RDM scans, in engine order; empty = every timeframe (used by the analysis and the watchlist) */
  rdmTimeframes: string[];
  /** NORMAL: the engine's normal analysis. CONFIRMATION: waits for price to reach the zone and confirm on a lower
   *  timeframe (sweep, engulfing, pin bar, star, structure break) before calling a trade, stop beyond the reaction wick */
  analysisMode: AnalysisMode;
  updatedAt?: number;
}

export const DEFAULT_PREFERENCES: Preferences = {
  timeframe: '4H',
  slMode: 'normal',
  accountSize: null,
  currency: 'USD',
  riskPct: 1,
  view: 'DETAILED',
  homeMarket: 'all',
  rdmTimeframes: [],
  analysisMode: 'NORMAL',
};


/** Stored preferences with every missing field filled in */
export function withDefaults(p: Partial<Preferences> | null | undefined): Preferences {
  const out = { ...DEFAULT_PREFERENCES, ...(p && typeof p === 'object' ? p : {}) };
  out.rdmTimeframes = normalizeRdmTimeframes(out.rdmTimeframes) || [];
  if (out.analysisMode !== 'CONFIRMATION') out.analysisMode = 'NORMAL';
  // Fields of removed features never come back from storage
  delete (out as any).tradeLock;
  delete (out as any).tradeLockChosenAt;
  return out;
}

/**
 * A valid RDM timeframe choice: known timeframes only, no repeats, in engine order. Every timeframe (or none) is stored
 * as [] ("all"), so a timeframe added to the engine later is scanned too. null = not a list of known timeframes.
 */
export function normalizeRdmTimeframes(list: unknown): string[] | null {
  if (!Array.isArray(list)) return null;
  const want = new Set(list.map(x => String(x || '').trim().toUpperCase()));
  for (const tf of want) if (!SUPPORTED_TIMEFRAMES.includes(tf)) return null;
  const out = SUPPORTED_TIMEFRAMES.filter(tf => want.has(tf));
  return out.length === SUPPORTED_TIMEFRAMES.length ? [] : out;
}

/** The timeframes an RDM scan walks for this choice ([] = all of them) */
export function rdmFrames(choice: string[] | null | undefined): string[] {
  const c = normalizeRdmTimeframes(choice);
  return c && c.length ? c : [...SUPPORTED_TIMEFRAMES];
}

const tfShort = (tf: string) => tf.replace(/^(\d+)M$/, '$1m');
/** "All timeframes", or the chosen ones ("1H, 4H, 1D") */
export function rdmLabel(choice: string[] | null | undefined): string {
  const c = normalizeRdmTimeframes(choice);
  return !c || !c.length ? 'All timeframes' : c.map(tfShort).join(', ');
}

const SYMBOL: Record<Currency, string> = { USD: '$', NGN: '₦', EUR: '€', GBP: '£' };
/** Money in the trader's account currency, 2 decimals, thousands separators (money is not a price) */
export function formatMoney(n: number, currency: Currency): string {
  const v = Number.isFinite(n) ? n : 0;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}${SYMBOL[currency] || ''}${s}`;
}
