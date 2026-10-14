// Fundamental Analysis (/fundamental-analysis, owner-specified): while it is switched on, every prompt is answered with a
// fundamental read of the event or market asked about (CPI, NFP, PPI, rate decisions...): past releases, the news,
// the most likely outcome and the pairs it favours or works against. Shared by the server and the client.

export type FundamentalBias = 'FOR' | 'AGAINST' | 'NEUTRAL';
export type FundamentalStrength = 'HIGH' | 'MEDIUM' | 'LOW';
export type CurrencyImpact = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface FundamentalScenario {
  name: string;
  condition: string;
  /** 0 to 100; all scenarios add up to 100 */
  probability: number;
  /** What it does to the main currency / asset */
  impact: CurrencyImpact;
  explanation: string;
}

export interface FundamentalPair {
  symbol: string;
  name?: string;
  /** FOR = the most likely outcome favours the pair rising; AGAINST = it weighs on the pair */
  bias: FundamentalBias;
  strength: FundamentalStrength;
  reason: string;
  /** Live price at the time of the read (never written by the engine) */
  price?: number | null;
  change24h?: number | null;
}

export interface FundamentalRelease {
  period: string;
  actual: string;
  forecast?: string;
}

export interface FundamentalReport {
  event: string;
  region: string;
  /** Main currency or asset the event moves, e.g. USD */
  currency: string;
  category: string;
  status: 'UPCOMING' | 'RELEASED' | 'GENERAL';
  /** Release time as text (e.g. "Wed 15 Oct, 1:30 PM WAT"), or '' */
  releaseText: string;
  /** Release time (ms) when known from the economic calendar */
  releaseAt?: number | null;
  summary: string;
  data: { actual?: string; forecast?: string; previous?: string };
  history: FundamentalRelease[];
  drivers: string[];
  scenarios: FundamentalScenario[];
  mostLikely: { outcome: string; probability: number; reasoning: string; impact: CurrencyImpact };
  pairs: FundamentalPair[];
  risks: string[];
  /** 0 to 90: how firm the read is (never a certainty) */
  confidence: number;
  sources: string[];
  /** The web was searched for this read */
  web: boolean;
  generatedAt: number;
}

/** Quick prompts shown in the panel and the empty state */
export const FUNDAMENTAL_EXAMPLES: Array<{ label: string; prompt: string }> = [
  { label: 'US CPI', prompt: 'Analyze the next US CPI release' },
  { label: 'NFP', prompt: 'Analyze the next US Non-Farm Payrolls (NFP) report' },
  { label: 'US PPI', prompt: 'Analyze the next US PPI release' },
  { label: 'Fed decision', prompt: 'Analyze the next Federal Reserve (FOMC) rate decision' },
  { label: 'UK CPI', prompt: 'Analyze the next UK CPI release' },
  { label: 'ECB decision', prompt: 'Analyze the next ECB rate decision' },
  { label: 'US GDP', prompt: 'Analyze the next US GDP release' },
  { label: 'Retail sales', prompt: 'Analyze the next US retail sales release' },
];

export const BIAS_LABEL: Record<FundamentalBias, string> = { FOR: 'For', AGAINST: 'Against', NEUTRAL: 'Neutral' };
export const IMPACT_LABEL: Record<CurrencyImpact, string> = { BULLISH: 'Bullish', BEARISH: 'Bearish', NEUTRAL: 'Neutral' };
