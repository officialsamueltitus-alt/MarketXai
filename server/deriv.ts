// Live Deriv synthetic index quotes via Deriv's public WebSocket API.
// DERIV_APP_ID can be set to your own app id (https://api.deriv.com); 1089 is Deriv's public test id.

const SYMBOL_MAP: Array<[RegExp, string]> = [
  [/BOOM\s*1000/i, 'BOOM1000'],
  [/BOOM\s*500/i, 'BOOM500'],
  [/BOOM\s*300/i, 'BOOM300N'],
  [/CRASH\s*1000/i, 'CRASH1000'],
  [/CRASH\s*500/i, 'CRASH500'],
  [/CRASH\s*300/i, 'CRASH300N'],
  [/STEP/i, 'stpRNG'],
  [/JUMP\s*75/i, 'JD75'],
  [/JUMP\s*100/i, 'JD100'],
  [/VOLATILITY\s*100/i, 'R_100'],
  [/VOLATILITY\s*50/i, 'R_50'],
  [/VOLATILITY\s*25/i, 'R_25'],
  [/VOLATILITY\s*10\b/i, 'R_10'],
  [/VOLATILITY\s*75|V75/i, 'R_75'],
];

export function mapDerivSymbol(name: string): string | null {
  for (const [re, sym] of SYMBOL_MAP) if (re.test(name)) return sym;
  return null;
}

export interface DerivQuote {
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
}

const cache: Record<string, { quote: DerivQuote | null; at: number }> = {};

export async function fetchDerivQuote(derivSymbol: string): Promise<DerivQuote | null> {
  const now = Date.now();
  const cached = cache[derivSymbol];
  if (cached && now - cached.at < (cached.quote ? 5000 : 15000)) return cached.quote;

  const WS: any = (globalThis as any).WebSocket;
  if (!WS) return null;
  const appId = process.env.DERIV_APP_ID || '1089';

  const quote = await new Promise<DerivQuote | null>(resolve => {
    let settled = false;
    const done = (q: DerivQuote | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      resolve(q);
    };
    const ws = new WS(`wss://ws.derivws.com/websockets/v3?app_id=${appId}`);
    const timer = setTimeout(() => done(null), 6000);
    ws.onopen = () => {
      // Today's daily candle gives open/high/low/close in a single request
      ws.send(JSON.stringify({ ticks_history: derivSymbol, style: 'candles', granularity: 86400, count: 1, end: 'latest' }));
    };
    ws.onmessage = (ev: any) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
        const candle = msg?.candles?.[msg.candles.length - 1];
        if (!candle) return done(null);
        const open = Number(candle.open);
        const close = Number(candle.close);
        done({
          price: close,
          change24h: open ? Number((((close - open) / open) * 100).toFixed(2)) : 0,
          high24h: Number(candle.high),
          low24h: Number(candle.low),
        });
      } catch {
        done(null);
      }
    };
    ws.onerror = () => done(null);
  });

  if (!quote) console.warn(`[MarketX Feed] Deriv ${derivSymbol} unavailable`);
  cache[derivSymbol] = { quote: quote || cached?.quote || null, at: now };
  return quote || cached?.quote || null;
}
