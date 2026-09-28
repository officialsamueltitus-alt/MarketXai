import React, { useState } from 'react';
import { StrategyResult, POIZone } from '../types';
import { TrendingUp, TrendingDown, Target, ShieldAlert, Layers, BarChart3, Sparkles, CheckCircle2, Zap, Radio, Eye } from 'lucide-react';

interface TechnicalVisualizerProps {
  strategy: StrategyResult;
}

export const TechnicalVisualizer: React.FC<TechnicalVisualizerProps> = ({ strategy }) => {
  const [activeTab, setActiveTab] = useState<'levels' | 'zones' | 'fibonacci'>('levels');
  const [zoneFilter, setZoneFilter] = useState<'ALL' | 'UNMITIGATED' | 'MITIGATED'>('ALL');

  const {
    currentPrice,
    entryZone,
    stopLoss,
    takeProfits,
    demandZone,
    supplyZone,
    poiZones,
    unmitigatedZonesCount,
    mitigatedZonesCount,
    fibonacciLevels,
    swingHigh,
    swingLow,
    tradeType,
  } = strategy;

  // Compile full POI list (either from poiZones or default fallback from demand & supply)
  const allPOIs: POIZone[] = poiZones && poiZones.length > 0 ? poiZones : [
    {
      name: `${demandZone.timeframe || '4H'} Demand Order Block`,
      type: 'DEMAND',
      min: demandZone.low,
      max: demandZone.high,
      mitigationStatus: demandZone.mitigationStatus || (demandZone.strength === 'FRESH' ? 'UNMITIGATED' : 'MITIGATED'),
      touchStatus: demandZone.touchStatus || (demandZone.strength === 'FRESH' ? 'UNTOUCHED' : 'TAPPED_AND_LEFT'),
      timeframe: demandZone.timeframe || '4H',
      description: demandZone.description || 'Institutional accumulation liquidity base',
      reactionSummary: demandZone.reactionSummary || (demandZone.strength === 'FRESH' ? 'Price has not touched yet. Virgin untouched demand accumulation block.' : 'Price tapped into level and left with buyer reaction.'),
      tapCount: demandZone.tapCount || 0,
      distancePercent: Number((Math.abs(currentPrice - demandZone.high) / (currentPrice || 1) * 100).toFixed(1)),
    },
    {
      name: `${supplyZone.timeframe || '4H'} Overhead Supply Zone`,
      type: 'SUPPLY',
      min: supplyZone.low,
      max: supplyZone.high,
      mitigationStatus: supplyZone.mitigationStatus || 'UNMITIGATED',
      touchStatus: supplyZone.touchStatus || 'UNTOUCHED',
      timeframe: supplyZone.timeframe || '4H',
      description: supplyZone.description || 'Sell-side distribution block with resting orders',
      reactionSummary: supplyZone.reactionSummary || 'Price has not touched yet. Untouched overhead supply liquidity pool.',
      tapCount: supplyZone.tapCount || 0,
      distancePercent: Number((Math.abs(supplyZone.low - currentPrice) / (currentPrice || 1) * 100).toFixed(1)),
    },
  ];

  const filteredPOIs = allPOIs.filter(p => {
    if (zoneFilter === 'ALL') return true;
    return p.mitigationStatus === zoneFilter;
  });

  const totalUnmitigated = unmitigatedZonesCount ?? allPOIs.filter(p => p.mitigationStatus === 'UNMITIGATED').length;
  const totalMitigated = mitigatedZonesCount ?? allPOIs.filter(p => p.mitigationStatus === 'MITIGATED').length;

  // Calculate percentages for position gauge safely clamped
  const safeStopLossPrice = Number(stopLoss?.price ?? (currentPrice * 0.98));
  const safeSwingLow = Number(swingLow ?? (currentPrice * 0.97));
  const lastTp = Array.isArray(takeProfits) && takeProfits.length > 0 ? takeProfits[takeProfits.length - 1]?.price : undefined;
  const safeMaxTarget = Number(lastTp ?? swingHigh ?? (currentPrice * 1.05));
  const safeSwingHigh = Number(swingHigh ?? (currentPrice * 1.05));

  const minVal = Math.min(safeStopLossPrice, safeSwingLow, currentPrice * 0.96);
  const maxVal = Math.max(safeMaxTarget, safeSwingHigh, currentPrice * 1.04);
  const range = maxVal - minVal || 1;

  const getPercent = (price: number | undefined | null) => {
    const num = Number(price);
    if (isNaN(num)) return 50;
    const pct = ((num - minVal) / range) * 100;
    return Math.max(7, Math.min(93, pct));
  };

  const isLong = tradeType === 'LONG';
  const formatPrice = (p: number | undefined | null) => {
    const num = Number(p);
    if (isNaN(num)) return '0.00';
    return currentPrice < 10
      ? num.toFixed(4)
      : num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  return (
    <div className="rounded-xl bg-black/60 border border-white/[0.08] p-3 sm:p-4 backdrop-blur-md w-full min-w-0 overflow-hidden">
      {/* Visualizer Tab Switcher - Responsive Layout */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-white/[0.06] mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-300 truncate">
            Real-Time Technical Indicator Engine
          </span>
        </div>
        <div className="flex items-center gap-1 bg-white/[0.04] p-0.5 rounded-lg border border-white/[0.06] overflow-x-auto max-w-full shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('levels')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'levels'
                ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-500/40 shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Price Gauge
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('zones')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'zones'
                ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-500/40 shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>POI & Zones</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('fibonacci')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap cursor-pointer ${
              activeTab === 'fibonacci'
                ? 'bg-indigo-500/25 text-indigo-200 border border-indigo-500/40 shadow-sm font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Confluence Ladder
          </button>
        </div>
      </div>

      {/* Tab 1: Execution Price Gauge */}
      {activeTab === 'levels' && (
        <div className="space-y-4 w-full min-w-0">
          {/* Top 3 Metric Indicators: Clean grid, zero collision */}
          <div className="grid grid-cols-3 gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-center font-mono">
            <div className="p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-rose-300 min-w-0">
              <span className="text-[9px] uppercase block text-slate-400 font-sans tracking-wide">Stop Loss</span>
              <span className="font-semibold truncate block">${formatPrice(stopLoss.price)}</span>
            </div>
            <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300 min-w-0">
              <span className="text-[9px] uppercase block text-slate-400 font-sans tracking-wide">Optimal Entry</span>
              <span className="font-bold truncate block">${formatPrice(entryZone.optimal)}</span>
            </div>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 min-w-0">
              <span className="text-[9px] uppercase block text-slate-400 font-sans tracking-wide">Max Target</span>
              <span className="font-semibold truncate block">${formatPrice(takeProfits[takeProfits.length - 1]?.price || swingHigh)}</span>
            </div>
          </div>

          {/* Interactive Range Gauge Track with dedicated vertical spacing */}
          <div className="py-7 px-1 relative w-full">
            <div className="relative w-full h-7 bg-slate-950 rounded-lg border border-white/[0.1] flex items-center overflow-visible">
              {/* Background gradient from Stop Loss through Entry to Take Profit */}
              <div
                className={`absolute inset-0 rounded-lg opacity-30 ${
                  isLong
                    ? 'bg-gradient-to-r from-rose-600 via-amber-500 to-emerald-500'
                    : 'bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-600'
                }`}
              />

              {/* Entry Band */}
              <div
                className="absolute top-0.5 bottom-0.5 bg-amber-400/30 border-x border-amber-400/70 rounded"
                style={{
                  left: `${Math.min(getPercent(entryZone.min), getPercent(entryZone.max))}%`,
                  width: `${Math.max(3, Math.abs(getPercent(entryZone.max) - getPercent(entryZone.min)))}%`,
                }}
                title="Optimal Entry Zone"
              />

              {/* Stop Loss Marker */}
              <div
                className="absolute top-0 bottom-0 w-1 bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)] z-10"
                style={{ left: `${getPercent(stopLoss.price)}%` }}
              >
                <div className="absolute -top-6 -translate-x-1/2 bg-rose-950 text-rose-300 text-[10px] font-mono px-1.5 py-0.5 rounded border border-rose-500/50 whitespace-nowrap shadow-md">
                  SL: ${formatPrice(stopLoss.price)}
                </div>
              </div>

              {/* Current Price Marker */}
              <div
                className="absolute top-0 bottom-0 w-1.5 bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.9)] z-20 flex items-center justify-center"
                style={{ left: `${getPercent(currentPrice)}%` }}
              >
                <div className="w-3 h-3 rounded-full bg-cyan-400 animate-ping absolute opacity-50" />
                <div className="w-2.5 h-2.5 rounded-full bg-cyan-300 border border-black shadow" />
                <div className="absolute -bottom-6 -translate-x-1/2 bg-cyan-950 text-cyan-200 text-[10px] font-mono px-2 py-0.5 rounded-full border border-cyan-500/50 whitespace-nowrap shadow-lg">
                  LIVE: ${formatPrice(currentPrice)}
                </div>
              </div>

              {/* Take Profit Markers */}
              {takeProfits.map((tp, idx) => (
                <div
                  key={idx}
                  className="absolute top-0 bottom-0 w-0.5 bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)] z-10"
                  style={{ left: `${getPercent(tp.price)}%` }}
                >
                  <div className="absolute -top-6 -translate-x-1/2 bg-emerald-950 text-emerald-300 text-[10px] font-mono px-1.5 py-0.5 rounded border border-emerald-500/50 whitespace-nowrap shadow-md">
                    TP{idx + 1}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Metric Cards: Responsive 1 col on mobile, 3 col on sm+ */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center text-xs">
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 min-w-0">
              <span className="text-slate-400 block text-[10px] uppercase font-sans tracking-wider">Risk Buffer</span>
              <span className="font-mono font-medium text-rose-400 truncate block mt-0.5">
                -${formatPrice(Math.abs(entryZone.optimal - stopLoss.price))} ({stopLoss.riskPercent}%)
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 min-w-0">
              <span className="text-slate-400 block text-[10px] uppercase font-sans tracking-wider">Entry Range</span>
              <span className="font-mono font-medium text-amber-300 truncate block mt-0.5">
                ${formatPrice(entryZone.min)} - ${formatPrice(entryZone.max)}
              </span>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 min-w-0">
              <span className="text-slate-400 block text-[10px] uppercase font-sans tracking-wider">Max Potential Reward</span>
              <span className="font-mono font-medium text-emerald-400 truncate block mt-0.5">
                +${formatPrice(Math.abs((takeProfits[takeProfits.length - 1]?.price || swingHigh) - entryZone.optimal))}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Institutional POI & Liquidity Zones Breakdown */}
      {activeTab === 'zones' && (
        <div className="space-y-3.5 w-full min-w-0">
          {/* Mitigation Filter Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                Institutional Zone Mitigation Status:
              </span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setZoneFilter('ALL')}
                className={`px-2 py-1 text-[11px] font-medium rounded-lg transition-all cursor-pointer ${
                  zoneFilter === 'ALL'
                    ? 'bg-white/[0.12] text-white border border-white/20 font-semibold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                All POIs ({allPOIs.length})
              </button>

              <button
                type="button"
                onClick={() => setZoneFilter('UNMITIGATED')}
                className={`px-2 py-1 text-[11px] font-medium rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                  zoneFilter === 'UNMITIGATED'
                    ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 font-semibold shadow-xs'
                    : 'text-slate-400 hover:text-emerald-300'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Untouched ({totalUnmitigated})</span>
              </button>

              <button
                type="button"
                onClick={() => setZoneFilter('MITIGATED')}
                className={`px-2 py-1 text-[11px] font-medium rounded-lg transition-all cursor-pointer flex items-center gap-1 ${
                  zoneFilter === 'MITIGATED'
                    ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40 font-semibold shadow-xs'
                    : 'text-slate-400 hover:text-amber-300'
                }`}
              >
                <Zap className="w-3 h-3 text-amber-400" />
                <span>Tapped & Left ({totalMitigated})</span>
              </button>
            </div>
          </div>

          {/* Equilibrium / Fair Value Midpoint */}
          <div className="px-3.5 py-2 rounded-xl bg-indigo-500/5 border border-indigo-500/20 flex flex-wrap items-center justify-between gap-2 text-xs min-w-0">
            <span className="text-slate-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span>50% Equilibrium (Fair Value Midpoint):</span>
            </span>
            <span className="font-mono font-medium text-indigo-300">
              ${formatPrice((swingHigh + swingLow) / 2)}
            </span>
          </div>

          {/* POI Cards List */}
          <div className="space-y-2.5">
            {filteredPOIs.map((poi, idx) => {
              const isUnmitigated = poi.mitigationStatus === 'UNMITIGATED' || poi.touchStatus === 'UNTOUCHED';
              const isDemandOrSupport = poi.type === 'DEMAND' || poi.type === 'ORDER_BLOCK' || poi.min < currentPrice;

              return (
                <div
                  key={`poi-${idx}-${poi.name}`}
                  className={`p-3 rounded-xl border transition-all ${
                    isUnmitigated
                      ? 'bg-emerald-500/[0.04] border-emerald-500/30 hover:border-emerald-500/50'
                      : 'bg-amber-500/[0.04] border-amber-500/30 hover:border-amber-500/50'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                    {/* Left: Zone Info & Badges */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Type Indicator */}
                        <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded ${
                          isDemandOrSupport
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        }`}>
                          {poi.type}
                        </span>

                        <span className="text-xs font-semibold text-white truncate">
                          {poi.name}
                        </span>

                        <span className="text-[10px] text-slate-400">
                          {poi.timeframe} TF
                        </span>

                        {/* Mitigation Status Badge */}
                        {isUnmitigated ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            UNTOUCHED (0 TAPS)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            <Zap className="w-2.5 h-2.5 text-amber-400" />
                            TAPPED & LEFT ({poi.tapCount || 1} TAP{poi.tapCount === 1 ? '' : 'S'})
                          </span>
                        )}
                      </div>

                      {/* Description & Reaction Summary */}
                      <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                        {poi.description}
                      </p>

                      <div className="mt-2 text-[11px] flex items-start gap-1.5 text-slate-400 bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/[0.04]">
                        <span className="font-semibold text-slate-300 shrink-0">Reaction Flow:</span>
                        <span className={isUnmitigated ? 'text-emerald-300/90' : 'text-amber-300/90'}>
                          {poi.reactionSummary}
                        </span>
                      </div>
                    </div>

                    {/* Right: Price Range & Distance */}
                    <div className="shrink-0 sm:text-right pl-0 sm:pl-3 pt-1 sm:pt-0 border-t sm:border-t-0 border-white/[0.06]">
                      <div className={`text-sm font-mono font-bold ${
                        isDemandOrSupport ? 'text-emerald-300' : 'text-rose-300'
                      }`}>
                        ${formatPrice(poi.min)} to ${formatPrice(poi.max)}
                      </div>
                      <div className="flex items-center sm:justify-end gap-1.5 mt-1">
                        <span className="text-[10px] text-slate-400">Distance:</span>
                        <span className="text-[11px] font-mono font-semibold text-slate-200">
                          {poi.distancePercent !== undefined ? `${poi.distancePercent}%` : `${formatPrice(Math.abs(currentPrice - poi.min))}`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredPOIs.length === 0 && (
              <div className="py-6 text-center text-xs text-slate-400 bg-white/[0.02] rounded-xl border border-white/[0.06]">
                No zones match the selected filter.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Confluence Ladder */}
      {activeTab === 'fibonacci' && (
        <div className="space-y-2 w-full min-w-0">
          <div className="flex items-center justify-between text-[11px] text-slate-400 pb-1 border-b border-white/[0.04]">
            <span>Ratio & Level</span>
            <div className="flex gap-4">
              <span>Status</span>
              <span>Calculated Price</span>
            </div>
          </div>

          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {fibonacciLevels.map((fib, idx) => {
              const isGoldenPocket = fib.ratio === 0.618;
              const isEq = fib.ratio === 0.5;
              const isClose = Math.abs(fib.price - currentPrice) / currentPrice < 0.008;

              return (
                <div
                  key={idx}
                  className={`flex flex-col xs:flex-row xs:items-center justify-between p-2.5 rounded-lg text-xs font-mono gap-1.5 transition-all min-w-0 ${
                    isGoldenPocket
                      ? 'bg-amber-500/15 border border-amber-500/40 text-amber-200'
                      : isEq
                      ? 'bg-indigo-500/10 border border-indigo-500/30 text-indigo-200'
                      : 'bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        isGoldenPocket
                          ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]'
                          : isEq
                          ? 'bg-indigo-400'
                          : 'bg-slate-500'
                      }`}
                    />
                    <span className="font-semibold truncate">{fib.label.replace(/Fibonacci/gi, 'Ratio').replace(/Fib/gi, 'Ratio')}</span>
                    {isGoldenPocket && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 border border-amber-400/40 shrink-0">
                        GOLDEN POCKET
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between xs:justify-end gap-3 shrink-0">
                    {isClose && (
                      <span className="text-[9px] text-cyan-400 font-sans px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30">
                        Near Live Price
                      </span>
                    )}
                    <span className="font-bold text-slate-100">
                      ${formatPrice(fib.price)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-[11px] text-slate-400 pt-2 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.04]">
            <span>Swing High: ${formatPrice(swingHigh)}</span>
            <span className="text-amber-300/90 font-medium">0.618 Golden Pocket Node</span>
            <span>Swing Low: ${formatPrice(swingLow)}</span>
          </div>
        </div>
      )}
    </div>
  );
};
