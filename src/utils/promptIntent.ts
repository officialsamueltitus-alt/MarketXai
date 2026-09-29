// Decides whether a prompt asks for a trade analysis or is a question about trading / the markets.
// Pure and shared by the server (authoritative) and the browser (to show the right progress steps).
//
// Analysis: a chart image, an explicit request ("analyze", "setup", "signal", "trade plan", "find an entry"), or a
// short command naming a market (e.g. "EURUSD", "gold 4h", "sell BTC").
// Question: everything asked as a question ("what is a liquidity sweep?", "why is gold rising?", "is EURUSD
// bullish today?") or a request to explain / teach, even when it names a pair. Questions get a written answer
// (with live price and today's news for any pair they name), not a trade card.

const STRONG_DIRECTIVE =
  /\b(analy[sz]e|analysis|set ?up|signals?|trade (plan|idea)|find (me )?(a |an )?(trade|entry|setup)|give me (a |an )?(trade|entry|setup|signal)|entry,? stop|scan)\b/i;
const TRADE_WORDS = /\b(buy|sell|long|short)\b/i;
const TIMEFRAME = /\b(\d{1,2}\s?(m|min|mins|h|hr|hrs|d|w)|[mhdw]\d{1,2}|hourly|daily|weekly)\b/i;
const QUESTION_START =
  /^(what|what's|whats|why|how|when|where|who|which|is|are|was|were|do|does|did|can|could|should|would|will|explain|define|describe|tell me|teach|help me understand|difference|meaning|compare)\b/i;
const EXPLAIN = /\b(explain|what is|what are|what does|meaning of|define|definition|how (do|does|to)|difference between|teach me|learn)\b/i;

export type PromptIntent = 'analysis' | 'question';

export function classifyPrompt(prompt: string, opts: { hasChartImage?: boolean; namesAsset?: boolean } = {}): PromptIntent {
  const text = String(prompt || '').trim();
  if (opts.hasChartImage) return 'analysis';
  if (!text) return 'question';
  const isQuestion = QUESTION_START.test(text) || /\?\s*$/.test(text) || EXPLAIN.test(text);
  if (isQuestion) {
    // "Can you analyze gold on the 4H?" is still a request for a trade plan; a lesson about setups is not
    if (STRONG_DIRECTIVE.test(text) && !EXPLAIN.test(text)) return 'analysis';
    return 'question';
  }
  if (STRONG_DIRECTIVE.test(text)) return 'analysis';
  if (opts.namesAsset) return 'analysis'; // "EURUSD", "gold 4h", "sell BTC", "XAUUSD outlook"
  if (TRADE_WORDS.test(text) && TIMEFRAME.test(text)) return 'analysis';
  return 'question';
}
