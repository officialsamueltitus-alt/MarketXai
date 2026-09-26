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

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
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
  dailyUsageLimit: 5,
  dailyUsageRemaining: 5,
  lastDailyResetTime: Date.now(),
};

/**
 * Checks and updates the daily 24-hour quota.
 * Unlimited users bypass limits.
 */
export function checkAndRefreshDailyQuota(
  state: CreditState,
  hasPremium: boolean,
  userEmail?: string
): { state: CreditState; refreshed: boolean } {
  if (isUnlimitedUser(userEmail)) {
    return {
      state: {
        ...state,
        availableCredits: 999999,
        dailyUsageLimit: 999999,
        dailyUsageRemaining: 999999,
      },
      refreshed: false,
    };
  }

  const now = Date.now();
  const elapsed = now - state.lastDailyResetTime;
  const targetDailyLimit = hasPremium ? 10 : 5;

  if (elapsed >= TWENTY_FOUR_HOURS_MS) {
    // 24 hours elapsed: restart strictly from the limit (10 for premium, 5 for free), no rollover!
    const newState: CreditState = {
      ...state,
      dailyUsageLimit: targetDailyLimit,
      dailyUsageRemaining: targetDailyLimit,
      lastDailyResetTime: now,
    };
    return { state: newState, refreshed: true };
  }

  // Update limit if plan changed mid-day
  if (state.dailyUsageLimit !== targetDailyLimit) {
    const adjustedRemaining = Math.min(targetDailyLimit, state.dailyUsageRemaining + (targetDailyLimit - state.dailyUsageLimit));
    return {
      state: {
        ...state,
        dailyUsageLimit: targetDailyLimit,
        dailyUsageRemaining: Math.max(0, adjustedRemaining),
      },
      refreshed: false,
    };
  }

  return { state, refreshed: false };
}

/**
 * Calculates remaining time until next 24-hour daily quota refresh.
 */
export function getDailyResetCountdown(lastDailyResetTime: number): { hours: number; minutes: number; text: string } {
  const nextReset = lastDailyResetTime + TWENTY_FOUR_HOURS_MS;
  const diff = Math.max(0, nextReset - Date.now());
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return {
    hours,
    minutes,
    text: `${hours}h ${minutes}m`,
  };
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
