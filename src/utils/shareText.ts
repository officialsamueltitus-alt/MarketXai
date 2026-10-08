import type { StrategyResult } from '../types';
import { exactPrice } from './formatPrice';

// X's post limit: URLs count 23, emoji and wide characters count 2, everything else 1
export const X_POST_LIMIT = 280;

export function xLength(text: string): number {
  let n = 0;
  const noUrls = text.replace(/https?:\/\/\S+/g, () => {
    n += 23;
    return '';
  });
  for (const ch of noUrls) {
    const cp = ch.codePointAt(0) || 0;
    if (cp === 0xfe0f || cp === 0x200d) continue;
    n += cp > 0x10ff ? 2 : 1;
  }
  return n;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

const price = (p?: number) => (Number.isFinite(p) && (p as number) > 0 ? exactPrice(p as number) : '');

// "$BTC" style cashtag for coins and tickers, the plain pair name otherwise
function marketTag(symbol: string, assetType?: string): string {
  const base = String(symbol || '').split('/')[0].replace(/[^A-Za-z0-9]/g, '');
  if (String(assetType).toLowerCase() === 'crypto' && /^[A-Za-z][A-Za-z0-9]{0,9}$/.test(base)) return `$${base.toUpperCase()}`;
  return String(symbol || '').replace(/\s+/g, ' ').trim() || 'this market';
}

function originLine(s: StrategyResult): string {
  if (s.userStrategy?.name) return `Personal strategy: ${clip(s.userStrategy.name, 40)}`;
  const parts: string[] = [];
  if (s.analysisMode === 'CONFIRMATION' && s.confirmationRead?.state === 'CONFIRMED') parts.push(`Confirmed on the ${s.confirmationRead.ltf}`);
  if (s.timeframeScan?.mode === 'RDM' && s.timeframeScan.chosen) parts.push(`RDM scan picked the ${s.timeframeScan.chosen}`);
  return parts.join(' · ');
}

function noSignalReason(s: StrategyResult): string {
  if (s.signalLock?.reason === 'RUNNING') return 'My trade here is still running, so no new trade until it ends.';
  if (s.signalLock?.reason === 'COOLDOWN') return 'Just stopped out, so no flip to the other side yet.';
  if (s.userStrategy?.name) return 'My rules found no valid setup right now, so no trade.';
  if (s.alreadyMoved === 'NEAR_SL') return 'Price is already close to the stop loss, so no trade.';
  if (s.alreadyMoved) return 'Price already moved close to the target, so no trade.';
  if (s.alreadyMitigated) return 'The setup was already mitigated, so no trade.';
  const st = s.confirmationRead?.state;
  if (st === 'WAITING_TAP' || st === 'WAITING_PATTERN') return 'Setup found, waiting for confirmation before any entry.';
  return 'No clean setup right now, so no trade.';
}

/** The ready made X post for a result card (general engine and Strategy Builder alike), always within X's limit */
export function buildShareText(s: StrategyResult, origin = 'https://marketx.world'): string {
  const tf = s.timeframe ? ` · ${s.timeframe}` : '';
  const market = marketTag(s.symbol, s.assetType);
  const site = `${origin.replace(/\/+$/, '')}`;
  const proofUrl = s.proof?.id ? `${site}/proof/${encodeURIComponent(s.proof.id)}` : '';
  const isTrade = s.tradeType === 'LONG' || s.tradeType === 'SHORT';

  // Lines in order; lines with a `drop` rank are removed (lowest rank first) if the post runs over the limit
  const lines: Array<{ text: string; drop?: number }> = [];
  if (isTrade) {
    const long = s.tradeType === 'LONG';
    lines.push({ text: `${long ? '🟢 BUY' : '🔴 SELL'} ${market}${tf}` });
    const from = originLine(s);
    if (from) lines.push({ text: from, drop: 4 });
    lines.push({ text: '' });
    const ez = s.entryZone;
    const kind = s.execution === 'MARKET' ? ' (market)' : s.execution === 'LIMIT' ? ' (limit)' : '';
    const range = ez && ez.min && ez.max && ez.min !== ez.max ? `Zone: ${price(Math.min(ez.min, ez.max))} to ${price(Math.max(ez.min, ez.max))}` : '';
    lines.push({ text: `🎯 Entry: ${price(ez?.optimal)}${kind}` });
    if (range) lines.push({ text: range, drop: 2 });
    lines.push({ text: `🛑 Stop: ${price(s.stopLoss?.price)}` });
    const tps = (s.takeProfits || []).filter(t => Number.isFinite(t?.price) && t.price > 0).slice(0, 3);
    if (tps.length) lines.push({ text: `💰 ${tps.map((t, i) => `TP${i + 1} ${price(t.price)}`).join(' · ')}` });
    if (s.riskRewardRatio && !/:\s*0$/.test(s.riskRewardRatio)) lines.push({ text: `⚖️ R:R ${s.riskRewardRatio.replace(/\s+/g, ' ')}`, drop: 3 });
    lines.push({ text: '' });
    if (proofUrl) lines.push({ text: `🔐 Sealed on Solana: ${proofUrl}`, drop: 5 });
  } else {
    lines.push({ text: `⚪ No trade on ${market}${tf} right now` });
    const from = originLine(s);
    if (from) lines.push({ text: from, drop: 4 });
    lines.push({ text: '' });
    lines.push({ text: noSignalReason(s) });
    if (price(s.currentPrice)) lines.push({ text: `Price: ${price(s.currentPrice)}`, drop: 2 });
    lines.push({ text: '' });
  }
  lines.push({ text: `Analysed with MarketX SI (@_MarketX) ${site}` });
  lines.push({ text: '#MarketX #Trading', drop: 1 });

  const render = () => lines.map(l => l.text).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  let text = render();
  while (xLength(text) > X_POST_LIMIT) {
    let i = -1;
    lines.forEach((l, k) => {
      if (l.drop && (i < 0 || l.drop < (lines[i].drop as number))) i = k;
    });
    if (i < 0) break;
    lines.splice(i, 1);
    text = render();
  }
  return text;
}

/** Opens X's post box filled with the result; if the pop-up is blocked, opens it in this tab */
export function openXPost(text: string) {
  const url = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  try {
    navigator.clipboard?.writeText(text).catch(() => {});
  } catch {}
  let w: Window | null = null;
  try {
    w = window.open(url, '_blank');
  } catch {}
  if (w) {
    try {
      w.opener = null;
    } catch {}
  } else {
    window.location.href = url;
  }
}
