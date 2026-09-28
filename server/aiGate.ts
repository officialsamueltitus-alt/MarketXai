// Traffic helpers for expensive upstream work (the AI engine, market feeds).
// - A concurrency gate queues calls beyond a limit instead of flooding the provider; a call that cannot
//   start within its wait budget is refused (the caller then serves the computed analysis instead).
// - A small TTL cache with in-flight sharing: identical requests arriving together share one upstream call,
//   and repeats within the TTL are answered from memory.
// - withTimeout: a race that always clears its timer (no lingering timers under load).

export class BusyError extends Error {
  constructor(message = 'Engine busy') {
    super(message);
    this.name = 'BusyError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface Gate {
  run<T>(fn: () => Promise<T>, maxWaitMs: number): Promise<T>;
  stats(): { active: number; queued: number; max: number; served: number; refused: number };
}

export function createGate(max: number, maxQueue = 5000): Gate {
  let active = 0;
  let served = 0;
  let refused = 0;
  const queue: Array<{ start: () => void; timer: ReturnType<typeof setTimeout> }> = [];

  const next = () => {
    while (active < max && queue.length) {
      const job = queue.shift()!;
      clearTimeout(job.timer);
      job.start();
    }
  };

  return {
    run<T>(fn: () => Promise<T>, maxWaitMs: number): Promise<T> {
      const exec = () => {
        active++;
        served++;
        return Promise.resolve()
          .then(fn)
          .finally(() => {
            active--;
            next();
          });
      };
      if (active < max) return exec();
      if (queue.length >= maxQueue) {
        refused++;
        return Promise.reject(new BusyError('Engine queue is full'));
      }
      return new Promise<T>((resolve, reject) => {
        const job = {
          start: () => exec().then(resolve, reject),
          timer: setTimeout(() => {
            const i = queue.indexOf(job);
            if (i >= 0) queue.splice(i, 1);
            refused++;
            reject(new BusyError('Engine is busy, waited too long'));
          }, maxWaitMs),
        };
        queue.push(job);
      });
    },
    stats: () => ({ active, queued: queue.length, max, served, refused }),
  };
}

export class SharedCache<V> {
  private store = new Map<string, { value: V; exp: number }>();
  private inflight = new Map<string, Promise<V>>();
  constructor(private ttlMs: number, private maxEntries = 1000) {}

  get(key: string): V | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (e.exp <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: V) {
    if (this.store.size >= this.maxEntries) {
      // Drop expired entries first, then the oldest
      const now = Date.now();
      for (const [k, e] of this.store) if (e.exp <= now) this.store.delete(k);
      while (this.store.size >= this.maxEntries) this.store.delete(this.store.keys().next().value as string);
    }
    this.store.set(key, { value, exp: Date.now() + this.ttlMs });
  }

  /** Cached value, or one shared call for everyone asking at the same moment. `keep` decides what is cached. */
  async getOrCreate(key: string, create: () => Promise<V>, keep: (v: V) => boolean = () => true): Promise<V> {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = create()
      .then(v => {
        if (keep(v)) this.set(key, v);
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  get size() {
    return this.store.size;
  }
}
