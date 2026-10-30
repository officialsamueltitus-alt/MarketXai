import { formatMarketPrice } from '../utils/formatPrice';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CreditState, MarketQuote, UserProfile } from '../types';
import { Sparkles, Gift, X, ChevronRight, Lightbulb, ImagePlus, TrendingUp, TrendingDown, LogIn, AlertTriangle, Crown } from 'lucide-react';
import { campaignCreditsLeft, formatDailyResetTime, getSubscriptionRemainingInfo, isUnlimitedUser } from '../utils/creditManager';
import { DEFAULT_BENEFITS as B } from '../utils/apiClient';

interface ChatUpdatesBarProps {
  isSignedIn: boolean;
  userProfile: UserProfile;
  creditState: CreditState;
  /** Live tickers; only used once they have been synced from the server */
  tickers: MarketQuote[];
  tickersLive: boolean;
  monthlyPriceLabel: string;
  onOpenPricing: () => void;
  onOpenCampaign: () => void;
  onSignIn: () => void;
  onAnalyze: (prompt: string) => void;
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
}

const TONES: Record<Tone, string> = {
  violet: 'bg-indigo-500/15 text-indigo-300',
  amber: 'bg-amber-500/15 text-amber-300',
  emerald: 'bg-emerald-500/15 text-emerald-300',
  cyan: 'bg-cyan-500/15 text-cyan-300',
  rose: 'bg-rose-500/15 text-rose-300',
  slate: 'bg-white/[0.06] text-slate-300',
};

const VISIBLE_MS = 5_000; // owner-specified: each update clears itself after 5 seconds
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

// Occasional pop-up above the chat composer: live market moves, offers and tips. Owner-specified: it never repeats
// notifications (prompts, analysis results or anything else the notification center already shows), and each one
// clears itself after 5 seconds; it can be closed at any time.
export const ChatUpdatesBar: React.FC<ChatUpdatesBarProps> = props => {
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
        text: `${(B.proPlanCredits?.monthly ?? 1000).toLocaleString('en-US')} credits + verified badge · ${p.monthlyPriceLabel} for 3 months`,
        cta: 'Go Pro',
        onAction: p.onOpenPricing,
      });
      if (p.creditState.dailyUsageRemaining <= 0 && campaignCreditsLeft(p.creditState) <= 0) {
        promo.push({ id: 'out', tone: 'amber', icon: AlertTriangle, label: 'Daily limit', text: `You've used today's ${p.creditState.dailyUsageLimit} analyses. They refill at ${formatDailyResetTime(p.creditState)}`, cta: 'Upgrade', onAction: p.onOpenPricing });
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
    promo.push({ id: 'tip-slash', tone: 'slate', icon: Lightbulb, label: 'Tip', text: 'Type / in the message box to open any tool' });

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
      <div ref={noticeRef} className="absolute inset-x-3 bottom-2 z-20 flex justify-center pointer-events-none">
      <div
        key={current.id}
        className="mx-pop-in pointer-events-auto w-full sm:w-[min(75%,30rem)] overflow-hidden rounded-xl bg-[var(--mx-surface-2)]/95 backdrop-blur border border-white/[0.09] shadow-[0_16px_40px_-16px_rgba(0,0,0,0.9)]"
        role="status"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 pl-2 pr-1 py-1.5">
          <span className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${TONES[current.tone]}`}>
            <Icon className="w-3 h-3" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[8px] font-medium uppercase tracking-wider text-slate-500 leading-none">{current.label}</div>
            <p className="mt-0.5 text-[11px] text-slate-200 leading-snug line-clamp-2">{current.text}</p>
          </div>
          {current.cta && current.onAction && (
            <button
              type="button"
              onClick={() => {
                current.onAction?.();
                clear();
              }}
              className="h-6 pl-2.5 pr-1.5 rounded-full bg-white text-slate-950 text-[11px] font-medium hover:bg-slate-200 active:scale-[0.97] transition inline-flex items-center gap-0.5 shrink-0 cursor-pointer"
            >
              {current.cta}
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
          <button
            type="button"
            onClick={clear}
            className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0 cursor-pointer"
            aria-label="Close update"
            title="Close"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
        {/* Time left before the update clears itself */}
        <div className="h-[2px] bg-white/[0.04]">
          <div className="mx-update-timer h-full bg-white/25" style={{ animationDuration: `${VISIBLE_MS}ms` }} />
        </div>
      </div>
      </div>
    </div>
  );
};
