import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChatSession, SavedAnalysis, UserProfile, CreditState, XShareReward } from '../types';
import { MarketXText } from './MarketXText';
import { VerifiedBadge } from './VerifiedBadge';
import { CreditRangeVisualizer } from './CreditRangeVisualizer';
import { ProfileView } from './ProfileView';
import { isUnlimitedUser } from '../utils/creditManager';
import {
  History,
  Coins,
  User,
  Plus,
  Trash2,
  TrendingUp,
  TrendingDown,
  Zap,
  RotateCcw,
  Gift,
  CreditCard,
  Target,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Sparkles,
  X,
  Bell,
  Settings,
  ChevronRight,
  ChevronDown
} from 'lucide-react';

interface SidebarProps {
  sessions: ChatSession[];
  savedAnalyses?: SavedAnalysis[];
  currentSessionId: string | null;
  onSelectSession: (id: string) => void;
  onSelectSignal?: (analysis: SavedAnalysis) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string, e: React.MouseEvent) => void;
  onClearAllSessions: () => void;
  onDeleteSignal?: (id: string, e: React.MouseEvent) => void;
  onClearAllSignals?: () => void;
  onClearAllHistory?: () => void;
  credits: number;
  maxCredits: number;
  activeTab: 'history' | 'credits' | 'profile';
  setActiveTab: (tab: 'history' | 'credits' | 'profile') => void;
  userProfile: UserProfile;
  creditState: CreditState;
  onOpenPricing: () => void;
  onOpenGiftModal: () => void;
  onUpdateUsername?: (newUsername: string) => void;
  onUpdateProfile: (updated: { displayName: string; username: string; avatarUrl?: string }) => Promise<string | null>;
  xShareReward?: XShareReward | null;
  onRegisterShareReward?: () => Promise<string | null>;
  onDismissRewardNotice?: () => void;
  isOpen: boolean;
  onCloseMobile: () => void;
  unreadNotificationsCount?: number;
  onOpenNotifications?: () => void;
  isSignedIn?: boolean;
  onSignIn?: () => void;
  onSignOut?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  sessions,
  savedAnalyses = [],
  currentSessionId,
  onSelectSession,
  onSelectSignal,
  onNewSession,
  onDeleteSession,
  onClearAllSessions,
  onDeleteSignal,
  onClearAllSignals,
  onClearAllHistory,
  credits,
  maxCredits,
  activeTab,
  setActiveTab,
  userProfile,
  creditState,
  onOpenPricing,
  onOpenGiftModal,
  onUpdateUsername,
  onUpdateProfile,
  xShareReward,
  onRegisterShareReward,
  onDismissRewardNotice,
  isOpen,
  onCloseMobile,
  unreadNotificationsCount = 0,
  onOpenNotifications,
  isSignedIn = false,
  onSignIn,
  onSignOut,
}) => {
  const [historySubTab, setHistorySubTab] = useState<'trades' | 'chats'>('trades');
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // 'credits' / 'profile' now open as pop-up detail windows; 'history' is the only in-menu view
  const detailView = activeTab === 'credits' || activeTab === 'profile' ? activeTab : null;
  const closeDetail = () => setActiveTab('history');

  useEffect(() => {
    if (!detailView) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActiveTab('history');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailView, setActiveTab]);

  const formatPrice = (p: number) =>
    p < 10
      ? p.toFixed(4)
      : p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const isPremium = userProfile.subscription.active;

  return (
    <>
      {/* Mobile & Tablet Backdrop */}
      {isOpen && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-30 lg:hidden transition-opacity"
        />
      )}

      {/* 
        Floating Curved Side Menu:
        - Curved edges (rounded-2xl on mobile, rounded-3xl on tablet/desktop)
        - Remains static in position while floating off the screen edges
        - Floats on mobile, tablet, and desktop with outer margins and elevation
      */}
      <aside
        className={`fixed lg:relative z-40 flex flex-col bg-slate-950/92 backdrop-blur-2xl border border-white/[0.14] rounded-2xl sm:rounded-3xl transition-all duration-300 ease-in-out shrink-0 overflow-hidden shadow-2xl shadow-black/80 ring-1 ring-white/[0.06] ${
          isOpen
            ? 'top-2.5 bottom-2.5 left-2.5 sm:top-3 sm:bottom-3 sm:left-3 h-[calc(100dvh-1.25rem)] sm:h-[calc(100dvh-1.5rem)] w-[88vw] max-w-[340px] sm:w-84 translate-x-0 opacity-100 lg:top-auto lg:bottom-auto lg:left-auto lg:my-3 lg:ml-3 lg:h-[calc(100vh-1.5rem)]'
            : 'top-2.5 bottom-2.5 left-2.5 h-[calc(100dvh-1.25rem)] w-0 -translate-x-full lg:translate-x-0 lg:w-0 lg:my-3 lg:ml-0 lg:border-0 opacity-0 pointer-events-none'
        }`}
      >
        <div className="w-full h-full flex flex-col min-w-0 bg-transparent">
          {/* Top: New Prompt/Analysis Button & Mobile Close X Button */}
          <div className="p-3 border-b border-white/[0.08] flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onNewSession();
                if (window.innerWidth < 1024) onCloseMobile();
              }}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-indigo-600/25 hover:bg-indigo-600/40 text-indigo-100 hover:text-white border border-indigo-500/35 font-semibold text-xs transition-all shadow-md active:scale-98 cursor-pointer"
              title="Start New Analysis"
            >
              <Plus className="w-4 h-4 text-indigo-300" />
              <span>New Analysis</span>
            </button>

            {/* Notification Center button in Side Menu (Mobile / Tablet) */}
            {onOpenNotifications && (
              <button
                type="button"
                onClick={() => {
                  onOpenNotifications();
                  if (window.innerWidth < 1024) onCloseMobile();
                }}
                className="relative p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] text-slate-200 hover:text-white border border-white/[0.1] transition-all cursor-pointer flex items-center justify-center shrink-0"
                title="Notification Center"
                aria-label="Open Notifications"
              >
                <Bell className="w-4 h-4 text-indigo-300" />
                {unreadNotificationsCount !== undefined && unreadNotificationsCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-gradient-to-r from-cyan-400 to-indigo-500 text-slate-950 font-mono font-extrabold text-[9px] flex items-center justify-center shadow-md ring-2 ring-slate-950 animate-pulse">
                    {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
                  </span>
                )}
              </button>
            )}

            {/* Close X Icon on Mobile & Tablet */}
            <button
              type="button"
              onClick={onCloseMobile}
              className="lg:hidden p-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.16] text-slate-200 hover:text-white border border-white/[0.15] transition-all cursor-pointer shrink-0 active:scale-95"
              title="Close Menu"
              aria-label="Close menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* HISTORY: the only section shown in the side menu */}
          <div className="px-4 pt-3 pb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <History className="w-3.5 h-3.5 text-indigo-300" />
            <span>History</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 pt-1.5 space-y-2.5 overscroll-contain">
              {/* Master Clear All Bar if there is any history */}
              {(savedAnalyses.length > 0 || sessions.length > 0) && (
                <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs">
                  <span className="text-slate-400 text-[11px] font-medium">
                    Total Records: <strong className="text-white font-mono">{savedAnalyses.length + sessions.length}</strong>
                  </span>
                  {confirmClearAll ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (onClearAllHistory) {
                            onClearAllHistory();
                          } else {
                            onClearAllSessions();
                            onClearAllSignals?.();
                          }
                          setConfirmClearAll(false);
                        }}
                        className="px-2 py-0.5 rounded-md bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 font-semibold text-[10px] border border-rose-500/40 transition-colors"
                      >
                        Confirm Clear All
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClearAll(false)}
                        className="px-1.5 py-0.5 rounded-md text-slate-400 hover:text-white text-[10px]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmClearAll(true)}
                      className="flex items-center gap-1 text-[11px] text-rose-400/90 hover:text-rose-300 font-medium transition-colors"
                      title="Clear all trade setups and chat history"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear Everything</span>
                    </button>
                  )}
                </div>
              )}

              {/* Sub-Tabs: Trade Results vs Chat Sessions */}
              <div className="flex items-center justify-between gap-1 p-1 bg-black/30 rounded-lg border border-white/[0.06] text-[11px]">
                <button
                  type="button"
                  onClick={() => setHistorySubTab('trades')}
                  className={`flex-1 py-1 px-2 rounded-md font-medium transition-all ${
                    historySubTab === 'trades'
                      ? 'bg-white/[0.08] text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Trade Results ({savedAnalyses.length})
                </button>
                <button
                  type="button"
                  onClick={() => setHistorySubTab('chats')}
                  className={`flex-1 py-1 px-2 rounded-md font-medium transition-all ${
                    historySubTab === 'chats'
                      ? 'bg-white/[0.08] text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Chat History ({sessions.length})
                </button>
              </div>

              {/* Sub-View 1: Trade Results Log */}
              {historySubTab === 'trades' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1 pb-1">
                    <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                      Saved Setups ({savedAnalyses.length})
                    </span>
                    {savedAnalyses.length > 0 && onClearAllSignals && (
                      <button
                        type="button"
                        onClick={onClearAllSignals}
                        className="text-[10px] text-rose-400 hover:text-rose-300 transition-colors"
                      >
                        Clear Setups
                      </button>
                    )}
                  </div>

                  {savedAnalyses.length === 0 ? (
                    <div className="text-center py-8 px-4 space-y-2">
                      <div className="w-10 h-10 rounded-full bg-white/[0.03] border border-white/[0.08] flex items-center justify-center mx-auto text-slate-500">
                        <Target className="w-5 h-5" />
                      </div>
                      <p className="text-xs text-slate-400 font-medium">No saved trade setups yet</p>
                      <p className="text-[11px] text-slate-500">
                        Prompt <MarketXText className="text-[11px]" /> to scan any asset. Executed strategies automatically log here.
                      </p>
                    </div>
                  ) : (
                    savedAnalyses.map(item => {
                      const isLong = item.tradeType === 'LONG';
                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            if (onSelectSignal) {
                              onSelectSignal(item);
                            } else {
                              onSelectSession(item.sessionId);
                            }
                            if (window.innerWidth < 1024) onCloseMobile();
                          }}
                          className="p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.1] hover:border-indigo-400/40 cursor-pointer transition-all space-y-1.5 shadow-sm group relative"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-xs text-white">
                                {item.symbol}
                              </span>
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/[0.06] text-slate-300 border border-white/[0.08]">
                                {item.timeframe}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-md flex items-center gap-1 ${
                                  isLong
                                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                }`}
                              >
                                {isLong ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                {item.tradeType}
                              </span>
                              {onDeleteSignal && (
                                <button
                                  type="button"
                                  onClick={e => onDeleteSignal(item.id, e)}
                                  className="p-1 rounded-md text-slate-400 hover:text-rose-300 hover:bg-rose-500/20 transition-all shrink-0"
                                  title="Delete setup"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-1 text-[10px] font-mono pt-1 text-slate-400 border-t border-white/[0.04]">
                            <div>
                              <span className="block text-[9px] text-slate-500">Entry</span>
                              <span className="text-amber-200 font-medium">${formatPrice(item.optimalEntry)}</span>
                            </div>
                            <div>
                              <span className="block text-[9px] text-slate-500">Stop</span>
                              <span className="text-rose-300 font-medium">${formatPrice(item.stopLossPrice)}</span>
                            </div>
                            <div>
                              <span className="block text-[9px] text-slate-500">Target</span>
                              <span className="text-emerald-300 font-medium">${formatPrice(item.tp1Price)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Sub-View 2: Chat Sessions */}
              {historySubTab === 'chats' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between px-1 pb-1">
                    <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                      Recent Conversations ({sessions.length})
                    </span>
                    {sessions.length > 0 && (
                      <button
                        type="button"
                        onClick={onClearAllSessions}
                        className="text-[10px] text-rose-400 hover:text-rose-300 transition-colors"
                      >
                        Clear Chats
                      </button>
                    )}
                  </div>

                  {sessions.length === 0 ? (
                    <div className="text-center py-8 text-xs text-slate-500">
                      No chat conversations yet
                    </div>
                  ) : (
                    sessions.map(session => {
                      const isActive = session.id === currentSessionId;
                      return (
                        <div
                          key={session.id}
                          onClick={() => {
                            onSelectSession(session.id);
                            if (window.innerWidth < 1024) onCloseMobile();
                          }}
                          className={`p-2.5 rounded-xl border transition-all cursor-pointer group relative ${
                            isActive
                              ? 'bg-indigo-600/20 border-indigo-500/40 text-white shadow-xs'
                              : 'bg-white/[0.02] border-white/[0.06] text-slate-300 hover:bg-white/[0.05] hover:border-white/[0.1]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1.5">
                            <div className="flex items-center gap-1.5 truncate">
                              {session.bias && (
                                <span
                                  className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                                    session.bias === 'BULLISH'
                                      ? 'bg-emerald-500/20 text-emerald-400'
                                      : 'bg-rose-500/20 text-rose-400'
                                  }`}
                                >
                                  {session.bias === 'BULLISH' ? (
                                    <TrendingUp className="w-3 h-3" />
                                  ) : (
                                    <TrendingDown className="w-3 h-3" />
                                  )}
                                </span>
                              )}
                              <span className="font-semibold text-xs truncate text-white">
                                {session.title || 'MarketX Analysis'}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={e => onDeleteSession(session.id, e)}
                              className="p-1 rounded-md text-slate-400 hover:text-rose-300 hover:bg-rose-500/20 transition-all shrink-0"
                              title="Delete conversation"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {session.lastMessage && (
                            <p className="text-[11px] text-slate-400 truncate mt-1">
                              {session.lastMessage}
                            </p>
                          )}

                          <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500">
                            <span>{new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {session.symbol && (
                              <span className="font-mono text-indigo-400 font-semibold">
                                {session.symbol}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
          </div>

          {/* SETTINGS: bottom of the side menu, reveals Credits & Profile */}
          <div className="border-t border-white/[0.08] bg-black/40 pb-safe">
            {isSignedIn && isSettingsOpen && (
              <div className="p-2 space-y-1.5 border-b border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setActiveTab('credits')}
                  className="w-full flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-indigo-400/40 text-left transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
                      <Coins className="w-3.5 h-3.5 text-amber-300" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-white">Credits</span>
                      <span className="block text-[10px] text-slate-400 font-mono truncate">
                        {isUnlimitedUser(userProfile.email)
                          ? 'Unlimited access'
                          : `${creditState.availableCredits} credits • ${creditState.dailyUsageRemaining}/10 daily`}
                      </span>
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('profile')}
                  className="w-full flex items-center justify-between gap-2 p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-indigo-400/40 text-left transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="w-7 h-7 rounded-lg overflow-hidden bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 border border-indigo-400/40 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                      {userProfile.avatarUrl ? (
                        <img src={userProfile.avatarUrl} alt={userProfile.username} className="w-full h-full object-cover" />
                      ) : (
                        userProfile.username.substring(0, 2).toUpperCase()
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 text-xs font-semibold text-white">
                        Profile
                        {(isPremium || isUnlimitedUser(userProfile.email)) && <VerifiedBadge size="sm" />}
                      </span>
                      <span className="block text-[10px] text-slate-400 font-mono truncate">@{userProfile.username}</span>
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </button>
              </div>
            )}

            <div className="p-2.5 flex items-center justify-between gap-2">
              {!isSignedIn && onSignIn ? (
              <button
                type="button"
                onClick={onSignIn}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                <User className="w-4 h-4" />
                Sign in / Create account
              </button>
              ) : (
              <button
                type="button"
                onClick={() => setIsSettingsOpen(prev => !prev)}
                aria-expanded={isSettingsOpen}
                className={`flex-1 flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-colors cursor-pointer ${
                  isSettingsOpen
                    ? 'bg-indigo-600/25 border-indigo-500/40 text-white'
                    : 'bg-white/[0.04] border-white/[0.1] text-slate-200 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Settings className="w-4 h-4 text-indigo-300" />
                  Settings
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isSettingsOpen ? 'rotate-180' : ''}`} />
              </button>
              )}

              <a
                href="https://x.com/_MarketXai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/[0.06] shrink-0"
                title="Follow @_MarketXai on X"
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </aside>

      {/* Credits / Profile detail pop-up (portaled so the menu's transform can't clip it) */}
      {detailView && typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[45] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 sidebar-detail-fade"
            onClick={closeDetail}
            role="dialog"
            aria-modal="true"
            aria-label={detailView === 'credits' ? 'Credits' : 'Profile'}
          >
            <div
              className="w-full sm:max-w-md max-h-[88dvh] sm:max-h-[85dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-slate-950 border border-white/[0.14] shadow-2xl shadow-black/80 overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.08] shrink-0">
                <span className="flex items-center gap-2 text-sm font-bold text-white">
                  {detailView === 'credits' ? (
                    <Coins className="w-4 h-4 text-amber-300" />
                  ) : (
                    <User className="w-4 h-4 text-indigo-300" />
                  )}
                  {detailView === 'credits' ? 'Credits' : 'Profile'}
                </span>
                <button
                  type="button"
                  onClick={closeDetail}
                  className="p-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.14] text-slate-200 hover:text-white border border-white/[0.12] transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-contain pb-safe">
                {detailView === 'credits' ? (
                  <div className="p-3.5 sm:p-4 space-y-4">
                    {/* Available Credits Card */}
                    <div className="p-4 rounded-2xl bg-gradient-to-b from-indigo-950/50 via-slate-900/60 to-black/40 border border-indigo-500/30 shadow-md">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                          <Zap className="w-4 h-4 text-amber-400 fill-amber-400" />
                          Available AI Credits
                        </span>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded-full border ${
                            isUnlimitedUser(userProfile.email)
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : isPremium
                              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                              : 'bg-white/[0.05] text-slate-400 border-white/[0.1]'
                          }`}
                        >
                          {isUnlimitedUser(userProfile.email) ? 'Unlimited VIP' : isPremium ? 'Pro Tier Active' : 'Free Tier'}
                        </span>
                      </div>
      
                      <div className="flex items-baseline gap-1.5 mt-2">
                        <span className="text-3xl font-black font-mono text-white">
                          {isUnlimitedUser(userProfile.email) || creditState.availableCredits >= 99999 ? '∞' : creditState.availableCredits}
                        </span>
                        <span className="text-xs font-mono text-slate-400">
                          {isUnlimitedUser(userProfile.email) ? 'Unlimited Access' : 'Compute Balance'}
                        </span>
                      </div>
      
                      <div className="flex justify-between items-center text-[10px] text-slate-400 mt-2 pt-2 border-t border-white/[0.06]">
                        <span>{isUnlimitedUser(userProfile.email) ? 'VIP Unlimited Mode' : 'Cost per prompt: 1 Credit'}</span>
                        <span className="text-indigo-300 font-medium">{isUnlimitedUser(userProfile.email) ? 'No limits apply' : 'Auto-renewing quota'}</span>
                      </div>
                    </div>
      
                    {/* Visual Range Visualizer for Day, Month, and Year */}
                    <CreditRangeVisualizer
                      creditState={creditState}
                      userProfile={userProfile}
                      onOpenPricing={onOpenPricing}
                    />
      
                    {/* Refill Section & Pricing Trigger */}
                    <div className="space-y-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block px-1">
                        Refill & Subscription
                      </span>
      
                      <button
                        type="button"
                        onClick={onOpenPricing}
                        className="w-full p-3.5 rounded-xl bg-gradient-to-r from-indigo-600/30 via-cyan-600/20 to-indigo-600/30 hover:from-indigo-600/45 hover:to-cyan-600/35 border border-indigo-500/40 text-left transition-all group flex items-center justify-between shadow-md cursor-pointer"
                      >
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-white flex items-center gap-1.5">
                            <CreditCard className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Refill Credits & Plans</span>
                          </div>
                          <span className="text-[10px] text-slate-300 block">
                            $18/month • Paystack
                          </span>
                        </div>
                        <span className="px-2 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-bold font-mono group-hover:scale-105 transition-transform">
                          Refill &rarr;
                        </span>
                      </button>
      
                      {/* Gift Credits Button */}
                      <button
                        type="button"
                        onClick={onOpenGiftModal}
                        className="w-full p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.08] text-left transition-all group flex items-center justify-between shadow-xs cursor-pointer"
                      >
                        <div className="space-y-0.5">
                          <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                            <Gift className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Gift Credits to User</span>
                          </div>
                          <span className="text-[10px] text-slate-400 block">
                            Transfer credits via @username
                          </span>
                        </div>
                        <span className="text-xs font-mono text-cyan-300 font-semibold group-hover:translate-x-0.5 transition-transform">
                          Gift &rarr;
                        </span>
                      </button>
                    </div>
      
                    {/* Value Proposition Note */}
                    <div className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] text-xs space-y-2 text-slate-300">
                      <span className="font-semibold text-white block text-[11px]">
                        Included with Pro Tier:
                      </span>
                      <div className="space-y-1 text-[11px] text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
                          <span>10 daily usage quota renewed every 24h</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <VerifiedBadge size="sm" />
                          <span>Verified Pro Trader badge on Profile</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
                          <span>Paystack multi-currency billing integration</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <ProfileView
                    userProfile={userProfile}
                    creditState={creditState}
                    onUpdateUsername={onUpdateUsername}
                    onUpdateProfile={onUpdateProfile}
                    onOpenPricing={onOpenPricing}
                    onOpenGiftModal={onOpenGiftModal}
                    completedAnalysesCount={savedAnalyses.length}
                    xShareReward={xShareReward}
                    onRegisterShareReward={onRegisterShareReward}
                    onDismissRewardNotice={onDismissRewardNotice}
                    onSignOut={onSignOut}
                  />
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};
