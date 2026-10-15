import React from 'react';
import { openMatt, type MattAsk } from '../utils/matt';
import { MARKETX_LOGO_SRC } from './MarketXIcon';

/** Matt's mark (owner-specified): the MarketX logo, everywhere Matt appears */
export const MattMark: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <img src={MARKETX_LOGO_SRC} alt="" aria-hidden="true" draggable={false} className={`rounded-full object-contain select-none shrink-0 ${className}`} />
);

/**
 * "Ask Matt" next to anything a trader may want explained. Opens Matt's page and asks the question right away.
 * variant: 'chip' (a small pill, default) or 'link' (inline text).
 */
export const AskMattButton: React.FC<{ ask: MattAsk; variant?: 'chip' | 'link'; className?: string; label?: string }> = ({ ask, variant = 'chip', className = '', label = 'Ask Matt' }) => (
  <button
    type="button"
    onClick={e => {
      e.stopPropagation();
      openMatt(ask);
    }}
    title={`Ask Matt: ${ask.q}`}
    className={
      variant === 'link'
        ? `inline-flex items-center gap-1 text-[11px] font-medium text-violet-300 hover:text-violet-200 cursor-pointer ${className}`
        : `inline-flex items-center gap-1.5 h-7 pl-1.5 pr-2.5 rounded-full border border-violet-400/30 bg-violet-500/10 hover:bg-violet-500/20 text-[11px] font-semibold text-violet-200 hover:text-white transition cursor-pointer ${className}`
    }
  >
    <MattMark className="w-4 h-4 text-[9px]" />
    {label}
  </button>
);
