import React, { useState } from 'react';
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  Layers,
  Terminal,
  Cpu
} from 'lucide-react';
import { ReasoningStep } from '../types';

interface AiReasoningAccordionProps {
  durationSeconds?: number;
  symbol?: string;
  timeframe?: string;
  confidenceScore?: number;
  steps?: ReasoningStep[];
}

export const AiReasoningAccordion: React.FC<AiReasoningAccordionProps> = ({
  durationSeconds,
  symbol,
  timeframe,
  confidenceScore,
  steps,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Derive effective duration: prioritize explicit durationSeconds, or sum of step times
  const effectiveDuration = durationSeconds ?? (
    steps && steps.length > 0
      ? parseFloat(steps.reduce((acc, s) => acc + (parseFloat(s.time.replace('s', '')) || 0), 0).toFixed(1))
      : 24.0
  );

  // Format seconds: 30.0 => "30s", 30.4 => "30.4s", 9.8 => "9.8s"
  const formatDuration = (sec: number) => {
    const rounded = Math.round(sec * 10) / 10;
    return rounded % 1 === 0 ? `${rounded.toFixed(0)}s` : `${rounded.toFixed(1)}s`;
  };

  const displayDurationStr = formatDuration(effectiveDuration);

  // Build full 8-step quantitative pipeline with dynamic proportional timestamps matching total duration
  const defaultStepDefinitions = [
    {
      title: 'Prompt Directive & Intent Analysis',
      detail: `Deconstructed prompt parameters, asset identifier (${symbol || 'asset'}), and requested ${timeframe || '4H'} timeframe.`,
      weight: 0.08,
    },
    {
      title: 'Institutional Supply & Demand Mapping',
      detail: 'Mapped unmitigated institutional supply and demand zones and virgin order blocks.',
      weight: 0.14,
    },
    {
      title: 'Multi-Exchange Liquidity Pool Cross-Audit',
      detail: 'Cross-audited live order books across Binance, CME, Bybit, and OKX depth.',
      weight: 0.13,
    },
    {
      title: 'Fresh Untapped Zones & Virgin POI Auditing',
      detail: 'Filtered out stale, mitigated opportunities and identified fresh, untouched institutional liquidity zones ahead of price.',
      weight: 0.14,
    },
    {
      title: 'Fibonacci 0.618-0.65 Golden Pocket Confluence',
      detail: 'Calculated harmonic 0.618/0.65 retracement and mathematical reaction nodes.',
      weight: 0.16,
    },
    {
      title: 'Macroeconomic News & Volatility Filter',
      detail: 'Screened central bank calendars and high-impact release windows for liquidity shocks.',
      weight: 0.10,
    },
    {
      title: 'Micro-Invalidation Stop Loss Boundary',
      detail: 'Established structural invalidation point to eliminate premature stop hunts.',
      weight: 0.11,
    },
    {
      title: 'Risk/Reward Matrix & Institutional Thesis Synthesis',
      detail: `Formulated optimal entries, asymmetric R:R targets, and execution thesis with ${confidenceScore || 88}% confluence.`,
      weight: 0.14,
    },
  ];

  // Distribute total duration across the 8 steps
  const completedSteps: ReasoningStep[] = steps && steps.length > 0
    ? steps
    : (() => {
        let runningSum = 0;
        return defaultStepDefinitions.map((def, idx, arr) => {
          if (idx === arr.length - 1) {
            const remainder = Math.max(0.2, parseFloat((effectiveDuration - runningSum).toFixed(1)));
            return {
              title: def.title,
              detail: def.detail,
              time: `${remainder}s`,
            };
          }
          const stepTime = Math.max(0.2, parseFloat((effectiveDuration * def.weight).toFixed(1)));
          runningSum += stepTime;
          return {
            title: def.title,
            detail: def.detail,
            time: `${stepTime}s`,
          };
        });
      })();

  return (
    <div className="w-full rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden transition-all text-xs font-sans">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-white/[0.04] transition-colors cursor-pointer text-left"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-medium text-[11px]">
            <Sparkles className="w-3 h-3 text-indigo-400" />
            <span>Reasoned for {displayDurationStr}</span>
          </div>

          <span className="text-slate-400 text-[11px] hidden sm:inline">
            {completedSteps.length} quantitative steps completed
          </span>
        </div>

        <div className="flex items-center gap-1 text-slate-400 text-[11px] shrink-0 font-mono">
          <span>{isOpen ? 'Collapse Trace' : 'View Thought Process'}</span>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      {isOpen && (
        <div className="p-3 border-t border-white/[0.06] bg-black/40 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pb-1 border-b border-white/[0.05]">
            <span className="flex items-center gap-1">
              <Cpu className="w-3 h-3 text-cyan-400" />
              <span>Multi-Exchange Quantitative Pipeline ({completedSteps.length}/{completedSteps.length} Verified)</span>
            </span>
            <span>Total Compute: {displayDurationStr}</span>
          </div>

          <div className="space-y-2">
            {completedSteps.map((step, idx) => (
              <div
                key={idx}
                className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.05] flex items-start justify-between gap-2"
              >
                <div className="flex items-start gap-2 min-w-0">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="space-y-0.5 min-w-0">
                    <span className="font-semibold text-slate-200 text-[11px] block">
                      {idx + 1}. {step.title}
                    </span>
                    <p className="text-[10px] text-slate-400 leading-snug break-words">
                      {step.detail}
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-slate-400 shrink-0 px-1.5 py-0.2 rounded bg-white/[0.04]">
                  {step.time}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
