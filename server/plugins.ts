import type { Express, NextFunction, Request, Response } from 'express';
import { getUser, notifyActivity, requireAuth, siteLink, userRef, type UserDoc } from './account';
import { db, isFirebaseConfigured } from './firebase';
import { IS_LEAD_WORKER } from './workers';
import { hasProFeatures, proGateActive, requireProToEnable } from './proAccess';
import { createKeyedThrottle } from './security';
import { setAlertsEnabled } from './priceAlerts';
import { setWatchlistEnabled } from './watchlist';

// ===========================================================================
// Connectors / Plugins: the commands a trader has switched on, listed in Settings, where each can be opened or
// switched off. Turning a command off here does exactly what turning it off inside the command does:
//   alerts      -> price alerts stop (active alerts end, results stay in the track record)
//   watchlist   -> every pair is paused (the list is kept)
//   journal     -> hidden from Connectors (the trades are kept)
//   trackRecord -> hidden from Connectors (the record keeps building from price alerts)
// ===========================================================================

export const PLUGIN_IDS = ['alerts', 'watchlist', 'journal', 'trackRecord'] as const;
export type PluginId = (typeof PLUGIN_IDS)[number];

export function pluginStates(doc: UserDoc | undefined): Record<PluginId, boolean> {
  // After the free period, a free account has no commands running (its data is kept for when it upgrades)
  if (!hasProFeatures(doc)) return { alerts: false, watchlist: false, journal: false, trackRecord: false };
  return {
    alerts: !!doc?.alerts?.enabled,
    watchlist: !!doc?.watchlist?.enabled,
    journal: !!doc?.plugins?.journal,
    trackRecord: !!doc?.plugins?.trackRecord,
  };
}

export async function setPlugin(uid: string, id: PluginId, enabled: boolean) {
  if (id === 'alerts') return setAlertsEnabled(uid, enabled);
  if (id === 'watchlist') return setWatchlistEnabled(uid, enabled);
  await userRef(uid).update({ [`plugins.${id}`]: enabled });
}

/**
 * Once the free period has ended: switches off price alerts and the watchlist for every account that isn't Pro (also
 * catches a Pro plan that ran out). Runs on the lead worker every 15 minutes; each account is told once.
 */
export async function sweepFreeAccounts(): Promise<number> {
  if (!proGateActive()) return 0;
  const users = db().collection('users');
  const [alerts, watch] = await Promise.all([users.where('alerts.enabled', '==', true).get(), users.where('watchlist.enabled', '==', true).get()]);
  const docs = new Map<string, UserDoc>();
  for (const d of [...alerts.docs, ...watch.docs]) docs.set(d.id, d.data() as UserDoc);
  let n = 0;
  for (const [uid, doc] of docs) {
    if (hasProFeatures(doc)) continue;
    try {
      if (doc.alerts?.enabled) await setAlertsEnabled(uid, false);
      if (doc.watchlist?.enabled) await setWatchlistEnabled(uid, false);
      n++;
      await notifyActivity(
        uid,
        { type: 'credit', title: 'Your tools are now Pro', message: 'Price alerts and your watchlist were paused. Your pairs, trades and results are saved. Upgrade to Pro to turn them back on.', actionType: 'open_pricing' } as any,
        {
          subject: 'Your MarketX tools are now part of Pro',
          lines: [
            'The free period for MarketX tools has ended, so your price alerts and watchlist were paused.',
            'Your pairs, journal trades and track record are saved. Upgrade to Pro and switch them back on any time.',
          ],
          options: { cta: { label: 'See Pro plans', url: siteLink('/?pricing=1') } },
        }
      );
    } catch (err: any) {
      console.warn('[MarketX Plugins] free account sweep failed for one account:', err?.message || err);
    }
  }
  return n;
}

export function registerPluginRoutes(app: Express, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  if (isFirebaseConfigured() && IS_LEAD_WORKER) {
    const run = () => sweepFreeAccounts().then(n => n && console.log(`[MarketX Plugins] paused commands for ${n} free account(s)`)).catch(err => console.warn('[MarketX Plugins] free account sweep failed:', err?.message || err));
    setTimeout(run, 30_000).unref();
    setInterval(run, Math.max(5000, Number(process.env.PRO_SWEEP_MS) || 15 * 60_000)).unref();
  }
  const throttle = createKeyedThrottle({ windowMs: 60_000, max: 30 });
  const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) =>
    fn(req, res).catch(err => {
      console.error(`[MarketX Plugins] ${req.method} ${req.path} failed:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
    });

  app.get('/api/plugins', limiter, requireAuth, wrap(async (_req, res) => {
    const { uid } = getUser(res);
    res.json({ plugins: pluginStates((await userRef(uid).get()).data() as UserDoc | undefined) });
  }));

  app.post('/api/plugins/:id', limiter, requireAuth, requireProToEnable, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const id = String(req.params.id || '') as PluginId;
    if (!PLUGIN_IDS.includes(id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'That tool does not exist.' });
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'BAD_REQUEST', message: 'Say whether to turn it on or off.' });
    if (throttle.hit(uid)) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many changes. Please wait a minute.' });
    await setPlugin(uid, id, req.body.enabled);
    res.json({ plugins: pluginStates((await userRef(uid).get()).data() as UserDoc | undefined) });
  }));
}
