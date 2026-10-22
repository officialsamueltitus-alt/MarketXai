import React, { useEffect, useRef, useState } from 'react';
import { Activity, Scale, TrendingDown, TrendingUp } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

// Buyers vs sellers (owner-specified, information only): who is in control of the market right now. Read live from the
// server on its own (GET /api/pressure) and refreshed every 15 seconds while the card is on screen. It is never part of
// the analysis or the signal.

interface PressureRead {
  symbol: string;
  buyers: number;
  sellers: number;
  side: 'BUYERS' | 'SELLERS' | 'BALANCED';
  strength: 'STRONG' | 'CLEAR' | 'SLIGHT' | 'EVEN';
  label: string;
  recentBuyers: number;
  momentum: 'BUYERS_GAINING' | 'SELLERS_GAINING' | 'STEADY';
  changePct: number;
  method: 'ORDER_FLOW' | 'PRICE_ACTION';
  timeframe: '1M' | '5M';
  windowMinutes: number;
  lastBarAt: number;
  quiet: boolean;
  asOf: number;
}

const REFRESH_MS = 15_000;

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 5 ? 'just now' : s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
};

export const PressureMeter: React.FC<{ symbol: string }> = React.memo(({ symbol }) => {
  const box = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<PressureRead | null>(null);
  const [failed, setFailed] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [, setTick] = useState(0);

  // Only cards on screen read live (old cards in a long chat stay quiet until scrolled back to)
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setOnScreen(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!onScreen || !symbol) return;
    let stop = false;
    let timer = 0;
    const load = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const r = await apiFetch<{ pressure: PressureRead }>(`/api/pressure?symbol=${encodeURIComponent(symbol)}`, { timeoutMs: 10_000 });
          if (stop) return;
          setData(r.pressure);
          setFailed(false);
        } catch {
          if (!stop) setFailed(true);
        }
      }
      if (!stop) timer = window.setTimeout(load, REFRESH_MS);
    };
    load();
    const onShow = () => {
      if (document.visibilityState === 'visible') {
        window.clearTimeout(timer);
        load();
      }
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [onScreen, symbol]);

  // "updated 12s ago" stays current
  useEffect(() => {
    if (!data || !onScreen) return;
    const t = window.setInterval(() => setTick(x => x + 1), 5000);
    return () => window.clearInterval(t);
  }, [data, onScreen]);

  const buyers = data?.buyers ?? 50;
  const tone = data?.side === 'BUYERS' ? 'text-emerald-300' : data?.side === 'SELLERS' ? 'text-rose-300' : 'text-slate-200';
  const Icon = data?.side === 'BUYERS' ? TrendingUp : data?.side === 'SELLERS' ? TrendingDown : Scale;

  return (
    <div ref={box} className="p-3 rounded-xl bg-white/[0.025] border border-white/[0.08] font-sans" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-mono font-bold text-slate-300">
          <Activity className="w-3.5 h-3.5 text-violet-300" />
          Buyers vs Sellers
        </span>
        <span className="inline-flex items-center gap-1.5 text-[10px] text-slate-500 shrink-0">
          {data && !data.quiet && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />}
          {data ? (data.quiet ? 'Market quiet' : `Live · ${ago(Date.now() - data.asOf)}`) : failed ? 'Unavailable' : 'Reading live…'}
        </span>
      </div>

      {failed && !data ? (
        <p className="mt-2 text-[11px] text-slate-500">Live buying and selling pressure can't be read for this market right now.</p>
      ) : (
        <>
          <div className="mt-2.5 flex items-center justify-between text-[11px] font-mono font-semibold">
            <span className="text-emerald-300">Buyers {data ? `${data.buyers}%` : '–'}</span>
            <span className="text-rose-300">{data ? `${data.sellers}%` : '–'} Sellers</span>
          </div>
          <div className="mt-1 relative h-2.5 rounded-full overflow-hidden bg-rose-500/70" role="img" aria-label={data ? `Buyers ${data.buyers}%, sellers ${data.sellers}%` : 'Reading live pressure'}>
            <div
              className={`absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500 to-emerald-400 transition-[width] duration-700 ease-out ${data ? '' : 'opacity-40'}`}
              style={{ width: `${buyers}%` }}
            />
            <div className="absolute inset-y-0 left-1/2 w-px bg-black/40" aria-hidden="true" />
          </div>
          {data && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={`inline-flex items-center gap-1 text-xs font-semibold ${tone}`}>
                <Icon className="w-3.5 h-3.5" />
                {data.label}
              </span>
              {data.momentum !== 'STEADY' && (
                <span className={`text-[11px] ${data.momentum === 'BUYERS_GAINING' ? 'text-emerald-300/90' : 'text-rose-300/90'}`}>
                  {data.momentum === 'BUYERS_GAINING' ? '▲ Buyers gaining' : '▼ Sellers gaining'} · last 15 min {data.recentBuyers}% buying
                </span>
              )}
            </div>
          )}
          <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
            {data
              ? `Last ${data.windowMinutes} min of ${data.timeframe === '1M' ? '1-minute' : '5-minute'} candles${data.method === 'ORDER_FLOW' ? ', market buy vs sell volume' : ''} (${data.changePct > 0 ? '+' : ''}${data.changePct}%). `
              : ''}
            {data?.quiet ? `No trading since ${new Date(data.lastBarAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. ` : ''}
            For information only, it does not change the signal.
          </p>
        </>
      )}
    </div>
  );
});
