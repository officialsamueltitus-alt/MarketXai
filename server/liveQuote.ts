// Real-time market data: prices and candles are fetched from the source at the moment they are asked for.
// - A value is reused only within the same second (LIVE_QUOTE_FRESH_MS, default 1000): requests arriving together
//   share one upstream fetch, so a traffic spike can't get the server blocked by the exchanges.
// - If the source fails, the last real price is served for at most LAST_GOOD_MAX_MS (then nothing), and the source
//   is retried after a short back-off instead of being hammered.

import { AsyncLocalStorage } from 'async_hooks';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const LIVE_FRESH_MS = clamp(Math.floor(Number(process.env.LIVE_QUOTE_FRESH_MS) || 1000), 250, 5000);
export const LAST_GOOD_MAX_MS = 60_000;
/** Owner-specified: a price used for an analysis, a scan or an alert decision must have been fetched from its source within
 *  this window. An older one (a feed hiccup serving its last good value) is marked not live, and the caller takes the latest
 *  real candle instead (or stops, credit refunded): an old price is never passed off as the current one. */
export const QUOTE_MAX_AGE_MS = 5_000;

// Which source values a quote lookup used, so its result can say when its oldest input was fetched
const freshness = new AsyncLocalStorage<{ oldest: number }>();
const noteFetchedAt = (at: number) => {
  const ctx = freshness.getStore();
  if (ctx && at > 0 && at < ctx.oldest) ctx.oldest = at;
};
/** Runs a quote lookup and reports when the oldest source value it used was fetched (now when nothing older was used). */
export async function withFreshness<T>(fn: () => Promise<T>): Promise<{ value: T; fetchedAt: number }> {
  const ctx = { oldest: Date.now() };
  const value = await freshness.run(ctx, fn);
  return { value, fetchedAt: ctx.oldest };
}
const FAIL_BACKOFF_MS = 2000;
const MAX_KEYS = 5000;

export interface LiveFetcher<V> {
  /** Latest value, fetched now unless one was fetched within `maxAgeMs`. */
  (key: string, maxAgeMs?: number): Promise<V | null>;
  /** When the value served for `key` was fetched from the source (0 when never). */
  fetchedAt(key: string): number;
}

export function liveFetcher<V>(load: (key: string) => Promise<V | null>): LiveFetcher<V> {
  const latest = new Map<string, { v: V; at: number }>();
  const failedAt = new Map<string, number>();
  const inflight = new Map<string, Promise<V | null>>();

  const lastGood = (key: string) => {
    const l = latest.get(key);
    return l && Date.now() - l.at < LAST_GOOD_MAX_MS ? l.v : null;
  };

  // Every value handed out reports when it was fetched (a last good value after a failure is older than the window)
  const report = (key: string, v: V | null) => {
    if (v) noteFetchedAt(latest.get(key)?.at || 0);
    return v;
  };
  const get = ((key: string, maxAgeMs: number = LIVE_FRESH_MS): Promise<V | null> => fetchValue(key, maxAgeMs).then(v => report(key, v))) as LiveFetcher<V>;
  const fetchValue = (key: string, maxAgeMs: number): Promise<V | null> => {
    const now = Date.now();
    const l = latest.get(key);
    if (l && now - l.at < maxAgeMs) return Promise.resolve(l.v);
    const running = inflight.get(key);
    if (running) return running;
    const failed = failedAt.get(key);
    if (failed && now - failed < FAIL_BACKOFF_MS) return Promise.resolve(lastGood(key));

    const p = Promise.resolve()
      .then(() => load(key))
      .catch(() => null)
      .then(v => {
        if (v) {
          latest.delete(key); // re-insert so the map stays ordered oldest first
          latest.set(key, { v, at: Date.now() });
          failedAt.delete(key);
          if (latest.size > MAX_KEYS) latest.delete(latest.keys().next().value as string);
          return v;
        }
        failedAt.set(key, Date.now());
        if (failedAt.size > MAX_KEYS) failedAt.delete(failedAt.keys().next().value as string);
        return lastGood(key);
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };

  get.fetchedAt = (key: string) => latest.get(key)?.at || 0;
  return get;
}
