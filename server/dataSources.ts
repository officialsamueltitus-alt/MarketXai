// What MarketX's live data actually comes from. Given to the AI when a user asks about data sources, so its answer
// is accurate (no invented caches or feeds). The AI engine's own provider is never named here.

export const DATA_SOURCES_FACTS = `MARKETX DATA SOURCES (accurate; describe only these):
- Crypto (BTC, ETH, SOL, XRP, BNB and others): Binance public spot market API, 24hr ticker (GET https://api.binance.com/api/v3/ticker/24hr?symbol=... for one pair, ?symbols=[...] in one batch for the live price board). Last traded price, 24h change %, 24h high/low and volume. Candles for analyses come from Binance klines.
- Gold (XAU/USD): Binance PAXG/USDT, a token backed 1:1 by one fine troy ounce of London Good Delivery gold, so gold prices stay live 24/7 including weekends. COMEX gold futures via Yahoo Finance are the backup. Silver, platinum, palladium, WTI, Brent, natural gas and copper use global futures benchmarks via Yahoo Finance.
- Forex (EUR/USD, GBP/USD, USD/JPY, GBP/JPY and other crosses): live intraday quotes via Yahoo Finance (e.g. EURUSD=X), with the open.er-api.com interbank reference rates (https://open.er-api.com/v6/latest/USD) as the backup, where a cross is computed as quote rate / base rate. Prices use 3 decimals for JPY pairs and 5 for the others.
- Stocks and indices (NVDA, TSLA, AAPL, GOOGL, US30, NAS100, SPX500, GER40, UK100, JP225): Yahoo Finance chart API (https://query1.finance.yahoo.com/v8/finance/chart/{symbol}): regularMarketPrice, previous close, day high and day low.
- Deriv synthetic indices (Volatility, Boom, Crash, Step, Jump): live prices and candles straight from Deriv's own API.
- News: ForexFactory economic calendar (high impact releases, bank holidays) and the MarketWatch / Dow Jones news wire, filtered to today and to the asset.
- Uploaded charts: read by the MarketX vision engine directly from the image.
- Freshness: prices stream to the site about every second (crypto and gold) and every few seconds (forex, stocks, indices, at their source's pace). Every analysis fetches its price and candles live at the moment it is requested; nothing is answered from an old stored price. If a feed is briefly down, the last real price is kept for at most one minute.
- How it grounds an analysis: the live price, 24h change, high and low are fetched first and given to the AI as REAL-TIME VERIFIED MARKET DATA; supply and demand zones, the Fibonacci levels (0.5 equilibrium, 0.618 golden pocket), the stop loss and the targets are computed from real candles of the requested timeframe and checked for mitigation before any signal.`;

const ABOUT_SOURCES = /\b(source|sources|data ?feed|feeds|api|apis|where (do|does) .*(price|data)|real.?time|how accurate|accuracy|data provider|providers?)\b/i;

/** True when the question is about where MarketX's data comes from. */
export function asksAboutDataSources(prompt: string): boolean {
  return ABOUT_SOURCES.test(String(prompt || ''));
}
