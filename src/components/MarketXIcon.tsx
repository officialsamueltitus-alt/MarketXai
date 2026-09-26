import React from 'react';

interface MarketXIconProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  withContainer?: boolean;
}

export const MarketXIcon: React.FC<MarketXIconProps> = ({
  size = 'md',
  className = '',
  withContainer = false,
}) => {
  const fontSizes = {
    xs: 'text-xs',
    sm: 'text-sm font-black',
    md: 'text-base font-black',
    lg: 'text-2xl font-black',
  };

  const containerSizes = {
    xs: 'w-6 h-6 rounded-lg',
    sm: 'w-7 h-7 sm:w-8 sm:h-8 rounded-xl',
    md: 'w-8 h-8 sm:w-9 sm:h-9 rounded-xl',
    lg: 'w-12 h-12 rounded-2xl',
  };

  const xElement = (
    <span
      className={`marketx-chroma-x inline-block select-none leading-none font-mono ${fontSizes[size]} ${className}`}
      style={{ letterSpacing: '-0.05em' }}
    >
      X
    </span>
  );

  if (withContainer) {
    return (
      <div
        className={`${containerSizes[size]} bg-slate-950/80 border border-white/[0.14] flex items-center justify-center shrink-0 shadow-lg relative overflow-hidden group`}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-indigo-500/10 to-rose-500/10 opacity-75" />
        <div className="relative z-10 flex items-center justify-center">
          {xElement}
        </div>
      </div>
    );
  }

  return xElement;
};
