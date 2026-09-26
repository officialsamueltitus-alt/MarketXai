import React from 'react';

interface MarketXHeroLogoProps {
  className?: string;
  height?: number | string;
}

export const MarketXHeroLogo: React.FC<MarketXHeroLogoProps> = ({
  className = '',
}) => {
  return (
    <div className={`flex flex-col items-center justify-center select-none ${className}`}>
      {/* Prominent Typographic Display Writeup: "Market" + Consistently Color-Changing "X" */}
      <div className="flex items-baseline tracking-tight font-black leading-none text-5xl sm:text-7xl md:text-8xl">
        <span className="text-white drop-shadow-[0_4px_20px_rgba(0,0,0,0.9)]">
          Market
        </span>
        <span className="hero-x-chroma ml-1 sm:ml-2" style={{ textShadow: 'none', filter: 'none', WebkitFilter: 'none' }}>
          X
        </span>
      </div>
    </div>
  );
};

