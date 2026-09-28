import React, { useState, useEffect, useRef } from 'react';
import { formatTokens, TOKENS_PER_USAGE } from '../utils/tokens';
import { useTheme, ThemePref } from '../utils/theme';
import { createPortal } from 'react-dom';
import { ChatSession, SavedAnalysis, UserProfile, CreditState, XShareReward } from '../types';
import { MarketXText } from './MarketXText';
import { MarketXIcon } from './MarketXIcon';
import { VerifiedBadge } from './VerifiedBadge';
import { CreditsPanel } from './CreditsPanel';
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
  Sun,
  Moon,
  Monitor,
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
  const { pref: themePref, resolved: resolvedTheme, setTheme } = useTheme();

  // 'credits' / 'profile' now open as pop-up detail windows; 'history' is the only in-menu view
  const detailView = activeTab === 'credits' || activeTab === 'profile' ? activeTab : null;
  const closeDetail = () => setActiveTab('history');

  // Escape closes the open detail window first, then the slide-over menu (phones & tablets).
  // Latest values are read from refs so the listener stays attached across re-renders.
  const escRef = useRef({ detailView, isOpen, onCloseMobile, setActiveTab });
  escRef.current = { detailView, isOpen, onCloseMobile, setActiveTab };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const cur = escRef.current;
      if (cur.detailView) cur.setActiveTab('history');
      else if (cur.isOpen && window.matchMedia('(max-width: 1023.98px)').matches) cur.onCloseMobile?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
          className="fixed inset-0 bg-black/60 z-30 lg:hidden mx-fade-in"
        />
      )}

      {/* 
        Floating Curved Side Menu:
        - Curved edges (rounded-2xl on mobile, rounded-3xl on tablet/desktop)
        - Remains static in position while floating off the screen edges
        - Floats on mobile, tablet, and desktop with outer margins and elevation
      */}
      <aside
        className={`fixed lg:relative inset-y-0 left-0 z-40 flex flex-col bg-[var(--mx-bg-2)] border-r border-white/[0.06] rounded-r-2xl lg:rounded-none transition-[width,transform,opacity] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] shrink-0 overflow-hidden h-[100dvh] ${
          isOpen
            ? 'w-[86vw] max-w-[320px] lg:w-[280px] translate-x-0 opacity-100 shadow-2xl shadow-black/60 lg:shadow-none'
            : 'w-[86vw] max-w-[320px] -translate-x-full lg:translate-x-0 lg:w-0 lg:border-0 opacity-0 pointer-events-none'
        }`}
      >
        <div className="w-full h-full flex flex-col min-w-0 bg-transparent">
          {/* Top: New Prompt/Analysis Button & Mobile Close X Button */}
          <div className="px-4 pt-4 pb-1 flex items-center gap-2.5 select-none">
            <MarketXIcon size="md" />
            <MarketXText className="text-[17px]" />
          </div>
          <div className="p-3 pt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onNewSession();
                if (window.innerWidth < 1024) onCloseMobile();
              }}
              className="flex-1 flex items-center gap-2.5 h-10 px-3 rounded-xl hover:bg-white/[0.06] text-slate-200 hover:text-white text-sm font-medium transition-colors active:scale-[0.99] cursor-pointer"
              title="Start New Analysis"
            >
              <span className="w-7 h-7 rounded-lg bg-white text-slate-950 flex items-center justify-center"><Plus className="w-4 h-4" /></span>
              <span>New chat</span>
            </button>

            {/* Notification Center button in Side Menu (Mobile / Tablet) */}
            {onOpenNotifications && (
              <button
                type="button"
                onClick={() => {
                  onOpenNotifications();
                  if (window.innerWidth < 1024) onCloseMobile();
                }}
                className="relative w-10 h-10 rounded-full text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer flex items-center justify-center shrink-0"
                title="Notifications"
                aria-label="Open notifications"
              >
                <Bell className="w-[18px] h-[18px]" />
                {unreadNotificationsCount !== undefined && unreadNotificationsCount > 0 && (
                  <span className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-indigo-500 text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-[var(--mx-bg-2)]">
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
                {/* Appearance */}
                <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                  <div className="flex items-center gap-2 text-xs font-semibold text-white">
                    <span className="w-7 h-7 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center shrink-0">
                      {resolvedTheme === 'light' ? <Sun className="w-3.5 h-3.5 text-indigo-300" /> : <Moon className="w-3.5 h-3.5 text-indigo-300" />}
                    </span>
                    Appearance
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1 p-1 rounded-lg bg-black/30" role="radiogroup" aria-label="Theme">
                    {([
                      ['light', 'Light', Sun],
                      ['dark', 'Dark', Moon],
                      ['system', 'System', Monitor],
                    ] as [ThemePref, string, React.ElementType][]).map(([value, label, Icon]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={themePref === value}
                        onClick={() => setTheme(value)}
                        className={`h-8 rounded-md text-[11px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                          themePref === value ? 'bg-white text-slate-950' : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

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
                          : `${creditState.availableCredits} credits • ${formatTokens(creditState.dailyUsageRemaining * TOKENS_PER_USAGE)} tokens left today`}
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
                className="flex-1 flex items-center justify-center gap-2 h-10 px-3 rounded-xl bg-white text-slate-950 hover:bg-slate-200 text-sm font-medium transition-colors active:scale-[0.99] cursor-pointer"
              >
                <User className="w-4 h-4" />
                Sign in or create account
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

              {!isSignedIn && (
                <button
                  type="button"
                  onClick={() => setTheme(resolvedTheme === 'light' ? 'dark' : 'light')}
                  className="text-slate-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/[0.06] shrink-0 cursor-pointer"
                  title={resolvedTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                  aria-label={resolvedTheme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
                >
                  {resolvedTheme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
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
              className="mx-pop-in w-full sm:max-w-md max-h-[90dvh] sm:max-h-[86dvh] flex flex-col rounded-t-[28px] sm:rounded-[28px] bg-[var(--mx-bg-2)] border border-white/[0.08] shadow-[0_24px_80px_-12px_rgba(0,0,0,0.85)] overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-1 shrink-0">
                <span className="flex items-center gap-2 text-base font-semibold text-white tracking-tight">
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
                  className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 min-h-0 flex flex-col overflow-y-auto overscroll-contain pb-safe">
                {detailView === 'credits' ? (
                  <CreditsPanel
                    userProfile={userProfile}
                    creditState={creditState}
                    onOpenPricing={onOpenPricing}
                    onOpenGiftModal={onOpenGiftModal}
                  />
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
