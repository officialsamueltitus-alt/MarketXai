// Decides whether a prompt asks for a trade analysis or is a question about trading / the markets.
// Pure and shared by the server (authoritative) and the browser (to show the right progress steps).
//
// Analysis: a chart image, an explicit request ("analyze", "setup", "signal", "trade plan", "find an entry"), or a
// short command naming a market (e.g. "gold 4h", "sell BTC", "EURUSD outlook").
// Question: everything asked as a question ("what is a liquidity sweep?", "why is gold rising?", "is EURUSD
// bullish today?"), a request to explain / teach, or a request for details about a pair ("tell me about WIF",
// "BONK info", "PEPE market cap", "EURUSD price"). Questions get a written answer (with live price, market details
// and today's news for any pair they name), not a trade card.
// Clarify: just a pair and nothing else ("EURUSD", "gold", "$WIF", "ansem"). MarketX asks whether the trader wants an
// analysis or information about it, and nothing is charged.

const STRONG_DIRECTIVE =
  /\b(analy[sz]e|analysis|set ?up|signals?|trade (plan|idea)|find (me )?(a |an )?(trade|entry|setup)|give me (a |an )?(trade|entry|setup|signal)|entry,? stop|scan)\b/i;
const TRADE_WORDS = /\b(buy|sell|long|short)\b/i;
const TIMEFRAME = /\b(\d{1,2}\s?(m|min|mins|h|hr|hrs|d|w)|[mhdw]\d{1,2}|hourly|daily|weekly)\b/i;
const QUESTION_START =
  /^(what|what's|whats|why|how|when|where|who|which|is|are|was|were|do|does|did|can|could|should|would|will|explain|define|describe|tell me|teach|help me understand|difference|meaning|compare)\b/i;
const EXPLAIN = /\b(explain|what is|what are|what does|meaning of|define|definition|how (do|does|to)|difference between|teach me|learn)\b/i;

// Details about a pair rather than a trade plan
const INFO =
  /\b(info|information|details?|about|overview|profile|fundamentals|tokenomics|market ?cap|mcap|fdv|supply|circulating|liquidity|volume|contract|ca|chain|network|listed|listing|exchanges?|price|prices|quote|rate|news|rundown|summary|history|team|founder|launch(ed)?|holders?|utility|use case)\b/i;
// Words that make a short prompt a request for a plan ("gold outlook", "BTC levels")
const PLAN_HINT = /\b(outlook|forecast|bias|prediction|predict|levels?|zones?|entry|entries|targets?|tp\d?|sl|stop|plan|idea|move|breakout|scalp|swing|pump|dump)\b/i;

export type PromptIntent = 'analysis' | 'question' | 'clarify';

// Token safety ("is $WIF safe?", "rug check <address>", "/safety BONK", "honeypot?"): a free on-chain check of a
// Solana token, answered before any credit is used. Only for crypto: "is it safe to buy gold now" is a market question.
const SAFETY =
  /^\/(token-?safety|safety|rugcheck|rug)\b|\b(rug ?check|rug ?pull|rugged|is (it|this|that) (a )?rug|honey ?pot|safety (check|score)|token safety|(check|scan|audit) (this |the |my )?(token|contract|coin|ca|mint)|is .{1,48}\b(safe|legit|a scam|scam)\b|safe to (buy|ape|hold|trade)|(mint|freeze) authority|lp (locked|burn(ed)?)|liquidity (locked|burn(ed)?))/i;
export function isSafetyRequest(prompt: string): boolean {
  const text = String(prompt || '').trim();
  if (!text || text.length > 200 || !SAFETY.test(text)) return false;
  // "What is a rug pull?" is a lesson, unless a token address is in it
  if (/^(what|why|how|explain|define|teach)\b/i.test(text) && !solanaAddressIn(text)) return false;
  return true;
}
/** Major coins on their own blockchains (not Solana tokens): no safety check to offer for them */
const MAJOR_COIN = /^(BTC|ETH|SOL|XRP|BNB|ADA|DOGE|LTC|TRX|DOT|AVAX|LINK|TON|XLM|BCH)$/;
export function isMajorCoin(symbol: string): boolean {
  return MAJOR_COIN.test(String(symbol || '').split('/')[0].toUpperCase());
}
/**
 * Whether a safety-worded prompt about a coin should run the token safety check. "Is BTC safe to buy now?" about a major
 * coin is a market question, not a rug check; it only runs the check when asked outright ("/safety BTC", "rug check ETH").
 */
export function wantsSafetyCheck(prompt: string, symbol: string): boolean {
  if (!isMajorCoin(symbol)) return true;
  return /^\/(token-?safety|safety|rugcheck|rug)\b|\b(rug ?check|rugged|honey ?pot|safety (check|score)|token safety|(mint|freeze) authority)\b/i.test(String(prompt || ''));
}
/** A Solana token address written in the prompt (base58, 32 to 44 characters), if any */
export function solanaAddressIn(prompt: string): string | null {
  const m = String(prompt || '').match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
  return m ? m[0] : null;
}
/** The words around the token, without the safety wording ("is $WIF safe?" -> "$WIF") */
export function safetySubject(prompt: string): string {
  return String(prompt || '')
    .replace(/^\/(token-?safety|safety|rugcheck|rug)\b/i, ' ')
    .replace(/\b(is|it|this|that|a|an|the|my|check|scan|audit|rug ?check|rug ?pull|rugged|rug|honey ?pot|safety|score|token|contract|coin|ca|mint|safe|legit|scam|to|buy|ape|hold|trade|please|pls|can you|for me|on solana|solana)\b/gi, ' ')
    .replace(/[?!.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Just a market and nothing else ("EURUSD", "gold", "$WIF", "BTC/USDT"): ask what the trader wants. */
export function isBarePair(prompt: string, namesAsset: boolean): boolean {
  const text = String(prompt || '').trim();
  if (!namesAsset || !text || text.length > 48) return false;
  if (STRONG_DIRECTIVE.test(text) || TRADE_WORDS.test(text) || TIMEFRAME.test(text) || PLAN_HINT.test(text) || INFO.test(text)) return false;
  if (QUESTION_START.test(text) || /\?/.test(text) || EXPLAIN.test(text)) return false;
  // One market name, at most three words ("gold", "EUR USD", "dog wif hat", "BTC/USDT", "$ANSEM")
  return text.split(/\s+/).filter(Boolean).length <= 3;
}

export function classifyPrompt(prompt: string, opts: { hasChartImage?: boolean; namesAsset?: boolean } = {}): PromptIntent {
  const text = String(prompt || '').trim();
  if (opts.hasChartImage) return 'analysis';
  if (!text) return 'question';
  if (isBarePair(text, !!opts.namesAsset)) return 'clarify';
  const isQuestion = QUESTION_START.test(text) || /\?\s*$/.test(text) || EXPLAIN.test(text);
  if (isQuestion) {
    // "Can you analyze gold on the 4H?" is still a request for a trade plan; a lesson about setups is not
    if (STRONG_DIRECTIVE.test(text) && !EXPLAIN.test(text)) return 'analysis';
    return 'question';
  }
  if (STRONG_DIRECTIVE.test(text)) return 'analysis';
  // "tell me about WIF", "BONK info", "PEPE market cap", "EURUSD price": details, not a trade plan
  if (INFO.test(text) && !PLAN_HINT.test(text) && !TRADE_WORDS.test(text) && !TIMEFRAME.test(text)) return 'question';
  if (opts.namesAsset) return 'analysis'; // "gold 4h", "sell BTC", "XAUUSD outlook"
  if (TRADE_WORDS.test(text) && TIMEFRAME.test(text)) return 'analysis';
  return 'question';
}
