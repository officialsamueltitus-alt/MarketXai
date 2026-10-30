import { AsyncLocalStorage } from 'async_hooks';
import type { Express, NextFunction, Request, Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { Models } from '@google/genai';
import { db, isFirebaseConfigured } from './firebase';
import { adminLog, requireAdmin } from './admin';
import { dayKey } from './tracking';
import { CREDIT_PACKS } from './payments';
import { classifyPrompt } from '../src/utils/promptIntent';

// ===========================================================================
// SI engine cost meter (owner-requested, Admin → SI costs): the real cost of every engine call, from the token counts
// the engine itself returns (`usageMetadata`) and the web searches it ran (`groundingMetadata.webSearchQueries`).
//
//   How: one read-only hook on the SDK's request method (`installAiUsageMeter`), so every caller is counted without
//   touching any engine's instructions, prompts, model list or client (the analysis engine included). The hook never
//   changes a request or a response and never throws. Each call is tagged with what it was for (analysis, question,
//   fundamental read, Matt, voice, Strategy Builder, background) from the request it ran in (AsyncLocalStorage).
//
//   Prices: per model, $ per 1M input / output tokens plus $ per 1,000 web searches. Defaults below (third-party
//   figures, Oct 2026); the owner corrects them in Admin from the Google billing page (`adminConfig/aiPrices`).
//   Cost is worked out at the prices in force when the call ran.
//
//   Storage: `aiUsageDaily/{YYYY-MM-DD}` {kinds.{kind}.{calls, actions, in, out, searches, cost}, models.{key}.{…}},
//   buffered in memory and added with increments every 30s per worker. Server only, never shown to traders.
// ===========================================================================

export type AiKind = 'analysis' | 'question' | 'fundamental' | 'matt' | 'mattVoice' | 'voice' | 'strategy' | 'other' | 'background';
export const AI_KINDS: AiKind[] = ['analysis', 'question', 'fundamental', 'matt', 'mattVoice', 'voice', 'strategy', 'other', 'background'];

export interface ModelPrice {
  in: number;
  out: number;
}
export interface AiPrices {
  models: Record<string, ModelPrice>;
  /** $ per 1,000 web searches (grounding) */
  searchPer1k: number;
  /** Searches free each month before billing starts */
  freeSearchesPerMonth: number;
  updatedAt?: number;
}

/** Defaults (per 1M tokens, USD): unverified third-party figures, to be checked against the Google billing page */
export const DEFAULT_AI_PRICES: AiPrices = {
  models: {
    'gemini-3.8-flash': { in: 0.75, out: 3.75 },
    'gemini-3.1-flash-lite': { in: 0.25, out: 1.5 },
    'gemini-flash-latest': { in: 0.75, out: 3.75 },
    'gemini-2.5-flash-preview-tts': { in: 0.5, out: 10 },
    'gemini-2.5-pro-preview-tts': { in: 1, out: 20 },
  },
  searchPer1k: 14,
  freeSearchesPerMonth: 5000,
};
/** Any model not in the table is costed at this (on the safe side) */
const FALLBACK_PRICE: ModelPrice = { in: 1.5, out: 9 };

const PRICES_DOC = () => db().collection('adminConfig').doc('aiPrices');
const PRICE_TTL_MS = 5 * 60_000;
let prices: AiPrices = DEFAULT_AI_PRICES;
let pricesAt = 0;
async function loadPrices(force = false): Promise<AiPrices> {
  if (!isFirebaseConfigured()) return prices;
  if (!force && Date.now() - pricesAt < PRICE_TTL_MS) return prices;
  pricesAt = Date.now();
  try {
    const d = (await PRICES_DOC().get()).data() as Partial<AiPrices> | undefined;
    prices = normalizePrices(d);
  } catch {}
  return prices;
}

const money = (v: unknown, max: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10000) / 10000 : null;
};
const MODEL_NAME = /^[a-z0-9][a-z0-9.\-]{1,60}$/;

/** Stored or typed prices, cleaned; anything missing falls back to the defaults */
export function normalizePrices(raw: Partial<AiPrices> | undefined | null): AiPrices {
  const models: Record<string, ModelPrice> = { ...DEFAULT_AI_PRICES.models };
  const src = raw && typeof raw.models === 'object' && raw.models ? raw.models : {};
  for (const [name, p] of Object.entries(src).slice(0, 30)) {
    const key = String(name).toLowerCase();
    if (!MODEL_NAME.test(key)) continue;
    const i = money((p as any)?.in, 1000);
    const o = money((p as any)?.out, 1000);
    if (i !== null && o !== null) models[key] = { in: i, out: o };
  }
  return {
    models,
    searchPer1k: money(raw?.searchPer1k, 1000) ?? DEFAULT_AI_PRICES.searchPer1k,
    freeSearchesPerMonth: Math.floor(money(raw?.freeSearchesPerMonth, 10_000_000) ?? DEFAULT_AI_PRICES.freeSearchesPerMonth),
    ...(raw?.updatedAt ? { updatedAt: Number(raw.updatedAt) || undefined } : {}),
  };
}

export const priceOf = (model: string, p: AiPrices = prices): ModelPrice => p.models[model] || FALLBACK_PRICE;

/** One call's cost in USD (searches costed at the paid rate; the monthly free allowance is shown separately) */
export function callCost(model: string, u: { in: number; out: number; searches: number }, p: AiPrices = prices): number {
  const m = priceOf(model, p);
  return (u.in * m.in + u.out * m.out) / 1e6 + (u.searches * p.searchPer1k) / 1000;
}

/** Token counts and searches from an engine response; null when it carries no usage */
export function usageFrom(resp: any): { in: number; out: number; searches: number } | null {
  const um = resp?.usageMetadata;
  if (!um || typeof um !== 'object') return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const searches = Array.isArray(resp?.candidates)
    ? resp.candidates.reduce((a: number, c: any) => a + (Array.isArray(c?.groundingMetadata?.webSearchQueries) ? c.groundingMetadata.webSearchQueries.length : 0), 0)
    : 0;
  return {
    in: n(um.promptTokenCount) + n(um.toolUsePromptTokenCount),
    // Thinking is billed as output
    out: n(um.candidatesTokenCount) + n(um.thoughtsTokenCount),
    searches,
  };
}

// ---------------------------------------------------------------------------
// What each call was for
// ---------------------------------------------------------------------------
interface Ctx {
  req: Request;
  calls: number;
  kind?: AiKind;
}
const als = new AsyncLocalStorage<Ctx>();

export function kindOf(req: Request | undefined): AiKind {
  if (!req) return 'background';
  const p = req.path || '';
  if (p === '/api/market/chat') return 'question';
  if (p === '/api/market/analyze') {
    const b = req.body || {};
    const prompt = typeof b.prompt === 'string' ? b.prompt : typeof b.message === 'string' ? b.message : '';
    try {
      return classifyPrompt(prompt, { hasChartImage: !!(b.chartImage || b.image) }) === 'question' ? 'question' : 'analysis';
    } catch {
      return 'analysis';
    }
  }
  if (p.startsWith('/api/fundamental')) return 'fundamental';
  if (p === '/api/matt/talk' || p === '/api/matt/speak') return 'mattVoice';
  if (p.startsWith('/api/matt')) return 'matt';
  if (p.startsWith('/api/voice')) return 'voice';
  if (p.startsWith('/api/strateg')) return 'strategy';
  return 'other';
}

/** Express middleware (after the body parsers): tags every engine call made while serving this request */
export function aiUsageContext(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api/') || req.path.startsWith('/api/admin')) return next();
  const ctx: Ctx = { req, calls: 0 };
  res.on('finish', () => {
    // One "action" = one request that used the engine (an analysis that fell back to a second model is still one)
    if (ctx.calls > 0 && res.statusCode < 400) bump(ctx.kind || kindOf(req), null, { actions: 1 });
  });
  als.run(ctx, () => next());
}

// ---------------------------------------------------------------------------
// Buffer + flush
// ---------------------------------------------------------------------------
type Row = { calls: number; actions: number; in: number; out: number; searches: number; cost: number };
const empty = (): Row => ({ calls: 0, actions: 0, in: 0, out: 0, searches: 0, cost: 0 });
const modelKey = (m: string) => m.replace(/[^a-z0-9-]/gi, '_').slice(0, 60) || 'unknown';
let buffer: { day: string; kinds: Record<string, Row>; models: Record<string, Row & { name: string }> } | null = null;

function bump(kind: AiKind, model: string | null, add: Partial<Row>) {
  const day = dayKey();
  if (!buffer || buffer.day !== day) {
    if (buffer) void flush(buffer);
    buffer = { day, kinds: {}, models: {} };
  }
  const k = (buffer.kinds[kind] ||= empty());
  for (const [f, v] of Object.entries(add)) (k as any)[f] += v || 0;
  if (model) {
    const key = modelKey(model);
    const m = (buffer.models[key] ||= { ...empty(), name: model });
    for (const [f, v] of Object.entries(add)) if (f !== 'actions') (m as any)[f] += v || 0;
  }
}

async function flush(b = buffer) {
  if (!b || !isFirebaseConfigured()) return;
  if (b === buffer) buffer = null;
  const inc = (r: Partial<Row>) =>
    Object.fromEntries(Object.entries(r).filter(([f, v]) => f !== 'name' && typeof v === 'number' && v).map(([f, v]) => [f, FieldValue.increment(v as number)]));
  const kinds = Object.fromEntries(Object.entries(b.kinds).map(([k, r]) => [k, inc(r)]));
  const models = Object.fromEntries(Object.entries(b.models).map(([k, r]) => [k, { name: r.name, ...inc(r) }]));
  if (!Object.keys(kinds).length && !Object.keys(models).length) return;
  try {
    await db().collection('aiUsageDaily').doc(b.day).set({ day: b.day, kinds, models, updatedAt: Date.now() }, { merge: true });
  } catch (err: any) {
    console.warn('[MarketX SI cost] flush failed:', err?.message || err);
  }
}

/** Records one finished engine call (exported for tests) */
export function recordAiCall(model: string, resp: any, kind?: AiKind) {
  const u = usageFrom(resp);
  if (!u) return;
  const name = String(model || 'unknown').replace(/^models\//, '').toLowerCase().slice(0, 60);
  const ctx = als.getStore();
  if (ctx) ctx.calls += 1;
  const k = kind || ctx?.kind || (ctx ? (ctx.kind = kindOf(ctx.req)) : 'background');
  bump(k, name, { calls: 1, in: u.in, out: u.out, searches: u.searches, cost: callCost(name, u) });
}

let installed = false;
/** Hooks the SDK's request method once (read only): every engine call everywhere is metered */
export function installAiUsageMeter() {
  if (installed) return;
  installed = true;
  const proto = (Models as any)?.prototype;
  const original = proto?.generateContentInternal;
  if (typeof original !== 'function') {
    console.warn('[MarketX SI cost] engine SDK changed: usage is not metered');
    return;
  }
  proto.generateContentInternal = async function (this: unknown, params: any) {
    const resp = await original.call(this, params);
    try {
      recordAiCall(String(params?.model || ''), resp);
    } catch {}
    return resp;
  };
  void loadPrices(true);
  setInterval(() => {
    void flush();
    void loadPrices();
  }, 30_000).unref();
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
const lastDays = (n: number) => Array.from({ length: n }, (_, i) => dayKey(Date.now() - (n - 1 - i) * 86400e3));

export function registerAiUsageAdminRoutes(app: Express) {
  const wrap =
    (fn: (req: Request, res: Response) => Promise<any>) =>
    (req: Request, res: Response) =>
      fn(req, res).catch(err => {
        console.error(`[MarketX Admin] ${req.method} ${req.path} failed:`, err?.message || err);
        if (!res.headersSent) res.status(500).json({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' });
      });

  app.get('/api/admin/si-costs', requireAdmin, wrap(async (_req, res) => {
    await flush();
    const p = await loadPrices(true);
    const days = lastDays(30);
    const snaps = await db().getAll(...days.map(d => db().collection('aiUsageDaily').doc(d)));
    const docs = snaps.map((s, i) => ({ day: days[i], ...(s.exists ? (s.data() as any) : {}) }));
    const kinds: Record<string, Row> = {};
    const models: Record<string, Row & { name: string }> = {};
    const add = (to: Row, r: any) => {
      for (const f of ['calls', 'actions', 'in', 'out', 'searches', 'cost'] as const) to[f] += Number(r?.[f]) || 0;
    };
    const series = docs.map(d => {
      let cost = 0;
      for (const [k, r] of Object.entries(d.kinds || {})) {
        add((kinds[k] ||= empty()), r);
        cost += Number((r as any)?.cost) || 0;
      }
      for (const [k, r] of Object.entries(d.models || {})) add((models[k] ||= { ...empty(), name: String((r as any)?.name || k) }), r);
      return { day: d.day, cost: Math.round(cost * 10000) / 10000 };
    });
    const month = dayKey().slice(0, 7);
    const monthSearches = docs.filter(d => d.day.startsWith(month)).reduce((a, d) => a + Object.values(d.kinds || {}).reduce((x: number, r: any) => x + (Number(r?.searches) || 0), 0), 0);
    const total = Object.values(kinds).reduce((a, r) => a + r.cost, 0);
    // What one credit brings in (cheapest pack), to compare with the cost of one action
    const perCredit = Object.values(CREDIT_PACKS).map(x => x.usd / x.credits);
    res.json({
      totals: {
        cost30: total,
        today: series[series.length - 1]?.cost || 0,
        week: series.slice(-7).reduce((a, d) => a + d.cost, 0),
        calls30: Object.values(kinds).reduce((a, r) => a + r.calls, 0),
        monthSearches,
        freeSearchesLeft: Math.max(0, p.freeSearchesPerMonth - monthSearches),
        // The free searches this month, at the paid rate (the cost above counts every search)
        freeSearchCredit: (Math.min(monthSearches, p.freeSearchesPerMonth) * p.searchPer1k) / 1000,
      },
      kinds: AI_KINDS.filter(k => kinds[k]).map(k => ({ kind: k, ...kinds[k], perAction: kinds[k].actions ? kinds[k].cost / kinds[k].actions : null })),
      models: Object.values(models).sort((a, b) => b.cost - a.cost),
      series,
      prices: p,
      creditPrice: { low: Math.min(...perCredit), high: Math.max(...perCredit) },
    });
  }));

  app.put('/api/admin/si-costs/prices', requireAdmin, wrap(async (req, res) => {
    const raw = req.body?.prices;
    if (!raw || typeof raw !== 'object') return res.status(400).json({ error: 'BAD_PRICES', message: 'Send the prices to save.' });
    const clean = normalizePrices(raw);
    await PRICES_DOC().set({ ...clean, updatedAt: Date.now() });
    await loadPrices(true);
    adminLog('si_prices', { models: Object.keys(clean.models).length });
    res.json({ prices: prices });
  }));
}

export const __aiUsageInternals = { flush, bump, als, buffer: () => buffer };
