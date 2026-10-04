// Currency conversion for the trade calculator (Preference Mode): one table of USD rates for every currency
// (open.er-api.com, no key, the same source as payments), cached for an hour, one refresh at a time, a minute's pause after a failure.
import type { Express, NextFunction, Request, Response } from 'express';

const TTL_MS = 60 * 60 * 1000;
const RETRY_MS = 60 * 1000;
let table: { rates: Record<string, number>; at: number } | null = null;
let inflight: Promise<void> | null = null;
let failedAt = 0;

function refresh(): Promise<void> {
  if (inflight) return inflight;
  if (Date.now() - failedAt < RETRY_MS) return Promise.resolve();
  inflight = (async () => {
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: AbortSignal.timeout(6000) });
      const data: any = res.ok ? await res.json() : null;
      const rates = data?.rates && typeof data.rates === 'object' ? (data.rates as Record<string, number>) : null;
      if (rates && Number(rates.EUR) > 0) {
        table = { rates, at: Date.now() };
        failedAt = 0;
      } else failedAt = Date.now();
    } catch {
      failedAt = Date.now();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 1 unit of `from` in `to`, or null when the rate is not known right now */
export async function fxRate(from: string, to: string): Promise<{ rate: number; at: number } | null> {
  if (from === to) return { rate: 1, at: Date.now() };
  if (!table || Date.now() - table.at > TTL_MS) await refresh();
  const a = table?.rates[from], b = table?.rates[to];
  return table && Number(a) > 0 && Number(b) > 0 ? { rate: Number(b) / Number(a), at: table.at } : null;
}

const CODE = /^[A-Z]{3}$/;
export function registerFxRoutes(app: Express, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  app.get('/api/fx', limiter, async (req: Request, res: Response) => {
    const from = String(req.query.from || '').toUpperCase();
    const to = String(req.query.to || '').toUpperCase();
    if (!CODE.test(from) || !CODE.test(to)) return res.status(400).json({ error: 'BAD_REQUEST', message: 'Use 3-letter currency codes.' });
    const r = await fxRate(from, to).catch(() => null);
    if (!r) return res.status(503).json({ error: 'RATE_UNAVAILABLE', message: 'Live rate unavailable right now. Enter it by hand.' });
    res.json({ from, to, rate: r.rate, at: r.at });
  });
}
