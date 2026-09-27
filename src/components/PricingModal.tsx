import React, { useState } from 'react';
import { MarketXText } from './MarketXText';
import { VerifiedBadge } from './VerifiedBadge';
import { UserProfile } from '../types';
import { isUnlimitedUser } from '../utils/creditManager';
import { formatMoney, apiFetch, PaymentsPublicConfig, DEFAULT_BENEFITS } from '../utils/apiClient';
import {
  X,
  Check,
  Zap,
  ShieldCheck,
  CreditCard,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  Lock,
  Sparkles,
  Infinity as InfinityIcon
} from 'lucide-react';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  userProfile: UserProfile;
  paymentsConfig: PaymentsPublicConfig | null;
  // Receives the updated account after the server verified the payment with Paystack
  onPaymentVerified: (account: any, plan: 'monthly' | 'yearly') => void;
}


declare global {
  interface Window {
    PaystackPop?: {
      setup: (options: {
        key: string;
        email: string;
        amount: number; // in lowest currency unit, e.g. cents
        currency?: string;
        ref?: string;
        channels?: string[];
        callback: (response: { reference: string }) => void;
        onClose: () => void;
      }) => {
        openIframe: () => void;
      };
    };
  }
}

export const PricingModal: React.FC<PricingModalProps> = ({
  isOpen,
  onClose,
  userProfile,
  paymentsConfig,
  onPaymentVerified,
}) => {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('yearly');
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isUnlimited = isUnlimitedUser(userProfile.email);

  // Prices come from the server (PAYSTACK_* env vars); the browser never decides the amount
  const currency = paymentsConfig?.currency || 'USD';
  const monthlyAmount = paymentsConfig?.monthlyAmount ?? 20;
  const yearlyAmount = paymentsConfig?.yearlyAmount ?? 220.8;
  const monthlyPrice = formatMoney(monthlyAmount, currency);
  const yearlyDiscountedPrice = formatMoney(yearlyAmount, currency);
  const yearlyMonthlyEquivalent = formatMoney(yearlyAmount / 12, currency);
  const discountPct = Math.max(0, Math.round((1 - yearlyAmount / (monthlyAmount * 12)) * 100));
  const paymentsEnabled = !!paymentsConfig?.enabled;
  const benefits = paymentsConfig?.benefits || DEFAULT_BENEFITS;
  // What Paystack charges (e.g. the NGN equivalent), shown next to the USD price
  const chargeCurrency = paymentsConfig?.chargeCurrency || currency;
  const chargeAmount = billingPeriod === 'yearly' ? paymentsConfig?.chargeYearlyAmount : paymentsConfig?.chargeMonthlyAmount;
  const chargeLabel =
    chargeAmount && chargeCurrency !== currency ? formatMoney(chargeAmount, chargeCurrency, true).replace(/\.00$/, '') : null;

  const handlePaystackCheckout = async () => {
    setCheckoutError(null);
    if (!paymentsEnabled) {
      setCheckoutError('Payments are not available yet. Please check back soon.');
      return;
    }
    if (!window.PaystackPop) {
      setCheckoutError('Paystack checkout could not load. Disable any ad/script blocker and try again.');
      return;
    }
    setIsProcessing(true);
    try {
      const plan = billingPeriod;
      const init = await apiFetch<{
        reference: string;
        amount: number;
        currency: string;
        channels?: string[];
        email: string;
        publicKey: string;
      }>(
        '/api/payments/initialize',
        { method: 'POST', body: JSON.stringify({ plan }) }
      );
      const handler = window.PaystackPop.setup({
        key: init.publicKey,
        email: init.email,
        amount: init.amount,
        currency: init.currency,
        ref: init.reference,
        channels: init.channels,
        callback: (response: { reference: string }) => {
          // Only the server's verification with Paystack activates the plan
          apiFetch('/api/payments/verify', {
            method: 'POST',
            body: JSON.stringify({ reference: response.reference || init.reference }),
          })
            .then(account => {
              setPaymentSuccess(init.reference);
              onPaymentVerified(account, plan);
              setTimeout(onClose, 1200);
            })
            .catch(err => setCheckoutError(err?.message || 'Payment could not be verified.'))
            .finally(() => setIsProcessing(false));
        },
        onClose: () => setIsProcessing(false),
      });
      handler.openIframe();
    } catch (err: any) {
      setCheckoutError(err?.message || 'Could not start checkout. Please try again.');
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-fadeIn overflow-y-auto">
      <div className="relative w-full max-w-lg my-auto rounded-3xl bg-[#0f0f12] border border-white/[0.14] shadow-2xl overflow-hidden max-h-[94vh] flex flex-col">
        {/* Top Header Background Glow */}
        <div className="absolute top-0 inset-x-0 h-32 bg-gradient-to-b from-indigo-600/25 via-cyan-500/10 to-transparent pointer-events-none" />

        {/* Modal Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3.5 right-3.5 sm:top-4 sm:right-4 p-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.15] text-slate-200 hover:text-white border border-white/[0.12] transition-all cursor-pointer z-20"
          title="Close Modal"
        >
          <X className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        <div className="p-4 sm:p-6 space-y-4 relative z-10 overflow-y-auto flex-1">
          {/* Title and Subtitle */}
          <div className="text-center space-y-1.5 max-w-xl mx-auto pt-1 sm:pt-2">
            <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight flex items-center justify-center gap-2">
              <span>MarketX Pro</span>
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              More analyses every day and a verified trader badge.
            </p>
          </div>

          {/* Unlimited VIP status banner */}
          {isUnlimited && (
            <div className="p-3.5 rounded-2xl bg-gradient-to-r from-amber-500/20 via-cyan-500/20 to-indigo-500/20 border border-cyan-400/40 text-cyan-200 text-xs font-semibold flex items-center justify-between gap-2 shadow-lg">
              <div className="flex items-center gap-2">
                <InfinityIcon className="w-5 h-5 text-amber-300 shrink-0" />
                <div>
                  <span className="text-white font-bold block">VIP Unlimited Account Active</span>
                  <span className="text-[11px] text-cyan-200">Unlimited compute credits and institutional quantitative features active.</span>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-cyan-500/20 border border-cyan-400/40 text-[10px] font-mono font-bold text-cyan-300">
                ACTIVE
              </span>
            </div>
          )}

          {/* Plan Interval Toggle: Monthly vs Yearly */}
          <div className="flex justify-center pt-1">
            <div className="p-1 rounded-2xl bg-black/60 border border-white/[0.1] inline-flex items-center gap-1.5 relative">
              <button
                type="button"
                onClick={() => setBillingPeriod('monthly')}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  billingPeriod === 'monthly'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Monthly
              </button>

              <button
                type="button"
                onClick={() => setBillingPeriod('yearly')}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                  billingPeriod === 'yearly'
                    ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white shadow-md shadow-cyan-600/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>Yearly</span>
                <span className="px-1.5 py-0.5 rounded-full bg-emerald-500 text-slate-950 font-black text-[10px] tracking-tight animate-pulse">
                  -{discountPct}% OFF
                </span>
              </button>
            </div>
          </div>

          {/* Success Notification Banner */}
          {paymentSuccess && (
            <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-semibold flex items-center justify-center gap-2 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Payment verified by Paystack. Pro is now active!</span>
            </div>
          )}

          {/* Active Pricing Card */}
          <div className={`p-5 sm:p-6 rounded-2xl border transition-all flex flex-col justify-between relative ${
            billingPeriod === 'yearly'
              ? 'bg-gradient-to-b from-slate-900/90 to-slate-950/90 border-cyan-500/50 shadow-xl shadow-cyan-950/30'
              : 'bg-slate-900/80 border-indigo-500/40 shadow-xl shadow-indigo-950/20'
          }`}>
            {/* Top Badge for Yearly */}
            {billingPeriod === 'yearly' && (
              <div className="absolute -top-3 right-6 px-3 py-1 rounded-full bg-gradient-to-r from-cyan-500 to-indigo-500 text-white text-[10px] font-black uppercase tracking-wider shadow-md">
                Best Value • Save {discountPct}%
              </div>
            )}

            <div className="space-y-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span>{billingPeriod === 'yearly' ? 'Pro · Yearly' : 'Pro · Monthly'}</span>
                    {billingPeriod === 'yearly' && <Sparkles className="w-4 h-4 text-amber-300" />}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {billingPeriod === 'yearly' ? 'Full 365-day access with yearly discount' : 'Full 30-day rolling access'}
                  </p>
                </div>
                <span className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold border font-mono ${
                  billingPeriod === 'yearly'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                    : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                }`}>
                  {billingPeriod === 'yearly' ? 'Yearly Plan' : 'Monthly Plan'}
                </span>
              </div>

              {/* Price display */}
              {billingPeriod === 'yearly' ? (
                <div className="space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl sm:text-4xl font-black text-white font-mono">
                      {yearlyMonthlyEquivalent}
                    </span>
                    <span className="text-xs text-slate-400 font-medium">/ month</span>
                    <span className="text-xs text-slate-500 line-through font-mono ml-2">
                      {monthlyPrice}/mo
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-cyan-300">
                    <span className="font-semibold font-mono">{yearlyDiscountedPrice} billed annually</span>
                    <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold">
                      -{discountPct}% OFF applied
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl sm:text-4xl font-black text-white font-mono">{monthlyPrice}</span>
                  <span className="text-xs text-slate-400 font-medium">/ month</span>
                </div>
              )}

              {/* Free vs Pro: exactly what the server enforces */}
              <div className="rounded-2xl border border-white/[0.08] overflow-hidden text-[13px]">
                <div className="grid grid-cols-[1fr_72px_88px] bg-white/[0.03] text-[11px] font-medium uppercase tracking-wider text-slate-500">
                  <span className="px-3 py-2">Feature</span>
                  <span className="px-2 py-2 text-center">Free</span>
                  <span className="px-2 py-2 text-center text-indigo-300">Pro</span>
                </div>
                {[
                  { label: 'Analyses per day', free: String(benefits.freeDailyAnalyses), pro: String(benefits.proDailyAnalyses) },
                  { label: 'Verified trader badge', free: false, pro: true },
                  { label: 'Full AI analysis & trade plans', free: true, pro: true },
                  { label: 'Live market prices', free: true, pro: true },
                  { label: 'Gift credits & X rewards', free: true, pro: true },
                ].map(row => (
                  <div key={row.label} className="grid grid-cols-[1fr_72px_88px] items-center border-t border-white/[0.05]">
                    <span className="px-3 py-2.5 text-slate-300">{row.label}</span>
                    {[row.free, row.pro].map((v, i) => (
                      <span key={i} className={`px-2 py-2.5 text-center ${i === 1 ? 'text-white font-medium' : 'text-slate-400'}`}>
                        {v === true ? (
                          <Check className={`w-4 h-4 mx-auto ${i === 1 ? 'text-emerald-400' : 'text-slate-500'}`} />
                        ) : v === false ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          v
                        )}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <RotateCcw className="w-3 h-3 shrink-0" />
                Daily analyses renew every 24 hours with no rollover. Pro lasts {billingPeriod === 'yearly' ? '365' : '30'} days per payment.
              </p>
            </div>

            <div className="pt-5 mt-4 border-t border-white/[0.08] space-y-2">
              {checkoutError && (
                <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-xl p-2.5">{checkoutError}</p>
              )}
              <button
                type="button"
                disabled={isProcessing || !paymentsEnabled || isUnlimited}
                onClick={handlePaystackCheckout}
                className={`w-full py-3.5 px-4 rounded-xl text-white font-bold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-lg transition-all hover:scale-[1.01] active:scale-[0.99] cursor-pointer disabled:opacity-50 ${
                  billingPeriod === 'yearly'
                    ? 'bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 shadow-cyan-600/30'
                    : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30'
                }`}
              >
                <CreditCard className="w-4 h-4 shrink-0" />
                <span>
                  {isProcessing
                    ? 'Processing payment...'
                    : !paymentsEnabled
                    ? 'Payments coming soon'
                    : billingPeriod === 'yearly'
                    ? `Pay ${chargeLabel || yearlyDiscountedPrice} / year`
                    : `Pay ${chargeLabel || monthlyPrice} / month`}
                </span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
              </button>
              {chargeLabel && (
                <p className="text-[11px] text-slate-500 text-center">
                  {billingPeriod === 'yearly' ? yearlyDiscountedPrice : monthlyPrice} is charged as {chargeLabel} ({chargeCurrency}) at
                  today's exchange rate.
                </p>
              )}
            </div>
          </div>

          {/* Paystack Security Guarantee */}
          <div className="p-3 rounded-2xl bg-black/60 border border-white/[0.06] flex items-center justify-between gap-3 text-xs text-slate-400">
            <div className="flex items-center gap-2 min-w-0">
              <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="truncate">Secured & encrypted Paystack billing engine</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400 shrink-0">
              Card • Transfer • USSD • Bank
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
