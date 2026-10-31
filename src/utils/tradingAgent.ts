// Trading agent (/trading-agent, owner-specified): an agent the trader switches on for a day, a week or a month. It
// finds trades on its own with Steady mode (option C: limit entries on 1H/4H, the stop 3x the normal room), places
// them, manages each one to its final target or its stop, and alerts the trader at every step. Shared by the server
// (server/tradingAgent.ts: validation, pricing, the agent loop) and the client (src/agents/AgentsPage.tsx).
//
// Back-test (Oct 2026, real order fills): a limit order at the middle of the entry zone, the whole position held to the
// final target or the stop, setups of quality 65+ only, one trade per market at a time, EUR/USD left out (it lost).
// BTC, ETH, gold, GBP/USD, USD/JPY and Nasdaq on 1H/4H, after spreads and fees: 32.5% of trades won, +0.19R per trade,
// profit factor 1.28, deepest drop 17.9R, longest losing run 7, about 7 trades a month across all six markets; both
// halves of the history were positive. Splitting at each target, break-even moves and closing at TP1 all did worse.

export type AgentStyle = 'DAY' | 'SWING' | 'ANY';
export type AgentDuration = 'DAILY' | 'WEEKLY' | 'MONTHLY';

/** Markets the agent trades: the ones its back-test covered and that held up (EUR/USD lost, so it is not offered) */
export const AGENT_MARKETS: Array<{ symbol: string; label: string; mt5: string }> = [
  { symbol: 'XAU/USD', label: 'Gold', mt5: 'XAUUSD' },
  { symbol: 'BTC/USDT', label: 'Bitcoin', mt5: 'BTCUSD' },
  { symbol: 'ETH/USDT', label: 'Ethereum', mt5: 'ETHUSD' },
  { symbol: 'USD/JPY', label: 'USD/JPY', mt5: 'USDJPY' },
  { symbol: 'GBP/USD', label: 'GBP/USD', mt5: 'GBPUSD' },
  { symbol: 'NAS100', label: 'Nasdaq 100', mt5: 'NAS100' },
];
export const AGENT_SYMBOLS = AGENT_MARKETS.map(m => m.symbol);

/**
 * With a personal strategy (owner-specified) the trader also picks the markets and timeframes (or RDM): the strategy's rules
 * decide the trades, so the engine's back-tested list doesn't apply. The MarketX engine keeps AGENT_MARKETS on 1H/4H.
 */
export const AGENT_STRATEGY_MARKETS: Array<{ symbol: string; label: string; mt5: string; kind: 'forex' | 'crypto' | 'stock' | 'commodity' }> = [
  { symbol: 'XAU/USD', label: 'Gold', mt5: 'XAUUSD', kind: 'commodity' },
  { symbol: 'XAG/USD', label: 'Silver', mt5: 'XAGUSD', kind: 'commodity' },
  { symbol: 'WTI/USD', label: 'Oil (WTI)', mt5: 'USOIL', kind: 'commodity' },
  { symbol: 'BTC/USDT', label: 'Bitcoin', mt5: 'BTCUSD', kind: 'crypto' },
  { symbol: 'ETH/USDT', label: 'Ethereum', mt5: 'ETHUSD', kind: 'crypto' },
  { symbol: 'SOL/USDT', label: 'Solana', mt5: 'SOLUSD', kind: 'crypto' },
  { symbol: 'EUR/USD', label: 'EUR/USD', mt5: 'EURUSD', kind: 'forex' },
  { symbol: 'GBP/USD', label: 'GBP/USD', mt5: 'GBPUSD', kind: 'forex' },
  { symbol: 'USD/JPY', label: 'USD/JPY', mt5: 'USDJPY', kind: 'forex' },
  { symbol: 'AUD/USD', label: 'AUD/USD', mt5: 'AUDUSD', kind: 'forex' },
  { symbol: 'USD/CAD', label: 'USD/CAD', mt5: 'USDCAD', kind: 'forex' },
  { symbol: 'USD/CHF', label: 'USD/CHF', mt5: 'USDCHF', kind: 'forex' },
  { symbol: 'NZD/USD', label: 'NZD/USD', mt5: 'NZDUSD', kind: 'forex' },
  { symbol: 'GBP/JPY', label: 'GBP/JPY', mt5: 'GBPJPY', kind: 'forex' },
  { symbol: 'EUR/JPY', label: 'EUR/JPY', mt5: 'EURJPY', kind: 'forex' },
  { symbol: 'NAS100', label: 'Nasdaq 100', mt5: 'NAS100', kind: 'stock' },
  { symbol: 'US30', label: 'Dow Jones 30', mt5: 'US30', kind: 'stock' },
  { symbol: 'GER40', label: 'DAX 40', mt5: 'GER40', kind: 'stock' },
];
/** Timeframes a personal strategy can run on with the agent (it walks 1-minute candles, so nothing under 5m) */
export const AGENT_STRATEGY_FRAMES = ['5M', '15M', '30M', '1H', '2H', '4H', '1D'];
/** At most this many markets / timeframes for a personal strategy run (each one is read every minute) */
export const AGENT_STRATEGY_MAX = { markets: 6, timeframes: 4 };
/** RDM with a personal strategy: the strategy's own timeframes the agent can run (else a spread from 15m to 1D) */
export function strategyAgentFrames(ruleFrames: string[] | undefined): string[] {
  const own = AGENT_STRATEGY_FRAMES.filter(tf => (ruleFrames || []).includes(tf));
  return (own.length ? own : ['15M', '1H', '4H', '1D']).slice(0, AGENT_STRATEGY_MAX.timeframes);
}
export const agentMarketInfo = (symbol: string): { symbol: string; label: string; mt5: string; kind?: string } | undefined =>
  AGENT_STRATEGY_MARKETS.find(m => m.symbol === symbol) || AGENT_MARKETS.find(m => m.symbol === symbol);

/** Steady mode's timeframes: 1H (day trading) and 4H (swing) */
export const AGENT_FRAMES: Record<AgentStyle, string[]> = { DAY: ['1H'], SWING: ['4H'], ANY: ['1H', '4H'] };
export const AGENT_STYLE_INFO: Record<AgentStyle, { label: string; hint: string }> = {
  DAY: { label: 'Day trading', hint: '1H charts' },
  SWING: { label: 'Swing', hint: '4H charts' },
  ANY: { label: 'Both', hint: '1H and 4H' },
};

/** Credits per trade the agent takes (owner-specified: never below 5; a daily run costs the most per trade) */
export const AGENT_PRICING: Record<AgentDuration, { label: string; days: number; perTrade: number }> = {
  DAILY: { label: 'Daily', days: 1, perTrade: 7 },
  WEEKLY: { label: 'Weekly', days: 7, perTrade: 6 },
  MONTHLY: { label: 'Monthly', days: 30, perTrade: 5 },
};
export const AGENT_MIN_PER_TRADE = 5;
/** Setup quality the agent needs (the back-tested floor) */
export const AGENT_MIN_QUALITY = 65;
/** The published back-test, shown to traders */
export const AGENT_BACKTEST = { won: 32.5, avgR: 0.19, profitFactor: 1.28, maxDrawdownR: 17.9, worstRun: 7, tradesPerMonth: 7 };

export const AGENT_LIMITS = {
  riskPct: { min: 0.1, max: 2, def: 0.5 },
  tradesPerDay: { min: 1, max: 5, def: 2 },
  /** Profit target for the run, % of the account (0 = none) */
  profitTargetPct: { min: 0, max: 100, def: 5 },
  /** Loss limit for the run, % of the account (0 = none) */
  lossLimitPct: { min: 0, max: 50, def: 5 },
};

export interface AgentSettings {
  style: AgentStyle;
  timeframes: string[];
  markets: string[];
  riskPct: number;
  tradesPerDay: number;
  profitTargetPct: number;
  lossLimitPct: number;
  duration: AgentDuration;
  /**
   * The strategy the agent trades with (owner-specified, the agent's own choice, separate from the Strategy Builder setting
   * of the normal MarketX page): null = the MarketX engine (Steady mode, the default); else one of the trader's saved
   * strategies (st_…), read with its own rules.
   */
  strategyId: string | null;
  /** Personal strategy only: RDM = every timeframe the strategy trades (filled in at start), strongest setup wins */
  rdm: boolean;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  style: 'ANY',
  timeframes: ['1H', '4H'],
  markets: ['XAU/USD', 'BTC/USDT', 'USD/JPY'],
  riskPct: AGENT_LIMITS.riskPct.def,
  tradesPerDay: AGENT_LIMITS.tradesPerDay.def,
  profitTargetPct: AGENT_LIMITS.profitTargetPct.def,
  lossLimitPct: AGENT_LIMITS.lossLimitPct.def,
  duration: 'DAILY',
  strategyId: null,
  rdm: false,
};
/** A personal strategy's setups need this quality (the site's own floor); the MarketX engine keeps AGENT_MIN_QUALITY */
export const AGENT_STRATEGY_MIN_QUALITY = 45;
/** The days each run length lasts (the agent page shows run lengths, never prices) */
export const AGENT_RUN_LABEL: Record<AgentDuration, string> = { DAILY: '1 day', WEEKLY: '7 days', MONTHLY: '30 days' };

const num = (v: unknown, lo: number, hi: number, step: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < lo || n > hi) return null;
  return Math.round(n / step) * step;
};

/** A valid settings object, or the first problem in plain words */
export function normalizeAgentSettings(raw: any): { ok: true; settings: AgentSettings } | { ok: false; message: string } {
  const r = raw && typeof raw === 'object' ? raw : {};
  const style: AgentStyle = r.style === 'DAY' || r.style === 'SWING' || r.style === 'ANY' ? r.style : 'ANY';
  const strategyId = typeof r.strategyId === 'string' && /^st_[a-f0-9]{16}$/.test(r.strategyId) ? r.strategyId : null;
  // The MarketX engine: its back-tested markets on 1H/4H. A personal strategy: the trader's own markets and timeframes, or RDM
  const rdm = !!strategyId && r.rdm === true;
  const allowed = strategyId ? AGENT_STRATEGY_FRAMES : AGENT_FRAMES[style];
  const tfs = Array.isArray(r.timeframes) ? r.timeframes.map((t: unknown) => String(t || '').toUpperCase()) : allowed;
  const timeframes = allowed.filter(tf => tfs.includes(tf));
  if (!rdm && !timeframes.length) return { ok: false, message: strategyId ? 'Pick at least one timeframe, or RDM.' : `Pick at least one timeframe (${allowed.join(' or ')}).` };
  if (strategyId && timeframes.length > AGENT_STRATEGY_MAX.timeframes) return { ok: false, message: `Pick up to ${AGENT_STRATEGY_MAX.timeframes} timeframes, or RDM.` };
  const want = Array.isArray(r.markets) ? r.markets.map((m: unknown) => String(m || '')) : [];
  const markets = (strategyId ? AGENT_STRATEGY_MARKETS.map(m => m.symbol) : AGENT_SYMBOLS).filter(s => want.includes(s));
  if (!markets.length) return { ok: false, message: 'Pick at least one market for the agent to trade.' };
  if (strategyId && markets.length > AGENT_STRATEGY_MAX.markets) return { ok: false, message: `Pick up to ${AGENT_STRATEGY_MAX.markets} markets.` };
  const riskPct = num(r.riskPct, AGENT_LIMITS.riskPct.min, AGENT_LIMITS.riskPct.max, 0.05);
  if (riskPct === null) return { ok: false, message: `Risk per trade must be between ${AGENT_LIMITS.riskPct.min}% and ${AGENT_LIMITS.riskPct.max}%.` };
  const tradesPerDay = num(r.tradesPerDay, AGENT_LIMITS.tradesPerDay.min, AGENT_LIMITS.tradesPerDay.max, 1);
  if (tradesPerDay === null) return { ok: false, message: `Trades per day must be between ${AGENT_LIMITS.tradesPerDay.min} and ${AGENT_LIMITS.tradesPerDay.max}.` };
  const profitTargetPct = num(r.profitTargetPct ?? 0, AGENT_LIMITS.profitTargetPct.min, AGENT_LIMITS.profitTargetPct.max, 0.5);
  if (profitTargetPct === null) return { ok: false, message: `The profit target must be between 0% (none) and ${AGENT_LIMITS.profitTargetPct.max}%.` };
  const lossLimitPct = num(r.lossLimitPct ?? 0, AGENT_LIMITS.lossLimitPct.min, AGENT_LIMITS.lossLimitPct.max, 0.5);
  if (lossLimitPct === null) return { ok: false, message: `The loss limit must be between 0% (none) and ${AGENT_LIMITS.lossLimitPct.max}%.` };
  if (lossLimitPct > 0 && lossLimitPct < riskPct) return { ok: false, message: 'The loss limit must be at least one trade’s risk.' };
  const duration: AgentDuration = r.duration === 'WEEKLY' || r.duration === 'MONTHLY' ? r.duration : 'DAILY';
  return {
    ok: true,
    settings: {
      style, timeframes, markets, duration,
      riskPct: Number(riskPct.toFixed(2)),
      tradesPerDay,
      profitTargetPct: Number(profitTargetPct.toFixed(1)),
      lossLimitPct: Number(lossLimitPct.toFixed(1)),
      strategyId,
      rdm,
    },
  };
}

/** The most a run can cost: every allowed trade, every day (credits are only used for trades the agent takes) */
export function agentMaxCost(s: Pick<AgentSettings, 'duration' | 'tradesPerDay'>): number {
  const p = AGENT_PRICING[s.duration];
  return p.perTrade * p.days * s.tradesPerDay;
}

export type AgentTradeState = 'PENDING' | 'OPEN' | 'CLOSED' | 'CANCELLED';
export type AgentTradeResult = 'WIN' | 'LOSS' | 'TIMEOUT';
export interface AgentTradeView {
  id: string;
  runId: string;
  symbol: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  entryMin: number;
  entryMax: number;
  stop: number;
  target: number;
  quality: number;
  rr: number;
  riskPct: number;
  state: AgentTradeState;
  result?: AgentTradeResult;
  r?: number;
  pnlPct?: number;
  credits: number;
  createdAt: number;
  filledAt?: number;
  closedAt?: number;
  closePrice?: number;
  note?: string;
  /** The order on the trader's MT5 account, when linked */
  mt5?: { state: 'PLACED' | 'FAILED' | 'CANCELLED' | 'CLOSED'; symbol?: string; volume?: number; error?: string };
  /** Credits given back (the order never filled) */
  refunded?: number;
  /** Its seal on Solana (tag Agent): opens /proof/<id> */
  proof?: { id: string; hash?: string };
}
export interface AgentStats { trades: number; wins: number; losses: number; winRate: number; totalR: number; avgR: number; pnlPct: number }
export interface AgentLogEntry { at: number; kind: 'START' | 'SCAN' | 'ORDER' | 'FILL' | 'WIN' | 'LOSS' | 'CLOSE' | 'CANCEL' | 'STOP' | 'END' | 'PAUSE'; text: string; tradeId?: string }
export interface AgentRunView {
  id: string;
  state: 'RUNNING' | 'ENDED';
  endedReason?: 'TIME_UP' | 'STOPPED' | 'TARGET' | 'LOSS_LIMIT' | 'NO_CREDITS' | 'SUB_ENDED';
  startedAt: number;
  endsAt: number;
  endedAt?: number;
  settings: AgentSettings;
  perTrade: number;
  maxCredits: number;
  creditsUsed: number;
  /** The personal strategy this run trades with (null = the MarketX engine) */
  strategyName?: string | null;
  stats: AgentStats;
  lastScanAt?: number;
}

export const ENDED_TEXT: Record<NonNullable<AgentRunView['endedReason']>, string> = {
  TIME_UP: 'Run finished',
  STOPPED: 'Stopped by you',
  TARGET: 'Profit target reached',
  LOSS_LIMIT: 'Loss limit reached',
  NO_CREDITS: 'No credits available',
  SUB_ENDED: 'Pro plan needed',
};

/** Win rate, R and account % from closed trades (TIMEOUT counts by its sign) */
export function agentStats(trades: Array<Pick<AgentTradeView, 'state' | 'r' | 'pnlPct'>>): AgentStats {
  const closed = trades.filter(t => t.state === 'CLOSED' && typeof t.r === 'number');
  const wins = closed.filter(t => (t.r as number) > 0).length;
  const totalR = closed.reduce((a, t) => a + (t.r as number), 0);
  const pnlPct = closed.reduce((a, t) => a + (t.pnlPct || 0), 0);
  return {
    trades: closed.length,
    wins,
    losses: closed.length - wins,
    winRate: closed.length ? Math.round((1000 * wins) / closed.length) / 10 : 0,
    totalR: Number(totalR.toFixed(2)),
    avgR: closed.length ? Number((totalR / closed.length).toFixed(2)) : 0,
    pnlPct: Number(pnlPct.toFixed(2)),
  };
}
