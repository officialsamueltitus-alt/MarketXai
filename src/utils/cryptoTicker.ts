// Crypto ticker detection shared by the client and the server.
// Finds the coin a prompt is about when it is not one of the hard-coded majors: cashtags ($WIF), pairs (BONK/USDT,
// POPCATUSDT), contract addresses, well-known meme names ("dogwifhat", "ansem") and bare tickers typed in capitals.
// The server additionally checks bare words against the live list of every coin listed on the supported exchanges.

/** Popular names that differ from the ticker, plus trending memes people type in lowercase. */
export const CRYPTO_ALIASES: Record<string, string> = {
  dogwifhat: 'WIF', wif: 'WIF', bonk: 'BONK', popcat: 'POPCAT', fartcoin: 'FARTCOIN', pengu: 'PENGU', 'pudgy penguins': 'PENGU',
  floki: 'FLOKI', brett: 'BRETT', mog: 'MOG', 'mog coin': 'MOG', turbo: 'TURBO', neiro: 'NEIRO', goatseus: 'GOAT', 'goatseus maximus': 'GOAT',
  moodeng: 'MOODENG', 'moo deng': 'MOODENG', pnut: 'PNUT', peanut: 'PNUT', 'peanut the squirrel': 'PNUT', 'official trump': 'TRUMP',
  'trump coin': 'TRUMP', melania: 'MELANIA', gigachad: 'GIGA', 'book of meme': 'BOME', bome: 'BOME', 'cat in a dogs world': 'MEW',
  slerf: 'SLERF', myro: 'MYRO', michi: 'MICHI', wen: 'WEN', ansem: 'ANSEM', notcoin: 'NOT', hyperliquid: 'HYPE', jupiter: 'JUP',
  raydium: 'RAY', pyth: 'PYTH', jito: 'JTO', ethena: 'ENA', worldcoin: 'WLD', ondo: 'ONDO', ai16z: 'AI16Z',
  virtuals: 'VIRTUAL', 'virtuals protocol': 'VIRTUAL', spx6900: 'SPX6900', 'baby doge': 'BABYDOGE', babydoge: 'BABYDOGE',
  'dogs coin': 'DOGS', hamster: 'HMSTR', 'hamster kombat': 'HMSTR', catizen: 'CATI', sundog: 'SUNDOG',
  'pepe coin': 'PEPE', 'sei network': 'SEI', sei: 'SEI', arweave: 'AR', filecoin: 'FIL', 'the graph': 'GRT',
  algorand: 'ALGO', tezos: 'XTZ', monero: 'XMR', 'ethereum classic': 'ETC', 'internet computer': 'ICP', aave: 'AAVE',
  'lido dao': 'LDO', lido: 'LDO', 'curve dao': 'CRV', starknet: 'STRK', zksync: 'ZK', mantle: 'MNT', immutable: 'IMX',
  bittensor: 'TAO', 'fetch ai': 'FET', pendle: 'PENDLE', 'the sandbox': 'SAND', decentraland: 'MANA', 'axie infinity': 'AXS',
  'pudgy': 'PENGU', 'dog go to the moon': 'DOG', 'bitcoin cat': 'CAT', 'simon s cat': 'CAT', 'shiba inu': 'SHIB', dogecoin: 'DOGE',
};

// Words that are also tickers somewhere but mean something else in a prompt
const STOP = new Set(
  (
    'A AN THE AND OR BUT IF THEN ELSE FOR TO OF IN ON AT BY WITH FROM UP DOWN OUT OVER UNDER IS ARE WAS WERE BE BEEN BEING AM DO ' +
    'DOES DID HAVE HAS HAD CAN COULD WILL WOULD SHALL SHOULD MAY MIGHT MUST I ME MY WE US OUR YOU YOUR HE SHE IT ITS THEY THEM ' +
    'THEIR THIS THAT THESE THOSE WHAT WHICH WHO WHOM WHY HOW WHEN WHERE ALL ANY SOME NO NOT YES ONE TWO NOW NEW OLD GOOD BEST ' +
    'BIG TOP LOW HIGH MORE MOST LESS VERY JUST ALSO ONLY SO TOO GIVE GET GOT SHOW TELL ME LET MAKE FIND LOOK SEE CHECK PLEASE PLS ' +
    'ANALYZE ANALYSE ANALYSIS ANALYZING SETUP SETUPS SIGNAL SIGNALS TRADE TRADES TRADING CHART CHARTS PRICE PRICES MARKET MARKETS ' +
    'ENTRY ENTRIES STOP LOSS TAKE PROFIT TARGET TARGETS TP SL BUY SELL LONG SHORT BULL BEAR BULLISH BEARISH PUMP DUMP MOON ' +
    'COIN COINS TOKEN TOKENS MEME MEMES CRYPTO CRYPTOCURRENCY SPOT PERP PERPS FUTURES USDT USDC USD DAILY WEEKLY HOURLY TIMEFRAME ' +
    'MIN MINS MINUTE MINUTES HOUR HOURS DAY DAYS WEEK WEEKS TODAY TOMORROW NEXT LAST ZONE ZONES SUPPLY DEMAND LEVEL LEVELS KEY ' +
    'TREND TRENDS NEWS FOR RIGHT NEAR HERE THERE ABOUT INTO ON TIGHT NORMAL SCALP SWING SESSION ASIA LONDON NY RDM SI AI OK OKAY ' +
    'THANKS THANK HI HELLO HEY SIR BRO MAN GO BACK AGAIN STILL EVEN BEFORE AFTER WHILE WITHOUT AGAINST BETWEEN LIKE WANT NEED ' +
    'THINK KNOW MEAN SAY SAYS SAID USE USING PAIR PAIRS VS PER EACH EVERY OTHER SAME SUCH THAN WELL REAL LIVE FAST FREE ' +
    'IDEA IDEAS PEOPLE FUN FACT BANK BANKS DIP STOCK STOCKS HOLD HODL WHY WAY TIME LIFE WORK HELP OPEN CLOSE CASH MONEY RISK SAFE'
  ).split(/\s+/)
);

const COIN_WORDS = /\b(coin|token|meme|memecoin|crypto|usdt|usdc|perp|perps)\b/i;
const CRYPTO_CONTEXT = /\b(analy[sz]e|analysis|setup|signal|chart|trade|trading|long|short|buy|sell|price|entry|coin|token|meme|memecoin|usdt|usdc|perp|crypto|pump|moon|scalp)\b/i;

export interface CryptoTickerHit {
  /** Ticker in capitals (WIF, BONK, ANSEM) or a contract address */
  base: string;
  /** Explicit mention (cashtag, pair, address, known name): worth a lookup even if no exchange list has it */
  strong: boolean;
  /** Contract address mentioned in the prompt (Solana base58 or EVM 0x) */
  address?: string;
}

const TF_RE = /^(\d+[MHDW]|[MHDW]\d+|\d+(MIN|MINS|H|HR|HRS|D|W))$/i;
const validTicker = (t: string) => /^[A-Z0-9]{1,15}$/.test(t) && /[A-Z]/.test(t) && !TF_RE.test(t);

/**
 * The crypto ticker a prompt names, if any. `isListed` (server only) says whether a bare word is a real listed coin.
 * Majors, forex, stocks and commodities are matched before this by the callers, so this only runs for everything else.
 */
export function detectCryptoTicker(prompt: string, isListed?: (base: string) => boolean): CryptoTickerHit | null {
  const text = String(prompt || '');
  if (!text.trim()) return null;
  // Contract addresses: EVM 0x… or Solana base58 (32 to 44 chars)
  const evm = text.match(/\b0x[a-fA-F0-9]{40}\b/);
  if (evm) return { base: evm[0], strong: true, address: evm[0] };
  const sol = text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
  if (sol && /[a-z]/.test(sol[0]) && /[A-Z]/.test(sol[0]) && /\d/.test(sol[0])) return { base: sol[0], strong: true, address: sol[0] };
  // Cashtag: $WIF, $ansem
  const cash = text.match(/\$([A-Za-z][A-Za-z0-9]{0,14})\b/);
  if (cash && validTicker(cash[1].toUpperCase())) return { base: cash[1].toUpperCase(), strong: true };
  // Pairs: BONK/USDT, wif-usdt, POPCATUSDT, ansem/usd
  const pair = text.match(/\b([A-Za-z0-9]{1,15})\s*[\/\-]\s*(USDT|USDC|USD)\b/i) || text.match(/\b([A-Za-z0-9]{2,15}?)(USDT|USDC)\b/i);
  if (pair) {
    const base = pair[1].toUpperCase();
    if (validTicker(base) && !STOP.has(base)) return { base, strong: true };
  }
  // Known names ("dogwifhat", "moo deng", "ansem"), longest first so "pudgy penguins" beats "pudgy"
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ')} `;
  for (const name of Object.keys(CRYPTO_ALIASES).sort((a, b) => b.length - a.length)) {
    if (lower.includes(` ${name} `)) return { base: CRYPTO_ALIASES[name], strong: true };
  }
  // Bare words: a ticker typed in capitals in a trading prompt (WIF 1H, PENGU setup), or (server only) a listed coin typed
  // in lowercase where it can only be a coin: right after "analyze", right before a timeframe, or next to coin/token/meme
  const words = [...text.matchAll(/[A-Za-z][A-Za-z0-9]{1,14}/g)];
  const context = CRYPTO_CONTEXT.test(text);
  const coinWords = COIN_WORDS.test(text);
  for (const m of words) {
    const w = m[0];
    const up = w.toUpperCase();
    if (!validTicker(up) || STOP.has(up)) continue;
    const typedInCaps = w === up && up.length >= 2;
    const before = text.slice(0, m.index).trimEnd();
    const after = text.slice((m.index || 0) + w.length).trimStart();
    const slot = /\banaly[sz]e$/i.test(before) || /^(on\s+(the\s+)?)?(\d+\s*(m|min|h|hr|d|w)|[mhdw]\d+|daily|weekly|hourly)\b/i.test(after);
    if (isListed) {
      if (isListed(up) && ((typedInCaps && context) || (up.length >= 3 && (slot || coinWords)))) return { base: up, strong: false };
    } else if (typedInCaps && context && up.length >= 3) {
      return { base: up, strong: false };
    }
  }
  return null;
}
