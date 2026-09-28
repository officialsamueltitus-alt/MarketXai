import React, { useEffect, useState } from 'react';
import { UserProfile, XShareReward } from '../types';
import { generateProfileShareCard, downloadCardImage } from '../utils/generateProfileShareCard';
import { Download, Check, Copy, X, Clock, Gift, Loader2, ArrowUpRight, Lock } from 'lucide-react';
import { useCampaignProgress, useCountdown } from './CampaignBanner';
import { MARKETX_X_URL, openExternal } from '../utils/campaign';

interface ShareProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile;
  // Registers the share reward on the server; resolves to an error message, or null on success
  onRegisterShareReward: () => Promise<string | null>;
  existingReward?: XShareReward | null;
}

export const ShareProfileModal: React.FC<ShareProfileModalProps> = ({
  isOpen,
  onClose,
  userProfile,
  onRegisterShareReward,
  existingReward,
}) => {
  const [cardDataUrl, setCardDataUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [isPosting, setIsPosting] = useState(false);
  const [progress, updateProgress] = useCampaignProgress(userProfile.username);

  const isPending = existingReward?.status === 'pending';
  const isCredited = existingReward?.status === 'credited';
  const countdown = useCountdown(existingReward?.unlockAt, isOpen && isPending);

  // Render the personal share card when the modal opens (or the profile identity changes)
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsGenerating(true);
    generateProfileShareCard(userProfile)
      .then(url => !cancelled && setCardDataUrl(url))
      .catch(err => console.error('Failed to generate card:', err))
      .finally(() => !cancelled && setIsGenerating(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, userProfile.username, userProfile.displayName, userProfile.avatarUrl, userProfile.isVerified]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const xWriteup = `I Trade with @_MarketXai ⚡\n\nTrader: @${userProfile.username || 'trader'}\nWebsite: https://marketx.world\n\n#MarketX #Trading #AI`;

  const done = {
    follow: progress.follow || !!existingReward,
    engage: progress.engage || !!existingReward,
    download: progress.download || !!existingReward,
    post: !!existingReward,
    reward: isCredited,
  };
  const canPost = done.follow && done.engage && done.download;

  const handleDownload = () => {
    if (!cardDataUrl) return;
    downloadCardImage(cardDataUrl, userProfile.username);
    updateProgress({ download: true });
  };

  // Opens the user's X composer with the post pre-written (no X API needed), then starts the server-timed reward
  const handlePost = () => {
    setShareError(null);
    openExternal(`https://x.com/intent/tweet?text=${encodeURIComponent(xWriteup)}`);
    if (existingReward) return;
    setIsPosting(true);
    onRegisterShareReward()
      .then(error => error && setShareError(error))
      .finally(() => setIsPosting(false));
  };

  const StepDot = ({ n, isDone, isActive }: { n: number | React.ReactNode; isDone: boolean; isActive: boolean }) => (
    <span
      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-colors ${
        isDone ? 'bg-emerald-400 text-slate-950' : isActive ? 'bg-white text-slate-950' : 'bg-white/[0.06] text-slate-500'
      }`}
    >
      {isDone ? <Check className="w-3.5 h-3.5" /> : n}
    </span>
  );

  const activeId = !done.follow ? 'follow' : !done.engage ? 'engage' : !done.download ? 'download' : !done.post ? 'post' : 'reward';
  const rowClass = (id: string, isDone: boolean) =>
    `flex items-start gap-3 p-3.5 rounded-2xl border transition-colors ${
      isDone ? 'border-emerald-500/15 bg-emerald-500/[0.04]' : activeId === id ? 'border-indigo-400/30 bg-indigo-500/[0.06]' : 'border-white/[0.06] bg-white/[0.02]'
    }`;
  const actionBtn =
    'h-8 px-3 rounded-full text-xs font-medium inline-flex items-center gap-1.5 transition active:scale-[0.97] cursor-pointer shrink-0';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/70 mx-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Earn credits on X"
    >
      <div
        className="mx-pop-in relative w-full sm:max-w-xl rounded-t-[28px] sm:rounded-[28px] bg-[var(--mx-bg-2)] border border-white/[0.08] shadow-[0_24px_80px_-12px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col max-h-[92dvh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-indigo-300">Campaign · +10 credits</p>
            <h2 className="text-lg font-semibold text-white tracking-tight">Share MarketX on X</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-2.5 pb-safe">
          {/* Step 1: Follow */}
          <div className={rowClass('follow', done.follow)}>
            <StepDot n={1} isDone={done.follow} isActive={activeId === 'follow'} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white">
                Follow{' '}
                <button
                  type="button"
                  onClick={() => {
                    updateProgress({ follow: true });
                    openExternal(MARKETX_X_URL);
                  }}
                  className="font-semibold underline decoration-indigo-400/60 underline-offset-4 hover:decoration-indigo-300 cursor-pointer"
                  title="Open @_MarketXai on X"
                >
                  Market<span className="text-indigo-300">X</span>
                </button>{' '}
                on X
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Tap MarketX to open @_MarketXai and hit Follow.</p>
            </div>
          </div>

          {/* Step 2: Comment, tag, repost */}
          <div className={rowClass('engage', done.engage)}>
            <StepDot n={2} isDone={done.engage} isActive={activeId === 'engage'} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white">Comment, tag 2 trader friends & repost</div>
              <p className="text-xs text-slate-500 mt-0.5">On the pinned post at @_MarketXai.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                updateProgress({ engage: true });
                openExternal(MARKETX_X_URL);
              }}
              className={`${actionBtn} bg-white/[0.06] text-slate-200 hover:bg-white/[0.12]`}
            >
              Open post <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Step 3: Download card */}
          <div className={rowClass('download', done.download)}>
            <StepDot n={3} isDone={done.download} isActive={activeId === 'download'} />
            <div className="flex-1 min-w-0 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-white">Download your trader card</div>
                  <p className="text-xs text-slate-500 mt-0.5">HD 16:9 card with @{userProfile.username}.</p>
                </div>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!cardDataUrl}
                  className={`${actionBtn} bg-white/[0.06] text-slate-200 hover:bg-white/[0.12] disabled:opacity-50`}
                >
                  <Download className="w-3.5 h-3.5" /> {done.download ? 'Again' : 'Download'}
                </button>
              </div>
              <div className="relative rounded-xl overflow-hidden ring-1 ring-white/[0.08] bg-black/40 aspect-video flex items-center justify-center">
                {isGenerating || !cardDataUrl ? (
                  <Loader2 className="w-5 h-5 text-slate-500 animate-spin" />
                ) : (
                  <img src={cardDataUrl} alt="Your MarketX trader card" className="w-full h-full object-cover select-none" />
                )}
              </div>
            </div>
          </div>

          {/* Step 4: Post on X */}
          <div className={rowClass('post', done.post)}>
            <StepDot n={4} isDone={done.post} isActive={activeId === 'post'} />
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <div className="text-sm font-medium text-white">Post on X</div>
                <p className="text-xs text-slate-500 mt-0.5">Opens X with this post ready. Attach your card and publish.</p>
              </div>
              <div className="relative rounded-xl bg-black/30 ring-1 ring-white/[0.06] p-3 pr-10 text-[13px] text-slate-300 whitespace-pre-line leading-relaxed">
                {xWriteup}
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(xWriteup).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                  className="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] cursor-pointer"
                  title="Copy text"
                  aria-label="Copy post text"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                type="button"
                onClick={handlePost}
                disabled={!canPost || isPosting}
                className="w-full h-11 rounded-2xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 active:scale-[0.99] transition inline-flex items-center justify-center gap-2 disabled:bg-white/[0.06] disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer"
              >
                {isPosting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : !canPost ? (
                  <Lock className="w-4 h-4" />
                ) : (
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                )}
                {!canPost ? 'Complete steps 1 to 3 first' : done.post ? 'Post again on X (no extra credits)' : 'Post on X'}
              </button>
              {shareError && <p className="text-xs text-rose-300">{shareError}</p>}
            </div>
          </div>

          {/* Step 5: Reward */}
          <div className={rowClass('reward', !!done.reward)}>
            <StepDot n={<Gift className="w-3.5 h-3.5" />} isDone={!!done.reward} isActive={activeId === 'reward'} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white">+10 credits</div>
              <p className="text-xs text-slate-500 mt-0.5">
                {isCredited
                  ? existingReward?.previouslyClaimed
                    ? 'Already claimed with your email. The campaign can only be claimed once per person.'
                    : 'Added to your balance. Claimed once, thank you!'
                  : isPending
                  ? 'Unlocks automatically, with an email confirmation.'
                  : 'Credited 10 hours after you post.'}
              </p>
            </div>
            {isPending && (
              <span className="h-7 px-2.5 rounded-full bg-cyan-500/10 text-cyan-300 text-xs font-mono inline-flex items-center gap-1.5 shrink-0">
                <Clock className="w-3.5 h-3.5" /> {countdown}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
