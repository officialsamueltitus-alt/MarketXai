// Fundamental Analysis (/fundamental-analysis, owner-specified): while it is switched on, a prompt that starts with the
// command is answered with a fundamental read of the event or market asked about (CPI, NFP, PPI, rate decisions...): past
// releases, the news, the most likely outcome and the pairs it favours or works against. Shared by the server and the client.

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
  /** What was asked (the topic after the command), so the read can be rechecked later */
  question?: string;
  /** Set when this read came from "Recheck": how it compares with the earlier read */
  recheck?: FundamentalRecheck;
  /** On a recheck: what changed since the earlier read, in a sentence or two ('' when nothing did) */
  whatsNew?: string;
}

/** "Recheck" on a fundamental card: has the release come out, is the forecast the same, does the read still hold */
export interface FundamentalRecheck {
  state: 'RELEASED' | 'STILL_VALID' | 'CHANGED';
  /** One line: "Released: 0.1% vs forecast 0.2%", "Not released yet", ... */
  headline: string;
  /** What changed, or what was confirmed */
  lines: string[];
  /** Release time still ahead (ms), when known */
  dueAt?: number | null;
  checkedAt: number;
  /** When the earlier read was made */
  previousAt?: number | null;
  /** Headlines published since the earlier read (source, title, time) */
  news?: Array<{ source: string; title: string; at: number }>;
}

/** The parts of an earlier read a recheck compares against */
export type FundamentalPrevious = Pick<FundamentalReport, 'event' | 'status'> & {
  generatedAt?: number;
  data?: { actual?: string; forecast?: string };
  mostLikely?: { outcome?: string; probability?: number; impact?: CurrencyImpact };
  pairs?: Array<{ symbol: string; bias: FundamentalBias }>;
};

const norm = (v?: string) => String(v || '').toLowerCase().replace(/\s+/g, '').replace(/[()]/g, '');
const figure = (v?: string) => {
  const m = /-?\d+(?:\.\d+)?/.exec(String(v || '').replace(/,/g, ''));
  return m ? Number(m[0]) : null;
};

/** Compares a fresh read with the earlier one (shared so the server and tests agree) */
export function compareReads(prev: FundamentalPrevious | null, next: FundamentalReport, now = Date.now()): FundamentalRecheck {
  const lines: string[] = [];
  let changed = false;
  const actual = next.data?.actual?.trim();
  const forecast = next.data?.forecast?.trim();
  const released = !!actual || next.status === 'RELEASED';
  const dueAt = !released && next.releaseAt && next.releaseAt > now ? next.releaseAt : null;
  let headline: string;
  if (released) {
    const a = figure(actual), f = figure(forecast);
    const vs = a !== null && f !== null ? (Math.abs(a - f) < 1e-9 ? ', in line with the forecast' : a > f ? ', above the forecast' : ', below the forecast') : '';
    headline = actual ? `Released: ${actual}${forecast ? ` vs forecast ${forecast}` : ''}${vs}` : 'Released';
    if (prev?.mostLikely?.outcome && prev.status !== 'RELEASED' && !prev.data?.actual) lines.push(`Your earlier read expected: ${prev.mostLikely.outcome}${prev.mostLikely.probability ? ` (${prev.mostLikely.probability}%)` : ''}`);
    lines.push('The read below is updated for the released figure.');
  } else if (next.releaseAt && next.releaseAt <= now) {
    headline = "The release time has passed, but the figure isn't confirmed yet";
  } else headline = next.status === 'GENERAL' ? 'No single release: the outlook was read again' : 'Not released yet';

  if (prev) {
    const pf = prev.data?.forecast?.trim();
    if (pf && forecast) {
      if (norm(pf) === norm(forecast)) lines.push(`Forecast unchanged at ${forecast}`);
      else {
        lines.push(`Forecast changed: ${pf} → ${forecast}`);
        changed = true;
      }
    } else if (!pf && forecast) lines.push(`Forecast now ${forecast}`);
    const pm = prev.mostLikely;
    const nm = next.mostLikely;
    if (!released && pm?.outcome && nm?.outcome) {
      const same = norm(pm.outcome) === norm(nm.outcome) || (pm.impact === nm.impact && Math.abs((pm.probability || 0) - nm.probability) <= 10);
      if (same) lines.push(`Most likely outcome still: ${nm.outcome} (${nm.probability}%${pm.probability && pm.probability !== nm.probability ? `, was ${pm.probability}%` : ''})`);
      else {
        lines.push(`Most likely outcome changed: ${pm.outcome}${pm.probability ? ` (${pm.probability}%)` : ''} → ${nm.outcome} (${nm.probability}%)`);
        changed = true;
      }
    }
    const before = new Map((prev.pairs || []).map(p => [p.symbol, p.bias]));
    const label = { FOR: 'For', AGAINST: 'Against', NEUTRAL: 'Neutral' } as const;
    const flips = next.pairs.filter(p => before.has(p.symbol) && before.get(p.symbol) !== p.bias);
    if (flips.length) {
      changed = true;
      lines.push(`Bias flipped: ${flips.slice(0, 4).map(p => `${p.symbol} ${label[before.get(p.symbol)!]} → ${label[p.bias]}`).join(', ')}`);
    } else if (!released && before.size && next.pairs.some(p => before.has(p.symbol))) lines.push('Pair biases unchanged');
  }
  const update = String(next.whatsNew || '').trim();
  if (update && !/^(no|nothing)( new| has)? (change|update|development)/i.test(update)) lines.unshift(`Update: ${update}`);
  const state: FundamentalRecheck['state'] = released ? 'RELEASED' : changed ? 'CHANGED' : 'STILL_VALID';
  if (state === 'STILL_VALID' && !released && headline === 'Not released yet') headline = 'Still valid: not released yet';
  return { state, headline, lines: lines.slice(0, 6), dueAt, checkedAt: now, previousAt: prev?.generatedAt ?? null };
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
