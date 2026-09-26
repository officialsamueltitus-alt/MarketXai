import React from 'react';
import { Check } from 'lucide-react';

interface VerifiedBadgeProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
}

export const VerifiedBadge: React.FC<VerifiedBadgeProps> = ({
  className = '',
  size = 'sm',
  showText = false,
}) => {
  const sizeClasses = {
    sm: 'w-3.5 h-3.5 text-[8px]',
    md: 'w-4 h-4 text-[9px]',
    lg: 'w-5 h-5 text-[10px]',
  };

  const iconSizes = {
    sm: 'w-2 h-2 stroke-[3]',
    md: 'w-2.5 h-2.5 stroke-[3]',
    lg: 'w-3 h-3 stroke-[3]',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold text-cyan-300 ${className}`}
      title="Verified MarketX Pro Trader (Active Premium Subscription)"
    >
      <span
        className={`rounded-full bg-gradient-to-tr from-cyan-500 via-indigo-500 to-sky-400 text-white flex items-center justify-center shadow-xs shadow-cyan-500/40 ring-1 ring-cyan-300/40 ${sizeClasses[size]}`}
      >
        <Check className={iconSizes[size]} />
      </span>
      {showText && (
        <span className="text-[10px] font-bold tracking-wide uppercase text-cyan-300 bg-cyan-500/15 border border-cyan-500/30 px-1.5 py-0.5 rounded-md">
          Verified Pro
        </span>
      )}
    </span>
  );
};
