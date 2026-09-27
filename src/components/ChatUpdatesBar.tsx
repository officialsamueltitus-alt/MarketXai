import React, { useEffect, useMemo, useState } from 'react';
import { AppNotification, CreditState, UserProfile } from '../types';
import { Sparkles, Gift, Clock, Bell, X, ChevronRight, Lightbulb, ImagePlus, Crown, AlertTriangle, LogIn } from 'lucide-react';
import { getDailyResetCountdown, getSubscriptionRemainingInfo, isUnlimitedUser } from '../utils/creditManager';
import { DEFAULT_BENEFITS as B } from '../utils/apiClient';

interface ChatUpdatesBarProps {
  isSignedIn: boolean;
  userProfile: UserProfile;
  creditState: CreditState;
  notifications: AppNotification[];
  onOpenPricing: () => void;
  onOpenCampaign: () => void;
  onSignIn: () => void;
  onNotificationSeen: (id: string) => void;
  onNotificationAction: (n: AppNotification) => void;
}

type Tone = 'violet' | 'amber' | 'emerald' | 'cyan' | 'rose' | 'slate';

interface UpdateItem {
  id: string;
  tone: Tone;
  icon: React.ElementType;
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

const DISMISS_KEY = 'mx_dismissed_updates';
function loadDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISS_KEY) || '[]');
  } catch {
    return [];
  }
}

// Slim, rotating updates strip docked above the chat composer
export const ChatUpdatesBar: React.FC<ChatUpdatesBarProps> = ({
  isSignedIn,
  userProfile,
  creditState,
  notifications,
  onOpenPricing,
  onOpenCampaign,
  onSignIn,
  onNotificationSeen,
  onNotificationAction,
}) => {
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const unlimited = isUnlimitedUser(userProfile.email);
  const isPro = userProfile.subscription.active;
  const reset = getDailyResetCountdown(creditState.lastDailyResetTime);

  const items = useMemo<UpdateItem[]>(() => {
    const list: UpdateItem[] = [];

    // 1. Unread notifications first (newest first)
    notifications
      .filter(n => !n.read)
      .slice(0, 3)
      .forEach(n =>
        list.push({
          id: `n-${n.id}`,
          notificationId: n.id,
          tone: n.type === 'credit' || n.type === 'reward' ? 'emerald' : n.type === 'market' ? 'cyan' : 'violet',
          icon: n.type === 'credit' || n.type === 'reward' ? Gift : Bell,
          text: n.title,
          cta: n.actionPrompt ? 'Analyze' : 'View',
          onAction: () => onNotificationAction(n),
        })
      );

    if (!isSignedIn) {
      list.push({ id: 'signin', tone: 'violet', icon: LogIn, text: 'Sign in to save your chats and get free daily analyses', cta: 'Sign in', onAction: onSignIn });
    } else if (unlimited) {
      list.push({ id: 'vip', tone: 'amber', icon: Crown, text: 'VIP account: unlimited analyses, no credits used' });
    } else if (isPro) {
      const sub = getSubscriptionRemainingInfo(userProfile);
      list.push({ id: 'pro-status', tone: 'emerald', icon: Crown, text: `Pro active · ${sub.daysLeft} day${sub.daysLeft === 1 ? '' : 's'} left`, cta: 'Renew', onAction: onOpenPricing });
      list.push({
        id: 'pro-quota',
        tone: 'slate',
        icon: Clock,
        text: `${creditState.dailyUsageRemaining} of ${creditState.dailyUsageLimit} analyses left today · resets in ${reset.text}`,
      });
    } else {
      if (creditState.dailyUsageRemaining <= 1 && creditState.availableCredits <= 1) {
        list.push({ id: 'low', tone: 'rose', icon: AlertTriangle, text: 'Almost out of analyses for today', cta: 'Upgrade', onAction: onOpenPricing });
      }
      list.push({
        id: 'upgrade',
        tone: 'violet',
        icon: Sparkles,
        text: `Go Pro: ${B.proDailyAnalyses} analyses a day, bonus credits & a verified badge`,
        cta: 'Upgrade',
        onAction: onOpenPricing,
      });
      list.push({
        id: 'quota',
        tone: 'slate',
        icon: Clock,
        text: `${creditState.dailyUsageRemaining} of ${creditState.dailyUsageLimit} free analyses left · resets in ${reset.text}`,
      });
    }

    if (isSignedIn) {
      list.push({ id: 'campaign', tone: 'amber', icon: Gift, text: 'Earn 10 free credits by sharing MarketX on X', cta: 'Start', onAction: onOpenCampaign });
    }
    list.push({ id: 'tip-chart', tone: 'cyan', icon: ImagePlus, text: 'Tip: paste or attach a chart screenshot for vision analysis' });
    list.push({ id: 'tip-slash', tone: 'slate', icon: Lightbulb, text: 'Tip: type / in the message box for quick commands' });

    return list.filter(item => !dismissed.includes(item.id));
  }, [notifications, isSignedIn, unlimited, isPro, userProfile, creditState, reset.text, dismissed, onOpenPricing, onOpenCampaign, onSignIn, onNotificationAction]);

  // Rotate every 8s (paused while hovered)
  useEffect(() => {
    if (paused || items.length <= 1) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setIndex(i => (i + 1) % items.length);
    }, 8000);
    return () => clearInterval(id);
  }, [paused, items.length]);

  useEffect(() => {
    if (index >= items.length) setIndex(0);
  }, [items.length, index]);

  if (items.length === 0) return null;
  const item = items[Math.min(index, items.length - 1)];
  const Icon = item.icon;

  const dismiss = () => {
    if (item.notificationId) onNotificationSeen(item.notificationId);
    const next = [...dismissed, item.id];
    setDismissed(next);
    try {
      sessionStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {}
  };

  return (
    <div
      className="relative mx-3 sm:mx-5 -mb-4 pb-4 rounded-t-2xl bg-[#141418] border border-b-0 border-white/[0.07]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="status"
      aria-live="polite"
    >
      <div key={item.id} className="mx-rise flex items-center gap-2.5 pl-2 pr-1.5 py-1.5 min-h-[42px]">
        <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${TONES[item.tone]}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <p className="flex-1 min-w-0 text-[13px] text-slate-300 truncate">{item.text}</p>

        {items.length > 1 && (
          <div className="hidden sm:flex items-center gap-1 shrink-0" aria-hidden="true">
            {items.slice(0, 6).map((it, i) => (
              <span
                key={it.id}
                className={`h-1 rounded-full transition-all duration-300 ${i === index ? 'w-3 bg-slate-300' : 'w-1 bg-white/20'}`}
              />
            ))}
          </div>
        )}

        {item.cta && item.onAction && (
          <button
            type="button"
            onClick={() => {
              if (item.notificationId) onNotificationSeen(item.notificationId);
              item.onAction?.();
            }}
            className="h-7 pl-3 pr-2 rounded-full bg-white text-slate-950 text-xs font-medium hover:bg-slate-200 active:scale-[0.97] transition inline-flex items-center gap-0.5 shrink-0 cursor-pointer"
          >
            {item.cta}
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0 cursor-pointer"
          aria-label="Dismiss update"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
