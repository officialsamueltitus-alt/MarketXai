// Preference Mode: the shape and defaults shared by the server (validation, storage) and the client (panel, cards).
import { SUPPORTED_TIMEFRAMES } from './timeframe';
import { readStyleTimeframes, readTradeStyle, type StyleTimeframes, type TradeStyle } from './tradeStyle';

export type Currency = 'USD' | 'NGN' | 'EUR' | 'GBP';
export type AnalysisMode = 'NORMAL' | 'CONFIRMATION';
/** How the engine runs an analysis: the analysis mode, or Normal with Steady mode on (server-side and watchlist only) */
export type EngineMode = AnalysisMode | 'STEADY';
export type NewsImpact = 'HIGH' | 'MEDIUM' | 'LOW';
export const NEWS_IMPACTS: NewsImpact[] = ['HIGH', 'MEDIUM', 'LOW'];
/** Daily news alerts: a notification and an email each morning with the day's releases of the chosen impacts */
export interface NewsAlertsPref {
  enabled: boolean;
  /** Which impacts to include; all three = "All" */
  impacts: NewsImpact[];
}
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
  /** Trade type: ANY (default), SCALP, DAY or SWING (src/utils/tradeStyle.ts): the timeframes analyses and the watchlist
   *  use, and the 9:00 PM WAT close for day and swing trades */
  tradeStyle: TradeStyle;
  /** The timeframes the trader keeps for each trade type ([] = all of that type's). While a type is on, its choice
   *  overrides every other timeframe (composer, RDM, watchlist, Strategy Builder) */
  styleTimeframes: Required<StyleTimeframes>;
  /** Daily news alerts (off by default) */
  newsAlerts: NewsAlertsPref;
  /** Secure half (owner-specified, off by default): at +1R take half off and move the stop to entry. Shown on trade
   *  cards; price alerts started while it is on follow it (a +1R notice, the stop at entry) and the journal / track
   *  record score the trade that way (half at +1R, the rest at the target, or at entry) */
  secureHalf: boolean;
  /** Buyers vs Sellers gauge on analysis cards (owner-specified: hidden unless the trader turns it on) */
  pressureMeter: boolean;
  /** Steady mode (owner-specified option C, off by default, Normal analysis only): stop room x3 with the same entry and
   *  targets, limit entries only, 1H and 4H only, no entries in a hot market. Wins more often, makes less per trade */
  steadyMode: boolean;
  /** Wider stop loss (owner-specified, off by default): every trade's stop gets a little extra room (a share of the risk,
   *  at least a couple of pips) past the stop the analysis called, marked "widened" on the card */
  wideSl: boolean;
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
  tradeStyle: 'ANY',
  styleTimeframes: { SCALP: [], DAY: [], SWING: [] },
  newsAlerts: { enabled: false, impacts: ['HIGH'] },
  secureHalf: false,
  pressureMeter: false,
  steadyMode: false,
  wideSl: false,
};

/** A valid impact choice (known impacts, no repeats, high first), or null; at least one */
export function normalizeNewsImpacts(list: unknown): NewsImpact[] | null {
  if (!Array.isArray(list)) return null;
  const want = new Set(list.map(x => String(x || '').trim().toUpperCase()));
  for (const x of want) if (!(NEWS_IMPACTS as string[]).includes(x)) return null;
  const out = NEWS_IMPACTS.filter(x => want.has(x));
  return out.length ? out : null;
}
export function readNewsAlerts(v: any): NewsAlertsPref {
  return { enabled: v?.enabled === true, impacts: normalizeNewsImpacts(v?.impacts) || ['HIGH'] };
}
/** "High impact", "High and medium impact", "All impacts" */
export function newsImpactLabel(list: NewsImpact[]): string {
  if (list.length === 3) return 'All impacts';
  const names = list.map((x, i) => (i ? x.toLowerCase() : x.charAt(0) + x.slice(1).toLowerCase()));
  return `${names.join(' and ')} impact`;
}


/** Stored preferences with every missing field filled in */
export function withDefaults(p: Partial<Preferences> | null | undefined): Preferences {
  const out = { ...DEFAULT_PREFERENCES, ...(p && typeof p === 'object' ? p : {}) };
  out.rdmTimeframes = normalizeRdmTimeframes(out.rdmTimeframes) || [];
  if (out.analysisMode !== 'CONFIRMATION') out.analysisMode = 'NORMAL';
  out.tradeStyle = readTradeStyle(out.tradeStyle);
  out.styleTimeframes = readStyleTimeframes(out.styleTimeframes);
  out.newsAlerts = readNewsAlerts(out.newsAlerts);
  out.secureHalf = out.secureHalf === true;
  out.pressureMeter = out.pressureMeter === true;
  out.steadyMode = out.steadyMode === true;
  out.wideSl = out.wideSl === true;
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

/** The engine mode an analysis runs in: Confirmation, or Normal with Steady mode on, or plain Normal */
export function engineModeOf(p: Pick<Preferences, 'analysisMode' | 'steadyMode'>): EngineMode {
  return p.analysisMode === 'CONFIRMATION' ? 'CONFIRMATION' : p.steadyMode ? 'STEADY' : 'NORMAL';
}
