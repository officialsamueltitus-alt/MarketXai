// ===========================================================================
// Back-tested edge per market and timeframe (owner-specified, from MarketX's walk-forward back-tests on real history).
// Used by the engine (buildMarketMap / applyConfirmation) to switch off combinations that lost money, to add a short
// heads-up on weaker ones, and as the prior for the setup quality score. Server-side only; never sent to traders as data.
// ===========================================================================

/** "EUR/USD", "EURUSD", "XAU/USD", "BTC/USDT", "BTCUSD" → "EURUSD", "XAUUSD", "BTCUSD" */
export function edgeKey(symbol?: string | null): string {
  return String(symbol || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/USDT$/, 'USD')
    .replace(/^(US100|NDX|NASDAQ100|USTEC)$/, 'NAS100')
    .replace(/^(GOLD)$/, 'XAUUSD');
}

const human = (k: string) => (k.length === 6 && /^[A-Z]{6}$/.test(k) ? `${k.slice(0, 3)}/${k.slice(3)}` : k);

/** Normal analysis: combinations that lost money in the back-tests are switched off (no signal, with the reason) */
const NORMAL_OFF = new Set(['EURUSD|4H', 'EURUSD|1D', 'USDJPY|1D', 'NAS100|4H', 'NAS100|1D', 'XAUUSD|1D']);
/** Normal analysis: weaker combinations, signalled with a heads-up */
const NORMAL_WEAK = new Set(['EURUSD|15M', 'GBPUSD|1D', 'XAUUSD|1H', 'ETHUSD|4H', 'ETHUSD|1D', 'BTCUSD|4H']);
/** Confirmation analysis: gold on 4H and above is switched off; these are weaker (heads-up) */
const CONFIRM_OFF = new Set(['XAUUSD|4H', 'XAUUSD|1D', 'XAUUSD|1W', 'XAUUSD|6H', 'XAUUSD|8H', 'XAUUSD|12H', 'NAS100|4H']);
const CONFIRM_WEAK = new Set(['EURUSD|1H', 'GBPUSD|4H', 'XAUUSD|1H', 'XAUUSD|2H', 'XAUUSD|30M', 'XAUUSD|15M']);

/**
 * Average R per trade (after costs) each market/timeframe returned in the back-tests: the prior of the quality score.
 * Missing = the all-market average.
 */
const PRIOR_R: Record<string, number> = {
  'BTCUSD|15M': 0.45, 'BTCUSD|1H': 1.25, 'BTCUSD|4H': 0.25, 'BTCUSD|1D': 3.5,
  'ETHUSD|15M': 0.36, 'ETHUSD|1H': 1.42, 'ETHUSD|4H': 0.28, 'ETHUSD|1D': 0.26,
  'EURUSD|15M': -0.01, 'EURUSD|1H': 0.87, 'EURUSD|4H': -0.28, 'EURUSD|1D': -0.53,
  'GBPUSD|15M': 0.31, 'GBPUSD|1H': 0.71, 'GBPUSD|4H': 1.48, 'GBPUSD|1D': 0.07,
  'NAS100|15M': 1.49, 'NAS100|1H': 1.66, 'NAS100|4H': -0.68, 'NAS100|1D': -0.31,
  'USDJPY|15M': 1.88, 'USDJPY|1H': 1.96, 'USDJPY|4H': 1.78, 'USDJPY|1D': -1,
  'XAUUSD|15M': 0.58, 'XAUUSD|1H': 0.38, 'XAUUSD|4H': 1.79, 'XAUUSD|1D': -0.75,
};
export const AVERAGE_R = 1.05;

export function priorR(symbol: string | null | undefined, tf: string): number {
  const v = PRIOR_R[`${edgeKey(symbol)}|${tf}`];
  return typeof v === 'number' ? v : AVERAGE_R;
}

export type EdgeVerdict = { off: true; text: string } | { off: false; note?: string };

export function normalEdge(symbol: string | null | undefined, tf: string): EdgeVerdict {
  const k = edgeKey(symbol);
  if (!k) return { off: false };
  const name = human(k);
  if (NORMAL_OFF.has(`${k}|${tf}`))
    return {
      off: true,
      text: `No signal. MarketX doesn't call ${name} on the ${tf} chart: our back-tests on real history found no reliable edge there. Try a nearby timeframe instead.`,
    };
  if (NORMAL_WEAK.has(`${k}|${tf}`))
    return { off: false, note: `${name} on the ${tf} chart has been one of the weaker combinations in our back-tests: consider a smaller position.` };
  return { off: false };
}

export function confirmEdge(symbol: string | null | undefined, tf: string): EdgeVerdict {
  const k = edgeKey(symbol);
  if (!k) return { off: false };
  const name = human(k);
  if (CONFIRM_OFF.has(`${k}|${tf}`))
    return {
      off: true,
      text:
        k === 'XAUUSD'
          ? `No signal. Confirmation analysis doesn't trade gold on the ${tf} chart: gold's swings run through the confirmation stop too often there. Use Normal analysis for gold on this timeframe, or Confirmation on 1H and below.`
          : `No signal. Confirmation analysis doesn't trade ${name} on the ${tf} chart: our back-tests found no reliable edge there. Try Normal analysis or another timeframe.`,
    };
  if (CONFIRM_WEAK.has(`${k}|${tf}`))
    return {
      off: false,
      note:
        k === 'XAUUSD'
          ? 'Gold has been one of the weaker markets for Confirmation analysis: consider a smaller position.'
          : `${name} on the ${tf} chart has been weaker for Confirmation analysis in our back-tests: consider a smaller position.`,
    };
  return { off: false };
}

/** Crypto markets (Tight SL is not used there: their swings stop it out too often) */
export function isCryptoSymbol(symbol: string | null | undefined, assetType?: string | null): boolean {
  if (assetType) return assetType === 'crypto';
  const k = edgeKey(symbol);
  return /^(BTC|ETH|SOL|XRP|BNB|DOGE|ADA|AVAX|LINK|DOT|TON|TRX|LTC|SHIB|PEPE|WIF|BONK)/.test(k);
}
