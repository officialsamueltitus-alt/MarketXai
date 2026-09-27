import React, { useState } from 'react';
import {
  AlertTriangle,
  Flame,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Calendar,
  Newspaper,
  Radio,
  Landmark
} from 'lucide-react';
import type { HighImpactNewsAlert as HighImpactNewsType } from '../types';

interface HighImpactNewsAlertProps {
  news: HighImpactNewsType;
  className?: string;
}

export const HighImpactNewsAlert: React.FC<HighImpactNewsAlertProps> = ({ news, className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const isHoliday = news.impactLevel === 'BANK_HOLIDAY';
  const isCritical = news.impactLevel === 'CRITICAL';

  return (
    <div
      className={`w-full rounded-xl border overflow-hidden transition-all text-xs font-sans ${
        isHoliday
          ? 'border-blue-500/35 bg-blue-950/20 hover:border-blue-500/50'
          : isCritical
          ? 'border-red-500/30 bg-red-950/20 hover:border-red-500/40'
          : 'border-amber-500/30 bg-amber-950/20 hover:border-amber-500/40'
      } ${className}`}
    >
      {/* Sleek single-line trigger bar - compact footprint */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 flex items-center justify-between gap-2 hover:bg-white/[0.04] transition-colors cursor-pointer text-left select-none"
      >
        {/* Shows badge and summary */}
        <div className="flex items-center gap-2 min-w-0">
          {isHoliday ? (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-medium text-[11px] shrink-0 bg-blue-500/20 border-blue-500/40 text-blue-300">
              <Landmark className="w-3 h-3 shrink-0 text-blue-400" />
              <span className="font-semibold tracking-wide">Bank Holiday</span>
            </div>
          ) : (
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-medium text-[11px] shrink-0 ${
                isCritical
                  ? 'bg-red-500/20 border-red-500/40 text-red-300'
                  : 'bg-amber-500/20 border-amber-500/40 text-amber-300'
              }`}
            >
              <AlertTriangle className={`w-3 h-3 shrink-0 ${isCritical ? 'text-red-400' : 'text-amber-400'} animate-pulse`} />
              <span className="font-semibold tracking-wide">High Impact News</span>
            </div>
          )}

          <span className="text-slate-300 font-medium text-[11px] truncate">
            {news.title}
          </span>
        </div>

        {/* Right: Expand/Collapse indicator */}
        <div className="flex items-center gap-1 text-slate-400 text-[11px] shrink-0 font-mono">
          <span>{isOpen ? (isHoliday ? 'Collapse' : 'Collapse News') : (isHoliday ? 'View Holiday Details' : 'View Impact')}</span>
          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      {/* Expanded view: Displays all necessary verified info */}
      {isOpen && (
        <div className="p-3 sm:p-3.5 border-t border-white/[0.06] bg-black/60 space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Top Event Title & Direct Source Badges */}
          <div className="flex flex-wrap items-start justify-between gap-2 pb-2 border-b border-white/[0.06]">
            <div className="space-y-0.5 min-w-0 flex-1">
              <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                {isHoliday ? 'National Banking Calendar Event' : 'Scheduled Economic Event'}
              </span>
              <h4 className="text-xs sm:text-sm font-bold text-white tracking-tight">
                {news.title}
              </h4>
            </div>

            {/* Direct Verification Badges */}
            <div className="flex items-center gap-1.5 shrink-0">
              {isHoliday ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-950/40 border border-blue-500/40 text-blue-300 text-[10px] font-mono font-semibold">
                  <Landmark className="w-3 h-3 text-blue-400" />
                  Interbank Banking Calendar
                </span>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#262629] border border-cyan-500/40 text-cyan-300 text-[10px] font-mono font-semibold">
                    <Radio className="w-3 h-3 text-cyan-400 animate-pulse" />
                    ForexFactory Live
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#202023] border border-purple-500/40 text-purple-300 text-[10px] font-mono font-semibold">
                    MarketWatch / Dow Jones
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Key Grid: Exact Date, Exact Time, Currencies, Forecast vs Previous / Market Status */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            {/* Exact Date & Time */}
            <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06] space-y-0.5 col-span-2 sm:col-span-2">
              <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400 uppercase">
                <Calendar className="w-3 h-3 text-cyan-400" />
                <span>{isHoliday ? 'Holiday Date & Duration' : 'Exact Scheduled Date & Time'}</span>
              </div>
              <p className="font-semibold text-slate-100 font-mono text-xs">
                {news.scheduledTime}
              </p>
            </div>

            {/* Affected Currency / Asset */}
            <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06] space-y-0.5">
              <span className="text-[10px] font-mono text-slate-400 uppercase block">
                Affected Asset
              </span>
              <p className="font-semibold text-slate-100 font-mono text-xs truncate">
                {news.affectedCurrency}
              </p>
            </div>

            {/* Forecast vs Previous OR Holiday Status */}
            <div className="p-2 rounded-lg bg-white/[0.03] border border-white/[0.06] space-y-0.5">
              <span className="text-[10px] font-mono text-slate-400 uppercase block">
                {isHoliday ? 'Trading Status' : 'Forecast / Prior'}
              </span>
              <p className="font-semibold text-slate-100 font-mono text-xs">
                {isHoliday ? (
                  <span className="text-blue-300 font-mono">Banks Closed</span>
                ) : news.forecast || news.previous ? (
                  <>
                    <span className="text-cyan-300 font-mono">{news.forecast || 'N/A'}</span>
                    <span className="text-slate-500 mx-1">/</span>
                    <span className="text-slate-300 font-mono">{news.previous || 'N/A'}</span>
                  </>
                ) : (
                  <span className="text-slate-400">High Impact</span>
                )}
              </p>
            </div>
          </div>

          {/* Breaking Headline / News Wire */}
          {news.breakingHeadline && !isHoliday && (
            <div className="p-2 rounded-lg bg-purple-950/20 border border-purple-500/30 flex items-start gap-2">
              <Newspaper className="w-3.5 h-3.5 text-purple-400 shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-0.5">
                <span className="text-[10px] font-mono text-purple-300 uppercase block font-semibold">
                  MarketWatch Wire Update
                </span>
                <p className="text-[11px] text-slate-200 leading-snug">
                  {news.breakingHeadline}
                </p>
              </div>
            </div>
          )}

          {/* Volatility & Liquidity Sweep Risk */}
          <div className={`p-2.5 rounded-lg border space-y-1 ${
            isHoliday
              ? 'bg-blue-950/25 border-blue-500/30'
              : 'bg-red-950/25 border-red-500/30'
          }`}>
            <div className={`flex items-center gap-1.5 font-semibold text-[11px] ${
              isHoliday ? 'text-blue-300' : 'text-rose-300'
            }`}>
              {isHoliday ? (
                <Landmark className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              ) : (
                <Flame className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              )}
              <span>{isHoliday ? 'Bank Holiday Liquidity Conditions' : 'Volatility & Liquidity Sweep Risk'}</span>
            </div>
            <p className="text-slate-200 text-[11px] leading-relaxed">
              {news.volatilityWarning}
            </p>
          </div>

          {/* Recommended Execution Protocol */}
          <div className="p-2.5 rounded-lg bg-indigo-950/30 border border-indigo-500/30 space-y-1">
            <div className="flex items-center gap-1.5 text-indigo-300 font-semibold text-[11px]">
              <ShieldAlert className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span>Recommended Execution Protocol</span>
            </div>
            <p className="text-slate-200 text-[11px] leading-relaxed">
              {news.executionGuidance}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
