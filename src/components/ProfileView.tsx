import React, { useState, useEffect } from 'react';
import { UserProfile, CreditState, XShareReward } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import { MarketXText } from './MarketXText';
import { EditProfileModal } from './EditProfileModal';
import { ShareProfileModal } from './ShareProfileModal';
import { CampaignBanner } from './CampaignBanner';
import { RewardEmailNotificationModal } from './RewardEmailNotificationModal';
import { getSubscriptionRemainingInfo, isUnlimitedUser } from '../utils/creditManager';
import {
  User,
  ShieldCheck,
  Calendar,
  Zap,
  Gift,
  CreditCard,
  Edit3,
  Sparkles,
  Award,
  Clock,
  Copy,
  CheckCircle2,
  Check,
  ExternalLink,
  Mail,
  Share2,
  ArrowRight,
  BellRing,
  X
} from 'lucide-react';

interface ProfileViewProps {
  userProfile: UserProfile;
  creditState: CreditState;
  onUpdateUsername?: (newUsername: string) => void;
  onUpdateProfile: (updated: { displayName: string; username: string; avatarUrl?: string }) => Promise<string | null>;
  onOpenPricing: () => void;
  onOpenGiftModal: () => void;
  completedAnalysesCount?: number;
  xShareReward?: XShareReward | null;
  onRegisterShareReward?: () => Promise<string | null>;
  onDismissRewardNotice?: () => void;
  onSignOut?: () => void;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  userProfile,
  creditState,
  onUpdateUsername,
  onUpdateProfile,
  onOpenPricing,
  onOpenGiftModal,
  completedAnalysesCount = 0,
  xShareReward,
  onRegisterShareReward,
  onDismissRewardNotice,
  onSignOut,
}) => {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [countdownText, setCountdownText] = useState<string>('');

  const subInfo = getSubscriptionRemainingInfo(userProfile);
  const isPremium = userProfile.subscription.active && !subInfo.isExpired;

  const handleCopyUsername = () => {
    navigator.clipboard.writeText(`@${userProfile.username}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const joinedFormatted = new Date(userProfile.joinedAt).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
  });

  // Countdown timer for pending X share reward
  useEffect(() => {
    if (!xShareReward || xShareReward.status !== 'pending') return;

    const updateTimer = () => {
      const diff = xShareReward.unlockAt - Date.now();
      if (diff <= 0) {
        setCountdownText('Unlocking +10 Credits...');
        return;
      }
      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      setCountdownText(`${h}h ${m}m ${s}s remaining`);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [xShareReward]);

  return (
    <div className="flex-1 overflow-y-auto p-2.5 sm:p-3.5 pb-20 sm:pb-8 space-y-3 sm:space-y-4 overscroll-contain pb-safe">
      {/* Profile Header Card */}
      <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-b from-indigo-950/40 via-slate-900/50 to-black/40 border border-indigo-500/30 shadow-lg relative overflow-hidden">
        {/* Subtle decorative glow */}
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-center justify-between gap-2 relative z-10">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            {/* Avatar with status indicator */}
            <div className="relative shrink-0">
              <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl overflow-hidden bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center text-white font-bold text-base sm:text-lg shadow-md border border-white/20">
                {userProfile.avatarUrl ? (
                  <img
                    src={userProfile.avatarUrl}
                    alt={userProfile.username}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>{userProfile.username.substring(0, 2).toUpperCase()}</span>
                )}
              </div>
              {isPremium && (
                <div className="absolute -bottom-1 -right-1">
                  <VerifiedBadge size="sm" />
                </div>
              )}
            </div>

            {/* Names & Username */}
            <div className="space-y-0.5 min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <h3 className="text-sm sm:text-base font-bold text-white truncate">
                  {userProfile.displayName || 'MarketX Trader'}
                </h3>
                {isPremium && <VerifiedBadge size="sm" />}
              </div>

              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs text-indigo-300 font-mono font-semibold truncate">
                  @{userProfile.username}
                </span>
                <button
                  type="button"
                  onClick={handleCopyUsername}
                  className="text-slate-400 hover:text-white p-0.5 transition-colors cursor-pointer shrink-0"
                  title="Copy Username"
                  aria-label="Copy Username"
                >
                  {copied ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Edit Profile Button */}
          <button
            type="button"
            onClick={() => setIsEditModalOpen(true)}
            className="px-2.5 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 hover:text-white border border-white/[0.1] text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs cursor-pointer shrink-0 active:scale-95"
            title="Edit Profile"
            aria-label="Edit Profile"
          >
            <Edit3 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-[11px] sm:text-xs">Edit</span>
          </button>
        </div>

        {/* User Details & Join Date - Responsive stacking on narrow screens */}
        <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-1.5 text-slate-400">
          <div className="flex items-center gap-1 font-mono text-[10px] sm:text-[11px] shrink-0">
            <Calendar className="w-3 h-3 text-slate-500 shrink-0" />
            <span>Member since {joinedFormatted}</span>
          </div>
          <div className="flex items-center gap-1 font-mono text-[10px] sm:text-[11px] text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-pulse" />
            <span>Terminal Connected</span>
          </div>
        </div>
      </div>

      {/* On-Site Notification Banner for Credited Reward */}
      {xShareReward && xShareReward.status === 'credited' && xShareReward.notifiedOnSite && (
        <div className="p-3 rounded-2xl bg-gradient-to-r from-emerald-950/50 via-slate-900/60 to-black border border-emerald-500/40 shadow-xl space-y-1.5 relative animate-fadeIn">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              <div className="w-7 h-7 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center shrink-0 mt-0.5">
                <CheckCircle2 className="w-4 h-4" />
              </div>
              <div className="space-y-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h4 className="text-xs font-bold text-white">
                    Reward Credited: +10 Credits Added!
                  </h4>
                  <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-mono font-bold whitespace-nowrap">
                    ACTIVE
                  </span>
                </div>
                <p className="text-[10px] sm:text-[11px] text-slate-300 leading-relaxed break-words">
                  You have been credited with <strong>10 credits</strong> for sharing your profile on X! Confirmation sent to <span className="font-mono text-cyan-300 break-all">{xShareReward.email}</span>.
                </p>
              </div>
            </div>

            {onDismissRewardNotice && (
              <button
                type="button"
                onClick={onDismissRewardNotice}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer shrink-0"
                title="Dismiss banner"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Redesigned Official Campaign & Post to X Container (Compact for Profile) */}
      <CampaignBanner
        userProfile={userProfile}
        xShareReward={xShareReward}
        onOpenShareModal={() => setIsShareModalOpen(true)}
        onOpenEmailReceipt={() => setIsEmailModalOpen(true)}
        compact={true}
      />

      {/* Subscription Tier Card */}
      <div className="p-3 sm:p-3.5 rounded-2xl bg-black/40 border border-white/[0.08] space-y-2.5">
        <div className="flex items-center justify-between flex-wrap gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Account Status & Tier
          </span>
          {isUnlimitedUser(userProfile.email) ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 bg-gradient-to-r from-amber-500/20 to-cyan-500/20 text-amber-300 border-amber-400/50 whitespace-nowrap shrink-0">
              <Sparkles className="w-2.5 h-2.5 shrink-0" />
              <span className="whitespace-nowrap">VIP Unlimited Account</span>
            </span>
          ) : isPremium ? (
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 shrink-0 ${
                userProfile.subscription.plan === 'yearly'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              }`}
            >
              <Sparkles className="w-2.5 h-2.5 shrink-0" />
              <span className="whitespace-nowrap">{userProfile.subscription.plan === 'yearly' ? 'Yearly VIP (-13% Off)' : 'Monthly Pro'}</span>
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium border bg-white/[0.04] text-slate-300 border-white/[0.08] whitespace-nowrap shrink-0">
              Standard Free
            </span>
          )}
        </div>

        {isUnlimitedUser(userProfile.email) ? (
          <div className="p-2.5 sm:p-3 rounded-xl bg-gradient-to-b from-amber-950/30 via-slate-900/40 to-black/30 border border-amber-500/40 space-y-2">
            <div className="flex items-center justify-between text-xs flex-wrap gap-1">
              <span className="text-amber-200 font-semibold flex items-center gap-1 text-[11px] sm:text-xs">
                <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Unlimited VIP Trader (Lifetime Access)</span>
              </span>
              <span className="text-[10px] font-mono text-cyan-300 font-bold">
                ∞ Unlimited
              </span>
            </div>

            <div className="text-[10px] sm:text-[11px] text-slate-300 space-y-1">
              <div className="flex justify-between items-center text-slate-400">
                <span>Account Status</span>
                <span className="text-emerald-400 font-mono font-bold">
                  Permanent Active
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Credits & Quota</span>
                <span className="text-amber-300 font-mono font-semibold">
                  Zero deduction / Infinite compute
                </span>
              </div>
            </div>
          </div>
        ) : isPremium ? (
          <div className="p-2.5 sm:p-3 rounded-xl bg-indigo-950/30 border border-indigo-500/30 space-y-2">
            <div className="flex items-center justify-between text-xs flex-wrap gap-1">
              <span className="text-indigo-200 font-semibold flex items-center gap-1 text-[11px] sm:text-xs">
                <ShieldCheck className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                <span>Verified Pro Trader</span>
              </span>
              <span className="text-[10px] font-mono text-cyan-300">
                {subInfo.daysLeft} days left
              </span>
            </div>

            <div className="text-[10px] sm:text-[11px] text-slate-300 space-y-1">
              <div className="flex justify-between items-center text-slate-400">
                <span>Billing cycle</span>
                <span className="text-slate-200 font-mono font-medium">
                  {userProfile.subscription.plan === 'yearly' ? '$187.92 / year (-13% OFF)' : '$18 / month'}
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-400">
                <span>Expires / Renews</span>
                <span className="text-indigo-300 font-mono font-semibold">
                  {subInfo.expiresFormatted}
                </span>
              </div>
            </div>

            <div className="space-y-1 pt-0.5">
              <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-400 to-indigo-500 rounded-full"
                  style={{ width: `${subInfo.percentRemaining}%` }}
                />
              </div>
              <p className="text-[9px] text-slate-400 text-center">
                Renews automatically at the end of billing period.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-2.5 sm:p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] text-xs text-slate-300 space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white text-[11px]">Daily Compute Quota</span>
              <span className="font-mono text-indigo-300 text-[10px] font-bold">10 / day</span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-slate-400 leading-relaxed">
              Quota renewed every 24h with institutional liquidity sweeps and automated Fib retracement levels.
            </p>
          </div>
        )}
      </div>

      {/* Quick Actions Grid */}
      <div className="grid grid-cols-2 gap-2">
        {/* Gift Credits Button */}
        <button
          type="button"
          onClick={onOpenGiftModal}
          className="p-2.5 sm:p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.08] text-left transition-all group flex flex-col justify-between shadow-xs cursor-pointer min-w-0"
        >
          <div className="flex items-center justify-between w-full mb-1">
            <Gift className="w-3.5 h-3.5 text-cyan-400 group-hover:scale-110 transition-transform shrink-0" />
            <span className="text-[9px] font-mono text-indigo-300 font-semibold">Gift</span>
          </div>
          <span className="text-xs font-bold text-white block truncate">Gift Credits</span>
          <span className="text-[10px] text-slate-400 block truncate">To @username</span>
        </button>

        {/* Refill Credits Button */}
        <button
          type="button"
          onClick={onOpenPricing}
          className="p-2.5 sm:p-3 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-left transition-all group flex flex-col justify-between shadow-xs cursor-pointer min-w-0"
        >
          <div className="flex items-center justify-between w-full mb-1">
            <CreditCard className="w-3.5 h-3.5 text-indigo-300 group-hover:scale-110 transition-transform shrink-0" />
            <span className="text-[9px] font-mono text-emerald-400 font-semibold">Paystack</span>
          </div>
          <span className="text-xs font-bold text-white block truncate">Refill & Plans</span>
          <span className="text-[10px] text-slate-400 block truncate">Manage billing</span>
        </button>
      </div>

      {/* Activity Summary Box */}
      <div className="p-3 sm:p-3.5 rounded-2xl bg-black/30 border border-white/[0.06] space-y-1.5">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
          Activity Summary
        </span>
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <span className="text-slate-400 text-[10px] block truncate">Total Analyses</span>
            <span className="text-sm sm:text-base font-bold font-mono text-white mt-0.5 block">
              {completedAnalysesCount}
            </span>
          </div>
          <div className="p-2 rounded-xl bg-white/[0.02] border border-white/[0.04]">
            <span className="text-slate-400 text-[10px] block truncate">Credits Available</span>
            <span className="text-sm sm:text-base font-bold font-mono text-cyan-300 mt-0.5 block">
              {creditState.availableCredits}
            </span>
          </div>
        </div>
      </div>

      {/* Institutional Support Desk */}
      <div className="p-3 sm:p-3.5 rounded-2xl bg-gradient-to-br from-[#0c0e18] to-black border border-white/[0.08] space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-1">
          <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>Support Desk</span>
          </span>
          <a
            href="https://x.com/_MarketXai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-mono text-slate-400 hover:text-white flex items-center gap-1"
          >
            <span>@_MarketXai</span>
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>

        <p className="text-[10px] sm:text-[11px] text-slate-400 leading-relaxed">
          Questions regarding your account, signals, billing, or X share rewards? Reach out directly.
        </p>

        <a
          href="mailto:help.marketx@gmail.com?subject=MarketX%20Trader%20Support&body=Hello%20MarketX%2C%0A%0AUsername%3A%20%0AQuery%3A%20"
          className="w-full py-2 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.1] text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
        >
          <Mail className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span>Message Support via Mail</span>
        </a>
      </div>

      {onSignOut && (
        <button
          type="button"
          onClick={onSignOut}
          className="w-full py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 hover:text-rose-200 text-xs font-semibold transition-colors cursor-pointer"
        >
          Sign out
        </button>
      )}

      {/* Modals */}
      <EditProfileModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        userProfile={userProfile}
        onSave={onUpdateProfile}
      />

      <ShareProfileModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        userProfile={userProfile}
        onRegisterShareReward={() =>
          onRegisterShareReward ? onRegisterShareReward() : Promise.resolve('Sign in to join the campaign.')
        }
        existingReward={xShareReward}
      />

      {xShareReward && (
        <RewardEmailNotificationModal
          isOpen={isEmailModalOpen}
          onClose={() => setIsEmailModalOpen(false)}
          reward={xShareReward}
        />
      )}
    </div>
  );
};
