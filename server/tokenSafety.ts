// ===========================================================================
// Token safety check for Solana tokens (free: public Solana RPC + RugCheck's free API).
//
// Read straight from the chain (authoritative):
//   - mint authority (can more be printed?) and freeze authority (can wallets be frozen?)
//   - Token-2022 rules: transfer fees, permanent delegate, transfer hooks, non-transferable, frozen-by-default
//   - top holders: the largest token accounts, with pools, vaults and other program-held accounts set apart from people
// From RugCheck (when it answers): liquidity locked or burned, a rugged flag, mutable metadata, extra danger flags.
// From the pool MarketX already reads (DexScreener): liquidity and pool age.
//
// Nothing here changes an analysis: the result is attached next to it. Never "safe", only Low risk / Caution / High risk.
// Results are cached 10 minutes per token, concurrent checks share one lookup, and calls are budgeted per worker.
// ===========================================================================
import type { Express, NextFunction, Request, Response } from 'express';
import { isSolanaAddress, solanaRpc } from './solana';
import { createKeyedThrottle, clientIp } from './security';
import { lookupDexToken } from './cryptoUniverse';
import { requireAuth } from './account';
import { safetySubject, solanaAddressIn } from '../src/utils/promptIntent';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';
export interface SafetyCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}
export interface TokenSafety {
  mint: string;
  chain: 'solana';
  symbol?: string;
  verdict: 'LOW_RISK' | 'CAUTION' | 'HIGH_RISK' | 'UNKNOWN';
  /** 0 (worst) to 100 */
  score: number;
  headline: string;
  checks: SafetyCheck[];
  checkedAt: number;
  sources: string[];
}
export interface SafetyContext {
  symbol?: string;
  liquidityUsd?: number;
  pairCreatedAt?: number;
  pairAddress?: string;
}

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PG8nMBPGFkqTeyG';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const CACHE_MS = 10 * 60_000;
const RPC_PER_MIN = Math.max(10, Number(process.env.SAFETY_RPC_PER_MIN) || 60);
const RUGCHECK_PER_MIN = Math.max(5, Number(process.env.RUGCHECK_PER_MIN) || 30);

// Per-worker call budgets (a burst of traffic never hammers the free endpoints)
const budget = { rpc: { n: 0, at: 0 }, rug: { n: 0, at: 0 } };
function spend(kind: 'rpc' | 'rug', count = 1): boolean {
  const b = budget[kind];
  const now = Date.now();
  if (now - b.at > 60_000) {
    b.n = 0;
    b.at = now;
  }
  if (b.n + count > (kind === 'rpc' ? RPC_PER_MIN : RUGCHECK_PER_MIN)) return false;
  b.n += count;
  return true;
}

const pctText = (n: number) => `${n < 1 ? n.toFixed(2) : n.toFixed(1)}%`;
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

interface MintFacts {
  program: string;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  supply: number;
  decimals: number;
  extensions: Array<{ extension: string; state?: any }>;
}

async function readMint(mint: string): Promise<MintFacts | null> {
  if (!spend('rpc')) return null;
  const r = await solanaRpc<any>('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const v = r?.value;
  const info = v?.data?.parsed?.info;
  if (!v || v.data?.parsed?.type !== 'mint' || !info) return null;
  return {
    program: String(v.owner || ''),
    mintAuthority: info.mintAuthority || null,
    freezeAuthority: info.freezeAuthority || null,
    supply: Number(info.supply) / 10 ** Number(info.decimals || 0),
    decimals: Number(info.decimals || 0),
    extensions: Array.isArray(info.extensions) ? info.extensions : [],
  };
}

interface HolderFacts {
  /** Share of supply held by the 10 largest people (not pools or programs) */
  top10People: number;
  largestPerson: number;
  /** Share held by pools, vaults and other program-controlled accounts among the largest 20 */
  programHeld: number;
}

async function readHolders(mint: string, supply: number, pairAddress?: string): Promise<HolderFacts | null> {
  if (!(supply > 0) || !spend('rpc', 3)) return null;
  const largest = await solanaRpc<any>('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
  const accounts: Array<{ address: string; uiAmount: number }> = (largest?.value || []).slice(0, 20).filter((a: any) => Number(a?.uiAmount) > 0);
  if (!accounts.length) return { top10People: 0, largestPerson: 0, programHeld: 0 };
  // Who owns each token account
  const tokenAccts = await solanaRpc<any>('getMultipleAccounts', [accounts.map(a => a.address), { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const owners: Array<string | null> = (tokenAccts?.value || []).map((x: any) => x?.data?.parsed?.info?.owner || null);
  // An owner that is a normal wallet is a System-owned account; pools, vaults, curves and lockers are program-controlled
  const uniq = [...new Set(owners.filter(Boolean) as string[])];
  const ownerAccts = uniq.length ? await solanaRpc<any>('getMultipleAccounts', [uniq, { encoding: 'base64', commitment: 'confirmed', dataSlice: { offset: 0, length: 0 } }]) : { value: [] };
  const isPerson = new Map<string, boolean>();
  uniq.forEach((o, i) => {
    const acc = ownerAccts?.value?.[i];
    isPerson.set(o, !!acc && acc.owner === SYSTEM_PROGRAM && o !== pairAddress);
  });
  const people: number[] = [];
  let programHeld = 0;
  accounts.forEach((a, i) => {
    const pct = (Number(a.uiAmount) / supply) * 100;
    const owner = owners[i];
    if (owner && isPerson.get(owner)) people.push(pct);
    else programHeld += pct;
  });
  people.sort((x, y) => y - x);
  return {
    top10People: people.slice(0, 10).reduce((s, x) => s + x, 0),
    largestPerson: people[0] || 0,
    programHeld,
  };
}

interface RugFacts {
  lpLockedPct: number | null;
  rugged: boolean;
  mutableMetadata: boolean | null;
  dangers: Array<{ name: string; description: string; level: string }>;
}

async function readRugCheck(mint: string): Promise<RugFacts | null> {
  if (!spend('rug')) return null;
  const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
  if (!res.ok) return null;
  const d: any = await res.json();
  if (!d || typeof d !== 'object') return null;
  const markets: any[] = Array.isArray(d.markets) ? d.markets : [];
  const locks = markets.map(m => Number(m?.lp?.lpLockedPct)).filter(n => Number.isFinite(n));
  const risks: any[] = Array.isArray(d.risks) ? d.risks : [];
  return {
    lpLockedPct: locks.length ? Math.max(...locks) : null,
    rugged: d.rugged === true,
    mutableMetadata: typeof d?.tokenMeta?.mutable === 'boolean' ? d.tokenMeta.mutable : null,
    dangers: risks
      .filter(r => r && typeof r.name === 'string')
      .map(r => ({ name: String(r.name).slice(0, 80), description: String(r.description || '').slice(0, 200), level: String(r.level || '') })),
  };
}

/** Builds the checks and verdict from whatever could be read (pure: used by tests too) */
export function assess(mint: string, ctx: SafetyContext, m: MintFacts | null, h: HolderFacts | null, rug: RugFacts | null): TokenSafety {
  const checks: SafetyCheck[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) => checks.push({ id, label, status, detail });

  if (m) {
    add('mint', 'Supply is fixed', m.mintAuthority ? 'fail' : 'pass', m.mintAuthority ? 'The creator can still mint new tokens and dilute every holder.' : 'Minting is switched off. No one can print more.');
    add('freeze', 'Wallets can’t be frozen', m.freezeAuthority ? 'fail' : 'pass', m.freezeAuthority ? 'The creator can freeze wallets, so you might not be able to sell.' : 'No one can freeze your tokens.');
    const ext = new Map(m.extensions.map(e => [String(e?.extension || ''), e?.state]));
    const issues: Array<[CheckStatus, string]> = [];
    if (ext.has('permanentDelegate')) issues.push(['fail', 'A permanent delegate can move tokens out of any wallet.']);
    if (ext.has('nonTransferable')) issues.push(['fail', 'The token can’t be transferred, so it can’t be sold.']);
    if (ext.get('defaultAccountState')?.accountState === 'frozen') issues.push(['fail', 'New wallets start frozen.']);
    const fee = Number(ext.get('transferFeeConfig')?.newerTransferFee?.transferFeeBasisPoints ?? ext.get('transferFeeConfig')?.olderTransferFee?.transferFeeBasisPoints ?? 0);
    if (fee > 0) issues.push([fee >= 1000 ? 'fail' : 'warn', `Every transfer pays a ${(fee / 100).toFixed(2)}% fee.`]);
    if (ext.has('transferHook')) issues.push(['warn', 'Custom code runs on every transfer and could block sells.']);
    const worst: CheckStatus = issues.some(i => i[0] === 'fail') ? 'fail' : issues.length ? 'warn' : 'pass';
    add('rules', 'Standard transfer rules', worst, issues.length ? issues.map(i => i[1]).join(' ') : m.program === TOKEN_2022 ? 'Token-2022 with no risky extensions.' : 'A standard token with no special transfer rules.');
  } else {
    add('mint', 'Supply is fixed', 'unknown', 'Couldn’t read the token from the chain right now.');
    add('freeze', 'Wallets can’t be frozen', 'unknown', 'Couldn’t read the token from the chain right now.');
  }

  if (h) {
    const t = h.top10People;
    add('holders', 'Holders spread out', t > 45 ? 'fail' : t > 25 ? 'warn' : 'pass', `The 10 largest holders own ${pctText(t)} of the supply${h.largestPerson ? `, the biggest ${pctText(h.largestPerson)}` : ''}. Pools and other program accounts (${pctText(h.programHeld)}) are not counted.`);
  } else add('holders', 'Holders spread out', 'unknown', 'Couldn’t read the largest holders right now.');

  const liq = Number(ctx.liquidityUsd);
  if (liq > 0) add('liquidity', 'Enough liquidity', liq >= 100_000 ? 'pass' : liq >= 20_000 ? 'warn' : 'fail', liq >= 100_000 ? `${usd(liq)} in the main pool.` : `Only ${usd(liq)} in the main pool. Bigger orders will move the price a lot.`);

  if (rug?.lpLockedPct != null) {
    const p = rug.lpLockedPct;
    add('lp', 'Liquidity locked or burned', p >= 90 ? 'pass' : p >= 50 ? 'warn' : 'fail', p >= 90 ? `${pctText(p)} of the pool’s liquidity is locked or burned.` : `Only ${pctText(p)} of the liquidity is locked. The rest can be pulled out.`);
  } else add('lp', 'Liquidity locked or burned', 'unknown', 'Lock status not available for this pool.');

  if (ctx.pairCreatedAt && ctx.pairCreatedAt > 0) {
    const hours = (Date.now() - ctx.pairCreatedAt) / 3_600_000;
    const ageText = hours < 48 ? `${Math.max(1, Math.round(hours))} hours` : `${Math.round(hours / 24)} days`;
    add('age', 'Not brand new', hours >= 24 * 7 ? 'pass' : 'warn', hours >= 24 * 7 ? `The pool has been trading for ${ageText}.` : `The pool is only ${ageText} old. New tokens are the most likely to rug.`);
  }

  if (rug) {
    if (rug.rugged) add('rugged', 'Not flagged as rugged', 'fail', 'This token has been flagged as rugged.');
    if (rug.mutableMetadata) add('meta', 'Name and logo locked', 'warn', 'The creator can still change the name and logo.');
    // Flags already covered by the checks above (by topic), so nothing shows twice
    const covered = /authority|liquidity|\blp\b|holder|mutable|metadata|transfer fee|permanent delegate/i;
    rug.dangers
      .filter(r => r.level === 'danger' && !covered.test(r.name))
      .slice(0, 3)
      .forEach((r, i) => add(`flag${i}`, r.name, 'fail', r.description || 'Flagged as a danger.'));
  }

  const fails = checks.filter(c => c.status === 'fail');
  const warns = checks.filter(c => c.status === 'warn');
  const known = checks.filter(c => c.status !== 'unknown').length;
  const score = Math.max(0, Math.min(100, Math.round(100 - fails.length * 25 - warns.length * 8 - checks.filter(c => c.status === 'unknown').length * 3)));
  const verdict: TokenSafety['verdict'] = !m && known < 2 ? 'UNKNOWN' : fails.length ? 'HIGH_RISK' : warns.length ? 'CAUTION' : 'LOW_RISK';
  const headline =
    verdict === 'UNKNOWN'
      ? 'Couldn’t check this token right now. Trade with extra care.'
      : verdict === 'HIGH_RISK'
        ? `High risk: ${fails[0].detail.charAt(0).toLowerCase()}${fails[0].detail.slice(1)}`
        : verdict === 'CAUTION'
          ? `Caution: ${warns.length} thing${warns.length === 1 ? '' : 's'} to watch before you trade.`
          : 'Low risk on every on-chain check. Still size your trade with care.';
  return {
    mint,
    chain: 'solana',
    ...(ctx.symbol ? { symbol: ctx.symbol } : {}),
    verdict,
    score,
    headline,
    checks,
    checkedAt: Date.now(),
    sources: ['Solana', ...(rug ? ['RugCheck'] : []), ...(liq > 0 ? ['DexScreener'] : [])],
  };
}

const cache = new Map<string, { at: number; p: Promise<TokenSafety | null> }>();

/** Safety of a Solana token (cached 10 minutes; concurrent requests share one lookup). Null when the input is not a mint. */
export function checkSolanaToken(mint: string, ctx: SafetyContext = {}): Promise<TokenSafety | null> {
  if (!isSolanaAddress(mint)) return Promise.resolve(null);
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  const p = (async () => {
    const m = await readMint(mint).catch(() => null);
    const [h, rug] = await Promise.all([
      m ? readHolders(mint, m.supply, ctx.pairAddress).catch(() => null) : Promise.resolve(null),
      readRugCheck(mint).catch(() => null),
    ]);
    if (!m && !rug) {
      // Nothing could be read: don't keep the failure for long
      setTimeout(() => cache.get(mint)?.p === p && cache.delete(mint), 30_000).unref?.();
    }
    return assess(mint, ctx, m, h, rug);
  })();
  cache.set(mint, { at: Date.now(), p });
  if (cache.size > 2000) for (const [k, v] of cache) if (Date.now() - v.at > CACHE_MS) cache.delete(k);
  return p;
}

/** The asset an analysis or answer is about, when it is a Solana on-chain token */
export function solanaTokenOf(asset: any): { mint: string; ctx: SafetyContext } | null {
  const d = asset?.dex;
  if (!d || String(d.chainId).toLowerCase() !== 'solana' || !isSolanaAddress(d.address)) return null;
  return { mint: d.address, ctx: { symbol: d.symbol, liquidityUsd: d.liquidityUsd, pairCreatedAt: d.pairCreatedAt, pairAddress: d.pairAddress } };
}

/** Starts the check while the analysis runs (no added time); the middleware attaches it to the result */
export function startTokenSafety(res: Response, asset: any) {
  const t = solanaTokenOf(asset);
  if (t) res.locals.tokenSafety = checkSolanaToken(t.mint, t.ctx).catch(() => null);
}

/** Attaches the started check to the response (waits at most 2.5s more; never alters the analysis) */
export function tokenSafetyMiddleware(_req: Request, res: Response, next: NextFunction) {
  const json = res.json.bind(res);
  res.json = ((body: any) => {
    const pending: Promise<TokenSafety | null> | undefined = res.locals.tokenSafety;
    if (!pending || res.statusCode >= 400 || !body || typeof body !== 'object') return json(body);
    Promise.race([pending, new Promise<null>(r => setTimeout(() => r(null), 2500))])
      .then(safety => {
        if (safety) {
          body.tokenSafety = safety;
          if (body.strategy && typeof body.strategy === 'object') body.strategy.tokenSafety = safety;
        }
      })
      .catch(() => {})
      .finally(() => json(body));
    return res;
  }) as typeof res.json;
  next();
}

// ---------------------------------------------------------------------------
// Direct check from chat ("is $WIF safe?", "rug check <address>", "/safety BONK"): free, no credit
// ---------------------------------------------------------------------------
export interface SafetyAnswer {
  status: number;
  message: string;
  tokenSafety?: TokenSafety;
  token?: { symbol: string; name: string; address: string; priceUsd?: number; liquidityUsd?: number };
  /** Ticker (or address) to offer "Analyze" / "Info" for */
  label?: string;
}
/**
 * Finds the Solana token a safety request is about and runs the check: a mint address in the prompt, an on-chain token
 * MarketX resolved, or a coin listed on an exchange whose most liquid pool is on Solana (WIF, BONK, JUP...).
 */
export async function safetyAnswer(prompt: string, resolve: (q: string) => Promise<any>): Promise<SafetyAnswer> {
  const addr = solanaAddressIn(prompt);
  const subject = addr || safetySubject(prompt);
  if (!subject) return { status: 400, message: 'Which token should I check? Send its $ticker or Solana contract address, e.g. **is $WIF safe?**' };
  let mint: string | null = null;
  let ctx: SafetyContext = {};
  let name = '';
  let priceUsd: number | undefined;
  if (addr) {
    if (!isSolanaAddress(addr)) return { status: 400, message: 'That is not a valid Solana token address.' };
    mint = addr;
    const dex = await lookupDexToken(addr).catch(() => null);
    if (dex && dex.chainId === 'solana') {
      ctx = { symbol: dex.symbol, liquidityUsd: dex.liquidityUsd, pairCreatedAt: dex.pairCreatedAt, pairAddress: dex.pairAddress };
      name = dex.name;
      priceUsd = dex.priceUsd;
    }
  } else {
    const asset = await Promise.race([resolve(subject).catch(() => null), new Promise<any>(r => setTimeout(() => r(null), 6000))]);
    const direct = solanaTokenOf(asset);
    if (direct) {
      mint = direct.mint;
      ctx = direct.ctx;
      name = asset?.dex?.name || '';
      priceUsd = asset?.dex?.priceUsd;
    } else if (asset && asset.type === 'crypto' && !asset.unresolved) {
      const base = String(asset.symbol || '').split('/')[0].toUpperCase();
      if (base === 'SOL') return { status: 200, message: '**SOL** is Solana’s own coin, not a token: nobody can mint more at will, freeze wallets or pull its liquidity. The token safety check is for tokens that live on Solana, like $WIF or $BONK.', label: 'SOL' };
      const dex = await lookupDexToken(base).catch(() => null);
      if (dex && dex.chainId === 'solana') {
        mint = dex.address;
        ctx = { symbol: dex.symbol, liquidityUsd: dex.liquidityUsd, pairCreatedAt: dex.pairCreatedAt, pairAddress: dex.pairAddress };
        name = dex.name;
        priceUsd = dex.priceUsd;
      } else if (dex) {
        return { status: 422, message: `**${base}** trades mainly on ${dex.chainId.charAt(0).toUpperCase() + dex.chainId.slice(1)}, not Solana. The token safety check covers Solana tokens for now.`, label: base };
      } else if (/^(BTC|ETH|XRP|BNB|ADA|DOGE|LTC|TRX|DOT|AVAX|LINK|TON|XLM|BCH)$/.test(base)) {
        return { status: 422, message: `**${base}** is a major coin on its own blockchain, not a Solana token. The token safety check covers Solana tokens, like $WIF or $BONK.`, label: base };
      }
    } else if (asset && asset.type && asset.type !== 'crypto') {
      return { status: 422, message: 'The token safety check is for Solana tokens. Send a $ticker or a Solana contract address, e.g. **is $BONK safe?**' };
    }
  }
  if (!mint) return { status: 404, message: `I couldn’t find a Solana token for **${subject.slice(0, 48)}**. Try its contract address, which you can copy from the project’s page or a DEX.` };
  const safety = await checkSolanaToken(mint, ctx);
  // A malformed address from a listing reads as nothing at all: say so instead of failing
  if (!safety) return { status: 404, message: `I couldn’t read a Solana token for **${subject.slice(0, 48)}** right now. Try its contract address, which you can copy from the project’s page or a DEX.` };
  const sym = safety.symbol || ctx.symbol || 'this token';
  // One line above the card: the card itself carries the verdict, every check and the disclaimer
  const lines = [`**Safety check: $${sym.replace(/^\$/, '')}** on Solana, read straight from the chain. Tap “See all checks” for the details.`];
  return {
    status: 200,
    message: lines.join('\n\n'),
    tokenSafety: safety,
    token: { symbol: sym, name: name || sym, address: mint, priceUsd, liquidityUsd: ctx.liquidityUsd },
    label: ctx.symbol || sym,
  };
}

export function registerTokenSafetyRoutes(
  app: Express,
  deps: { resolve: (mint: string) => Promise<any> },
  limiter: (req: Request, res: Response, next: NextFunction) => void
) {
  const perIp = createKeyedThrottle({ windowMs: 60_000, max: 12 });
  // Check any Solana token by its mint address (public: the data is public on-chain)
  app.get('/api/token-safety/:mint', limiter, async (req: Request, res: Response) => {
    const mint = String(req.params.mint || '');
    if (!isSolanaAddress(mint)) return res.status(400).json({ error: 'BAD_REQUEST', message: 'Enter a Solana token address.' });
    if (perIp.hit(clientIp(req))) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many checks. Please wait a minute.' });
    try {
      const asset = await Promise.race([deps.resolve(mint).catch(() => null), new Promise(r => setTimeout(() => r(null), 5000))]);
      const ctx = solanaTokenOf(asset)?.ctx || {};
      const safety = await checkSolanaToken(mint, ctx);
      res.json({ tokenSafety: safety });
    } catch {
      res.status(503).json({ error: 'UNAVAILABLE', message: 'The safety check is unavailable right now. Try again shortly.' });
    }
  });

  // From chat: "is $WIF safe?", "rug check <address>", "/safety BONK". Free (no credit), 15 a minute per trader.
  const perUser = createKeyedThrottle({ windowMs: 60_000, max: 15 });
  app.post('/api/token-safety/check', limiter, requireAuth, async (req: Request, res: Response) => {
    const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim().slice(0, 200) : '';
    if (!prompt) return res.status(400).json({ error: 'BAD_REQUEST', message: 'Which token should I check?' });
    if (perUser.hit((res.locals.user as any)?.uid || clientIp(req))) return res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Too many checks. Please wait a minute.' });
    try {
      const a = await safetyAnswer(prompt, deps.resolve);
      res.json({ ok: a.status === 200, message: a.message, tokenSafety: a.tokenSafety || null, token: a.token || null, label: a.label || null });
    } catch {
      res.status(503).json({ error: 'UNAVAILABLE', message: 'The safety check is unavailable right now. Try again shortly.' });
    }
  });
}

export const __safetyInternals = { cache, budget };
