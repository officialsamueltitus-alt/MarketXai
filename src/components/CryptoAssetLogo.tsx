import React from 'react';

interface CryptoAssetLogoProps {
  symbol: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export const CryptoAssetLogo: React.FC<CryptoAssetLogoProps> = ({
  symbol,
  className = '',
  size = 'md',
}) => {
  const sym = (symbol || '').toUpperCase().trim();
  const clean = sym.replace('/USDT', '').replace('/USD', '').replace('-USDT', '').replace('USDT', '');

  const sizeClass =
    size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-7 h-7 text-xs' : 'w-5 h-5 text-[9px]';

  // 1. Bitcoin (BTC)
  if (clean === 'BTC' || sym.includes('BTC') || sym.includes('BITCOIN')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#F7931A] flex items-center justify-center shrink-0 shadow-xs font-bold text-white font-mono leading-none ${className}`}
        title="Bitcoin (BTC)"
      >
        <svg viewBox="0 0 32 32" className="w-3/4 h-3/4 fill-white" aria-hidden="true">
          <path d="M23.189 14.02c.314-2.096-1.283-3.223-3.465-3.975l.708-2.84-1.728-.43-.69 2.765c-.454-.114-.92-.22-1.385-.326l.695-2.783-1.727-.43-.708 2.839c-.376-.086-.746-.17-1.104-.26l.002-.009-2.384-.595-.46 1.846s1.283.294 1.256.312c.7.175.826.638.805 1.006l-.806 3.235c.048.012.11.03.18.057l-.183-.045-1.13 4.532c-.086.212-.303.531-.793.41.018.025-1.256-.313-1.256-.313l-.858 1.978 2.25.561c.418.105.828.215 1.231.318l-.715 2.872 1.727.43.708-2.84c.472.127.93.245 1.378.357l-.706 2.828 1.728.43.715-2.866c2.948.558 5.164.333 6.097-2.333.752-2.146-.037-3.385-1.588-4.192 1.13-.26 1.98-1.003 2.207-2.538zm-3.95 5.537c-.535 2.146-4.148.986-5.318.695l.949-3.805c1.17.292 4.929.872 4.369 3.11zm.535-5.567c-.488 1.954-3.495.962-4.471.718l.86-3.45c.977.244 4.12.699 3.611 2.732z" />
        </svg>
      </div>
    );
  }

  // 2. Ethereum (ETH)
  if (clean === 'ETH' || sym.includes('ETH') || sym.includes('ETHEREUM')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#627EEA] flex items-center justify-center shrink-0 shadow-xs ${className}`}
        title="Ethereum (ETH)"
      >
        <svg viewBox="0 0 784 1277" className="w-2.5 h-3.5 fill-white">
          <path d="M392.07 0L383.5 29.11V873.74L392.07 882.29L784.13 650.54L392.07 0Z" fillOpacity="0.85" />
          <path d="M392.07 0L0 650.54L392.07 882.29V472.33V0Z" />
          <path d="M392.07 956.17L386.66 962.77V1277.29L392.07 1277L784.37 724.89L392.07 956.17Z" fillOpacity="0.85" />
          <path d="M392.07 1277.29V956.17L0 724.89L392.07 1277.29Z" />
        </svg>
      </div>
    );
  }

  // 3. Solana (SOL)
  if (clean === 'SOL' || sym.includes('SOL') || sym.includes('SOLANA')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-gradient-to-tr from-[#9945FF] via-[#7B2BF9] to-[#14F195] flex items-center justify-center shrink-0 shadow-xs p-1 ${className}`}
        title="Solana (SOL)"
      >
        <div className="flex flex-col gap-0.5 w-full items-center">
          <div className="h-0.5 bg-white rounded-full w-4/5" />
          <div className="h-0.5 bg-white rounded-full w-3/5 ml-auto" />
          <div className="h-0.5 bg-white rounded-full w-4/5" />
        </div>
      </div>
    );
  }

  // 4. Ripple XRP
  if (clean === 'XRP' || sym.includes('XRP') || sym.includes('RIPPLE')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-black border border-white/20 flex items-center justify-center shrink-0 shadow-xs p-1 ${className}`}
        title="XRP (Ripple)"
      >
        <svg viewBox="0 0 24 24" className="w-full h-full fill-white">
          <path d="M19.05 4.91h2.2L14.7 11.5l6.55 6.59h-2.2l-5.45-5.49-5.45 5.49h-2.2l6.55-6.59L5.95 4.91h2.2l5.45 5.48 5.45-5.48z" />
        </svg>
      </div>
    );
  }

  // 5. BNB (BNB Chain)
  if (clean === 'BNB' || sym.includes('BNB') || sym.includes('BINANCE')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#F3BA2F] flex items-center justify-center shrink-0 shadow-xs p-1 ${className}`}
        title="BNB Chain"
      >
        <svg viewBox="0 0 32 32" className="w-full h-full fill-black">
          <path d="M16 4l-4.5 4.5 4.5 4.5 4.5-4.5L16 4zm-7.5 7.5L4 16l4.5 4.5 4.5-4.5-4.5-4.5zm15 0l-4.5 4.5 4.5 4.5 4.5-4.5-4.5-4.5zM16 19l-4.5 4.5 4.5 4.5 4.5-4.5L16 19zm0-4.5l2.25 2.25L16 19l-2.25-2.25L16 14.5z" />
        </svg>
      </div>
    );
  }

  // 6. Dogecoin (DOGE)
  if (clean === 'DOGE' || sym.includes('DOGE') || sym.includes('DOGECOIN')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#C2A633] flex items-center justify-center shrink-0 shadow-xs font-black text-white font-mono leading-none ${className}`}
        title="Dogecoin (DOGE)"
      >
        Ð
      </div>
    );
  }

  // 7. Cardano (ADA)
  if (clean === 'ADA' || sym.includes('ADA') || sym.includes('CARDANO')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#0033AD] flex items-center justify-center shrink-0 shadow-xs p-1 ${className}`}
        title="Cardano (ADA)"
      >
        <svg viewBox="0 0 24 24" className="w-full h-full fill-white">
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="4" r="1.5" />
          <circle cx="12" cy="20" r="1.5" />
          <circle cx="4" cy="12" r="1.5" />
          <circle cx="20" cy="12" r="1.5" />
          <circle cx="6.3" cy="6.3" r="1.2" />
          <circle cx="17.7" cy="17.7" r="1.2" />
          <circle cx="17.7" cy="6.3" r="1.2" />
          <circle cx="6.3" cy="17.7" r="1.2" />
        </svg>
      </div>
    );
  }

  // 8. Avalanche (AVAX)
  if (clean === 'AVAX' || sym.includes('AVAX') || sym.includes('AVALANCHE')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#E84142] flex items-center justify-center shrink-0 shadow-xs p-1 ${className}`}
        title="Avalanche (AVAX)"
      >
        <svg viewBox="0 0 24 24" className="w-full h-full fill-white">
          <path d="M15.7 6.5L20.8 17.5h-3.4l-3.4-7.4-1.7 3.7 3.4 3.7h-7.6L12 9l3.7-2.5zm-7.4 6l3.4 5H4.2l4.1-5z" />
        </svg>
      </div>
    );
  }

  // 9. Sui (SUI)
  if (clean === 'SUI' || sym.includes('SUI')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#2A82E4] flex items-center justify-center shrink-0 shadow-xs p-1 ${className}`}
        title="Sui Network (SUI)"
      >
        <svg viewBox="0 0 24 24" className="w-full h-full fill-white">
          <path d="M12 2C9.5 6 6 11 6 15a6 6 0 0012 0c0-4-3.5-9-6-13zm0 16a3 3 0 01-3-3c0-2.2 2-5.3 3-6.8 1 1.5 3 4.6 3 6.8a3 3 0 01-3 3z" />
        </svg>
      </div>
    );
  }

  // 10. Chainlink (LINK)
  if (clean === 'LINK' || sym.includes('LINK') || sym.includes('CHAINLINK')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#375BD2] flex items-center justify-center shrink-0 shadow-xs p-1 ${className}`}
        title="Chainlink (LINK)"
      >
        <svg viewBox="0 0 24 24" className="w-full h-full fill-white">
          <path d="M12 2l-8.5 4.9v9.8L12 21.6l8.5-4.9V6.9L12 2zm5.5 13.2L12 18.4l-5.5-3.2V8.8L12 5.6l5.5 3.2v6.4z" />
        </svg>
      </div>
    );
  }

  // 11. Pepe (PEPE)
  if (clean === 'PEPE' || sym.includes('PEPE')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#448833] flex items-center justify-center shrink-0 shadow-xs font-black text-white font-mono text-[9px] border border-[#55aa44] ${className}`}
        title="Pepe (PEPE)"
      >
        🐸
      </div>
    );
  }

  // 12. Shiba Inu (SHIB)
  if (clean === 'SHIB' || sym.includes('SHIB') || sym.includes('SHIBA')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#FFA409] flex items-center justify-center shrink-0 shadow-xs font-black text-white font-mono text-[9px] ${className}`}
        title="Shiba Inu (SHIB)"
      >
        🐕
      </div>
    );
  }

  // 13. Toncoin (TON)
  if (clean === 'TON' || sym.includes('TON') || sym.includes('TONCOIN')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#0098EA] flex items-center justify-center shrink-0 shadow-xs p-1 ${className}`}
        title="Toncoin (TON)"
      >
        <svg viewBox="0 0 24 24" className="w-full h-full fill-white">
          <path d="M12 2L3 8l9 12 9-12-9-6zm-1 3.5l6.5 4.5H5.5L11 5.5zm-5 6h12l-6 8-6-8z" />
        </svg>
      </div>
    );
  }

  // 14. TRON (TRX)
  if (clean === 'TRX' || sym.includes('TRX') || sym.includes('TRON')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#FF0013] flex items-center justify-center shrink-0 shadow-xs p-1 ${className}`}
        title="TRON (TRX)"
      >
        <svg viewBox="0 0 24 24" className="w-full h-full fill-white">
          <path d="M2 3l19 8-10 10L2 3zm4.5 4l1.5 6.5 7-4.5-8.5-2zm2.5 8l4.5 2 2-6.5-6.5 4.5z" />
        </svg>
      </div>
    );
  }

  // 15. Litecoin (LTC)
  if (clean === 'LTC' || sym.includes('LTC') || sym.includes('LITECOIN')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#345D9D] flex items-center justify-center shrink-0 shadow-xs font-black text-white font-mono text-[10px] ${className}`}
        title="Litecoin (LTC)"
      >
        Ł
      </div>
    );
  }

  // 16. Bitcoin Cash (BCH)
  if (clean === 'BCH' || sym.includes('BCH')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#0AC18E] flex items-center justify-center shrink-0 shadow-xs font-black text-white font-mono text-[10px] ${className}`}
        title="Bitcoin Cash (BCH)"
      >
        ₿
      </div>
    );
  }

  // 17. Aptos (APT)
  if (clean === 'APT' || sym.includes('APT') || sym.includes('APTOS')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-black border border-white/30 flex items-center justify-center shrink-0 shadow-xs p-1 ${className}`}
        title="Aptos (APT)"
      >
        <div className="flex flex-col gap-0.5 w-full items-center">
          <div className="h-0.5 bg-white rounded-full w-full" />
          <div className="h-0.5 bg-white rounded-full w-3/4" />
          <div className="h-0.5 bg-white rounded-full w-full" />
        </div>
      </div>
    );
  }

  // 18. Injective (INJ)
  if (clean === 'INJ' || sym.includes('INJ') || sym.includes('INJECTIVE')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-gradient-to-tr from-[#00A3FF] to-[#00F0FF] flex items-center justify-center shrink-0 shadow-xs font-black text-black font-mono text-[9px] ${className}`}
        title="Injective (INJ)"
      >
        INJ
      </div>
    );
  }

  // 19. Celestia (TIA)
  if (clean === 'TIA' || sym.includes('TIA') || sym.includes('CELESTIA')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#7B2BF9] flex items-center justify-center shrink-0 shadow-xs font-bold text-white font-mono text-[9px] ${className}`}
        title="Celestia (TIA)"
      >
        TIA
      </div>
    );
  }

  // 20. Bittensor (TAO)
  if (clean === 'TAO' || sym.includes('TAO') || sym.includes('BITTENSOR')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-black border border-white/30 flex items-center justify-center shrink-0 shadow-xs font-bold text-cyan-300 font-mono text-[9px] ${className}`}
        title="Bittensor (TAO)"
      >
        τ
      </div>
    );
  }

  // 21. Arbitrum (ARB)
  if (clean === 'ARB' || sym.includes('ARB') || sym.includes('ARBITRUM')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#28A0F0] flex items-center justify-center shrink-0 shadow-xs p-1 ${className}`}
        title="Arbitrum (ARB)"
      >
        <svg viewBox="0 0 24 24" className="w-full h-full fill-white">
          <path d="M12 2L4 6v6c0 5.5 3.5 10.7 8 12 4.5-1.3 8-6.5 8-12V6l-8-4zm3.5 14.5L12 14.2l-3.5 2.3L12 6.5l3.5 10z" />
        </svg>
      </div>
    );
  }

  // 22. Optimism (OP)
  if (clean === 'OP' || sym.includes('OP') || sym.includes('OPTIMISM')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#FF0420] flex items-center justify-center shrink-0 shadow-xs font-black text-white font-mono text-[9px] ${className}`}
        title="Optimism (OP)"
      >
        OP
      </div>
    );
  }

  // 23. Polkadot (DOT)
  if (clean === 'DOT' || sym.includes('DOT') || sym.includes('POLKADOT')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#E6007A] flex items-center justify-center shrink-0 shadow-xs p-1 ${className}`}
        title="Polkadot (DOT)"
      >
        <circle cx="12" cy="12" r="4" fill="white" />
        <circle cx="12" cy="4" r="2" fill="white" />
        <circle cx="12" cy="20" r="2" fill="white" />
      </div>
    );
  }

  // 24. NEAR Protocol
  if (clean === 'NEAR' || sym.includes('NEAR')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-black border border-white/20 flex items-center justify-center shrink-0 shadow-xs font-bold text-white font-mono text-[9px] ${className}`}
        title="NEAR Protocol"
      >
        N
      </div>
    );
  }

  // Gold (XAU/USD)
  if (sym.includes('XAU') || sym.includes('GOLD')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-gradient-to-br from-amber-300 via-amber-500 to-amber-700 flex items-center justify-center shrink-0 shadow-xs font-black text-slate-950 font-mono ${className}`}
        title="Gold Spot (XAU/USD)"
      >
        Au
      </div>
    );
  }

  // Silver (XAG/USD)
  if (sym.includes('XAG') || sym.includes('SILVER')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-gradient-to-br from-slate-200 via-slate-400 to-slate-600 flex items-center justify-center shrink-0 shadow-xs font-black text-slate-950 font-mono ${className}`}
        title="Silver Spot (XAG/USD)"
      >
        Ag
      </div>
    );
  }

  // Crude Oil (WTI)
  if (sym.includes('WTI') || sym.includes('OIL') || sym.includes('USOIL')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-gradient-to-br from-slate-800 to-black border border-amber-500/40 flex items-center justify-center shrink-0 shadow-xs font-black text-amber-400 font-mono ${className}`}
        title="WTI Crude Oil"
      >
        🛢️
      </div>
    );
  }

  // Forex Flags & Badges
  if (sym.includes('JPY')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-white flex items-center justify-center shrink-0 shadow-xs ${className}`}
        title="Japanese Yen"
      >
        <div className="w-2 h-2 rounded-full bg-[#bc002d]" />
      </div>
    );
  }
  if (sym.includes('EUR')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#003399] flex items-center justify-center shrink-0 shadow-xs font-bold text-yellow-300 font-mono leading-none ${className}`}
        title="Euro"
      >
        €
      </div>
    );
  }
  if (sym.includes('GBP')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#012169] flex items-center justify-center shrink-0 shadow-xs font-bold text-white font-mono leading-none ${className}`}
        title="British Pound"
      >
        £
      </div>
    );
  }
  if (sym.includes('AUD')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#00008B] flex items-center justify-center shrink-0 shadow-xs font-bold text-white font-mono leading-none ${className}`}
        title="Australian Dollar"
      >
        A$
      </div>
    );
  }
  if (sym.includes('CAD')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#FF0000] flex items-center justify-center shrink-0 shadow-xs font-bold text-white font-mono leading-none ${className}`}
        title="Canadian Dollar"
      >
        C$
      </div>
    );
  }
  if (sym.includes('CHF')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#D52B1E] flex items-center justify-center shrink-0 shadow-xs font-bold text-white font-mono leading-none ${className}`}
        title="Swiss Franc"
      >
        Fr
      </div>
    );
  }

  // Stocks
  if (sym.includes('NVDA')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#76B900] flex items-center justify-center shrink-0 shadow-xs ${className}`}
        title="NVIDIA"
      >
        <svg viewBox="0 0 24 24" className="w-3/4 h-3/4 fill-black">
          <path d="M8.7 16.5c-2.4 0-4.3-1.9-4.3-4.3 0-2.4 1.9-4.3 4.3-4.3 1.9 0 3.5 1.2 4.1 2.9h2.2c-.7-2.9-3.2-5-6.3-5-3.6 0-6.5 2.9-6.5 6.5s2.9 6.5 6.5 6.5c3.1 0 5.6-2.1 6.3-5h-2.2c-.6 1.7-2.2 2.7-4.1 2.7zm6.8-7.3c-.6-.7-1.3-1.3-2.1-1.7V5.3c1.3.4 2.4 1.1 3.4 2.1l-1.3 1.8zm0 5.8l1.3 1.8c-1 1-2.1 1.7-3.4 2.1v-2.2c.8-.4 1.5-1 2.1-1.7z" />
        </svg>
      </div>
    );
  }
  if (sym.includes('AAPL')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-black border border-white/20 flex items-center justify-center shrink-0 shadow-xs ${className}`}
        title="Apple Inc."
      >
        <svg viewBox="0 0 170 170" className="w-3/4 h-3/4 fill-white">
          <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.04-7.7-7.85-12.01-14.42-5.46-8.33-9.87-18.06-13.23-29.17-3.36-11.12-5.04-21.73-5.04-31.84 0-14.61 3.59-26.68 10.77-36.21 7.18-9.53 16.29-14.37 27.32-14.53 4.8 0 10.37 1.34 16.71 4.02 6.34 2.68 10.28 4.09 11.83 4.22 1.63-.13 5.75-1.54 12.37-4.22 6.62-2.68 12.08-3.88 16.39-3.6 12.28.98 22.18 5.64 29.7 13.98-10.74 6.53-16 15.53-15.77 27 0 9.25 3.63 17.15 10.89 23.7 7.26 6.55 15.93 10.29 26.01 11.22-2.07 6.42-4.68 13.06-7.84 19.92zM119.22 31.88c0-7.39 2.61-14.15 7.84-20.27 5.23-6.12 11.66-9.99 19.3-11.61.22 1.52.33 2.94.33 4.25 0 7.39-2.72 14.3-8.16 20.73-5.44 6.43-12.02 10.34-19.74 11.73-.32-1.63-.57-3.24-.57-4.83z" />
        </svg>
      </div>
    );
  }
  if (sym.includes('TSLA')) {
    return (
      <div
        className={`${sizeClass} rounded-full bg-[#E82127] flex items-center justify-center shrink-0 shadow-xs ${className}`}
        title="Tesla"
      >
        <svg viewBox="0 0 24 24" className="w-3/4 h-3/4 fill-white">
          <path d="M12 4.45c2.93 0 5.48.96 7.6 2.55l.9-1.8C18.15 3.4 15.22 2.4 12 2.4S5.85 3.4 3.5 5.2l.9 1.8c2.12-1.59 4.67-2.55 7.6-2.55zm0 2.8c-1.3 0-2.54.21-3.68.6l.48 2.05c1.02-.34 2.1-.53 3.2-.53s2.18.19 3.2.53l.48-2.05c-1.14-.39-2.38-.6-3.68-.6zM11.1 10.8v10.8h1.8V10.8c.84.14 1.65.37 2.41.69l.7-2.1c-1-.41-2.07-.7-3.21-.86v-.03h-1.6v.03c-1.14.16-2.21.45-3.21.86l.7 2.1c.76-.32 1.57-.55 2.41-.69z" />
        </svg>
      </div>
    );
  }

  // Fallback for general assets: crisp gradient circle with clean symbol abbreviation
  return (
    <div
      className={`${sizeClass} rounded-full bg-gradient-to-tr from-slate-800 to-indigo-950 border border-white/20 flex items-center justify-center shrink-0 text-white font-mono font-bold ${className}`}
      title={sym}
    >
      {clean.slice(0, 2)}
    </div>
  );
};
