import React, { useMemo } from 'react';
import { MarketQuote } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import { ModelSelectorButton } from './ModelSelectorButton';
import {
  Menu,
  Zap,
  TrendingUp,
  TrendingDown,
  RotateCcw,
  User,
  Bell
} from 'lucide-react';

interface HeaderProps {
  onToggleSidebar: () => void;
  tickers: MarketQuote[];
  credits: number;
  maxCredits: number;
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

  return (
    <header className="h-14 mx-2 sm:mx-3.5 my-2 sm:my-2.5 rounded-2xl border border-white/[0.14] glass-panel px-2 sm:px-4 flex items-center justify-between gap-1 sm:gap-3 shrink-0 z-30 shadow-lg min-w-0 overflow-hidden">
      {/* Left: Sidebar Toggle & Page Switcher & Model Selector */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="p-1.5 sm:p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          title="Toggle Sidebar"
        >
          <Menu className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        {onSwitchView && (
          <div className="flex items-center bg-black/40 rounded-lg p-0.5 border border-white/[0.08] shrink-0">
            <button
              type="button"
              onClick={() => onSwitchView('home')}
              className={`px-1.5 sm:px-2 py-1 rounded-md text-[10px] sm:text-xs font-semibold transition-all ${
                currentView === 'home'
                  ? 'bg-indigo-600/40 text-white border border-indigo-500/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => onSwitchView('chat')}
              className={`px-1.5 sm:px-2 py-1 rounded-md text-[10px] sm:text-xs font-semibold transition-all ${
                currentView === 'chat'
                  ? 'bg-indigo-600/40 text-white border border-indigo-500/40 shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Ask AI
            </button>
          </div>
        )}

        {/* User requested button: Analyze with Claude, GPT, Grok with cycling icons */}
        <ModelSelectorButton onNotifyComingSoon={onNotifyComingSoon} />
      </div>

      {/* Middle: Live Market Moving Repeatedly Ticker Row (Visible on tablet & desktop, keeping mobile nav options clear and complete) */}
      <div className="hidden md:flex flex-1 items-center overflow-hidden min-w-0 mx-2 sm:mx-3 relative mask-radial">
        <div className="animate-ticker flex items-center gap-1.5 sm:gap-2 py-1">
          {[...activeTickers, ...activeTickers].map((ticker, idx) => {
            const isUp = ticker.change24h >= 0;
            return (
              <button
                key={`${ticker.symbol}-${idx}`}
                type="button"
                onClick={() => onSelectTicker(ticker.symbol)}
                className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-[11px] sm:text-xs font-mono transition-all hover:scale-105 shrink-0 group shadow-xs"
                title={`Analyze ${ticker.name} (${ticker.symbol})`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                <span className="font-bold text-slate-200 group-hover:text-cyan-300 transition-colors">
                  {ticker.symbol.split('/')[0]}
                </span>
                <span className="text-slate-300 font-medium">
                  ${ticker.price < 10 ? ticker.price.toFixed(3) : ticker.price.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                </span>
                <span
                  className={`flex items-center text-[10px] font-semibold ${
                    isUp ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {isUp ? <TrendingUp className="w-2.5 h-2.5 inline" /> : <TrendingDown className="w-2.5 h-2.5 inline" />}
                  {isUp ? '+' : ''}
                  {ticker.change24h}%
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: Credits Pill & User Profile & Actions */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {/* User Profile Chip */}
        {onOpenProfile && (
          <button
            type="button"
            onClick={onOpenProfile}
            className="flex items-center gap-1 sm:gap-1.5 p-1 sm:px-2 sm:py-1 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-200 text-xs transition-all shadow-xs cursor-pointer shrink-0"
            title="View Profile"
          >
            <div className="w-5 h-5 rounded-full overflow-hidden bg-gradient-to-tr from-indigo-600 to-cyan-400 flex items-center justify-center text-[9px] font-bold text-white shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt={username || 'Trader'} className="w-full h-full object-cover" />
              ) : (
                (username || 'T').substring(0, 1).toUpperCase()
              )}
            </div>
            <span className="font-mono text-[11px] hidden sm:inline text-slate-300">
              @{username || 'trader'}
            </span>
            {isVerified && (
              <span className="hidden sm:inline-flex">
                <VerifiedBadge size="sm" />
              </span>
            )}
          </button>
        )}

        {/* Credits Pill */}
        <button
          type="button"
          onClick={onOpenCredits}
          className={`flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2.5 py-1 rounded-full border text-xs font-semibold shadow-xs transition-all shrink-0 ${
            credits >= 99999
              ? 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-400/40 text-amber-300 shadow-amber-500/10'
              : 'bg-indigo-600/20 hover:bg-indigo-600/30 border-indigo-500/30 text-indigo-300'
          }`}
          title={credits >= 99999 ? 'Unlimited VIP Credits' : 'View or Refill AI Credits'}
        >
          <Zap className={`w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 ${credits >= 99999 ? 'text-amber-300 fill-amber-300' : 'text-amber-400 fill-amber-400'}`} />
          <span className="font-mono text-[11px] sm:text-xs font-bold">
            {credits >= 99999 ? '∞ Unlimited' : credits}
          </span>
          {credits < 99999 && <span className="text-slate-400 text-[10px] hidden sm:inline">Credits</span>}
        </button>

        {/* Notification Center Trigger on Navbar (desktop & tablet) */}
        {onOpenNotifications && (
          <button
            type="button"
            onClick={onOpenNotifications}
            className="hidden sm:flex relative p-1.5 sm:p-2 rounded-xl text-slate-300 hover:text-white hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.14] transition-all cursor-pointer shadow-xs shrink-0"
            title="Notification Center"
            aria-label="Open Notification Center"
          >
            <Bell className="w-4 h-4 text-slate-300 hover:text-cyan-300" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-gradient-to-r from-cyan-400 to-indigo-500 text-slate-950 font-mono font-extrabold text-[9px] flex items-center justify-center shadow-md ring-2 ring-slate-950 animate-pulse">
                {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
              </span>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onResetChat}
          className="hidden sm:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0"
          title="Clear Conversation"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};

