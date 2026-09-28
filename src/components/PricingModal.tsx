import React, { useEffect, useRef, useState } from 'react';
import { VerifiedBadge } from './VerifiedBadge';
import { UserProfile } from '../types';
import { isUnlimitedUser } from '../utils/creditManager';
import { formatMoney, apiFetch, PaymentsPublicConfig, DEFAULT_BENEFITS } from '../utils/apiClient';
import {
  X,
  Check,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  Lock,
  Sparkles,
  Infinity as InfinityIcon
} from 'lucide-react';

let paystackLoading: Promise<void> | null = null;
/** Injects Paystack's inline checkout script once (resolves when ready, rejects after 10s or on error). */
function loadPaystack(): Promise<void> {
  if (typeof window === 'undefined' || (window as any).PaystackPop) return Promise.resolve();
  if (paystackLoading) return paystackLoading;
  paystackLoading = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://js.paystack.co/v1/inline.js';
    el.async = true;
    const timer = setTimeout(() => reject(new Error('timeout')), 10_000);
    el.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    el.onerror = () => {
      clearTimeout(timer);
      paystackLoading = null;
      el.remove();
      reject(new Error('failed'));
    };
    document.head.appendChild(el);
  });
  return paystackLoading;
}

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

  // Stable listener: the latest onClose is read from a ref, so parent re-renders during the
  // same key event (e.g. another panel closing on Escape) can't detach it mid-dispatch
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // Paystack's script is only needed here: fetch it when the Plans window opens, not on every page load
  useEffect(() => {
    if (isOpen && paymentsConfig?.enabled) loadPaystack().catch(() => {});
  }, [isOpen, paymentsConfig?.enabled]);

  if (!isOpen) return null;

  const isUnlimited = isUnlimitedUser(userProfile.email);

  // Prices come from the server (PAYSTACK_* env vars); the browser never decides the amount
  const currency = paymentsConfig?.currency || 'USD';
  const monthlyAmount = paymentsConfig?.monthlyAmount ?? 20;
  const yearlyAmount = paymentsConfig?.yearlyAmount ?? 220.8;
  const monthlyPrice = formatMoney(monthlyAmount, currency, true);
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
    if (!window.PaystackPop) await loadPaystack().catch(() => {});
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

  const sub = userProfile.subscription;
  const proActive = !!sub?.active && !isUnlimited;
  const proUntil = proActive && sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const yearly = billingPeriod === 'yearly';
  const payLabel = yearly ? chargeLabel || yearlyDiscountedPrice : chargeLabel || monthlyPrice;

  const freeFeatures: [string, boolean][] = [
    [`${benefits.freeDailyAnalyses} AI analyses every day`, true],
    ['Full trade plans: entry, stop & targets', true],
    ['Live market prices', true],
    ['Gift credits & X rewards', true],
    ['Verified trader badge', false],
  ];
  const proFeatures: string[] = [
    `${benefits.proDailyAnalyses} AI analyses every day`,
    'Full trade plans: entry, stop & targets',
    'Live market prices',
    'Gift credits & X rewards',
    'Verified trader badge',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="MarketX Pro pricing">
      <button type="button" aria-label="Close pricing" onClick={onClose} className="absolute inset-0 bg-black/75 mx-fade-in cursor-default" />

      <div className="mx-pop-in relative w-full sm:max-w-[860px] max-h-[94dvh] overflow-y-auto overscroll-contain rounded-t-[28px] sm:rounded-[32px] bg-[var(--mx-bg-2)] border border-white/[0.08] shadow-[0_32px_100px_-24px_var(--mx-shadow)]">
        {/* soft top glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(139,92,246,0.18),transparent)]" aria-hidden="true" />

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 z-10 w-9 h-9 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.08] inline-flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="relative px-5 sm:px-10 pt-8 sm:pt-10 pb-6 sm:pb-8">
          {/* Header */}
          <div className="text-center max-w-md mx-auto">
            <span className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-white/[0.05] border border-white/[0.07] text-xs text-slate-300">
              <Sparkles className="w-3.5 h-3.5 text-indigo-300" /> MarketX Pro
            </span>
            <h2 className="mt-4 text-[28px] sm:text-[34px] leading-[1.1] font-semibold tracking-tight text-white">
              Trade with more <span className="marketx-chroma-x">firepower</span>
            </h2>
            <p className="mt-3 text-sm sm:text-[15px] text-slate-400 leading-relaxed">
              More analyses every day and a verified trader badge. Pay once per period, with no auto-renewal.
            </p>
          </div>

          {/* Billing switch */}
          <div className="mt-6 flex justify-center">
            <div role="radiogroup" aria-label="Billing period" className="relative grid grid-cols-2 p-1 rounded-full bg-white/[0.04] border border-white/[0.07] w-[260px]">
              <span
                aria-hidden="true"
                className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-full bg-white transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${yearly ? 'translate-x-[calc(100%+0px)]' : 'translate-x-0'}`}
                style={{ left: 4 }}
              />
              {(['monthly', 'yearly'] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={billingPeriod === p}
                  onClick={() => setBillingPeriod(p)}
                  className={`relative z-[1] h-9 rounded-full text-[13px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                    billingPeriod === p ? 'text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {p === 'monthly' ? 'Monthly' : 'Yearly'}
                  {p === 'yearly' && discountPct > 0 && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${billingPeriod === p ? 'bg-emerald-500/15 text-emerald-700' : 'bg-emerald-500/15 text-emerald-300'}`}>
                      −{discountPct}%
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Status banners */}
          {isUnlimited && (
            <div className="mt-6 flex items-center gap-3 rounded-2xl bg-amber-500/10 border border-amber-400/20 p-3.5 text-sm">
              <InfinityIcon className="w-5 h-5 text-amber-300 shrink-0" />
              <span className="text-amber-100">Your account has unlimited access. There's nothing to buy.</span>
            </div>
          )}
          {paymentSuccess && (
            <div className="mt-6 flex items-center gap-3 rounded-2xl bg-emerald-500/10 border border-emerald-400/20 p-3.5 text-sm" role="status">
              <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0" />
              <span className="text-emerald-100">Payment confirmed. Pro is now active. Enjoy!</span>
            </div>
          )}

          {/* Plans */}
          <div className="mt-7 grid md:grid-cols-2 gap-4 items-stretch">
            {/* Pro (first on phones) */}
            <div className="relative md:order-2 rounded-[26px] p-[1px] bg-gradient-to-b from-indigo-400/70 via-indigo-500/25 to-cyan-400/30">
              <div className="h-full rounded-[25px] bg-[var(--mx-surface)] p-6 flex flex-col">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-white">
                    Pro <VerifiedBadge size="sm" />
                  </span>
                  <span className="h-6 px-2.5 rounded-full bg-indigo-500/15 text-[11px] font-medium text-indigo-200 inline-flex items-center">
                    {proActive ? 'Your plan' : yearly ? 'Best value' : 'Most popular'}
                  </span>
                </div>

                <div className="mt-5 min-h-[92px]">
                  <div key={billingPeriod} className="mx-fade-in">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-[44px] leading-none font-semibold tracking-tight text-white tabular-nums">
                        {yearly ? yearlyMonthlyEquivalent : monthlyPrice}
                      </span>
                      <span className="text-sm text-slate-400">/ month</span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      {yearly ? (
                        <>
                          <span className="text-slate-200 font-medium">{yearlyDiscountedPrice}</span> billed yearly ·{' '}
                          <span className="line-through text-slate-500">{formatMoney(monthlyAmount * 12, currency)}</span>
                        </>
                      ) : (
                        <>Billed monthly · 30 days of Pro per payment</>
                      )}
                    </p>
                  </div>
                </div>

                <ul className="mt-5 space-y-3 text-sm flex-1">
                  {proFeatures.map(f => (
                    <li key={f} className="flex items-start gap-3 text-slate-200">
                      <span className="mt-0.5 w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-200 flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3" strokeWidth={3} />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>

                {checkoutError && (
                  <p className="mt-5 text-xs text-rose-200 bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5" role="alert">
                    {checkoutError}
                  </p>
                )}
                {proUntil && (
                  <p className="mt-5 text-xs text-emerald-200 bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-2.5">
                    Pro is active until {proUntil}. Paying again adds the time on top.
                  </p>
                )}

                <button
                  type="button"
                  disabled={isProcessing || !paymentsEnabled || isUnlimited}
                  onClick={handlePaystackCheckout}
                  className="group mt-6 w-full h-12 rounded-2xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  {isProcessing ? (
                    <>
                      <span className="w-4 h-4 rounded-full border-2 border-slate-400 border-t-slate-950 animate-spin" /> Opening secure checkout…
                    </>
                  ) : !paymentsEnabled ? (
                    'Payments coming soon'
                  ) : (
                    <>
                      {proActive ? 'Extend Pro' : 'Get Pro'} · {payLabel}
                      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
                {chargeLabel && (
                  <p className="mt-2.5 text-[11px] text-slate-500 text-center">
                    {yearly ? yearlyDiscountedPrice : monthlyPrice} is charged as {chargeLabel} at today's exchange rate.
                  </p>
                )}
              </div>
            </div>

            {/* Free */}
            <div className="md:order-1 rounded-[26px] border border-white/[0.07] bg-white/[0.02] p-6 flex flex-col">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white">Free</span>
                {!proActive && !isUnlimited && (
                  <span className="h-6 px-2.5 rounded-full bg-white/[0.06] text-[11px] font-medium text-slate-300 inline-flex items-center">Current plan</span>
                )}
              </div>
              <div className="mt-5 min-h-[92px]">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[44px] leading-none font-semibold tracking-tight text-white tabular-nums">{formatMoney(0, currency, true)}</span>
                  <span className="text-sm text-slate-400">/ month</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">Everything you need to get started</p>
              </div>
              <ul className="mt-5 space-y-3 text-sm flex-1">
                {freeFeatures.map(([f, on]) => (
                  <li key={f} className={`flex items-start gap-3 ${on ? 'text-slate-300' : 'text-slate-600'}`}>
                    <span className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${on ? 'bg-white/[0.07] text-slate-300' : 'bg-white/[0.03] text-slate-600'}`}>
                      {on ? <Check className="w-3 h-3" strokeWidth={3} /> : <X className="w-3 h-3" strokeWidth={3} />}
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-6 h-12 rounded-2xl border border-white/[0.08] text-sm text-slate-400 inline-flex items-center justify-center">
                {proActive || isUnlimited ? 'Included' : "You're on Free"}
              </div>
            </div>
          </div>

          {/* Fine print & trust */}
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-emerald-400" /> Secure checkout by Paystack
            </span>
            <span className="flex flex-wrap justify-center gap-1.5">
              {['Card', 'Transfer', 'USSD', 'Bank'].map(m => (
                <span key={m} className="h-6 px-2.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-[11px] text-slate-400 inline-flex items-center">
                  {m}
                </span>
              ))}
            </span>
          </div>
          <p className="mt-3 text-center text-[11px] text-slate-600 inline-flex w-full items-center justify-center gap-1.5">
            <RotateCcw className="w-3 h-3" /> Daily analyses refill every day at 3:00 AM, with no rollover. Pro lasts {yearly ? '365' : '30'} days per payment.
          </p>
        </div>
      </div>
    </div>
  );
};
