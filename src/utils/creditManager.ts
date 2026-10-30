import { UserProfile, CreditState, CreditGift, SubscriptionPlan } from '../types';

// Unlimited access is decided by the server (verified email on its allow-list); the UI mirrors it
let serverUnlimitedEmail: string | null = null;

export function setServerUnlimitedEmail(email: string | null) {
  serverUnlimitedEmail = email ? email.trim().toLowerCase() : null;
}

/**
 * Checks if a user has permanent unlimited access, as reported by the server.
 */
export function isUnlimitedUser(email?: string): boolean {
  if (!email || !serverUnlimitedEmail) return false;
  return email.trim().toLowerCase() === serverUnlimitedEmail;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const THREE_HUNDRED_SIXTY_FIVE_DAYS_MS = 365 * 24 * 60 * 60 * 1000;

export const INITIAL_USER_PROFILE: UserProfile = {
  id: 'usr_guest_trader',
  username: 'trader',
  displayName: 'Guest Trader',
  email: '',
  joinedAt: Date.now(),
  isVerified: false,
  subscription: {
    plan: 'free',
    active: false,
    startDate: Date.now(),
    expiresAt: 0,
    price: 0,
  },
};

export const INITIAL_CREDIT_STATE: CreditState = {
  availableCredits: 5,
  dailyUsageLimit: 3,
  dailyUsageRemaining: 3,
  lastDailyResetTime: Date.now(),
};

/** When the daily analyses refill next: the server's 3:00 AM refill time, or the next local 3:00 AM before it loads. */
export function getNextDailyReset(state: Pick<CreditState, 'nextDailyResetAt'>): number {
  if (state.nextDailyResetAt && state.nextDailyResetAt > 0) return state.nextDailyResetAt;
  const d = new Date();
  d.setHours(3, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** The refill time in the reader's own clock, e.g. "3:00 AM" (or "2:00 AM" for someone an hour behind the site). */
export function formatDailyResetTime(state: Pick<CreditState, 'nextDailyResetAt'>): string {
  return new Date(getNextDailyReset(state)).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Time left until the next daily refill (3:00 AM every day). */
export function getDailyResetCountdown(state: Pick<CreditState, 'nextDailyResetAt'>): { hours: number; minutes: number; text: string } {
  const diff = Math.max(0, getNextDailyReset(state) - Date.now());
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return {
    hours,
    minutes,
    text: `${hours}h ${minutes}m`,
  };
}

/** Campaign credits left: used first; the daily analyses pause (no refill) until they run out. */
export function campaignCreditsLeft(state: CreditState): number {
  return Math.max(0, Math.min(state.campaignCredits ?? 0, state.availableCredits));
}

/** Bought credits left (credit packs). */
export function purchasedCreditsLeft(state: CreditState): number {
  return Math.max(0, Math.min(state.purchasedCredits ?? 0, state.availableCredits - campaignCreditsLeft(state)));
}

/** Today's allowance still usable: on Pro it is a cap on the general balance (the plan's credits), so it can't exceed what is left. */
export function dailyLeft(state: CreditState): number {
  const daily = Math.max(0, state.dailyUsageRemaining);
  if (!state.dailyNeedsBalance) return daily;
  const general = Math.max(0, state.availableCredits - campaignCreditsLeft(state) - purchasedCreditsLeft(state));
  return Math.min(daily, general);
}

/** Prompts the user can still send before the next refill: today's allowance, campaign credits and bought credits. */
export function promptsLeft(state: CreditState): number {
  return dailyLeft(state) + campaignCreditsLeft(state) + purchasedCreditsLeft(state);
}

/** True when today's analyses and campaign credits are both used up (prompts pause until the refill). */
export function isDailyLimitReached(state: CreditState, email?: string): boolean {
  return !isUnlimitedUser(email) && promptsLeft(state) <= 0;
}

/**
 * Verifies subscription status against current timestamp.
 * If expired, deactivates subscription and removes verified status.
 */
export function checkSubscriptionExpiry(profile: UserProfile): UserProfile {
  if (isUnlimitedUser(profile.email)) {
    return {
      ...profile,
      isVerified: true,
      subscription: {
        ...profile.subscription,
        active: true,
        plan: 'yearly',
      },
    };
  }

  if (!profile.subscription.active || profile.subscription.plan === 'free') {
    return {
      ...profile,
      isVerified: false,
    };
  }

  const now = Date.now();
  if (profile.subscription.expiresAt > 0 && now >= profile.subscription.expiresAt) {
    // Subscription has expired
    return {
      ...profile,
      isVerified: false,
      subscription: {
        ...profile.subscription,
        active: false,
      },
    };
  }

  // Subscription is active and unexpired
  return {
    ...profile,
    isVerified: true,
  };
}

/**
 * Calculates duration and remaining days for monthly or yearly plan
 */
export function getSubscriptionRemainingInfo(profile: UserProfile): {
  daysLeft: number;
  totalDays: number;
  percentRemaining: number;
  isExpired: boolean;
  expiresFormatted: string;
} {
  if (isUnlimitedUser(profile.email)) {
    return {
      daysLeft: 9999,
      totalDays: 9999,
      percentRemaining: 100,
      isExpired: false,
      expiresFormatted: 'Lifetime Unlimited Access',
    };
  }

  const sub = profile.subscription;
  if (!sub.active || sub.plan === 'free' || sub.expiresAt === 0) {
    return {
      daysLeft: 0,
      totalDays: 0,
      percentRemaining: 0,
      isExpired: true,
      expiresFormatted: 'No active plan',
    };
  }

  const now = Date.now();
  const diffMs = Math.max(0, sub.expiresAt - now);
  const daysLeft = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  const totalDays = sub.plan === 'yearly' ? 365 : 30;
  const percentRemaining = Math.min(100, Math.max(0, Math.round((daysLeft / totalDays) * 100)));

  return {
    daysLeft,
    totalDays,
    percentRemaining,
    isExpired: now >= sub.expiresAt,
    expiresFormatted: new Date(sub.expiresAt).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
  };
}
