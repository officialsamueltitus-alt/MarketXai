import React from 'react';

interface MarketXIconProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  withContainer?: boolean;
}

// Official MarketX brand mark (the glossy ball with the gradient X), served from /public/brand.
// Bump LOGO_V when the files change so browsers drop the cached copy.
const LOGO_V = '3';
export const MARKETX_LOGO_SRC = `/brand/marketx-logo-128.png?v=${LOGO_V}`;

const PX: Record<NonNullable<MarketXIconProps['size']>, number> = { xs: 16, sm: 20, md: 28, lg: 40, xl: 56 };

export const MarketXIcon: React.FC<MarketXIconProps> = ({ size = 'md', className = '', withContainer = false }) => {
  const px = PX[size];
  const img = (
    <img
      src={size === 'xl' || size === 'lg' ? `/brand/marketx-logo-192.png?v=${LOGO_V}` : MARKETX_LOGO_SRC}
      alt="MarketX"
      width={px}
      height={px}
      draggable={false}
      className={`select-none shrink-0 ${className}`}
      style={{ width: px, height: px }}
    />
  );

  if (withContainer) {
    return (
      <span
        className="inline-flex items-center justify-center rounded-full bg-white/[0.04] ring-1 ring-white/[0.08] shrink-0"
        style={{ width: px + 12, height: px + 12 }}
      >
        {img}
      </span>
    );
  }
  return img;
};
