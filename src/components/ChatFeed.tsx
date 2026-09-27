import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { motion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { ChatMessage, MarketQuote, StrategyResult } from '../types';
import { StrategyCard } from './StrategyCard';
import { MarketXText } from './MarketXText';
import { MarketXIcon } from './MarketXIcon';
import { VerifiedBadge } from './VerifiedBadge';
import { downloadStrategyImage, shareToX } from '../utils/exportImage';
import { UserProfile } from '../types';
import { AiStepProgressIndicator } from './AiStepProgressIndicator';
import { HighImpactNewsAlert } from './HighImpactNewsAlert';
import { AiReasoningAccordion } from './AiReasoningAccordion';
import { Bitcoin, Gem, Activity, Coins } from 'lucide-react';
import {
  User,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Search,
  Zap,
  BarChart2,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Target,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  FileText,
  Download,
  AlertCircle,
  Copy,
  Check,
  Cpu
} from 'lucide-react';

interface ChatFeedProps {
  messages: ChatMessage[];
  isLoading: boolean;
  tickers: MarketQuote[];
  onSelectPrompt: (
    prompt: string,
    timeframe?: string,
    slMode?: 'normal' | 'tight',
    baseStrategy?: StrategyResult
  ) => void;
  onSelectTicker: (symbol: string) => void;
  userProfile?: UserProfile;
  targetMessageId?: string | null;
  onClearTargetMessage?: () => void;
}

export const ChatFeed: React.FC<ChatFeedProps> = ({
  messages,
  isLoading,
  tickers,
  onSelectPrompt,
  onSelectTicker,
  userProfile,
  targetMessageId,
  onClearTargetMessage,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(messages.length);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewImageModal, setPreviewImageModal] = useState<string | null>(null);

  const handleTightenStopLoss = (strat: StrategyResult) => {
    const prompt = `Tighten the stop loss for ${strat.symbol} on this setup. Keep the identical entry, take-profit targets, and analysis structure, but recalculate a tighter invalidation stop loss and updated risk-reward ratio.`;
    onSelectPrompt(prompt, strat.timeframe, 'tight', strat);
  };

  const handleCopyText = (id: string, text: string) => {
    const formattedText = text.includes('marketx.world')
      ? text
      : `${text}\n\n— Analyzed with MarketX AI: https://marketx.world`;
    navigator.clipboard.writeText(formattedText);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyTradeSetup = (strategy: any, msgId: string) => {
    const summary = `📊 MARKETX QUANT SETUP: ${strategy.symbol} (${strategy.timeframe} TF)
Action: ${strategy.tradeType} | Confidence: ${strategy.confidenceScore}%
🎯 Optimal Entry: $${strategy.entryZone.optimal}
🛑 Invalidation Stop Loss: $${strategy.stopLoss.price} (-${strategy.stopLoss.riskPercent}%)
💰 Targets: ${strategy.takeProfits.map((tp: any) => `${tp.level}: $${tp.price} (${tp.rewardRatio})`).join(' | ')}
⚖️ Risk / Reward: ${strategy.riskRewardRatio}
Rationale: ${strategy.entryZone.rationale}

🔗 Trade with AI: https://marketx.world`;

    navigator.clipboard.writeText(summary);
    setCopiedId(`setup-${msgId}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Real-time greeting based on local time and profile name (only shown in new chat sessions)
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    let timeGreeting = 'Good morning';
    if (hour >= 12 && hour < 17) {
      timeGreeting = 'Good afternoon';
    } else if (hour >= 17 || hour < 5) {
      timeGreeting = 'Good evening';
    }

    let name = '';
    if (
      userProfile?.displayName &&
      userProfile.displayName.trim() &&
      userProfile.displayName.toLowerCase() !== 'guest trader'
    ) {
      name = userProfile.displayName.trim().split(' ')[0];
    } else if (
      userProfile?.username &&
      userProfile.username.trim() &&
      userProfile.username.toLowerCase() !== 'trader'
    ) {
      const raw = userProfile.username.replace(/^@/, '').trim();
      name = raw.charAt(0).toUpperCase() + raw.slice(1);
    }

    return name ? `${timeGreeting}, ${name}` : `${timeGreeting}`;
  }, [userProfile?.displayName, userProfile?.username]);

  // Track scroll position to show arrow at the bottom (pointing to top) and at top (pointing to bottom)
  const [scrollArrow, setScrollArrow] = useState<{
    visible: boolean;
    direction: 'top' | 'bottom';
  }>({ visible: false, direction: 'top' });

  // History analysis lock ref: keeps viewport anchored on historical analysis without snapping down
  const lockedTargetIdRef = useRef<string | null>(null);
  const userHasInteractedRef = useRef<boolean>(false);
  const scrollRafRef = useRef<number | null>(null);

  // Smoothly slides down to the most recent prompt and active analysis indicator
  const scrollToLatestAnalysis = useCallback((smooth: boolean = true) => {
    // If locked on a historical analysis, do NOT auto-scroll down
    if (lockedTargetIdRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    // First priority: if an active analysis indicator is running, ensure it is visibly framed with the prompt right above it
    const activeAnalysisIndicator = document.getElementById('ai-active-analysis-indicator');
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userElem = lastUserMsg ? document.getElementById(`chat-msg-${lastUserMsg.id}`) : null;

    if (userElem) {
      // Calculate offset so the user prompt sits neatly at the top of the viewing area
      const containerRect = container.getBoundingClientRect();
      const elemRect = userElem.getBoundingClientRect();
      const targetScrollTop = container.scrollTop + (elemRect.top - containerRect.top) - 16;

      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: smooth ? 'smooth' : 'auto',
      });
      return;
    }

    if (activeAnalysisIndicator) {
      activeAnalysisIndicator.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        block: 'nearest',
      });
      return;
    }

    // Fallback: slide down to bottom
    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    });
  }, [messages]);

  // Clean up RAF timer on unmount
  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  // When a particular signal is clicked from the history page, take user directly to that particular signal response and STAY there
  useEffect(() => {
    if (targetMessageId) {
      lockedTargetIdRef.current = targetMessageId;
      userHasInteractedRef.current = false;

      const scrollToTarget = () => {
        // If user already started scrolling manually, don't interrupt them
        if (userHasInteractedRef.current) return;

        const tid = lockedTargetIdRef.current || targetMessageId;
        const foundMsg = messages.find(
          m => m.id === tid || (m.strategy && (tid.includes(m.strategy.symbol) || m.strategy.symbol === tid))
        );
        const resolvedId = foundMsg ? foundMsg.id : tid;

        const targetElement =
          document.getElementById(`signal-card-${resolvedId}`) ||
          document.getElementById(`chat-msg-${resolvedId}`);

        if (targetElement) {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setHighlightedId(resolvedId);
          return true;
        }
        return false;
      };

      // Attempt multiple times to guarantee lock even as DOM renders charts and cards
      const t1 = setTimeout(scrollToTarget, 50);
      const t2 = setTimeout(scrollToTarget, 200);
      const t3 = setTimeout(scrollToTarget, 500);
      const t4 = setTimeout(scrollToTarget, 900);

      // Keep highlight for 5 seconds for visual identification, but DO NOT clear targetMessage or auto-scroll down
      const clearHlTimer = setTimeout(() => {
        setHighlightedId(null);
      }, 5000);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
        clearTimeout(t4);
        clearTimeout(clearHlTimer);
      };
    } else {
      lockedTargetIdRef.current = null;
    }
  }, [targetMessageId, messages]);

  // Auto-slide down immediately on mount if an analysis is loading or messages exist
  useEffect(() => {
    if (messages.length > 0 && !lockedTargetIdRef.current) {
      const t0 = setTimeout(() => scrollToLatestAnalysis(true), 60);
      const t1 = setTimeout(() => scrollToLatestAnalysis(true), 180);
      const t2 = setTimeout(() => scrollToLatestAnalysis(true), 400);
      return () => {
        clearTimeout(t0);
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, []); // Run on mount

  // Controlled auto-slide when a new analysis is initiated: slides down so prompt is at top and response/indicator starts directly under it
  useEffect(() => {
    // If locked on historical analysis, NEVER auto-scroll to bottom
    if (lockedTargetIdRef.current) {
      prevCountRef.current = messages.length;
      return;
    }

    if (messages.length > 0) {
      const isNewMessage = messages.length !== prevCountRef.current;
      if (isNewMessage) {
        userHasInteractedRef.current = false;
        // Schedule auto-scroll so the user prompt is at the top and the new response starts under it
        const t1 = setTimeout(() => scrollToLatestAnalysis(true), 40);
        const t2 = setTimeout(() => scrollToLatestAnalysis(true), 150);
        const t3 = setTimeout(() => scrollToLatestAnalysis(true), 350);
        const t4 = setTimeout(() => scrollToLatestAnalysis(true), 600);
        return () => {
          clearTimeout(t1);
          clearTimeout(t2);
          clearTimeout(t3);
          clearTimeout(t4);
        };
      }
    }
    prevCountRef.current = messages.length;
  }, [messages.length, scrollToLatestAnalysis]);

  // Also auto-slide when isLoading turns true (e.g. Analysis begins)
  useEffect(() => {
    if (isLoading && !lockedTargetIdRef.current) {
      userHasInteractedRef.current = false;
      const t1 = setTimeout(() => scrollToLatestAnalysis(true), 50);
      const t2 = setTimeout(() => scrollToLatestAnalysis(true), 180);
      const t3 = setTimeout(() => scrollToLatestAnalysis(true), 450);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [isLoading, scrollToLatestAnalysis]);

  // When analysis loading finishes (the response has fully generated), ensure it automatically slides down with prompt at the top and response starting directly under it
  useEffect(() => {
    if (!isLoading && messages.length > 0 && !lockedTargetIdRef.current) {
      userHasInteractedRef.current = false;
      const t1 = setTimeout(() => scrollToLatestAnalysis(true), 40);
      const t2 = setTimeout(() => scrollToLatestAnalysis(true), 150);
      const t3 = setTimeout(() => scrollToLatestAnalysis(true), 350);
      const t4 = setTimeout(() => scrollToLatestAnalysis(true), 700);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
        clearTimeout(t4);
      };
    }
  }, [isLoading, messages.length, scrollToLatestAnalysis]);

  // RAF-throttled zero-lag scroll handler that prevents re-render thrashing
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const container = containerRef.current;
      if (!container) return;

      const { scrollTop, scrollHeight, clientHeight } = container;
      const isScrollable = scrollHeight > clientHeight + 60;

      if (!isScrollable) {
        setScrollArrow(prev => prev.visible ? { visible: false, direction: 'top' } : prev);
        return;
      }

      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const newVisible = true;
      const newDirection: 'top' | 'bottom' = distanceFromBottom <= 140 ? 'top' : 'bottom';

      // Only update state when values actually change (avoids 100+ re-renders per second while scrolling!)
      setScrollArrow(prev => {
        if (prev.visible === newVisible && prev.direction === newDirection) {
          return prev;
        }
        return { visible: newVisible, direction: newDirection };
      });
    });
  }, []);

  const handleArrowClick = () => {
    const container = containerRef.current;
    if (!container) return;

    if (scrollArrow.direction === 'top') {
      container.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
    } else {
      // User explicitly requested to slide down to latest message
      lockedTargetIdRef.current = null;
      userHasInteractedRef.current = false;
      onClearTargetMessage?.();
      scrollToLatestAnalysis(true);
    }
  };

  // Exclude SPY, VIX, EUR/USD, GBP/USD, BOOM, CRASH from live market section
  const bannedKeywords = ['SPY', 'VIX', 'EUR/USD', 'GBP/USD', 'BOOM', 'CRASH'];
  const validTickers = tickers.filter(ticker => {
    const sym = ticker.symbol.toUpperCase();
    const name = ticker.name.toUpperCase();
    return !bannedKeywords.some(b => sym.includes(b) || name.includes(b));
  });

  // Track ordered symbols for animated position swapping
  const [orderedSymbols, setOrderedSymbols] = useState<string[]>(() =>
    validTickers.map(t => t.symbol)
  );

  // Keep orderedSymbols in sync when validTickers updates
  useEffect(() => {
    setOrderedSymbols(prev => {
      const validSet = new Set(validTickers.map(t => t.symbol));
      const filtered = prev.filter(sym => validSet.has(sym));
      for (const t of validTickers) {
        if (!filtered.includes(t.symbol)) {
          filtered.push(t.symbol);
        }
      }
      return filtered.length > 0 ? filtered : validTickers.map(t => t.symbol);
    });
  }, [tickers]);

  // Animate live market pairs swapping positions gently only when in empty state
  useEffect(() => {
    if (messages.length > 0 || orderedSymbols.length < 2) return;
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setOrderedSymbols(prev => {
        if (prev.length < 2) return prev;
        const next = [...prev];
        const i = Math.floor(Math.random() * next.length);
        let j = Math.floor(Math.random() * (next.length - 1));
        if (j >= i) j += 1;
        const temp = next[i];
        next[i] = next[j];
        next[j] = temp;
        return next;
      });
    }, 12000);
    return () => clearInterval(interval);
  }, [orderedSymbols.length, messages.length]);

  const getCategoryBadge = (type: string, symbol: string) => {
    if (type === 'commodity' || symbol.includes('XAU')) return { label: 'GOLD SPOT', color: 'text-amber-300 bg-amber-500/15 border-amber-500/30' };
    if (type === 'crypto') return { label: 'CRYPTO', color: 'text-purple-300 bg-purple-500/15 border-purple-500/30' };
    if (type === 'forex') return { label: 'FOREX', color: 'text-sky-300 bg-sky-500/15 border-sky-500/30' };
    return { label: 'EQUITY', color: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/30' };
  };

  return (
    <div className="relative flex-1 h-full min-w-0 w-full overflow-hidden flex flex-col">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onWheel={() => { userHasInteractedRef.current = true; }}
        onTouchMove={() => { userHasInteractedRef.current = true; }}
        className="flex-1 h-full overflow-y-auto overflow-x-hidden px-3 sm:px-6 pt-2 sm:pt-4 pb-8 space-y-5 sm:space-y-6 min-w-0 w-full overscroll-contain fast-scroll"
      >
      {/* Empty state: greeting + suggestion cards */}
      {messages.length === 0 && !isLoading && (
        <div className="max-w-2xl mx-auto min-h-full flex flex-col justify-center py-10 px-1">
          <div className="text-center mb-8 mx-rise">
            <h2 className="text-[1.75rem] leading-tight sm:text-4xl font-semibold tracking-tight text-white">{greeting}</h2>
            <p className="text-sm sm:text-[15px] text-slate-400 mt-2.5">
              What market should we analyze today?
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
            {[
              {
                icon: Bitcoin,
                tint: 'text-amber-300 bg-amber-500/10',
                title: 'Bitcoin structure',
                desc: '4H trend, key reaction zones and outlook',
                prompt: 'Analyze BTC/USDT on the 4H timeframe. Provide real-time market structure, critical reaction zones, and directional outlook.',
              },
              {
                icon: Gem,
                tint: 'text-indigo-300 bg-indigo-500/10',
                title: 'Ethereum levels',
                desc: 'Support, resistance and breakout targets',
                prompt: 'Analyze ETH/USDT on the 4H timeframe. Map out key price levels, reaction zones, and high-probability breakout targets.',
              },
              {
                icon: Activity,
                tint: 'text-emerald-300 bg-emerald-500/10',
                title: 'Solana momentum',
                desc: 'Trend strength and invalidation levels',
                prompt: 'Analyze SOL/USDT on the 4H timeframe. Assess momentum strength, key reaction zones, and tactical trade boundaries.',
              },
              {
                icon: Coins,
                tint: 'text-yellow-200 bg-yellow-500/10',
                title: 'Gold (XAU/USD)',
                desc: 'Macro pivots, risk and targets',
                prompt: 'Analyze XAU/USD gold spot on the 4H timeframe. Identify major price pivots, risk boundaries, and execution targets.',
              },
            ].map((card, idx) => {
              const Icon = card.icon;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSelectPrompt(card.prompt, '4H')}
                  className="mx-card mx-rise group flex items-start gap-3 p-3.5 text-left cursor-pointer"
                  style={{ animationDelay: `${80 + idx * 60}ms` }}
                >
                  <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${card.tint}`}>
                    <Icon className="w-[18px] h-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-100">{card.title}</span>
                    <span className="block text-[13px] text-slate-500 mt-0.5 leading-snug">{card.desc}</span>
                  </span>
                  <ArrowUpRight className="w-4 h-4 text-slate-600 group-hover:text-slate-200 transition-colors shrink-0 mt-0.5" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Messages Stream: Conversational AI Dialogue */}
      {messages.map((message, index) => {
        const isUser = message.role === 'user';
        const strategy = message.strategy;
        const isTargeted = highlightedId === message.id;
        const priorUserMessage = messages.slice(0, index).reverse().find(m => m.role === 'user');

        return (
          <div
            key={message.id}
            id={`chat-msg-${message.id}`}
            className={`mx-rise flex gap-2 sm:gap-3 w-full min-w-0 max-w-3xl mx-auto ${
              isUser ? 'justify-end' : 'justify-start'
            }`}
          >
            {/* Assistant Avatar */}
            {!isUser && (
              <div className="w-7 h-7 rounded-full bg-white/[0.05] ring-1 ring-white/[0.08] flex items-center justify-center shrink-0 mt-0.5 overflow-hidden">
                <MarketXIcon size="sm" />
              </div>
            )}

            {/* Message Body */}
            <div className={`space-y-1.5 min-w-0 ${isUser ? 'max-w-[92%] sm:max-w-[85%] items-end' : 'w-full max-w-full items-start'}`}>
              {/* User message bubble */}
              {isUser ? (
                <div className="group flex flex-col items-end gap-1.5 w-full">
                  {message.chartImage && (
                    <button
                      type="button"
                      onClick={() => setPreviewImageModal(message.chartImage || null)}
                      className="rounded-2xl overflow-hidden ring-1 ring-white/[0.08] hover:ring-white/20 transition max-w-[260px] cursor-zoom-in"
                      title={message.chartFileName || 'Attached chart'}
                    >
                      <img
                        src={message.chartImage}
                        alt="Attached chart"
                        className="w-full max-h-48 object-cover bg-slate-900"
                        referrerPolicy="no-referrer"
                      />
                    </button>
                  )}
                  <div className="rounded-3xl rounded-br-lg bg-white/[0.07] px-4 py-2.5 text-[15px] leading-relaxed text-slate-100 whitespace-pre-wrap break-words">
                    {message.content}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-slate-500 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyText(message.id, message.content)}
                      className="h-6 w-6 rounded-full hover:bg-white/[0.08] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                      title="Copy"
                      aria-label="Copy message"
                    >
                      {copiedId === message.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="w-full space-y-3 min-w-0">
                  {/* Clean Independent Progressive Step Indicator */}
                  {message.status === 'searching' && (
                    <AiStepProgressIndicator
                      searchStep={message.searchStep}
                      timestamp={message.timestamp}
                      promptSnippet={priorUserMessage?.content}
                    />
                  )}

                  {/* Trade Results Shown Directly as Conversational AI Response */}
                  {strategy && (
                    <div
                      id={`signal-card-${message.id}`}
                      className={`space-y-3.5 animate-fadeIn min-w-0 w-full rounded-2xl transition-all duration-300 ${
                        isTargeted ? 'signal-targeted-active ring-2 ring-indigo-400/90 p-1.5' : ''
                      }`}
                    >
                      {/* Active History Direct Jump Focus Pill */}
                      {isTargeted && (
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/30 text-cyan-300 border border-indigo-500/40 text-xs font-semibold w-fit shadow-md animate-pulse">
                          <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                          <span>Direct View: Selected Signal Response from History</span>
                        </div>
                      )}

                      {/* Completed Reasoning Accordion: Modern Frontier Thought Process */}
                      <AiReasoningAccordion
                        symbol={strategy.symbol}
                        timeframe={strategy.timeframe}
                        confidenceScore={strategy.confidenceScore}
                        durationSeconds={message.durationSeconds}
                        steps={message.reasoningSteps}
                      />

                      {/* High Impact News Detected Banner */}
                      {strategy.highImpactNews && strategy.highImpactNews.detected && (
                        <HighImpactNewsAlert news={strategy.highImpactNews} />
                      )}

                      {/* Modern AI Conversational Writeup Container */}
                      <div className="p-4 sm:p-5 rounded-2xl sm:rounded-3xl ai-writeup-container border border-white/[0.12] text-xs sm:text-sm text-slate-100 leading-relaxed font-sans shadow-2xl space-y-3 min-w-0 break-words">
                        {/* Top Intelligence Header */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-5 h-5 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center">
                              <Sparkles className="w-3 h-3 text-indigo-400" />
                            </div>
                            <span className="font-bold text-white text-xs sm:text-sm flex items-center gap-1">
                              <MarketXText className="text-xs sm:text-sm" /> Institutional Analysis Memo
                            </span>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 font-semibold hidden sm:inline">
                              0.618 Pocket Verified
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/[0.06] text-slate-300 border border-white/[0.1]">
                              {strategy.symbol} • {strategy.timeframe} TF
                            </span>
                            <button
                              type="button"
                              onClick={() => handleCopyText(`writeup-${message.id}`, message.content || strategy.entryZone.rationale)}
                              className="text-slate-400 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-white/[0.06] flex items-center gap-1 text-[11px] font-mono cursor-pointer"
                              title="Copy AI Analysis Writeup"
                            >
                              {copiedId === `writeup-${message.id}` ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-300 font-semibold">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-slate-400" />
                                  <span>Copy Writeup</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* High-Confluence Bias Banner Callout */}
                        <div
                          className={`p-3 rounded-xl border flex items-start gap-2.5 ${
                            strategy.tradeType === 'LONG'
                              ? 'bg-emerald-500/[0.08] border-emerald-400/30 text-emerald-200'
                              : strategy.tradeType === 'SHORT'
                              ? 'bg-rose-500/[0.08] border-rose-400/30 text-rose-200'
                              : 'bg-amber-500/[0.08] border-amber-400/30 text-amber-200'
                          }`}
                        >
                          <div className="mt-0.5 shrink-0">
                            {strategy.tradeType === 'LONG' ? (
                              <ArrowUpRight className="w-4 h-4 text-emerald-400" />
                            ) : strategy.tradeType === 'SHORT' ? (
                              <ArrowDownRight className="w-4 h-4 text-rose-400" />
                            ) : (
                              <AlertCircle className="w-4 h-4 text-amber-400" />
                            )}
                          </div>
                          <div className="space-y-0.5 min-w-0">
                            <span className="text-xs font-bold font-mono tracking-wide block">
                              {strategy.tradeType === 'LONG'
                                ? 'HIGH-CONFLUENCE LONG SETUP • STRUCTURAL SUPPORT ALIGNMENT'
                                : strategy.tradeType === 'SHORT'
                                ? 'HIGH-CONFLUENCE SHORT SETUP • OVERHEAD RESISTANCE PIVOT'
                                : 'EQUILIBRIUM CONSOLIDATION • NEUTRAL BIAS'}
                            </span>
                            <p className="text-[11px] opacity-90 leading-relaxed">
                              {strategy.tradeType === 'LONG'
                                ? `Buyer absorption defended $${strategy.entryZone.optimal.toLocaleString()} with strong volume confluence. Targeting upside expansion.`
                                : strategy.tradeType === 'SHORT'
                                ? `Sellers defending key pivot above $${strategy.entryZone.optimal.toLocaleString()}. Invalidation anchored at structural high.`
                                : 'Price action is consolidating in a neutral range. Recommended approach: Wait for directional confirmation.'}
                            </p>
                          </div>
                        </div>

                        {/* High-Contrast Markdown Synthesis */}
                        <div className="prose prose-invert prose-xs sm:prose-sm max-w-none text-slate-200 leading-relaxed space-y-2 break-words">
                          {message.content && message.content.length > 60 ? (
                            <ReactMarkdown>{message.content}</ReactMarkdown>
                          ) : strategy.tradeType === 'NO_SIGNAL' ? (
                            <p>
                              I've analyzed live order books and market depth for <strong className="text-white font-mono">{strategy.symbol}</strong> ({strategy.name}) on the <strong className="text-indigo-300 font-mono">{strategy.timeframe}</strong> timeframe.
                              <span className="text-amber-300 font-semibold block mt-1.5 flex items-center gap-1.5">
                                <AlertCircle className="w-4 h-4 inline shrink-0" />
                                No high-confluence signal opportunity found.
                              </span>
                              Current price action is in choppy consolidation around equilibrium. Recommended action: Stand aside and wait for a decisive breakout.
                            </p>
                          ) : strategy.tradeType === 'SHORT' ? (
                            <p>
                              I've analyzed live order books and market depth for <strong className="text-white font-mono">{strategy.symbol}</strong> ({strategy.name}) on the <strong className="text-indigo-300 font-mono">{strategy.timeframe}</strong> timeframe. Found high-confluence <strong className="text-rose-300">Short Setup (Resistance & Invalidation Boundary)</strong> alignment:
                            </p>
                          ) : (
                            <p>
                              I've analyzed live order books and market depth for <strong className="text-white font-mono">{strategy.symbol}</strong> ({strategy.name}) on the <strong className="text-indigo-300 font-mono">{strategy.timeframe}</strong> timeframe. Found high-confluence <strong className="text-emerald-300">Long Setup (Support & Confluence Entry)</strong> alignment:
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Executive Strategy Setup Card */}
                      <div className="p-4 sm:p-5 rounded-2xl sm:rounded-3xl glass-panel-elevated border border-white/[0.14] space-y-3.5 sm:space-y-4 shadow-2xl min-w-0 overflow-hidden">
                        {/* Header Info */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-white/[0.08]">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-extrabold text-lg sm:text-xl text-white font-mono tracking-tight">
                              {strategy.symbol}
                            </span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-white/[0.06] text-slate-200 border border-white/[0.1]">
                              {strategy.timeframe} TF
                            </span>
                            <span className="text-xs text-slate-400 hidden sm:inline font-sans">
                              {strategy.name}
                            </span>
                            {/* Trader Username on Card */}
                            <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-black/40 border border-white/[0.1] text-[11px] font-mono text-slate-300">
                              <span className="text-slate-500 text-[10px]">Trader:</span>
                              <span className="font-semibold text-white">@{userProfile?.username || 'trader'}</span>
                              {userProfile?.isVerified && <VerifiedBadge size="sm" />}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {strategy.tradeType === 'NO_SIGNAL' ? (
                              <span className="px-2.5 py-1 rounded-lg text-xs font-bold font-mono border flex items-center gap-1.5 bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-xs">
                                <AlertCircle className="w-3.5 h-3.5" />
                                <span>NO SIGNAL OPPORTUNITY</span>
                              </span>
                            ) : strategy.tradeType === 'LONG' ? (
                              <span className="px-2.5 py-1 rounded-lg text-xs font-bold font-mono border flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-xs">
                                <ArrowUpRight className="w-3.5 h-3.5" />
                                <span>BUY LIMIT / BUY ZONE</span>
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-lg text-xs font-bold font-mono border flex items-center gap-1.5 bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-xs">
                                <ArrowDownRight className="w-3.5 h-3.5" />
                                <span>SELL LIMIT / SELL ZONE</span>
                              </span>
                            )}
                            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/20 text-indigo-200 border border-indigo-500/30 text-xs font-semibold">
                              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                              <span>{strategy.confidenceScore}% Confluence</span>
                            </div>
                          </div>
                        </div>

                        {/* Trade Parameters Key Matrix */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 text-xs font-mono">
                          {/* Optimal Entry */}
                          <div className="p-3 rounded-xl bg-amber-500/[0.08] border border-amber-500/25 min-w-0 hover:border-amber-400/40 transition-all">
                            <span className="text-[10px] text-amber-300 font-sans block uppercase font-semibold flex items-center gap-1 truncate">
                              <Target className="w-3 h-3 text-amber-400 shrink-0" />
                              Optimal Entry
                            </span>
                            <span className="text-xs sm:text-base font-bold text-amber-200 mt-1 block truncate font-mono">
                              ${strategy.currentPrice < 10 ? strategy.entryZone.optimal.toFixed(4) : strategy.entryZone.optimal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                            <span className="text-[10px] text-amber-300/80 block mt-0.5 truncate font-mono">
                              ${strategy.entryZone.min} - ${strategy.entryZone.max}
                            </span>
                          </div>

                          {/* Stop Loss */}
                          <div className="p-3 rounded-xl bg-rose-500/[0.08] border border-rose-500/25 min-w-0 hover:border-rose-400/40 transition-all">
                            <span className="text-[10px] text-rose-300 font-sans block uppercase font-semibold flex items-center gap-1 truncate">
                              <ShieldAlert className="w-3 h-3 text-rose-400 shrink-0" />
                              Stop Loss
                            </span>
                            <span className="text-xs sm:text-base font-bold text-rose-200 mt-1 block truncate font-mono">
                              ${strategy.currentPrice < 10 ? strategy.stopLoss.price.toFixed(4) : strategy.stopLoss.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                            <span className="text-[10px] text-rose-300/80 block mt-0.5 truncate font-mono">
                              Risk: -{strategy.stopLoss.riskPercent}%
                            </span>
                          </div>

                          {/* Primary Take Profit */}
                          <div className="p-3 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/25 min-w-0 hover:border-emerald-400/40 transition-all">
                            <span className="text-[10px] text-emerald-300 font-sans block uppercase font-semibold flex items-center gap-1 truncate">
                              <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0" />
                              TP1 Target
                            </span>
                            <span className="text-xs sm:text-base font-bold text-emerald-200 mt-1 block truncate font-mono">
                              ${strategy.currentPrice < 10 ? strategy.takeProfits[0]?.price.toFixed(4) : strategy.takeProfits[0]?.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                            <span className="text-[10px] text-emerald-300/80 block mt-0.5 truncate font-mono">
                              {strategy.takeProfits[0]?.rewardRatio} ({strategy.takeProfits[0]?.exitPercent}%)
                            </span>
                          </div>

                          {/* Risk / Reward */}
                          <div className="p-3 rounded-xl bg-indigo-500/[0.08] border border-indigo-500/25 min-w-0 hover:border-indigo-400/40 transition-all">
                            <span className="text-[10px] text-indigo-300 font-sans block uppercase font-semibold truncate flex items-center gap-1">
                              <Zap className="w-3 h-3 text-indigo-400 shrink-0" />
                              Risk / Reward
                            </span>
                            <span className="text-xs sm:text-base font-bold text-indigo-200 mt-1 block truncate font-mono">
                              {strategy.riskRewardRatio}
                            </span>
                            <span className="text-[10px] text-indigo-300/80 block mt-0.5 truncate font-mono">
                              Positive Expectancy
                            </span>
                          </div>
                        </div>

                        {/* Extended Targets Pill Row: Space between TP2 and TP3 */}
                        {strategy.takeProfits.length > 1 && (
                          <div className="flex flex-wrap items-center gap-2 sm:gap-3 pt-1 text-[10px] sm:text-[11px] font-mono">
                            <span className="text-slate-300 font-sans font-medium">Additional Targets:</span>
                            {strategy.takeProfits.slice(1).map((tp, idx) => (
                              <span
                                key={idx}
                                className={`px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold truncate ${
                                  idx > 0 ? 'ml-3 sm:ml-4' : ''
                                }`}
                              >
                                {tp.level}: ${strategy.currentPrice < 10 ? tp.price.toFixed(4) : tp.price.toLocaleString(undefined, { minimumFractionDigits: 2 })} ({tp.rewardRatio})
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Strategy Rationale Summary */}
                        <div className="p-3 rounded-xl bg-sky-950/25 border border-sky-400/20 text-xs text-slate-200 leading-relaxed font-sans shadow-inner break-words">
                          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-mono font-bold text-sky-400 mb-1">
                            <span>Market Structure & Execution Thesis</span>
                          </div>
                          <p>{strategy.entryZone.rationale}</p>
                        </div>

                        {/* Action Row: Share to 𝕏, Download as Image, & Copy Parameters */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/[0.08]">
                          <div className="flex flex-wrap items-center gap-2">
                            {strategy.tradeType !== 'NO_SIGNAL' && (
                              <button
                                type="button"
                                onClick={() => handleTightenStopLoss(strategy)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 text-rose-200 hover:text-white border border-rose-500/30 text-xs font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-xs"
                                title="Tighten Stop Loss on this exact setup while locking in identical entry & targets"
                              >
                                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                                <span>Tighten SL</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => shareToX(strategy, userProfile?.username)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white border border-white/[0.12] text-xs font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-xs"
                              title="Share trade setup to X (Twitter)"
                            >
                              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                              </svg>
                              <span>Share to 𝕏</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => downloadStrategyImage(strategy, userProfile?.username, userProfile?.isVerified)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/45 text-indigo-200 hover:text-white border border-indigo-500/40 text-xs font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-xs"
                              title="Download high-resolution trade setup graphic as PNG"
                            >
                              <Download className="w-3.5 h-3.5 text-indigo-300" />
                              <span>Download Image</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCopyTradeSetup(strategy, message.id)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/[0.1] text-xs font-semibold transition-all cursor-pointer shadow-xs"
                              title="Copy trade setup parameters"
                            >
                              {copiedId === `setup-${message.id}` ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                  <span className="text-emerald-300 font-semibold">Parameters Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                                  <span>Copy Setup</span>
                                </>
                              )}
                            </button>
                          </div>

                          <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">
                            HQ 1200x800 Graphic
                          </span>
                        </div>
                      </div>

                      {/* Deep Interactive Strategy Visualizer & Details */}
                      <StrategyCard
                        strategy={strategy}
                        onFollowUpPrompt={(prompt, opts) => {
                          onSelectPrompt(
                            prompt,
                            strategy.timeframe,
                            opts?.isTightSl ? 'tight' : 'normal',
                            opts?.baseStrategy || (opts?.isTightSl ? strategy : undefined)
                          );
                        }}
                        onTightenStopLoss={handleTightenStopLoss}
                        userProfile={userProfile}
                      />
                    </div>
                  )}

                  {/* Conversational text response if present without strategy card */}
                  {!strategy && message.content && (
                    <div className="p-4 sm:p-5 rounded-2xl sm:rounded-3xl ai-writeup-container border border-white/[0.12] text-slate-100 text-xs sm:text-sm leading-relaxed shadow-2xl space-y-3 break-words">
                      <div className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-2.5">
                        <div className="flex items-center gap-2 text-indigo-300 font-semibold text-xs">
                          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                          <span><MarketXText className="text-xs" /> Frontier AI Assistant</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyText(message.id, message.content)}
                          className="text-slate-400 hover:text-white transition-colors px-2 py-0.5 rounded hover:bg-white/[0.06] flex items-center gap-1 text-[11px] font-mono cursor-pointer"
                        >
                          {copiedId === message.id ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span className="text-emerald-300 font-semibold">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 text-slate-400" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="prose prose-invert prose-xs sm:prose-sm max-w-none text-slate-200 leading-relaxed break-words">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Timestamp */}
              <div className={`text-[10px] text-slate-500 px-1 ${isUser ? 'text-right' : 'text-left'}`}>
                {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>

          </div>
        );
      })}

      {/* Global loading state if an analysis is being computed and no searching message is already in list */}
      {isLoading && !messages.some(m => m.role === 'assistant' && m.status === 'searching') && (
        <div className="w-full max-w-2xl mx-auto animate-fadeIn">
          <AiStepProgressIndicator
            searchStep="Querying real-time market data & order books across institutional exchanges..."
            promptSnippet={messages.length > 0 && messages[messages.length - 1].role === 'user' ? messages[messages.length - 1].content : undefined}
          />
        </div>
      )}

      {/* Dedicated bottom cushion & anchor so the last message slides completely free of the input box with comfortable breathing space */}
      <div className="w-full h-20 sm:h-24 shrink-0 pointer-events-none" aria-hidden="true" />
      </div>

      {/* Floating Interactive Scroll Arrow Button */}
      {scrollArrow.visible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 6 }}
          transition={{ duration: 0.18 }}
          type="button"
          onClick={handleArrowClick}
          className="fixed right-3 sm:right-6 bottom-28 sm:bottom-32 z-40 px-2.5 py-1 rounded-full bg-slate-900/90 border border-white/20 text-white shadow-xl backdrop-blur-md flex items-center gap-1.5 group cursor-pointer hover:scale-105 active:scale-95 transition-transform"
          title={scrollArrow.direction === 'top' ? 'Slide to top of chat' : 'Slide to latest message'}
        >
          {scrollArrow.direction === 'top' ? (
            <>
              <ArrowUp className="w-3.5 h-3.5 text-cyan-300 group-hover:-translate-y-0.5 transition-transform" />
              <span className="text-[11px] font-medium font-mono text-cyan-200">
                Top
              </span>
            </>
          ) : (
            <>
              <ArrowDown className="w-3.5 h-3.5 text-indigo-300 group-hover:translate-y-0.5 transition-transform" />
              <span className="text-[11px] font-medium font-mono text-indigo-200">
                Down
              </span>
            </>
          )}
        </motion.button>
      )}
      {/* Fullscreen Lightbox Modal for Uploaded Chart Inspection */}
      {previewImageModal && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setPreviewImageModal(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-slate-950 rounded-2xl border border-cyan-500/40 p-2 shadow-2xl overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 px-2 border-b border-white/[0.1] text-xs font-mono text-slate-300">
              <span className="flex items-center gap-1.5 text-cyan-300 font-bold">
                <BarChart2 className="w-4 h-4 text-cyan-400" />
                Chart Image Full Resolution View
              </span>
              <button
                type="button"
                onClick={() => setPreviewImageModal(null)}
                className="p-1 rounded-lg bg-white/[0.08] hover:bg-rose-500/30 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Close"
              >
                ✕
              </button>
            </div>
            <div className="overflow-auto p-2 flex items-center justify-center max-h-[80vh]">
              <img
                src={previewImageModal}
                alt="Enlarged Chart"
                className="max-w-full max-h-[75vh] object-contain rounded-lg"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

