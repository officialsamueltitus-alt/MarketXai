import type { Express, NextFunction, Request, Response } from 'express';
import { getUser, notifyActivity, requireAuth, siteLink, userRef, type UserDoc } from './account';
import { db, isFirebaseConfigured } from './firebase';
import { IS_LEAD_WORKER } from './workers';
import { hasFeature, proGateActive, PRO_REQUIRED } from './proAccess';
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

/** Price alerts and the track record are free; the watchlist and the trade journal are Pro after the free period */
export const PRO_PLUGINS: readonly PluginId[] = ['watchlist', 'journal'];

export function pluginStates(doc: UserDoc | undefined): Record<PluginId, boolean> {
  return {
    alerts: !!doc?.alerts?.enabled,
    watchlist: hasFeature(doc, 'watchlist') && !!doc?.watchlist?.enabled,
    journal: hasFeature(doc, 'journal') && !!doc?.plugins?.journal,
    trackRecord: !!doc?.plugins?.trackRecord,
  };
}

export async function setPlugin(uid: string, id: PluginId, enabled: boolean) {
  if (id === 'alerts') return setAlertsEnabled(uid, enabled);
  if (id === 'watchlist') return setWatchlistEnabled(uid, enabled);
  await userRef(uid).update({ [`plugins.${id}`]: enabled });
}

/**
 * Once the free period has ended: switches off what a free account still has running among the Pro tools (the
 * watchlist, Fundamental Analysis, the daily news alerts and the Strategy Builder; also catches a Pro plan that ran
 * out). Price alerts are free and keep running. Runs on the lead worker every 15 minutes; each account is told once.
 * Saved data (pairs, journal trades, strategies, preferences) is kept for when they upgrade.
 */
export async function sweepFreeAccounts(): Promise<number> {
  if (!proGateActive()) return 0;
  const users = db().collection('users');
  const snaps = await Promise.all([
    users.where('watchlist.enabled', '==', true).get(),
    users.where('fundamentalMode.enabled', '==', true).get(),
    users.where('preferences.newsAlerts.enabled', '==', true).get(),
    users.where('strategyMode.enabled', '==', true).get(),
  ]);
  const docs = new Map<string, UserDoc>();
  for (const s of snaps) for (const d of s.docs) docs.set(d.id, d.data() as UserDoc);
  let n = 0;
  for (const [uid, doc] of docs) {
    const d = doc as any;
    // Per feature: Pro keeps all of them, a feature code's pass keeps just its own one (until it runs out)
    const watchOff = doc.watchlist?.enabled && !hasFeature(doc, 'watchlist');
    const off: Record<string, unknown> = {};
    if (d.fundamentalMode?.enabled && !hasFeature(doc, 'fundamental')) off.fundamentalMode = { enabled: false, at: Date.now() };
    if (d.preferences?.newsAlerts?.enabled && !hasFeature(doc, 'fundamental')) off['preferences.newsAlerts.enabled'] = false;
    if (d.strategyMode?.enabled && !hasFeature(doc, 'strategy')) off['strategyMode.enabled'] = false;
    if (!watchOff && !Object.keys(off).length) continue;
    try {
      if (watchOff) await setWatchlistEnabled(uid, false);
      if (Object.keys(off).length) await userRef(uid).update(off);
      n++;
      await notifyActivity(
        uid,
        { type: 'credit', title: 'Some tools are now Pro', message: 'Your watchlist, Fundamental Analysis, news alerts and Strategy Builder were paused. Your saved data is kept. Price alerts and your track record stay free.', actionType: 'open_pricing' } as any,
        {
          subject: 'Some MarketX tools are now part of Pro',
          lines: [
            'The free period has ended, so the Pro tools you had on (watchlist, Fundamental Analysis, news alerts, Strategy Builder) were paused.',
            'Your saved pairs, journal trades, strategies and settings are kept. Price alerts and your track record stay free. Upgrade to Pro to switch the rest back on.',
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

  app.post('/api/plugins/:id', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const id = String(req.params.id || '') as PluginId;
    if (!PLUGIN_IDS.includes(id)) return res.status(404).json({ error: 'NOT_FOUND', message: 'That tool does not exist.' });
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'BAD_REQUEST', message: 'Say whether to turn it on or off.' });
    // Turning a Pro tool on needs Pro after the free period; turning anything off always works
    if (req.body.enabled && PRO_PLUGINS.includes(id) && !hasFeature((await userRef(uid).get()).data() as UserDoc | undefined, id as 'watchlist' | 'journal')) {
      return res.status(402).json(PRO_REQUIRED);
    }
    if (throttle.hit(uid)) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many changes. Please wait a minute.' });
    await setPlugin(uid, id, req.body.enabled);
    res.json({ plugins: pluginStates((await userRef(uid).get()).data() as UserDoc | undefined) });
  }));
}
