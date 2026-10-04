// Preference Mode: the shape and defaults shared by the server (validation, storage) and the client (panel, cards).
export type Currency = 'USD' | 'NGN' | 'EUR' | 'GBP';
export interface Preferences {
  timeframe: string;
  slMode: 'normal' | 'tight';
  accountSize: number | null;
  currency: Currency;
  riskPct: number;
  view: 'DETAILED' | 'SIMPLE';
  homeMarket: 'all' | 'forex' | 'stock' | 'crypto' | 'commodity';
  backtestExit: 'SCALE' | 'TP1' | 'TP2' | 'TP3';
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
  backtestExit: 'SCALE',
};


/** Stored preferences with every missing field filled in */
export function withDefaults(p: Partial<Preferences> | null | undefined): Preferences {
  return { ...DEFAULT_PREFERENCES, ...(p && typeof p === 'object' ? p : {}) };
}

const SYMBOL: Record<Currency, string> = { USD: '$', NGN: '₦', EUR: '€', GBP: '£' };
/** Money in the trader's account currency, 2 decimals, thousands separators (money is not a price) */
export function formatMoney(n: number, currency: Currency): string {
  const v = Number.isFinite(n) ? n : 0;
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${v < 0 ? '-' : ''}${SYMBOL[currency] || ''}${s}`;
}
