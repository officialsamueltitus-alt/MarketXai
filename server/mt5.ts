import crypto from 'crypto';

// ===========================================================================
// MT5 execution for the trading agent, through MetaApi's REST API (cloud MetaTrader access; MarketX runs no terminal).
//
//   Setup (owner): a MetaApi account, an API token in METAAPI_TOKEN (server only, never sent to the browser or logged),
//   optional METAAPI_REGION (default new-york). Without a token the agent stays in tracked mode and the panel says so.
//
//   Linking (trader): MT5 login, MASTER (trading) password and broker server are passed straight to MetaApi to add the
//   account; MarketX never stores, logs or returns the password. MarketX keeps only MetaApi's account id, the region,
//   a masked login, the server name and the broker symbols it matched. Unlinking deletes the account at MetaApi.
//   Cost: MetaApi bills per connected hour, so a linked account is connected (deployed) only while the agent runs or
//   still manages an order/position on it, and disconnected (undeployed) otherwise (`setMt5Power`).
//
//   Hosts: provisioning  https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai
//          trading       https://mt-client-api-v1.<region>.agiliumtrade.ai
// ===========================================================================

const PROVISIONING = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const token = () => String(process.env.METAAPI_TOKEN || '').trim();
const defaultRegion = () => {
  const r = String(process.env.METAAPI_REGION || 'new-york').trim().toLowerCase();
  return /^[a-z][a-z-]{1,24}$/.test(r) ? r : 'new-york';
};
const clientHost = (region: string) => `https://mt-client-api-v1.${/^[a-z][a-z-]{1,24}$/.test(region) ? region : defaultRegion()}.agiliumtrade.ai`;
/** MetaApi account ids are hex/uuid-like: checked before going into a URL */
const safeId = (id: string) => /^[A-Za-z0-9-]{8,64}$/.test(id);
/** Our orders on the trader's account carry this magic number */
const MAGIC = 20261023;

export const mt5Configured = () => !!token();

export class Mt5Error extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** One MetaApi call: JSON in/out, 15s cap, 202 "still working" retried with the same transaction id (account creation) */
async function call(url: string, init: { method?: string; body?: unknown; txId?: string; timeoutMs?: number; tries?: number } = {}): Promise<any> {
  if (!token()) throw new Mt5Error('MT5_NOT_CONFIGURED', 'MT5 execution is not set up on MarketX yet.');
  const tries = init.tries ?? 1;
  for (let i = 0; i < tries; i++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method || 'GET',
        headers: {
          'auth-token': token(),
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(init.txId ? { 'transaction-id': init.txId } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(init.timeoutMs || 15_000),
      });
    } catch (err: any) {
      if (i < tries - 1) continue;
      throw new Mt5Error('MT5_UNREACHABLE', 'The MT5 connection did not answer. Please try again.');
    }
    if (res.status === 202 && i < tries - 1) {
      const wait = Math.min(15, Math.max(1, Number(res.headers.get('retry-after')) || 3));
      await new Promise(r => setTimeout(r, wait * 1000));
      continue;
    }
    const text = await res.text().catch(() => '');
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {}
    if (res.status === 202) throw new Mt5Error('MT5_PENDING', 'Your MT5 account is still being connected. Try again in a minute.');
    if (!res.ok) {
      // MetaApi's own message (validation, wrong login, unknown server); never echo anything we sent
      // (MetaApi's request ids in brackets are dropped: they mean nothing to a trader)
      const msg = friendlyMt5Message(String(data?.message || '').replace(/[\r\n]+/g, ' ').replace(/\s*\([0-9a-f]{16,}\)/gi, '').trim()).slice(0, 200);
      const code = res.status === 401 || res.status === 403 ? 'MT5_AUTH' : res.status === 404 ? 'MT5_NOT_FOUND' : res.status === 429 ? 'MT5_BUSY' : 'MT5_ERROR';
      throw new Mt5Error(code, msg || `MT5 request failed (${res.status}).`);
    }
    return data;
  }
  throw new Mt5Error('MT5_PENDING', 'Your MT5 account is still being connected. Try again in a minute.');
}

/** MetaApi's wording for the usual linking mistakes, in a trader's words */
export function friendlyMt5Message(m: string): string {
  if (/server.*(not found|unknown|invalid)|no such server|E_SRV_NOT_FOUND/i.test(m)) return "MT5 doesn't know that server. Pick it from the list or type it exactly as MT5 shows it (File, Login to Trade Account).";
  if (/E_AUTH|invalid account|authori[sz]ation failed|wrong password|invalid password/i.test(m)) return 'MT5 could not sign in. Check the login, the master (trading) password and the server.';
  if (/already exists|duplicate/i.test(m)) return 'This MT5 account is already linked. Disconnect it first, or try again in a minute.';
  return m;
}

export interface Mt5Link {
  accountId: string;
  region: string;
}

/** Adds the trader's MT5 account at MetaApi (the password goes straight through, nothing is kept) */
export async function createMt5Account(input: { login: string; password: string; server: string; name: string }): Promise<Mt5Link> {
  const region = defaultRegion();
  const data = await call(`${PROVISIONING}/users/current/accounts`, {
    method: 'POST',
    txId: crypto.randomBytes(16).toString('hex'),
    tries: 8,
    timeoutMs: 30_000,
    body: {
      name: input.name.slice(0, 60),
      type: 'cloud-g2',
      login: input.login,
      password: input.password,
      server: input.server,
      platform: 'mt5',
      magic: MAGIC,
      region,
      reliability: 'regular',
      // No `manualTrades`: MetaApi refuses it together with a magic number ("magic value must be 0"), and the magic
      // number is what tags the agent's own orders on the trader's account
    },
  });
  const id = String(data?.id || '');
  if (!safeId(id)) throw new Mt5Error('MT5_ERROR', 'MT5 did not return an account. Check the login, password and server.');
  return { accountId: id, region };
}

/**
 * MT5 server names from MetaApi's directory of known broker servers (e.g. "exness" -> Exness-MT5Real8, …), for the
 * link form's suggestions. Read only; nothing about the trader is sent. Empty on any error.
 */
export async function mt5KnownServers(query: string): Promise<string[]> {
  const q = query.replace(/[^A-Za-z0-9 ._()-]/g, '').trim().slice(0, 40);
  if (q.length < 2 || !token()) return [];
  try {
    const d = await call(`${PROVISIONING}/known-mt-servers/5/search?query=${encodeURIComponent(q)}`, { timeoutMs: 6000 });
    // { "Broker name": ["Server-1", "Server-2"], … } (or a plain list)
    const names: unknown[] = Array.isArray(d) ? d : d && typeof d === 'object' ? Object.values(d).flat() : [];
    return [...new Set(names.map(n => String(n || '').trim()).filter(n => /^[A-Za-z0-9][A-Za-z0-9 ._()\-]{2,79}$/.test(n)))].slice(0, 30);
  } catch {
    return [];
  }
}

export async function mt5AccountState(link: Mt5Link): Promise<{ state: string; connection: string }> {
  if (!safeId(link.accountId)) throw new Mt5Error('MT5_ERROR', 'Unknown MT5 account.');
  const d = await call(`${PROVISIONING}/users/current/accounts/${link.accountId}`);
  return { state: String(d?.state || 'UNKNOWN'), connection: String(d?.connectionStatus || 'DISCONNECTED') };
}

/** Removes the account at MetaApi (its stored credentials go with it); "already gone" counts as done */
export async function deleteMt5Account(link: Mt5Link): Promise<void> {
  if (!safeId(link.accountId)) return;
  try {
    await call(`${PROVISIONING}/users/current/accounts/${link.accountId}`, { method: 'DELETE', tries: 4 });
  } catch (err) {
    if (err instanceof Mt5Error && (err.code === 'MT5_NOT_FOUND' || err.code === 'MT5_PENDING')) return;
    throw err;
  }
}

/**
 * Connects (deploy) or disconnects (undeploy) the account's cloud terminal. MetaApi bills per connected hour, so the
 * agent keeps an account connected only while it needs it (a run, or orders/positions it still manages); the
 * credentials stay at MetaApi either way, so waking it needs nothing from the trader.
 */
export async function setMt5Power(link: Mt5Link, on: boolean): Promise<void> {
  if (!safeId(link.accountId)) throw new Mt5Error('MT5_ERROR', 'Unknown MT5 account.');
  await call(`${PROVISIONING}/users/current/accounts/${link.accountId}/${on ? 'deploy' : 'undeploy'}`, { method: 'POST', tries: 3 });
}

const acct = (link: Mt5Link) => {
  if (!safeId(link.accountId)) throw new Mt5Error('MT5_ERROR', 'Unknown MT5 account.');
  return `${clientHost(link.region)}/users/current/accounts/${link.accountId}`;
};
const sym = (s: string) => encodeURIComponent(s);

export async function mt5AccountInfo(link: Mt5Link): Promise<{ balance: number; equity: number; currency: string; broker: string; tradeAllowed: boolean }> {
  const d = await call(`${acct(link)}/account-information`);
  return {
    balance: Number(d?.balance) || 0,
    equity: Number(d?.equity) || 0,
    currency: String(d?.currency || '').slice(0, 6),
    broker: String(d?.broker || '').slice(0, 60),
    tradeAllowed: d?.tradeAllowed !== false,
  };
}
export async function mt5Symbols(link: Mt5Link): Promise<string[]> {
  const d = await call(`${acct(link)}/symbols`);
  return Array.isArray(d) ? d.map(String).slice(0, 5000) : [];
}
export async function mt5Spec(link: Mt5Link, symbol: string) {
  const d = await call(`${acct(link)}/symbols/${sym(symbol)}/specification`);
  return { tickSize: Number(d?.tickSize) || 0, minVolume: Number(d?.minVolume) || 0, maxVolume: Number(d?.maxVolume) || 0, volumeStep: Number(d?.volumeStep) || 0, digits: Number(d?.digits) };
}
export async function mt5Price(link: Mt5Link, symbol: string) {
  const d = await call(`${acct(link)}/symbols/${sym(symbol)}/current-price`);
  return { bid: Number(d?.bid) || 0, ask: Number(d?.ask) || 0, lossTickValue: Number(d?.lossTickValue) || 0 };
}
export async function mt5Positions(link: Mt5Link): Promise<Array<{ id: string; symbol: string; clientId?: string; comment?: string }>> {
  const d = await call(`${acct(link)}/positions`);
  return Array.isArray(d) ? d.map((p: any) => ({ id: String(p.id), symbol: String(p.symbol), clientId: p.clientId, comment: p.comment })) : [];
}

const OK_CODES = new Set(['ERR_NO_ERROR', 'TRADE_RETCODE_PLACED', 'TRADE_RETCODE_DONE', 'TRADE_RETCODE_DONE_PARTIAL', 'TRADE_RETCODE_NO_CHANGES']);
/** Sends one trade request; resolves with the order/position ids or throws with the broker's reason */
export async function mt5Trade(link: Mt5Link, trade: Record<string, unknown>): Promise<{ orderId?: string; positionId?: string }> {
  const d = await call(`${acct(link)}/trade`, { method: 'POST', body: trade, timeoutMs: 20_000 });
  const code = String(d?.stringCode || d?.description || '');
  if (!OK_CODES.has(code)) throw new Mt5Error(code || 'MT5_TRADE_FAILED', String(d?.message || code || 'The broker refused the order.').slice(0, 200));
  return { ...(d?.orderId ? { orderId: String(d.orderId) } : {}), ...(d?.positionId ? { positionId: String(d.positionId) } : {}) };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------
/** Broker symbol names to try for each MarketX market, best first (brokers add suffixes like XAUUSD.m, XAUUSDm, XAUUSD+) */
export const MT5_CANDIDATES: Record<string, string[]> = {
  'XAU/USD': ['XAUUSD', 'GOLD'],
  'BTC/USDT': ['BTCUSD', 'BTCUSDT', 'BITCOIN'],
  'ETH/USDT': ['ETHUSD', 'ETHUSDT', 'ETHEREUM'],
  'USD/JPY': ['USDJPY'],
  'GBP/USD': ['GBPUSD'],
  NAS100: ['NAS100', 'US100', 'USTEC', 'NDX100', 'USTECH', 'NQ100'],
};
/** The broker's symbol for a MarketX market: an exact name first, then the shortest one with a suffix */
export function matchSymbol(market: string, brokerSymbols: string[]): string | null {
  const cands = MT5_CANDIDATES[market] || [];
  const norm = (s: string) => s.toUpperCase();
  for (const c of cands) {
    const exact = brokerSymbols.find(s => norm(s) === c);
    if (exact) return exact;
  }
  for (const c of cands) {
    const withSuffix = brokerSymbols.filter(s => norm(s).startsWith(c) && /^[._+#-]?[A-Za-z0-9]{0,3}$/.test(s.slice(c.length)));
    if (withSuffix.length) return withSuffix.sort((a, b) => a.length - b.length)[0];
  }
  return null;
}

/**
 * Lots for a risk: money at risk = balance x risk%, loss per lot = (stop distance / tick size) x loss tick value. Rounded
 * DOWN to the broker's volume step (never risks more than asked); null when even the smallest lot would risk more.
 */
export function lotSize(o: { balance: number; riskPct: number; entry: number; stop: number; tickSize: number; lossTickValue: number; minVolume: number; maxVolume: number; volumeStep: number }): number | null {
  const risk = o.balance * (o.riskPct / 100);
  const dist = Math.abs(o.entry - o.stop);
  if (!(risk > 0) || !(dist > 0) || !(o.tickSize > 0) || !(o.lossTickValue > 0)) return null;
  const perLot = (dist / o.tickSize) * o.lossTickValue;
  const step = o.volumeStep > 0 ? o.volumeStep : 0.01;
  let lots = Math.floor((risk / perLot) / step + 1e-9) * step;
  if (o.maxVolume > 0) lots = Math.min(lots, o.maxVolume);
  lots = Number(lots.toFixed(Math.max(0, Math.ceil(-Math.log10(step)))));
  if (lots < (o.minVolume || step)) return null;
  return lots;
}

/** Shifts MarketX's levels onto the broker's own quote (feeds differ a little); null when they differ too much */
export function brokerLevels(levels: { entry: number; stop: number; target: number }, feedPrice: number, brokerMid: number, digits?: number) {
  if (!(feedPrice > 0) || !(brokerMid > 0)) return null;
  const off = brokerMid - feedPrice;
  if (Math.abs(off) / feedPrice > 0.005) return null;
  const r = (p: number) => (Number.isFinite(digits) && (digits as number) >= 0 ? Number(p.toFixed(digits as number)) : Number(p.toPrecision(10)));
  return { entry: r(levels.entry + off), stop: r(levels.stop + off), target: r(levels.target + off), offset: off };
}

export const maskLogin = (login: string) => (login.length > 4 ? `••••${login.slice(-4)}` : '••••');
