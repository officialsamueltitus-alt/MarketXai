import React from 'react';
import { Mail, CheckCircle2, Zap, X, ExternalLink, ShieldCheck, Sparkles } from 'lucide-react';
import { XShareReward } from '../types';

interface RewardEmailNotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  reward: XShareReward;
}

export const RewardEmailNotificationModal: React.FC<RewardEmailNotificationModalProps> = ({
  isOpen,
  onClose,
  reward,
}) => {
  if (!isOpen) return null;

  const dateFormatted = new Date(reward.unlockAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-lg rounded-3xl bg-[var(--mx-bg-2)] border border-cyan-500/30 shadow-2xl shadow-cyan-950/40 overflow-hidden">
        {/* Email Header Preview Bar */}
        <div className="p-4 bg-slate-900/90 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-300">
              <Mail className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-white block">Email Dispatch Notification</span>
              <span className="text-[10px] font-mono text-slate-400">Delivered to {reward.email}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Email Body */}
        <div className="p-5 sm:p-6 space-y-4">
          {/* Sender & Meta details */}
          <div className="space-y-1.5 pb-3 border-b border-white/[0.06] text-xs">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-slate-400">From:</span>
              <span className="font-mono text-indigo-300">MarketX Institutional Support</span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-slate-400">To:</span>
              <span className="font-mono text-slate-200 truncate max-w-[200px]">{reward.email} (@{reward.username})</span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-slate-400">Date:</span>
              <span className="font-mono text-slate-400">{dateFormatted}</span>
            </div>
            <div className="flex flex-col sm:flex-row sm:justify-between gap-0.5 pt-0.5 text-[11px]">
              <span className="text-slate-400 shrink-0">Subject:</span>
              <span className="font-semibold text-white sm:text-right">Credited +10 credits for sharing profile on X!</span>
            </div>
          </div>

          {/* Letter Content */}
          <div className="p-4 rounded-2xl bg-black/50 border border-white/[0.06] space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">10 Credits Successfully Credited</h4>
                <span className="text-[11px] text-slate-400">10-hour verification window completed</span>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Hello <strong className="text-white">@{reward.username}</strong>,
            </p>

            <p className="text-xs text-slate-300 leading-relaxed">
              Thank you for sharing your official MarketX profile card on <strong>X</strong> and tagging <span className="text-cyan-400 font-mono">@_MarketXai</span>.
            </p>

            <div className="p-3 rounded-xl bg-gradient-to-r from-indigo-950/60 via-slate-900/80 to-black border border-indigo-500/30 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-mono tracking-wider">Credits Awarded</span>
                <span className="text-emerald-400 font-mono font-black text-lg flex items-center gap-1">
                  <Zap className="w-4 h-4 fill-emerald-400" />
                  +10 Credits
                </span>
              </div>

              <div className="text-right">
                <span className="text-[10px] text-slate-400 block uppercase font-mono tracking-wider">Status</span>
                <span className="text-xs font-mono font-bold text-cyan-300">
                  AVAILABLE NOW
                </span>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Your 10 credits have been added directly to your account balance. You can use them immediately to run AI market analyses across crypto, forex, commodities, and equities.
            </p>

            <div className="pt-2 border-t border-white/[0.06] space-y-1 text-[11px] text-slate-400">
              <div>MarketX Institutional Trading Engine</div>
              <div className="flex items-center gap-3">
                <a href="mailto:help.marketx@gmail.com?subject=MarketX%20Trader%20Reward%20Inquiry" className="text-indigo-300 hover:underline">
                  Message Support via Mail
                </a>
                <span>•</span>
                <a
                  href="https://x.com/_MarketXai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:underline flex items-center gap-1"
                >
                  <span>@_MarketXai</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3.5 bg-black/40 border-t border-white/[0.08] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition-colors cursor-pointer"
          >
            Close Notification
          </button>
        </div>
      </div>
    </div>
  );
};
