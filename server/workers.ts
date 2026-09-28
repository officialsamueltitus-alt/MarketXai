// Multi-core mode (optional): server/cluster.ts can run several worker processes (WEB_CONCURRENCY). Each worker keeps
// its own in-memory counters, so every limit that protects the site (login/admin lockouts, rate limits, AI
// concurrency, mail pacing) is divided across workers: together they enforce exactly the configured limit.
export const WORKERS = Math.max(1, Math.floor(Number(process.env.MX_WORKERS) || 1));
/** The first worker (or the only process) runs once-per-server background jobs. */
export const IS_LEAD_WORKER = (process.env.MX_WORKER_ID || '1') === '1';
/** This worker's share of a server-wide limit (never below 1). */
export const perWorker = (n: number) => Math.max(1, Math.ceil(n / WORKERS));
/** Share for security throttles, never below `floor` so a real user always gets a few attempts per connection. */
export const perWorkerAtLeast = (n: number, floor = 3) => Math.max(Math.min(n, floor), perWorker(n));
