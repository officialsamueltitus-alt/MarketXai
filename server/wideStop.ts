// ===========================================================================
// Wider stop loss (owner-specified, Preference Mode `wideSl`, off by default): every LONG / SHORT served gets a little
// extra room past the stop the analysis called, so a wick doesn't take the trade out. The stop moves AWAY from the entry
// by WIDE_SL_SHARE of the trade's risk (at least WIDE_SL_MIN_PIPS on markets measured in pips, rounded to whole pips);
// entry and targets stay, the R:R is recalculated, and the result says the stop was widened (`stopLoss.widened`, a note
// at the top of the write-up). Applied after the analysis is written (res.json wrapper inside the analyze handler), so
// the price alert, journal, track record and proof all use the widened stop. The engine and its instructions are untouched.
// ===========================================================================
import type { Response } from 'express';
import { guessFromSymbol, usesPips } from '../src/utils/tradeCalc';
import { exactPrice } from '../src/utils/formatPrice';

export const WIDE_SL_SHARE = 0.15;
export const WIDE_SL_MIN_PIPS = 2;

const decimalsOf = (n: number) => {
  const s = String(n);
  if (/e-/i.test(s)) return Math.min(12, Number(s.split('e-')[1]) + (s.split('e-')[0].split('.')[1]?.length || 0));
  return s.split('.')[1]?.length || 0;
};

/** The widened stop for a trade (or null when the levels can't be read) */
export function widenStop(symbol: string, side: 'LONG' | 'SHORT', entry: number, stop: number) {
  if (!(entry > 0) || !(stop > 0) || !Number.isFinite(entry) || !Number.isFinite(stop)) return null;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  const { market, pip } = guessFromSymbol(symbol);
  const pips = usesPips(market);
  let extra = risk * WIDE_SL_SHARE;
  if (pips) extra = Math.max(WIDE_SL_MIN_PIPS, Math.ceil(extra / pip)) * pip;
  // Same precision as the levels the analysis gave (never fewer decimals than a pip needs)
  const dp = Math.min(10, Math.max(decimalsOf(stop), decimalsOf(entry), pips ? decimalsOf(pip) : 0));
  const next = Number((side === 'LONG' ? stop - extra : stop + extra).toFixed(dp));
  if (!(next > 0)) return null;
  const by = Math.abs(next - stop);
  return { price: next, original: stop, by: pips ? Math.round(by / pip) : Number(by.toFixed(dp)), unit: pips ? ('pips' as const) : ('points' as const) };
}

const NUM = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
/** On lines about the stop, the old stop number becomes the new one (kept in the same comma style) */
function swapStopInText(text: string, from: number, to: number): string {
  return text
    .split('\n')
    .map(line =>
      /stop|\bSL\b|invalidat/i.test(line)
        ? line.replace(NUM, raw => (Math.abs(Number(raw.replace(/,/g, '')) - from) <= Math.abs(from) * 1e-9 ? (raw.includes(',') ? exactPrice(to) : String(to)) : raw))
        : line
    )
    .join('\n');
}

/** Wraps res.json: a served LONG / SHORT gets the wider stop, recalculated R:R and the "widened" note */
export function tagWideStop(res: Response) {
  const send = res.json.bind(res);
  res.json = ((body: any) => {
    try {
      const s = body?.strategy;
      const side = s?.tradeType;
      if (res.statusCode < 400 && s && (side === 'LONG' || side === 'SHORT') && s.stopLoss && !s.stopLoss.widened) {
        const entry = Number(s.entryZone?.optimal);
        const w = widenStop(String(s.symbol || ''), side, entry, Number(s.stopLoss.price));
        if (w) {
          const risk = Math.abs(entry - w.price);
          s.stopLoss = {
            ...s.stopLoss,
            price: w.price,
            riskPercent: Number(((risk / entry) * 100).toFixed(2)),
            rationale: `${String(s.stopLoss.rationale || '').replace(/\.?\s*$/, '')}. Widened by ${w.by} ${w.unit} for breathing space.`,
            widened: { by: w.by, unit: w.unit, original: w.original },
          };
          if (Array.isArray(s.takeProfits)) {
            s.takeProfits = s.takeProfits.map((t: any) => {
              const rr = Math.abs(Number(t?.price) - entry) / risk;
              return Number.isFinite(rr) ? { ...t, rewardRatio: `1:${rr.toFixed(1)}` } : t;
            });
            const last = s.takeProfits[s.takeProfits.length - 1];
            const rrFinal = last ? Math.abs(Number(last.price) - entry) / risk : NaN;
            if (Number.isFinite(rrFinal)) s.riskRewardRatio = `1 : ${rrFinal.toFixed(1)}`;
          }
          const note = `> **Stop loss widened:** ${w.by} ${w.unit} past the normal stop (~~${exactPrice(w.original)}~~ → **${exactPrice(w.price)}**) for price breathing space. Entry and targets are the same; the R:R is recalculated.\n\n`;
          for (const [obj, key] of [[s, 'detailedThesis'], [body, 'message'], [body, 'content']] as const) {
            if (typeof obj[key] === 'string') obj[key] = note + swapStopInText(obj[key], w.original, w.price);
          }
        }
      }
    } catch (err: any) {
      console.warn('[MarketX Wide SL] skipped:', err?.message || err);
    }
    return send(body);
  }) as typeof res.json;
}
