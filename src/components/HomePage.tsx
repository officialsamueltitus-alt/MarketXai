import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MarketQuote, UserProfile, XShareReward } from '../types';
import { MarketXText } from './MarketXText';
import { MarketXHeroLogo } from './MarketXHeroLogo';
import { CampaignBanner } from './CampaignBanner';
import { CryptoAssetLogo } from './CryptoAssetLogo';
import { InstitutionalMailSupport } from './InstitutionalMailSupport';
import {
  Sparkles,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  BarChart2,
  Clock,
  Radio,
  ChevronRight,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Pause,
  Play,
  RefreshCw,
  Layers
} from 'lucide-react';

// Mini Candlestick Chart graphic component strictly matching image.png sample
function MiniCandlestickChart({ isBullish }: { isBullish: boolean }) {
  return (
    <div className="w-16 sm:w-20 h-16 sm:h-20 rounded-2xl bg-[var(--mx-surface)] border border-white/[0.08] p-2 flex items-center justify-center shrink-0 shadow-inner select-none">
      <svg viewBox="0 0 60 50" className="w-full h-full">
        {/* Candle 1: Green */}
        <line x1="8" y1="6" x2="8" y2="44" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="5.5" y="12" width="5" height="22" fill="#10b981" rx="1" />

        {/* Candle 2: Red */}
        <line x1="20" y1="18" x2="20" y2="46" stroke="#f43f5e" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="17.5" y="24" width="5" height="18" fill="#f43f5e" rx="1" />

        {/* Candle 3: Green */}
        <line x1="32" y1="20" x2="32" y2="40" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="29.5" y="24" width="5" height="12" fill="#10b981" rx="1" />

        {/* Candle 4: Red (tall) */}
        <line x1="44" y1="8" x2="44" y2="46" stroke="#f43f5e" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="41.5" y="14" width="5" height="24" fill="#f43f5e" rx="1" />

        {/* Candle 5: Green (accent) */}
        <line x1="53" y1="14" x2="53" y2="38" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="51" y="18" width="4" height="14" fill="#10b981" rx="1" />
      </svg>
    </div>
  );
}

interface HomePageProps {
  tickers: MarketQuote[];
  onAskMarketX: () => void;
  onSelectPrompt: (prompt: string, timeframe?: string) => void;
  onSelectTicker: (symbol: string) => void;
  userProfile?: UserProfile;
  xShareReward?: XShareReward | null;
  onOpenShareModal?: () => void;
  onOpenEmailReceipt?: () => void;
  /** Opens the in-app support chat */
  onOpenSupport?: () => void;
  supportUnread?: number;
}

interface InstitutionalFeedItem {
  id: string;
  symbol: string;
  name: string;
  type: string;
  timeAgo: string;
  badge: string;
  bias: 'BULLISH' | 'BEARISH';
  headline: string;
  detail: string;
  suggestedPrompt: string;
  isNew?: boolean;
}

function formatFeedPrice(price: number): string {
  if (price < 10) return price.toFixed(4);
  if (price < 1000) return price.toFixed(2);
  return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Generate intelligent real-time feed item tailored directly to the specific pair's current price & market conditions
function generateFeedItemForTicker(
  ticker: MarketQuote,
  variationSeed: number = 0,
  timeAgoText: string = 'Just now',
  isNew: boolean = false
): InstitutionalFeedItem {
  const isUp = ticker.change24h >= 0;
  const priceStr = formatFeedPrice(ticker.price);
  const sym = ticker.symbol.toUpperCase();
  const absChange = Math.abs(ticker.change24h).toFixed(2);

  const highStr = formatFeedPrice(ticker.high24h || ticker.price * 1.02);
  const lowStr = formatFeedPrice(ticker.low24h || ticker.price * 0.98);
  const id = `feed-${ticker.symbol}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Pair specific dynamic conditions based on real live market data
  if (sym.includes('BTC')) {
    if (isUp) {
      const variants = [
        {
          badge: 'Liquidity Expansion',
          bias: 'BULLISH' as const,
          headline: `BTC Sweeping Highs toward $${highStr}`,
          detail: `Smart money absorbing sell-side liquidity at $${priceStr} (+${absChange}% 24h). Cumulative volume delta confirms spot market buyer aggression.`,
          prompt: `Analyze BTC/USDT on the 4H timeframe around $${priceStr}. Identify the key levels, momentum and continuation targets.`,
        },
        {
          badge: 'Trend Continuation',
          bias: 'BULLISH' as const,
          headline: `Buyers Defending $${priceStr}`,
          detail: `Institutional limit bids defended $${lowStr}. Rapid absorption of retail short liquidity pushing price towards $${highStr}.`,
          prompt: `Analyze BTC/USDT 4H chart at $${priceStr}. Map key support and resistance, and size optimal risk/reward parameters.`,
        },
      ];
      const v = variants[variationSeed % variants.length];
      return { id, symbol: ticker.symbol, name: ticker.name, type: ticker.type, timeAgo: timeAgoText, isNew, ...v, suggestedPrompt: v.prompt };
    } else {
      const variants = [
        {
          badge: 'Support Retest',
          bias: 'BULLISH' as const,
          headline: `Buyers Absorbing the Dip at $${priceStr}`,
          detail: `Pullback of -${absChange}% testing key support near $${lowStr}. Order book bid-ask imbalance heavily favors accumulating buyers.`,
          prompt: `Analyze BTC/USDT 4H support around $${priceStr}. Identify invalidation levels below $${lowStr} and map high-probability reversal targets.`,
        },
        {
          badge: 'Liquidity Sweep',
          bias: 'BEARISH' as const,
          headline: `Sweep of Local Lows around $${lowStr}`,
          detail: `Retail stop-loss cascade triggered at $${priceStr}. Institutional desks bidding aggressively to establish swing accumulation bases.`,
          prompt: `Analyze BTC/USDT liquidity sweep at $${priceStr}. Calculate mean reversion targets back toward key resistance levels.`,
        },
      ];
      const v = variants[variationSeed % variants.length];
      return { id, symbol: ticker.symbol, name: ticker.name, type: ticker.type, timeAgo: timeAgoText, isNew, ...v, suggestedPrompt: v.prompt };
    }
  }

  if (sym.includes('ETH')) {
    if (isUp) {
      return {
        id,
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        timeAgo: timeAgoText,
        isNew,
        badge: 'Breakout & Expansion',
        bias: 'BULLISH',
        headline: `4H Breakout Holding at $${priceStr}`,
        detail: `Price cleared resting offers at $${priceStr} (+${absChange}% 24h). Institutional order book depth shows surging bid density pushing toward $${highStr}.`,
        suggestedPrompt: `Analyze ETH/USDT on the 4H timeframe focusing on the breakout around $${priceStr} and next expansion targets.`
      };
    } else {
      return {
        id,
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        timeAgo: timeAgoText,
        isNew,
        badge: 'Pullback Support',
        bias: 'BULLISH',
        headline: `Defending $${lowStr} Institutional Base`,
        detail: `Pulling back -${absChange}% into 4H support at $${priceStr}. Smart money absorbing sell pressure with defined invalidation.`,
        suggestedPrompt: `Analyze ETH/USDT 4H support around $${priceStr}. Calculate optimal risk/reward entry parameters and targets.`
      };
    }
  }

  if (sym.includes('SOL')) {
    if (isUp) {
      return {
        id,
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        timeAgo: timeAgoText,
        isNew,
        badge: 'Volume Breakout',
        bias: 'BULLISH',
        headline: `Ascending Breakout at $${priceStr}`,
        detail: `Institutional volume spike lifted SOL to $${priceStr} (+${absChange}% 24h). Next major liquidity pool resides at $${highStr}.`,
        suggestedPrompt: `Analyze SOL/USDT breakout momentum at $${priceStr}. Identify key liquidity targets and calculate tight invalidation stops.`
      };
    } else {
      return {
        id,
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        timeAgo: timeAgoText,
        isNew,
        badge: 'Discount Accumulation',
        bias: 'BULLISH',
        headline: `Support Sweep at $${lowStr}`,
        detail: `Healthy retracement of -${absChange}% into deep discount territory at $${priceStr}. High bid density guarding swing lows.`,
        suggestedPrompt: `Analyze SOL/USDT 4H discount zone entry around $${priceStr} and calculate optimal swing continuation targets.`
      };
    }
  }

  if (sym.includes('XAU') || sym.includes('GOLD')) {
    if (isUp) {
      return {
        id,
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        timeAgo: timeAgoText,
        isNew,
        badge: 'Central Bank Inflow',
        bias: 'BULLISH',
        headline: `Gold Spot Surging to $${priceStr}`,
        detail: `Macro reserve accumulation and sovereign flight to safety driving Gold to $${priceStr} (+${absChange}%). Target liquidity expands toward $${highStr}.`,
        suggestedPrompt: `Analyze XAU/USD Gold Spot at $${priceStr}. Map institutional order flow, key resistance liquidity at $${highStr}, and optimal entry zones.`
      };
    } else {
      return {
        id,
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        timeAgo: timeAgoText,
        isNew,
        badge: 'Institutional Defense',
        bias: 'BULLISH',
        headline: `Defense of $${lowStr} Gold Support Block`,
        detail: `Bullion desks holding firm support around $${priceStr}. 1H stochastic divergence forming with resting bids absorbing retail profit taking.`,
        suggestedPrompt: `Analyze XAU/USD Gold Spot key institutional defense at $${priceStr} and calculate macro invalidation and target parameters.`
      };
    }
  }

  if (sym.includes('JPY') || sym.includes('USD/JPY')) {
    if (isUp) {
      return {
        id,
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        timeAgo: timeAgoText,
        isNew,
        badge: 'Forex Expansion',
        bias: 'BULLISH',
        headline: `USD/JPY Pushing through ${priceStr}`,
        detail: `Yield differential pressure driving USD upside to ${priceStr} (+${absChange}%). Testing upper liquidity boundaries near ${highStr}.`,
        suggestedPrompt: `Analyze USD/JPY bullish momentum at ${priceStr}. Identify key institutional liquidity targets and invalidation boundaries.`
      };
    } else {
      return {
        id,
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        timeAgo: timeAgoText,
        isNew,
        badge: 'Resistance Rejection',
        bias: 'BEARISH',
        headline: `Upper Shadow Rejection at ${highStr}`,
        detail: `Sellers rejected upside continuation at ${priceStr}. The next downside target sits near ${lowStr}.`,
        suggestedPrompt: `Analyze USD/JPY resistance rejection around ${priceStr} and calculate high-probability short confluence parameters.`
      };
    }
  }

  if (sym.includes('NVDA')) {
    if (isUp) {
      return {
        id,
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        timeAgo: timeAgoText,
        isNew,
        badge: 'Momentum Rebound',
        bias: 'BULLISH',
        headline: `NVDA Surging toward $${highStr}`,
        detail: `Rebounded off support with aggressive call buying. Price trading at $${priceStr} (+${absChange}%).`,
        suggestedPrompt: `Analyze NVDA momentum at $${priceStr} and calculate risk/reward continuation targets.`
      };
    } else {
      return {
        id,
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        timeAgo: timeAgoText,
        isNew,
        badge: 'Support Retest',
        bias: 'BULLISH',
        headline: `NVDA Retesting $${lowStr} Support Shelf`,
        detail: `Pullback of -${absChange}% bringing shares to $${priceStr}. Institutional dark pool accumulation detected at key horizontal support.`,
        suggestedPrompt: `Analyze NVDA key institutional support shelf around $${priceStr} and define entry invalidation levels.`
      };
    }
  }

  if (sym.includes('TSLA')) {
    if (isUp) {
      return {
        id,
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        timeAgo: timeAgoText,
        isNew,
        badge: 'Institutional Breakout',
        bias: 'BULLISH',
        headline: `TSLA Expansion at $${priceStr}`,
        detail: `Heavy call option gamma squeeze driving Tesla to $${priceStr} (+${absChange}%). Overhead target sits at $${highStr}.`,
        suggestedPrompt: `Analyze Tesla (TSLA) breakout momentum at $${priceStr} and identify the next key targets.`
      };
    } else {
      return {
        id,
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        timeAgo: timeAgoText,
        isNew,
        badge: 'Support Defense',
        bias: 'BULLISH',
        headline: `Tesla Testing $${lowStr} Support`,
        detail: `Mean reversion to $${priceStr} (-${absChange}%). Volume delta stabilizing with large block orders absorbing seller liquidity.`,
        suggestedPrompt: `Analyze Tesla (TSLA) support defense at $${priceStr} and calculate optimal risk-reward entry parameters.`
      };
    }
  }

  if (sym.includes('AAPL')) {
    if (isUp) {
      return {
        id,
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        timeAgo: timeAgoText,
        isNew,
        badge: 'Macro Accumulation',
        bias: 'BULLISH',
        headline: `Apple Holding Strong at $${priceStr}`,
        detail: `Consistent institutional accumulation supporting AAPL at $${priceStr} (+${absChange}%). Next expansion pivot sits at $${highStr}.`,
        suggestedPrompt: `Analyze Apple (AAPL) trend continuation at $${priceStr} and evaluate key institutional price targets.`
      };
    } else {
      return {
        id,
        symbol: ticker.symbol,
        name: ticker.name,
        type: ticker.type,
        timeAgo: timeAgoText,
        isNew,
        badge: 'Discount Retest',
        bias: 'BULLISH',
        headline: `Apple Tapping $${lowStr} Support`,
        detail: `Consolidation at $${priceStr} (-${absChange}%). Long-term funds defending valuation baseline with low volatility absorption.`,
        suggestedPrompt: `Analyze Apple (AAPL) 4H support around $${priceStr} and calculate high-probability entry targets.`
      };
    }
  }

  // Fallback for any other pair
  return {
    id,
    symbol: ticker.symbol,
    name: ticker.name,
    type: ticker.type,
    timeAgo: timeAgoText,
    isNew,
    badge: isUp ? 'Volume Surge' : 'Key Support',
    bias: isUp ? 'BULLISH' : 'BEARISH',
    headline: `${ticker.name} Testing ${priceStr}`,
    detail: `Order flow tracking ${ticker.symbol} at ${priceStr} (${isUp ? '+' : ''}${(Number(ticker.change24h) || 0).toFixed(2)}% 24h). Institutional order book depth shows active liquidity positioning.`,
    suggestedPrompt: `Analyze ${ticker.symbol} at ${priceStr} on the 4H timeframe. Identify the key levels and the optimal entry.`
  };
}

function formatTablePrice(price: number): string {
  if (price < 10) return price.toFixed(4);
  if (price < 1000) return price.toFixed(2);
  return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderAssetLogo(symbol: string) {
  return <CryptoAssetLogo symbol={symbol} />;
}

export const HomePage: React.FC<HomePageProps> = ({
  tickers,
  onAskMarketX,
  onSelectPrompt,
  onSelectTicker,
  userProfile,
  xShareReward,
  onOpenShareModal,
  onOpenEmailReceipt,
  onOpenSupport,
  supportUnread = 0,
}) => {
  // Exclude unwanted synthetic indices while keeping real market assets (Forex, Crypto, Equities, Commodities)
  const validTickers = useMemo(() => {
    const bannedKeywords = ['BOOM', 'CRASH', 'VOLATILITY 75', 'JUMP'];
    return tickers.filter(ticker => {
      const sym = ticker.symbol.toUpperCase();
      const name = ticker.name.toUpperCase();
      return !bannedKeywords.some(b => sym.includes(b) || name.includes(b));
    });
  }, [tickers]);

  // Selected row state for elevated floating card preview (default to USD/JPY or TSLA)
  const [selectedSymbol, setSelectedSymbol] = useState<string>('USD/JPY');
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  // Category filter state
  const [activeCategory, setActiveCategory] = useState<'all' | 'forex' | 'stock' | 'crypto' | 'commodity'>('all');

  // Priority order matching major instruments
  const prioritySymbols = [
    'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT', 'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT', 'SUI/USDT', 'LINK/USDT',
    'USD/JPY', 'EUR/USD', 'GBP/USD', 'AUD/USD', 'USD/CAD', 'USD/CHF', 'GBP/JPY',
    'AAPL', 'TSLA', 'GOOGL', 'WMT', 'NVDA', 'XAU/USD'
  ];

  const sortedTickers = useMemo(() => {
    return [...validTickers]
      .filter(t => {
        if (activeCategory === 'all') return true;
        if (activeCategory === 'forex') return t.type === 'forex' || t.symbol.includes('JPY') || t.symbol.includes('EUR') || t.symbol.includes('GBP') || t.symbol.includes('AUD') || t.symbol.includes('CAD') || t.symbol.includes('CHF');
        if (activeCategory === 'commodity') return t.type === 'commodity' || t.symbol.includes('XAU') || t.symbol.includes('XAG') || t.symbol.includes('WTI');
        return t.type === activeCategory;
      })
      .sort((a, b) => {
        const idxA = prioritySymbols.findIndex(sym => a.symbol.toUpperCase().includes(sym.replace('/USDT', '').replace('/USD', '')));
        const idxB = prioritySymbols.findIndex(sym => b.symbol.toUpperCase().includes(sym.replace('/USDT', '').replace('/USD', '')));
        const rankA = idxA === -1 ? 999 : idxA;
        const rankB = idxB === -1 ? 999 : idxB;
        return rankA - rankB;
      });
  }, [validTickers, activeCategory]);

  // Self-updating live feed state: initializes from validTickers and continuously updates itself with fresh market conditions
  const [liveFeeds, setLiveFeeds] = useState<InstitutionalFeedItem[]>(() => {
    const timeAgos = ['Just now', '2m ago', '5m ago', '9m ago', '14m ago', '21m ago', '28m ago', '35m ago'];
    return validTickers.map((t, idx) =>
      generateFeedItemForTicker(t, idx, timeAgos[idx % timeAgos.length], false)
    );
  });

  const nextFeedIdxRef = useRef(0);
  const variationCounterRef = useRef(1);

  // Active selected or cycling feed index for the image.png template
  const [activeFeedIndex, setActiveFeedIndex] = useState(0);
  const [isFeedHolding, setIsFeedHolding] = useState(false);

  // Auto-cycle active feed periodically unless hovered
  useEffect(() => {
    if (isFeedHolding || liveFeeds.length <= 1) return;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setActiveFeedIndex(prev => (prev + 1) % liveFeeds.length);
    }, 10000);
    return () => clearInterval(timer);
  }, [isFeedHolding, liveFeeds.length]);

  // Automatically update the live feed section periodically with prompts fitting current conditions
  useEffect(() => {
    if (validTickers.length === 0) return;

    const feedInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const idx = nextFeedIdxRef.current % validTickers.length;
      nextFeedIdxRef.current += 1;
      variationCounterRef.current += 1;

      const targetTicker = validTickers[idx];
      if (!targetTicker) return;

      const freshFeed = generateFeedItemForTicker(
        targetTicker,
        variationCounterRef.current,
        'Just now',
        true
      );

      setLiveFeeds(prev => {
        // Increment previous timestamps
        const aged = prev.map(item => {
          let t = item.timeAgo;
          if (t === 'Just now') t = '1m ago';
          else if (t === '1m ago') t = '3m ago';
          else if (t === '2m ago') t = '4m ago';
          else if (t === '3m ago') t = '6m ago';
          else if (t === '4m ago') t = '8m ago';
          else if (t === '5m ago') t = '11m ago';
          else if (t.includes('m ago')) {
            const num = parseInt(t, 10);
            if (!isNaN(num)) t = `${num + 2}m ago`;
          }
          return { ...item, timeAgo: t, isNew: false };
        });

        // Prepend fresh item, ensuring symbol variety
        const withoutSameSymbol = aged.filter(item => item.symbol !== freshFeed.symbol);
        return [freshFeed, ...withoutSameSymbol].slice(0, 8);
      });
    }, 45000);

    return () => clearInterval(feedInterval);
  }, [validTickers]);

  // Determine active feed item for the elevated floating card
  const activeFeed = liveFeeds[activeFeedIndex % Math.max(1, liveFeeds.length)] || liveFeeds[0];
  const isFeedBullish = activeFeed ? activeFeed.bias === 'BULLISH' : true;

  // Render a ticker row with clean classic styling (no pop-out or expand)
  const renderTickerRow = (ticker: MarketQuote) => {
    const isUp = ticker.change24h >= 0;
    const displaySym = ticker.symbol.replace('/USDT', '').replace('/USD', '');
    const isSelected = selectedSymbol === ticker.symbol || selectedSymbol === displaySym;

    return (
      <div
        key={ticker.symbol}
        onClick={() => {
          setSelectedSymbol(ticker.symbol);
          onSelectTicker?.(ticker.symbol);
        }}
        className={`relative transition-colors duration-150 cursor-pointer select-none rounded-xl py-2.5 px-3 sm:px-4 ${
          isSelected
            ? 'bg-indigo-500/15 border border-indigo-500/35 shadow-sm'
            : 'bg-transparent hover:bg-white/[0.04] border border-transparent hover:border-white/[0.06]'
        }`}
      >
        {/* Grid without Sector: Asset | Last Price | 24h Chg | 24h Vol | Market Cap | Ratio | Action */}
        <div className="grid grid-cols-[minmax(210px,2.4fr)_minmax(120px,1.2fr)_minmax(90px,1fr)_minmax(105px,1.1fr)_minmax(125px,1.3fr)_minmax(80px,0.9fr)_minmax(90px,0.9fr)] items-center gap-3 w-full">
          {/* 1. Icon + Symbol Pill + Name */}
          <div className="flex items-center gap-2.5 min-w-0">
            {renderAssetLogo(ticker.symbol)}
            <span className="px-2.5 py-0.5 rounded-md bg-[var(--mx-surface-3)] text-white font-mono font-bold text-xs border border-white/[0.08] shrink-0 tracking-wide">
              {displaySym}
            </span>
            <span className="text-slate-200 text-xs sm:text-sm font-medium truncate">
              {ticker.name}
            </span>
          </div>

          {/* 2. Price + Currency */}
          <div className="flex items-baseline gap-1 font-mono">
            <span className="text-white text-xs sm:text-sm font-semibold tracking-tight">
              {formatTablePrice(ticker.price)}
            </span>
            <span className="text-slate-400 text-[10px] sm:text-[11px] uppercase tracking-wider font-mono">
              {ticker.currency || 'USD'}
            </span>
          </div>

          {/* 3. 24h Change */}
          <div className="font-mono text-xs sm:text-sm font-semibold">
            <span className={isUp ? 'text-emerald-400' : 'text-rose-400'}>
              {isUp ? '+' : ''}{ticker.change24h.toFixed(2)}%
            </span>
          </div>

          {/* 4. Volume */}
          <div className="font-mono text-xs sm:text-sm text-slate-200">
            {ticker.volume24h || '12.450 M'}
          </div>

          {/* 5. Market Cap */}
          <div className="font-mono text-xs sm:text-sm text-slate-200 whitespace-nowrap">
            {ticker.marketCap || '1.200 T USD'}
          </div>

          {/* 6. Ratio */}
          <div className="font-mono text-xs sm:text-sm text-slate-200">
            {ticker.ratio || '28.50'}
          </div>

          {/* 7. Action Button */}
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={e => {
                e.stopPropagation();
                onSelectPrompt(
                  `Analyze ${ticker.name} (${ticker.symbol}) on the 4H timeframe. Identify the key levels, trend and the best entry, stop loss and targets.`,
                  '4H'
                );
              }}
              className="inline-flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-300 border border-indigo-500/30 font-semibold shrink-0 cursor-pointer transition-all hover:scale-105"
            >
              <span>Analyze</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const totalPairs = sortedTickers.length;

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 pt-2 sm:pt-4 pb-28 sm:pb-16 space-y-6 sm:space-y-8 scroll-smooth max-w-7xl mx-auto w-full overscroll-contain pb-safe">
      {/* Hero: headline + ask box + quick prompts */}
      <section className="max-w-2xl mx-auto text-center pt-6 sm:pt-12 pb-2">
        <div className="mx-rise inline-flex items-center gap-2 h-7 px-3 max-w-full rounded-full bg-white/[0.04] border border-white/[0.07] text-[11px] min-[400px]:text-xs text-slate-400 whitespace-nowrap">
          <span className="relative flex w-1.5 h-1.5 shrink-0">
            <span className="radar-ring absolute inline-flex w-full h-full rounded-full bg-emerald-400/60" />
            <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </span>
          <span className="truncate">Live across crypto, forex, stocks & commodities</span>
        </div>

        <h1 className="mx-rise mt-5 text-[2rem] leading-[1.1] sm:text-5xl font-semibold tracking-tight text-white" style={{ animationDelay: '60ms' }}>
          Market intelligence,
          <br />
          <span className="bg-gradient-to-r from-indigo-300 via-indigo-400 to-cyan-300 bg-clip-text text-transparent">one prompt away.</span>
        </h1>
        <p className="mx-rise mt-4 text-[15px] text-slate-400 max-w-md mx-auto" style={{ animationDelay: '120ms' }}>
          Live prices, clear market structure and precise entries, stops and targets for any asset.
        </p>

        <form
          className="mx-rise mx-composer mt-7 flex items-center gap-2 p-1.5 pl-4 text-left"
          style={{ animationDelay: '180ms' }}
          onSubmit={e => {
            e.preventDefault();
            const input = (e.currentTarget.elements.namedItem('heroPrompt') as HTMLInputElement | null);
            const text = input?.value.trim();
            if (text) onSelectPrompt(text, '4H');
            else onAskMarketX();
          }}
        >
          <Sparkles className="w-4 h-4 text-indigo-300 shrink-0" />
          <input
            name="heroPrompt"
            type="text"
            autoComplete="off"
            placeholder="e.g. Analyze EUR/USD on the 1H…"
            className="flex-1 min-w-0 bg-transparent text-[15px] text-white focus:outline-none h-10"
          />
          <button
            type="submit"
            className="h-10 px-4 rounded-2xl bg-white text-slate-950 text-sm font-medium hover:bg-slate-200 active:scale-[0.98] transition inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            Ask <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mx-rise mt-4 flex flex-wrap items-center justify-center gap-2" style={{ animationDelay: '240ms' }}>
          {[
            { label: 'BTC 4H setup', prompt: 'Analyze BTC/USDT on the 4H timeframe. Provide real-time market structure, critical reaction zones, and directional outlook.' },
            { label: 'Gold outlook', prompt: 'Analyze XAU/USD gold spot on the 4H timeframe. Identify major price pivots, risk boundaries, and execution targets.' },
            { label: 'EUR/USD 1H', prompt: 'Analyze EUR/USD on the 1H timeframe. Map key reaction zones and give a precise entry, stop and targets.' },
            { label: 'NVDA daily', prompt: 'Analyze NVDA on the 1D timeframe. Provide market structure, key levels and a trade plan.' },
          ].map(chip => (
            <button
              key={chip.label}
              type="button"
              onClick={() => onSelectPrompt(chip.prompt, '4H')}
              className="h-8 px-3.5 rounded-full text-[13px] text-slate-300 bg-white/[0.03] border border-white/[0.07] hover:bg-white/[0.07] hover:text-white hover:border-white/[0.14] transition-colors cursor-pointer"
            >
              {chip.label}
            </button>
          ))}
        </div>
      </section>

      {/* SECTION 1: Live Market Pairs Table with 3-Second Revolving Carousel & Hold-to-Pause (Sector removed) */}
      <div className="w-full space-y-3">
        <div className="rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 border border-white/[0.06] bg-[var(--mx-surface)] space-y-3 sm:space-y-4">
          {/* Header Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-indigo-400">
                <BarChart2 className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm sm:text-base text-white tracking-tight">
                  Live Market Pairs
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300 border border-white/[0.08]">
                  {sortedTickers.length} Active
                </span>
              </div>
            </div>

            {/* Filter Tabs & Auto-Cycle Carousel Indicator with Hold to Pause status */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center p-0.5 rounded-lg bg-black/40 border border-white/[0.06] text-xs">
                {(['all', 'forex', 'stock', 'crypto', 'commodity'] as const).map(tab => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveCategory(tab)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                      activeCategory === tab
                        ? 'bg-[var(--mx-surface-3)] text-white shadow-xs font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab === 'all' ? 'All Pairs' : tab === 'forex' ? 'Forex' : tab === 'stock' ? 'Equities' : tab === 'crypto' ? 'Crypto' : 'Commodities'}
                  </button>
                ))}
              </div>

              {/* Status Badge: Live Market Feed */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.06] text-xs font-mono select-none">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[11px] text-emerald-300 font-semibold">Live Rates</span>
              </div>
            </div>
          </div>

          {/* Table Container with Horizontal Scroll for responsiveness */}
          <div className="relative overflow-x-auto -mx-1 sm:mx-0 pb-1">
            <div className="min-w-[780px] space-y-1 sm:space-y-1.5">
              {/* Column Headers (Sector column completely removed) */}
              <div className="grid grid-cols-[minmax(210px,2.4fr)_minmax(120px,1.2fr)_minmax(90px,1fr)_minmax(105px,1.1fr)_minmax(125px,1.3fr)_minmax(80px,0.9fr)_minmax(90px,0.9fr)] items-center gap-3 px-4 py-2 text-[11px] font-mono uppercase tracking-wider text-slate-400 select-none border-b border-white/[0.04]">
                <div>Asset</div>
                <div>Last Price</div>
                <div>24h Chg</div>
                <div>24h Vol</div>
                <div>Market Cap</div>
                <div>Ratio</div>
                <div className="text-right">Action</div>
              </div>

              {/* Full Market Pairs List - Fully Restored */}
              {sortedTickers.length > 0 ? (
                <div className="space-y-1.5 px-3 sm:px-4 py-2">
                  {sortedTickers.map(ticker => renderTickerRow(ticker))}
                </div>
              ) : (
                <div className="py-8 text-center text-xs font-mono text-slate-400">
                  No market pairs found for the selected category.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: Suggested Inquiries and Live Market Feeds (Feed Section Redesigned matching image.png) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
        {/* Left (col-span-6): Suggested Institutional Inquiries & Quick Setup Scanners */}
        <div className="lg:col-span-6 space-y-4">
          <div className="glass-panel rounded-2xl p-4 sm:p-5 border border-white/[0.08] shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <h2 className="font-bold text-sm sm:text-base text-white tracking-tight">
                  Suggested Institutional Inquiries
                </h2>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/[0.06] text-slate-300 border border-white/[0.08]">
                4H Setups
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Launch instant prompts tailored to today's market conditions, trends and key levels.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {[
                { label: 'BTC Trend Setup', sym: 'BTC/USDT', desc: 'Scan the 4H trend & key levels', prompt: 'Analyze BTC/USDT trend and key levels on 4H' },
                { label: 'ETH Liquidity Sweeps', sym: 'ETH/USDT', desc: 'Identify equal highs & liquidity sweep zones', prompt: 'Scan ETH/USDT equal highs and liquidity sweep zones' },
                { label: 'TSLA Valuation & 4H', sym: 'TSLA', desc: 'Key levels & trend exhaustion test', prompt: 'Analyze Tesla, Inc. (TSLA) on the 4H timeframe. Identify the key levels and the optimal entry.' },
                { label: 'AAPL Key Levels', sym: 'AAPL', desc: 'Map support, resistance & EMA ribbons', prompt: 'Analyze Apple Inc. (AAPL) on the 4H timeframe. Map key support and resistance levels.' },
                { label: 'SOL Breakout Targets', sym: 'SOL/USDT', desc: 'Momentum targets & risk/reward metrics', prompt: 'Calculate SOL/USDT momentum targets and risk/reward' },
                { label: 'Gold Spot Invalidation', sym: 'XAU/USD', desc: 'Support levels & stop-run invalidations', prompt: 'Analyze XAU/USD institutional support and invalidation levels' },
              ].map(chip => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => onSelectPrompt(chip.prompt, '4H')}
                  className="p-3 rounded-xl bg-white/[0.02] hover:bg-indigo-600/15 border border-white/[0.08] hover:border-indigo-500/35 text-left transition-all group cursor-pointer space-y-1"
                >
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-200 group-hover:text-indigo-200">
                    <span>{chip.label}</span>
                    <span className="text-[10px] font-mono text-slate-500 group-hover:text-indigo-300">
                      {chip.sym}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400 leading-snug">
                    {chip.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right (col-span-6): Live Market Feeds Redesigned strictly copying image.png UI style */}
        <div
          onMouseEnter={() => setIsFeedHolding(true)}
          onMouseLeave={() => setIsFeedHolding(false)}
          className="lg:col-span-6 space-y-4"
        >
          <div className="rounded-2xl sm:rounded-3xl p-4 sm:p-5 border border-white/[0.06] bg-[var(--mx-surface)] space-y-3 sm:space-y-4">
            {/* Upper Floating Card matching image.png */}
            {activeFeed && (
              <div className="rounded-2xl bg-[var(--mx-surface-2)] border border-white/[0.1] shadow-2xl p-4 sm:p-5 space-y-3 transition-all">
                {/* Header Row: 3 circular dots + timestamp + Live Feed indicator */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* 3 circular grey indicators matching image.png */}
                    <div className="flex items-center gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-slate-600/70" />
                      <div className="w-3 h-3 rounded-full bg-slate-600/70" />
                      <div className="w-3 h-3 rounded-full bg-slate-600/70" />
                    </div>
                    {/* Time text e.g. "2 days ago" or "Just now" */}
                    <span className="text-xs sm:text-sm font-mono text-slate-300 font-medium">
                      {activeFeed.timeAgo || 'Just now'}
                    </span>
                  </div>

                  {/* Stream Indicator & Prev/Next Controls */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                      Live Feed
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setActiveFeedIndex(prev => (prev - 1 + liveFeeds.length) % liveFeeds.length)}
                        title="Previous Feed"
                        className="p-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors cursor-pointer"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveFeedIndex(prev => (prev + 1) % liveFeeds.length)}
                        title="Next Feed"
                        className="p-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-slate-400 hover:text-white transition-colors cursor-pointer"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Body Row: Left Details + Right Mini Candlestick Chart preview */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Badges: Flame 🔥 + Star ⭐ + Crypto Logo + Symbol Pill */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Fire/Flame icon in rose pill */}
                      <div className="w-6 h-6 rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/30 flex items-center justify-center text-xs shrink-0 select-none">
                        🔥
                      </div>
                      {/* Star icon in purple pill */}
                      <div className="w-6 h-6 rounded-md bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 flex items-center justify-center text-xs shrink-0 select-none">
                        ⭐
                      </div>
                      <CryptoAssetLogo symbol={activeFeed.symbol} size="sm" />
                      <span className="font-mono font-bold text-xs text-white px-2 py-0.5 rounded-md bg-white/[0.08] border border-white/[0.08]">
                        {activeFeed.symbol}
                      </span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-400 border border-white/[0.06]">
                        {activeFeed.badge}
                      </span>
                      {activeFeed.isNew && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse font-bold">
                          NEW
                        </span>
                      )}
                    </div>

                    {/* Headline */}
                    <h3 className="font-bold text-sm sm:text-base text-white leading-snug tracking-tight">
                      {activeFeed.headline}
                    </h3>

                    {/* Detail */}
                    <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed font-normal">
                      {activeFeed.detail}
                    </p>

                    {/* Action Trigger */}
                    <div className="pt-1 flex items-center justify-between">
                      <span className={`text-xs font-semibold ${isFeedBullish ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isFeedBullish ? '▲ Bullish Confluence' : '▼ Bearish Pressure'}
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelectPrompt(activeFeed.suggestedPrompt, '4H')}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 text-xs font-semibold transition-all hover:scale-105 cursor-pointer"
                      >
                        <span>Analyze Prompt</span>
                        <ArrowRight className="w-3 h-3 text-indigo-300" />
                      </button>
                    </div>
                  </div>

                  {/* Candlestick Graphic Box on the Right matching sample image */}
                  <MiniCandlestickChart isBullish={isFeedBullish} />
                </div>
              </div>
            )}

            {/* Lower Section on Base Container: 3 Pill Chips matching sample image */}
            <div className="flex items-center justify-between gap-2 overflow-x-auto pt-1 select-none scrollbar-none">
              {/* Chip 1: Circular cyan badge with 30 -> DJI +0.03$ */}
              <button
                type="button"
                onClick={() => onSelectPrompt('Analyze Dow Jones Industrial Average (DJI) 4H liquidity confluence zones.', '4H')}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--mx-surface-2)] hover:bg-[var(--mx-surface-3)] border border-white/[0.08] hover:border-cyan-500/40 transition-all text-xs shrink-0 cursor-pointer shadow-xs group"
              >
                <div className="w-5 h-5 rounded-full bg-[#06b6d4] text-slate-950 font-extrabold text-[10px] font-mono flex items-center justify-center shrink-0">
                  30
                </div>
                <span className="font-mono font-bold text-slate-200 group-hover:text-white">DJI</span>
                <span className="font-mono font-semibold text-emerald-400 text-xs">+0.03$</span>
              </button>

              {/* Chip 2: Circular red badge with 500 -> SPX -0.51% */}
              <button
                type="button"
                onClick={() => onSelectPrompt('Analyze S&P 500 (SPX) trend, key levels and liquidity sweeps.', '4H')}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--mx-surface-2)] hover:bg-[var(--mx-surface-3)] border border-white/[0.08] hover:border-rose-500/40 transition-all text-xs shrink-0 cursor-pointer shadow-xs group"
              >
                <div className="w-5 h-5 rounded-full bg-[#ef4444] text-white font-extrabold text-[9px] font-mono flex items-center justify-center shrink-0">
                  500
                </div>
                <span className="font-mono font-bold text-slate-200 group-hover:text-white">SPX</span>
                <span className="font-mono font-semibold text-rose-400 text-xs">-0.51%</span>
              </button>

              {/* Chip 3: Circular blue badge with lightning -> IXIC -0.93% */}
              <button
                type="button"
                onClick={() => onSelectPrompt('Analyze Nasdaq Composite (IXIC) key support and resistance levels.', '4H')}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--mx-surface-2)] hover:bg-[var(--mx-surface-3)] border border-white/[0.08] hover:border-blue-500/40 transition-all text-xs shrink-0 cursor-pointer shadow-xs group"
              >
                <div className="w-5 h-5 rounded-full bg-[#0284c7] text-white font-extrabold text-[10px] font-mono flex items-center justify-center shrink-0">
                  <Zap className="w-3 h-3 fill-white" />
                </div>
                <span className="font-mono font-bold text-slate-200 group-hover:text-white">IXIC</span>
                <span className="font-mono font-semibold text-rose-400 text-xs">-0.93%</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 3: Official Trader Campaign (Post to X) */}
      {userProfile && onOpenShareModal && (
        <CampaignBanner
          userProfile={userProfile}
          xShareReward={xShareReward}
          onOpenShareModal={onOpenShareModal}
          onOpenEmailReceipt={onOpenEmailReceipt}
        />
      )}

      {/* SECTION 4: Dedicated Trader Mail Support & Inquiries */}
      <InstitutionalMailSupport className="mt-2 sm:mt-4" onOpenSupport={onOpenSupport} supportUnread={supportUnread} />
    </div>
  );
};
