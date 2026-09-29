import React, { useState } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, XCircle, Activity, Target } from 'lucide-react';
import { RecheckResponse, StrategyResult } from '../types';
import { apiFetch } from '../utils/apiClient';

const STATE_STYLE: Record<RecheckResponse['state'], { box: string; icon: React.ElementType; iconClass: string }> = {
  VALID: { box: 'bg-emerald-500/[0.08] border-emerald-400/30 text-emerald-100', icon: CheckCircle2, iconClass: 'text-emerald-400' },
  TRIGGERED: { box: 'bg-sky-500/[0.08] border-sky-400/30 text-sky-100', icon: Activity, iconClass: 'text-sky-400' },
  TP_HIT: { box: 'bg-indigo-500/[0.08] border-indigo-400/30 text-indigo-100', icon: Target, iconClass: 'text-indigo-300' },
  SL_HIT: { box: 'bg-rose-500/[0.08] border-rose-400/30 text-rose-100', icon: XCircle, iconClass: 'text-rose-400' },
  MITIGATED: { box: 'bg-amber-500/[0.08] border-amber-400/30 text-amber-100', icon: AlertTriangle, iconClass: 'text-amber-400' },
};

const LEVEL_STYLE: Record<RecheckResponse['levels'][number]['status'], { label: string; cls: string }> = {
  UNTOUCHED: { label: 'Untouched', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  AT_PRICE: { label: 'At price now', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  TOUCHED: { label: 'Tapped', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  HIT: { label: 'Hit', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
};

/** Builds what the server replays: the signal's zone, entry, stop and targets, from the zone's leg-out onward. */
function recheckBody(s: StrategyResult) {
  const long = s.tradeType === 'LONG';
  const zone = s.setupCheck?.zone || (long ? s.demandZone : s.supplyZone);
  return {
    symbol: s.symbol,
    timeframe: s.setupCheck?.timeframe || s.timeframe,
    direction: s.tradeType,
    execution: s.execution === 'MARKET' ? 'MARKET' : 'LIMIT',
    zone: zone ? { low: zone.low, high: zone.high } : null,
    entry: s.entryZone,
    stop: s.stopLoss?.price,
    targets: (s.takeProfits || []).map(t => t.price),
    // Without the engine's replay point (e.g. a chart read), check everything since the signal was issued
    since: s.setupCheck?.since || s.timestamp,
    issuedAt: s.setupCheck?.issuedAt || s.timestamp,
  };
}

/** "Recheck" on a trade card: replays live candles and price over the zone, entry, stop and targets. */
export const RecheckPanel: React.FC<{ strategy: StrategyResult }> = ({ strategy }) => {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (strategy.tradeType !== 'LONG' && strategy.tradeType !== 'SHORT') return null;

  const fmt = (p: number) =>
    strategy.currentPrice < 10 ? p.toFixed(strategy.currentPrice < 1 ? 5 : 4) : p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await apiFetch<RecheckResponse>('/api/market/recheck', { method: 'POST', body: JSON.stringify(recheckBody(strategy)) }));
    } catch (err: any) {
      setError(err?.message || 'Recheck failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const style = result ? STATE_STYLE[result.state] : null;
  const Icon = style?.icon || CheckCircle2;
  return (
    <div className="rounded-xl border border-white/[0.1] bg-white/[0.02] p-3 space-y-2.5 min-w-0" data-testid="recheck-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-[10px] uppercase tracking-wider font-mono font-bold text-slate-300 block">Zone recheck</span>
          <span className="text-[11px] text-slate-400 block">
            {result
              ? `Checked ${new Date(result.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} at ${fmt(result.price)}${result.priceSource === 'live' ? ' (live)' : ''}`
              : 'Confirm with live prices that the zone, entry, stop and targets are still untouched.'}
          </span>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 text-sky-100 border border-sky-400/30 text-xs font-semibold transition-all disabled:opacity-60 disabled:cursor-wait cursor-pointer shrink-0"
          aria-label="Recheck this analysis with live prices"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-sky-300 ${busy ? 'animate-spin' : ''}`} />
          <span>{busy ? 'Rechecking…' : result ? 'Recheck again' : 'Recheck zones'}</span>
        </button>
      </div>

      {error && <p className="text-[11px] text-rose-300" role="alert">{error}</p>}

      {result && style && (
        <div className="space-y-2" aria-live="polite">
          <div className={`p-2.5 rounded-lg border flex items-start gap-2 ${style.box}`}>
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${style.iconClass}`} />
            <div className="min-w-0">
              <span className="text-xs font-bold block">{result.headline}</span>
              <p className="text-[11px] opacity-90 leading-relaxed break-words">{result.details}</p>
            </div>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {result.levels.map(l => {
              const ls = LEVEL_STYLE[l.status];
              return (
                <li key={l.key} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-black/20 border border-white/[0.06] min-w-0">
                  <span className="min-w-0">
                    <span className="text-[11px] text-slate-200 font-semibold block">{l.label}</span>
                    <span className="text-[11px] font-mono text-slate-400 block break-words">{l.low === l.high ? fmt(l.low) : `${fmt(l.low)} to ${fmt(l.high)}`}</span>
                    <span className="text-[10px] text-slate-500 block break-words">{l.note}</span>
                  </span>
                  <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap shrink-0 ${ls.cls}`}>{ls.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
