import React, { useState, useEffect } from 'react';
import { UserProfile, XShareReward } from '../types';
import { generateProfileShareCard, downloadCardImage } from '../utils/generateProfileShareCard';
import {
  Download,
  CheckCircle2,
  Clock,
  Sparkles,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  X,
  Mail,
  Zap,
  Copy,
  Check,
  Flame
} from 'lucide-react';


interface ShareProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile;
  onRegisterShareReward: (reward: XShareReward) => void;
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
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const [shareStep, setShareStep] = useState<'download' | 'confirm' | 'scheduled'>('download');
  const [timeRemainingStr, setTimeRemainingStr] = useState<string>('');
  const [copiedWriteup, setCopiedWriteup] = useState(false);

  // Generate card preview whenever modal opens
  useEffect(() => {
    if (!isOpen) return;

    if (existingReward && existingReward.status === 'pending') {
      setShareStep('scheduled');
    } else {
      setShareStep('download');
      setHasDownloaded(false);
    }

    setIsGenerating(true);
    generateProfileShareCard(userProfile)
      .then(url => {
        setCardDataUrl(url);
      })
      .catch(err => {
        console.error('Failed to generate card:', err);
      })
      .finally(() => {
        setIsGenerating(false);
      });
  }, [isOpen, userProfile, existingReward]);

  // Countdown timer for pending reward (10 hours)
  useEffect(() => {
    if (!existingReward || existingReward.status !== 'pending') return;

    const updateRemaining = () => {
      const diff = existingReward.unlockAt - Date.now();
      if (diff <= 0) {
        setTimeRemainingStr('00h 00m 00s (Unlocking...)');
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeRemainingStr(
        `${hours.toString().padStart(2, '0')}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`
      );
    };

    updateRemaining();
    const timer = setInterval(updateRemaining, 1000);
    return () => clearInterval(timer);
  }, [existingReward]);

  if (!isOpen) return null;

  // Handle Download button click
  const handleDownload = () => {
    if (!cardDataUrl) return;
    downloadCardImage(cardDataUrl, userProfile.username);
    setHasDownloaded(true);
  };

  // Catchy, sleek writeup for X promotion
  const xWriteup = `I Trade with @_MarketXai ⚡\n\nTrader: @${userProfile.username || 'trader'}\nWebsite: https://marketx.world\n\n#MarketX #Trading #AI`;

  // Handle "I have downloaded" trigger
  const handleConfirmDownloaded = () => {
    // 1. Create and schedule the 10-hour reward
    const now = Date.now();
    const tenHoursMs = 10 * 60 * 60 * 1000;
    const newReward: XShareReward = {
      id: `x-share-${now}`,
      username: userProfile.username,
      email: userProfile.email || 'trader@marketx.world',
      sharedAt: now,
      unlockAt: now + tenHoursMs,
      creditsAwarded: 10,
      status: 'pending',
      notifiedOnSite: false,
      notifiedEmail: false,
    };

    onRegisterShareReward(newReward);
    setShareStep('scheduled');

    // 2. Redirect to X with catchy promotion
    const tweetIntentUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(xWriteup)}`;
    window.open(tweetIntentUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-2xl rounded-3xl bg-[#090b14] border border-indigo-500/30 shadow-2xl shadow-indigo-950/50 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Accent Header */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between bg-gradient-to-r from-indigo-950/50 via-slate-900/50 to-[#090b14]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-black border border-white/20 flex items-center justify-center text-white font-bold font-mono text-sm">
              𝕏
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                <span>Share Profile on X</span>
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-mono font-semibold border border-cyan-500/30">
                  +10 Credits Reward
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Official share card: <span className="text-cyan-300 font-semibold">"I Trade with MarketX Ai"</span> for <span className="text-indigo-300 font-mono font-semibold">@{userProfile.username}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* Card Preview Container */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span className="font-semibold flex items-center gap-1.5 text-white">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                Generated Trader Card (16:9 Ultra HD)
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                2400 × 1350 px (Ultra HD) • Twitter / X Ready
              </span>
            </div>

            <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black/60 shadow-xl group aspect-video flex items-center justify-center">
              {isGenerating ? (
                <div className="flex flex-col items-center gap-2 text-indigo-300">
                  <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                  <span className="text-xs font-mono">Rendering custom trader card...</span>
                </div>
              ) : cardDataUrl ? (
                <>
                  <img
                    src={cardDataUrl}
                    alt="MarketX Trader Card"
                    className="w-full h-full object-contain select-none"
                  />
                  {/* Subtle download overlay on hover */}
                  <div
                    onClick={handleDownload}
                    className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer backdrop-blur-[2px]"
                  >
                    <div className="px-4 py-2 rounded-xl bg-white text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg">
                      <Download className="w-4 h-4 text-indigo-600" />
                      <span>Click to Download</span>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          {/* Reward Flow Steps */}
          {shareStep !== 'scheduled' ? (
            <div className="space-y-3.5">
              {/* Step 1: Download Notification */}
              <div className="p-3.5 rounded-2xl bg-indigo-950/30 border border-indigo-500/25 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-indigo-500/30 text-indigo-300 text-[11px] font-bold flex items-center justify-center shrink-0 border border-indigo-400/30">
                      1
                    </span>
                    <span className="text-xs font-bold text-white">
                      Download Your Official Card (Important)
                    </span>
                    {hasDownloaded && (
                      <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-0.5">
                        <CheckCircle2 className="w-3 h-3 inline" /> Downloaded!
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-300 pl-7 leading-relaxed">
                    Save the card image to your device so you can attach it to your post on X.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleDownload}
                  className={`w-full sm:w-auto px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer shrink-0 active:scale-95 ${
                    hasDownloaded
                      ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                      : 'bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white border border-white/20'
                  }`}
                >
                  <Download className="w-4 h-4" />
                  <span>{hasDownloaded ? 'Download Again' : 'Download Image'}</span>
                </button>
              </div>

              {/* Step 2: Post on X & Claim Reward */}
              <div className="p-4 rounded-2xl bg-gradient-to-b from-[#101426] to-[#0a0d18] border border-cyan-500/25 space-y-3 shadow-xl">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-300 text-xs font-bold flex items-center justify-center shrink-0 border border-cyan-400/30">
                      2
                    </span>
                    <span className="text-xs sm:text-sm font-bold text-white">
                      Post on 𝕏 & Receive +10 AI Credits
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold whitespace-nowrap shrink-0">
                    +10 Credits
                  </span>
                </div>

                <p className="text-xs text-slate-300 sm:pl-8 leading-relaxed">
                  After downloading your card, click <strong className="text-white">"I have downloaded"</strong> below. You'll be redirected straight to X with your post pre-written. Attach your downloaded card and post it!
                </p>

                {/* Pre-filled Tweet Preview with Copy Option */}
                <div className="sm:ml-8 p-3 rounded-xl bg-black/60 border border-white/[0.08] text-xs text-slate-300 font-mono space-y-2">
                  <div className="flex items-center justify-between text-[11px] pb-1 border-b border-white/[0.06]">
                    <span className="text-cyan-400 font-bold flex items-center gap-1.5">
                      <span>𝕏 Post Writeup</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-400 font-normal">@_MarketXai</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(xWriteup);
                        setCopiedWriteup(true);
                        setTimeout(() => setCopiedWriteup(false), 2000);
                      }}
                      className="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white flex items-center gap-1 transition-all cursor-pointer text-[10px]"
                    >
                      {copiedWriteup ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedWriteup ? 'Copied' : 'Copy Text'}</span>
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-200 whitespace-pre-line leading-relaxed font-sans">
                    {xWriteup}
                  </p>
                </div>

                {/* Action CTA: "I have downloaded" */}
                <div className="pt-1.5 sm:pl-8 flex flex-col sm:flex-row items-center gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmDownloaded}
                    className="w-full flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-cyan-500 hover:from-indigo-400 hover:to-cyan-400 text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-950/60 transition-all hover:scale-[1.01] active:scale-[0.98] cursor-pointer"
                  >
                    <span>I have downloaded — Open 𝕏 & Claim</span>
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-[10px] text-slate-400 text-center sm:pl-8">
                  *Once clicked, 10 credits are automatically allocated after a 10-hour verification window, with confirmation sent to your email.
                </p>
              </div>
            </div>
          ) : (
            /* Scheduled Reward Active View */
            <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-950/40 via-slate-900/60 to-black border border-indigo-500/30 space-y-3.5">
              <div className="flex items-center gap-2.5 text-emerald-400">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <div>
                  <h4 className="text-xs sm:text-sm font-bold text-white">
                    Profile Share Successfully Recorded on X!
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Thank you for promoting MarketX with your official trader card.
                  </p>
                </div>
              </div>

              {/* Countdown Tracker Box */}
              <div className="p-3 rounded-xl bg-black/50 border border-indigo-500/30 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                  <Clock className="w-4 h-4 text-cyan-400 animate-pulse shrink-0" />
                  <div>
                    <span className="text-slate-400 text-[10px] block">Credit Unlock Countdown</span>
                    <span className="font-mono text-cyan-300 font-bold text-sm">
                      {timeRemainingStr || '10h 00m 00s'}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-slate-400 block">Reward Amount</span>
                  <span className="text-emerald-400 font-mono font-bold text-sm flex items-center gap-1 justify-end">
                    <Zap className="w-3.5 h-3.5 fill-emerald-400" />
                    +10 Credits
                  </span>
                </div>
              </div>

              {/* Notification Notice */}
              <div className="space-y-1 text-xs text-slate-300">
                <div className="flex items-center gap-2 text-[11px] text-slate-300">
                  <Mail className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>
                    Notification will be delivered to <strong className="text-white font-mono">{userProfile.email || 'your registered email'}</strong>
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-slate-300">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>
                    In-app notification and badge will appear on your profile.
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3.5 sm:p-4 border-t border-white/[0.08] bg-black/40 flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <a
              href="https://x.com/_MarketXai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-400 hover:text-white flex items-center gap-1 font-mono transition-colors"
            >
              <span>@_MarketXai</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <span className="text-slate-600 hidden sm:inline">•</span>
            <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
              Built by SpiriTech Labs
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-white font-semibold text-xs transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
