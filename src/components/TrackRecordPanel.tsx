import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, Globe2, Loader2, RefreshCw, ShieldCheck, Trophy, User } from 'lucide-react';
import type { TrackRecordPayload, TrackRecordStats } from '../types';
import { apiFetch } from '../utils/apiClient';
import { PluginIntro, PluginSheet, ago } from './PluginSheet';

interface TrackRecordPanelProps {
  isOpen: boolean;
  onClose: () => void;
  enabled: boolean;
  onSetEnabled: (enabled: boolean) => Promise<void>;
  onOpenAlerts: () => void;
  onToast: (message: string, type?: 'success' | 'info') => void;
}

/** Win-rate ring with the number in the middle */
const Ring: React.FC<{ pct: number | null; size?: number }> = ({ pct, size = 104 }) => {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const v = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="mxRing" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.07)" strokeWidth="8" fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="url(#mxRing)" strokeWidth="8" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} className="transition-[stroke-dashoffset] duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold text-white tabular-nums">{pct === null ? '–' : `${pct}%`}</span>
        <span className="text-[9px] uppercase tracking-wider text-slate-500">Win rate</span>
      </div>
    </div>
  );
};

const TpBars: React.FC<{ s: TrackRecordStats }> = ({ s }) => (
  <div className="flex-1 min-w-0 space-y-2">
    {[
      { k: 'TP1', v: s.tp1Rate },
      { k: 'TP2', v: s.tp2Rate },
      { k: 'TP3', v: s.tp3Rate },
    ].map(x => (
      <div key={x.k}>
        <div className="flex justify-between text-[11px]">
          <span className="text-slate-400 font-medium">{x.k} reached</span>
          <span className="text-white font-mono tabular-nums">{x.v === null ? '–' : `${x.v}%`}</span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-400 transition-[width] duration-700" style={{ width: `${x.v || 0}%` }} />
        </div>
      </div>
    ))}
    <div className="pt-0.5 text-[11px] text-slate-500">
      <span className="text-emerald-300 font-semibold">{s.wins} wins</span> · <span className="text-rose-300 font-semibold">{s.losses} losses</span>
      {s.missed > 0 && <> · {s.missed} moved before entry</>}
    </div>
  </div>
);

export const TrackRecordPanel: React.FC<TrackRecordPanelProps> = ({ isOpen, onClose, enabled, onSetEnabled, onOpenAlerts, onToast }) => {
  const [data, setData] = useState<TrackRecordPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<'mine' | 'all'>('mine');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiFetch<TrackRecordPayload>('/api/track-record'));
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (isOpen && enabled) load();
  }, [isOpen, enabled, load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err: any) {
      onToast(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const stats = data ? (view === 'mine' ? data.stats : data.global) : null;
  const empty = !!data && !data.stats.signals && !data.live.length;

  return (
    <PluginSheet
      isOpen={isOpen}
      onClose={onClose}
      label="Track Record"
      title="Track Record"
      subtitle={enabled ? (data ? `${data.stats.signals} results · ${data.live.length} live` : 'How the signals played out') : 'Every signal, scored by the market'}
      icon={Trophy}
      gradient="from-emerald-500/25 to-sky-500/25"
      iconTone="text-emerald-200"
      enabled={enabled}
      switching={busy === 'off'}
      onSwitchOff={() => run('off', () => onSetEnabled(false))}
    >
      {!enabled ? (
        <PluginIntro
          icon={Trophy}
          glow="bg-emerald-400/20"
          ring="from-emerald-400/30 to-sky-500/30"
          title="See the track record"
          text="Every signal you watch with a price alert is scored by what price actually did: targets reached, stop hit, or moved before entry."
          points={[
            { icon: ShieldCheck, tone: 'text-emerald-300 bg-emerald-500/10', t: 'Scored by the market', d: 'Results come from live prices, never edited' },
            { icon: User, tone: 'text-sky-300 bg-sky-500/10', t: 'Your record', d: 'Win rate and TP1, TP2, TP3 hit rates' },
            { icon: Globe2, tone: 'text-violet-300 bg-violet-500/10', t: 'MarketX wide', d: 'How signals did across every trader' },
          ]}
          cta="Turn on track record"
          ctaGradient="from-emerald-500 to-sky-500"
          busy={busy === 'on'}
          onApprove={() => run('on', () => onSetEnabled(true))}
          onLater={onClose}
          footnote="Built from price alerts. Turning it off keeps your record."
        />
      ) : loading && !data ? (
        <div className="py-16 flex justify-center text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : !data ? (
        <div className="py-12 text-center text-xs text-slate-500">
          Could not load the track record.{' '}
          <button type="button" onClick={load} className="text-white underline cursor-pointer">
            Try again
          </button>
        </div>
      ) : (
        <div className="pt-3 space-y-4">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]" role="tablist">
            {([
              { id: 'mine', label: 'My signals', icon: User },
              { id: 'all', label: 'MarketX wide', icon: Globe2 },
            ] as const).map(t => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={view === t.id}
                onClick={() => setView(t.id)}
                className={`flex-1 h-8 rounded-lg text-xs font-medium inline-flex items-center justify-center gap-1.5 cursor-pointer transition ${view === t.id ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}
              >
                <t.icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
            <button type="button" onClick={load} disabled={loading} aria-label="Refresh" title="Refresh" className="w-8 h-8 rounded-lg text-slate-400 hover:text-white flex items-center justify-center cursor-pointer">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {view === 'mine' && empty ? (
            <div className="py-8 text-center px-6">
              <span className="mx-auto w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center">
                <Trophy className="w-5 h-5 text-emerald-300" />
              </span>
              <p className="mt-3 text-sm font-medium text-slate-200">No results yet</p>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">Tap <span className="text-white font-medium">Get price alert</span> on a signal. When it plays out, the result lands here.</p>
              <button type="button" onClick={onOpenAlerts} className="mt-4 h-9 px-4 rounded-xl bg-white/[0.06] text-xs font-medium text-white hover:bg-white/[0.1] cursor-pointer inline-flex items-center gap-1.5">
                <BellRing className="w-3.5 h-3.5" /> Open price alerts
              </button>
            </div>
          ) : stats && (
            <div className="rounded-2xl p-4 bg-gradient-to-br from-emerald-500/[0.09] via-white/[0.02] to-sky-500/[0.08] border border-white/[0.08]">
              <div className="flex items-center gap-4">
                <Ring pct={stats.winRate} />
                <TpBars s={stats} />
              </div>
              {stats.timeframes.length > 0 && (
                <div className="mt-3 flex gap-1.5 overflow-x-auto no-scrollbar">
                  {stats.timeframes.map(t => (
                    <span key={t.timeframe} className="h-7 px-2.5 rounded-full bg-black/20 text-[11px] text-slate-300 inline-flex items-center gap-1.5 shrink-0">
                      <span className="font-mono font-semibold text-white">{t.timeframe}</span> {t.winRate}% · {t.wins + t.losses}
                    </span>
                  ))}
                </div>
              )}
              {view === 'all' && (
                <p className="mt-3 text-[11px] text-slate-500">
                  {stats.signals ? `${stats.signals} results across MarketX traders${data.global.since ? ` since ${new Date(data.global.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}.` : 'No results across MarketX yet.'}
                </p>
              )}
            </div>
          )}

          {view === 'mine' && data.live.length > 0 && (
            <div>
              <div className="px-1 pb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">Playing out now</div>
              <div className="space-y-2">
                {data.live.map(l => (
                  <div key={l.id} className="flex items-center gap-2 p-3 rounded-2xl bg-white/[0.035] border border-white/[0.08]">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,.15)] animate-pulse shrink-0" aria-hidden="true" />
                    <span className="text-sm font-semibold text-white font-mono">{l.symbol}</span>
                    <span className={`h-5 px-2 rounded-full text-[10px] font-bold inline-flex items-center ${l.direction === 'LONG' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{l.direction === 'LONG' ? 'BUY' : 'SELL'}</span>
                    <span className="h-5 px-1.5 rounded-md bg-white/[0.06] text-[10px] font-mono text-slate-300 inline-flex items-center">{l.timeframe}</span>
                    <span className="ml-auto text-[11px] text-slate-400">{l.tpsHit ? `TP${l.tpsHit} hit` : l.entered ? 'In play' : 'Waiting for entry'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {view === 'mine' && data.entries.length > 0 && (
            <div>
              <div className="px-1 pb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">Results</div>
              <div className="rounded-2xl border border-white/[0.07] divide-y divide-white/[0.05] overflow-hidden">
                {data.entries.map(e => (
                  <div key={e.id} className="flex items-center gap-2 px-3 py-2.5 bg-white/[0.02]">
                    <span className="text-sm font-semibold text-white font-mono truncate">{e.symbol}</span>
                    <span className={`text-[10px] font-bold ${e.direction === 'LONG' ? 'text-emerald-300' : 'text-rose-300'}`}>{e.direction === 'LONG' ? 'BUY' : 'SELL'}</span>
                    <span className="text-[10px] font-mono text-slate-500">{e.timeframe}</span>
                    {e.outcome === 'WIN' && (
                      <span className="ml-auto flex gap-0.5" aria-label={`${e.tpsHit} of ${e.tpsTotal} targets`}>
                        {Array.from({ length: e.tpsTotal || 3 }, (_, i) => (
                          <span key={i} className={`w-1.5 h-3.5 rounded-sm ${i < e.tpsHit ? 'bg-emerald-400' : 'bg-white/[0.08]'}`} />
                        ))}
                      </span>
                    )}
                    <span
                      className={`${e.outcome === 'WIN' ? '' : 'ml-auto'} h-5 px-2 rounded-full text-[10px] font-semibold inline-flex items-center ${
                        e.outcome === 'WIN' ? 'bg-emerald-500/15 text-emerald-300' : e.outcome === 'LOSS' ? 'bg-rose-500/15 text-rose-300' : 'bg-white/[0.06] text-slate-400'
                      }`}
                    >
                      {e.outcome === 'WIN' ? `TP${e.tpsHit}` : e.outcome === 'LOSS' ? 'Stop' : 'Missed'}
                    </span>
                    <span className="w-14 text-right text-[10px] text-slate-500 shrink-0">{ago(e.closedAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="text-center text-[11px] text-slate-500">Results come from price alerts, checked against live prices.</p>
        </div>
      )}
    </PluginSheet>
  );
};

export default TrackRecordPanel;
