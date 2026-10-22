// ===========================================================================
// Buyers vs sellers (owner-specified, information only): who is in control of a market right now.
//
// Shown live on every analysis card. It is NEVER part of the analysis: the engine, its instructions, the signal and the
// analyze route don't read it, and the card fetches it on its own (GET /api/pressure). Read from fresh 1-minute candles
// (falls back to 5-minute when a market has no 1-minute feed):
//   - Price action, every market: where each candle closed inside its true range (close near the high = buyers won the
//     minute, near the low = sellers), weighted by the candle's size and how recent it is.
//   - Order flow, coins on Binance: the share of volume bought at market (taker buys) against sold at market.
// Two windows: the last 60 minutes (who is in control) and the last 15 (who is gaining).
// ===========================================================================
import type { Express, Request, Response } from 'express';
import { requireAuth, getUser } from './account';
import { createKeyedThrottle } from './security';

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}
export interface FlowBar {
  t: number;
  /** Total volume of the minute */
  volume: number;
  /** Volume bought at market (taker buys) */
  takerBuy: number;
}

export type PressureSide = 'BUYERS' | 'SELLERS' | 'BALANCED';
export interface PressureRead {
  symbol: string;
  /** 0 to 100, buyers' share of the pressure over the main window (sellers = 100 - buyers) */
  buyers: number;
  sellers: number;
  side: PressureSide;
  strength: 'STRONG' | 'CLEAR' | 'SLIGHT' | 'EVEN';
  /** Plain words: "Buyers in control", "Sellers slightly ahead", "Balanced" */
  label: string;
  /** Buyers' share over the last 15 minutes, and which way it is moving against the hour */
  recentBuyers: number;
  momentum: 'BUYERS_GAINING' | 'SELLERS_GAINING' | 'STEADY';
  /** Price change over the main window, % */
  changePct: number;
  /** How it was read: order flow + price action, or price action only */
  method: 'ORDER_FLOW' | 'PRICE_ACTION';
  /** Candle size and how many minutes were read */
  timeframe: '1M' | '5M';
  windowMinutes: number;
  /** Open time of the latest candle read; the market is quiet / closed when it is old */
  lastBarAt: number;
  quiet: boolean;
  asOf: number;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Buyers' share (0..1) from price action: close location in the true range, weighted by size and recency */
function priceActionShare(bars: Bar[]): number | null {
  let buy = 0;
  let sell = 0;
  const n = bars.length;
  for (let i = 1; i < n; i++) {
    const b = bars[i];
    const prev = bars[i - 1].c;
    const lo = Math.min(b.l, prev);
    const hi = Math.max(b.h, prev);
    const range = hi - lo;
    if (!(range > 0)) continue;
    // Recent minutes count more (the oldest half as much as the newest)
    const w = 0.5 + (0.5 * i) / (n - 1);
    buy += w * (b.c - lo);
    sell += w * (hi - b.c);
  }
  return buy + sell > 0 ? buy / (buy + sell) : null;
}

/** Buyers' share (0..1) from order flow: volume bought at market against all volume, weighted by recency */
function flowShare(flow: FlowBar[]): number | null {
  let buy = 0;
  let all = 0;
  const n = flow.length;
  for (let i = 0; i < n; i++) {
    const f = flow[i];
    if (!(f.volume > 0) || !(f.takerBuy >= 0)) continue;
    const w = 0.5 + (0.5 * i) / Math.max(1, n - 1);
    buy += w * Math.min(f.takerBuy, f.volume);
    all += w * f.volume;
  }
  return all > 0 ? buy / all : null;
}

const shareOf = (bars: Bar[], flow: FlowBar[] | null) => {
  const pa = priceActionShare(bars);
  const of = flow && flow.length >= 5 ? flowShare(flow) : null;
  if (pa === null && of === null) return null;
  // Order flow is the truer read where it exists; price action keeps it honest
  return of === null ? pa! : pa === null ? of : of * 0.65 + pa * 0.35;
};

/** Reads buyers vs sellers from fresh candles (and order flow where there is any). Pure: no fetching here. */
export function readPressure(symbol: string, barsRaw: Bar[], flowRaw: FlowBar[] | null, timeframe: '1M' | '5M', now = Date.now()): PressureRead | null {
  const bars = barsRaw.filter(b => [b.o, b.h, b.l, b.c].every(v => Number.isFinite(v)) && b.h >= b.l).sort((a, b) => a.t - b.t);
  if (bars.length < 6) return null;
  const step = timeframe === '1M' ? 60_000 : 300_000;
  const mainN = Math.min(bars.length, timeframe === '1M' ? 61 : 13);
  const recentN = Math.min(bars.length, timeframe === '1M' ? 16 : 4);
  const main = bars.slice(-mainN);
  const recent = bars.slice(-recentN);
  const flow = flowRaw ? flowRaw.filter(f => Number.isFinite(f.volume) && Number.isFinite(f.takerBuy)).sort((a, b) => a.t - b.t) : null;
  const flowMain = flow ? flow.filter(f => f.t >= main[0].t) : null;
  const flowRecent = flow ? flow.filter(f => f.t >= recent[0].t) : null;
  const s = shareOf(main, flowMain);
  if (s === null) return null;
  const r = shareOf(recent, flowRecent) ?? s;
  const buyers = Math.round(clamp(s * 100, 0, 100));
  const recentBuyers = Math.round(clamp(r * 100, 0, 100));
  const edge = buyers - 50;
  const abs = Math.abs(edge);
  const side: PressureSide = abs < 3 ? 'BALANCED' : edge > 0 ? 'BUYERS' : 'SELLERS';
  const strength = abs >= 12 ? 'STRONG' : abs >= 6 ? 'CLEAR' : abs >= 3 ? 'SLIGHT' : 'EVEN';
  const who = side === 'BUYERS' ? 'Buyers' : 'Sellers';
  const label = side === 'BALANCED' ? 'Balanced, neither side in control' : strength === 'STRONG' ? `${who} firmly in control` : strength === 'CLEAR' ? `${who} in control` : `${who} slightly ahead`;
  const shift = recentBuyers - buyers;
  const momentum = shift >= 5 ? 'BUYERS_GAINING' : shift <= -5 ? 'SELLERS_GAINING' : 'STEADY';
  const first = main[0].o;
  const last = main[main.length - 1];
  const changePct = first > 0 ? Number((((last.c - first) / first) * 100).toFixed(2)) : 0;
  return {
    symbol,
    buyers,
    sellers: 100 - buyers,
    side,
    strength,
    label,
    recentBuyers,
    momentum,
    changePct,
    method: flowMain && flowMain.length >= 5 ? 'ORDER_FLOW' : 'PRICE_ACTION',
    timeframe,
    windowMinutes: Math.round(((mainN - 1) * step) / 60_000),
    lastBarAt: last.t,
    // No new candle for 20 minutes (or 3 five-minute candles): the market is closed or barely trading
    quiet: now - last.t > Math.max(20 * 60_000, step * 3),
    asOf: now,
  };
}

export interface PressureDeps {
  /** Fresh candles of the market a symbol names (null = no feed / unknown market) */
  candles: (symbol: string, tf: '1M' | '5M') => Promise<{ symbol: string; bars: Bar[] } | null>;
  /** Order flow (taker buys) for the same minutes, where the venue publishes it (null otherwise) */
  flow: (symbol: string) => Promise<FlowBar[] | null>;
}

export function registerPressureRoutes(app: Express, deps: PressureDeps, limiter: any) {
  // Each card refreshes every 15s while it is on screen: plenty of room per trader, and one read per market per 5s is shared
  const perUser = createKeyedThrottle({ windowMs: 60_000, max: 40 });
  const shared = new Map<string, { at: number; p: Promise<PressureRead | null> }>();
  const SHARE_MS = 5_000;

  const read = (symbol: string): Promise<PressureRead | null> => {
    const key = symbol.toUpperCase();
    const hit = shared.get(key);
    if (hit && Date.now() - hit.at < SHARE_MS) return hit.p;
    const p = (async () => {
      let tf: '1M' | '5M' = '1M';
      let got = await deps.candles(symbol, '1M').catch(() => null);
      if (!got || got.bars.length < 6) {
        tf = '5M';
        got = await deps.candles(symbol, '5M').catch(() => null);
      }
      if (!got || got.bars.length < 6) return null;
      const flow = tf === '1M' ? await deps.flow(got.symbol).catch(() => null) : null;
      return readPressure(got.symbol, got.bars, flow, tf);
    })();
    shared.set(key, { at: Date.now(), p });
    if (shared.size > 500) for (const [k, v] of shared) if (Date.now() - v.at > SHARE_MS) shared.delete(k);
    return p;
  };

  app.get('/api/pressure', limiter, requireAuth, async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    if (perUser.hit(getUser(res).uid)) return res.status(429).json({ error: 'TOO_MANY', message: 'Refreshing too fast. Try again in a moment.' });
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.replace(/[^\w/.\-$ ]/g, '').trim().slice(0, 60) : '';
    if (!symbol) return res.status(400).json({ error: 'BAD_REQUEST', message: 'Which market?' });
    try {
      const p = await Promise.race([read(symbol), new Promise<null>(r => setTimeout(() => r(null), 8000))]);
      if (!p) return res.status(503).json({ error: 'PRESSURE_UNAVAILABLE', message: "Live buying and selling pressure can't be read for this market right now." });
      res.json({ pressure: p });
    } catch {
      res.status(503).json({ error: 'PRESSURE_UNAVAILABLE', message: "Live buying and selling pressure can't be read for this market right now." });
    }
  });
}
