import React, { useState, useEffect } from 'react';
import { MarketXIcon } from './MarketXIcon';
import { MarketXText } from './MarketXText';
import {
  Sparkles,
  Search,
  CheckCircle2,
  Terminal,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
  Clock,
  Target,
  ShieldAlert,
  TrendingUp
} from 'lucide-react';

interface AiTaskWorkingCardProps {
  searchStep?: string;
  timestamp?: number;
  promptSnippet?: string;
}

export const AiTaskWorkingCard: React.FC<AiTaskWorkingCardProps> = ({
  searchStep,
  timestamp = Date.now(),
  promptSnippet
}) => {
  const [elapsed, setElapsed] = useState(0);
  const [isLogOpen, setIsLogOpen] = useState(true);

  // Live elapsed counter updated every second (100ms re-renders overheat mobile devices)
  useEffect(() => {
    const startTime = timestamp;
    const interval = setInterval(() => {
      const diff = Math.max(0, (Date.now() - startTime) / 1000);
      setElapsed(parseFloat(diff.toFixed(1)));
    }, 1000);
    return () => clearInterval(interval);
  }, [timestamp]);

  const stages = [
    {
      id: 'directive',
      name: '1. Directive & Parameter Extraction',
      desc: 'Deconstructing prompt parameters, asset identifier, and requested timeframe',
      matchKeys: ['parsing', 'prompt', 'directive', 'identifying']
    },
    {
      id: 'liquidity',
      name: '2. Institutional Supply & Demand Sweep',
      desc: 'Mapping unmitigated institutional supply and demand zones and virgin order blocks',
      matchKeys: ['connecting', 'supply', 'demand', 'institutional liquidity', 'liquidity book', 'depth']
    },
    {
      id: 'cross-audit',
      name: '3. Multi-Exchange Liquidity Cross-Audit',
      desc: 'Cross-auditing live order books across Binance, CME, Bybit, and OKX depth',
      matchKeys: ['cross-referencing', 'multi-exchange', 'bybit', 'pools']
    },
    {
      id: 'fvg',
      name: '4. Fair Value Gap & Mitigation Sweep',
      desc: 'Detecting imbalance candles, virgin POIs, and unmitigated institutional order blocks',
      matchKeys: ['fair value', 'fvg', 'mitigation', 'order block']
    },
    {
      id: 'fibonacci',
      name: '5. Fibonacci 0.618 Golden Pocket Confluence',
      desc: 'Calculating 0.618 / 0.65 golden pocket ratio and harmonic reaction nodes',
      matchKeys: ['fibonacci', 'golden pocket', 'confluence']
    },
    {
      id: 'macro',
      name: '6. Macroeconomic News & Volatility Filter',
      desc: 'Screening central bank calendars and imminent news releases for liquidity shocks',
      matchKeys: ['macro', 'news', 'calendar', 'volatility']
    },
    {
      id: 'invalidation',
      name: '7. Micro-Invalidation Boundary Engine',
      desc: 'Formulating structural invalidation boundaries and capital preservation buffers',
      matchKeys: ['invalidation', 'protection', 'boundary', 'stop loss']
    },
    {
      id: 'thesis',
      name: '8. Risk/Reward & Trade Thesis Synthesis',
      desc: 'Formulating asymmetric entries, multi-tier TP targets, and institutional execution thesis',
      matchKeys: ['synthesizing', 'thesis', 'finalizing', 'matrix']
    }
  ];

  // Determine current active stage index across the 8 stages (each step 3.0 seconds)
  const getActiveStageIndex = () => {
    if (!searchStep) {
      if (elapsed < 3.0) return 0;
      if (elapsed < 6.0) return 1;
      if (elapsed < 9.0) return 2;
      if (elapsed < 12.0) return 3;
      if (elapsed < 15.0) return 4;
      if (elapsed < 18.0) return 5;
      if (elapsed < 21.0) return 6;
      return 7;
    }

    const stepLower = searchStep.toLowerCase();
    for (let i = stages.length - 1; i >= 0; i--) {
      if (stages[i].matchKeys.some(key => stepLower.includes(key.toLowerCase()))) {
        return i;
      }
    }
    return Math.min(7, Math.floor(elapsed / 3.0));
  };

  const activeIndex = getActiveStageIndex();
  const progressPercent = Math.min(95, Math.round(((activeIndex + 0.6) / stages.length) * 100));

  const formatElapsed = (sec: number) => {
    const s = Math.floor(sec);
    const ms = Math.floor((sec - s) * 10);
    return `0:${s < 10 ? '0' : ''}${s}.${ms}s`;
  };

  return (
    <div className="w-full rounded-2xl sm:rounded-3xl bg-[#0e0e11]/95 backdrop-blur-2xl border border-cyan-500/35 shadow-2xl shadow-indigo-950/60 overflow-hidden ring-1 ring-cyan-400/20 task-beam-active transition-all">
      {/* Top Accent Header: AI Identity, Status, and Stopwatch */}
      <div className="px-3.5 sm:px-5 py-3 border-b border-white/[0.1] bg-gradient-to-r from-slate-900/90 via-[#141417]/80 to-slate-900/90 flex flex-wrap items-center justify-between gap-2.5">
        {/* Left: Engine Identity */}
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-slate-950 border border-cyan-500/40 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <MarketXIcon size="sm" />
            </div>
            {/* Pulsing Radar Ring */}
            <span className="absolute -inset-1 rounded-xl bg-cyan-400/20 radar-ring pointer-events-none" />
          </div>

          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs sm:text-sm font-bold text-white tracking-tight flex items-center gap-1">
                <MarketXText className="text-xs sm:text-sm" />
                <span className="text-slate-300 font-normal">Deep Reasoning</span>
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-cyan-500/15 border border-cyan-400/30 text-cyan-300 font-semibold">
                Frontier AI Engine
              </span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-slate-400 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Institutional Quantitative Synthesis</span>
            </p>
          </div>
        </div>

        {/* Right: Live Status Badge & Stopwatch */}
        <div className="flex items-center gap-2 font-mono">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-400/30 text-cyan-200 text-[11px] font-semibold">
            <Cpu className="w-3 h-3 text-cyan-400 animate-spin" />
            <span className="tracking-wide">COMPUTING</span>
          </div>

          <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.05] border border-white/[0.1] text-slate-300 text-[11px]">
            <Clock className="w-3 h-3 text-slate-400" />
            <span className="font-bold text-white">{formatElapsed(elapsed)}</span>
          </div>
        </div>
      </div>

      {/* Main Task Body */}
      <div className="p-3.5 sm:p-5 space-y-4">
        {/* Active Objective Summary */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-start gap-2.5">
          <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0 mt-0.5">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
          </div>
          <div className="space-y-0.5 min-w-0">
            <span className="text-[11px] uppercase tracking-wider text-indigo-300 font-bold font-mono block">
              Active Task Directive
            </span>
            <p className="text-xs sm:text-sm font-medium text-slate-100 leading-snug break-words">
              {searchStep || 'Querying real-time market data & order books across institutional exchanges...'}
            </p>
            {promptSnippet && (
              <p className="text-[11px] text-slate-400 font-mono truncate mt-1">
                Context: &ldquo;{promptSnippet}&rdquo;
              </p>
            )}
          </div>
        </div>

        {/* Shimmering Multi-Stage Progress Meter */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-slate-400 flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-cyan-400" />
              <span>Step {activeIndex + 1} of {stages.length}</span>
            </span>
            <span className="text-cyan-300 font-bold">{progressPercent}% Completed</span>
          </div>

          {/* Progress Bar with running glow */}
          <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden border border-white/[0.06] relative">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 rounded-full transition-all duration-500 relative"
              style={{ width: `${progressPercent}%` }}
            >
              <div className="absolute inset-0 bg-white/30 animate-pulse" />
            </div>
          </div>
        </div>

        {/* The 4-Stage Progressive Execution Pipeline */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          {stages.map((stage, idx) => {
            const isDone = idx < activeIndex;
            const isCurrent = idx === activeIndex;
            const isPending = idx > activeIndex;

            return (
              <div
                key={stage.id}
                className={`p-2.5 sm:p-3 rounded-xl border transition-all flex items-start gap-2.5 ${
                  isCurrent
                    ? 'bg-cyan-500/[0.08] border-cyan-400/40 shadow-md shadow-cyan-950/40 ring-1 ring-cyan-400/20'
                    : isDone
                    ? 'bg-emerald-500/[0.04] border-emerald-500/25 text-slate-300'
                    : 'bg-white/[0.015] border-white/[0.05] text-slate-500 opacity-60'
                }`}
              >
                {/* Status Indicator Icon */}
                <div className="shrink-0 mt-0.5">
                  {isDone ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : isCurrent ? (
                    <div className="relative flex items-center justify-center">
                      <div className="w-4 h-4 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                      <span className="absolute w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    </div>
                  ) : (
                    <div className="w-4 h-4 rounded-full border border-slate-700 flex items-center justify-center text-[9px] font-mono text-slate-500">
                      {idx + 1}
                    </div>
                  )}
                </div>

                {/* Stage Info */}
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-xs font-bold leading-tight truncate ${
                        isCurrent
                          ? 'text-cyan-200'
                          : isDone
                          ? 'text-emerald-300'
                          : 'text-slate-400'
                      }`}
                    >
                      {stage.name}
                    </span>
                    {isCurrent && (
                      <span className="text-[9px] font-mono px-1 rounded bg-cyan-400/20 text-cyan-300 uppercase tracking-wider font-semibold">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 leading-snug line-clamp-2">
                    {stage.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Collapsible Live Reasoning Stream / Trace Terminal */}
        <div className="rounded-xl border border-white/[0.08] bg-black/50 overflow-hidden font-mono text-xs">
          <button
            type="button"
            onClick={() => setIsLogOpen(!isLogOpen)}
            className="w-full px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] border-b border-white/[0.06] flex items-center justify-between text-slate-300 cursor-pointer transition-colors text-[11px]"
          >
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-semibold text-slate-200">Execution Thought Trace</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/[0.06] text-slate-400">
                Live stream
              </span>
            </div>
            <div className="flex items-center gap-1 text-slate-400">
              <span className="text-[10px]">{isLogOpen ? 'Hide' : 'Show'}</span>
              {isLogOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </div>
          </button>

          {isLogOpen && (
            <div className="p-3 space-y-1.5 text-[11px] leading-relaxed text-slate-300 max-h-32 overflow-y-auto">
              <div className="flex items-center gap-2 text-cyan-400">
                <span className="text-[10px] text-slate-500 font-bold">[0.1s]</span>
                <span>Initialized MarketX Deep Quantitative Task Engine</span>
              </div>
              <div className="flex items-center gap-2 text-slate-300">
                <span className="text-[10px] text-slate-500 font-bold">[0.8s]</span>
                <span>Connecting to multi-exchange Level 2 order book feeds (Binance, Bybit, Coinbase)...</span>
              </div>
              {activeIndex >= 1 && (
                <div className="flex items-center gap-2 text-amber-300">
                  <span className="text-[10px] text-slate-500 font-bold">[2.4s]</span>
                  <span>Scanning virgin demand blocks and overhead liquidity pools...</span>
                </div>
              )}
              {activeIndex >= 2 && (
                <div className="flex items-center gap-2 text-purple-300">
                  <span className="text-[10px] text-slate-500 font-bold">[6.8s]</span>
                  <span>Cross-auditing multi-exchange Level 2 order books (Binance, Bybit, CME)...</span>
                </div>
              )}
              {activeIndex >= 3 && (
                <div className="flex items-center gap-2 text-indigo-300">
                  <span className="text-[10px] text-slate-500 font-bold">[11.2s]</span>
                  <span>Scanning Fair Value Gaps (FVG) and unmitigated institutional order blocks...</span>
                </div>
              )}
              {activeIndex >= 4 && (
                <div className="flex items-center gap-2 text-cyan-300">
                  <span className="text-[10px] text-slate-500 font-bold">[15.6s]</span>
                  <span>Computing 0.618 / 0.65 Fibonacci Golden Pocket harmonic ratio...</span>
                </div>
              )}
              {activeIndex >= 5 && (
                <div className="flex items-center gap-2 text-rose-300">
                  <span className="text-[10px] text-slate-500 font-bold">[20.0s]</span>
                  <span>Screening central bank calendars and imminent macroeconomic news...</span>
                </div>
              )}
              {activeIndex >= 6 && (
                <div className="flex items-center gap-2 text-amber-400">
                  <span className="text-[10px] text-slate-500 font-bold">[24.4s]</span>
                  <span>Formulating micro-invalidation boundary to eliminate stop hunts...</span>
                </div>
              )}
              {activeIndex >= 7 && (
                <div className="flex items-center gap-2 text-emerald-300">
                  <span className="text-[10px] text-slate-500 font-bold">[28.2s]</span>
                  <span>Formulating mathematical risk/reward expectancy and take profit tiers...</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-cyan-300 animate-pulse">
                <span className="text-[10px] text-cyan-500 font-bold">[{elapsed.toFixed(1)}s]</span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                  <span>{searchStep || 'Compiling high-confluence institutional brief...'}</span>
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Ghost Wireframe Preview: Visual feedback that output matrix is assembling */}
        <div className="pt-1">
          <div className="text-[10px] uppercase font-mono tracking-wider text-slate-400 mb-1.5 flex items-center justify-between">
            <span>Assembling Structured Trade Parameters</span>
            <span className="text-cyan-400/80 animate-pulse">Synthesizing matrix...</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Optimal Entry', icon: Target, color: 'text-amber-400' },
              { label: 'Stop Loss', icon: ShieldAlert, color: 'text-rose-400' },
              { label: 'TP1 Target', icon: TrendingUp, color: 'text-emerald-400' },
              { label: 'Risk / Reward', icon: Sparkles, color: 'text-indigo-400' },
            ].map((box, i) => (
              <div
                key={i}
                className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-1.5 relative overflow-hidden"
              >
                <div className="flex items-center gap-1 text-[10px] text-slate-400 font-sans">
                  <box.icon className={`w-3 h-3 ${box.color}`} />
                  <span className="truncate">{box.label}</span>
                </div>
                <div className="h-4 w-3/4 bg-white/[0.06] rounded animate-pulse" />
                <div className="h-2.5 w-1/2 bg-white/[0.04] rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
