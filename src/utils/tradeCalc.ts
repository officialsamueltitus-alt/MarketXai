// Trade calculator (Preference Mode): lot size from risk, or the risk of a lot size. Pure math, shared by the panel and tests.
//
// Money at risk on a trade = lots × contract size × stop distance (in the instrument's quote currency), converted to the
// account currency. Contract size is the number of units in 1.00 lot (forex 100,000, gold 100 oz, ...); brokers differ on
// indices and synthetics, so it can always be edited.

export type CalcMarket = 'forex' | 'gold' | 'silver' | 'oil' | 'index' | 'crypto' | 'stock' | 'synthetic';

export const MARKET_PRESETS: Record<CalcMarket, { label: string; contract: number; note: string }> = {
  forex: { label: 'Forex', contract: 100_000, note: '1 lot = 100,000 units of the base currency' },
  gold: { label: 'Gold', contract: 100, note: '1 lot = 100 troy ounces' },
  silver: { label: 'Silver', contract: 5_000, note: '1 lot = 5,000 troy ounces' },
  oil: { label: 'Oil', contract: 1_000, note: '1 lot = 1,000 barrels' },
  index: { label: 'Index', contract: 1, note: '1 lot = 1 unit per point (check your broker)' },
  crypto: { label: 'Crypto', contract: 1, note: '1 lot = 1 coin' },
  stock: { label: 'Stock', contract: 1, note: '1 lot = 1 share' },
  synthetic: { label: 'Synthetic', contract: 1, note: '1 lot = 1 unit per point (check your broker)' },
};

export const QUOTE_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'NGN', 'ZAR'] as const;

/** Guesses the market type, quote currency and pip size (forex pip, else a point = 1.00 price move) from a symbol like "GBPJPY", "XAU/USD", "NAS100", "BTC" */
export function guessFromSymbol(raw: string): { market: CalcMarket; quote: string; pip: number } {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^XAU/.test(s) || s === 'GOLD') return { market: 'gold', quote: 'USD', pip: 1 };
  if (/^XAG/.test(s) || s === 'SILVER') return { market: 'silver', quote: 'USD', pip: 1 };
  if (/^(WTI|BRENT|USOIL|UKOIL|OIL|CL)/.test(s)) return { market: 'oil', quote: 'USD', pip: 1 };
  if (/^(US30|NAS100|SPX|SPX500|US500|GER40|DE40|UK100|JP225|DJI|NDX)/.test(s)) {
    const quote = /^(GER40|DE40)/.test(s) ? 'EUR' : /^UK100/.test(s) ? 'GBP' : /^JP225/.test(s) ? 'JPY' : 'USD';
    return { market: 'index', quote, pip: 1 };
  }
  if (/^(VOLATILITY|BOOM|CRASH|STEP|JUMP|R\d|V\d)/.test(s)) return { market: 'synthetic', quote: 'USD', pip: 1 };
  const ccy = new Set<string>(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'NGN', 'ZAR', 'SEK', 'NOK', 'SGD', 'HKD', 'MXN', 'TRY', 'CNH']);
  if (s.length === 6 && ccy.has(s.slice(0, 3)) && ccy.has(s.slice(3))) {
    const quote = s.slice(3);
    return { market: 'forex', quote, pip: quote === 'JPY' ? 0.01 : 0.0001 };
  }
  if (/(USDT|USDC|USD)$/.test(s) && s.length > 4) return { market: 'crypto', quote: 'USD', pip: 1 };
  if (/^(BTC|ETH|SOL|XRP|BNB|DOGE|ADA|TON|AVAX|LINK|DOT|SHIB|PEPE|WIF|SUI|TRX|LTC)$/.test(s)) return { market: 'crypto', quote: 'USD', pip: 1 };
  if (/^[A-Z]{1,5}$/.test(s)) return { market: 'stock', quote: 'USD', pip: 1 };
  return { market: 'forex', quote: 'USD', pip: 0.0001 };
}

export interface CalcInput {
  account: number;
  /** Lot size mode: % of the account to risk. Check mode: ignored */
  riskPct?: number;
  /** Check mode: the lot size to check */
  lots?: number;
  contract: number;
  /** Stop distance in price units (from entry and stop, or pips × pip size) */
  distance: number;
  /** Price distance from entry to the take profit, if one is given */
  rewardDistance?: number | null;
  /** 1 unit of the quote currency in account currency */
  fx: number;
  /** Pip (or point) size, for the value per pip */
  pip: number;
  /** Smallest lot step at the broker (default 0.01) */
  lotStep?: number;
}

export interface CalcResult {
  lots: number;
  /** Lots before rounding down to the lot step */
  rawLots: number;
  risk: number;
  riskPct: number;
  /** Account money per pip (or point) for the lots */
  pipValue: number;
  /** Account money per pip for 1.00 lot */
  pipValuePerLot: number;
  reward: number | null;
  rr: number | null;
  stopPips: number;
  /** The lot size is below the smallest step: the trade can't be sized this small */
  belowMinimum: boolean;
  units: number;
}

const floorTo = (n: number, step: number) => Math.floor(n / step + 1e-9) * step;
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Lot size for a risk % (when `lots` is not given) or the risk of a given lot size */
export function calculate(i: CalcInput): CalcResult | null {
  const { account, contract, distance, fx, pip } = i;
  if (!(account > 0) || !(contract > 0) || !(distance > 0) || !(fx > 0) || !(pip > 0)) return null;
  const step = i.lotStep && i.lotStep > 0 ? i.lotStep : 0.01;
  const perLot = contract * distance * fx;
  let rawLots: number;
  let lots: number;
  if (i.lots != null) {
    if (!(i.lots > 0)) return null;
    rawLots = i.lots;
    lots = i.lots;
  } else {
    if (!(Number(i.riskPct) > 0)) return null;
    rawLots = (account * Number(i.riskPct)) / 100 / perLot;
    lots = round(floorTo(rawLots, step), 6);
  }
  const risk = lots * perLot;
  const pipValuePerLot = contract * pip * fx;
  const reward = i.rewardDistance && i.rewardDistance > 0 ? lots * contract * i.rewardDistance * fx : null;
  return {
    lots,
    rawLots,
    risk,
    riskPct: (risk / account) * 100,
    pipValue: lots * pipValuePerLot,
    pipValuePerLot,
    reward,
    rr: i.rewardDistance && i.rewardDistance > 0 ? i.rewardDistance / distance : null,
    stopPips: distance / pip,
    belowMinimum: i.lots == null && lots < step,
    units: lots * contract,
  };
}

/**
 * Stop and target distances from prices. Returns null when the levels don't make a trade (stop and target on the same
 * side of the entry, or equal prices). Direction comes from the stop: below the entry = buy, above = sell.
 */
export function distancesFromPrices(entry: number, stop: number, tp?: number | null): { distance: number; rewardDistance: number | null; direction: 'BUY' | 'SELL' } | null {
  if (!(entry > 0) || !(stop > 0) || entry === stop) return null;
  const direction = stop < entry ? 'BUY' : 'SELL';
  let rewardDistance: number | null = null;
  if (tp != null && tp > 0) {
    if (direction === 'BUY' ? tp <= entry : tp >= entry) return null;
    rewardDistance = Math.abs(tp - entry);
  }
  return { distance: Math.abs(entry - stop), rewardDistance, direction };
}
