import React, { useEffect, useState } from 'react';
import { Check, Copy, Gift, X } from 'lucide-react';
import { getApiUrl } from '../utils/api';

export interface Promo {
  code: string;
  monthlyPct: number;
  yearlyPct: number;
  endsAt: number | null;
  title: string;
  text: string;
}

// Promo pop-up (owner-specified): pops up every time someone enters the site (each page load) while a coupon with the
// banner on is live. Closing it hides it until the next time the site is opened or reloaded.
export const PromoBanner: React.FC<{ onClaim: (code: string) => void }> = ({ onClaim }) => {
  const [promo, setPromo] = useState<Promo | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    fetch(getApiUrl('/api/promo'))
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const p: Promo | null = d?.promo || null;
        if (!alive || !p || !/^[A-Z0-9_-]{3,24}$/.test(p.code)) return;
        setPromo(p);
        // A beat after the page settles, so it pops in instead of flashing with the first paint
        timer = setTimeout(() => alive && setShown(true), 1200);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!promo || !shown) return null;

  const close = () => setShown(false);
  const copy = () => {
    navigator.clipboard?.writeText(promo.code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {}
    );
  };
  const ends = promo.endsAt ? new Date(promo.endsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' }) : null;
  const offers = [promo.monthlyPct > 0 && { pct: promo.monthlyPct, plan: 'Monthly' }, promo.yearlyPct > 0 && { pct: promo.yearlyPct, plan: 'Yearly' }].filter(Boolean) as {
    pct: number;
    plan: string;
  }[];

  return (
    <div
      className="mx-pop-in fixed z-[60] top-3 inset-x-3 sm:inset-x-auto sm:top-auto sm:bottom-6 sm:right-6 sm:w-[380px]"
      role="dialog"
      aria-label={promo.title}
    >
      <div className="relative rounded-[26px] p-[1px] bg-gradient-to-br from-rose-400/70 via-violet-500/40 to-emerald-400/60 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
        <div className="relative overflow-hidden rounded-[25px] bg-[var(--mx-bg-2)]">
          {/* festive glow */}
          <div className="pointer-events-none absolute -top-16 -right-10 w-48 h-48 rounded-full bg-rose-500/20 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-20 -left-10 w-52 h-52 rounded-full bg-emerald-500/15 blur-3xl" aria-hidden="true" />

          <button
            type="button"
            onClick={close}
            aria-label="Close offer"
            className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.08] inline-flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="relative p-5">
            <div className="flex items-center gap-2.5 pr-8">
              <span className="w-9 h-9 rounded-2xl bg-gradient-to-br from-rose-500 to-amber-400 text-white flex items-center justify-center shadow-lg shadow-rose-500/25 shrink-0">
                <Gift className="w-4.5 h-4.5" />
              </span>
              <p className="text-[15px] font-semibold leading-snug text-white">{promo.title}</p>
            </div>
            {promo.text && <p className="mt-2.5 text-[13px] leading-relaxed text-slate-300">{promo.text}</p>}

            {offers.length > 0 && (
              <div className={`mt-4 grid gap-2 ${offers.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {offers.map(o => (
                  <div key={o.plan} className="rounded-2xl bg-white/[0.04] border border-white/[0.07] px-3 py-2.5">
                    <span className="block text-[22px] leading-none font-semibold tracking-tight text-white tabular-nums">{o.pct}% off</span>
                    <span className="mt-1 block text-[11px] text-slate-400">Pro {o.plan}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={copy}
                aria-label={`Copy code ${promo.code}`}
                className="flex-1 h-11 rounded-2xl border border-dashed border-white/20 bg-white/[0.03] hover:bg-white/[0.06] inline-flex items-center justify-between gap-2 px-3.5 transition-colors cursor-pointer"
              >
                <span className="font-mono text-[14px] font-bold tracking-[0.18em] text-white">{promo.code}</span>
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  close();
                  onClaim(promo.code);
                }}
                className="h-11 px-4 rounded-2xl bg-white text-slate-950 text-[13px] font-semibold hover:bg-slate-200 active:scale-[0.99] transition cursor-pointer whitespace-nowrap"
              >
                Claim offer
              </button>
            </div>
            {ends && <p className="mt-2.5 text-[11px] text-slate-500">Ends {ends}. Applied at checkout in Plans.</p>}
          </div>
        </div>
      </div>
    </div>
  );
};
