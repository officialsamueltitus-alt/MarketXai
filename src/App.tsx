import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
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
  MessageChoice,
  ResearchInfo,
  ActivityStep,
  PriceAlertItem,
  AlertLiveQuote,
  PluginId,
  PluginStates,
} from './types';
import { NO_PLUGINS, PLUGINS, PLUGIN_COMMAND } from './utils/plugins';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { HomePage } from './components/HomePage';
import { ChatFeed } from './components/ChatFeed';
import { ChatInput } from './components/ChatInput';
import { preloadMarkdown } from './components/LazyMarkdown';
import { lazyWithReload } from './utils/lazyReload';

// Modals load on first open (smaller first download); once loaded they stay mounted
const PricingModal = lazyWithReload(() => import('./components/PricingModal').then(m => ({ default: m.PricingModal })));
const GiftCreditsModal = lazyWithReload(() => import('./components/GiftCreditsModal').then(m => ({ default: m.GiftCreditsModal })));
const NotificationCenterModal = lazyWithReload(() => import('./components/NotificationCenterModal').then(m => ({ default: m.NotificationCenterModal })));
const TermsAndPrivacyModal = lazyWithReload(() => import('./components/TermsAndPrivacyModal').then(m => ({ default: m.TermsAndPrivacyModal })));
const ShareProfileModal = lazyWithReload(() => import('./components/ShareProfileModal').then(m => ({ default: m.ShareProfileModal })));
const SupportChat = lazyWithReload(() => import('./components/SupportChat').then(m => ({ default: m.SupportChat })));
const RewardEmailNotificationModal = lazyWithReload(() =>
  import('./components/RewardEmailNotificationModal').then(m => ({ default: m.RewardEmailNotificationModal }))
);
const PriceAlertsPanel = lazyWithReload(() => import('./components/PriceAlertsPanel').then(m => ({ default: m.PriceAlertsPanel })));
const WatchlistPanel = lazyWithReload(() => import('./components/WatchlistPanel').then(m => ({ default: m.WatchlistPanel })));
const TradeJournalPanel = lazyWithReload(() => import('./components/TradeJournalPanel').then(m => ({ default: m.TradeJournalPanel })));
const TrackRecordPanel = lazyWithReload(() => import('./components/TrackRecordPanel').then(m => ({ default: m.TrackRecordPanel })));
const ConnectorsModal = lazyWithReload(() => import('./components/ConnectorsModal').then(m => ({ default: m.ConnectorsModal })));
// Fetched in idle time after start-up, so the first tap on the bell or a Settings item opens instantly (no download
// on a slow mobile connection) and still works if a new version is deployed while the tab stays open
const PRELOADED_SCREENS = [NotificationCenterModal, SupportChat, TermsAndPrivacyModal, PricingModal, GiftCreditsModal, ShareProfileModal, PriceAlertsPanel, WatchlistPanel, TradeJournalPanel, TrackRecordPanel, ConnectorsModal];

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
import { INITIAL_USER_PROFILE, INITIAL_CREDIT_STATE, isUnlimitedUser, setServerUnlimitedEmail, isDailyLimitReached, formatDailyResetTime, getNextDailyReset, promptsLeft, campaignCreditsLeft } from './utils/creditManager';
import { getApiUrl } from './utils/api';
import { classifyPrompt } from './utils/promptIntent';
import { timeframeFromPrompt } from './utils/timeframe';
import { apiFetch, ApiError, formatMoney, loadPublicConfig, PaymentsPublicConfig } from './utils/apiClient';
import { extractAssetInfo } from './utils/localStrategyEngine';
import { ArrowLeft, Plus, CheckCircle2, Gift, Clock } from 'lucide-react';

interface AccountPayload {
  profile: UserProfile;
  credits: CreditState;
  xShareReward: XShareReward | null;
  recentGifts?: CreditGift[];
  unlimited?: boolean;
}


/** The timeframe picked in the composer (kept until changed); 4H before the first pick. */
function getSavedTimeframe(): string {
  try {
    const v = localStorage.getItem('mx_timeframe');
    if (v && (/^\d{1,2}[MHDW]$/.test(v) || v === 'RDM')) return v;
  } catch {}
  return '4H';
}

/** Display form of a timeframe: minutes in lowercase (15m), hours/days/weeks in uppercase (4H, 1D). */
function formatTimeframe(tf: string | undefined): string {
  const v = String(tf || '').trim();
  return /^\d+m$/i.test(v) ? v.toLowerCase() : v.toUpperCase();
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
    const run = () => {
      preloadMarkdown();
      PRELOADED_SCREENS.forEach(c => c.preload());
    };
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
  // Price alerts (/price-alerts): watched on the server; the client only lists them and toggles them
  const [isAlertsOpen, setIsAlertsOpen] = useState(false);
  // Command panels (/watchlist, /trade-journal, /track-record) and the Connectors / Plugins popup
  const [openPlugin, setOpenPlugin] = useState<'watchlist' | 'journal' | 'trackRecord' | null>(null);
  const [isConnectorsOpen, setIsConnectorsOpen] = useState(false);
  const watchlistLinkRef = useRef(false);
  // The exact item a notification or email link points at, highlighted when its panel opens
  const [alertFocus, setAlertFocus] = useState<string | null>(null);
  const [watchFocus, setWatchFocus] = useState<string | null>(null);
  const chatLinkRef = useRef<{ sessionId: string; messageId: string } | null>(null);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlertItem[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [alertQuotes, setAlertQuotes] = useState<Record<string, AlertLiveQuote>>({});
  const [alertsCheckedAt, setAlertsCheckedAt] = useState<number | null>(null);
  const [pendingAlertOffer, setPendingAlertOffer] = useState<{ id: string; symbol: string } | null>(null);
  // An alert link from an email (?alert=<setup> or ?alerts=1), handled once the session is restored
  const alertLinkRef = useRef<{ offerId?: string; open?: boolean } | null>(null);
  const [toastNotification, setToastNotification] = useState<{ message: string; type: 'gift' | 'success' | 'info'; notif?: AppNotification } | null>(null);

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

  // Daily analyses refill at 3:00 AM: fetch the new counts right after the refill (and when the tab comes back
  // after it), so prompts unlock on time without a reload
  useEffect(() => {
    if (!authUser) return;
    const refillAt = getNextDailyReset(creditState);
    const wait = Math.min(Math.max(refillAt - Date.now() + 5000, 1000), 24 * 60 * 60 * 1000);
    const t = setTimeout(refreshAccount, wait);
    const onVisible = () => {
      if (!document.hidden && Date.now() >= refillAt) refreshAccount();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authUser, creditState.nextDailyResetAt, refreshAccount]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // "Turn on price alert" / "Open price alerts" links in alert emails
    const alertOffer = params.get('alert');
    if ((alertOffer && /^of_[a-z0-9]{8,40}$/.test(alertOffer)) || params.get('alerts') === '1') {
      alertLinkRef.current = { offerId: alertOffer || undefined, open: true };
    }
    // "Open watchlist" links in watchlist emails, "See Pro plans" links
    const focusParam = params.get('focus') || '';
    if (params.get('watchlist') === '1') {
      watchlistLinkRef.current = true;
      if (/^wl_[a-f0-9]{16}$/.test(focusParam)) setWatchFocus(focusParam);
    }
    if (params.get('alerts') === '1' && /^al_of_[a-z0-9]{8,40}$/.test(focusParam)) setAlertFocus(focusParam);
    // "View full analysis" / "Open the answer" links in activity emails: that exact reply in that chat
    const chatParam = params.get('chat') || '', msgParam = params.get('msg') || '';
    if (/^[A-Za-z0-9_-]{1,64}$/.test(chatParam) && /^[A-Za-z0-9_-]{1,64}$/.test(msgParam)) chatLinkRef.current = { sessionId: chatParam, messageId: msgParam };
    if (params.get('pricing') === '1') setIsPricingModalOpen(true);
    if (params.has('verified') || params.has('reset') || params.has('support') || params.has('alert') || params.has('alerts') || params.has('watchlist') || params.has('pricing') || params.has('chat') || params.has('focus')) {
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
  // Set while a finished answer waits for its loading steps; Stop then shows it at once
  const skipPacingRef = useRef<(() => void) | null>(null);

  // Handler to stop analysis immediately
  const handleStopAnalysis = useCallback(() => {
    // The answer is already here and paid for (only the loading steps are finishing): show it now instead of discarding it
    if (skipPacingRef.current) {
      skipPacingRef.current();
      return;
    }
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
        message: `🎁 Successfully gifted ${amount} SI Credits to @${toUsername.replace(/^@/, '')}!`,
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

  // ---------------- Pro features (commands + RDM): open to all until proFreeUntil, then Pro only ----------------
  const proAccess = !authUser || userProfile.proAccess !== false;
  const proFreeUntil = userProfile.proFreeUntil || 0;
  const onPaidPlan = !!userProfile.subscription?.active;
  const commandBadge = !proAccess ? 'Pro' : !onPaidPlan && proFreeUntil > Date.now() ? `Free until ${new Date(proFreeUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' })}` : null;
  const showProUpsell = useCallback((message?: string) => {
    setToastNotification({ message: message || 'This is a Pro feature. Upgrade to Pro to use it.', type: 'info' });
    setIsPricingModalOpen(true);
  }, []);

  // ---------------- Price alerts ----------------
  const alertsEnabled = !!userProfile.alertsEnabled;
  const openAlerts = useCallback(() => {
    if (!authUser) {
      setIsAuthModalOpen(true);
      return;
    }
    setIsAlertsOpen(true);
  }, [authUser]);
  const fetchAlerts = useCallback(async (live = false) => {
    setAlertsLoading(true);
    try {
      // live=1: the server also fetches the live price of each market being watched
      const data = await apiFetch<{ enabled: boolean; alerts: PriceAlertItem[]; live?: Record<string, AlertLiveQuote>; checkedAt?: number }>(
        live ? '/api/alerts?live=1' : '/api/alerts'
      );
      setPriceAlerts(data.alerts || []);
      if (live) setAlertQuotes(data.live || {});
      setAlertsCheckedAt(data.checkedAt || Date.now());
      setUserProfile(p => (p.alertsEnabled === data.enabled ? p : { ...p, alertsEnabled: data.enabled }));
    } catch {
    } finally {
      setAlertsLoading(false);
    }
  }, []);
  const createAlert = useCallback(async (offerId: string, symbol: string) => {
    try {
      const data = await apiFetch<{ alerts: PriceAlertItem[] }>('/api/alerts', { method: 'POST', body: JSON.stringify({ offerId }) });
      setPriceAlerts(data.alerts || []);
      setToastNotification({ message: `🔔 Alert on for ${symbol}. You'll be notified at the entry zone, stop loss and every target.`, type: 'success' });
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'PRO_REQUIRED') {
        showProUpsell('Price alerts are a Pro feature. Upgrade to Pro to watch this setup.');
        return;
      }
      if (err instanceof ApiError && err.code === 'ALERTS_OFF') {
        setPendingAlertOffer({ id: offerId, symbol });
        setIsAlertsOpen(true);
        return;
      }
      setToastNotification({ message: err?.message || 'Could not turn on the alert. Please try again.', type: 'info' });
    }
  }, [showProUpsell]);
  const removeAlert = useCallback(async (id: string) => {
    try {
      const data = await apiFetch<{ alerts: PriceAlertItem[] }>(`/api/alerts/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setPriceAlerts(data.alerts || []);
    } catch (err: any) {
      setToastNotification({ message: err?.message || 'Could not turn off the alert.', type: 'info' });
    }
  }, []);
  const handleAlertsConsent = useCallback(async (enabled: boolean) => {
    try {
      const data = await apiFetch<{ enabled: boolean; alerts: PriceAlertItem[] }>('/api/alerts/consent', { method: 'POST', body: JSON.stringify({ enabled }) });
      setUserProfile(p => ({ ...p, alertsEnabled: data.enabled }));
      setPriceAlerts(data.alerts || []);
      if (enabled && pendingAlertOffer) {
        const pending = pendingAlertOffer;
        setPendingAlertOffer(null);
        await createAlert(pending.id, pending.symbol);
      } else if (enabled) {
        setToastNotification({ message: '🔔 Price alerts are on. Tap "Get price alert" on any analysis to watch it.', type: 'success' });
      }
    } catch (err: any) {
      setToastNotification({ message: err?.message || 'Could not update price alerts.', type: 'info' });
    }
  }, [pendingAlertOffer, createAlert]);
  // Status of each result card's alert, by the setup it belongs to
  const alertByOffer = React.useMemo(() => {
    const m: Record<string, 'on' | 'ended'> = {};
    // Switched off by the trader: the setup can be watched again; played out or expired: finished
    for (const a of priceAlerts) {
      if (a.active) m[a.offerId] = 'on';
      else if (a.endedReason !== 'TURNED_OFF' && !m[a.offerId]) m[a.offerId] = 'ended';
    }
    return m;
  }, [priceAlerts]);
  const toggleAlertForStrategy = useCallback((strategy: StrategyResult) => {
    const offerId = strategy.alertOffer?.id;
    if (!offerId) return;
    const current = priceAlerts.find(a => a.offerId === offerId && a.active);
    if (current) removeAlert(current.id);
    else createAlert(offerId, strategy.symbol);
  }, [priceAlerts, removeAlert, createAlert]);
  // Signed in: load the alert states (for the result cards) and handle an alert link from an email
  useEffect(() => {
    if (!authUser) {
      setPriceAlerts([]);
      return;
    }
    if (userProfile.alertsEnabled) fetchAlerts();
    const link = alertLinkRef.current;
    if (link) {
      alertLinkRef.current = null;
      if (link.offerId) {
        if (userProfile.alertsEnabled) createAlert(link.offerId, 'this setup');
        else setPendingAlertOffer({ id: link.offerId, symbol: '' });
      }
      setIsAlertsOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);
  // Opening the panel always shows the latest state
  useEffect(() => {
    if (isAlertsOpen && authUser && alertsEnabled) fetchAlerts(true);
  }, [isAlertsOpen, authUser, alertsEnabled, fetchAlerts]);
  // While an alert is active, new alert notifications are picked up every 30s (only while the tab is visible)
  const hasActiveAlerts = priceAlerts.some(a => a.active);
  useEffect(() => {
    if (!authUser || !hasActiveAlerts) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      refreshNotifications(true);
    }, 30_000);
    return () => clearInterval(id);
  }, [authUser, hasActiveAlerts, refreshNotifications]);
  // A new alert notification: a short toast, and the alert list refreshes
  const seenAlertNotifsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const alertNotifs = notifications.filter(n => n.actionType === 'open_alerts');
    if (!seenAlertNotifsRef.current) {
      seenAlertNotifsRef.current = new Set(alertNotifs.map(n => n.id));
      return;
    }
    const fresh = alertNotifs.filter(n => !seenAlertNotifsRef.current!.has(n.id) && !n.read);
    alertNotifs.forEach(n => seenAlertNotifsRef.current!.add(n.id));
    if (fresh.length) {
      setToastNotification({ message: fresh[0].title, type: 'info', notif: fresh[0] });
      fetchAlerts();
    }
  }, [notifications, fetchAlerts]);

  // ---------------- Commands as plugins (Settings, Connectors / Plugins) ----------------
  const pluginStates = React.useMemo<PluginStates>(
    () => ({ ...NO_PLUGINS, ...(userProfile.plugins || {}), alerts: alertsEnabled }),
    [userProfile.plugins, alertsEnabled]
  );
  const openPluginPanel = useCallback((id: PluginId) => {
    if (!authUser) {
      setIsAuthModalOpen(true);
      return;
    }
    setIsConnectorsOpen(false);
    setIsSidebarOpen(false);
    if (!proAccess) {
      showProUpsell(`${PLUGINS.find(p => p.id === id)?.label || 'This command'} is a Pro feature. Upgrade to Pro to use it.`);
      return;
    }
    if (id === 'alerts') setIsAlertsOpen(true);
    else setOpenPlugin(id);
  }, [authUser, proAccess, showProUpsell]);
  /** Turns a command on or off on the server; the same switch is used inside each command and in Connectors */
  const setPluginEnabled = useCallback(async (id: PluginId, enabled: boolean) => {
    try {
      const data = await apiFetch<{ plugins: PluginStates }>(`/api/plugins/${id}`, { method: 'POST', body: JSON.stringify({ enabled }) });
      setUserProfile(p => ({ ...p, plugins: data.plugins, alertsEnabled: data.plugins.alerts }));
      if (id === 'alerts') fetchAlerts();
      if (enabled) {
        const label = PLUGINS.find(p => p.id === id)?.label || 'Command';
        setToastNotification({ message: `${label} is on. Find it in Settings, Connectors / Plugins.`, type: 'success' });
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'PRO_REQUIRED') showProUpsell(err.message);
      else setToastNotification({ message: err?.message || 'Could not update that command. Please try again.', type: 'info' });
      throw err;
    }
  }, [fetchAlerts, showProUpsell]);
  const showToast = useCallback((message: string, type: 'success' | 'info' = 'info') => setToastNotification({ message, type }), []);
  // A link from a watchlist email opens the watchlist once signed in
  useEffect(() => {
    if (authUser && watchlistLinkRef.current) {
      watchlistLinkRef.current = false;
      setOpenPlugin('watchlist');
    }
  }, [authUser]);
  // While the watchlist is on, new setup notifications are picked up every 30s (tab visible only)
  useEffect(() => {
    if (!authUser || !pluginStates.watchlist || hasActiveAlerts) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      refreshNotifications(true);
    }, 30_000);
    return () => clearInterval(id);
  }, [authUser, pluginStates.watchlist, hasActiveAlerts, refreshNotifications]);
  // A new watchlist setup: a short toast
  const seenWatchNotifsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const watchNotifs = notifications.filter(n => n.actionType === 'open_watchlist');
    if (!seenWatchNotifsRef.current) {
      seenWatchNotifsRef.current = new Set(watchNotifs.map(n => n.id));
      return;
    }
    const fresh = watchNotifs.filter(n => !seenWatchNotifsRef.current!.has(n.id) && !n.read);
    watchNotifs.forEach(n => seenWatchNotifsRef.current!.add(n.id));
    if (fresh.length) setToastNotification({ message: fresh[0].title, type: 'info', notif: fresh[0] });
  }, [notifications]);

  /** Opens the reply a notification is about, in its chat, scrolled to and highlighted */
  const openChatMessage = (sessionId: string, messageId: string) => {
    const session = sessions.find(x => x.id === sessionId);
    if (!session) {
      setToastNotification({ message: 'That chat is no longer in your history.', type: 'info' });
      return false;
    }
    setIsSidebarOpen(false);
    setCurrentSessionId(sessionId);
    setTargetSignalMessageId(session.messages.some(m => m.id === messageId) ? messageId : null);
    setCurrentView('chat');
    return true;
  };
  /**
   * Every notification (center, chat updates bar, toasts, email links) opens the exact thing it is about:
   * the alert card, the watchlist pair, the reply in its chat, the support conversation, credits, plans, profile,
   * the campaign, or the announcement itself.
   */
  const handleUpdateNotificationAction = (notif: AppNotification) => {
    markNotificationRead(notif.id);
    setIsNotificationCenterOpen(false);
    const p = (notif.actionPayload && typeof notif.actionPayload === 'object' ? notif.actionPayload : {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    if (notif.type === 'announcement') return setOpenAnnouncement(notif);
    if (notif.actionPrompt) {
      setCurrentView('chat');
      return void handleSendMessage(notif.actionPrompt, '4H');
    }
    switch (notif.actionType) {
      case 'open_alerts':
        setAlertFocus(str(p.alertId) || null);
        return openPluginPanel('alerts');
      case 'open_watchlist':
        setWatchFocus(str(p.itemId) || null);
        return openPluginPanel('watchlist');
      case 'open_chat':
        if (openChatMessage(str(p.sessionId), str(p.messageId))) return;
        break;
      case 'open_support':
        return setIsSupportOpen(true);
      case 'open_campaign':
        return setIsShareModalOpen(true);
      case 'open_explain_campaign':
        return void window.location.assign('/campaigns/explain-marketx');
      case 'open_pricing':
        return setIsPricingModalOpen(true);
      case 'open_credits':
      case 'view_receipt':
        return openAccountTab('credits');
      case 'open_profile':
      case 'open_profile_security':
        return openAccountTab('profile');
    }
    if (notif.type === 'reward' || notif.type === 'credit') return openAccountTab('credits');
    if (notif.type === 'security' || /profile/i.test(notif.title)) return openAccountTab('profile');
    // Nothing more specific to open: show it in the notification center
    setIsNotificationCenterOpen(true);
  };
  // A link from an email to a reply opens it once the chat history has loaded
  useEffect(() => {
    const ref = chatLinkRef.current;
    if (!ref || !authUser || !historyLoadedRef.current) return;
    chatLinkRef.current = null;
    openChatMessage(ref.sessionId, ref.messageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser, sessions]);

  // Send a message and generate institutional strategy
  const handleSendMessage = async (
    promptText: string,
    timeframe: string = getSavedTimeframe(),
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

    // A setup is only ever passed by the "Tighten SL" actions on a result, so a setup plus tight mode (or
    // tightening words) means: keep this exact setup and tighten its stop. The words "setup"/"analyze" in the
    // button's own prompt must not turn it into a brand-new analysis.
    const isTightenPrompt = Boolean(
      baseStrategy && (slMode === 'tight' || hasTightenKeywords) && (baseStrategy.tradeType === 'LONG' || baseStrategy.tradeType === 'SHORT')
    );
    const resolvedBaseStrategy = isTightenPrompt ? baseStrategy : undefined;

    // Just a pair ("EURUSD", "gold", "$WIF"): ask whether they want an analysis or information. Answered right here,
    // no request and no credit (the server does the same if a bare pair ever reaches it)
    const namesAssetHere = assetInfo.symbol !== 'BTC/USDT' || /\b(btc|xbt|bitcoin)\b/i.test(promptText);
    if (!resolvedBaseStrategy && !chartImage && classifyPrompt(promptText, { namesAsset: namesAssetHere }) === 'clarify') {
      const now = Date.now();
      const sessionId = currentSessionId || `session-${now}`;
      if (!currentSessionId) setCurrentSessionId(sessionId);
      const label = assetInfo.symbol;
      const title = assetInfo.name && assetInfo.name !== label ? `${assetInfo.name} (${label})` : label;
      const userMsg: ChatMessage = { id: `msg-user-${now}`, role: 'user', content: promptText, timestamp: now };
      const askMsg: ChatMessage = {
        id: `msg-assistant-${now + 1}`,
        role: 'assistant',
        content: `What would you like to know about **${title}**?\n\n- **Analysis:** a trade plan with the entry, stop loss and targets.\n- **Info:** the live price, today's move, market details and today's news.`,
        status: 'completed',
        choices: [
          { kind: 'analysis', label: `Analyze ${label}`, prompt: `Analyze ${label}` },
          { kind: 'info', label: `Info about ${label}`, prompt: `Tell me about ${label}` },
        ],
        timestamp: now + 1,
      };
      setSessions(prev =>
        prev.some(x => x.id === sessionId)
          ? prev.map(x => (x.id === sessionId ? { ...x, lastMessage: promptText, updatedAt: now, messages: [...x.messages, userMsg, askMsg] } : x))
          : [{ id: sessionId, title: promptText.slice(0, 32), lastMessage: promptText, updatedAt: now, messages: [userMsg, askMsg] }, ...prev]
      );
      return;
    }

    // Daily limit reached: prompts are paused until the automatic 3:00 AM refill (the server enforces this too)
    if (isDailyLimitReached(creditState, userProfile.email)) {
      setToastNotification({ message: `Today's analyses are used up. They refill automatically at ${formatDailyResetTime(creditState)}.`, type: 'info' });
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
    // Phones can silently drop a long request (screen locks, app switch, network change) and never report it,
    // which left the answer loading forever. Give up well after the server's own worst case and say so.
    const requestLimitMs = chartImage ? 180_000 : 110_000;
    const requestController = new AbortController();
    let requestTimedOut = false;
    const onUserStop = () => requestController.abort();
    controller.signal.addEventListener('abort', onUserStop, { once: true });
    const requestTimer = setTimeout(() => {
      requestTimedOut = true;
      requestController.abort();
    }, requestLimitMs);

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
      const step: ActivityStep = { id, title, detail, status: 'active', startedAt: Date.now() };
      if (id.startsWith('tools-')) {
        // The tool steps always read first, right after the request is understood ("Finding tools", then "Using tools")
        let at = 0;
        activity.forEach((st, i) => {
          if (st.id === 'read' || st.id === 'chart' || st.id.startsWith('tools-')) at = i + 1;
        });
        activity = [...activity.slice(0, at), step, ...activity.slice(at)];
      } else activity = [...activity, step];
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

    // Same rules as the server: a trade analysis, or a question about trading / the markets
    const namesAsset = assetInfo.symbol !== 'BTC/USDT' || /\b(btc|xbt|bitcoin)\b/i.test(promptText);
    const looksLikeAnalysis = classifyPrompt(promptText, { hasChartImage: Boolean(chartImage), namesAsset }) === 'analysis';
    // Minutes read as lowercase "m" (15m), so 1M never looks like one month
    // A timeframe named in the prompt wins over the picker, exactly as on the server
    const analysisTimeframe = formatTimeframe(resolvedBaseStrategy?.timeframe || timeframeFromPrompt(promptText) || timeframe);
    // RDM: the server scans every timeframe and reports the one it used
    const scanAll = analysisTimeframe === 'RDM';
    const tfText = scanAll ? 'every timeframe (RDM)' : `${analysisTimeframe} timeframe`;

    // 1. Real backend request (authenticated; the server charges one credit and refunds on failure)
    type BackendResult =
      | { kind: 'strategy'; strategy: StrategyResult; text: string }
      | { kind: 'chat'; text: string; choices?: MessageChoice[]; research?: ResearchInfo }
      | { kind: 'error'; status: number; code: string; message: string };

    const fetchPromise: Promise<BackendResult | null> = apiFetch<any>('/api/market/analyze', {
      method: 'POST',
      body: JSON.stringify({
        prompt: promptText,
        symbol: assetInfo.symbol,
        // Which reply this is, so its notification and email open it directly
        ref: { sessionId: targetSessionId, messageId: assistantMessageId },
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
      signal: requestController.signal,
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
        if (text)
          return {
            kind: 'chat',
            text,
            ...(Array.isArray(data?.choices) ? { choices: data.choices as MessageChoice[] } : {}),
            ...(data?.research && typeof data.research === 'object' ? { research: data.research as ResearchInfo } : {}),
          };
        return { kind: 'error', status: 500, code: 'EMPTY', message: 'The analysis engine returned no result. Please try again.' };
      })
      .catch((err: any): BackendResult | null => {
        if (requestTimedOut && !controller.signal.aborted) {
          return {
            kind: 'error',
            status: 0,
            code: 'TIMEOUT',
            message:
              "MarketX didn't get the answer back in time. This usually means the connection dropped (for example your phone locked or you switched apps during the analysis). Please try again.",
          };
        }
        if (err?.name === 'AbortError' || controller.signal.aborted) return null;
        if (err instanceof ApiError) return { kind: 'error', status: err.status, code: err.code, message: err.message };
        return { kind: 'error', status: 0, code: 'NETWORK', message: 'Could not reach the MarketX server. Check your connection and try again.' };
      });

    // Intro, on every prompt: "Starting…", "Waking up MarketX engine", "Looking at prompt". The request above is
    // already on its way, so these steps never delay the answer; Stop works at any moment.
    const INTRO_MS = 10_000;
    const introWait = (ms: number) =>
      new Promise<void>(resolve => {
        if (controller.signal.aborted) return resolve();
        const t = setTimeout(resolve, ms);
        controller.signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
      });
    const promptPreview = promptText.length > 60 ? `${promptText.slice(0, 57).trim()}…` : promptText;
    startStep('boot', 'Starting…');
    await introWait(2000);
    endStep('boot');
    startStep('wake', 'Waking up MarketX engine', 'Bringing the engine and the live market feeds online');
    await introWait(5000);
    endStep('wake');
    startStep('look', 'Looking at prompt', `“${promptPreview}”`);
    await introWait(3000);
    endStep('look');
    if (controller.signal.aborted) {
      // Stopped during the intro: the Stop handler has already closed the message
      clearTimeout(requestTimer);
      controller.signal.removeEventListener('abort', onUserStop);
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      return;
    }

    // Step: understand the request (done on this device, instantly)
    if (resolvedBaseStrategy) {
      addDoneStep(
        'read',
        'Loaded your previous setup',
        `${resolvedBaseStrategy.symbol} ${resolvedBaseStrategy.tradeType} · entry ${formatPriceShort(resolvedBaseStrategy.entryZone.optimal)}`
      );
    } else if (looksLikeAnalysis) {
      addDoneStep('read', 'Understood your request', `${assetInfo.name} (${assetInfo.symbol}) · ${tfText}`);
    } else {
      addDoneStep('read', 'Understood your question', namesAsset ? `About ${assetInfo.name} (${assetInfo.symbol})` : 'Trading or market question');
    }
    if (chartImage) {
      addDoneStep('chart', 'Attached your chart', `${chartFileName || 'Chart image'} · ${Math.max(1, Math.round((chartImage.length * 0.75) / 1024))} KB`);
    }

    // Steps: find the tools for this market and timeframe, then use them (they run with the analysis on the server)
    const usesTools = looksLikeAnalysis && !resolvedBaseStrategy;
    let toolsSettled = false;
    let toolsTimer: ReturnType<typeof setTimeout> | null = null;
    if (usesTools) {
      startStep('tools-find', 'Finding tools', scanAll ? `Picking the tools to scan ${assetInfo.symbol} on every timeframe` : `Picking the tools for ${assetInfo.symbol} on ${analysisTimeframe}`);
      toolsTimer = setTimeout(() => {
        if (toolsSettled || controller.signal.aborted) return;
        endStep('tools-find', { detail: chartImage ? 'Chart reader, supply and demand zones, Fibonacci, RSI 14, EMA 50' : 'Live candles, supply and demand zones, Fibonacci, RSI 14, EMA 50' });
        startStep('tools-use', 'Using tools', 'Scanning fresh zones, drawing the Fibonacci, reading RSI and EMA, checking the entry, stop and TP1');
      }, 700);
    }
    const settleTools = (strategy?: StrategyResult | null, failed = false) => {
      if (!usesTools || toolsSettled) return;
      toolsSettled = true;
      if (toolsTimer) clearTimeout(toolsTimer);
      endStep('tools-find', { detail: 'Live candles, supply and demand zones, Fibonacci, RSI 14, EMA 50' });
      if (!activity.some(st => st.id === 'tools-use')) startStep('tools-use', 'Using tools');
      const t = strategy?.toolsUsed;
      const scan = strategy?.timeframeScan;
      const detail = t
        ? [
            scan ? (scan.chosen ? `RDM picked ${formatTimeframe(scan.chosen)} from ${scan.scanned} timeframes` : `RDM scanned ${scan.scanned} timeframes`) : '',
            `${t.candles} candles`,
            `${t.zones} zone${t.zones === 1 ? '' : 's'} checked`,
            t.rsi !== null ? `RSI ${t.rsi}${t.divergence ? `, ${t.divergence.toLowerCase()} divergence` : ''}` : '',
            t.emaTrend ? `EMA 50 ${t.emaTrend.toLowerCase()}` : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : undefined;
      endStep('tools-use', failed ? { status: 'error', detail: 'The tools could not finish' } : detail ? { detail } : {});
    };

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

    // Steps for a question: live market data for a named pair, then a web search for the exact question
    const asksQuestion = !looksLikeAnalysis && !resolvedBaseStrategy;
    if (asksQuestion && namesAsset) {
      startStep('sources', `Checking live ${assetInfo.symbol} data`, 'Live price, exchange and on-chain listings, today\'s news');
    }
    if (asksQuestion) {
      startStep('web', 'Searching the web', 'Looking up current, reputable sources for your exact question');
    }

    startStep(
      'analyze',
      resolvedBaseStrategy
        ? `Tightening the ${resolvedBaseStrategy.symbol} stop loss`
        : looksLikeAnalysis
          ? scanAll
            ? `Scanning ${assetInfo.symbol} on every timeframe`
            : `Analyzing ${assetInfo.symbol} on ${analysisTimeframe}`
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

      const result = await fetchPromise;
      if (!result || controller.signal.aborted) return;
      // Let the work load visibly (reading, live price, news, analysis) instead of jumping straight to the result
      // when the server answers quickly
      const minVisibleMs = result.kind === 'error' ? 0 : INTRO_MS + (looksLikeAnalysis || resolvedBaseStrategy ? 4200 : 1600);
      const remainingMs = minVisibleMs - (Date.now() - requestStartTime);
      if (remainingMs > 0) {
        await new Promise<void>(resolve => {
          const done = () => {
            clearTimeout(t);
            skipPacingRef.current = null;
            resolve();
          };
          const t = setTimeout(done, remainingMs);
          skipPacingRef.current = done;
          controller.signal.addEventListener('abort', done, { once: true });
        });
        if (controller.signal.aborted) return;
      }
      const requestEndTime = Date.now();
      const actualDuration = parseFloat(((requestEndTime - requestStartTime) / 1000).toFixed(1));
      settleTools(result.kind === 'strategy' ? result.strategy : null, result.kind === 'error');
      // What the server actually looked up for a question: live data, the web search and the sites it used
      if (asksQuestion) {
        const r = result.kind === 'chat' ? result.research : undefined;
        const failed = result.kind === 'error';
        const list = (items: string[], max: number) => items.slice(0, max).join(' · ') + (items.length > max ? ` +${items.length - max} more` : '');
        endStep('sources', failed ? { status: 'stopped', detail: 'Skipped, the answer did not finish' } : r?.data?.length ? { detail: list(r.data, 3) } : {});
        const sites = (r?.sources || []).map(x => x.domain).filter(Boolean);
        const webPatch: Partial<ActivityStep> = failed
          ? { status: 'stopped', detail: 'Skipped, the answer did not finish' }
          : r?.cached
            ? { title: 'Found an earlier answer', detail: namesAsset ? 'Asked before, reused it with the live price refreshed' : 'Asked before, reused the stored answer' }
            : r?.web
              ? {
                  title: 'Searched the web',
                  detail: sites.length
                    ? `${sites.length} source${sites.length === 1 ? '' : 's'}: ${list(sites, 3)}`
                    : r.queries?.length
                      ? `Searched: ${list(r.queries.map(q => `"${q}"`), 2)}`
                      : 'Checked current sources',
                  tokenWeight: 1 + Math.min(sites.length, 8) * 0.25,
                }
              : r
                ? { title: 'Web search not needed', detail: 'Answered from MarketX knowledge and live data' }
                : { detail: 'Done' };
        endStep('web', webPatch);
      }
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
        // 402 = daily limit reached: the message (refill at 3:00 AM) is shown in the chat; no pop-up
        if (result.status === 401) setIsAuthModalOpen(true);
        if (result.code === 'PRO_REQUIRED') setIsPricingModalOpen(true);
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
          { content: result.text, status: 'completed', searchStep: undefined, durationSeconds: actualDuration, activity, ...(result.choices ? { choices: result.choices } : {}) },
          { lastMessage: promptText, updatedAt: Date.now() }
        );
        refreshAccount();
        return;
      }

      const strategy = { ...result.strategy, timeframe: formatTimeframe(result.strategy.timeframe) };
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
      clearTimeout(requestTimer);
      toolsSettled = true;
      if (toolsTimer) clearTimeout(toolsTimer);
      controller.signal.removeEventListener('abort', onUserStop);
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

  // A toast about a notification (a new alert hit, a new watchlist setup) opens what it is about when tapped
  const toastTarget = toastNotification?.notif;
  const toastBanner = toastNotification && (
    <div
      role={toastTarget ? 'button' : undefined}
      tabIndex={toastTarget ? 0 : undefined}
      onClick={toastTarget ? () => { setToastNotification(null); handleUpdateNotificationAction(toastTarget); } : undefined}
      onKeyDown={toastTarget ? e => { if (e.key === 'Enter') { setToastNotification(null); handleUpdateNotificationAction(toastTarget); } } : undefined}
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[70] mx-pop-in flex items-center gap-2.5 pl-3 pr-4 py-2.5 rounded-full bg-[var(--mx-surface-2)] border border-white/[0.1] text-white shadow-[0_12px_40px_-12px_var(--mx-shadow)] max-w-[92vw] sm:max-w-md ${toastTarget ? 'cursor-pointer hover:border-white/[0.25]' : ''}`}
    >
      {toastNotification.type === 'gift' ? (
        <Gift className="w-4 h-4 text-cyan-400 shrink-0" />
      ) : toastNotification.type === 'info' ? (
        <Clock className="w-4 h-4 text-amber-300 shrink-0" />
      ) : (
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
      )}
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
        onNotificationAction={handleUpdateNotificationAction}
        emailActivity={userProfile.emailActivity !== false}
        onToggleEmailActivity={authUser ? handleToggleEmailActivity : undefined}
        shareReward={xShareReward}
        onOpenShareCampaign={() => {
          setIsNotificationCenterOpen(false);
          setIsShareModalOpen(true);
        }}
      />
      </Deferred>

      {/* Price alerts (/price-alerts) */}
      <Deferred when={isAlertsOpen}>
        <PriceAlertsPanel
          isOpen={isAlertsOpen}
          onClose={() => {
            setIsAlertsOpen(false);
            setPendingAlertOffer(null);
            setAlertFocus(null);
          }}
          enabled={alertsEnabled}
          alerts={priceAlerts}
          loading={alertsLoading}
          liveQuotes={alertQuotes}
          checkedAt={alertsCheckedAt}
          onRefresh={() => fetchAlerts(true)}
          focusId={alertFocus}
          pendingSymbol={pendingAlertOffer?.symbol || null}
          onConsent={handleAlertsConsent}
          onRemove={removeAlert}
        />
      </Deferred>

      {/* Watchlist, Trade Journal and Track Record (/watchlist, /trade-journal, /track-record) */}
      <Deferred when={openPlugin === 'watchlist'}>
        <WatchlistPanel
          isOpen={openPlugin === 'watchlist'}
          onClose={() => {
            setOpenPlugin(null);
            setWatchFocus(null);
          }}
          enabled={pluginStates.watchlist}
          onSetEnabled={enabled => setPluginEnabled('watchlist', enabled)}
          focusId={watchFocus}
          onAnalyze={(symbol, tf) => {
            setOpenPlugin(null);
            handleSendMessage(tf === 'RDM' ? `Analyze ${symbol}` : `Analyze ${symbol} on the ${tf}`, tf);
          }}
          onToast={showToast}
        />
      </Deferred>
      <Deferred when={openPlugin === 'journal'}>
        <TradeJournalPanel
          isOpen={openPlugin === 'journal'}
          onClose={() => setOpenPlugin(null)}
          enabled={pluginStates.journal}
          onSetEnabled={enabled => setPluginEnabled('journal', enabled)}
          onToast={showToast}
        />
      </Deferred>
      <Deferred when={openPlugin === 'trackRecord'}>
        <TrackRecordPanel
          isOpen={openPlugin === 'trackRecord'}
          onClose={() => setOpenPlugin(null)}
          enabled={pluginStates.trackRecord}
          onSetEnabled={enabled => setPluginEnabled('trackRecord', enabled)}
          onOpenAlerts={() => openPluginPanel('alerts')}
          onToast={showToast}
        />
      </Deferred>
      <Deferred when={isConnectorsOpen}>
        <ConnectorsModal
          isOpen={isConnectorsOpen}
          onClose={() => setIsConnectorsOpen(false)}
          states={pluginStates}
          badge={commandBadge}
          onOpen={openPluginPanel}
          onToggle={(id, enabled) => setPluginEnabled(id, enabled).catch(() => {})}
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
        plugins={authUser ? pluginStates : undefined}
        onOpenPlugin={openPluginPanel}
        onTogglePlugin={(id, enabled) => setPluginEnabled(id, enabled).catch(() => {})}
        onOpenConnectors={() => (authUser ? setIsConnectorsOpen(true) : setIsAuthModalOpen(true))}
      />

      {/* Main Workspace Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative">
        <SiteBanner />
        {/* Top Header Bar */}
        <Header
          onToggleSidebar={() => setIsSidebarOpen(prev => !prev)}
          tickers={tickers}
          credits={creditState.dailyUsageRemaining}
          maxCredits={creditState.dailyUsageLimit}
          campaignCredits={campaignCreditsLeft(creditState)}
          refillLabel={formatDailyResetTime(creditState)}
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
              handleSendMessage(prompt, tf || getSavedTimeframe());
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
                  alertsEnabled={alertsEnabled}
                  alertByOffer={alertByOffer}
                  onToggleAlert={toggleAlertForStrategy}
                  onSelectPrompt={(prompt, tf, sl, base) =>
                    handleSendMessage(prompt, tf || getSavedTimeframe(), sl || 'normal', base)
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
                    onCommand={id => (PLUGIN_COMMAND[id] ? (openPluginPanel(PLUGIN_COMMAND[id]), true) : false)}
                    rdmLocked={!proAccess}
                    onLockedFeature={() => showProUpsell('RDM (scanning every timeframe) is a Pro feature. Upgrade to Pro to use it.')}
                    commandBadge={commandBadge}
                    isLoading={isLoading}
                    credits={isUnlimitedUser(userProfile.email) ? 999999 : promptsLeft(creditState)}
                    refillLabel={formatDailyResetTime(creditState)}
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
