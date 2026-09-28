import React, { useEffect, useState } from 'react';
import { CreditState, UserProfile } from '../types';
import { getDailyResetCountdown, isUnlimitedUser } from '../utils/creditManager';
import { Zap, Gift, ArrowRight, Check, Clock, Sparkles } from 'lucide-react';
import { VerifiedBadge } from './VerifiedBadge';
import { DEFAULT_BENEFITS as B } from '../utils/apiClient';
import { creditsToTokens, formatTokens, TOKENS_PER_CREDIT, TOKENS_PER_USAGE } from '../utils/tokens';

interface CreditsPanelProps {
  userProfile: UserProfile;
  creditState: CreditState;
  onOpenPricing: () => void;
  onOpenGiftModal: () => void;
}

// Circular meter for today's remaining analyses
const QuotaRing: React.FC<{ value: number; max: number; unlimited: boolean }> = ({ value, max, unlimited }) => {
  const r = 34;
  const c = 2 * Math.PI * r;
  const pct = unlimited ? 1 : max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className="relative w-[88px] h-[88px] shrink-0">
      <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
        <defs>
          <linearGradient id="mx-quota" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
        <circle cx="40" cy="40" r={r} fill="none" className="stroke-white/[0.07]" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke="url(#mx-quota)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.2,0.8,0.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-semibold text-white font-mono leading-none">{unlimited ? '∞' : formatTokens(value * TOKENS_PER_USAGE)}</span>
        {!unlimited && <span className="text-[10px] text-slate-500 mt-1">of {formatTokens(max * TOKENS_PER_USAGE)}</span>}
      </div>
    </div>
  );
};

export const CreditsPanel: React.FC<CreditsPanelProps> = ({ userProfile, creditState, onOpenPricing, onOpenGiftModal }) => {
  const unlimited = isUnlimitedUser(userProfile.email) || creditState.availableCredits >= 99999;
  const isPremium = userProfile.subscription.active;
  const [reset, setReset] = useState(() => getDailyResetCountdown(creditState.lastDailyResetTime));

  useEffect(() => {
    setReset(getDailyResetCountdown(creditState.lastDailyResetTime));
    const id = setInterval(() => setReset(getDailyResetCountdown(creditState.lastDailyResetTime)), 30000);
    return () => clearInterval(id);
  }, [creditState.lastDailyResetTime]);

  const tier = unlimited ? 'VIP Unlimited' : isPremium ? 'Pro' : 'Free';

  return (
    <div className="p-4 space-y-3">
      {/* Balance */}
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-5">
        <div className="pointer-events-none absolute -top-16 -right-10 w-48 h-48 rounded-full bg-amber-400/10 blur-3xl" aria-hidden="true" />
        <div className="relative flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Balance</span>
          <span
            className={`h-6 px-2.5 rounded-full text-[11px] font-medium inline-flex items-center gap-1 ${
              unlimited ? 'bg-amber-500/10 text-amber-200' : isPremium ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/[0.05] text-slate-300'
            }`}
          >
            {(isPremium || unlimited) && <VerifiedBadge size="sm" />}
            {tier}
          </span>
        </div>
        <div className="relative mt-2 flex items-end gap-2">
          <Zap className="w-7 h-7 text-amber-300 fill-amber-300/80 mb-1.5" />
          <span className="text-5xl font-semibold tracking-tight text-white font-mono leading-none">
            {unlimited ? '∞' : creditState.availableCredits}
          </span>
          <span className="text-sm text-slate-500 mb-1">credits</span>
        </div>
        <p className="relative mt-3 text-xs text-slate-500">
          {unlimited
            ? 'Unlimited analyses. Nothing is deducted.'
            : `${creditState.availableCredits} credits = ${formatTokens(creditsToTokens(creditState.availableCredits))} tokens (1 credit = ${formatTokens(TOKENS_PER_CREDIT)} tokens).`}
        </p>
      </section>

      {/* Daily quota */}
      <section className="rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-4 flex items-center gap-4">
        <QuotaRing value={creditState.dailyUsageRemaining} max={creditState.dailyUsageLimit} unlimited={unlimited} />
        <div className="min-w-0">
          <div className="text-sm font-medium text-white">Today's tokens</div>
          <p className="text-xs text-slate-500 mt-0.5">
            {unlimited
              ? 'No daily limit on your account.'
              : `${formatTokens(creditState.dailyUsageRemaining * TOKENS_PER_USAGE)} of ${formatTokens(
                  creditState.dailyUsageLimit * TOKENS_PER_USAGE
                )} tokens left · ${formatTokens((creditState.dailyUsageLimit - creditState.dailyUsageRemaining) * TOKENS_PER_USAGE)} used. Renews every 24h, no rollover.`}
          </p>
          {!unlimited && (
            <span className="mt-2 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-white/[0.05] text-[11px] text-slate-300">
              <Clock className="w-3 h-3" /> Resets in <span className="font-mono">{reset.text}</span>
            </span>
          )}
        </div>
      </section>

      {/* Actions */}
      {!unlimited && (
        <button
          type="button"
          onClick={onOpenPricing}
          className="w-full h-12 rounded-2xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 active:scale-[0.99] transition inline-flex items-center justify-center gap-2 cursor-pointer"
        >
          {isPremium ? 'Refill or change plan' : 'Upgrade to Pro'} <ArrowRight className="w-4 h-4" />
        </button>
      )}
      <button
        type="button"
        onClick={onOpenGiftModal}
        className="w-full h-12 rounded-2xl border border-white/[0.1] text-slate-200 text-sm font-medium hover:bg-white/[0.05] hover:border-white/[0.18] transition inline-flex items-center justify-center gap-2 cursor-pointer"
      >
        <Gift className="w-4 h-4 text-cyan-300" /> Gift credits to a trader
      </button>

      {/* Pro perks */}
      {!isPremium && !unlimited && (
        <section className="rounded-3xl border border-indigo-400/20 bg-indigo-500/[0.05] p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Sparkles className="w-4 h-4 text-indigo-300" /> What you get with Pro
          </div>
          <ul className="mt-3 space-y-2 text-[13px] text-slate-300">
            {[`${B.proDailyAnalyses} analyses every day (vs ${B.freeDailyAnalyses} on Free)`, 'Verified trader badge', 'Secure Paystack billing'].map(perk => (
              <li key={perk} className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-indigo-400/20 text-indigo-200 flex items-center justify-center">
                  <Check className="w-2.5 h-2.5" />
                </span>
                {perk}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
