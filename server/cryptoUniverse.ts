// Every tradeable crypto, not just the majors.
// - Exchange-listed coins: the full USDT spot lists of Binance, Bybit and MEXC (MEXC lists thousands of memecoins),
//   refreshed every 6 hours. Quotes and candles come from the first exchange that lists the coin.
// - Coins that only trade on-chain (fresh Solana / Base / ETH memes): resolved by ticker or contract address through
//   DexScreener (most liquid pool, minimum liquidity so rugs and dust pools are ignored), candles from GeckoTerminal.
import type { Candle } from './strategy';
import { aggregateCandles, timeframeMinutes } from './strategy';

export type CryptoVenue = 'binance' | 'bybit' | 'mexc' | 'dex';

export interface DexToken {
  symbol: string;
  name: string;
  address: string;
  chainId: string;
  network: string;
  pairAddress: string;
  dexId: string;
  priceUsd: number;
  change24h: number;
  liquidityUsd: number;
  volume24h: number;
  /** Fully diluted valuation and market cap in USD (0 when the pool doesn't report them) */
  fdv: number;
  marketCap: number;
  /** When the pool was created (ms, 0 if unknown) */
  pairCreatedAt: number;
  quoteSymbol: string;
}

export interface CryptoListing {
  base: string;
  venue: CryptoVenue;
  /** Exchange pair, e.g. WIFUSDT (exchange venues) */
  pair?: string;
  dex?: DexToken;
}

export interface VenueQuote {
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: string;
  source: string;
}

/** Pools thinner than this are not analyzed: the price is too easy to push around and exits may not fill */
export const MIN_DEX_LIQUIDITY_USD = Math.max(1000, Number(process.env.MIN_DEX_LIQUIDITY_USD) || 20000);
const UNIVERSE_REFRESH_MS = 6 * 3600e3;
const UNIVERSE_RETRY_MS = 5 * 60e3;
const DEX_SEARCH_TTL_MS = 10 * 60e3;
const DEX_CANDLE_TTL_MS = 60e3; // GeckoTerminal allows ~30 calls a minute, so its candles are shared for a minute
const CEX_CANDLE_TTL_MS = 5e3;

/**
 * Per-worker budgets for the free on-chain APIs (DexScreener allows ~300 calls a minute, GeckoTerminal ~30), so a burst
 * of random tickers on the public quote endpoint can never exhaust them for everyone. Cached answers never count.
 */
function minuteBudget(perMinute: number) {
  let windowStart = 0;
  let used = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart >= 60e3) {
      windowStart = now;
      used = 0;
    }
    if (used >= perMinute) return false;
    used++;
    return true;
  };
}
const dexSearchBudget = minuteBudget(Math.max(10, Number(process.env.DEX_SEARCH_PER_MIN) || 60));
const geckoBudget = minuteBudget(Math.max(4, Number(process.env.GECKO_CALLS_PER_MIN) || 12));

async function getJson(url: string, timeoutMs = 6000): Promise<any | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Exchange universes
// ---------------------------------------------------------------------------
const universe: Record<'binance' | 'bybit' | 'mexc', Set<string>> = { binance: new Set(), bybit: new Set(), mexc: new Set() };
let universeLoadedAt = 0;
let universeTimer: ReturnType<typeof setTimeout> | null = null;

const basesFrom = (symbols: string[]) => {
  const out = new Set<string>();
  for (const s of symbols) {
    const m = /^([A-Z0-9]{1,20})USDT$/.exec(String(s || '').toUpperCase());
    if (m) out.add(m[1]);
  }
  return out;
};

export async function refreshCryptoUniverse(): Promise<void> {
  const [bn, by, mx] = await Promise.all([
    getJson('https://api.binance.com/api/v3/ticker/price').then(d => d || getJson('https://data-api.binance.vision/api/v3/ticker/price')),
    getJson('https://api.bybit.com/v5/market/tickers?category=spot'),
    getJson('https://api.mexc.com/api/v3/ticker/price'),
  ]);
  if (Array.isArray(bn)) universe.binance = basesFrom(bn.map((x: any) => x?.symbol));
  if (Array.isArray(by?.result?.list)) universe.bybit = basesFrom(by.result.list.map((x: any) => x?.symbol));
  if (Array.isArray(mx)) universe.mexc = basesFrom(mx.map((x: any) => x?.symbol));
  const total = new Set([...universe.binance, ...universe.bybit, ...universe.mexc]).size;
  if (total > 0) universeLoadedAt = Date.now();
  console.log(`[MarketX Crypto] universe: ${total} coins (Binance ${universe.binance.size}, Bybit ${universe.bybit.size}, MEXC ${universe.mexc.size})`);
}

/** Loads the exchange lists now and keeps them fresh (every 6 hours, or 5 minutes after a failed load). */
export function startCryptoUniverse(): void {
  const tick = async () => {
    await refreshCryptoUniverse().catch(() => {});
    universeTimer = setTimeout(tick, universeLoadedAt && Date.now() - universeLoadedAt < 60e3 ? UNIVERSE_REFRESH_MS : UNIVERSE_RETRY_MS);
    universeTimer.unref?.();
  };
  if (!universeTimer) tick();
}

export function universeSize(): number {
  return new Set([...universe.binance, ...universe.bybit, ...universe.mexc]).size;
}

/** True when any supported exchange lists BASE/USDT. */
export function isListedCoin(base: string): boolean {
  const b = base.toUpperCase();
  return universe.binance.has(b) || universe.bybit.has(b) || universe.mexc.has(b) || dexBySymbol.has(b);
}

/** Where to quote and chart a coin: Binance first, then Bybit, then MEXC, then a DEX token resolved earlier. */
export function cryptoListing(base: string): CryptoListing | null {
  const b = base.toUpperCase();
  for (const venue of ['binance', 'bybit', 'mexc'] as const) if (universe[venue].has(b)) return { base: b, venue, pair: `${b}USDT` };
  const dex = dexBySymbol.get(b);
  return dex ? { base: b, venue: 'dex', dex } : null;
}

// ---------------------------------------------------------------------------
// On-chain tokens (DexScreener)
// ---------------------------------------------------------------------------
// DexScreener chain ids → GeckoTerminal network ids
const GT_NETWORK: Record<string, string> = {
  solana: 'solana', ethereum: 'eth', bsc: 'bsc', base: 'base', arbitrum: 'arbitrum', polygon: 'polygon_pos', avalanche: 'avax',
  optimism: 'optimism', sui: 'sui-network', ton: 'ton', tron: 'tron', blast: 'blast', fantom: 'ftm', linea: 'linea', zksync: 'zksync',
  pulsechain: 'pulsechain', cronos: 'cro', mantle: 'mantle', scroll: 'scroll', sonic: 'sonic', abstract: 'abstract', berachain: 'berachain',
};
const SAFE_ID = /^[A-Za-z0-9_\-.]{1,120}$/;
/** EVM (0x + 40 hex), Solana base58 (32 to 44) or other chains' plain alphanumeric ids, nothing else */
const CONTRACT_RE = /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}|[A-Za-z0-9_:.\-]{3,100})$/;
/** A display name from a third party: no control characters, markup or line breaks, one line, capped */
const cleanLabel = (v: unknown, max: number) =>
  String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const dexBySymbol = new Map<string, DexToken>();
const dexSearchCache = new Map<string, { at: number; p: Promise<DexToken | null> }>();

function toDexToken(p: any): DexToken | null {
  const price = Number(p?.priceUsd);
  const chainId = String(p?.chainId || '');
  const pairAddress = String(p?.pairAddress || '');
  const address = String(p?.baseToken?.address || '');
  // Everything here comes from a third party and is shown to traders and given to the engine as market data:
  // only real contract address formats, and names without control characters or markup
  if (!(price > 0) || !SAFE_ID.test(chainId) || !SAFE_ID.test(pairAddress) || !CONTRACT_RE.test(address)) return null;
  return {
    symbol: String(p.baseToken.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) || 'TOKEN',
    name: cleanLabel(p.baseToken.name || p.baseToken.symbol, 60) || 'Token',
    address,
    chainId,
    network: GT_NETWORK[chainId] || chainId,
    pairAddress,
    dexId: String(p?.dexId || 'dex').replace(/[^A-Za-z0-9_\-. ]/g, '').slice(0, 40) || 'dex',
    priceUsd: price,
    change24h: Number(p?.priceChange?.h24) || 0,
    liquidityUsd: Number(p?.liquidity?.usd) || 0,
    volume24h: Number(p?.volume?.h24) || 0,
    fdv: Number(p?.fdv) || 0,
    marketCap: Number(p?.marketCap) || 0,
    pairCreatedAt: Number(p?.pairCreatedAt) || 0,
    quoteSymbol: String(p?.quoteToken?.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12),
  };
}

/** The most liquid pool for a ticker (exact symbol match) or a contract address, above the liquidity floor. */
function pickPool(pairs: any[], wantSymbol: string | null, wantAddress: string | null): DexToken | null {
  const tokens = (Array.isArray(pairs) ? pairs : [])
    .map(toDexToken)
    .filter((t): t is DexToken => !!t && t.liquidityUsd >= MIN_DEX_LIQUIDITY_USD)
    .filter(t => (wantAddress ? t.address.toLowerCase() === wantAddress.toLowerCase() : t.symbol === wantSymbol));
  tokens.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  return tokens[0] || null;
}

/** Finds an on-chain token by ticker (ANSEM) or contract address. Cached for 10 minutes. */
export function lookupDexToken(query: string): Promise<DexToken | null> {
  const q = String(query || '').trim();
  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(q) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);
  if (!isAddress && !/^[A-Za-z0-9]{1,20}$/.test(q)) return Promise.resolve(null);
  const key = isAddress ? q : q.toUpperCase();
  const hit = dexSearchCache.get(key);
  if (hit && Date.now() - hit.at < DEX_SEARCH_TTL_MS) return hit.p;
  if (!dexSearchBudget()) return Promise.resolve(null); // over this minute's budget: treated as not found, retried later
  const p = (async () => {
    const data = isAddress
      ? await getJson(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(q)}`)
      : await getJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(key)}`);
    const token = pickPool(data?.pairs, isAddress ? null : key, isAddress ? q : null);
    if (token) dexBySymbol.set(token.symbol, token);
    return token;
  })();
  dexSearchCache.set(key, { at: Date.now(), p });
  p.then(t => { if (!t) dexSearchCache.set(key, { at: Date.now() - DEX_SEARCH_TTL_MS + 60e3, p }); }); // retry misses after a minute
  if (dexSearchCache.size > 2000) for (const [k, v] of dexSearchCache) if (Date.now() - v.at > DEX_SEARCH_TTL_MS) dexSearchCache.delete(k);
  return p;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------
const fmtVol = (v: number) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '0');

export async function fetchVenueQuote(l: CryptoListing): Promise<VenueQuote | null> {
  if (l.venue === 'bybit' && l.pair) {
    const d = await getJson(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(l.pair)}`, 4000);
    const t = d?.result?.list?.[0];
    const price = Number(t?.lastPrice);
    if (!(price > 0)) return null;
    return { price, change24h: Number(t.price24hPcnt) * 100 || 0, high24h: Number(t.highPrice24h) || price, low24h: Number(t.lowPrice24h) || price, volume24h: fmtVol(Number(t.volume24h)), source: 'Bybit spot' };
  }
  if (l.venue === 'mexc' && l.pair) {
    const t = await getJson(`https://api.mexc.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(l.pair)}`, 4000);
    const price = Number(t?.lastPrice);
    if (!(price > 0)) return null;
    const open = Number(t.openPrice);
    return { price, change24h: open > 0 ? ((price - open) / open) * 100 : 0, high24h: Number(t.highPrice) || price, low24h: Number(t.lowPrice) || price, volume24h: fmtVol(Number(t.volume)), source: 'MEXC spot' };
  }
  if (l.venue === 'dex' && l.dex) {
    const { chainId, pairAddress } = l.dex;
    const d = await getJson(`https://api.dexscreener.com/latest/dex/pairs/${encodeURIComponent(chainId)}/${encodeURIComponent(pairAddress)}`, 4000);
    const t = toDexToken(d?.pairs?.[0] || d?.pair) || l.dex;
    // 24h range from the pool's own hourly candles (DexScreener only gives price and change)
    const hours = await fetchVenueCandles({ ...l, dex: t }, '1H').catch(() => null);
    const day = (hours || []).filter(c => c.t >= Date.now() - 24 * 3600e3);
    const high = day.length ? Math.max(...day.map(c => c.h), t.priceUsd) : t.priceUsd;
    const low = day.length ? Math.min(...day.map(c => c.l), t.priceUsd) : t.priceUsd;
    return { price: t.priceUsd, change24h: t.change24h, high24h: high, low24h: low, volume24h: `$${fmtVol(t.volume24h)}`, source: `${t.dexId} (${t.chainId})` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Candles
// ---------------------------------------------------------------------------
// [source interval, minutes per source bar]; larger timeframes are aggregated from these
const BYBIT_TF: Record<string, string> = { '1M': '1', '3M': '3', '5M': '5', '15M': '15', '30M': '30', '1H': '60', '2H': '120', '4H': '240', '6H': '360', '8H': '240', '12H': '720', '1D': 'D', '1W': 'W' };
const MEXC_TF: Record<string, [string, number]> = {
  '1M': ['1m', 1], '3M': ['1m', 1], '5M': ['5m', 5], '15M': ['15m', 15], '30M': ['30m', 30], '1H': ['60m', 60], '2H': ['60m', 60],
  '4H': ['4h', 240], '6H': ['60m', 60], '8H': ['4h', 240], '12H': ['4h', 240], '1D': ['1d', 1440], '1W': ['1W', 10080],
};
const GT_TF: Record<string, [string, number, number]> = {
  // [timeframe, aggregate, minutes per bar]
  '1M': ['minute', 1, 1], '3M': ['minute', 1, 1], '5M': ['minute', 5, 5], '15M': ['minute', 15, 15], '30M': ['minute', 15, 15],
  '1H': ['hour', 1, 60], '2H': ['hour', 1, 60], '4H': ['hour', 4, 240], '6H': ['hour', 1, 60], '8H': ['hour', 4, 240],
  '12H': ['hour', 12, 720], '1D': ['day', 1, 1440], '1W': ['day', 1, 1440],
};

const rawCache = new Map<string, { at: number; ttl: number; p: Promise<Candle[] | null> }>();
function cached(key: string, ttl: number, load: () => Promise<Candle[] | null>): Promise<Candle[] | null> {
  const hit = rawCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.p;
  const p = load().catch(() => null);
  rawCache.set(key, { at: Date.now(), ttl, p });
  p.then(c => { if (!c && rawCache.get(key)?.p === p) rawCache.delete(key); });
  if (rawCache.size > 3000) for (const [k, v] of rawCache) if (Date.now() - v.at > v.ttl) rawCache.delete(k);
  return p;
}
const clean = (rows: Candle[]) => rows.filter(c => [c.o, c.h, c.l, c.c].every(v => Number.isFinite(v) && v > 0)).sort((a, b) => a.t - b.t);
const finish = (raw: Candle[] | null, tf: string, baseMinutes: number) => {
  if (!raw || !raw.length) return null;
  const want = timeframeMinutes(tf);
  return (want > baseMinutes ? aggregateCandles(raw, want) : raw).slice(-300);
};

export async function fetchVenueCandles(l: CryptoListing, tf: string): Promise<Candle[] | null> {
  if (l.venue === 'bybit' && l.pair) {
    const interval = BYBIT_TF[tf];
    if (!interval) return null;
    const agg = tf === '8H';
    const raw = await cached(`bybit|${l.pair}|${interval}`, CEX_CANDLE_TTL_MS, async () => {
      const d = await getJson(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${encodeURIComponent(l.pair!)}&interval=${interval}&limit=${agg ? 1000 : 300}`, 5000);
      const list = d?.result?.list;
      return Array.isArray(list) ? clean(list.map((r: any[]) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }))) : null;
    });
    return finish(raw, tf, agg ? 240 : timeframeMinutes(tf));
  }
  if (l.venue === 'mexc' && l.pair) {
    const plan = MEXC_TF[tf];
    if (!plan) return null;
    const [interval, baseMin] = plan;
    const raw = await cached(`mexc|${l.pair}|${interval}`, CEX_CANDLE_TTL_MS, async () => {
      const d = await getJson(`https://api.mexc.com/api/v3/klines?symbol=${encodeURIComponent(l.pair!)}&interval=${interval}&limit=1000`, 5000);
      return Array.isArray(d) ? clean(d.map((r: any[]) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }))) : null;
    });
    return finish(raw, tf, baseMin);
  }
  if (l.venue === 'dex' && l.dex) {
    const plan = GT_TF[tf];
    if (!plan || !SAFE_ID.test(l.dex.network) || !SAFE_ID.test(l.dex.pairAddress)) return null;
    const [frame, aggregate, baseMin] = plan;
    const { network, pairAddress } = l.dex;
    const raw = await cached(`gt|${network}|${pairAddress}|${frame}|${aggregate}`, DEX_CANDLE_TTL_MS, async () => {
      if (!geckoBudget()) return null;
      const d = await getJson(
        `https://api.geckoterminal.com/api/v2/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pairAddress)}/ohlcv/${frame}?aggregate=${aggregate}&limit=1000&currency=usd&token=base`,
        7000
      );
      const list = d?.data?.attributes?.ohlcv_list;
      return Array.isArray(list) ? clean(list.map((r: any[]) => ({ t: Number(r[0]) * 1000, o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }))) : null;
    });
    return finish(raw, tf, baseMin);
  }
  return null;
}

/** For tests: forget the exchange lists and caches. */
export function __resetCryptoUniverse(): void {
  for (const k of Object.keys(universe) as Array<keyof typeof universe>) universe[k] = new Set();
  dexBySymbol.clear();
  dexSearchCache.clear();
  rawCache.clear();
}
