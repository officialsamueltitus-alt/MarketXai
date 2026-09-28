// Outgoing email under heavy traffic: a single queue in front of SMTP so a traffic spike never floods (and gets
// suspended) the sending account.
// - high priority (security alerts, pass codes, password resets, receipts) always goes first and is never dropped
// - bulk (admin broadcasts) is never dropped or deduplicated, but waits behind high priority mail
// - low priority (activity: "your analysis is ready", answers) is paced, deduplicated per recipient
//   (at most one per LOW_PER_RECIPIENT_MS) and dropped when the backlog is large instead of piling up for hours

export type MailPriority = 'high' | 'bulk' | 'low';

export interface MailQueueOptions {
  perMinute: number; // sends per minute across the whole server
  concurrency: number;
  lowBacklogMax: number; // low-priority jobs beyond this are dropped
  lowPerRecipientMs: number;
}

interface Job {
  run: () => Promise<boolean>;
  resolve: (ok: boolean) => void;
}

export function createMailQueue(opts: MailQueueOptions) {
  const high: Job[] = [];
  const bulk: Job[] = [];
  const low: Job[] = [];
  const lastLowTo = new Map<string, number>();
  const sentAt: number[] = [];
  let active = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stats = { sent: 0, dropped: 0, deduped: 0 };

  const pump = () => {
    timer = null;
    const now = Date.now();
    while (sentAt.length && now - sentAt[0] > 60_000) sentAt.shift();
    while (active < opts.concurrency && (high.length || bulk.length || low.length)) {
      if (sentAt.length >= opts.perMinute) {
        timer = setTimeout(pump, Math.max(50, 60_000 - (now - sentAt[0]) + 5));
        return;
      }
      const job = (high.length ? high : bulk.length ? bulk : low).shift()!;
      active++;
      sentAt.push(Date.now());
      job
        .run()
        .catch(() => false)
        .then(ok => {
          if (ok) stats.sent++;
          job.resolve(ok);
        })
        .finally(() => {
          active--;
          if (!timer) pump();
        });
    }
  };

  return {
    enqueue(to: string, priority: MailPriority, run: () => Promise<boolean>): Promise<boolean> {
      const key = String(to || '').toLowerCase();
      if (priority === 'low') {
        const last = lastLowTo.get(key) || 0;
        if (Date.now() - last < opts.lowPerRecipientMs) {
          stats.deduped++;
          return Promise.resolve(false);
        }
        if (low.length >= opts.lowBacklogMax) {
          stats.dropped++;
          return Promise.resolve(false);
        }
        lastLowTo.set(key, Date.now());
        if (lastLowTo.size > 50_000) lastLowTo.delete(lastLowTo.keys().next().value as string);
      }
      return new Promise<boolean>(resolve => {
        (priority === 'high' ? high : priority === 'bulk' ? bulk : low).push({ run, resolve });
        if (!timer) pump();
      });
    },
    stats: () => ({ ...stats, queuedHigh: high.length, queuedBulk: bulk.length, queuedLow: low.length, active }),
  };
}
