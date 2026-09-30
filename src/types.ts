export type AssetType = 'crypto' | 'stock' | 'forex' | 'commodity' | 'synthetic';

export type BiasType = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export type TradeType = 'LONG' | 'SHORT' | 'WAIT_CONFIRMATION' | 'NO_SIGNAL';

export type MitigationStatus = 'UNMITIGATED' | 'MITIGATED';
export type TouchStatus = 'UNTOUCHED' | 'TAPPED_AND_LEFT' | 'FIRST_TOUCH_NOW';

export interface POIZone {
  name: string; // e.g. "4H Unmitigated Demand Order Block", "1H Mitigated Supply FVG"
  type: 'DEMAND' | 'SUPPLY' | 'FVG' | 'ORDER_BLOCK' | 'BREAKER' | 'LIQUIDITY_POOL';
  min: number;
  max: number;
  mitigationStatus: MitigationStatus; // 'UNMITIGATED' (untouched) or 'MITIGATED' (tapped and left)
  touchStatus: TouchStatus; // 'UNTOUCHED' (price has not touched yet) or 'TAPPED_AND_LEFT' (price tapped and left already)
  timeframe: string;
  description: string;
  reactionSummary: string; // e.g. "Virgin untouched POI awaiting initial liquidity test" or "Tapped once at $X and left swiftly with +3.8% displacement"
  tapCount: number;
  distancePercent?: number;
}

export interface FibonacciLevel {
  ratio: number;
  label: string;
  price: number;
  isKey: boolean;
  description?: string;
}

export interface ZoneDetails {
  low: number;
  high: number;
  strength: 'FRESH' | 'TESTED' | 'WEAK';
  timeframe: string;
  description?: string;
  mitigationStatus?: MitigationStatus;
  touchStatus?: TouchStatus;
  tapCount?: number;
  reactionSummary?: string;
}

export interface TakeProfitTarget {
  level: string; // "TP1 (0.382 Fib)", "TP2 (0.236 Fib)", "TP3 (Liquidity Pool)"
  price: number;
  rewardRatio: string;
  exitPercent: number; // e.g. 50, 30, 20
}

export interface HighImpactNewsAlert {
  detected: boolean;
  title: string;
  impactLevel: 'HIGH' | 'CRITICAL' | 'BANK_HOLIDAY';
  category?: 'MACRO_ECONOMIC' | 'CENTRAL_BANK' | 'BANK_HOLIDAY' | 'REGULATORY' | 'EARNINGS' | 'GEOPOLITICAL' | 'TOKEN_EVENT' | string;
  scheduledTime: string;
  date?: string;
  time?: string;
  timeHorizon?: 'IMMINENT (0-4H)' | 'TODAY (4-24H)' | 'THIS WEEK' | 'ACTIVE BREAKING' | 'BANK HOLIDAY' | string;
  affectedCurrency: string;
  forecast?: string;
  previous?: string;
  source?: string;
  secondarySource?: string;
  breakingHeadline?: string;
  volatilityWarning: string;
  executionGuidance: string;
}

export type SignalExecutionState = 'ACTIVE' | 'TP_SMASHED' | 'SL_TAKEN' | 'PENDING_CONFIRMATION' | 'MITIGATED_ZONE_STALE' | 'ALREADY_MOVED';

export interface SignalStatusInfo {
  state: SignalExecutionState;
  verdict: 'tp smashed already' | 'sl taken already' | string;
  details: string;
  tpHitLevel?: 'TP1' | 'TP2' | 'TP3' | 'ALL_TPS';
}

export interface StrategyResult {
  symbol: string;
  name: string;
  assetType: AssetType;
  timeframe: string;
  currentPrice: number;
  change24h: number;
  high24h: number;
  low24h: number;
  bias: BiasType;
  tradeType: TradeType;
  signalStatus?: SignalStatusInfo;
  /** NO_SIGNAL because the best setup's zone / entry / stop / targets were already tapped */
  alreadyMitigated?: boolean;
  /** NO_SIGNAL because price already moved close to TP1 (or to the stop loss) */
  alreadyMoved?: 'NEAR_TP' | 'NEAR_SL';
  /** Tools the engine ran for this analysis (live candles, zones, RSI 14, EMA 50) */
  /** RDM: every timeframe was scanned; `chosen` is the one this result uses (null = no valid setup anywhere) */
  timeframeScan?: { mode: 'RDM'; scanned: number; withSetup: string[]; chosen: string | null };
  toolsUsed?: { candles: number; zones: number; rsi: number | null; emaTrend: 'RISING' | 'FALLING' | 'FLAT' | null; divergence: 'BULLISH' | 'BEARISH' | null };
  /** LIMIT: pending order ahead of price. MARKET: price is on the zone's first touch now, enter at the current price */
  execution?: 'LIMIT' | 'MARKET';
  /** Set by the server on LONG / SHORT signals: the id to turn on a price alert for this exact setup */
  alertOffer?: { id: string };
  /** What the Recheck button replays (zone and the first candle after its leg-out) */
  setupCheck?: { zone: { low: number; high: number }; since: number; issuedAt: number; timeframe: string };
  confidenceScore: number;
  entryZone: {
    min: number;
    max: number;
    optimal: number;
    rationale: string;
  };
  stopLoss: {
    price: number;
    riskPercent: number;
    rationale: string;
  };
  takeProfits: TakeProfitTarget[];
  riskRewardRatio: string;
  demandZone: ZoneDetails;
  supplyZone: ZoneDetails;
  poiZones?: POIZone[];
  unmitigatedZonesCount?: number;
  mitigatedZonesCount?: number;
  fibonacciLevels: FibonacciLevel[];
  swingHigh: number;
  swingLow: number;
  detailedThesis: string;
  sources?: Array<{ title: string; uri: string }>;
  aiModel?: string;
  aiPowered?: boolean;
  highImpactNews?: HighImpactNewsAlert | null;
  /** Live fundamentals for the reader's day (null/absent = nothing that could move this asset today) */
  newsBrief?: NewsBrief | null;
  uploadedChartAnalyzed?: boolean;
  chartImageThumbnail?: string;
  timestamp: number;
}

export interface ReasoningStep {
  title: string;
  detail: string;
  time: string;
}

// One real, timed step of work shown in the live activity trace
/** What the server looked up to answer a question (shown in the thinking steps) */
export interface ResearchInfo {
  web: boolean;
  queries: string[];
  sources: Array<{ domain: string }>;
  data: string[];
  cached?: boolean;
}

export interface ActivityStep {
  id: string;
  title: string;
  detail?: string;
  status: 'active' | 'done' | 'error' | 'stopped';
  startedAt: number;
  endedAt?: number;
  /** Relative token weight for this step (1 = its normal share), e.g. more news items cost more */
  tokenWeight?: number;
}

export interface NewsBriefEvent {
  title: string;
  currency: string;
  impact: 'HIGH' | 'HOLIDAY';
  /** Release time (ms); null for all-day items such as bank holidays */
  at: number | null;
  forecast?: string;
  previous?: string;
}

export interface NewsBriefHeadline {
  title: string;
  url?: string;
  publishedAt: number;
  source: string;
}

/** Today's fundamentals for one analysis, valid only on the reader's calendar day */
export interface NewsBrief {
  day: string; // YYYY-MM-DD
  timeZone: string;
  expiresAt: number;
  checkedAt: number;
  symbol: string;
  events: NewsBriefEvent[];
  headlines: NewsBriefHeadline[];
  summary: string;
  guidance: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isAnalysis?: boolean;
  strategy?: StrategyResult;
  status?: 'searching' | 'analyzing' | 'completed' | 'error';
  searchStep?: string;
  durationSeconds?: number;
  reasoningSteps?: ReasoningStep[];
  activity?: ActivityStep[];
  chartImage?: string; // base64 Data URL for uploaded chart image
  chartFileName?: string;
  /** Quick replies under an answer, e.g. "Analyze EUR/USD" or "Info about EUR/USD" after a bare pair */
  choices?: MessageChoice[];
  timestamp: number;
}

export interface MessageChoice {
  kind: 'analysis' | 'info';
  label: string;
  prompt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  symbol?: string;
  bias?: BiasType;
  lastMessage: string;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface MarketQuote {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h?: string;
  marketCap?: string;
  ratio?: string;
  sector?: string;
  currency?: string;
  type: AssetType;
  /** When the price was fetched from its source (ms) */
  asOf?: number;
  /** A real quote from the last minute */
  live?: boolean;
}

export interface PromptIdea {
  id: string;
  title: string;
  prompt: string;
  symbol: string;
  category: string;
  bias: 'BULLISH' | 'BEARISH';
  badge: string;
  timeframe: string;
}

export interface SavedAnalysis {
  id: string;
  symbol: string;
  name: string;
  timeframe: string;
  bias: BiasType;
  tradeType: TradeType;
  optimalEntry: number;
  stopLossPrice: number;
  tp1Price: number;
  riskReward: string;
  confidenceScore: number;
  timestamp: number;
  sessionId: string;
  messageId?: string;
}

export type SubscriptionPlan = 'free' | 'monthly' | 'yearly';

export interface UserSubscription {
  plan: SubscriptionPlan;
  active: boolean;
  startDate: number;
  expiresAt: number; // monthly (30 days) or yearly (365 days)
  price: number; // 0, 18, 203.04
  paystackRef?: string;
}

export interface UserProfile {
  id: string;
  username: string; // e.g. "trader_x"
  displayName: string;
  email: string;
  avatarUrl?: string;
  joinedAt: number;
  isVerified: boolean;
  emailVerified?: boolean;
  /** Receive activity emails (analyses, profile changes, gifts). Security emails always send. */
  emailActivity?: boolean;
  /** The trader approved live price alerts (/price-alerts) */
  alertsEnabled?: boolean;
  subscription: UserSubscription;
}

export type PriceAlertKind = 'ENTRY' | 'TP1' | 'TP2' | 'TP3' | 'SL' | 'MISSED';
/** A price alert the server watches for the trader (see server/priceAlerts.ts) */
export interface PriceAlertItem {
  id: string;
  offerId: string;
  symbol: string;
  name: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT';
  execution: 'LIMIT' | 'MARKET';
  entry: { min: number; max: number; optimal: number };
  stop: number;
  tps: number[];
  createdAt: number;
  expiresAt: number;
  active: boolean;
  entered: boolean;
  hits: { kind: PriceAlertKind; at: number; price: number }[];
  endedReason: 'SL' | 'TP3' | 'MISSED' | 'EXPIRED' | 'TURNED_OFF' | null;
}

/** Live price of a market with an active alert, fetched when the trader refreshes the panel */
export interface AlertLiveQuote {
  price: number;
  change24h: number;
}

export interface CreditState {
  availableCredits: number;
  dailyUsageLimit: number; // 10 per day for subscribers
  dailyUsageRemaining: number;
  lastDailyResetTime: number; // when the daily analyses last refilled
  /** Next automatic refill (3:00 AM in the site's time zone), set by the server */
  nextDailyResetAt?: number;
  resetTimeZone?: string;
  /** Credits earned from the X campaign: still usable after the daily limit, until used up */
  campaignCredits?: number;
}

export interface CreditGift {
  id: string;
  fromUsername: string;
  toUsername: string;
  amount: number;
  timestamp: number;
  note?: string;
}

export interface XShareReward {
  id: string;
  username: string;
  email: string;
  sharedAt: number;
  unlockAt: number; // sharedAt + 10 hours (10 * 3600 * 1000)
  creditsAwarded: number; // 10 credits
  status: 'pending' | 'credited';
  notifiedOnSite: boolean;
  notifiedEmail: boolean;
  tweetUrl?: string;
  /** This person already claimed the campaign before (e.g. on a deleted account): completed, no credits */
  previouslyClaimed?: boolean;
}

export type NotificationType = 'reward' | 'market' | 'system' | 'credit' | 'security' | 'analysis' | 'announcement';

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  actionPrompt?: string;
  actionType?: 'view_receipt' | 'analyze_prompt' | 'open_profile' | 'open_pricing' | 'open_campaign' | 'open_support' | 'open_alerts';
  actionPayload?: any;
  /** Announcements: an optional https link attached by the MarketX team */
  link?: string;
  /** Announcements: an optional picture (same-site URL) attached by the MarketX team */
  image?: string;
}



export type RecheckLevelStatus = 'UNTOUCHED' | 'AT_PRICE' | 'TOUCHED' | 'HIT';

export interface RecheckResponse {
  state: 'VALID' | 'TRIGGERED' | 'TP_HIT' | 'SL_HIT' | 'MITIGATED' | 'NO_SIGNAL' | 'SETUP_FORMED';
  headline: string;
  details: string;
  price: number;
  priceSource: 'live' | 'candle';
  checkedAt: number;
  timeframe: string;
  candlesChecked: number;
  levels: Array<{ key: string; label: string; low: number; high: number; status: RecheckLevelStatus; at?: number; note: string }>;
}
