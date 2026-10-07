// ===========================================================================
// Strategy Builder (/strategy): traders write their strategy (their own words and/or the guided questions, or a
// strategy from the library to tweak), the strategy engine (API 2) turns it into rules, the trader reviews and saves
// them, and Strategy mode runs them in every analysis and on the watchlist instead of the general MarketX engine.
// Everything else stays the same: credits, the result card, price alerts, journal, track record, Solana proofs.
// Pro only once the free period ends (turning off and deleting always work).
//   userStrategies/{id}  {uid, name, freeText, guided, rules, summary, notSupported, templateId, createdAt, updatedAt}
//   users.strategyMode   {enabled, strategyId, at}
// ===========================================================================
import crypto from 'crypto';
import type { Express, NextFunction, Request, Response } from 'express';
import { db, isFirebaseConfigured } from './firebase';
import { getUser, requireAuth, userRef, type UserDoc } from './account';
import { hasProFeatures, requirePro, requireProToEnable } from './proAccess';
import { createKeyedThrottle } from './security';
import { giftNoteProblem } from './trust';
import { compileStrategy, strategyEngineReady, StrategyEngineUnavailable } from './strategyAi';
import { syncWatchStrategy } from './watchlist';
import {
  describeRules,
  MAX_FREE_TEXT,
  MAX_STRATEGIES,
  normalizeRules,
  shortSummary,
  STRATEGY_TEMPLATES,
  type StrategyRules,
} from '../src/utils/strategyRules';

const COL = 'userStrategies';
export interface SavedStrategy {
  id: string;
  uid: string;
  name: string;
  freeText: string;
  guided: StrategyRules;
  rules: StrategyRules;
  summary: string;
  notSupported: string[];
  templateId: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface ActiveStrategy {
  id: string;
  name: string;
  rules: StrategyRules;
}

const clean = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const cleanBlock = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u2028-\u202E\u2066-\u2069]/g, '')
    .trim()
    .slice(0, max);

const toClient = (s: SavedStrategy) => ({
  id: s.id,
  name: s.name,
  freeText: s.freeText,
  guided: s.guided,
  rules: s.rules,
  summary: s.summary,
  notSupported: s.notSupported,
  templateId: s.templateId,
  plain: describeRules(s.rules),
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

async function listOwn(uid: string): Promise<SavedStrategy[]> {
  const snap = await db().collection(COL).where('uid', '==', uid).get();
  return snap.docs.map(d => d.data() as SavedStrategy).sort((a, b) => a.createdAt - b.createdAt);
}
async function ownStrategy(uid: string, id: string): Promise<SavedStrategy | null> {
  if (!/^st_[a-f0-9]{16}$/.test(id)) return null;
  const s = (await db().collection(COL).doc(id).get()).data() as SavedStrategy | undefined;
  return s && s.uid === uid ? s : null;
}

// Rules by id, shared by the analysis and the watchlist scanner (short cache)
const ruleCache = new Map<string, { at: number; s: ActiveStrategy | null }>();
export async function strategyById(id: string): Promise<ActiveStrategy | null> {
  const hit = ruleCache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.s;
  const d = (await db().collection(COL).doc(id).get()).data() as SavedStrategy | undefined;
  const s = d ? { id: d.id, name: d.name, rules: normalizeRules(d.rules)! } : null;
  ruleCache.set(id, { at: Date.now(), s });
  if (ruleCache.size > 2000) ruleCache.clear();
  return s;
}

/**
 * The trader's Strategy mode: the strategy their analyses run on, or null (general engine). `locked` = Strategy mode is
 * on but the account is no longer Pro after the free period (the analysis is refused before any credit is used).
 */
export async function strategyModeFor(uid: string, doc?: UserDoc): Promise<{ strategy: ActiveStrategy | null; locked: boolean }> {
  const u = doc || ((await userRef(uid).get()).data() as UserDoc | undefined);
  const mode = (u as any)?.strategyMode;
  if (!mode?.enabled || typeof mode.strategyId !== 'string') return { strategy: null, locked: false };
  if (!hasProFeatures(u)) return { strategy: null, locked: true };
  const s = await strategyById(mode.strategyId);
  if (!s || (await db().collection(COL).doc(mode.strategyId).get()).data()?.uid !== uid) return { strategy: null, locked: false };
  return { strategy: s, locked: false };
}

async function setMode(uid: string, enabled: boolean, strategyId: string | null) {
  await userRef(uid).update({ strategyMode: { enabled, strategyId, at: Date.now() } });
  // The watchlist scans with the same engine as the analyses
  await syncWatchStrategy(uid, enabled ? strategyId : null).catch(err => console.warn('[MarketX Strategy Builder] watchlist sync failed:', err?.message || err));
}

export function registerStrategyBuilderRoutes(app: Express, limiter: (req: Request, res: Response, next: NextFunction) => void) {
  const wrap = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) =>
    fn(req, res).catch(err => {
      console.error(`[MarketX Strategy Builder] ${req.method} ${req.path} failed:`, err?.message || err);
      if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
    });
  const ready = (_req: Request, res: Response, next: NextFunction) =>
    isFirebaseConfigured() ? next() : res.status(503).json({ error: 'UNAVAILABLE', message: 'The Strategy Builder is unavailable right now.' });
  const compileThrottle = createKeyedThrottle({ windowMs: 60 * 60_000, max: 20 });
  const writeThrottle = createKeyedThrottle({ windowMs: 60_000, max: 20 });

  const state = async (uid: string) => {
    const [doc, list] = await Promise.all([userRef(uid).get().then(s => s.data() as UserDoc | undefined), listOwn(uid)]);
    const mode = (doc as any)?.strategyMode || {};
    const activeId = mode.enabled && list.some(s => s.id === mode.strategyId) ? mode.strategyId : null;
    return {
      enabled: !!activeId && hasProFeatures(doc),
      activeId,
      strategies: list.map(toClient),
      templates: STRATEGY_TEMPLATES.map(t => ({ ...t, plain: describeRules(t.rules) })),
      engineReady: strategyEngineReady(),
      max: MAX_STRATEGIES,
    };
  };

  app.get('/api/strategies', limiter, requireAuth, ready, wrap(async (_req, res) => res.json(await state(getUser(res).uid))));

  // Words + guided answers -> rules for the trader to review (not saved yet). Guided-only drafts need no engine call.
  app.post('/api/strategies/compile', limiter, requireAuth, ready, requirePro, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const guided = normalizeRules(req.body?.guided);
    if (!guided) return res.status(400).json({ error: 'BAD_RULES', message: 'Answer the guided questions first (pick a setup).' });
    const freeText = cleanBlock(req.body?.freeText, MAX_FREE_TEXT);
    if (freeText && compileThrottle.hit(uid)) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many strategy builds this hour. Try again later.' });
    try {
      const out = await compileStrategy(freeText, guided);
      res.json({ draft: { ...out, plain: describeRules(out.rules) } });
    } catch (err: any) {
      if (err instanceof StrategyEngineUnavailable) {
        return res.status(503).json({
          error: 'STRATEGY_ENGINE_UNAVAILABLE',
          message: `${err.message} Your guided answers still work: clear the free text to save them as they are, or try again shortly.`,
        });
      }
      throw err;
    }
  }));

  const readBody = (body: any): { error: string } | { name: string; freeText: string; guided: StrategyRules; rules: StrategyRules; summary: string; notSupported: string[]; templateId: string | null } => {
    const name = clean(body?.name, 48);
    if (name.length < 2) return { error: 'Give your strategy a name (2 to 48 characters).' };
    if (giftNoteProblem(name)) return { error: 'That name is not allowed. Use a plain strategy name, without links or contacts.' };
    const rules = normalizeRules(body?.rules);
    const guided = normalizeRules(body?.guided) || rules;
    if (!rules || !guided) return { error: 'Build and review the rules first.' };
    const templateId = typeof body?.templateId === 'string' && STRATEGY_TEMPLATES.some(t => t.id === body.templateId) ? body.templateId : null;
    return {
      name,
      freeText: cleanBlock(body?.freeText, MAX_FREE_TEXT),
      guided,
      rules,
      summary: clean(body?.summary, 300) || shortSummary(rules),
      notSupported: Array.isArray(body?.notSupported) ? body.notSupported.map((x: any) => clean(x, 140)).filter(Boolean).slice(0, 6) : [],
      templateId,
    };
  };

  // Save (approve) a strategy; `use: true` also switches Strategy mode on with it
  app.post('/api/strategies', limiter, requireAuth, ready, requirePro, wrap(async (req, res) => {
    const { uid } = getUser(res);
    if (writeThrottle.hit(uid)) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many changes. Please wait a minute.' });
    const b = readBody(req.body);
    if ('error' in b) return res.status(400).json({ error: 'BAD_REQUEST', message: b.error });
    const mine = await listOwn(uid);
    if (mine.length >= MAX_STRATEGIES) return res.status(429).json({ error: 'STRATEGY_LIMIT', message: `You can keep up to ${MAX_STRATEGIES} strategies. Delete one first.` });
    const t = Date.now();
    const s: SavedStrategy = { id: `st_${crypto.randomBytes(8).toString('hex')}`, uid, ...b, createdAt: t, updatedAt: t };
    await db().collection(COL).doc(s.id).set(s);
    if (req.body?.use === true) await setMode(uid, true, s.id);
    res.json({ saved: toClient(s), ...(await state(uid)) });
  }));

  app.put('/api/strategies/:id', limiter, requireAuth, ready, requirePro, wrap(async (req, res) => {
    const { uid } = getUser(res);
    if (writeThrottle.hit(uid)) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many changes. Please wait a minute.' });
    const cur = await ownStrategy(uid, String(req.params.id || ''));
    if (!cur) return res.status(404).json({ error: 'NOT_FOUND', message: 'That strategy was not found.' });
    const b = readBody(req.body);
    if ('error' in b) return res.status(400).json({ error: 'BAD_REQUEST', message: b.error });
    const s: SavedStrategy = { ...cur, ...b, updatedAt: Date.now() };
    await db().collection(COL).doc(s.id).set(s);
    ruleCache.delete(s.id);
    // Pairs scanning with this strategy pick up the new rules
    const mode = ((await userRef(uid).get()).data() as any)?.strategyMode;
    if (mode?.enabled && mode.strategyId === s.id) await syncWatchStrategy(uid, s.id).catch(() => {});
    res.json({ saved: toClient(s), ...(await state(uid)) });
  }));

  // Deleting always works (also for free accounts); deleting the active strategy switches Strategy mode off
  app.delete('/api/strategies/:id', limiter, requireAuth, ready, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const cur = await ownStrategy(uid, String(req.params.id || ''));
    if (!cur) return res.status(404).json({ error: 'NOT_FOUND', message: 'That strategy was not found.' });
    await db().collection(COL).doc(cur.id).delete();
    ruleCache.delete(cur.id);
    const mode = ((await userRef(uid).get()).data() as any)?.strategyMode;
    if (mode?.strategyId === cur.id) await setMode(uid, false, null);
    res.json(await state(uid));
  }));

  // Strategy mode on (with one of the trader's strategies) or off. Turning it on is Pro only after the free period.
  app.post('/api/strategies/mode', limiter, requireAuth, ready, requireProToEnable, wrap(async (req, res) => {
    const { uid } = getUser(res);
    const enabled = req.body?.enabled === true;
    if (!enabled) {
      await setMode(uid, false, null);
      return res.json(await state(uid));
    }
    const s = await ownStrategy(uid, String(req.body?.strategyId || ''));
    if (!s) return res.status(404).json({ error: 'NOT_FOUND', message: 'Choose one of your saved strategies.' });
    await setMode(uid, true, s.id);
    res.json(await state(uid));
  }));
}
