import type { Express, NextFunction, Request, Response } from 'express';
import { getUser, requireAuth, userRef, type UserDoc } from './account';
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

export function registerPluginRoutes(app: Express, limiter: (req: Request, res: Response, next: NextFunction) => void) {
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

  app.post('/api/plugins/:id', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const id = String(req.params.id || '') as PluginId;
    if (!PLUGIN_IDS.includes(id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'That command does not exist.' });
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'BAD_REQUEST', message: 'Say whether to turn it on or off.' });
    if (throttle.hit(uid)) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many changes. Please wait a minute.' });
    await setPlugin(uid, id, req.body.enabled);
    res.json({ plugins: pluginStates((await userRef(uid).get()).data() as UserDoc | undefined) });
  }));
}
