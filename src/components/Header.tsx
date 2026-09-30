import React, { useMemo } from 'react';
import { MarketQuote } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import { ModelSelectorButton } from './ModelSelectorButton';
import { PanelLeft, Zap, Bell, SquarePen, Gift } from 'lucide-react';

interface HeaderProps {
  onToggleSidebar: () => void;
  tickers: MarketQuote[];
  /** Analyses left today (what gates new prompts) */
  credits: number;
  maxCredits: number;
  /** Local time of the next automatic refill */
  refillLabel?: string;
  /** Campaign credits left: they keep working after the daily limit */
  campaignCredits?: number;
  onOpenCredits: () => void;
  onResetChat: () => void;
  onSelectTicker: (symbol: string) => void;
  currentView?: 'home' | 'chat';
  onSwitchView?: (view: 'home' | 'chat') => void;
  username?: string;
  avatarUrl?: string;
  isVerified?: boolean;
  onOpenProfile?: () => void;
  onNotifyComingSoon?: (model: string) => void;
  unreadNotificationsCount?: number;
  onOpenNotifications?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  tickers,
  credits,
  maxCredits,
  refillLabel = '3:00 AM',
  campaignCredits = 0,
  onOpenCredits,
  onResetChat,
  onSelectTicker,
  currentView = 'home',
  onSwitchView,
  username,
  avatarUrl,
  isVerified,
  onOpenProfile,
  onNotifyComingSoon,
  unreadNotificationsCount = 0,
  onOpenNotifications,
}) => {
  const activeTickers = useMemo(() => tickers.filter(t => t.symbol !== 'SPY'), [tickers]);

  const formatPrice = (p: number) =>
    p < 10 ? p.toFixed(p < 1 ? 4 : 3) : p.toLocaleString(undefined, { maximumFractionDigits: p < 1000 ? 2 : 0 });

  return (
    <header className="h-14 pl-1.5 pr-2.5 min-[400px]:px-3 sm:px-4 flex items-center justify-between gap-1.5 min-[400px]:gap-2 sm:gap-4 shrink-0 z-30 min-w-0">
      {/* Left: sidebar, view switch, model picker */}
      <div className="flex items-center gap-1 min-[400px]:gap-1.5 sm:gap-2 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="h-9 w-8 min-[400px]:w-9 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="w-[18px] h-[18px]" />
        </button>

        {onSwitchView && (
          <div className="relative flex items-center p-0.5 rounded-full bg-white/[0.04] border border-white/[0.06] shrink-0" role="tablist">
            <span
              className={`absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded-full bg-white/[0.1] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                currentView === 'chat' ? 'translate-x-full' : 'translate-x-0'
              }`}
              aria-hidden="true"
            />
            {(['home', 'chat'] as const).map(view => (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={currentView === view}
                onClick={() => onSwitchView(view)}
                className={`relative z-10 w-[3.3rem] min-[400px]:w-[4.25rem] sm:w-[5.25rem] h-7 rounded-full text-[11px] min-[400px]:text-xs sm:text-[13px] font-medium whitespace-nowrap transition-colors ${
                  currentView === view ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {view === 'home' ? 'Markets' : 'Ask SI'}
              </button>
            ))}
          </div>
        )}

        {/* The engines picker (coming soon) steps aside on the narrowest screens so the credits and profile always fit */}
        <div className="shrink-0 max-[339px]:hidden">
          <ModelSelectorButton onNotifyComingSoon={onNotifyComingSoon} />
        </div>
      </div>

      {/* Middle: live ticker strip (tablet & desktop) */}
      <div
        className="hidden md:flex flex-1 items-center overflow-hidden min-w-0"
        style={{ maskImage: 'linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)', WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent)' }}
      >
        <div className="animate-ticker flex items-center gap-1">
          {[...activeTickers, ...activeTickers].map((ticker, idx) => {
            const isUp = ticker.change24h >= 0;
            return (
              <button
                key={`${ticker.symbol}-${idx}`}
                type="button"
                onClick={() => onSelectTicker(ticker.symbol)}
                className="flex items-center gap-1.5 px-2.5 h-7 rounded-full hover:bg-white/[0.06] text-xs transition-colors shrink-0"
                title={`Analyze ${ticker.name}`}
              >
                {/* Crypto reads as its coin (BTC); FX and metals keep the full pair so USD/JPY and USD/CAD differ */}
                <span className="font-medium text-slate-300">{ticker.symbol.endsWith('/USDT') ? ticker.symbol.slice(0, -5) : ticker.symbol}</span>
                <span className="font-mono text-slate-400">{formatPrice(ticker.price)}</span>
                <span className={`font-mono ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isUp ? '+' : ''}
                  {(Number(ticker.change24h) || 0).toFixed(2)}%
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: credits, notifications, new chat, profile */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0 ml-auto">
        {(() => {
          const unlimited = credits >= 99999;
          // After today's analyses, campaign credits carry on until used up (the one exemption)
          const onCampaign = !unlimited && credits <= 0 && campaignCredits > 0;
          const paused = !unlimited && credits <= 0 && campaignCredits <= 0;
          const count = unlimited ? '∞' : onCampaign ? campaignCredits : credits;
          const label = unlimited ? 'credits' : onCampaign ? 'campaign' : paused ? `until ${refillLabel}` : 'left today';
          const title = unlimited
            ? 'Unlimited analyses'
            : onCampaign
              ? `Today's analyses are used up. ${campaignCredits} campaign credit${campaignCredits === 1 ? '' : 's'} left; daily analyses refill at ${refillLabel}.`
              : paused
                ? `Today's analyses are used up. They refill at ${refillLabel}.`
                : `${credits} of ${maxCredits} analyses left today${campaignCredits > 0 ? `, plus ${campaignCredits} campaign credits` : ''}. Refills at ${refillLabel}.`;
          return (
            <button
              type="button"
              onClick={onOpenCredits}
              className={`h-8 flex items-center gap-1 min-[400px]:gap-1.5 px-2 min-[400px]:px-2.5 sm:px-3 rounded-full text-xs font-medium transition-colors shrink-0 border ${
                unlimited
                  ? 'bg-amber-500/10 text-amber-200 hover:bg-amber-500/15 border-transparent'
                  : onCampaign
                    ? 'bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/15 border-cyan-400/20'
                    : paused
                      ? 'bg-amber-500/10 text-amber-200 hover:bg-amber-500/15 border-amber-500/20'
                      : 'bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] border-white/[0.06]'
              }`}
              title={title}
              aria-label={unlimited ? 'Credits: unlimited' : `Credits: ${title}`}
            >
              {onCampaign ? <Gift className="w-3.5 h-3.5 text-cyan-300" /> : <Zap className="w-3.5 h-3.5 text-amber-300 fill-amber-300/80" />}
              <span className="font-mono">{count}</span>
              <span className="text-slate-500 hidden sm:inline">{label}</span>
            </button>
          );
        })()}

        {onOpenNotifications && (
          <button
            type="button"
            onClick={onOpenNotifications}
            className="hidden sm:flex relative h-9 w-9 rounded-full items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
            title="Notifications"
            aria-label="Open notifications"
          >
            <Bell className="w-[18px] h-[18px]" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-indigo-400 ring-2 ring-[var(--mx-bg)]" />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onResetChat}
          className="hidden sm:flex h-9 w-9 rounded-full items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          title="New chat"
          aria-label="New chat"
        >
          <SquarePen className="w-[18px] h-[18px]" />
        </button>

        {onOpenProfile && (
          <button
            type="button"
            onClick={onOpenProfile}
            className="relative h-8 w-8 rounded-full overflow-hidden bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-xs font-semibold text-white ring-1 ring-white/10 hover:ring-white/30 transition shrink-0"
            title={username ? `@${username}` : 'Profile'}
            aria-label="Open profile"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={username || 'Profile'} className="w-full h-full object-cover" />
            ) : (
              (username || 'T').substring(0, 1).toUpperCase()
            )}
            {isVerified && (
              <span className="absolute -bottom-0.5 -right-0.5 scale-75">
                <VerifiedBadge size="sm" />
              </span>
            )}
          </button>
        )}
      </div>
    </header>
  );
};
