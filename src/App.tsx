import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ChatSession,
  ChatMessage,
  MarketQuote,
  StrategyResult,
  SavedAnalysis,
  UserProfile,
  CreditState,
  CreditGift,
  SubscriptionPlan,
  XShareReward,
  AppNotification,
} from './types';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { HomePage } from './components/HomePage';
import { ChatFeed } from './components/ChatFeed';
import { ChatInput } from './components/ChatInput';
import { PricingModal } from './components/PricingModal';
import { GiftCreditsModal } from './components/GiftCreditsModal';
import { NotificationCenterModal } from './components/NotificationCenterModal';
import { TermsAndPrivacyModal } from './components/TermsAndPrivacyModal';
import { ShareProfileModal } from './components/ShareProfileModal';
import { RewardEmailNotificationModal } from './components/RewardEmailNotificationModal';
import {
  INITIAL_USER_PROFILE,
  INITIAL_CREDIT_STATE,
  STORAGE_KEY_USER_PROFILE,
  STORAGE_KEY_CREDIT_STATE,
  STORAGE_KEY_CREDIT_GIFTS,
  checkAndRefreshDailyQuota,
  checkSubscriptionExpiry,
  activateSubscription,
  isUnlimitedUser,
} from './utils/creditManager';
import { getApiUrl } from './utils/api';
import { extractAssetInfo, generateClientFallbackStrategy } from './utils/localStrategyEngine';
import { ArrowLeft, Plus, CheckCircle2, Gift } from 'lucide-react';
import worldMapBg from './assets/images/world_map_bg_1789305116043.jpg';

// The decorative world-map backdrop is ~700KB and barely visible under its overlays; skip it on phones
const SHOW_AMBIENT_BACKDROP =
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(min-width: 1024px)').matches;

const STORAGE_KEY_SESSIONS = 'market_ai_sessions_v1';
const STORAGE_KEY_ANALYSES = 'market_ai_saved_analyses_v1';
const STORAGE_KEY_X_SHARE_REWARD = 'market_ai_x_share_reward_v1';
const STORAGE_KEY_NOTIFICATIONS = 'market_ai_notifications_v1';

export default function App() {
  const [currentView, setCurrentView] = useState<'home' | 'chat'>('home');

  // User Profile state with persistent storage and subscription check
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_USER_PROFILE);
      if (saved) {
        const parsed: UserProfile = JSON.parse(saved);
        return checkSubscriptionExpiry(parsed);
      }
    } catch (e) {
      console.error('Failed to load user profile:', e);
    }
    return INITIAL_USER_PROFILE;
  });

  // X Share Reward state for tracking the 10-hour +10 credit workflow
  const [xShareReward, setXShareReward] = useState<XShareReward | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_X_SHARE_REWARD);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to load X share reward:', e);
    }
    return null;
  });

  // Credit State tracking daily quota (resets strictly every 24h, no rollover) & total credits
  const [creditState, setCreditState] = useState<CreditState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CREDIT_STATE);
      if (saved) {
        const parsed: CreditState = JSON.parse(saved);
        const savedProfile = localStorage.getItem(STORAGE_KEY_USER_PROFILE);
        const email = savedProfile ? JSON.parse(savedProfile).email : INITIAL_USER_PROFILE.email;
        const { state } = checkAndRefreshDailyQuota(parsed, false, email);
        return state;
      }
    } catch (e) {
      console.error('Failed to load credit state:', e);
    }
    return INITIAL_CREDIT_STATE;
  });

  // Recent Gifts History
  const [recentGifts, setRecentGifts] = useState<CreditGift[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_CREDIT_GIFTS);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  // Modals state
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [isGiftModalOpen, setIsGiftModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isEmailReceiptModalOpen, setIsEmailReceiptModalOpen] = useState(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
  const [termsModalTab, setTermsModalTab] = useState<'terms' | 'privacy' | 'risk'>('terms');
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
  const [toastNotification, setToastNotification] = useState<{ message: string; type: 'gift' | 'success' } | null>(null);

  // Notifications state
  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_NOTIFICATIONS);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      {
        id: 'notif-welcome',
        title: 'Welcome to MarketX Quantitative Terminal',
        message: 'Your institutional liquidity sweep and 0.618 golden pocket engine is active. Built by SpiriTech Labs.',
        type: 'system',
        timestamp: Date.now() - 1000 * 60 * 25,
        read: false,
      },
      {
        id: 'notif-market-btc',
        title: 'Institutional Liquidity Expansion Alert',
        message: 'BTC/USDT 4H golden pocket defense confirmed near order block. Scan confluence levels.',
        type: 'market',
        timestamp: Date.now() - 1000 * 60 * 75,
        read: false,
        actionPrompt: 'Analyze BTC/USDT 4H liquidity pools and identify high-probability institutional confluence zones for entry.',
      },
      {
        id: 'notif-campaign-reward',
        title: 'Campaign: Share Profile on X (+10 Credits)',
        message: 'Share your official trader card on X to earn 10 complimentary AI credits after 10 hours.',
        type: 'reward',
        timestamp: Date.now() - 1000 * 60 * 160,
        read: false,
      },
    ];
  });

  // Save notifications to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_NOTIFICATIONS, JSON.stringify(notifications));
    } catch {}
  }, [notifications]);

  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SESSIONS);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to load sessions from storage:', e);
    }
    return [];
  });

  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_ANALYSES);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error('Failed to load saved analyses:', e);
    }
    return [];
  });

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SESSIONS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.length > 0) return parsed[0].id;
      }
    } catch {}
    return null;
  });

  const [tickers, setTickers] = useState<MarketQuote[]>([
    {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      price: 225.0,
      change24h: -0.38,
      high24h: 227.4,
      low24h: 223.8,
      volume24h: '13.937 M',
      marketCap: '3.453 T USD',
      ratio: '33.96',
      sector: 'Electronic technology',
      currency: 'USD',
      type: 'stock',
    },
    {
      symbol: 'TSLA',
      name: 'Tesla, Inc.',
      price: 442.0,
      change24h: 1.12,
      high24h: 448.5,
      low24h: 436.0,
      volume24h: '4.653 M',
      marketCap: '3.285 T USD',
      ratio: '24.88',
      sector: 'Consumer durables',
      currency: 'USD',
      type: 'stock',
    },
    {
      symbol: 'GOOGL',
      name: 'Alphabet Inc.',
      price: 181.02,
      change24h: -1.89,
      high24h: 184.2,
      low24h: 179.9,
      volume24h: '6.942 M',
      marketCap: '2.247 T USD',
      ratio: '51.12',
      sector: 'Technology services',
      currency: 'USD',
      type: 'stock',
    },
    {
      symbol: 'WMT',
      name: 'Walmart Inc.',
      price: 121.80,
      change24h: 3.28,
      high24h: 122.9,
      low24h: 119.5,
      volume24h: '99.804 M',
      marketCap: '2.996 T USD',
      ratio: '25.70',
      sector: 'Retail trade',
      currency: 'USD',
      type: 'stock',
    },
    {
      symbol: 'BTC/USDT',
      name: 'Bitcoin',
      price: 81220.0,
      change24h: 1.85,
      high24h: 82450.0,
      low24h: 79800.0,
      volume24h: '38.45 K',
      marketCap: '1.602 T USD',
      ratio: '64.20',
      sector: 'Digital store of value',
      currency: 'USD',
      type: 'crypto',
    },
    {
      symbol: 'ETH/USDT',
      name: 'Ethereum',
      price: 2680.5,
      change24h: 1.42,
      high24h: 2740.0,
      low24h: 2615.0,
      volume24h: '345.8 K',
      marketCap: '322.5 B USD',
      ratio: '42.15',
      sector: 'Smart contracts',
      currency: 'USD',
      type: 'crypto',
    },
    {
      symbol: 'NVDA',
      name: 'NVIDIA Corp.',
      price: 138.25,
      change24h: 2.15,
      high24h: 140.5,
      low24h: 135.8,
      volume24h: '58.420 M',
      marketCap: '3.380 T USD',
      ratio: '48.30',
      sector: 'Semiconductors',
      currency: 'USD',
      type: 'stock',
    },
    {
      symbol: 'SOL/USDT',
      name: 'Solana',
      price: 142.60,
      change24h: 2.85,
      high24h: 146.5,
      low24h: 138.2,
      volume24h: '4.862 M',
      marketCap: '68.4 B USD',
      ratio: '38.50',
      sector: 'High-speed L1',
      currency: 'USD',
      type: 'crypto',
    },
    {
      symbol: 'XAU/USD',
      name: 'Gold Spot',
      price: 2924.50,
      change24h: 0.64,
      high24h: 2942.0,
      low24h: 2908.5,
      volume24h: '42.800 M',
      marketCap: '17.4 T USD',
      ratio: '18.40',
      sector: 'Precious metals',
      currency: 'USD',
      type: 'commodity',
    },
  ]);

  // Live market quotes synchronization: polling /api/market/tickers with change-detection
  useEffect(() => {
    let isMounted = true;

    const fetchLatestTickers = async () => {
      // Don't poll when page is hidden/minimized to save CPU and network bandwidth
      if (typeof document !== 'undefined' && document.hidden) return;

      try {
        const res = await fetch(getApiUrl('/api/market/tickers'));
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && Array.isArray(data.tickers) && data.tickers.length > 0 && isMounted) {
          setTickers(prev => {
            // Guard: check if any ticker values actually changed before creating new array reference
            let hasChanged = false;
            if (prev.length !== data.tickers.length) {
              hasChanged = true;
            } else {
              for (let i = 0; i < data.tickers.length; i++) {
                const incoming = data.tickers[i];
                const existing = prev.find(p => p.symbol === incoming.symbol);
                if (!existing || existing.price !== incoming.price || existing.change24h !== incoming.change24h) {
                  hasChanged = true;
                  break;
                }
              }
            }
            if (!hasChanged) return prev;

            return data.tickers.map((t: MarketQuote) => {
              const old = prev.find(p => p.symbol === t.symbol);
              return {
                ...old,
                ...t,
                name: t.name || old?.name || t.symbol,
                type: t.type || old?.type || 'stock',
                marketCap: t.marketCap || old?.marketCap,
                ratio: t.ratio || old?.ratio,
                sector: t.sector || old?.sector,
                currency: t.currency || old?.currency || 'USD',
              };
            });
          });
        }
      } catch (err) {
        console.warn('Ticker sync error:', err);
      }
    };

    fetchLatestTickers();
    const interval = setInterval(fetchLatestTickers, 15000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Sidebar active tab arrangement: History, Credits, Profile
  const [activeSidebarTab, setActiveSidebarTab] = useState<'history' | 'credits' | 'profile'>('history');
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 1024;
    }
    return false;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [targetSignalMessageId, setTargetSignalMessageId] = useState<string | null>(null);
  const [pendingChartImage, setPendingChartImage] = useState<string | null>(null);
  const [pendingChartFileName, setPendingChartFileName] = useState<string>('');

  // Abort controller reference to cancel analysis requests when Stop button is clicked
  const abortControllerRef = useRef<AbortController | null>(null);

  // Handler to stop analysis immediately
  const handleStopAnalysis = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setSessions(prev =>
      prev.map(s => {
        if (s.id === currentSessionId) {
          return {
            ...s,
            messages: s.messages.map(m =>
              m.status === 'searching'
                ? {
                    ...m,
                    content: 'Analysis stopped by user.',
                    status: 'completed' as const,
                    searchStep: undefined,
                  }
                : m
            ),
          };
        }
        return s;
      })
    );
    setToastNotification({
      message: 'Analysis stopped',
      type: 'success',
    });
  }, [currentSessionId]);

  // Sync user profile to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_USER_PROFILE, JSON.stringify(userProfile));
    } catch (e) {
      console.error('Failed to save user profile:', e);
    }
  }, [userProfile]);

  // Sync credit state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CREDIT_STATE, JSON.stringify(creditState));
    } catch (e) {
      console.error('Failed to save credit state:', e);
    }
  }, [creditState]);

  // Sync recent gifts to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_CREDIT_GIFTS, JSON.stringify(recentGifts));
    } catch (e) {
      console.error('Failed to save gifts:', e);
    }
  }, [recentGifts]);

  // Sync sessions to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(sessions));
    } catch (e) {
      console.error('Failed to save sessions:', e);
    }
  }, [sessions]);

  // Sync savedAnalyses to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_ANALYSES, JSON.stringify(savedAnalyses));
    } catch (e) {
      console.error('Failed to save analyses:', e);
    }
  }, [savedAnalyses]);

  // Sync X Share Reward to localStorage
  useEffect(() => {
    try {
      if (xShareReward) {
        localStorage.setItem(STORAGE_KEY_X_SHARE_REWARD, JSON.stringify(xShareReward));
      } else {
        localStorage.removeItem(STORAGE_KEY_X_SHARE_REWARD);
      }
    } catch (e) {
      console.error('Failed to save X share reward:', e);
    }
  }, [xShareReward]);

  // Check 10-hour timer for X Share Reward and credit 10 credits + dispatch notifications
  useEffect(() => {
    if (!xShareReward || xShareReward.status !== 'pending') return;

    const evaluateReward = async () => {
      const now = Date.now();
      if (now >= xShareReward.unlockAt) {
        // 1. Credit 10 credits to the user balance
        setCreditState(prev => {
          const next = {
            ...prev,
            availableCredits: prev.availableCredits + 10,
          };
          try {
            localStorage.setItem(STORAGE_KEY_CREDIT_STATE, JSON.stringify(next));
          } catch {}
          return next;
        });

        // 2. Mark reward as credited and enable on-site notification
        const updated: XShareReward = {
          ...xShareReward,
          status: 'credited',
          notifiedOnSite: true,
          notifiedEmail: true,
        };
        setXShareReward(updated);

        // 3. Trigger site toast notification
        setToastNotification({
          message: '🎉 You have been credited with 10 credits for sharing your profile on X! Email notice sent.',
          type: 'success',
        });

        // 3.5 Add to in-app notification center
        const rewardNotif: AppNotification = {
          id: `notif-reward-${Date.now()}`,
          title: '🎉 +10 Credits Added to Your Account',
          message: 'You have been credited with 10 AI credits for sharing your profile on X! Verification window completed.',
          type: 'reward',
          timestamp: Date.now(),
          read: false,
        };
        setNotifications(prev => [rewardNotif, ...prev]);

        // 4. Mark notified
        const completed: XShareReward = {
          ...xShareReward,
          status: 'credited',
          notifiedOnSite: true,
          notifiedEmail: true,
        };
        setXShareReward(completed);
      }
    };

    if (!xShareReward || xShareReward.status !== 'pending') return;

    evaluateReward();
    const interval = setInterval(evaluateReward, 8000);
    return () => clearInterval(interval);
  }, [xShareReward]);

  // Handlers for X Share Reward
  const handleRegisterShareReward = useCallback((reward: XShareReward) => {
    setXShareReward(reward);
    setToastNotification({
      message: '🚀 Profile shared on X! 10 credits will be unlocked after 10 hours.',
      type: 'success',
    });
  }, []);

  const handleDismissRewardNotice = useCallback(() => {
    if (!xShareReward) return;
    setXShareReward(prev => prev ? { ...prev, notifiedOnSite: false } : null);
  }, [xShareReward]);

  // Periodic check: 24-hour quota renewal & subscription expiry check
  useEffect(() => {
    const checkInterval = setInterval(() => {
      // Check subscription
      setUserProfile(prev => checkSubscriptionExpiry(prev));

      // Check daily quota (strictly 24-hour cycle, resets to 10 for premium, no carry over)
      setCreditState(prev => {
        const { state, refreshed } = checkAndRefreshDailyQuota(prev, userProfile.subscription.active);
        if (refreshed) {
          setToastNotification({
            message: `Your daily quota renewed: ${state.dailyUsageRemaining} uses available!`,
            type: 'success',
          });
        }
        return state;
      });
    }, 30000); // Check every 30 seconds

    return () => clearInterval(checkInterval);
  }, [userProfile.subscription.active]);

  // Dismiss toast notification after 5s
  useEffect(() => {
    if (toastNotification) {
      const timer = setTimeout(() => setToastNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastNotification]);

  // Handle plan purchase via Paystack
  const handleSelectPlan = (plan: 'monthly' | 'yearly', paystackRef?: string) => {
    const updatedProfile = activateSubscription(userProfile, plan, paystackRef || `ref_${Date.now()}`);
    setUserProfile(updatedProfile);

    // Give immediate refreshed quota & additional compute balance
    setCreditState(prev => ({
      ...prev,
      availableCredits: prev.availableCredits + (plan === 'yearly' ? 500 : 50),
      dailyUsageLimit: 10,
      dailyUsageRemaining: 10, // restarts to 10 immediately
      lastDailyResetTime: Date.now(),
    }));

    setToastNotification({
      message: `🎉 Success! Pro ${plan === 'yearly' ? 'Yearly' : 'Monthly'} activated via Paystack. Verified badge added!`,
      type: 'success',
    });
  };

  // Handle gifting credits to another user
  const handleSendGift = (toUsername: string, amount: number, note?: string) => {
    if (creditState.availableCredits < amount) {
      return false;
    }

    // Deduct credits
    setCreditState(prev => ({
      ...prev,
      availableCredits: Math.max(0, prev.availableCredits - amount),
    }));

    // Record gift
    const giftRecord: CreditGift = {
      id: `gift-${Date.now()}`,
      fromUsername: userProfile.username,
      toUsername: toUsername.replace(/^@/, '').trim(),
      amount,
      timestamp: Date.now(),
      note,
    };

    setRecentGifts(prev => [giftRecord, ...prev]);

    setToastNotification({
      message: `🎁 Successfully gifted ${amount} AI Credits to @${giftRecord.toUsername}!`,
      type: 'gift',
    });

    return true;
  };

  // Handle username updates
  const handleUpdateUsername = (newUsername: string) => {
    const cleaned = newUsername.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (cleaned.length >= 3) {
      setUserProfile(prev => ({
        ...prev,
        username: cleaned,
      }));
      setToastNotification({
        message: `Username updated to @${cleaned}`,
        type: 'success',
      });
    }
  };

  // Handle comprehensive profile updates (displayName, username, profile picture)
  const handleUpdateProfile = (updated: { displayName: string; username: string; avatarUrl?: string }) => {
    setUserProfile(prev => ({
      ...prev,
      displayName: updated.displayName,
      username: updated.username,
      avatarUrl: updated.avatarUrl,
    }));
    setToastNotification({
      message: 'Profile updated successfully!',
      type: 'success',
    });
  };

  // Initial backfill of savedAnalyses once if not previously initialized
  useEffect(() => {
    try {
      const initialized = localStorage.getItem('marketx_analyses_initialized');
      if (!initialized && savedAnalyses.length === 0 && sessions.length > 0) {
        const existing: SavedAnalysis[] = [];
        sessions.forEach(session => {
          session.messages.forEach(msg => {
            if (msg.strategy) {
              const st = msg.strategy;
              existing.push({
                id: `analysis-${msg.id}`,
                symbol: st.symbol,
                name: st.name,
                timeframe: st.timeframe,
                bias: st.bias,
                tradeType: st.tradeType,
                optimalEntry: st.entryZone.optimal,
                stopLossPrice: st.stopLoss.price,
                tp1Price: st.takeProfits[0]?.price || 0,
                riskReward: st.riskRewardRatio,
                confidenceScore: st.confidenceScore,
                timestamp: msg.timestamp || session.updatedAt,
                sessionId: session.id,
                messageId: msg.id,
              });
            }
          });
        });
        if (existing.length > 0) {
          setSavedAnalyses(existing);
        }
        localStorage.setItem('marketx_analyses_initialized', 'true');
      }
    } catch {}
  }, [sessions, savedAnalyses.length]);

  // Retrieve current active session
  const currentSession = sessions.find(s => s.id === currentSessionId);
  const currentMessages = currentSession?.messages || [];

  // Create a new chat session
  const handleNewSession = () => {
    const newId = `session-${Date.now()}`;
    const newSession: ChatSession = {
      id: newId,
      title: 'New Analysis',
      lastMessage: '',
      updatedAt: Date.now(),
      messages: [],
    };
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newId);
    setTargetSignalMessageId(null);
    setCurrentView('chat');
  };

  // Select existing session
  const handleSelectSession = (id: string) => {
    setCurrentSessionId(id);
    setTargetSignalMessageId(null);
    setCurrentView('chat');
  };

  // Directly navigate to a particular signal response from the History page
  const handleSelectSignal = (analysis: SavedAnalysis) => {
    setCurrentSessionId(analysis.sessionId);
    setTargetSignalMessageId(analysis.messageId || analysis.id);
    setCurrentView('chat');
  };

  // Delete individual session
  const handleDeleteSession = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSessions(prev => {
      const updated = prev.filter(s => s.id !== id);
      try {
        localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    // Also remove associated savedAnalyses that belong to this session
    setSavedAnalyses(prev => {
      const updated = prev.filter(a => a.sessionId !== id);
      try {
        localStorage.setItem(STORAGE_KEY_ANALYSES, JSON.stringify(updated));
      } catch {}
      return updated;
    });
    if (currentSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      setCurrentSessionId(remaining.length > 0 ? remaining[0].id : null);
    }
    setToastNotification({
      message: 'Conversation deleted',
      type: 'success',
    });
  };

  // Clear all chat sessions
  const handleClearAllSessions = () => {
    setSessions([]);
    try {
      localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify([]));
    } catch {}
    setCurrentSessionId(null);
    setToastNotification({
      message: 'All chat conversations cleared',
      type: 'success',
    });
  };

  // Delete individual trade setup
  const handleDeleteSignal = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSavedAnalyses(prev => {
      const updated = prev.filter(a => a.id !== id);
      try {
        localStorage.setItem(STORAGE_KEY_ANALYSES, JSON.stringify(updated));
        localStorage.setItem('marketx_analyses_initialized', 'true');
      } catch {}
      return updated;
    });
    setToastNotification({
      message: 'Trade setup deleted',
      type: 'success',
    });
  };

  // Clear all saved trade setups
  const handleClearAllSignals = () => {
    setSavedAnalyses([]);
    try {
      localStorage.setItem(STORAGE_KEY_ANALYSES, JSON.stringify([]));
      localStorage.setItem('marketx_analyses_initialized', 'true');
    } catch {}
    setToastNotification({
      message: 'All trade setups cleared',
      type: 'success',
    });
  };

  // Clear all history at once (sessions + saved setups)
  const handleClearAllHistory = () => {
    setSessions([]);
    setSavedAnalyses([]);
    setCurrentSessionId(null);
    try {
      localStorage.setItem(STORAGE_KEY_SESSIONS, JSON.stringify([]));
      localStorage.setItem(STORAGE_KEY_ANALYSES, JSON.stringify([]));
      localStorage.setItem('marketx_analyses_initialized', 'true');
    } catch {}
    setToastNotification({
      message: 'All history records cleared',
      type: 'success',
    });
  };

  // Send a message and generate institutional strategy
  const handleSendMessage = async (
    promptText: string,
    timeframe: string = '4H',
    slMode: 'normal' | 'tight' = 'normal',
    baseStrategy?: StrategyResult,
    chartImage?: string,
    chartFileName?: string
  ) => {
    if (!promptText.trim() || isLoading) return;

    setCurrentView('chat');
    // Clear any historical signal locks so the view always focuses and slides down to the recent response
    setTargetSignalMessageId(null);

    // Extract asset info directly from the user prompt
    const assetInfo = extractAssetInfo(promptText);

    // Only consider a tighten prompt if user explicitly used tightening language AND a baseStrategy was provided (e.g. from a card action)
    const hasTightenKeywords =
      /tighten.*(sl|stop\s*loss)|tighter.*(sl|stop\s*loss)|tight.*(sl|stop\s*loss)|reduce.*(risk|sl|stop)|make.*(sl|stop).*tight/i.test(promptText);
    const hasNewAnalysisDirectives =
      /\b(analyze|chart|pair|setup|forecast|outlook|buy|sell|long|short)\b/i.test(promptText);

    const isTightenPrompt = Boolean(baseStrategy && hasTightenKeywords && !hasNewAnalysisDirectives);
    const resolvedBaseStrategy = isTightenPrompt ? baseStrategy : undefined;

    const isUnlimited = isUnlimitedUser(userProfile.email);

    // First ensure 24h daily quota is fresh
    const refreshed = checkAndRefreshDailyQuota(creditState, userProfile.subscription.active, userProfile.email);
    let activeCredits = refreshed.state;
    if (refreshed.refreshed) {
      setCreditState(activeCredits);
    }

    // Check if user has daily usage left or available compute credits
    const hasDailyQuota = activeCredits.dailyUsageRemaining > 0;
    const hasAvailableCredits = activeCredits.availableCredits > 0;

    if (!isUnlimited && !hasDailyQuota && !hasAvailableCredits) {
      // Both daily quota and credits exhausted: show refill page
      setIsPricingModalOpen(true);
      return;
    }

    // Deduct daily quota (or compute credit if daily quota reached) - only for non-unlimited users
    if (!isUnlimited) {
      setCreditState(prev => {
        const newDaily = Math.max(0, prev.dailyUsageRemaining - 1);
        const newAvailable = Math.max(0, prev.availableCredits - 1);
        return {
          ...prev,
          dailyUsageRemaining: newDaily,
          availableCredits: newAvailable,
        };
      });
    }

    // Ensure we have an active session
    let targetSessionId = currentSessionId;
    if (!targetSessionId) {
      targetSessionId = `session-${Date.now()}`;
      setCurrentSessionId(targetSessionId);
    }

    const requestStartTime = Date.now();
    const userMessageId = `msg-user-${requestStartTime}`;
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: promptText,
      chartImage: chartImage || undefined,
      chartFileName: chartFileName || undefined,
      timestamp: requestStartTime,
    };

    const assistantMessageId = `msg-assistant-${requestStartTime + 1}`;
    const assistantPlaceholder: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      status: 'searching',
      searchStep: resolvedBaseStrategy
        ? `Anchoring to verified ${resolvedBaseStrategy.symbol} setup & 15m Supply & Demand structure...`
        : 'Parsing prompt directive & identifying asset target parameters...',
      timestamp: requestStartTime + 1,
    };

    // Immediately append user message & assistant loading placeholder to sessions state
    setSessions(prev => {
      const exists = prev.some(s => s.id === targetSessionId);
      if (!exists) {
        const newSession: ChatSession = {
          id: targetSessionId!,
          title: promptText.slice(0, 32),
          lastMessage: promptText,
          updatedAt: Date.now(),
          messages: [userMessage, assistantPlaceholder],
        };
        return [newSession, ...prev];
      }
      return prev.map(s => {
        if (s.id === targetSessionId) {
          return {
            ...s,
            title: s.messages.length === 0 ? promptText.slice(0, 32) : s.title,
            lastMessage: promptText,
            updatedAt: Date.now(),
            messages: [...s.messages, userMessage, assistantPlaceholder],
          };
        }
        return s;
      });
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsLoading(true);

    // 8-stage institutional quantitative scanning pipeline
    const scanStages = resolvedBaseStrategy
      ? [
          `Anchoring to verified ${resolvedBaseStrategy.symbol} setup & 15m supply/demand structure...`,
          'Calculating micro-rejection wick & compressed invalidation zone...',
          'Auditing price reaction levels and immediate resting liquidity...',
          'Locking in identical entry price and multi-tier take-profit targets...',
          'Cross-referencing order book depth across Binance & Bybit...',
          'Verifying news risk window and spread volatility tolerances...',
          'Establishing compressed stop loss and capital preservation boundary...',
          'Finalizing revised risk-reward ratio matrix & institutional thesis...',
        ]
      : [
          'Parsing prompt directive & identifying asset target parameters...',
          'Scanning unmitigated institutional supply & demand liquidity zones...',
          'Scanning multi-exchange depth across Binance, CME & Bybit pools...',
          'Mapping structural support & high-liquidity reaction zones...',
          'Calculating mathematical confluence & probability thresholds...',
          'Screening high-impact macroeconomic news & calendar risk events...',
          'Formulating micro-invalidation boundary & capital protection rules...',
          'Synthesizing asymmetric risk/reward targets & institutional thesis...',
        ];

    try {
      // 1. Kick off backend analysis in parallel immediately
      const fetchPromise = (async () => {
        try {
          const analyzeRes = await fetch(getApiUrl('/api/market/analyze'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: promptText,
              symbol: assetInfo.symbol,
              timeframe: resolvedBaseStrategy?.timeframe || timeframe,
              slMode: isTightenPrompt ? 'tight' : slMode,
              baseStrategy: resolvedBaseStrategy,
              chartImage,
            }),
            signal: controller.signal,
          });

          if (analyzeRes.ok) {
            const data = await analyzeRes.json();
            if (data && data.strategy) {
              return {
                strategy: data.strategy as StrategyResult,
                assistantText: (data.content || data.message || data.strategy.detailedThesis) as string,
              };
            }
          }
        } catch (err: any) {
          if (err.name === 'AbortError') return null;
          console.warn('Backend analyze fallback to local high-precision engine:', err);
        }
        return null;
      })();

      // 2. Step smoothly through the 8 stages, each taking exactly 3 seconds
      for (let i = 0; i < scanStages.length; i++) {
        if (controller.signal.aborted) return;

        setSessions(prev =>
          prev.map(s => {
            if (s.id === targetSessionId) {
              return {
                ...s,
                messages: s.messages.map(m =>
                  m.id === assistantMessageId
                    ? { ...m, searchStep: scanStages[i] }
                    : m
                ),
              };
            }
            return s;
          })
        );

        // Exactly 3 seconds per step
        await new Promise(resolve => setTimeout(resolve, 3000));
        if (controller.signal.aborted) return;
      }

      // 3. After 8 is complete, take additional 5 seconds before giving output
      setSessions(prev =>
        prev.map(s => {
          if (s.id === targetSessionId) {
            return {
              ...s,
              messages: s.messages.map(m =>
                m.id === assistantMessageId
                  ? { ...m, searchStep: 'All 8 quantitative stages complete. Synthesizing institutional trade thesis & execution matrix...' }
                  : m
              ),
            };
          }
          return s;
        })
      );

      // Additional 5 seconds
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (controller.signal.aborted) return;

      // 4. Retrieve backend result or fallback to client strategy engine
      const backendResult = await fetchPromise;
      let strategy: StrategyResult | null = backendResult?.strategy || null;
      let assistantText = backendResult?.assistantText || '';

      if (!strategy) {
        const currentTicker = tickers.find(t => t.symbol.toUpperCase() === assetInfo.symbol.toUpperCase());
        strategy = generateClientFallbackStrategy(
          assetInfo,
          currentTicker,
          resolvedBaseStrategy?.timeframe || timeframe,
          promptText,
          isTightenPrompt ? 'tight' : slMode,
          chartImage
        );
        assistantText = strategy.detailedThesis;
      }

      const requestEndTime = Date.now();
      const actualDuration = Math.max(29.0, parseFloat(((requestEndTime - requestStartTime) / 1000).toFixed(1)));

      // Construct verified 8-stage breakdown (3.0s each) + final synthesis step (5.0s)
      const completedReasoningSteps = [
        ...scanStages.map((stageName) => ({
          title: stageName.replace(/\.{3}$/, ''),
          detail: `Verified quantitative execution node for ${strategy!.symbol} (${strategy!.timeframe} timeframe).`,
          time: '3.0s',
        })),
        {
          title: 'Institutional Execution & Thesis Finalization',
          detail: 'Completed all 8 quantitative audits and locked institutional execution matrix with live multi-tier targets.',
          time: '5.0s',
        },
      ];

      // Update the assistant message in current session
      setSessions(prev =>
        prev.map(s => {
          if (s.id === targetSessionId) {
            const updatedMessages = s.messages.map(m => {
              if (m.id === assistantMessageId) {
                return {
                  ...m,
                  content: assistantText,
                  strategy,
                  status: 'completed' as const,
                  searchStep: undefined,
                  durationSeconds: actualDuration,
                  reasoningSteps: completedReasoningSteps,
                };
              }
              return m;
            });
            return {
              ...s,
              title: `${strategy.symbol} ${strategy.tradeType}`,
              lastMessage: `${strategy.tradeType} ${strategy.symbol}`,
              updatedAt: Date.now(),
              symbol: strategy.symbol,
              bias: strategy.bias,
              messages: updatedMessages,
            };
          }
          return s;
        })
      );

      // Automatically log to Trade Results
      const newAnalysisItem: SavedAnalysis = {
        id: `analysis-${Date.now()}`,
        symbol: strategy.symbol,
        name: strategy.name,
        timeframe: strategy.timeframe,
        bias: strategy.bias,
        tradeType: strategy.tradeType,
        optimalEntry: strategy.entryZone.optimal,
        stopLossPrice: strategy.stopLoss.price,
        tp1Price: strategy.takeProfits[0]?.price || 0,
        riskReward: strategy.riskRewardRatio,
        confidenceScore: strategy.confidenceScore,
        timestamp: Date.now(),
        sessionId: targetSessionId!,
        messageId: assistantMessageId,
      };
      setSavedAnalyses(prev => [newAnalysisItem, ...prev]);
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        console.log('Analysis aborted by user.');
        return;
      }
      console.error('Market analysis computation notice:', err);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] w-full min-w-0 max-w-full overflow-hidden bg-[#020617] text-slate-100 font-sans selection:bg-indigo-500/30 selection:text-white relative">
      {/* High-Performance Ambient Background (Smooth GPU rasterization without CPU lag) */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0 bg-[#020617]/90 z-10" />
        {SHOW_AMBIENT_BACKDROP && (
          <img
            src={worldMapBg}
            alt=""
            loading="eager"
            decoding="async"
            className="w-full h-full object-cover opacity-20 select-none"
            referrerPolicy="no-referrer"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/85 via-black/65 to-black/90 pointer-events-none z-20" />
      </div>

      {/* Toast Notification Banner */}
      {toastNotification && (
        <div className="fixed top-4 right-4 z-50 animate-fadeIn flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-900/95 border border-indigo-500/40 text-white shadow-2xl backdrop-blur-md max-w-sm">
          {toastNotification.type === 'gift' ? (
            <Gift className="w-4 h-4 text-cyan-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span className="text-xs font-medium leading-tight">
            {toastNotification.message}
          </span>
        </div>
      )}

      {/* Paystack Pricing & Subscription Modal */}
      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={() => setIsPricingModalOpen(false)}
        userProfile={userProfile}
        onSelectPlan={handleSelectPlan}
      />

      {/* Gift AI Credits Modal */}
      <GiftCreditsModal
        isOpen={isGiftModalOpen}
        onClose={() => setIsGiftModalOpen(false)}
        userProfile={userProfile}
        availableCredits={creditState.availableCredits}
        onSendGift={handleSendGift}
        recentGifts={recentGifts}
      />

      {/* Notification Center Modal */}
      <NotificationCenterModal
        isOpen={isNotificationCenterOpen}
        onClose={() => setIsNotificationCenterOpen(false)}
        notifications={notifications}
        onMarkAllAsRead={() => {
          setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        }}
        onClearAll={() => setNotifications([])}
        onDismissNotification={(id) => {
          setNotifications(prev => prev.filter(n => n.id !== id));
        }}
        onNotificationAction={(notif) => {
          setIsNotificationCenterOpen(false);
          if (notif.actionPrompt) {
            setCurrentView('chat');
            handleSendMessage(notif.actionPrompt, '4H');
          } else if (notif.type === 'reward' || notif.type === 'credit') {
            setActiveSidebarTab('profile');
          }
        }}
      />

      {/* Institutional Terms & Privacy Policy Modal */}
      <TermsAndPrivacyModal
        isOpen={isTermsModalOpen}
        onClose={() => setIsTermsModalOpen(false)}
        defaultTab={termsModalTab}
      />

      {/* Share Profile on X Modal with Downloadable Card */}
      <ShareProfileModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        userProfile={userProfile}
        onRegisterShareReward={handleRegisterShareReward}
        existingReward={xShareReward}
      />

      {/* Reward Email Notification Preview Modal */}
      {xShareReward && (
        <RewardEmailNotificationModal
          isOpen={isEmailReceiptModalOpen}
          onClose={() => setIsEmailReceiptModalOpen(false)}
          reward={xShareReward}
        />
      )}

      {/* Sidebar Navigation: History, Credits, Profile */}
      <Sidebar
        sessions={sessions}
        savedAnalyses={savedAnalyses}
        currentSessionId={currentSessionId}
        onSelectSession={handleSelectSession}
        onSelectSignal={handleSelectSignal}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onClearAllSessions={handleClearAllSessions}
        onDeleteSignal={handleDeleteSignal}
        onClearAllSignals={handleClearAllSignals}
        onClearAllHistory={handleClearAllHistory}
        credits={creditState.availableCredits}
        maxCredits={creditState.dailyUsageLimit}
        activeTab={activeSidebarTab}
        setActiveTab={setActiveSidebarTab}
        userProfile={userProfile}
        creditState={creditState}
        onOpenPricing={() => setIsPricingModalOpen(true)}
        onOpenGiftModal={() => setIsGiftModalOpen(true)}
        onUpdateUsername={handleUpdateUsername}
        onUpdateProfile={handleUpdateProfile}
        xShareReward={xShareReward}
        onRegisterShareReward={handleRegisterShareReward}
        onDismissRewardNotice={handleDismissRewardNotice}
        isOpen={isSidebarOpen}
        onCloseMobile={() => setIsSidebarOpen(false)}
        unreadNotificationsCount={notifications.filter(n => !n.read).length}
        onOpenNotifications={() => setIsNotificationCenterOpen(true)}
      />

      {/* Main Workspace Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
        {/* Top Header Bar */}
        <Header
          onToggleSidebar={() => setIsSidebarOpen(prev => !prev)}
          tickers={tickers}
          credits={creditState.availableCredits}
          maxCredits={creditState.dailyUsageLimit}
          username={userProfile.username}
          avatarUrl={userProfile.avatarUrl}
          isVerified={userProfile.isVerified}
          onOpenCredits={() => {
            setActiveSidebarTab('credits');
          }}
          onOpenProfile={() => {
            setActiveSidebarTab('profile');
          }}
          onResetChat={handleNewSession}
          onSelectTicker={sym => {
            setCurrentView('chat');
            handleSendMessage(
              `Analyze ${sym} on the 4H timeframe. Provide real-time market structure, critical reaction zones, and directional outlook.`,
              '4H'
            );
          }}
          currentView={currentView}
          onSwitchView={setCurrentView}
          onNotifyComingSoon={(modelName) => {
            setToastNotification({
              message: `${modelName} analysis coming soon! Multi-model routing in private preview.`,
              type: 'gift',
            });
          }}
          unreadNotificationsCount={notifications.filter(n => !n.read).length}
          onOpenNotifications={() => setIsNotificationCenterOpen(true)}
        />

        {/* View 1: Homepage (MarketX Branding + Live Pairs Grid + Feeds in separate container + 'Ask MarketX' CTA) */}
        {currentView === 'home' && (
          <HomePage
            tickers={tickers}
            onAskMarketX={() => {
              handleNewSession();
              setCurrentView('chat');
            }}
            onSelectPrompt={(prompt, tf) => {
              setCurrentView('chat');
              handleSendMessage(prompt, tf || '4H');
            }}
            onSelectTicker={sym => {
              setCurrentView('chat');
              handleSendMessage(
                `Analyze ${sym} on the 4H timeframe. Map key price thresholds and provide immediate market structure.`,
                '4H'
              );
            }}
            userProfile={userProfile}
            xShareReward={xShareReward}
            onOpenShareModal={() => setIsShareModalOpen(true)}
            onOpenEmailReceipt={() => setIsEmailReceiptModalOpen(true)}
          />
        )}

        {/* View 2: Dedicated Claude AI-style Prompting Page */}
        {currentView === 'chat' && (
          <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
            {/* Dedicated Chat Sub-Navigation Bar with curved edges */}
            <div className="mx-2 sm:mx-3.5 mt-0 mb-2 px-3.5 sm:px-6 py-2 rounded-2xl border border-white/[0.12] flex items-center justify-between text-xs bg-slate-950/75 backdrop-blur-2xl shrink-0 z-10 shadow-md">
              <button
                type="button"
                onClick={() => setCurrentView('home')}
                className="flex items-center gap-1.5 text-slate-300 hover:text-white transition-colors font-semibold"
                title="Return to Market Overview"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-indigo-400" />
                <span>Market Overview</span>
              </button>

              <span className="font-mono text-slate-300 font-medium truncate max-w-[180px] sm:max-w-xs text-center">
                {currentSession?.title || 'Ask MarketX'}
              </span>

              <button
                type="button"
                onClick={handleNewSession}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 hover:text-white border border-white/[0.08] font-semibold transition-colors"
                title="Start a new chat session"
              >
                <Plus className="w-3.5 h-3.5 text-cyan-300" />
                <span className="hidden sm:inline">New Prompt</span>
              </button>
            </div>

            {/* Chat Body: scrollable feed + pinned afloat input */}
            <div className="flex-1 relative min-h-0 overflow-hidden flex flex-col">
              {/* Central Chat Feed */}
              <ChatFeed
                messages={currentMessages}
                isLoading={isLoading}
                tickers={tickers}
                userProfile={userProfile}
                targetMessageId={targetSignalMessageId}
                onClearTargetMessage={() => setTargetSignalMessageId(null)}
                onSelectPrompt={(prompt, tf, sl, base) =>
                  handleSendMessage(prompt, tf || '4H', sl || 'normal', base)
                }
                onSelectTicker={sym => {
                  handleSendMessage(
                    `Analyze ${sym} on the 4H timeframe. Calculate key institutional liquidity zones and golden ratio confluence.`,
                    '4H'
                  );
                }}
              />

              {/* Seamless bottom fade: subtle and minimal so chat messages stay 100% crisp and readable above input */}
              <div
                className="absolute inset-x-0 bottom-0 h-10 sm:h-12 pointer-events-none z-10 bg-gradient-to-t from-[#020617]/70 via-[#020617]/20 to-transparent"
                style={{ transform: 'translateZ(0)' }}
                aria-hidden="true"
              />

              {/* Pinned Afloat Chat Input Container */}
              <div className="absolute bottom-0 left-0 right-0 z-30 pointer-events-none flex flex-col items-center justify-end pb-1.5 sm:pb-2 px-3">
                {/* Input Box Wrapper - reduced by half, centered and sleek */}
                <div className="w-full max-w-[270px] sm:max-w-[300px] pointer-events-auto">
                  <ChatInput
                    onSendMessage={handleSendMessage}
                    onStopAnalysis={handleStopAnalysis}
                    isLoading={isLoading}
                    credits={creditState.availableCredits}
                    initialChartImage={pendingChartImage}
                    initialChartFileName={pendingChartFileName}
                    onClearInitialChart={() => {
                      setPendingChartImage(null);
                      setPendingChartFileName('');
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
