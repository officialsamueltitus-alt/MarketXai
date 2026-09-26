import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Layers, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import { MarketXIcon } from './MarketXIcon';

interface AiStepProgressIndicatorProps {
  searchStep?: string;
  timestamp?: number;
  promptSnippet?: string;
}

export const AiStepProgressIndicator: React.FC<AiStepProgressIndicatorProps> = ({
  searchStep,
  timestamp = Date.now(),
}) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startTime = timestamp;
    const interval = setInterval(() => {
      const diff = Math.max(0, (Date.now() - startTime) / 1000);
      setElapsed(parseFloat(diff.toFixed(1)));
    }, 100);
    return () => clearInterval(interval);
  }, [timestamp]);

  const defaultStages = [
    'Parsing prompt directive & identifying asset target parameters...',
    'Streaming real-time order book depth & institutional liquidity...',
    'Scanning multi-venue global liquidity pools...',
    'Detecting fresh, untapped institutional liquidity zones...',
    'Calculating mathematical confluence & probability thresholds...',
    'Screening high-impact macroeconomic news & calendar risk events...',
    'Formulating precision invalidation & risk management boundaries...',
    'Synthesizing execution matrix & high-conviction thesis...',
  ];

  // Determine active step index across the 8-stage pipeline (each step 3 seconds, +5s final step)
  const getStepIndex = () => {
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
    const lower = searchStep.toLowerCase();
    if (lower.includes('synthesizing') || lower.includes('thesis') || lower.includes('finalizing') || lower.includes('matrix') || lower.includes('stage 8 complete')) return 7;
    if (lower.includes('invalidation') || lower.includes('protection') || lower.includes('boundary') || lower.includes('stop loss')) return 6;
    if (lower.includes('macro') || lower.includes('news') || lower.includes('calendar') || lower.includes('volatility')) return 5;
    if (lower.includes('fibonacci') || lower.includes('golden pocket') || lower.includes('confluence')) return 4;
    if (lower.includes('fair value') || lower.includes('fvg') || lower.includes('mitigation') || lower.includes('order block')) return 3;
    if (lower.includes('multi-exchange') || lower.includes('bybit') || lower.includes('depth') || lower.includes('pools')) return 2;
    if (lower.includes('institutional liquidity') || lower.includes('supply & demand') || lower.includes('liquidity book') || lower.includes('connecting')) return 1;
    return 0;
  };

  const activeIndex = getStepIndex();
  const currentStepText = searchStep || defaultStages[activeIndex] || defaultStages[0];
  const progressPercent = Math.min(95, Math.round(((activeIndex + 1) / defaultStages.length) * 100));

  return (
    <div id="ai-active-analysis-indicator" className="w-full max-w-2xl py-1 my-1">
      <div className="relative overflow-hidden rounded-xl bg-[#0b101c]/90 border border-indigo-500/25 shadow-lg shadow-indigo-950/40 p-3 flex flex-col gap-2.5">
        {/* Main Single-Line Step Bar */}
        <div className="flex items-center justify-between gap-3 min-w-0">
          {/* Left: Mini icon + Current Active Step */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-6 h-6 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
              <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 font-semibold shrink-0">
                  Step {activeIndex + 1}/{defaultStages.length}
                </span>
                <AnimatePresence mode="wait">
                  <motion.p
                    key={currentStepText}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.18 }}
                    className="text-xs font-medium text-slate-200 truncate"
                  >
                    {currentStepText}
                  </motion.p>
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Right: Elapsed timer */}
          <div className="flex items-center gap-1.5 shrink-0 text-[11px] font-mono text-slate-400">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            <span>{elapsed.toFixed(1)}s</span>
          </div>
        </div>

        {/* Minimal Progress Line */}
        <div className="w-full h-1 bg-white/[0.06] rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400 rounded-full"
            initial={{ width: '15%' }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </div>
    </div>
  );
};
