// ===========================================================================
// Preference Mode (/preference): a trader's own defaults, stored on the account (`users.preferences`).
//
// Defaults only shape the trader's own view and starting values. They never change how the engine finds or scores a
// setup: the analysis is the same for everyone.
// - timeframe / slMode: what the composer starts with (a pick in the composer still wins for that prompt)
// - accountSize, currency, riskPct: money view on every trade card (risk per trade and what each target pays) and
//   the trade calculator's starting values
// - view: DETAILED shows the full write-up under each trade; SIMPLE leads with the levels and folds the write-up
// - homeMarket: which market list the Markets tab opens on
// - rdmTimeframes: which timeframes RDM scans ([] = all), for RDM analyses and RDM watchlist pairs alike
// - tradeStyle: ANY, SCALP, DAY or SWING (src/utils/tradeStyle.ts): which timeframes analyses and the watchlist use,
//   and the 9:00 PM WAT close (day: same day, swing: Friday) recorded as ENDED in alerts, journal, track record, Solana
// - styleTimeframes: per trade type, the timeframes the trader keeps ([] = all of the type's); while that type is on,
//   the choice overrides every other timeframe (composer pick, RDM, watchlist, Strategy Builder)
// - newsAlerts: daily news alerts (server/newsAlerts.ts): on/off and which impacts (high, medium, low)
// - analysisMode: NORMAL, or CONFIRMATION (server/confirmation.ts: a trade only once price confirms at the zone), for
//   analyses and the watchlist alike
// Free for everyone.
// ===========================================================================
import type { Express, NextFunction, Request, Response } from 'express';
import { getUser, requireAuth, userRef, type UserDoc } from './account';
import { createKeyedThrottle } from './security';
import { SUPPORTED_TIMEFRAMES } from '../src/utils/timeframe';

import { normalizeStyleFrames } from '../src/utils/tradeStyle';
import { DEFAULT_PREFERENCES, engineModeOf, normalizeNewsImpacts, normalizeRdmTimeframes, withDefaults, type Currency, type Preferences } from '../src/utils/preferences';
import { effectivePreferences, hasProFeatures, PRO_REQUIRED } from './proAccess';
import { syncWatchPrefs } from './watchlist';
export { DEFAULT_PREFERENCES };
export type { Preferences };

const CURRENCIES: Currency[] = ['USD', 'NGN', 'EUR', 'GBP'];
const VIEWS = ['DETAILED', 'SIMPLE'] as const;
const MARKETS = ['all', 'forex', 'stock', 'crypto', 'commodity'] as const;
/** RDM is allowed as a default; the composer still applies the Pro rule to it */
const TIMEFRAMES = [...SUPPORTED_TIMEFRAMES, 'RDM'];

/** Stored preferences with every missing or old field filled in */
export function readPreferences(doc: UserDoc | undefined): Preferences {
  return withDefaults((doc as any)?.preferences);
}

/** Validates a change (any subset of fields); returns the merged preferences or the first problem */
export function applyPreferenceChange(current: Preferences, body: any): { prefs: Preferences } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Nothing to save.' };
  const next: Preferences = { ...current };
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (has('timeframe')) {
    const tf = typeof body.timeframe === 'string' ? body.timeframe.toUpperCase() : '';
    if (!TIMEFRAMES.includes(tf)) return { error: 'Choose a timeframe from the list.' };
    next.timeframe = tf;
  }
  if (has('slMode')) {
    if (body.slMode !== 'normal' && body.slMode !== 'tight') return { error: 'Stop loss must be Normal or Tight.' };
    next.slMode = body.slMode;
  }
  if (has('accountSize')) {
    if (body.accountSize === null || body.accountSize === '') next.accountSize = null;
    else {
      const n = Number(body.accountSize);
      if (!Number.isFinite(n) || n < 1 || n > 1e10) return { error: 'Account size must be a number above 0.' };
      next.accountSize = Math.round(n * 100) / 100;
    }
  }
  if (has('currency')) {
    if (!CURRENCIES.includes(body.currency)) return { error: 'Choose USD, NGN, EUR or GBP.' };
    next.currency = body.currency;
  }
  if (has('riskPct')) {
    const n = Number(body.riskPct);
    if (!Number.isFinite(n) || n < 0.1 || n > 10) return { error: 'Risk per trade must be between 0.1% and 10%.' };
    next.riskPct = Math.round(n * 100) / 100;
  }
  if (has('view')) {
    if (!(VIEWS as readonly string[]).includes(body.view)) return { error: 'Choose Detailed or Simple.' };
    next.view = body.view;
  }
  if (has('homeMarket')) {
    if (!(MARKETS as readonly string[]).includes(body.homeMarket)) return { error: 'Choose a market list.' };
    next.homeMarket = body.homeMarket;
  }
  if (has('analysisMode')) {
    if (body.analysisMode !== 'NORMAL' && body.analysisMode !== 'CONFIRMATION') return { error: 'Choose Normal or Confirmation analysis.' };
    next.analysisMode = body.analysisMode;
  }
  if (has('steadyMode')) {
    if (typeof body.steadyMode !== 'boolean') return { error: 'Steady mode is on or off.' };
    next.steadyMode = body.steadyMode;
  }
  if (has('secureHalf')) {
    if (typeof body.secureHalf !== 'boolean') return { error: 'Secure half is on or off.' };
    next.secureHalf = body.secureHalf;
  }
  if (has('tradeStyle')) {
    if (!['ANY', 'SCALP', 'DAY', 'SWING'].includes(body.tradeStyle)) return { error: 'Choose a trade type from the list.' };
    next.tradeStyle = body.tradeStyle;
  }
  if (has('styleTimeframes')) {
    // A partial update: only the trade types sent change; each must be some of that type's own timeframes
    const v = body.styleTimeframes;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'Choose timeframes for the trade type from the list.' };
    const merged = { ...current.styleTimeframes };
    for (const k of Object.keys(v)) {
      if (k !== 'SCALP' && k !== 'DAY' && k !== 'SWING') return { error: 'Choose a trade type from the list.' };
      const list = normalizeStyleFrames(k, v[k]);
      if (!list) return { error: 'Choose timeframes of that trade type from the list.' };
      merged[k] = list;
    }
    next.styleTimeframes = merged;
  }
  if (has('newsAlerts')) {
    // A partial update: { enabled } and/or { impacts }
    const v = body.newsAlerts;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'Choose your news alerts.' };
    const merged = { ...current.newsAlerts };
    if ('enabled' in v) {
      if (typeof v.enabled !== 'boolean') return { error: 'News alerts are on or off.' };
      merged.enabled = v.enabled;
    }
    if ('impacts' in v) {
      const list = normalizeNewsImpacts(v.impacts);
      if (!list) return { error: 'Choose at least one impact: high, medium or low.' };
      merged.impacts = list;
    }
    next.newsAlerts = merged;
  }
  if (has('rdmTimeframes')) {
    const list = normalizeRdmTimeframes(body.rdmTimeframes);
    if (!list) return { error: 'Choose RDM timeframes from the list.' };
    next.rdmTimeframes = list;
  }
  return { prefs: next };
}

export function registerPreferenceRoutes(app: Express, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  const throttle = createKeyedThrottle({ windowMs: 60_000, max: 30 });
  const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) =>
    fn(req, res).catch(err => {
      console.error(`[MarketX Preferences] ${req.method} ${req.path} failed:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
    });

  app.get('/api/preferences', limiter, requireAuth, wrap(async (_req, res) => {
    const { uid } = getUser(res);
    const doc = (await userRef(uid).get()).data() as UserDoc | undefined;
    const prefs = readPreferences(doc);
    // Settings of removed features are deleted from storage the first time the trader's preferences are read
    const stored = (doc as any)?.preferences;
    if (stored && typeof stored === 'object' && ('tradeLock' in stored || 'tradeLockChosenAt' in stored)) {
      await userRef(uid).update({ preferences: prefs }).catch(() => {});
    }
    // Preference Mode is Pro after the free period: a free account sees (and gets) the defaults; its own choices are kept
    if (!hasProFeatures(doc)) return res.json({ preferences: effectivePreferences(doc), defaults: DEFAULT_PREFERENCES, locked: true });
    res.json({ preferences: prefs, defaults: DEFAULT_PREFERENCES });
  }));

  app.put('/api/preferences', limiter, requireAuth, wrap(async (req, res) => {
    const { uid } = getUser(res);
    if (throttle.hit(uid)) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many changes. Please wait a minute.' });
    const doc = (await userRef(uid).get()).data() as UserDoc | undefined;
    if (!doc) return res.status(404).json({ error: 'NO_ACCOUNT', message: 'Account not found.' });
    if (!hasProFeatures(doc)) return res.status(402).json({ error: PRO_REQUIRED.error, message: 'Preference Mode is a Pro feature. Upgrade to Pro to change your preferences.' });
    const reset = req.body?.reset === true;
    const out = reset ? { prefs: { ...DEFAULT_PREFERENCES } } : applyPreferenceChange(readPreferences(doc), req.body);
    if ('error' in out) return res.status(400).json({ error: 'BAD_REQUEST', message: out.error });
    const prefs = { ...out.prefs, updatedAt: Date.now() };
    await userRef(uid).update({ preferences: prefs });
    // The watchlist scans the way an analysis does: same RDM timeframes, analysis mode and trade type
    const old = readPreferences(doc);
    const styleTfs = (p: Preferences) => (p.tradeStyle === 'ANY' ? '' : p.styleTimeframes[p.tradeStyle].join(','));
    if (old.rdmTimeframes.join(',') !== prefs.rdmTimeframes.join(',') || engineModeOf(old) !== engineModeOf(prefs) || old.tradeStyle !== prefs.tradeStyle || styleTfs(old) !== styleTfs(prefs))
      await syncWatchPrefs(uid, { rdmFrames: prefs.rdmTimeframes, mode: engineModeOf(prefs), style: prefs.tradeStyle, styleFrames: prefs.tradeStyle === 'ANY' ? [] : prefs.styleTimeframes[prefs.tradeStyle] }).catch(err => console.warn('[MarketX Preferences] watchlist sync failed:', err?.message || err));
    res.json({ preferences: prefs });
  }));
}
