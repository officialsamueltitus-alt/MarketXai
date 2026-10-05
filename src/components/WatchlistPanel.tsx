import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, BellRing, Check, Loader2, Mail, Plus, Radar, RefreshCw, Search, Sparkles, Trash2, Wand2, Layers, Volume2, VolumeX } from 'lucide-react';
import type { WatchItem } from '../types';
import { apiFetch } from '../utils/apiClient';
import { formatMarketPrice } from '../utils/formatPrice';
import { SUPPORTED_TIMEFRAMES } from '../utils/timeframe';
import { playChime, setWatchSound, watchSoundOn } from '../utils/notifySound';
import { PushToggle } from './PushToggle';
import { PluginIntro, PluginSheet, ago } from './PluginSheet';

interface WatchlistPanelProps {
  isOpen: boolean;
  onClose: () => void;
  enabled: boolean;
  /** Turns the watchlist on or off (shared with Connectors) */
  onSetEnabled: (enabled: boolean) => Promise<void>;
  /** Opens an analysis of a watched pair */
  onAnalyze: (symbol: string, timeframe: string) => void;
  onToast: (message: string, type?: 'success' | 'info') => void;
  /** The pair a notification or email link points at: scrolled into view and highlighted */
  focusId?: string | null;
}

// Every timeframe the engine supports, plus RDM (scan them all)
const TIMEFRAMES: Array<{ id: string; label: string }> = [
  { id: 'RDM', label: 'RDM' },
  ...SUPPORTED_TIMEFRAMES.map(id => ({ id, label: id.endsWith('M') ? id.toLowerCase() : id })),
];
type Verify = { step: 0 | 1 | 2 | 3; symbol?: string; price?: number; error?: string };
const VERIFY_STEPS = ['Finding the market', 'Checking live price', 'Checking live chart data', 'Added, scanning for setups'];

const STATUS: Record<WatchItem['status'], { label: string; pill: string; dot: string }> = {
  SETUP: { label: 'Setup ready', pill: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', dot: 'bg-emerald-400 shadow-[0_0_0_4px_rgba(52,211,153,.18)] animate-pulse' },
  BUILDING: { label: 'Building', pill: 'bg-amber-500/15 text-amber-300 border-amber-500/30', dot: 'bg-amber-400 shadow-[0_0_0_4px_rgba(251,191,36,.15)]' },
  WAITING: { label: 'Watching', pill: 'bg-white/[0.05] text-slate-300 border-white/[0.08]', dot: 'bg-sky-400' },
  SCANNING: { label: 'Scanning', pill: 'bg-violet-500/15 text-violet-300 border-violet-500/30', dot: 'bg-violet-400 animate-pulse' },
  NO_DATA: { label: 'No data', pill: 'bg-rose-500/10 text-rose-300 border-rose-500/25', dot: 'bg-rose-400' },
};

export const WatchlistPanel: React.FC<WatchlistPanelProps> = ({ isOpen, onClose, enabled, onSetEnabled, onAnalyze, onToast, focusId }) => {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [max, setMax] = useState(12);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [timeframe, setTimeframe] = useState('RDM');
  const [verify, setVerify] = useState<Verify | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [sound, setSound] = useState(watchSoundOn);
  const toggleSound = () => {
    const on = !sound;
    setSound(on);
    setWatchSound(on);
    if (on) playChime('ready', true);
  };
  const [, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ enabled: boolean; items: WatchItem[]; max: number }>('/api/watchlist');
      setItems(data.items || []);
      setMax(data.max || 12);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && enabled) load();
  }, [isOpen, enabled, load]);
  // While the panel is open: labels stay fresh, and pairs being scanned are picked up as soon as they finish
  const scanning = items.some(i => i.active && i.status === 'SCANNING');
  const focusListed = !!focusId && items.some(i => i.id === focusId);
  useEffect(() => {
    if (!isOpen || !focusListed) return;
    const t = setTimeout(() => document.getElementById(`watch-item-${focusId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
    return () => clearTimeout(t);
  }, [isOpen, focusListed, focusId]);
  useEffect(() => {
    if (!isOpen || !enabled) return;
    const t = setInterval(() => {
      setTick(x => x + 1);
      if (!document.hidden) load();
    }, scanning ? 5000 : 30000);
    return () => clearInterval(t);
  }, [isOpen, enabled, scanning, load]);

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

  const add = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q || (verify && !verify.error && verify.step < 3)) return;
    // The checks run on the server in one request; the steps show what it is doing
    setVerify({ step: 0 });
    const t1 = setTimeout(() => setVerify(v => (v && !v.error && v.step === 0 ? { ...v, step: 1 } : v)), 700);
    const t2 = setTimeout(() => setVerify(v => (v && !v.error && v.step === 1 ? { ...v, step: 2 } : v)), 1600);
    try {
      const data = await apiFetch<{ item: WatchItem; verified: { symbol: string; price: number }; items: WatchItem[]; max: number }>('/api/watchlist', {
        method: 'POST',
        body: JSON.stringify({ query: q, timeframe }),
        timeoutMs: 30000,
      });
      setItems(data.items || []);
      setVerify({ step: 3, symbol: data.verified.symbol, price: data.verified.price });
      setQuery('');
      setTimeout(() => setVerify(v => (v?.step === 3 ? null : v)), 3500);
    } catch (err: any) {
      setVerify({ step: 0, error: err?.message || 'Could not add that pair. Please try again.' });
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
    }
  };

  const changeTf = (id: string, tf: string) =>
    run(id, async () => {
      const data = await apiFetch<{ items: WatchItem[] }>(`/api/watchlist/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ timeframe: tf }) });
      setItems(data.items || []);
      setEditing(null);
    });
  const scanNow = (id: string) =>
    run(`scan:${id}`, async () => {
      const data = await apiFetch<{ items: WatchItem[] }>(`/api/watchlist/${encodeURIComponent(id)}/scan`, { method: 'POST', body: '{}', timeoutMs: 60000 });
      setItems(data.items || []);
    });
  const remove = (id: string) =>
    run(`del:${id}`, async () => {
      const data = await apiFetch<{ items: WatchItem[] }>(`/api/watchlist/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setItems(data.items || []);
    });

  const setups = items.filter(i => i.status === 'SETUP').length;
  const building = items.filter(i => i.status === 'BUILDING').length;
  const verifying = !!verify && !verify.error && verify.step < 3;

  const toolbar = enabled ? (
    <div className="px-4 pb-3">
      <form onSubmit={add} className="rounded-2xl bg-white/[0.035] border border-white/[0.08] p-2 focus-within:border-violet-400/40 transition-colors">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4 text-slate-500 ml-1.5 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              if (verify?.error) setVerify(null);
            }}
            placeholder="Add a pair: EURUSD, gold, BTC, $WIF…"
            aria-label="Pair to watch"
            maxLength={80}
            disabled={verifying}
            className="flex-1 min-w-0 h-9 bg-transparent text-sm text-white placeholder:text-slate-500 outline-none"
          />
          <button
            type="submit"
            disabled={!query.trim() || verifying || items.length >= max}
            className="h-9 px-3.5 rounded-xl bg-gradient-to-r from-violet-500 to-sky-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:brightness-110 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Add
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label="Timeframe to scan">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.id}
              type="button"
              role="radio"
              aria-checked={timeframe === tf.id}
              onClick={() => setTimeframe(tf.id)}
              title={tf.id === 'RDM' ? 'Scan every timeframe' : `Scan the ${tf.id}`}
              className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold shrink-0 inline-flex items-center gap-1 transition cursor-pointer ${
                timeframe === tf.id ? 'bg-white text-slate-900' : 'bg-white/[0.04] text-slate-400 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              {tf.id === 'RDM' && <Layers className="w-3 h-3" />}
              {tf.label}
            </button>
          ))}
        </div>
      </form>
      <button
        type="button"
        role="switch"
        aria-checked={sound}
        onClick={toggleSound}
        className="mt-2 w-full flex items-center gap-2.5 px-3 h-10 rounded-xl bg-white/[0.025] border border-white/[0.06] text-left cursor-pointer hover:bg-white/[0.05] transition-colors"
      >
        {sound ? <Volume2 className="w-4 h-4 text-violet-300 shrink-0" /> : <VolumeX className="w-4 h-4 text-slate-500 shrink-0" />}
        <span className="text-xs text-slate-300">Sound when a setup is found</span>
        <span className="ml-auto text-[10px] text-slate-500 hidden sm:inline">while MarketX is open</span>
        <span className={`relative ml-auto sm:ml-0 w-9 h-5 rounded-full transition-colors shrink-0 ${sound ? 'bg-violet-500' : 'bg-white/[0.12]'}`} aria-hidden="true">
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${sound ? 'left-[18px]' : 'left-0.5'}`} />
        </span>
      </button>
      <PushToggle what="setups" onToast={onToast} />
      {verify && (
        <div className={`mt-2 rounded-2xl border px-3 py-2.5 mx-fade-in ${verify.error ? 'bg-rose-500/[0.06] border-rose-500/20' : 'bg-white/[0.025] border-white/[0.06]'}`} aria-live="polite">
          {verify.error ? (
            <p className="text-xs text-rose-200 leading-relaxed">{verify.error}</p>
          ) : (
            <ol className="space-y-1.5">
              {VERIFY_STEPS.map((label, i) => {
                const done = verify.step > i || verify.step === 3;
                const now = verify.step === i && verify.step < 3;
                return (
                  <li key={label} className={`flex items-center gap-2 text-xs ${done ? 'text-slate-200' : now ? 'text-white' : 'text-slate-600'}`}>
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500/20 text-emerald-300' : now ? 'text-violet-300' : 'bg-white/[0.04]'}`}>
                      {done ? <Check className="w-3 h-3" /> : now ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    </span>
                    {i === 3 && verify.step === 3 && verify.symbol ? (
                      <span>
                        <span className="font-mono font-semibold text-white">{verify.symbol}</span> added at{' '}
                        <span className="font-mono">{formatMarketPrice(verify.price || 0)}</span>, scanning for setups
                      </span>
                    ) : (
                      label
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  ) : undefined;

  return (
    <PluginSheet
      isOpen={isOpen}
      onClose={onClose}
      label="Watchlist"
      title="Watchlist"
      subtitle={enabled ? `${items.filter(i => i.active).length} of ${max} pairs · scanning 24/7` : 'Setups found for you, around the clock'}
      icon={Radar}
      gradient="from-violet-500/25 to-sky-500/25"
      iconTone="text-violet-200"
      enabled={enabled}
      switching={busy === 'off'}
      onSwitchOff={() => run('off', () => onSetEnabled(false))}
      toolbar={toolbar}
    >
      {!enabled ? (
        <PluginIntro
          icon={Radar}
          glow="bg-violet-400/20"
          ring="from-violet-400/30 to-sky-500/30"
          title="Turn on your watchlist"
          text="Approve MarketX to watch the pairs you add on your account. It scans them on its own, all day, and tells you when a setup is building or ready."
          points={[
            { icon: Activity, tone: 'text-sky-300 bg-sky-500/10', t: 'Live data checked first', d: 'Each pair is added only once its live price and chart are confirmed' },
            { icon: Radar, tone: 'text-violet-300 bg-violet-500/10', t: 'Scans on its own', d: 'Your timeframe, or RDM to scan every timeframe' },
            { icon: Sparkles, tone: 'text-emerald-300 bg-emerald-500/10', t: 'Setups building or ready', d: 'Supply and demand zones in the right part of the range' },
            { icon: Mail, tone: 'text-amber-300 bg-amber-500/10', t: 'In your notifications and by email', d: 'Each setup is sent once, never repeated' },
          ]}
          cta="Approve watchlist"
          ctaGradient="from-violet-500 to-sky-500"
          busy={busy === 'on'}
          onApprove={() => run('on', () => onSetEnabled(true))}
          onLater={onClose}
          footnote="You choose the pairs. Switch it off any time in Settings, Connectors."
        />
      ) : loading && !items.length ? (
        <div className="py-16 flex justify-center text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : !items.length ? (
        <div className="py-12 text-center px-6">
          <span className="mx-auto w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center">
            <Radar className="w-5 h-5 text-violet-300" />
          </span>
          <p className="mt-3 text-sm font-medium text-slate-200">Your watchlist is on</p>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">Add a pair above and pick a timeframe. Choose <span className="text-white font-medium">RDM</span> to have every timeframe scanned.</p>
          <button type="button" onClick={() => inputRef.current?.focus()} className="mt-4 h-9 px-4 rounded-xl bg-white/[0.06] text-xs font-medium text-white hover:bg-white/[0.1] cursor-pointer">
            Add your first pair
          </button>
        </div>
      ) : (
        <div className="pt-3">
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              { k: 'Ready', v: setups, tone: 'text-emerald-300' },
              { k: 'Building', v: building, tone: 'text-amber-300' },
              { k: 'Watching', v: items.filter(i => i.active).length, tone: 'text-white' },
            ].map(s => (
              <div key={s.k} className="rounded-2xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5">
                <div className={`text-lg font-semibold tabular-nums ${s.tone}`}>{s.v}</div>
                <div className="text-[10px] uppercase tracking-wider text-slate-500">{s.k}</div>
              </div>
            ))}
          </div>
          <div className="space-y-2.5">
            {items.map(i => {
              const st = STATUS[i.active ? i.status : 'WAITING'];
              const setup = i.setup;
              const long = setup?.direction === 'LONG';
              return (
                <div key={i.id} id={`watch-item-${i.id}`} className={`p-3.5 rounded-2xl border transition-colors ${i.id === focusId ? 'ring-2 ring-violet-400/70 shadow-[0_0_40px_-8px_rgba(167,139,250,.6)] ' : ''}${i.status === 'SETUP' ? 'bg-emerald-500/[0.04] border-emerald-500/20' : 'bg-white/[0.035] border-white/[0.08]'} ${i.active ? '' : 'opacity-60'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${st.dot}`} aria-hidden="true" />
                    <span className="text-sm font-semibold text-white font-mono truncate">{i.symbol}</span>
                    <button
                      type="button"
                      onClick={() => setEditing(editing === i.id ? null : i.id)}
                      aria-label={`Change the ${i.symbol} timeframe`}
                      title="Change timeframe"
                      className="h-5 px-1.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[10px] font-mono text-slate-300 inline-flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      {i.timeframe === 'RDM' && <Layers className="w-2.5 h-2.5" />}
                      {i.timeframe}
                    </button>
                    <span className={`h-5 px-2 rounded-full border text-[10px] font-semibold inline-flex items-center shrink-0 ${st.pill}`}>{i.active ? st.label : 'Paused'}</span>
                    <span className="ml-auto text-sm font-mono text-slate-200 tabular-nums truncate">{i.price ? formatMarketPrice(i.price) : ''}</span>
                  </div>
                  {editing === i.id && (
                    <div className="mt-2 flex flex-wrap gap-1 mx-fade-in" role="radiogroup" aria-label={`Timeframe for ${i.symbol}`}>
                      {TIMEFRAMES.map(tf => (
                        <button
                          key={tf.id}
                          type="button"
                          role="radio"
                          aria-checked={tf.id === i.timeframe}
                          disabled={busy === i.id}
                          onClick={() => tf.id !== i.timeframe && changeTf(i.id, tf.id)}
                          className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold shrink-0 cursor-pointer ${tf.id === i.timeframe ? 'bg-white text-slate-900' : 'bg-white/[0.04] text-slate-400 hover:text-white'}`}
                        >
                          {tf.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">{i.statusText}</p>
                  {setup && i.active && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className={`h-5 px-2 rounded-full text-[10px] font-bold inline-flex items-center ${long ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{long ? 'BUY' : 'SELL'}</span>
                      <span className="h-5 px-1.5 rounded-md bg-white/[0.06] text-[10px] font-mono text-slate-300 inline-flex items-center">{setup.timeframe}</span>
                      <span className="text-[11px] text-slate-500">Quality {setup.score}/100 · {setup.distancePct.toFixed(setup.distancePct < 1 ? 2 : 1)}% away · {ago(setup.foundAt)}</span>
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        // The card refreshes in the background, so it matches the plan the analysis serves now
                        if (i.status === 'SETUP' && i.active) {
                          apiFetch(`/api/watchlist/${encodeURIComponent(i.id)}/scan`, { method: 'POST', body: '{}', timeoutMs: 60000 }).catch(() => {});
                        }
                        onAnalyze(i.symbol, setup?.timeframe || (i.timeframe === 'RDM' ? 'RDM' : i.timeframe));
                      }}
                      className={`h-8 px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                        i.status === 'SETUP' ? 'bg-gradient-to-r from-emerald-500 to-sky-500 text-white hover:brightness-110' : 'bg-white/[0.06] text-white hover:bg-white/[0.1]'
                      }`}
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      {i.status === 'SETUP' ? 'Get the plan' : 'Analyze'}
                    </button>
                    {i.active && (
                      <button
                        type="button"
                        onClick={() => scanNow(i.id)}
                        disabled={busy === `scan:${i.id}` || i.status === 'SCANNING'}
                        className="h-8 px-2.5 rounded-xl bg-white/[0.04] text-xs text-slate-300 hover:text-white hover:bg-white/[0.08] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${busy === `scan:${i.id}` || i.status === 'SCANNING' ? 'animate-spin' : ''}`} />
                        Scan now
                      </button>
                    )}
                    <span className="ml-auto min-w-0 text-[10px] text-slate-500 truncate">{i.scannedAt ? ago(i.scannedAt) : 'Not scanned yet'}</span>
                    <button
                      type="button"
                      onClick={() => remove(i.id)}
                      disabled={busy === `del:${i.id}`}
                      aria-label={`Remove ${i.symbol}`}
                      title="Remove from watchlist"
                      className="w-8 h-8 -mr-1 rounded-full text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 flex items-center justify-center cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {busy === `del:${i.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
            <BellRing className="w-3 h-3" /> New setups arrive in your notifications and by email
          </p>
        </div>
      )}
    </PluginSheet>
  );
};

export default WatchlistPanel;
