import React from 'react';
import { MessageCircleQuestion, Sparkles } from 'lucide-react';
import { openMatt } from '../utils/matt';

// Ask SI / Matt switch (owner-specified): a small two-icon segmented control, in the sidebar's top row and the Matt page header.
// Ask SI is the trading chat on the home app; Matt is the help assistant (/matt). `bare`: no container (floats on the page).
export const ModeSwitch: React.FC<{ active: 'si' | 'matt'; onAskSI?: () => void; className?: string; bare?: boolean }> = ({ active, onAskSI, className = '', bare = false }) => {
  const item = (on: boolean) =>
    bare
      ? // Floating: no boxes at all, the active side is simply lit
        `relative h-8 w-9 flex items-center justify-center transition-colors cursor-pointer ${on ? 'text-violet-300' : 'text-slate-500 hover:text-white'}`
      : `relative h-8 w-10 rounded-[10px] flex items-center justify-center transition-colors cursor-pointer ${
          on ? 'bg-white/[0.1] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]' : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
        }`;
  return (
    <div role="tablist" aria-label="Ask SI or Matt" className={`inline-flex items-center gap-0.5 shrink-0 ${bare ? '' : 'p-0.5 rounded-xl bg-white/[0.04] border border-white/[0.07]'} ${className}`}>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'si'}
        aria-label="Ask SI: trade plans and market answers"
        title="Ask SI"
        onClick={() => (active === 'si' ? onAskSI?.() : window.location.assign('/?ask=1'))}
        className={item(active === 'si')}
      >
        <Sparkles className="w-4 h-4" />
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'matt'}
        aria-label="Matt: help with MarketX, your account and the markets"
        title="Matt"
        onClick={() => active !== 'matt' && openMatt()}
        className={item(active === 'matt')}
      >
        <MessageCircleQuestion className="w-4 h-4" />
      </button>
    </div>
  );
};
