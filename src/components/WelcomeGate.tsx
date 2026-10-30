import React from 'react';
import { KeyRound, LineChart, ShieldCheck, Zap, BookOpen } from 'lucide-react';
import { MarketXIcon } from './MarketXIcon';
import { MarketXText } from './MarketXText';

interface WelcomeGateProps {
  onSignIn: () => void;
  onSignUp: () => void;
  onHaveCode: () => void;
  notice?: string | null;
}

const POINTS = [
  { icon: Zap, text: 'Live prices across forex, gold, crypto, stocks & synthetics' },
  { icon: LineChart, text: 'Clear trade plans: entry, stop loss and targets' },
  { icon: ShieldCheck, text: 'Invite-only access with a personal pass code' },
];

// Shown to signed-out visitors: MarketX is invite-only, so the app needs an account with a redeemed pass code
export const WelcomeGate: React.FC<WelcomeGateProps> = ({ onSignIn, onSignUp, onHaveCode, notice }) => (
  <div className="mx-backdrop min-h-[100dvh] w-full flex flex-col items-center justify-center px-5 py-10 text-slate-100">
    <div className="w-full max-w-[440px] text-center">
      <div className="mx-rise flex items-center justify-center gap-2.5">
        <MarketXIcon size="lg" />
        <MarketXText className="text-2xl" />
      </div>

      <span className="mx-rise mt-8 inline-flex items-center gap-2 h-7 px-3 rounded-full bg-white/[0.05] border border-white/[0.07] text-xs text-slate-300">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Private access · Batch 1
      </span>
      <h1 className="mx-rise mt-4 text-[2rem] sm:text-[2.4rem] leading-[1.1] font-semibold tracking-tight text-white">
        Your trading co-pilot,
        <br />
        <span className="marketx-chroma-x">one prompt away.</span>
      </h1>
      <p className="mx-rise mt-4 text-[15px] text-slate-400 leading-relaxed">
        MarketX is invite-only. Create an account and we'll email you a one-time pass code to unlock it.
      </p>

      {notice && <p className="mt-4 text-sm text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">{notice}</p>}

      <div className="mx-rise mt-7 flex flex-col gap-2.5">
        <button
          type="button"
          onClick={onSignUp}
          className="h-12 rounded-2xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 active:scale-[0.99] transition cursor-pointer"
        >
          Create account
        </button>
        <button
          type="button"
          onClick={onSignIn}
          className="h-12 rounded-2xl border border-white/[0.12] text-sm font-medium text-slate-200 hover:bg-white/[0.05] transition-colors cursor-pointer"
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={onHaveCode}
          className="mt-1 mx-auto inline-flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-200 cursor-pointer"
        >
          <KeyRound className="w-3.5 h-3.5" /> I have a pass code
        </button>
      </div>

      <ul className="mt-10 space-y-2.5 text-left">
        {POINTS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3 text-sm text-slate-400">
            <span className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center shrink-0 text-slate-300">
              <Icon className="w-4 h-4" />
            </span>
            {text}
          </li>
        ))}
      </ul>

      <a href="/blog" className="mt-8 inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
        <BookOpen className="w-3.5 h-3.5" /> New here? Read the MarketX Site Guide
      </a>
    </div>
  </div>
);
