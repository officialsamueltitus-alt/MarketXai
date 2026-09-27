import React, { useState, useEffect } from 'react';
import { XShareReward, UserProfile } from '../types';
import {
  Zap,
  Sparkles,
  Download,
  Clock,
  CheckCircle2,
  ArrowRight,
  ExternalLink,
  Mail,
  ShieldCheck,
  Flame
} from 'lucide-react';

interface CampaignBannerProps {
  userProfile: UserProfile;
  xShareReward?: XShareReward | null;
  onOpenShareModal: () => void;
  onOpenEmailReceipt?: () => void;
  className?: string;
  compact?: boolean;
}

export const CampaignBanner: React.FC<CampaignBannerProps> = ({
  userProfile,
  xShareReward,
  onOpenShareModal,
  onOpenEmailReceipt,
  className = '',
  compact = false,
}) => {
  const [countdownText, setCountdownText] = useState('');

  useEffect(() => {
    if (!xShareReward || xShareReward.status !== 'pending') return;

    const updateCountdown = () => {
      const diff = xShareReward.unlockAt - Date.now();
      if (diff <= 0) {
        setCountdownText('Unlocking +10 Credits...');
        return;
      }
      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);
      setCountdownText(
        `${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`
      );
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [xShareReward]);

  const isPending = xShareReward?.status === 'pending';
  const isCredited = xShareReward?.status === 'credited';

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-[#101013] via-[#17171a] to-[#0e0e11] ${
        compact ? 'p-3 sm:p-3.5' : 'p-4 sm:p-5 sm:rounded-3xl'
      } shadow-xl shadow-indigo-950/40 group ${className}`}
    >
      {/* Background Cyber Ambient Mesh */}
      <div className="absolute -right-12 -top-12 w-48 h-48 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -left-12 -bottom-12 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header Row */}
      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-white/[0.08]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-black border border-white/20 flex items-center justify-center text-white font-mono font-black text-base shadow-md shrink-0">
            𝕏
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] sm:text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 font-bold flex items-center gap-1 whitespace-nowrap">
                <Flame className="w-2.5 h-2.5 text-rose-400 shrink-0" />
                <span>Campaign</span>
              </span>
              <span className="text-[9px] sm:text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold flex items-center gap-1 whitespace-nowrap">
                <Zap className="w-2.5 h-2.5 fill-emerald-400 shrink-0" />
                <span>+10 Credits</span>
              </span>
            </div>
            <h3 className="text-xs sm:text-sm font-bold text-white tracking-tight mt-0.5 truncate">
              Post to 𝕏 & Earn +10 AI Credits
            </h3>
          </div>
        </div>

        {/* Live Status Indicator */}
        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          {isPending ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/35 text-cyan-300 text-[11px] font-mono">
              <Clock className="w-3 h-3 animate-pulse" />
              <span className="font-bold">{countdownText || '10h Pending'}</span>
            </div>
          ) : isCredited ? (
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-[11px] font-semibold">
              <CheckCircle2 className="w-3 h-3" />
              <span>Reward Claimed</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white/[0.05] border border-white/[0.1] text-[10px] font-mono text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
              <span>Live Campaign</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Campaign Body */}
      <div className="relative z-10 py-2.5 space-y-2.5">
        <p className="text-[11px] sm:text-xs text-slate-300 leading-relaxed font-normal">
          Share your custom card on 𝕏: <strong className="text-cyan-300 font-semibold">"I Trade with MarketX Ai"</strong>. Download your sleek 16:9 card with your username, post it tagging <strong className="text-white font-mono">@_MarketXai</strong>, and unlock +10 AI credits.
        </p>

        {compact ? (
          /* Compact 3-step badge path for Profile sidebar view */
          <div className="grid grid-cols-3 gap-1.5 py-1 text-center">
            <div className="p-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <span className="text-[9px] font-mono text-indigo-300 font-bold block">1. Download</span>
              <span className="text-[10px] text-slate-300 block font-medium truncate">HD Card</span>
            </div>
            <div className="p-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <span className="text-[9px] font-mono text-cyan-300 font-bold block">2. Post on 𝕏</span>
              <span className="text-[10px] text-slate-300 block font-medium truncate">Tag MarketX</span>
            </div>
            <div className="p-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
              <span className="text-[9px] font-mono text-emerald-300 font-bold block">3. Reward</span>
              <span className="text-[10px] text-slate-300 block font-medium truncate">+10 Credits</span>
            </div>
          </div>
        ) : (
          /* Full 3 Step Visual Path for wide views */
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <span className="w-5 h-5 rounded-full bg-indigo-500/30 border border-indigo-400/40 text-indigo-300 flex items-center justify-center text-[10px] shrink-0 font-mono">
                  1
                </span>
                <span>Download Ultra HD Card</span>
              </div>
              <p className="text-[11px] text-slate-400 pl-7 leading-snug">
                Instant 2400×1350 Ultra HD card customized with your verified username.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <span className="w-5 h-5 rounded-full bg-cyan-500/30 border border-cyan-400/40 text-cyan-300 flex items-center justify-center text-[10px] shrink-0 font-mono">
                  2
                </span>
                <span>Post to 𝕏 with Tag</span>
              </div>
              <p className="text-[11px] text-slate-400 pl-7 leading-snug">
                Attach the image and tweet with pre-crafted writeup tagging <span className="text-cyan-300">@_MarketXai</span>.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <span className="w-5 h-5 rounded-full bg-emerald-500/30 border border-emerald-400/40 text-emerald-300 flex items-center justify-center text-[10px] shrink-0 font-mono">
                  3
                </span>
                <span>+10 Credits Deposited</span>
              </div>
              <p className="text-[11px] text-slate-400 pl-7 leading-snug">
                10 hours automated verification with on-site alert & email confirmation receipt.
              </p>
            </div>
          </div>
        )}

        {/* Pending / Credited Details Box */}
        {isPending && (
          <div className="p-2.5 rounded-xl bg-black/50 border border-cyan-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-slate-200">
              <Clock className="w-4 h-4 text-cyan-400 animate-pulse shrink-0" />
              <span className="text-[11px]">
                Verification running: <strong className="font-mono text-cyan-300">{countdownText}</strong>
              </span>
            </div>
          </div>
        )}

        {isCredited && (
          <div className="p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-[11px] text-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                +10 Credits added to balance! {xShareReward?.email && <span className="text-white font-mono">Sent to {xShareReward.email}</span>}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Action Footer Button */}
      <div className="relative z-10 pt-2 flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-white/[0.06]">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono truncate max-w-full">
          <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="truncate">Official Initiative • SpiriTech Labs</span>
        </div>

        <div className="w-full sm:w-auto">
          <button
            type="button"
            onClick={onOpenShareModal}
            className="w-full sm:w-auto px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-500 via-indigo-600 to-cyan-500 hover:from-indigo-400 hover:to-cyan-400 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-indigo-950/60 transition-all hover:scale-[1.01] active:scale-[0.98] cursor-pointer"
          >
            <span>{isPending ? 'View Share Card & Progress' : isCredited ? 'Share Again on 𝕏' : 'Post to 𝕏 & Earn +10 Credits'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
