import React, { useState } from 'react';
import { Loader2, Package, Zap } from 'lucide-react';
import { apiFetch, formatMoney, type PaymentsPublicConfig } from '../utils/apiClient';
import { loadPaystack } from '../utils/paystack';

// Credit packs (owner-specified): one-time Paystack purchases. Bought credits are kept apart from the daily analyses: the
// trading agent uses them for its trades, and analyses use them once the day's analyses run out. They can't be gifted.
export const BuyCreditsCard: React.FC<{ paymentsConfig: PaymentsPublicConfig | null; onPurchased: (account: any, credits: number) => void }> = ({ paymentsConfig, onPurchased }) => {
  const packs = paymentsConfig?.creditPacks || [];
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<number | null>(null);
  if (!packs.length) return null;
  const perCredit = (p: { usd: number; credits: number }) => p.usd / p.credits;
  const base = perCredit(packs[0]);

  const buy = async (id: string, credits: number) => {
    setError('');
    setDone(null);
    if (!paymentsConfig?.enabled) return setError('Payments are not available yet.');
    if (!window.PaystackPop) await loadPaystack().catch(() => {});
    if (!window.PaystackPop) return setError('Checkout could not load. Disable any ad or script blocker and try again.');
    setBusy(id);
    try {
      const init = await apiFetch<{ reference: string; amount: number; currency: string; channels?: string[]; email: string; publicKey: string }>('/api/payments/initialize', {
        method: 'POST',
        body: JSON.stringify({ plan: id }),
      });
      window.PaystackPop.setup({
        key: init.publicKey,
        email: init.email,
        amount: init.amount,
        currency: init.currency,
        ref: init.reference,
        channels: init.channels,
        // Only the server's verification with Paystack adds the credits
        callback: r => {
          apiFetch('/api/payments/verify', { method: 'POST', body: JSON.stringify({ reference: r.reference || init.reference }) })
            .then(account => {
              setDone(credits);
              onPurchased(account, credits);
            })
            .catch(err => setError(err?.message || 'Payment could not be verified. If you were charged, the credits are added automatically.'))
            .finally(() => setBusy(null));
        },
        onClose: () => setBusy(null),
      }).openIframe();
    } catch (e: any) {
      setError(e?.message || 'Could not start checkout.');
      setBusy(null);
    }
  };

  return (
    <section className="rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-4">
      <div className="flex items-center gap-2">
        <Package className="w-4 h-4 text-amber-300" />
        <h3 className="text-sm font-medium text-white">Buy credits</h3>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        For the Trading Agent's trades, and for analyses once your daily ones run out. Bought credits never expire and can't be gifted.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {packs.map(p => {
          const save = Math.round((1 - perCredit(p) / base) * 100);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => buy(p.id, p.credits)}
              disabled={!!busy}
              className="relative rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] px-3 py-3 text-left cursor-pointer disabled:opacity-60 transition"
            >
              {save > 0 && <span className="absolute top-2 right-2 text-[10px] font-semibold text-emerald-300 bg-emerald-500/10 rounded-full px-1.5 py-0.5">save {save}%</span>}
              <span className="flex items-center gap-1 text-lg font-semibold text-white font-mono">
                <Zap className="w-4 h-4 text-amber-300 fill-amber-300/80" /> {p.credits}
              </span>
              <span className="block text-sm font-medium text-white">{formatMoney(p.usd, 'USD', true)}</span>
              {p.charge && paymentsConfig?.chargeCurrency && paymentsConfig.chargeCurrency !== 'USD' && (
                <span className="block text-[10px] text-slate-500">≈ {formatMoney(p.charge, paymentsConfig.chargeCurrency, true)}</span>
              )}
              {busy === p.id && <Loader2 className="absolute bottom-2 right-2 w-4 h-4 animate-spin text-slate-400" />}
            </button>
          );
        })}
      </div>
      {done && <p className="mt-2 text-xs text-emerald-300">{done} credits added to your balance.</p>}
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </section>
  );
};
