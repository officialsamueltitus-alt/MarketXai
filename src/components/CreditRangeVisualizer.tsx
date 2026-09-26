import React, { useState, useEffect } from 'react';
import { CreditState, UserProfile } from '../types';
import { getDailyResetCountdown, getSubscriptionRemainingInfo, isUnlimitedUser } from '../utils/creditManager';
import { Clock, Calendar, Zap, ShieldCheck, Infinity as InfinityIcon } from 'lucide-react';
import { MarketXText } from './MarketXText';

interface CreditRangeVisualizerProps {
  creditState: CreditState;
  userProfile: UserProfile;
  onOpenPricing?: () => void;
}

export const CreditRangeVisualizer: React.FC<CreditRangeVisualizerProps> = ({
  creditState,
  userProfile,
  onOpenPricing,
}) => {
  const [countdown, setCountdown] = useState(() =>
    getDailyResetCountdown(creditState.lastDailyResetTime)
  );

  // Update 24h reset countdown every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(getDailyResetCountdown(creditState.lastDailyResetTime));
    }, 30000);
    return () => clearInterval(timer);
  }, [creditState.lastDailyResetTime]);

  const isUnlimited = isUnlimitedUser(userProfile.email);

  const isPremium = userProfile.subscription.active && !userProfile.subscription.expiresAt
    ? false
    : userProfile.subscription.active;

  const isYearly = userProfile.subscription.plan === 'yearly' && isPremium;
  const isMonthly = userProfile.subscription.plan === 'monthly' && isPremium;

  const subInfo = getSubscriptionRemainingInfo(userProfile);

  // Daily calculations
  const dailyLimit = creditState.dailyUsageLimit || (isPremium ? 10 : 5);
  const dailyRemaining = Math.max(0, creditState.dailyUsageRemaining);
  const dailyPercent = isUnlimited ? 100 : Math.min(100, Math.round((dailyRemaining / dailyLimit) * 100));

  return (
    <div className="space-y-3.5">
      {/* 1. Daily Usage Range (Refreshes every 24hrs) */}
      <div className="p-3.5 rounded-2xl bg-gradient-to-br from-indigo-950/40 via-slate-900/60 to-black/40 border border-indigo-500/30 shadow-md">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            <span className="text-xs font-bold text-white">Daily AI Usage Quota</span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 flex items-center gap-1">
            {isUnlimited ? (
              <>
                <InfinityIcon className="w-3 h-3 text-amber-300" />
                <span>Infinite Quota</span>
              </>
            ) : (
              <>
                <Clock className="w-2.5 h-2.5 text-indigo-400" />
                <span>Resets in {countdown.text}</span>
              </>
            )}
          </span>
        </div>

        {/* Counter and Visual Range Bar */}
        <div className="mt-3 space-y-1.5">
          <div className="flex justify-between items-baseline">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-black font-mono text-white">
                {isUnlimited ? '∞' : dailyRemaining}
              </span>
              <span className="text-xs font-mono text-slate-400">
                {isUnlimited ? 'Unlimited compute access' : `/ ${dailyLimit} left today`}
              </span>
            </div>
            <span className="text-[11px] font-semibold text-cyan-300 font-mono">
              {isUnlimited ? '100% Always Active' : `${dailyPercent}% remaining`}
            </span>
          </div>

          {/* Range Track / Progress Visualizer */}
          <div className="relative w-full h-3 bg-slate-950 rounded-full p-0.5 border border-white/[0.1] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isUnlimited
                  ? 'bg-gradient-to-r from-amber-400 via-cyan-400 to-emerald-400'
                  : dailyPercent > 50
                  ? 'bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400'
                  : dailyPercent > 20
                  ? 'bg-gradient-to-r from-amber-500 to-amber-300'
                  : 'bg-gradient-to-r from-rose-500 to-rose-400 animate-pulse'
              }`}
              style={{ width: `${dailyPercent}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
            <span>0</span>
            <span className="text-[9px] text-indigo-300">
              {isUnlimited ? 'Zero deduction mode enabled' : isPremium ? '10 daily quota (renews every 24h)' : '5 daily quota (renews every 24h)'}
            </span>
            <span>{isUnlimited ? '∞' : dailyLimit}</span>
          </div>
        </div>

        <p className="text-[10px] text-slate-400 mt-2 bg-black/25 px-2.5 py-1 rounded-lg border border-white/[0.04] leading-relaxed">
          {isUnlimited
            ? 'Lifetime unrestricted compute active across all models and tools.'
            : 'Daily credits strictly reset to 10 every 24 hours and do not roll over from prior days.'}
        </p>
      </div>

      {/* 2. Monthly Subscription Range */}
      {isMonthly && (
        <div className="p-3.5 rounded-2xl bg-gradient-to-br from-cyan-950/30 via-slate-900/50 to-black/30 border border-cyan-500/30 shadow-md">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs font-bold text-white">Monthly Cycle Range</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              {subInfo.daysLeft} days remaining
            </span>
          </div>

          <div className="mt-2.5 space-y-1.5">
            <div className="flex justify-between items-baseline text-xs">
              <span className="text-slate-300 font-medium">
                Day {30 - subInfo.daysLeft} of 30
              </span>
              <span className="font-mono text-cyan-300 text-[11px] font-semibold">
                Expires {subInfo.expiresFormatted}
              </span>
            </div>

            {/* Monthly Visual Range Bar */}
            <div className="relative w-full h-2.5 bg-slate-950 rounded-full p-0.5 border border-white/[0.1] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-sky-400 to-indigo-500 transition-all duration-500"
                style={{ width: `${subInfo.percentRemaining}%` }}
              />
            </div>

            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Day 1</span>
              <span>{subInfo.percentRemaining}% of month remaining</span>
              <span>Day 30</span>
            </div>
          </div>
        </div>
      )}

      {/* 3. Yearly Subscription Range */}
      {isYearly && (
        <div className="p-3.5 rounded-2xl bg-gradient-to-br from-amber-950/30 via-slate-900/50 to-black/30 border border-amber-500/30 shadow-md">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-xs font-bold text-white">Yearly Annual Cycle Range</span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
              {subInfo.daysLeft} / 365 days
            </span>
          </div>

          <div className="mt-2.5 space-y-1.5">
            <div className="flex justify-between items-baseline text-xs">
              <span className="text-slate-300 font-medium">
                {365 - subInfo.daysLeft} days elapsed
              </span>
              <span className="font-mono text-amber-300 text-[11px] font-semibold">
                Renews {subInfo.expiresFormatted}
              </span>
            </div>

            {/* Yearly Visual Range Bar */}
            <div className="relative w-full h-2.5 bg-slate-950 rounded-full p-0.5 border border-white/[0.1] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 via-yellow-400 to-emerald-400 transition-all duration-500"
                style={{ width: `${subInfo.percentRemaining}%` }}
              />
            </div>

            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Day 1</span>
              <span>{subInfo.percentRemaining}% of annual cycle remaining</span>
              <span>Day 365</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
