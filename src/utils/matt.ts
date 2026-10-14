import type { StrategyResult } from '../types';
// Opening Matt (MarketX's help assistant, /matt) about a specific thing: the question and optional context (e.g. the trade card
// the trader is looking at) ride in sessionStorage, so long text never goes in the URL. The page asks it straight away.
export interface MattAsk {
  /** The question Matt is asked first */
  q: string;
  /** Short label shown above the conversation, e.g. "BTC/USDT 1H trade" */
  label?: string;
  /** Extra details Matt may explain (plain text, public: what the trader sees on screen) */
  context?: string;
}
const KEY = 'mx.matt.ask';

export function openMatt(ask?: MattAsk) {
  try {
    if (ask) sessionStorage.setItem(KEY, JSON.stringify({ ...ask, q: ask.q.slice(0, 600), context: ask.context?.slice(0, 2400), at: Date.now() }));
  } catch {}
  window.location.assign('/matt');
}

/** The pending question (once: it is cleared when read; ignored after 2 minutes) */
export function takeMattAsk(): MattAsk | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v.q !== 'string' || Date.now() - (Number(v.at) || 0) > 120_000) return null;
    return { q: v.q, label: typeof v.label === 'string' ? v.label.slice(0, 80) : undefined, context: typeof v.context === 'string' ? v.context : undefined };
  } catch {
    return null;
  }
}

/** What Matt is given about a trade card: what the trader sees on it, in plain text */
export function tradeContext(s: StrategyResult): string {
  const side = s.tradeType === 'LONG' ? 'Buy' : s.tradeType === 'SHORT' ? 'Sell' : 'No signal';
  const lines = [
    `${s.symbol} on the ${s.timeframe}: ${side}${s.execution ? ` (${s.execution === 'MARKET' ? 'enter now at market' : 'limit order'})` : ''}.`,
    s.tradeType === 'NO_SIGNAL' ? '' : `Entry zone ${s.entryZone.min} to ${s.entryZone.max} (best ${s.entryZone.optimal}); stop loss ${s.stopLoss.price}; targets ${s.takeProfits.map((t, i) => `TP${i + 1} ${t.price}`).join(', ')}; reward to risk ${s.riskRewardRatio}.`,
    `Price when served: ${s.currentPrice}.`,
    s.alreadyMitigated ? 'Result: No signal, already mitigated.' : '',
    s.alreadyMoved ? `Result: No signal, already moved, close to ${s.alreadyMoved === 'NEAR_TP' ? 'TP' : 'the stop loss'}.` : '',
    s.tradeStyle ? `Trade type: ${s.tradeStyle.label}${s.tradeStyle.closeByText ? `, close by ${s.tradeStyle.closeByText}` : ''}.` : '',
    s.userStrategy ? `Found by the trader's personal strategy "${s.userStrategy.name}".` : '',
    s.analysisMode === 'CONFIRMATION' && s.confirmationRead ? `Confirmation analysis: ${s.confirmationRead.state.replace('_', ' ').toLowerCase()} on the ${s.confirmationRead.ltf}.` : '',
    s.timeframeScan?.mode === 'RDM' ? `RDM scan picked the ${s.timeframeScan.chosen || 'none'}.` : '',
    s.proof ? 'Sealed on Solana (proof badge on the card).' : '',
    `Card notes: ${String(s.entryZone.rationale || '').slice(0, 700)}`,
  ];
  return lines.filter(Boolean).join('\n');
}
export function tradeAsk(s: StrategyResult, q?: string): MattAsk {
  const what = s.tradeType === 'NO_SIGNAL' ? `this ${s.symbol} ${s.timeframe} result` : `this ${s.symbol} ${s.timeframe} ${s.tradeType === 'LONG' ? 'buy' : 'sell'} trade`;
  return { q: q || `Explain ${what} in simple terms: what the entry, stop loss and targets mean, and how I should read it.`, label: `${s.symbol} ${s.timeframe} ${s.tradeType === 'NO_SIGNAL' ? 'result' : 'trade'}`, context: tradeContext(s) };
}
