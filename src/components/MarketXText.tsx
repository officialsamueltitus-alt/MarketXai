import React from 'react';

interface MarketXTextProps {
  className?: string;
  xClassName?: string;
  marketClassName?: string;
}

export const MarketXText: React.FC<MarketXTextProps> = ({
  className = '',
  xClassName = '',
  marketClassName = '',
}) => {
  return (
    <span className={`inline-flex items-baseline font-mono select-none tracking-tight ${className}`}>
      <span className={`text-white font-extrabold ${marketClassName}`}>Market</span>
      <span className={`market-x-animated font-black ml-0.5 ${xClassName}`}>X</span>
    </span>
  );
};
