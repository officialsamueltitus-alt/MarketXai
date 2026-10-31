import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Check } from 'lucide-react';

// Shown every time a trader enters the Trading Agent page (owner-specified): they tick "I understand",
// then Proceed opens the page; Take me back leaves it.
const POINTS = [
  'Trading carries a high risk of losing money. The Trading Agent places trades on its own, and past results never promise future ones.',
  'Losing streaks happen. Only trade money you can afford to lose, and keep the risk per trade small.',
  'The agent follows the settings you choose. You stay responsible for your account, your risk and every trade it places.',
  'Linked MT5 orders are real trades on your broker account. Prices, fills and slippage at your broker can differ from MarketX.',
  'MarketX is a research and automation tool, not financial advice. You can stop the agent at any time.',
];

export const AgentDisclaimer: React.FC<{ onProceed: () => void; onBack: () => void }> = ({ onProceed, onBack }) => {
  const [agreed, setAgreed] = useState(false);
  const boxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onBack();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  return (
    <div
      className="fixed inset-0 z-[46] overflow-y-auto bg-[var(--mx-bg)] px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-disclaimer-title"
    >
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 bg-[radial-gradient(70%_50%_at_15%_0%,rgba(139,92,246,0.18),transparent_65%),radial-gradient(60%_45%_at_100%_10%,rgba(217,70,239,0.12),transparent_60%)]" />
      <section className="mx-rise relative mx-auto my-[max(0px,calc(50vh-330px))] w-full max-w-[520px] rounded-3xl border border-[var(--mx-border)] bg-[var(--mx-surface)] p-5 sm:p-7 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-500">Trading Agent</p>
            <h1 id="agent-disclaimer-title" className="text-lg sm:text-xl font-semibold text-[var(--mx-text)] leading-tight">
              Before you continue
            </h1>
          </div>
        </div>

        <ul className="mt-5 space-y-2.5">
          {POINTS.map(p => (
            <li key={p} className="flex gap-2.5 text-[13.5px] leading-relaxed text-slate-400">
              <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 shrink-0" />
              <span>{p}</span>
            </li>
          ))}
        </ul>

        <label className={`mt-5 flex items-start gap-3 rounded-2xl border px-3.5 py-3 cursor-pointer select-none transition-colors ${agreed ? 'border-violet-500/60 bg-violet-500/10' : 'border-[var(--mx-border)] hover:border-violet-500/40'}`}>
          <input ref={boxRef} type="checkbox" className="sr-only peer" checked={agreed} onChange={e => setAgreed(e.target.checked)} />
          <span
            aria-hidden="true"
            className={`mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-violet-500/60 ${agreed ? 'bg-violet-500 border-violet-500 text-[#fff]' : 'border-[var(--mx-border-strong)]'}`}
          >
            {agreed && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
          </span>
          <span className="text-[13.5px] font-medium text-[var(--mx-text)] leading-snug">
            I understand. Trading is risky and I am responsible for the trades the agent places for me.
          </span>
        </label>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="order-2 sm:order-1 h-11 rounded-2xl border border-[var(--mx-border)] text-sm font-medium text-[var(--mx-text)] inline-flex items-center justify-center gap-2 hover:bg-violet-500/[0.06] cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" /> Take me back
          </button>
          <button
            type="button"
            onClick={() => (agreed ? onProceed() : boxRef.current?.focus())}
            disabled={!agreed}
            className="order-1 sm:order-2 h-11 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 text-[#fff] text-sm font-semibold inline-flex items-center justify-center gap-2 hover:brightness-110 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
          >
            Proceed <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>
    </div>
  );
};
