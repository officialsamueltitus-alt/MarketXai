import { formatMarketPrice } from '../utils/formatPrice';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppNotification, CreditState, MarketQuote, UserProfile } from '../types';
import { Sparkles, Gift, Bell, X, ChevronRight, Lightbulb, ImagePlus, TrendingUp, TrendingDown, LogIn, AlertTriangle, Crown, Megaphone } from 'lucide-react';
import { campaignCreditsLeft, formatDailyResetTime, getSubscriptionRemainingInfo, isUnlimitedUser } from '../utils/creditManager';
import { DEFAULT_BENEFITS as B } from '../utils/apiClient';

interface ChatUpdatesBarProps {
  isSignedIn: boolean;
  userProfile: UserProfile;
  creditState: CreditState;
  notifications: AppNotification[];
  /** Live tickers; only used once they have been synced from the server */
  tickers: MarketQuote[];
  tickersLive: boolean;
  monthlyPriceLabel: string;
  onOpenPricing: () => void;
  onOpenCampaign: () => void;
  onSignIn: () => void;
  onAnalyze: (prompt: string) => void;
  onNotificationSeen: (id: string) => void;
  onNotificationAction: (n: AppNotification) => void;
}

type Tone = 'violet' | 'amber' | 'emerald' | 'cyan' | 'rose' | 'slate';

interface UpdateItem {
  id: string;
  tone: Tone;
  icon: React.ElementType;
  label: string;
  text: string;
  cta?: string;
  onAction?: () => void;
  notificationId?: string;
}

const TONES: Record<Tone, string> = {
  violet: 'bg-indigo-500/15 text-indigo-300',
  amber: 'bg-amber-500/15 text-amber-300',
  emerald: 'bg-emerald-500/15 text-emerald-300',
  cyan: 'bg-cyan-500/15 text-cyan-300',
  rose: 'bg-rose-500/15 text-rose-300',
  slate: 'bg-white/[0.06] text-slate-300',
};

const VISIBLE_MS = 15_000; // each update clears itself after 15 seconds
const FIRST_DELAY: [number, number] = [15_000, 35_000];
const GAP_DELAY: [number, number] = [120_000, 300_000];
const SEEN_KEY = 'mx_seen_updates';

const rand = ([min, max]: [number, number]) => min + Math.random() * (max - min);
const pick = <T,>(list: T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

function loadSeen(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function formatPrice(q: MarketQuote): string {
  // Exactly as fetched, never rounded
  const n = formatMarketPrice(q.price);
  return q.type === 'forex' ? n : `$${n}`;
}

function notificationItem(n: AppNotification, onAction: () => void): UpdateItem {
  const reward = n.type === 'credit' || n.type === 'reward';
  const announcement = n.type === 'announcement';
  return {
    id: `n-${n.id}`,
    notificationId: n.id,
    tone: reward ? 'emerald' : n.type === 'market' ? 'cyan' : 'violet',
    icon: reward ? Gift : announcement ? Megaphone : Bell,
    label: announcement ? 'Announcement' : 'Notification',
    text: n.title,
    cta: n.actionPrompt ? 'Analyze' : announcement ? 'Read' : 'View',
    onAction,
  };
}

// Occasional pop-up above the chat composer: live market moves, promos and new notifications.
// Appears at random intervals, clears itself after 15 seconds, and can be closed at any time.
export const ChatUpdatesBar: React.FC<ChatUpdatesBarProps> = props => {
  const { notifications } = props;
  const [current, setCurrent] = useState<UpdateItem | null>(null);
  const seenRef = useRef<Set<string>>(loadSeen());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const markSeen = (id: string) => {
    seenRef.current.add(id);
    try {
      sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seenRef.current].slice(-80)));
    } catch {}
  };

  // Build the candidate pool from the latest state
  const buildPool = useCallback((): { market: UpdateItem[]; promo: UpdateItem[] } => {
    const p = propsRef.current;
    const market: UpdateItem[] = [];
    const promo: UpdateItem[] = [];

    // Older unread notifications join the random rotation
    p.notifications
      .filter(n => !n.read && n.type !== 'analysis')
      .slice(0, 3)
      .forEach(n => promo.push(notificationItem(n, () => propsRef.current.onNotificationAction(n))));

    if (p.tickersLive) {
      const hour = Math.floor(Date.now() / 3_600_000);
      p.tickers
        .filter(q => q.price > 0 && Math.abs(q.change24h) >= 0.4)
        .forEach(q => {
          const up = q.change24h >= 0;
          market.push({
            id: `m-${q.symbol}-${up ? 'u' : 'd'}-${hour}`,
            tone: up ? 'emerald' : 'rose',
            icon: up ? TrendingUp : TrendingDown,
            label: 'Market update',
            text: `${q.name || q.symbol} is ${up ? 'up' : 'down'} ${Math.abs(q.change24h).toFixed(2)}% today at ${formatPrice(q)}`,
            cta: 'Analyze',
            onAction: () => propsRef.current.onAnalyze(`Analyze ${q.symbol} on the 4H timeframe`),
          });
        });
    }

    const unlimited = isUnlimitedUser(p.userProfile.email);
    const isPro = p.userProfile.subscription.active;
    if (!p.isSignedIn) {
      promo.push({ id: 'signin', tone: 'violet', icon: LogIn, label: 'MarketX', text: `Sign in to get ${B.freeDailyAnalyses} free SI analyses every day`, cta: 'Sign in', onAction: p.onSignIn });
    } else if (!unlimited && !isPro) {
      promo.push({
        id: 'pro',
        tone: 'violet',
        icon: Sparkles,
        label: 'MarketX Pro',
        text: `${B.proDailyAnalyses} analyses a day + verified badge · ${p.monthlyPriceLabel}/mo`,
        cta: 'Go Pro',
        onAction: p.onOpenPricing,
      });
      if (p.creditState.dailyUsageRemaining <= 0) {
        promo.push({ id: 'out', tone: 'amber', icon: AlertTriangle, label: 'Daily limit', text: campaignCreditsLeft(p.creditState) > 0
            ? `Today's analyses are used up; your campaign credits keep you going. Daily analyses refill at ${formatDailyResetTime(p.creditState)}`
            : `You've used today's ${p.creditState.dailyUsageLimit} analyses. They refill at ${formatDailyResetTime(p.creditState)}`, cta: 'Upgrade', onAction: p.onOpenPricing });
      }
    } else if (isPro && !unlimited) {
      const sub = getSubscriptionRemainingInfo(p.userProfile);
      if (sub.daysLeft <= 5) {
        promo.push({ id: 'renew', tone: 'amber', icon: Crown, label: 'MarketX Pro', text: `Your Pro plan ends in ${sub.daysLeft} day${sub.daysLeft === 1 ? '' : 's'}`, cta: 'Renew', onAction: p.onOpenPricing });
      }
    }
    if (p.isSignedIn) {
      promo.push({ id: 'campaign', tone: 'amber', icon: Gift, label: 'Campaign', text: 'Share MarketX on X and earn 10 free credits', cta: 'Start', onAction: p.onOpenCampaign });
    }
    promo.push({ id: 'tip-chart', tone: 'cyan', icon: ImagePlus, label: 'Tip', text: 'Attach a chart screenshot, name the pair, and MarketX reads the chart for you' });
    promo.push({ id: 'tip-slash', tone: 'slate', icon: Lightbulb, label: 'Tip', text: 'Type / in the message box for quick commands' });

    const fresh = (l: UpdateItem[]) => l.filter(i => !seenRef.current.has(i.id));
    return { market: fresh(market), promo: fresh(promo) };
  }, []);

  const clear = useCallback(() => {
    if (hideRef.current) clearTimeout(hideRef.current);
    hideRef.current = null;
    setCurrent(null);
  }, []);

  const show = useCallback((item: UpdateItem) => {
    markSeen(item.id);
    setCurrent(item);
    if (hideRef.current) clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => setCurrent(null), VISIBLE_MS);
  }, []);

  // Random scheduler: wait, pop one update, wait again once it clears
  const schedule = useCallback(
    (range: [number, number]) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (document.hidden) return schedule([10_000, 30_000]);
        const { market, promo } = buildPool();
        // Mix: mostly market moves when available, otherwise a promo or tip
        const item = market.length && (Math.random() < 0.6 || !promo.length) ? pick(market) : pick(promo) || pick(market);
        if (item) show(item);
        schedule(GAP_DELAY);
      }, rand(range));
    },
    [buildPool, show]
  );

  useEffect(() => {
    schedule(FIRST_DELAY);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (hideRef.current) clearTimeout(hideRef.current);
    };
  }, [schedule]);

  // A notification that arrives while the chat is open pops up straight away. "Setup ready" is skipped: the
  // result is already on screen in the chat, so a pop-up over it would only cover the answer.
  const mountedAtRef = useRef(Date.now());
  useEffect(() => {
    const fresh = notifications.find(n => !n.read && n.type !== 'analysis' && n.timestamp > mountedAtRef.current);
    if (!fresh || seenRef.current.has(`n-${fresh.id}`)) return;
    show(notificationItem(fresh, () => propsRef.current.onNotificationAction(fresh)));
  }, [notifications, show]);

  // Publish the notice height so the chat's scroll button can sit above it instead of overlapping
  const noticeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const el = noticeRef.current;
    if (!current || !el) {
      root.style.setProperty('--mx-notice-h', '0px');
      return;
    }
    const set = () => root.style.setProperty('--mx-notice-h', `${el.offsetHeight + 8}px`);
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.setProperty('--mx-notice-h', '0px');
    };
  }, [current]);

  if (!current) return null;
  const Icon = current.icon;

  return (
    <div className="relative h-0">
      <div
        key={current.id}
        ref={noticeRef}
        className="mx-pop-in absolute inset-x-3 sm:inset-x-5 bottom-2 z-20 overflow-hidden rounded-2xl bg-[var(--mx-surface-2)]/95 backdrop-blur border border-white/[0.09] shadow-[0_16px_40px_-16px_rgba(0,0,0,0.9)]"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2.5 pl-2.5 pr-1.5 py-2">
          <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${TONES[current.tone]}`}>
            <Icon className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-500 leading-none">{current.label}</div>
            <p className="mt-1 text-[13px] text-slate-200 leading-snug line-clamp-2">{current.text}</p>
          </div>
          {current.cta && current.onAction && (
            <button
              type="button"
              onClick={() => {
                if (current.notificationId) props.onNotificationSeen(current.notificationId);
                current.onAction?.();
                clear();
              }}
              className="h-7 pl-3 pr-2 rounded-full bg-white text-slate-950 text-xs font-medium hover:bg-slate-200 active:scale-[0.97] transition inline-flex items-center gap-0.5 shrink-0 cursor-pointer"
            >
              {current.cta}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (current.notificationId) props.onNotificationSeen(current.notificationId);
              clear();
            }}
            className="w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0 cursor-pointer"
            aria-label="Close update"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Time left before the update clears itself */}
        <div className="h-[2px] bg-white/[0.04]">
          <div className="mx-update-timer h-full bg-white/25" style={{ animationDuration: `${VISIBLE_MS}ms` }} />
        </div>
      </div>
    </div>
  );
};
