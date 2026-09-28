import React, { useState, useEffect, useCallback, useRef, Suspense, lazy } from 'react';
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
  ActivityStep,
} from './types';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { HomePage } from './components/HomePage';
import { ChatFeed } from './components/ChatFeed';
import { ChatInput } from './components/ChatInput';
import { preloadMarkdown } from './components/LazyMarkdown';

// Modals load on first open (smaller first download); once loaded they stay mounted
const PricingModal = lazy(() => import('./components/PricingModal').then(m => ({ default: m.PricingModal })));
const GiftCreditsModal = lazy(() => import('./components/GiftCreditsModal').then(m => ({ default: m.GiftCreditsModal })));
const NotificationCenterModal = lazy(() => import('./components/NotificationCenterModal').then(m => ({ default: m.NotificationCenterModal })));
const TermsAndPrivacyModal = lazy(() => import('./components/TermsAndPrivacyModal').then(m => ({ default: m.TermsAndPrivacyModal })));
const ShareProfileModal = lazy(() => import('./components/ShareProfileModal').then(m => ({ default: m.ShareProfileModal })));
const SupportChat = lazy(() => import('./components/SupportChat').then(m => ({ default: m.SupportChat })));
const RewardEmailNotificationModal = lazy(() =>
  import('./components/RewardEmailNotificationModal').then(m => ({ default: m.RewardEmailNotificationModal }))
);

/** Renders its children from the first time `when` is true, then keeps them mounted. */
const Deferred: React.FC<{ when: boolean; children: React.ReactNode }> = ({ when, children }) => {
  const [loaded, setLoaded] = useState(when);
  useEffect(() => {
    if (when) setLoaded(true);
  }, [when]);
  return loaded || when ? <Suspense fallback={null}>{children}</Suspense> : null;
};
import { AuthModal } from './components/AuthModal';
import { ChatUpdatesBar } from './components/ChatUpdatesBar';
import { PasscodePage } from './components/PasscodePage';
import { WelcomeGate } from './components/WelcomeGate';
import { SiteBanner } from './components/SiteBanner';
import { AnnouncementModal } from './components/AnnouncementModal';
import { MarketXIcon } from './components/MarketXIcon';
import { formatPriceShort } from './components/AiActivityTrace';
import {
  INITIAL_USER_PROFILE,
  INITIAL_CREDIT_STATE,
  isUnlimitedUser,
  setServerUnlimitedEmail,
} from './utils/creditManager';
import { getApiUrl } from './utils/api';
import { apiFetch, ApiError, formatMoney, loadPublicConfig, PaymentsPublicConfig } from './utils/apiClient';
import { extractAssetInfo } from './utils/localStrategyEngine';
import { ArrowLeft, Plus, CheckCircle2, Gift } from 'lucide-react';

interface AccountPayload {
  profile: UserProfile;
  credits: CreditState;
  xShareReward: XShareReward | null;
  recentGifts?: CreditGift[];
  unlimited?: boolean;
}

export default function App() {
  const [currentView, setCurrentView] = useState<'home' | 'chat'>('home');

  // Signed-in account; all account data below is loaded from and saved to the server
  // Session is an httpOnly cookie managed by the server; authUser mirrors "signed in as"
  const [authUser, setAuthUser] = useState<{ uid: string } | null>(null);
  const [authUnavailable, setAuthUnavailable] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'signup'>('signin');
  // Signed-out visitors see the welcome gate once the session check has finished
  const [authChecked, setAuthChecked] = useState(false);
  // Invite-only: new sign-ups land on /access to enter their emailed pass code
  const [onAccessPage, setOnAccessPage] = useState(() => typeof window !== 'undefined' && window.location.pathname === '/access');
  const [accessEmail, setAccessEmail] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const fromUrl = new URLSearchParams(window.location.search).get('email');
    if (fromUrl) return fromUrl;
    try {
      return sessionStorage.getItem('mx_access_email');
    } catch {
      return null;
    }
  });
  const [resetToken, setResetToken] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get('reset');
    } catch {
      return null;
    }
  });
  const [paymentsConfig, setPaymentsConfig] = useState<PaymentsPublicConfig | null>(null);

  const [userProfile, setUserProfile] = useState<UserProfile>(INITIAL_USER_PROFILE);
  const [xShareReward, setXShareReward] = useState<XShareReward | null>(null);
  const [creditState, setCreditState] = useState<CreditState>(INITIAL_CREDIT_STATE);
  const [recentGifts, setRecentGifts] = useState<CreditGift[]>([]);

  // Modals state
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [isGiftModalOpen, setIsGiftModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isEmailReceiptModalOpen, setIsEmailReceiptModalOpen] = useState(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);

  // Warm up the Markdown parser in idle time so answers render instantly, without slowing first paint
  useEffect(() => {
    const w = window as any;
    const run = () => preloadMarkdown();
    const id = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 6000 }) : setTimeout(run, 3500);
    return () => (w.cancelIdleCallback ? w.cancelIdleCallback(id) : clearTimeout(id));
  }, []);
  const [termsModalTab, setTermsModalTab] = useState<'terms' | 'privacy' | 'risk'>('terms');
  // Support chat (Settings → Support chat)
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  // Announcement from the MarketX team open in full
  const [openAnnouncement, setOpenAnnouncement] = useState<AppNotification | null>(null);
  const [supportUnread, setSupportUnread] = useState(0);
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
  const [toastNotification, setToastNotification] = useState<{ message: string; type: 'gift' | 'success' } | null>(null);

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [savedAnalyses, setSavedAnalyses] = useState<SavedAnalysis[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Server-sync bookkeeping: what the server already has, so only changes are uploaded
  const historyLoadedRef = useRef(false);
  const syncedSessionsRef = useRef<Map<string, ChatSession>>(new Map());
  const syncedAnalysesRef = useRef<SavedAnalysis[] | null>(null);

  const applyAccount = useCallback((data: AccountPayload) => {
    setUserProfile(data.profile);
    setCreditState(data.credits);
    setXShareReward(data.xShareReward || null);
    if (data.recentGifts) setRecentGifts(data.recentGifts);
    setServerUnlimitedEmail(data.unlimited ? data.profile.email : null);
  }, []);

  const refreshAccount = useCallback(async () => {
    try {
      applyAccount(await apiFetch<AccountPayload>('/api/account'));
    } catch {}
  }, [applyAccount]);

  const handleToggleEmailActivity = useCallback(
    (enabled: boolean) => {
      setUserProfile(prev => ({ ...prev, emailActivity: enabled }));
      apiFetch<AccountPayload>('/api/account/email-prefs', { method: 'PUT', body: JSON.stringify({ activity: enabled }) })
        .then(applyAccount)
        .catch(() => setUserProfile(prev => ({ ...prev, emailActivity: !enabled })));
    },
    [applyAccount]
  );

  // Background polls only fetch what is new since the latest item; opening the center does a full refresh
  const notificationsRef = useRef<AppNotification[]>([]);
  notificationsRef.current = notifications;
  const refreshNotifications = useCallback(async (incremental = false) => {
    try {
      const newest = notificationsRef.current.reduce((m, n) => Math.max(m, n.timestamp || 0), 0);
      if (incremental && newest > 0) {
        const data = await apiFetch<{ notifications: AppNotification[] }>(`/api/notifications?since=${newest}`);
        const fresh = data.notifications || [];
        if (fresh.length) {
          setNotifications(prev => {
            const ids = new Set(prev.map(n => n.id));
            return [...fresh.filter(n => !ids.has(n.id)), ...prev].slice(0, 80);
          });
        }
        return;
      }
      const data = await apiFetch<{ notifications: AppNotification[] }>('/api/notifications');
      setNotifications(data.notifications || []);
    } catch {}
  }, []);

  const resetToSignedOut = useCallback(() => {
    historyLoadedRef.current = false;
    syncedSessionsRef.current = new Map();
    syncedAnalysesRef.current = null;
    setUserProfile(INITIAL_USER_PROFILE);
    setCreditState(INITIAL_CREDIT_STATE);
    setXShareReward(null);
    setRecentGifts([]);
    setNotifications([]);
    setSessions([]);
    setSavedAnalyses([]);
    setCurrentSessionId(null);
    setServerUnlimitedEmail(null);
  }, []);

  // Load history & notifications for the signed-in account
  const handleAuthenticated = useCallback(
    async (account: AccountPayload) => {
      applyAccount(account);
      setAuthUser({ uid: account.profile.id });
      try {
        const [history, notif] = await Promise.all([
          apiFetch<{ sessions: ChatSession[]; analyses: SavedAnalysis[] }>('/api/history'),
          apiFetch<{ notifications: AppNotification[] }>('/api/notifications'),
        ]);
        syncedSessionsRef.current = new Map((history.sessions || []).map(sess => [sess.id, sess]));
        syncedAnalysesRef.current = history.analyses || [];
        historyLoadedRef.current = true;
        setSessions(history.sessions || []);
        setSavedAnalyses(history.analyses || []);
        setNotifications(notif.notifications || []);
        // Sign-in alerts are written just after the response; pick them up shortly after
        setTimeout(refreshNotifications, 2000);
      } catch (err: any) {
        setToastNotification({ message: err?.message || 'Could not load your history. Please refresh.', type: 'success' });
      }
    },
    [applyAccount, refreshNotifications]
  );

  // Startup: read public config, restore the cookie session, and handle email links (?verified / ?reset)
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    if (params.has('verified')) {
      setToastNotification({
        message: params.get('verified') === '1' ? '✅ Email verified. Thank you!' : 'That verification link is invalid or expired.',
        type: 'success',
      });
    }
    if (params.has('reset')) setIsAuthModalOpen(true);
    // "Open the conversation" link in support reply emails
    if (params.get('support') === '1') setIsSupportOpen(true);
    if (params.has('verified') || params.has('reset') || params.has('support')) {
      window.history.replaceState(null, '', window.location.pathname);
    }

    loadPublicConfig()
      .then(cfg => {
        if (cancelled) return;
        setPaymentsConfig(cfg.payments);
        setGoogleClientId(cfg.auth?.googleClientId || null);
        if (!cfg.auth?.enabled) {
          setAuthUnavailable('Sign-in is not available yet: accounts are not configured on this server.');
          return;
        }
        return apiFetch<AccountPayload>('/api/account')
          .then(account => !cancelled && handleAuthenticated(account))
          .catch(() => {}); // 401 = signed out
      })
      .catch(() => {
        if (!cancelled) setAuthUnavailable('Could not reach the MarketX server. Please check your connection and refresh.');
      })
      .finally(() => {
        if (!cancelled) setAuthChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, [handleAuthenticated]);

  // Browser back/forward between the app and the pass code page
  useEffect(() => {
    const onPop = () => setOnAccessPage(window.location.pathname === '/access');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // Signed-in users never need the pass code page
  useEffect(() => {
    if (authUser && onAccessPage) {
      window.history.replaceState(null, '', '/');
      setOnAccessPage(false);
    }
  }, [authUser, onAccessPage]);

  // Keep credits, rewards and gifts received in sync while the app is open
  useEffect(() => {
    if (!authUser) return;
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      refreshAccount();
      refreshNotifications(true);
    }, 60000);
    return () => clearInterval(interval);
  }, [authUser, refreshAccount, refreshNotifications]);

  // Opening the notification center always shows the full, up-to-date list (read states from other devices too)
  useEffect(() => {
    if (isNotificationCenterOpen && authUser) refreshNotifications();
  }, [isNotificationCenterOpen, authUser, refreshNotifications]);

  // Persist changed chat sessions to the server (debounced; in-flight analyses wait until done)
  useEffect(() => {
    if (!authUser || !historyLoadedRef.current) return;
    const timer = setTimeout(() => {
      const previous = syncedSessionsRef.current;
      const next = new Map<string, ChatSession>();
      for (const session of sessions) {
        const inFlight = session.messages.some(m => m.status === 'searching' || m.status === 'analyzing');
        if (inFlight || session.messages.length === 0) {
          const prior = previous.get(session.id);
          if (prior) next.set(session.id, prior);
          continue;
        }
        next.set(session.id, session);
        if (previous.get(session.id) !== session) {
          apiFetch(`/api/history/sessions/${encodeURIComponent(session.id)}`, {
            method: 'PUT',
            body: JSON.stringify(session),
          }).catch(err => console.warn('Session sync failed:', err?.message));
        }
      }
      for (const id of previous.keys()) {
        if (!sessions.some(sess => sess.id === id)) {
          apiFetch(`/api/history/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
        }
      }
      syncedSessionsRef.current = next;
    }, 1200);
    return () => clearTimeout(timer);
  }, [sessions, authUser]);

  // Persist saved trade setups to the server (debounced)
  useEffect(() => {
    if (!authUser || !historyLoadedRef.current || syncedAnalysesRef.current === savedAnalyses) return;
    const timer = setTimeout(() => {
      syncedAnalysesRef.current = savedAnalyses;
      apiFetch('/api/history/analyses', {
        method: 'PUT',
        body: JSON.stringify({ analyses: savedAnalyses }),
      }).catch(err => console.warn('Setup sync failed:', err?.message));
    }, 1200);
    return () => clearTimeout(timer);
  }, [savedAnalyses, authUser]);

  const [tickersLive, setTickersLive] = useState(false);
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

  // Live market prices: a server-sent stream pushes every price change as it happens (about once a second).
  // If the stream can't connect, prices are fetched live every 3s instead. Paused while the tab is hidden.
  useEffect(() => {
    let isMounted = true;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let streamFailures = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const mergeFull = (incoming: MarketQuote[]) =>
      setTickers(prev => {
        let hasChanged = prev.length !== incoming.length;
        for (let i = 0; !hasChanged && i < incoming.length; i++) {
          const existing = prev.find(p => p.symbol === incoming[i].symbol);
          if (!existing || existing.price !== incoming[i].price || existing.change24h !== incoming[i].change24h || existing.live !== incoming[i].live) {
            hasChanged = true;
          }
        }
        if (!hasChanged) return prev;
        return incoming.map((t: MarketQuote) => {
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

    // Stream rows: [symbol, price, change24h, high24h, low24h, live, asOf]
    const mergeRows = (rows: unknown[]) =>
      setTickers(prev => {
        const bySymbol = new Map<string, any[]>();
        for (const r of rows) if (Array.isArray(r) && typeof r[0] === 'string') bySymbol.set(r[0], r);
        let changed = false;
        const next = prev.map(t => {
          const r = bySymbol.get(t.symbol);
          if (!r) return t;
          const price = Number(r[1]);
          if (!Number.isFinite(price) || price <= 0) return t;
          changed = true;
          return {
            ...t,
            price,
            change24h: Number.isFinite(Number(r[2])) ? Number(r[2]) : t.change24h,
            high24h: Number.isFinite(Number(r[3])) ? Number(r[3]) : t.high24h,
            low24h: Number.isFinite(Number(r[4])) ? Number(r[4]) : t.low24h,
            live: r[5] === 1,
            asOf: Number(r[6]) || t.asOf,
          };
        });
        return changed ? next : prev;
      });

    const fetchLatestTickers = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch(getApiUrl('/api/market/tickers'), { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && Array.isArray(data.tickers) && data.tickers.length > 0 && isMounted) {
          setTickersLive(true);
          mergeFull(data.tickers);
        }
      } catch (err) {
        console.warn('Ticker sync error:', err);
      }
    };

    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    };
    const startPolling = () => {
      if (pollTimer) return;
      fetchLatestTickers();
      pollTimer = setInterval(fetchLatestTickers, 3000);
    };

    const closeStream = () => {
      source?.close();
      source = null;
    };
    const openStream = () => {
      if (source || typeof EventSource === 'undefined' || streamFailures >= 3) {
        startPolling();
        return;
      }
      source = new EventSource(getApiUrl('/api/market/stream'));
      source.addEventListener('snapshot', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          if (isMounted && Array.isArray(data?.tickers) && data.tickers.length > 0) {
            streamFailures = 0;
            stopPolling();
            setTickersLive(true);
            mergeFull(data.tickers);
          }
        } catch {}
      });
      source.addEventListener('prices', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          if (isMounted && Array.isArray(data?.rows)) mergeRows(data.rows);
        } catch {}
      });
      source.onerror = () => {
        // The browser retries on its own; meanwhile fetch once so prices never stall. After repeated failures
        // (e.g. the stream is full), poll instead
        fetchLatestTickers();
        if (source?.readyState === EventSource.CLOSED || ++streamFailures >= 3) {
          closeStream();
          startPolling();
          // Try the stream again in a minute
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(() => {
            retryTimer = null;
            if (!isMounted || document.hidden) return;
            streamFailures = 0;
            stopPolling();
            openStream();
          }, 60_000);
        }
      };
    };

    const onVisibility = () => {
      if (document.hidden) {
        closeStream();
        stopPolling();
      } else {
        streamFailures = 0;
        openStream();
      }
    };

    if (typeof document === 'undefined' || !document.hidden) openStream();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', onVisibility);
      closeStream();
      stopPolling();
      if (retryTimer) clearTimeout(retryTimer);
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
                    durationSeconds: parseFloat(((Date.now() - m.timestamp) / 1000).toFixed(1)),
                    activity: (m.activity || []).map(st =>
                      st.status === 'active' ? { ...st, status: 'stopped' as const, endedAt: Date.now() } : st
                    ),
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

  const handleSignOut = useCallback(async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setAuthUser(null);
    resetToSignedOut();
    setActiveSidebarTab('history');
    setToastNotification({ message: 'Signed out', type: 'success' });
  }, [resetToSignedOut]);

  // Credits / Profile pop-ups need an account; prompt sign-in otherwise
  const openAccountTab = useCallback(
    (tab: 'history' | 'credits' | 'profile') => {
      if (tab !== 'history' && !authUser) {
        setIsAuthModalOpen(true);
        return;
      }
      setActiveSidebarTab(tab);
    },
    [authUser]
  );

  // X share campaign: the server records the share and times the 10-hour unlock
  const handleRegisterShareReward = useCallback(
    async (): Promise<string | null> => {
      try {
        applyAccount(await apiFetch<AccountPayload>('/api/rewards/x-share', { method: 'POST', body: '{}' }));
        setToastNotification({ message: '🚀 Thanks for sharing! 10 credits unlock in 10 hours.', type: 'success' });
        return null;
      } catch (err: any) {
        // Already claimed: reload the account so the campaign shows as completed everywhere
        if (err?.status === 409 || /already/i.test(String(err?.message || ''))) refreshAccount().catch(() => {});
        return err?.message || 'Could not submit your post. Please try again.';
      }
    },
    [applyAccount, refreshAccount]
  );

  const handleDismissRewardNotice = useCallback(() => {
    setXShareReward(prev => (prev ? { ...prev, notifiedOnSite: false } : null));
  }, []);

  // Dismiss toast notification after 5s
  useEffect(() => {
    if (toastNotification) {
      const timer = setTimeout(() => setToastNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toastNotification]);

  // Called by the pricing modal after the server has verified the Paystack payment
  const handlePaymentVerified = (account: AccountPayload, plan: 'monthly' | 'yearly') => {
    applyAccount(account);
    refreshNotifications();
    setToastNotification({
      message: `🎉 Pro ${plan === 'yearly' ? 'Yearly' : 'Monthly'} activated. Payment verified by Paystack.`,
      type: 'success',
    });
  };

  // Gift credits to another user (server moves the balance atomically)
  const handleSendGift = async (toUsername: string, amount: number, note?: string): Promise<string | null> => {
    try {
      const data = await apiFetch<AccountPayload>('/api/credits/gift', {
        method: 'POST',
        body: JSON.stringify({ toUsername, amount, note }),
      });
      applyAccount(data);
      setToastNotification({
        message: `🎁 Successfully gifted ${amount} AI Credits to @${toUsername.replace(/^@/, '')}!`,
        type: 'gift',
      });
      return null;
    } catch (err: any) {
      return err?.message || 'Gift failed. Please try again.';
    }
  };

  // Profile updates (display name, unique username, avatar) are validated server-side
  const handleUpdateProfile = async (updated: { displayName: string; username: string; avatarUrl?: string }): Promise<string | null> => {
    try {
      applyAccount(await apiFetch<AccountPayload>('/api/account/profile', { method: 'PUT', body: JSON.stringify(updated) }));
      setToastNotification({ message: 'Profile updated successfully!', type: 'success' });
      return null;
    } catch (err: any) {
      return err?.message || 'Could not update your profile.';
    }
  };

  const handleUpdateUsername = (newUsername: string) => {
    handleUpdateProfile({
      displayName: userProfile.displayName,
      username: newUsername,
      avatarUrl: userProfile.avatarUrl,
    }).then(err => err && setToastNotification({ message: err, type: 'success' }));
  };

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
      return updated;
    });
    // Also remove associated savedAnalyses that belong to this session
    setSavedAnalyses(prev => {
      const updated = prev.filter(a => a.sessionId !== id);
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
    syncedSessionsRef.current = new Map();
    if (authUser) apiFetch('/api/history/sessions', { method: 'DELETE' }).catch(() => {});
    setSessions([]);
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
    setToastNotification({
      message: 'All trade setups cleared',
      type: 'success',
    });
  };

  // Clear all history at once (sessions + saved setups)
  const handleClearAllHistory = () => {
    syncedSessionsRef.current = new Map();
    if (authUser) apiFetch('/api/history/sessions', { method: 'DELETE' }).catch(() => {});
    setSessions([]);
    setSavedAnalyses([]);
    setCurrentSessionId(null);
    setToastNotification({
      message: 'All history records cleared',
      type: 'success',
    });
  };

  // Updates bar: mark a single notification read (locally + server)
  const markNotificationRead = useCallback(
    (id: string) => {
      setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
      if (authUser) apiFetch(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }).catch(() => {});
    },
    [authUser]
  );

  // A support link (e.g. from the Site Guide or a reply email) opened while signed out: ask to sign in first,
  // the chat opens as soon as the session exists
  useEffect(() => {
    if (authChecked && !authUser && isSupportOpen) {
      setAuthModalMode('signin');
      setIsAuthModalOpen(true);
    }
  }, [authChecked, authUser, isSupportOpen]);

  // Support chat unread badge: a light check on sign-in, then every 90s while the tab is visible
  useEffect(() => {
    if (!authUser) {
      setSupportUnread(0);
      return;
    }
    const check = () => {
      if (document.hidden) return;
      apiFetch<{ unread: number }>('/api/support/unread')
        .then(d => setSupportUnread(Number(d?.unread) || 0))
        .catch(() => {});
    };
    check();
    const id = setInterval(check, 90_000);
    return () => clearInterval(id);
  }, [authUser]);

  // A new announcement pops up once (newest unread, sent in the last 7 days); afterwards it lives in notifications
  useEffect(() => {
    if (!authUser || openAnnouncement) return;
    const fresh = notifications
      .filter(n => n.type === 'announcement' && !n.read && Date.now() - n.timestamp < 7 * 24 * 3600e3)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!fresh) return;
    let shown: string[] = [];
    try {
      shown = JSON.parse(localStorage.getItem('mx_announcements_shown') || '[]');
    } catch {}
    if (shown.includes(fresh.id)) return;
    try {
      localStorage.setItem('mx_announcements_shown', JSON.stringify([...shown, fresh.id].slice(-30)));
    } catch {}
    setOpenAnnouncement(fresh);
  }, [notifications, authUser, openAnnouncement]);

  const handleUpdateNotificationAction = (notif: AppNotification) => {
    markNotificationRead(notif.id);
    if (notif.type === 'announcement') {
      setOpenAnnouncement(notif);
    } else if (notif.actionPrompt) {
      handleSendMessage(notif.actionPrompt, '4H');
    } else if (notif.actionType === 'open_support') {
      setIsSupportOpen(true);
    } else if (notif.actionType === 'open_campaign') {
      setIsShareModalOpen(true);
    } else if (notif.type === 'reward' || notif.type === 'credit') {
      openAccountTab('credits');
    } else {
      setIsNotificationCenterOpen(true);
    }
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

    // Analyses run on the server against the signed-in account's credits
    if (!authUser) {
      setIsAuthModalOpen(true);
      return;
    }

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

    // A setup is only ever passed by the "Tighten SL" actions on a result, so a setup plus tight mode (or
    // tightening words) means: keep this exact setup and tighten its stop. The words "setup"/"analyze" in the
    // button's own prompt must not turn it into a brand-new analysis.
    const isTightenPrompt = Boolean(
      baseStrategy && (slMode === 'tight' || hasTightenKeywords) && (baseStrategy.tradeType === 'LONG' || baseStrategy.tradeType === 'SHORT')
    );
    const resolvedBaseStrategy = isTightenPrompt ? baseStrategy : undefined;

    // Quick client-side check; the server enforces and deducts credits authoritatively
    const isUnlimited = isUnlimitedUser(userProfile.email);
    if (!isUnlimited && creditState.dailyUsageRemaining <= 0 && creditState.availableCredits <= 0) {
      setIsPricingModalOpen(true);
      return;
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
      activity: [],
      searchStep: resolvedBaseStrategy
        ? `Anchoring to verified ${resolvedBaseStrategy.symbol} setup...`
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

    const updateAssistant = (patch: Partial<ChatMessage>, sessionPatch?: Partial<ChatSession>) => {
      setSessions(prev =>
        prev.map(s =>
          s.id === targetSessionId
            ? {
                ...s,
                ...(sessionPatch || {}),
                messages: s.messages.map(m => (m.id === assistantMessageId ? { ...m, ...patch } : m)),
              }
            : s
        )
      );
    };

    // Live activity trace: each step is recorded when the work actually starts and finishes
    let activity: ActivityStep[] = [];
    const publishActivity = () => {
      if (controller.signal.aborted) return;
      const snapshot = activity.slice();
      updateAssistant({ activity: snapshot, searchStep: snapshot.filter(st => st.status === 'active').pop()?.title });
    };
    const startStep = (id: string, title: string, detail?: string) => {
      activity = [...activity, { id, title, detail, status: 'active', startedAt: Date.now() }];
      publishActivity();
    };
    const endStep = (id: string, patch: Partial<ActivityStep> = {}) => {
      activity = activity.map(st => (st.id === id && st.status === 'active' ? { ...st, status: 'done', endedAt: Date.now(), ...patch } : st));
      publishActivity();
    };
    const addDoneStep = (id: string, title: string, detail?: string) => {
      const t = Date.now();
      activity = [...activity, { id, title, detail, status: 'done', startedAt: t, endedAt: t }];
      publishActivity();
    };

    const looksLikeAnalysis =
      Boolean(chartImage) ||
      hasNewAnalysisDirectives ||
      /\b(eur|gbp|usd|aud|nzd|cad|chf|jpy|xau|xag|gold|silver|oil|btc|bitcoin|eth|ethereum|sol|solana|xrp|bnb|doge|sui|link|nvda|tsla|aapl|googl|volatility|boom|crash|nasdaq|us30|spx)\b/i.test(promptText);
    const analysisTimeframe = resolvedBaseStrategy?.timeframe || timeframe;

    // Step: understand the request (done on this device, instantly)
    if (resolvedBaseStrategy) {
      addDoneStep(
        'read',
        'Loaded your previous setup',
        `${resolvedBaseStrategy.symbol} ${resolvedBaseStrategy.tradeType} · entry ${formatPriceShort(resolvedBaseStrategy.entryZone.optimal)}`
      );
    } else if (looksLikeAnalysis) {
      addDoneStep('read', 'Understood your request', `${assetInfo.name} (${assetInfo.symbol}) · ${analysisTimeframe} timeframe`);
    } else {
      addDoneStep('read', 'Understood your question', 'General trading question');
    }
    if (chartImage) {
      addDoneStep('chart', 'Attached your chart', `${chartFileName || 'Chart image'} · ${Math.max(1, Math.round((chartImage.length * 0.75) / 1024))} KB`);
    }

    // Step: live price check, running alongside the analysis
    if (looksLikeAnalysis && !resolvedBaseStrategy) {
      startStep('price', `Checking the live ${assetInfo.symbol} price`);
      fetch(getApiUrl(`/api/market/quote/${encodeURIComponent(assetInfo.symbol)}`), { signal: controller.signal })
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
          const q = data?.quote;
          if (q && Number(q.price) > 0) {
            const ch = Number(q.change24h) || 0;
            endStep('price', { detail: `${formatPriceShort(Number(q.price))} · ${ch >= 0 ? '+' : ''}${ch.toFixed(2)}% today` });
          } else {
            endStep('price', { status: 'error', detail: 'Live price unavailable right now' });
          }
        })
        .catch(() => endStep('price', { status: 'error', detail: 'Live price unavailable right now' }));
    }

    // Step: today's fundamentals, checked live by the server alongside the analysis
    if (looksLikeAnalysis || resolvedBaseStrategy) {
      const newsSymbol = resolvedBaseStrategy?.symbol || assetInfo.symbol;
      startStep('news', `Checking today's news for ${newsSymbol}`, 'Economic calendar and live market wires, for today only');
    }

    startStep(
      'analyze',
      resolvedBaseStrategy
        ? `Tightening the ${resolvedBaseStrategy.symbol} stop loss`
        : looksLikeAnalysis
          ? `Analyzing ${assetInfo.symbol} on ${analysisTimeframe}`
          : 'Thinking',
      resolvedBaseStrategy
        ? 'Recalculating the invalidation level and risk/reward'
        : looksLikeAnalysis
          ? chartImage
            ? 'Reading your chart, market structure and key zones'
            : 'Market structure, key levels, entry, stop and targets'
          : 'Working out the answer'
    );

    try {
      // 1. Real backend request (authenticated; the server charges one credit and refunds on failure)
      type BackendResult =
        | { kind: 'strategy'; strategy: StrategyResult; text: string }
        | { kind: 'chat'; text: string }
        | { kind: 'error'; status: number; code: string; message: string };

      const fetchPromise: Promise<BackendResult | null> = apiFetch<any>('/api/market/analyze', {
        method: 'POST',
        body: JSON.stringify({
          prompt: promptText,
          symbol: assetInfo.symbol,
          timeframe: resolvedBaseStrategy?.timeframe || timeframe,
          slMode: isTightenPrompt ? 'tight' : slMode,
          baseStrategy: resolvedBaseStrategy,
          action: isTightenPrompt ? 'tighten_sl' : undefined,
          chartImage,
          // Decides which calendar day "today's news" belongs to
          timeZone: (() => {
            try {
              return Intl.DateTimeFormat().resolvedOptions().timeZone;
            } catch {
              return undefined;
            }
          })(),
        }),
        signal: controller.signal,
      })
        .then((data): BackendResult => {
          if (data?.strategy) {
            return {
              kind: 'strategy',
              strategy: data.strategy as StrategyResult,
              text: (data.content || data.message || data.strategy.detailedThesis) as string,
            };
          }
          const text = data?.content || data?.message;
          if (text) return { kind: 'chat', text };
          return { kind: 'error', status: 500, code: 'EMPTY', message: 'The analysis engine returned no result. Please try again.' };
        })
        .catch((err: any): BackendResult | null => {
          if (err?.name === 'AbortError' || controller.signal.aborted) return null;
          if (err instanceof ApiError) return { kind: 'error', status: err.status, code: err.code, message: err.message };
          return { kind: 'error', status: 0, code: 'NETWORK', message: 'Could not reach the MarketX server. Check your connection and try again.' };
        });

      const result = await fetchPromise;
      if (!result || controller.signal.aborted) return;
      const requestEndTime = Date.now();
      const actualDuration = parseFloat(((requestEndTime - requestStartTime) / 1000).toFixed(1));
      if (result.kind === 'error') {
        endStep('analyze', { status: 'error', detail: result.message });
      } else {
        endStep('analyze');
      }
      // A price check still in flight is no longer needed; the news step is settled from the result below
      activity = activity.map(st =>
        st.status === 'active' && st.id !== 'news'
          ? { ...st, status: 'stopped', endedAt: requestEndTime, detail: 'Not needed, the analysis finished first' }
          : st
      );
      if (result.kind === 'chat') {
        activity = activity.filter(st => st.id !== 'news'); // a plain answer has no market news
      } else if (result.kind === 'error') {
        activity = activity.map(st =>
          st.id === 'news' && st.status === 'active' ? { ...st, status: 'stopped', endedAt: requestEndTime, detail: 'Skipped, the analysis did not finish' } : st
        );
      }

      if (result.kind === 'error') {
        if (result.status === 402) setIsPricingModalOpen(true);
        if (result.status === 401) setIsAuthModalOpen(true);
        updateAssistant({
          content: `⚠️ ${result.message}`,
          status: 'completed',
          searchStep: undefined,
          durationSeconds: actualDuration,
          activity,
        });
        refreshAccount();
        return;
      }

      if (result.kind === 'chat') {
        const words = result.text.trim().split(/\s+/).length;
        addDoneStep('answer', 'Wrote the answer', `${words} words`);
        updateAssistant(
          { content: result.text, status: 'completed', searchStep: undefined, durationSeconds: actualDuration, activity },
          { lastMessage: promptText, updatedAt: Date.now() }
        );
        refreshAccount();
        return;
      }

      const strategy = result.strategy;
      if (strategy.timeframe && !resolvedBaseStrategy) {
        activity = activity.map(st =>
          st.id === 'analyze' ? { ...st, title: `Analyzed ${strategy.symbol} on ${strategy.timeframe}` } : st
        );
      }
      // Today's news: what the server found for this asset on the reader's day
      const brief = strategy.newsBrief && Date.now() < strategy.newsBrief.expiresAt ? strategy.newsBrief : null;
      const newsCount = brief ? brief.events.length + brief.headlines.length : 0;
      const localTime = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      const newsDetail = (b: NonNullable<typeof brief>) => {
        const now = Date.now();
        const next = b.events.find(e => e.impact === 'HIGH' && e.at != null && e.at > now);
        const released = b.events.filter(e => e.impact === 'HIGH' && e.at != null && e.at <= now).length;
        const holidays = b.events.filter(e => e.impact === 'HOLIDAY');
        return [
          next ? `Next: ${next.title} (${next.currency}) at ${localTime(next.at!)}` : '',
          released ? `${released} released today` : '',
          holidays.length ? holidays.map(h => `${h.currency} bank holiday`).join(', ') : '',
          b.headlines.length ? `${b.headlines.length} headline${b.headlines.length === 1 ? '' : 's'}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
      };
      const newsPatch: Partial<ActivityStep> = brief
        ? {
            title: `Found ${newsCount} news item${newsCount === 1 ? '' : 's'} for today`,
            detail: newsDetail(brief),
            tokenWeight: 1 + Math.min(8, newsCount) * 0.35,
          }
        : {
            title: "Checked today's news",
            detail: `Nothing on today's calendar or wires that could move ${strategy.symbol}`,
            tokenWeight: 0.6,
          };
      if (activity.some(st => st.id === 'news')) {
        activity = activity.map(st => (st.id === 'news' ? { ...st, status: 'done' as const, endedAt: st.endedAt ?? requestEndTime, ...newsPatch } : st));
      } else {
        addDoneStep('news', newsPatch.title!, newsPatch.detail);
        activity = activity.map(st => (st.id === 'news' ? { ...st, tokenWeight: newsPatch.tokenWeight } : st));
      }
      const tp1 = strategy.takeProfits?.[0]?.price;
      addDoneStep(
        'plan',
        `Built the ${strategy.tradeType} plan`,
        [
          `Entry ${formatPriceShort(strategy.entryZone.optimal)}`,
          `Stop ${formatPriceShort(strategy.stopLoss.price)}`,
          tp1 ? `Target ${formatPriceShort(tp1)}` : '',
          strategy.riskRewardRatio ? `R:R ${strategy.riskRewardRatio}` : '',
        ]
          .filter(Boolean)
          .join(' · ')
      );

      updateAssistant(
        {
          content: result.text,
          strategy,
          status: 'completed',
          searchStep: undefined,
          durationSeconds: actualDuration,
          activity,
        },
        {
          title: `${strategy.symbol} ${strategy.tradeType}`,
          lastMessage: `${strategy.tradeType} ${strategy.symbol}`,
          updatedAt: Date.now(),
          symbol: strategy.symbol,
          bias: strategy.bias,
        }
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
      refreshAccount();
    } catch (err: any) {
      if (err.name === 'AbortError' || controller.signal.aborted) {
        console.log('Analysis aborted by user.');
        return;
      }
      console.error('Market analysis computation notice:', err);
      activity = activity.map(st => (st.status === 'active' ? { ...st, status: 'error', endedAt: Date.now() } : st));
      updateAssistant({ content: '⚠️ Something went wrong. Please try again.', status: 'completed', searchStep: undefined, activity });
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsLoading(false);
      // The server records the analysis notification right after responding
      setTimeout(refreshNotifications, 1500);
    }
  };

  // --- Invite-only access flow -------------------------------------------------
  const goToAccessPage = (email?: string | null) => {
    if (email) {
      setAccessEmail(email);
      try {
        sessionStorage.setItem('mx_access_email', email);
      } catch {}
    }
    window.history.pushState(null, '', `/access${email ? `?email=${encodeURIComponent(email)}` : ''}`);
    setOnAccessPage(true);
  };
  const leaveAccessPage = () => {
    window.history.replaceState(null, '', '/');
    setOnAccessPage(false);
  };

  const authModal = (
    <AuthModal
      isOpen={isAuthModalOpen}
      onClose={() => {
        setIsAuthModalOpen(false);
        setResetToken(null);
      }}
      onAuthenticated={handleAuthenticated}
      onPending={email => goToAccessPage(email)}
      initialMode={authModalMode}
      googleClientId={googleClientId}
      resetToken={resetToken}
      unavailableReason={authUnavailable}
    />
  );

  const toastBanner = toastNotification && (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] mx-pop-in flex items-center gap-2.5 pl-3 pr-4 py-2.5 rounded-full bg-[var(--mx-surface-2)] border border-white/[0.1] text-white shadow-[0_12px_40px_-12px_var(--mx-shadow)] max-w-[92vw] sm:max-w-md">
      {toastNotification.type === 'gift' ? <Gift className="w-4 h-4 text-cyan-400 shrink-0" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
      <span className="text-xs font-medium leading-tight">{toastNotification.message}</span>
    </div>
  );

  if (!authUser) {
    if (onAccessPage) {
      return (
        <>
          {toastBanner}
          <PasscodePage
            initialEmail={accessEmail}
            onBack={leaveAccessPage}
            onGranted={account => {
              try {
                sessionStorage.removeItem('mx_access_email');
              } catch {}
              leaveAccessPage();
              handleAuthenticated(account);
              setToastNotification({ message: 'Access granted. Welcome to MarketX!', type: 'success' });
            }}
          />
        </>
      );
    }
    return (
      <>
        {toastBanner}
        <SiteBanner />
        {authChecked ? (
          <WelcomeGate
            notice={authUnavailable}
            onSignUp={() => {
              setAuthModalMode('signup');
              setIsAuthModalOpen(true);
            }}
            onSignIn={() => {
              setAuthModalMode('signin');
              setIsAuthModalOpen(true);
            }}
            onHaveCode={() => goToAccessPage(accessEmail)}
          />
        ) : (
          <div className="mx-backdrop min-h-[100dvh] flex items-center justify-center" aria-busy="true">
            <span className="mx-shimmer">
              <MarketXIcon size="lg" />
            </span>
          </div>
        )}
        {authModal}
      </>
    );
  }

  return (
    <div className="mx-backdrop mx-safe-shell flex h-[100dvh] min-h-[100dvh] w-full min-w-0 max-w-full overflow-hidden text-slate-100 font-sans relative">
      {/* Toast Notification Banner */}
      {toastBanner}

      {/* Paystack Pricing & Subscription Modal */}
      <Deferred when={isPricingModalOpen}>
      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={() => setIsPricingModalOpen(false)}
        userProfile={userProfile}
        paymentsConfig={paymentsConfig}
        onPaymentVerified={handlePaymentVerified}
      />
      </Deferred>

      {/* Sign in / Create account (server-side auth; Google via Google Identity Services) */}
      {authModal}

      {/* Gift AI Credits Modal */}
      <Deferred when={isGiftModalOpen}>
      <GiftCreditsModal
        isOpen={isGiftModalOpen}
        onClose={() => setIsGiftModalOpen(false)}
        userProfile={userProfile}
        availableCredits={creditState.availableCredits}
        onSendGift={handleSendGift}
        recentGifts={recentGifts}
      />
      </Deferred>

      {/* Announcement from the MarketX team (pop-up for new ones, or opened from notifications) */}
      <AnnouncementModal
        announcement={openAnnouncement}
        onClose={() => {
          if (openAnnouncement && !openAnnouncement.read) markNotificationRead(openAnnouncement.id);
          setOpenAnnouncement(null);
        }}
      />

      {/* Notification Center Modal */}
      <Deferred when={isNotificationCenterOpen}>
      <NotificationCenterModal
        isOpen={isNotificationCenterOpen}
        onClose={() => setIsNotificationCenterOpen(false)}
        notifications={notifications}
        onMarkAllAsRead={() => {
          setNotifications(prev => prev.map(n => ({ ...n, read: true })));
          if (authUser) apiFetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
        }}
        onClearAll={() => {
          setNotifications([]);
          if (authUser) apiFetch('/api/notifications', { method: 'DELETE' }).catch(() => {});
        }}
        onDismissNotification={(id) => {
          setNotifications(prev => prev.filter(n => n.id !== id));
          if (authUser) apiFetch(`/api/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
        }}
        onMarkRead={markNotificationRead}
        onOpenAnnouncement={notif => setOpenAnnouncement(notif)}
        onNotificationAction={(notif) => {
          setIsNotificationCenterOpen(false);
          if (notif.actionPrompt) {
            setCurrentView('chat');
            handleSendMessage(notif.actionPrompt, '4H');
          } else if (notif.actionType === 'open_pricing') {
            setIsPricingModalOpen(true);
          } else if (notif.actionType === 'open_support') {
            setIsSupportOpen(true);
          } else if (notif.actionType === 'open_campaign') {
            setIsShareModalOpen(true);
          } else if (notif.type === 'reward' || notif.type === 'credit') {
            openAccountTab('credits');
          } else {
            openAccountTab('profile');
          }
        }}
        emailActivity={userProfile.emailActivity !== false}
        onToggleEmailActivity={authUser ? handleToggleEmailActivity : undefined}
      />
      </Deferred>

      {/* Institutional Terms & Privacy Policy Modal */}
      {/* Support chat (Settings → Support chat) */}
      <Deferred when={isSupportOpen && !!authUser}>
        <SupportChat
          isOpen={isSupportOpen && !!authUser}
          onClose={() => setIsSupportOpen(false)}
          displayName={userProfile.displayName}
          onRead={() => setSupportUnread(0)}
        />
      </Deferred>

      <Deferred when={isTermsModalOpen}>
        <TermsAndPrivacyModal isOpen={isTermsModalOpen} onClose={() => setIsTermsModalOpen(false)} defaultTab={termsModalTab} />
      </Deferred>

      {/* Share Profile on X Modal with Downloadable Card */}
      <Deferred when={isShareModalOpen}>
      <ShareProfileModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        userProfile={userProfile}
        onRegisterShareReward={handleRegisterShareReward}
        existingReward={xShareReward}
      />
      </Deferred>

      {/* Reward Email Notification Preview Modal */}
      {xShareReward && isEmailReceiptModalOpen && (
        <Suspense fallback={null}>
        <RewardEmailNotificationModal
          isOpen={isEmailReceiptModalOpen}
          onClose={() => setIsEmailReceiptModalOpen(false)}
          reward={xShareReward}
        />
        </Suspense>
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
        setActiveTab={openAccountTab}
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
        isSignedIn={!!authUser}
        onSignIn={() => setIsAuthModalOpen(true)}
        onSignOut={handleSignOut}
        onOpenSupport={() => setIsSupportOpen(true)}
        supportUnread={supportUnread}
        onOpenTerms={() => {
          setTermsModalTab('terms');
          setIsTermsModalOpen(true);
        }}
      />

      {/* Main Workspace Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
        <SiteBanner />
        {/* Top Header Bar */}
        <Header
          onToggleSidebar={() => setIsSidebarOpen(prev => !prev)}
          tickers={tickers}
          credits={creditState.availableCredits}
          maxCredits={creditState.dailyUsageLimit}
          username={userProfile.username}
          avatarUrl={userProfile.avatarUrl}
          isVerified={userProfile.isVerified}
          onOpenCredits={() => openAccountTab('credits')}
          onOpenProfile={() => openAccountTab('profile')}
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
              message: `${modelName} is coming to MarketX soon. Multi-model routing is in private preview.`,
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
            onOpenSupport={() => {
              // Signed-out visitors sign in first; the chat opens as soon as they are in
              setIsSupportOpen(true);
              if (!authUser) setIsAuthModalOpen(true);
            }}
            supportUnread={supportUnread}
          />
        )}

        {/* View 2: Dedicated Claude AI-style Prompting Page */}
        {currentView === 'chat' && (
          <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
            {/* Chat title row */}
            <div className="px-3 sm:px-6 h-11 flex items-center justify-between gap-3 text-sm shrink-0">
              <button
                type="button"
                onClick={() => setCurrentView('home')}
                className="group flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors"
                title="Back to markets"
              >
                <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
                <span className="hidden sm:inline">Markets</span>
              </button>

              <span className="text-slate-300 font-medium truncate max-w-[55%] text-center text-[13px]">
                {currentSession?.title || 'New chat'}
              </span>

              <button
                type="button"
                onClick={handleNewSession}
                className="flex items-center gap-1.5 h-8 px-3 rounded-full text-slate-300 hover:text-white hover:bg-white/[0.06] transition-colors"
                title="Start a new chat"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline text-[13px]">New chat</span>
              </button>
            </div>

            {/* Chat body: scrollable feed with the composer docked below it */}
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 relative flex flex-col">
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
                      `Analyze ${sym} on the 4H timeframe. Identify the key levels, entry, stop loss and targets.`,
                      '4H'
                    );
                  }}
                />
                <div className="absolute inset-x-0 bottom-0 h-8 pointer-events-none bg-gradient-to-t from-[var(--mx-bg)] to-transparent" aria-hidden="true" />
              </div>

              <div className="shrink-0 px-3 sm:px-6 pt-1 pb-safe">
                <div className="w-full max-w-3xl mx-auto">
                  <ChatUpdatesBar
                    isSignedIn={!!authUser}
                    userProfile={userProfile}
                    creditState={creditState}
                    notifications={notifications}
                    tickers={tickers}
                    tickersLive={tickersLive}
                    monthlyPriceLabel={formatMoney(paymentsConfig?.monthlyAmount ?? 20, paymentsConfig?.currency || 'USD', true)}
                    onOpenPricing={() => setIsPricingModalOpen(true)}
                    onOpenCampaign={() => setIsShareModalOpen(true)}
                    onSignIn={() => setIsAuthModalOpen(true)}
                    onAnalyze={prompt => handleSendMessage(prompt)}
                    onNotificationSeen={markNotificationRead}
                    onNotificationAction={handleUpdateNotificationAction}
                  />
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
