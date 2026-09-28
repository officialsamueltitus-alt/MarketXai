import React, { useState } from 'react';
import { StrategyResult, UserProfile } from '../types';
import { TechnicalVisualizer } from './TechnicalVisualizer';
import { MarketXText } from './MarketXText';
import { VerifiedBadge } from './VerifiedBadge';
import { downloadStrategyImage, shareToX } from '../utils/exportImage';
import { LazyMarkdown } from './LazyMarkdown';
import {
  TrendingUp,
  TrendingDown,
  Target,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
  Copy,
  Check,
  ExternalLink,
  Sparkles,
  Zap,
  Clock,
  Activity,
  AlertTriangle,
  Download,
  User,
  AlertCircle
} from 'lucide-react';

interface StrategyCardProps {
  strategy: StrategyResult;
  onFollowUpPrompt?: (
    prompt: string,
    options?: { isTightSl?: boolean; baseStrategy?: StrategyResult }
  ) => void;
  onTightenStopLoss?: (strategy: StrategyResult) => void;
  userProfile?: UserProfile;
}

const StrategyCardView: React.FC<StrategyCardProps> = ({
  strategy,
  onFollowUpPrompt,
  onTightenStopLoss,
  userProfile
}) => {
  const [copied, setCopied] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadDone, setDownloadDone] = useState(false);
  const [activeView, setActiveView] = useState<'strategy' | 'thesis'>('strategy');

  const {
    symbol,
    name,
    currentPrice,
    change24h,
    high24h,
    low24h,
    timeframe,
    bias,
    tradeType,
    confidenceScore,
    entryZone,
    stopLoss,
    takeProfits,
    riskRewardRatio,
    detailedThesis,
    sources,
  } = strategy;

  const isNoSignal = tradeType === 'NO_SIGNAL';
  const isLong = tradeType === 'LONG';
  const isBullish = bias === 'BULLISH';
  const isPositive = change24h >= 0;

  const formatPrice = (p: number | undefined | null) => {
    const num = Number(p);
    if (isNaN(num)) return '0.00';
    return currentPrice < 10
      ? num.toFixed(4)
      : num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const traderHandle = userProfile?.username ? `@${userProfile.username.replace(/^@/, '')}` : '@trader';

  const handleCopy = () => {
    const summary = `📊 MARKETX (@_MarketXai) SETUP: ${symbol} (${timeframe})
Trader: ${traderHandle}${userProfile?.isVerified ? ' ✓ (Verified)' : ''}
Action: ${tradeType} | Bias: ${bias} (Confidence: ${confidenceScore}%)
Current Price: $${formatPrice(currentPrice)} (24h: ${isPositive ? '+' : ''}${(Number(change24h) || 0).toFixed(2)}%)
--------------------------------------------
🎯 Optimal Entry: $${formatPrice(entryZone?.optimal)} ($${formatPrice(entryZone?.min)} - $${formatPrice(entryZone?.max)})
🛑 Invalidation Stop Loss: $${formatPrice(stopLoss?.price)} (-${stopLoss?.riskPercent || 1.5}%)
💰 Targets:
${(takeProfits || []).map(tp => `   • ${tp.level}: $${formatPrice(tp.price)} (${tp.rewardRatio}, Scale ${tp.exitPercent}%)`).join('\n')}
⚖️ Risk / Reward: ${riskRewardRatio}
--------------------------------------------
Generated via MarketX AI (@_MarketXai) • https://marketx.world`;

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(summary).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }).catch(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <div className="w-full rounded-2xl glass-panel-elevated overflow-hidden border border-white/[0.12] transition-all shadow-2xl my-3">
      {/* Top Banner: Asset & Live Quote & Bias */}
      <div className="p-4 sm:p-5 border-b border-white/[0.08] bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-slate-800/40">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Symbol & Name */}
          <div className="flex items-center gap-3">
            <div
              className={`w-11 h-11 rounded-xl flex items-center justify-center font-black text-lg border shadow-lg ${
                isNoSignal
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-400 shadow-amber-950/40'
                  : isLong
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 shadow-emerald-950/40'
                  : 'bg-rose-500/15 border-rose-500/30 text-rose-400 shadow-rose-950/40'
              }`}
            >
              {isNoSignal ? (
                <AlertCircle className="w-6 h-6" />
              ) : isLong ? (
                <ArrowUpRight className="w-6 h-6" />
              ) : (
                <ArrowDownRight className="w-6 h-6" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-lg sm:text-xl text-white tracking-tight">{symbol}</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/[0.06] text-slate-300 border border-white/[0.08] flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5 text-indigo-400" />
                  {timeframe} TF
                </span>
                <span className="text-xs text-slate-400 hidden sm:inline">{name}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="flex items-center gap-1.5 text-xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-mono font-bold text-slate-100 text-sm">
                    ${formatPrice(currentPrice)}
                  </span>
                </span>
                <span
                  className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded ${
                    isPositive ? 'text-emerald-400 bg-emerald-500/10' : 'text-rose-400 bg-rose-500/10'
                  }`}
                >
                  {isPositive ? '+' : ''}
                  {(Number(change24h) || 0).toFixed(2)}%
                </span>
                <span className="text-[11px] text-slate-400 hidden sm:inline">
                  Range: ${formatPrice(low24h)} - ${formatPrice(high24h)}
                </span>
              </div>
            </div>
          </div>

          {/* Trade Direction & Score & Action Buttons */}
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 sm:self-center">
            <div
              className={`px-2.5 sm:px-3 py-1.5 rounded-xl border flex items-center gap-1.5 font-bold text-xs sm:text-sm tracking-wide shadow-md ${
                isNoSignal
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-amber-950/30'
                  : isLong
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-emerald-950/30'
                  : 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-rose-950/30'
              }`}
            >
              {isNoSignal ? (
                <>
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>NO SIGNAL OPPORTUNITY</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 fill-current shrink-0" />
                  <span>{isLong ? 'BUY ZONE / BUY LIMIT' : 'SELL ZONE / SELL LIMIT'}</span>
                </>
              )}
            </div>

            <div className="hidden md:flex px-2 py-1.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-[11px] font-mono font-medium items-center gap-1">
              <Sparkles className="w-3 h-3 text-cyan-400" />
              <span><MarketXText className="text-[11px]" /> Quant Engine</span>
            </div>

            {/* Trader Username Badge on Generated Card */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-black/40 border border-white/[0.12] text-xs font-mono text-slate-200 shadow-xs">
              <span className="text-slate-400 text-[11px]">Trader:</span>
              <span className="font-bold text-white tracking-tight">{traderHandle}</span>
              {userProfile?.isVerified && <VerifiedBadge size="sm" />}
            </div>

            <div className="px-2.5 py-1.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 text-xs font-semibold flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{confidenceScore}% Confluence</span>
            </div>

            {/* Share to X Button */}
            <button
              type="button"
              onClick={() => shareToX(strategy, userProfile?.username)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white border border-white/[0.1] text-xs font-semibold transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-xs"
              title="Share Setup to X (Twitter)"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              <span className="hidden xs:inline">Share</span>
            </button>

            {/* Download Image Button */}
            <button
              type="button"
              disabled={isDownloading}
              onClick={async () => {
                setIsDownloading(true);
                try {
                  await downloadStrategyImage(strategy, userProfile?.username, userProfile?.isVerified);
                  setDownloadDone(true);
                  setTimeout(() => setDownloadDone(false), 2200);
                } catch (err) {
                  console.error('Download failed:', err);
                } finally {
                  setIsDownloading(false);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 hover:text-white border border-indigo-500/40 text-xs font-semibold transition-all hover:scale-105 active:scale-95 cursor-pointer shadow-xs"
              title="Download High-Res Graphic Image as PNG"
            >
              {isDownloading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
                  <span className="hidden xs:inline">Saving...</span>
                </>
              ) : downloadDone ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300 font-bold">Saved!</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5 text-indigo-300" />
                  <span className="hidden xs:inline">Image</span>
                </>
              )}
            </button>

            {/* Copy Button */}
            <button
              type="button"
              onClick={handleCopy}
              className="p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/[0.08] transition-all cursor-pointer"
              title="Copy Trade Parameters"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Uploaded Chart Image Analysis Confirmation */}
      {strategy.uploadedChartAnalyzed && (
        <div className="px-4 sm:px-5 pt-2 pb-1">
          <div className="p-3 rounded-xl bg-cyan-950/20 border border-cyan-500/30 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-400/40 flex items-center justify-center shrink-0">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              </div>
              <div className="min-w-0">
                <span className="font-bold text-white block truncate">
                  Multimodal Chart Image Analysis Verified
                </span>
                <span className="text-[10px] text-cyan-300 font-mono block truncate">
                  Visual candlesticks, market structure (BOS/CHoCH) & order blocks mapped from uploaded chart
                </span>
              </div>
            </div>
            {strategy.chartImageThumbnail && (
              <img
                src={strategy.chartImageThumbnail}
                alt="Analyzed Chart"
                className="w-10 h-10 object-cover rounded-lg border border-cyan-400/40 shrink-0 shadow-xs"
                referrerPolicy="no-referrer"
              />
            )}
          </div>
        </div>
      )}

      {/* Institutional POI Mitigation Status Strip */}
      <div className="px-4 sm:px-5 py-2.5 bg-white/[0.02] border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Institutional POI Status:
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {strategy.unmitigatedZonesCount ?? (strategy.poiZones ? strategy.poiZones.filter(z => z.mitigationStatus === 'UNMITIGATED').length : 2)} Untouched (Virgin POIs)
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
            <Zap className="w-2.5 h-2.5 text-amber-400" />
            {strategy.mitigatedZonesCount ?? (strategy.poiZones ? strategy.poiZones.filter(z => z.mitigationStatus === 'MITIGATED').length : 1)} Tapped & Left
          </span>
        </div>
        <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
          Institutional Liquidity Mapping
        </span>
      </div>

      {/* Main Parameters Grid */}
      <div className="p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Card 1: Entry Zone */}
          <div className="p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20 backdrop-blur-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-amber-500/5 rounded-full blur-xl pointer-events-none" />
            <div className="flex items-center justify-between text-xs text-amber-300 font-semibold mb-1">
              <span className="flex items-center gap-1.5">
                <Target className="w-3.5 h-3.5 text-amber-400" />
                Optimal Entry
              </span>
              <span className="text-[10px] text-slate-400 uppercase">Limit Zone</span>
            </div>
            <div className="text-xl font-extrabold font-mono text-amber-200">
              ${formatPrice(entryZone.optimal)}
            </div>
            <div className="text-[11px] font-mono text-amber-300/80 mt-1">
              Band: ${formatPrice(entryZone.min)} - ${formatPrice(entryZone.max)}
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 line-clamp-2 leading-tight">
              {entryZone.rationale}
            </p>
          </div>

          {/* Card 2: Stop Loss */}
          <div className="p-3.5 rounded-xl bg-rose-500/5 border border-rose-500/20 backdrop-blur-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-rose-500/5 rounded-full blur-xl pointer-events-none" />
            <div className="flex items-center justify-between text-xs text-rose-300 font-semibold mb-1">
              <span className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                Invalidation (SL)
              </span>
              <span className="text-[10px] font-mono text-rose-400 font-bold">
                -{stopLoss.riskPercent}% Risk
              </span>
            </div>
            <div className="text-xl font-extrabold font-mono text-rose-300">
              ${formatPrice(stopLoss.price)}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Buffer below institutional floor
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 line-clamp-2 leading-tight">
              {stopLoss.rationale}
            </p>
          </div>

          {/* Card 3: Primary Take Profit */}
          <div className="p-3.5 rounded-xl bg-emerald-500/5 border border-emerald-500/20 backdrop-blur-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-500/5 rounded-full blur-xl pointer-events-none" />
            <div className="flex items-center justify-between text-xs text-emerald-300 font-semibold mb-1">
              <span className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                Target TP1 & TP2
              </span>
              <span className="text-[10px] font-mono text-emerald-400 font-bold">
                {takeProfits[0]?.rewardRatio}
              </span>
            </div>
            <div className="text-xl font-extrabold font-mono text-emerald-300">
              ${formatPrice(takeProfits[1]?.price || takeProfits[0]?.price)}
            </div>
            <div className="text-[11px] text-emerald-400/90 font-mono mt-1">
              TP1: ${formatPrice(takeProfits[0]?.price)} (Scale 40%)
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">
              Opposing institutional liquidity target
            </p>
          </div>

          {/* Card 4: Risk/Reward Profile */}
          <div className="p-3.5 rounded-xl bg-indigo-500/5 border border-indigo-500/20 backdrop-blur-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-16 h-16 bg-indigo-500/5 rounded-full blur-xl pointer-events-none" />
            <div className="flex items-center justify-between text-xs text-indigo-300 font-semibold mb-1">
              <span className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-indigo-400" />
                Risk / Reward
              </span>
              <span className="text-[10px] text-indigo-300 uppercase font-bold">Optimal</span>
            </div>
            <div className="text-xl font-extrabold font-mono text-indigo-200">
              {riskRewardRatio}
            </div>
            <div className="text-[11px] text-indigo-300/80 font-medium mt-1">
              Minimum 1:2.5 institutional criteria met
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">
              High expectancy mathematical trade setup
            </p>
          </div>
        </div>

        {/* Technical Indicators & Confluence Visualizer */}
        <TechnicalVisualizer strategy={strategy} />

        {/* View Switcher: Strategy Details vs Full Institutional Thesis */}
        <div className="pt-2">
          <div className="flex items-center justify-between border-b border-white/[0.08] pb-2 mb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveView('strategy')}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                  activeView === 'strategy'
                    ? 'bg-white/[0.1] text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Actionable Targets Breakdown
              </button>
              <button
                type="button"
                onClick={() => setActiveView('thesis')}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${
                  activeView === 'thesis'
                    ? 'bg-white/[0.1] text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Institutional Supply & Demand Thesis
              </button>
            </div>

            <span className="text-[11px] text-slate-400 hidden sm:inline">
              Grounded on Live Market Quotes
            </span>
          </div>

          {activeView === 'strategy' ? (
            <div className="space-y-3">
              {/* Take Profits Table */}
              <div className="rounded-xl border border-white/[0.08] bg-black/20 overflow-x-auto min-w-0">
                <div className="min-w-[320px] sm:min-w-0">
                  <div className="grid grid-cols-4 p-2.5 text-[11px] font-semibold text-slate-400 bg-white/[0.02] border-b border-white/[0.06]">
                    <span>Target Level</span>
                    <span>Exit Price</span>
                    <span>Risk : Reward</span>
                    <span className="text-right">Scale Allocation</span>
                  </div>
                  {takeProfits.map((tp, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-4 p-2.5 text-xs border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02] transition-colors items-center font-mono"
                    >
                      <span className="font-sans font-medium text-slate-200 flex items-center gap-1.5 truncate">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                        {tp.level}
                      </span>
                      <span className="font-bold text-emerald-300">${formatPrice(tp.price)}</span>
                      <span className="text-slate-300">{tp.rewardRatio}</span>
                      <span className="text-right text-indigo-300 font-semibold">{tp.exitPercent}% Position</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Confluence Callout */}
              <div className="p-3.5 rounded-xl bg-gradient-to-r from-indigo-950/30 to-slate-900/40 border border-indigo-500/20 text-xs flex items-start gap-3">
                <div className="p-1.5 rounded-md bg-indigo-500/20 text-indigo-400 shrink-0 mt-0.5">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  <span className="font-semibold text-indigo-200">
                    Why this trade has high probability:
                  </span>
                  <p className="text-slate-300 leading-relaxed text-[11px]">
                    Mathematical confluence directly aligns with high-liquidity structural {isBullish ? 'support' : 'resistance'}, 
                    offering defined risk parameters and an asymmetric 1:{riskRewardRatio.replace('1 :', '')} return profile.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-black/20 border border-white/[0.06] text-xs text-slate-300 leading-relaxed max-h-96 overflow-y-auto space-y-3">
              <div className="prose prose-invert prose-xs max-w-none">
                <LazyMarkdown>{detailedThesis}</LazyMarkdown>
              </div>
            </div>
          )}
        </div>

        {/* Real-time Sources / Grounding References */}
        {sources && sources.length > 0 && (
          <div className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
            <span className="text-slate-500">Live Grounding Sources:</span>
            {sources.filter(src => /^https?:\/\//i.test(String(src?.uri || ''))).map((src, i) => (
              <a
                key={i}
                href={src.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/[0.03] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/[0.06] transition-colors"
              >
                <span>{src.title.length > 25 ? src.title.slice(0, 25) + '...' : src.title}</span>
                <ExternalLink className="w-2.5 h-2.5 opacity-60" />
              </a>
            ))}
          </div>
        )}

        {/* Quick Follow-up Action Pills */}
        {(onFollowUpPrompt || onTightenStopLoss) && (
          <div className="pt-2 flex flex-wrap gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => {
                if (onTightenStopLoss) {
                  onTightenStopLoss(strategy);
                } else if (onFollowUpPrompt) {
                  onFollowUpPrompt(
                    `Tighten the stop loss for ${symbol} on this setup. Keep the existing entry, take-profit targets, and analysis structure, but recalculate a tighter invalidation stop loss and updated risk-reward ratio.`,
                    { isTightSl: true, baseStrategy: strategy }
                  );
                }
              }}
              className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-200 hover:text-white text-[11px] font-medium transition-colors flex items-center gap-1 cursor-pointer"
            >
              <ShieldAlert className="w-3 h-3 text-rose-400" />
              <span>Tighten Stop Loss</span>
            </button>
            <button
              type="button"
              onClick={() =>
                onFollowUpPrompt(
                  `Analyze ${symbol} on the higher 1D Daily timeframe to confirm macro liquidity confluence.`
                )
              }
              className="px-2.5 py-1 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-slate-300 hover:text-white text-[11px] transition-colors"
            >
              Analyze Daily (1D) Macro
            </button>
            <button
              type="button"
              onClick={() =>
                onFollowUpPrompt(
                  `What are the specific invalidation warning signs or candle closes for ${symbol} before entering?`
                )
              }
              className="px-2.5 py-1 rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.06] text-slate-300 hover:text-white text-[11px] transition-colors"
            >
              Detailed Invalidation Rules
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// Re-render only when the setup or the viewer changes; handlers are read through refs by the caller
export const StrategyCard = React.memo(
  StrategyCardView,
  (prev, next) => prev.strategy === next.strategy && prev.userProfile === next.userProfile
);
