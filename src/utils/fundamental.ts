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

/** Quick topics shown in the panel; each is sent as "/fundamental-analysis <prompt>" */
export const FUNDAMENTAL_EXAMPLES: Array<{ label: string; prompt: string }> = [
  { label: 'US CPI', prompt: 'next US CPI release' },
  { label: 'NFP', prompt: 'next US Non-Farm Payrolls (NFP)' },
  { label: 'US PPI', prompt: 'next US PPI release' },
  { label: 'Fed decision', prompt: 'next Federal Reserve (FOMC) rate decision' },
  { label: 'UK CPI', prompt: 'next UK CPI release' },
  { label: 'ECB decision', prompt: 'next ECB rate decision' },
  { label: 'US GDP', prompt: 'next US GDP release' },
  { label: 'Retail sales', prompt: 'next US retail sales release' },
];

/** The command that asks for a fundamental read: "/fundamental-analysis CPI" (or the short "/ch-fd CPI") */
export const FUNDAMENTAL_COMMAND = '/fundamental-analysis';
const COMMAND_RE = /^\s*\/(fundamental-analysis|fundamental|fundamentals|ch-fd)(?=\s|$)\s*/i;
/**
 * The topic after the command ("CPI" for "/fundamental-analysis CPI"; '' for the bare command), or null when the
 * prompt doesn't start with it. Only prompts that start with the command get a fundamental read; everything else is a
 * normal analysis or question, whether Fundamental Analysis is on or not.
 */
export function fundamentalTopic(prompt: string): string | null {
  const m = COMMAND_RE.exec(String(prompt || ''));
  return m ? String(prompt).slice(m[0].length).trim() : null;
}
export const fundamentalPrompt = (topic: string) => `${FUNDAMENTAL_COMMAND} ${topic.trim()}`;

export const BIAS_LABEL: Record<FundamentalBias, string> = { FOR: 'For', AGAINST: 'Against', NEUTRAL: 'Neutral' };
export const IMPACT_LABEL: Record<CurrencyImpact, string> = { BULLISH: 'Bullish', BEARISH: 'Bearish', NEUTRAL: 'Neutral' };
