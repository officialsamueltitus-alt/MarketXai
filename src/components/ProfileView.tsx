import React, { useState, useEffect } from 'react';
import { UserProfile, CreditState, XShareReward } from '../types';
import { VerifiedBadge } from './VerifiedBadge';
import { MarketXText } from './MarketXText';
import { EditProfileModal } from './EditProfileModal';
import { DeleteAccountModal } from './DeleteAccountModal';
import { formatTokens, TOKENS_PER_USAGE } from '../utils/tokens';
import { DEFAULT_BENEFITS as B } from '../utils/apiClient';
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
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
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

  const isUnlimited = isUnlimitedUser(userProfile.email);
  const planLabel = isUnlimited
    ? 'VIP Unlimited'
    : isPremium
    ? userProfile.subscription.plan === 'yearly'
      ? 'Pro · Yearly'
      : 'Pro · Monthly'
    : 'Free';
  const dailyLeft = isUnlimited ? '∞' : formatTokens(creditState.dailyUsageRemaining * TOKENS_PER_USAGE);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 overscroll-contain pb-safe">
      {/* Identity card */}
      <section className="relative rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] overflow-hidden">
        <div className="h-20 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(139,92,246,0.55),transparent_55%),radial-gradient(120%_120%_at_100%_0%,rgba(56,189,248,0.35),transparent_55%)]" />
        <button
          type="button"
          onClick={() => setIsEditModalOpen(true)}
          className="absolute top-3 right-3 h-8 px-3 rounded-full bg-black/40 hover:bg-black/60 text-xs font-medium text-white inline-flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <Edit3 className="w-3.5 h-3.5" /> Edit
        </button>
        <div className="px-4 pb-4 -mt-9">
          <div className="relative w-[72px] h-[72px]">
            <div className="w-full h-full rounded-[22px] overflow-hidden ring-4 ring-[var(--mx-surface)] bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-2xl font-semibold text-white">
              {userProfile.avatarUrl ? (
                <img src={userProfile.avatarUrl} alt={userProfile.username} className="w-full h-full object-cover" />
              ) : (
                userProfile.username.substring(0, 1).toUpperCase()
              )}
            </div>
            {(isPremium || isUnlimited) && (
              <span className="absolute -bottom-1 -right-1">
                <VerifiedBadge size="sm" />
              </span>
            )}
          </div>

          <div className="mt-3 flex items-center gap-1.5 min-w-0">
            <h3 className="text-lg font-semibold text-white tracking-tight truncate">
              {userProfile.displayName || 'MarketX Trader'}
            </h3>
          </div>
          <button
            type="button"
            onClick={handleCopyUsername}
            className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Copy username"
          >
            @{userProfile.username}
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-white/[0.05] text-slate-400">
              <Calendar className="w-3 h-3" /> Joined {joinedFormatted}
            </span>
            <span
              className={`inline-flex items-center gap-1 h-6 px-2.5 rounded-full ${
                userProfile.emailVerified ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-200'
              }`}
            >
              {userProfile.emailVerified ? <ShieldCheck className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
              {userProfile.emailVerified ? 'Email verified' : 'Email not verified'}
            </span>
          </div>
        </div>
      </section>

      {/* Credited reward notice */}
      {xShareReward && xShareReward.status === 'credited' && xShareReward.notifiedOnSite && (
        <div className="mx-rise flex items-start gap-3 p-3.5 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/20">
          <span className="w-8 h-8 rounded-full bg-emerald-400 text-slate-950 flex items-center justify-center shrink-0">
            <Check className="w-4 h-4" />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white">+10 credits added</div>
            <p className="text-xs text-slate-400 mt-0.5">Thanks for sharing MarketX on X. A receipt was emailed to you.</p>
          </div>
          {onDismissRewardNotice && (
            <button
              type="button"
              onClick={onDismissRewardNotice}
              className="w-7 h-7 rounded-full flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/[0.08] cursor-pointer"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Analyses', value: String(completedAnalysesCount) },
          { label: 'Credits', value: isUnlimited || creditState.availableCredits >= 99999 ? '∞' : String(creditState.availableCredits) },
          { label: 'Tokens today', value: dailyLeft },
        ].map(stat => (
          <div key={stat.label} className="rounded-2xl border border-white/[0.07] bg-[var(--mx-surface)] px-3 py-3">
            <div className="text-lg font-semibold text-white font-mono tracking-tight">{stat.value}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Plan */}
      <section className="rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Plan</p>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-base font-semibold text-white">{planLabel}</span>
              {(isPremium || isUnlimited) && <Sparkles className="w-4 h-4 text-amber-300" />}
            </div>
          </div>
          {!isPremium && !isUnlimited ? (
            <button
              type="button"
              onClick={onOpenPricing}
              className="h-9 px-4 rounded-full bg-white text-slate-950 text-sm font-medium hover:bg-slate-200 active:scale-[0.98] transition inline-flex items-center gap-1.5 cursor-pointer"
            >
              Upgrade <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <span className="h-7 px-2.5 rounded-full bg-emerald-500/10 text-emerald-300 text-xs font-medium inline-flex items-center">
              Active
            </span>
          )}
        </div>

        {isPremium && !isUnlimited && (
          <div className="mt-4 space-y-1.5">
            <div className="flex justify-between text-xs text-slate-400">
              <span>{subInfo.daysLeft} days left</span>
              <span>Renews {subInfo.expiresFormatted}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-cyan-300"
                style={{ width: `${subInfo.percentRemaining}%` }}
              />
            </div>
          </div>
        )}
        {!isPremium && !isUnlimited && (
          <p className="mt-2 text-xs text-slate-500">Pro gives {B.proDailyAnalyses} daily analyses (Free: {B.freeDailyAnalyses}) and a verified badge.</p>
        )}
        {isUnlimited && <p className="mt-2 text-xs text-slate-500">Unlimited analyses with no credit deductions.</p>}
      </section>

      {/* Campaign */}
      <CampaignBanner
        userProfile={userProfile}
        xShareReward={xShareReward}
        onOpenShareModal={() => setIsShareModalOpen(true)}
        onOpenEmailReceipt={() => setIsEmailModalOpen(true)}
        compact
      />

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onOpenGiftModal} className="mx-card group p-3.5 text-left cursor-pointer">
          <span className="w-9 h-9 rounded-xl bg-cyan-500/10 text-cyan-300 flex items-center justify-center">
            <Gift className="w-[18px] h-[18px]" />
          </span>
          <span className="block mt-3 text-sm font-medium text-white">Gift credits</span>
          <span className="block text-xs text-slate-500">Send to any @username</span>
        </button>
        <button type="button" onClick={onOpenPricing} className="mx-card group p-3.5 text-left cursor-pointer">
          <span className="w-9 h-9 rounded-xl bg-indigo-500/10 text-indigo-300 flex items-center justify-center">
            <CreditCard className="w-[18px] h-[18px]" />
          </span>
          <span className="block mt-3 text-sm font-medium text-white">Plans & billing</span>
          <span className="block text-xs text-slate-500">Upgrade or refill</span>
        </button>
      </div>

      {/* Support */}
      <a
        href="mailto:help.marketx@gmail.com?subject=MarketX%20Support&body=Hello%20MarketX%2C%0A%0AUsername%3A%20%0AQuestion%3A%20"
        className="mx-card flex items-center gap-3 p-3.5"
      >
        <span className="w-9 h-9 rounded-xl bg-white/[0.05] text-slate-300 flex items-center justify-center shrink-0">
          <Mail className="w-[18px] h-[18px]" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-white">Contact support</span>
          <span className="block text-xs text-slate-500">Replies in under 2 hours</span>
        </span>
        <ExternalLink className="w-4 h-4 text-slate-500" />
      </a>

      {onSignOut && (
        <button
          type="button"
          onClick={onSignOut}
          className="w-full h-11 rounded-2xl text-sm font-medium text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer"
        >
          Sign out
        </button>
      )}
      {onSignOut && (
        <button
          type="button"
          onClick={() => setIsDeleteOpen(true)}
          className="w-full h-9 rounded-xl text-xs text-slate-500 hover:text-rose-300 transition-colors cursor-pointer"
        >
          Delete account
        </button>
      )}
      <DeleteAccountModal
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        email={userProfile.email}
        onDeleted={() => {
          setIsDeleteOpen(false);
          onSignOut?.();
        }}
      />

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
