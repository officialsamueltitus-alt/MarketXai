// Production entry point. By default runs one process (unchanged behaviour). Set WEB_CONCURRENCY to the number of
// CPU cores on the instance to run that many workers sharing the port; a crashed worker is replaced automatically.
import cluster from 'cluster';
import os from 'os';

// This entry point only ever runs the built site, so it is always production: secure cookies, the content security
// policy and fixed site links never depend on a hosting setting being present
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
const wanted = Math.floor(Number(process.env.WEB_CONCURRENCY) || 1);
const workers = Math.max(1, Math.min(wanted, cores, 16));

if (workers > 1 && cluster.isPrimary) {
  console.log(`[MarketX] Starting ${workers} workers`);
  const spawn = (id: number) => {
    const w = cluster.fork({ MX_WORKERS: String(workers), MX_WORKER_ID: String(id) });
    w.on('exit', (code, signal) => {
      console.warn(`[MarketX] Worker ${id} exited (${signal || code}); restarting`);
      setTimeout(() => spawn(id), 1000);
    });
  };
  for (let i = 1; i <= workers; i++) spawn(i);
} else {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./server.cjs');
}
