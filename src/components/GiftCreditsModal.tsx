import React, { useState } from 'react';
import { MarketXText } from './MarketXText';
import { CreditGift, UserProfile } from '../types';
import {
  Gift,
  X,
  User,
  Zap,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowRight,
  Send
} from 'lucide-react';

interface GiftCreditsModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableCredits: number;
  userProfile: UserProfile;
  onSendGift: (toUsername: string, amount: number, note?: string) => boolean;
  recentGifts: CreditGift[];
}

export const GiftCreditsModal: React.FC<GiftCreditsModalProps> = ({
  isOpen,
  onClose,
  availableCredits,
  userProfile,
  onSendGift,
  recentGifts,
}) => {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState<number>(10);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const quickAmounts = [5, 10, 25, 50];
  const suggestedUsers = ['@satoshi_quant', '@alex_trader', '@institutional_flow', '@crypto_whale'];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const cleanUsername = recipient.trim().replace(/^@/, '');
    if (!cleanUsername) {
      setError('Please enter a recipient username');
      return;
    }

    if (cleanUsername.toLowerCase() === userProfile.username.toLowerCase()) {
      setError('You cannot gift credits to your own username');
      return;
    }

    if (amount <= 0 || !Number.isInteger(amount)) {
      setError('Please select a valid positive amount of credits');
      return;
    }

    if (amount > availableCredits) {
      setError(`Insufficient balance. You have ${availableCredits} credits available.`);
      return;
    }

    const success = onSendGift(cleanUsername, amount, note);
    if (success) {
      setSuccessMsg(`Successfully gifted ${amount} AI Credits to @${cleanUsername}!`);
      setRecipient('');
      setNote('');
      setTimeout(() => {
        setSuccessMsg(null);
        onClose();
      }, 1500);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md animate-fadeIn overflow-y-auto">
      <div className="relative w-full max-w-lg my-auto rounded-3xl bg-slate-950/80 backdrop-blur-3xl border border-white/[0.16] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Glow Header */}
        <div className="absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-indigo-600/25 via-cyan-500/10 to-transparent pointer-events-none" />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3.5 right-3.5 sm:top-4 sm:right-4 p-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] text-slate-200 hover:text-white border border-white/[0.12] transition-all cursor-pointer z-20"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 relative z-10 overflow-y-auto flex-1">
          {/* Header */}
          <div className="text-center space-y-1.5 pt-1">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-400 mx-auto flex items-center justify-center shadow-lg shadow-indigo-950/50 border border-white/20">
              <Gift className="w-5 h-5 text-white" />
            </div>
            <h3 className="text-xl font-bold text-white">Gift AI Credits</h3>
            <p className="text-xs text-slate-300">
              Transfer compute credits to any <MarketXText className="text-xs" /> trader using their username
            </p>
          </div>

          {/* Current Balance Bar */}
          <div className="p-3 rounded-xl bg-black/40 border border-white/[0.08] flex items-center justify-between text-xs">
            <span className="text-slate-300">Your Available Balance:</span>
            <div className="flex items-center gap-1.5 font-mono">
              <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
              <strong className="text-white text-sm font-bold">{availableCredits}</strong>
              <span className="text-slate-400">Credits</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Recipient Username Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-200 block">
                Recipient Username:
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 font-mono text-xs">
                  @
                </span>
                <input
                  type="text"
                  value={recipient}
                  onChange={e => setRecipient(e.target.value)}
                  placeholder="enter_username (e.g. satoshi_trader)"
                  className="w-full pl-7 pr-4 py-2.5 rounded-xl bg-black/50 border border-white/[0.1] text-white text-xs font-mono placeholder:text-slate-500 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 outline-none transition-all"
                  required
                />
              </div>

              {/* Quick suggestions */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
                <span className="text-slate-400">Popular:</span>
                {suggestedUsers.map(u => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setRecipient(u.replace(/^@/, ''))}
                    className="px-2 py-0.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-indigo-300 font-mono text-[10px] transition-colors"
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>

            {/* Credit Amount Selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-200 block">
                Credit Amount:
              </label>
              <div className="grid grid-cols-4 gap-2">
                {quickAmounts.map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setAmount(val)}
                    className={`py-2 rounded-xl text-xs font-mono font-bold transition-all border ${
                      amount === val
                        ? 'bg-indigo-600 text-white border-indigo-400 shadow-md'
                        : 'bg-black/40 text-slate-300 border-white/[0.08] hover:bg-white/[0.05]'
                    }`}
                  >
                    {val} Credits
                  </button>
                ))}
              </div>

              <div className="pt-1">
                <input
                  type="number"
                  min="1"
                  max={availableCredits}
                  value={amount}
                  onChange={e => setAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/[0.1] text-white text-xs font-mono placeholder:text-slate-500 focus:border-indigo-500 outline-none"
                  placeholder="Custom credit amount"
                />
              </div>
            </div>

            {/* Optional Note */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-200 block">
                Gift Note (Optional):
              </label>
              <input
                type="text"
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="e.g., Happy trading! Enjoy these AI credits."
                maxLength={80}
                className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/[0.1] text-white text-xs placeholder:text-slate-500 focus:border-indigo-500 outline-none"
              />
            </div>

            {/* Error / Success feedback */}
            {error && (
              <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={availableCredits <= 0 || amount > availableCredits}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/30 transition-all hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send {amount} AI Credits</span>
            </button>
          </form>

          {/* Recent Gifts History */}
          {recentGifts.length > 0 && (
            <div className="pt-3 border-t border-white/[0.08] space-y-2">
              <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
                Recent Gifts Sent
              </span>
              <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                {recentGifts.slice(0, 3).map(gift => (
                  <div
                    key={gift.id}
                    className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04] flex items-center justify-between text-[11px]"
                  >
                    <div className="flex items-center gap-1.5">
                      <Gift className="w-3 h-3 text-indigo-400" />
                      <span className="text-slate-200 font-mono font-semibold">
                        @{gift.toUsername}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-amber-300 font-bold">+{gift.amount} credits</span>
                      <span className="text-slate-500 text-[9px]">
                        {new Date(gift.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
