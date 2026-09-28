// Real-time market data: prices and candles are fetched from the source at the moment they are asked for.
// - A value is reused only within the same second (LIVE_QUOTE_FRESH_MS, default 1000): requests arriving together
//   share one upstream fetch, so a traffic spike can't get the server blocked by the exchanges.
// - If the source fails, the last real price is served for at most LAST_GOOD_MAX_MS (then nothing), and the source
//   is retried after a short back-off instead of being hammered.

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const LIVE_FRESH_MS = clamp(Math.floor(Number(process.env.LIVE_QUOTE_FRESH_MS) || 1000), 250, 5000);
export const LAST_GOOD_MAX_MS = 60_000;
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

  const get = ((key: string, maxAgeMs: number = LIVE_FRESH_MS): Promise<V | null> => {
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
  }) as LiveFetcher<V>;

  get.fetchedAt = (key: string) => latest.get(key)?.at || 0;
  return get;
}
