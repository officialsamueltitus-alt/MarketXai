import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, BellRing, Check, ChevronDown, Flame, Loader2, NotebookPen, Plus, Target, Trash2, TrendingUp, X, Zap } from 'lucide-react';
import type { JournalStats, JournalTrade } from '../types';
import { apiFetch } from '../utils/apiClient';
import { formatMarketPrice } from '../utils/formatPrice';
import { PluginIntro, PluginSheet, ago } from './PluginSheet';

interface TradeJournalPanelProps {
  isOpen: boolean;
  onClose: () => void;
  enabled: boolean;
  onSetEnabled: (enabled: boolean) => Promise<void>;
  onToast: (message: string, type?: 'success' | 'info') => void;
}

type Payload = { trades: JournalTrade[]; stats: JournalStats; max: number };
const EMPTY_FORM = { symbol: '', direction: 'LONG' as 'LONG' | 'SHORT', entry: '', stop: '', target: '', exit: '', pnl: '', timeframe: '', notes: '' };
const TFS = ['', '5M', '15M', '1H', '4H', '1D'];

const fmtR = (r: number | null) => (r === null ? '' : `${r > 0 ? '+' : ''}${r.toFixed(2)}R`);
const fmtMoney = (n: number | null) => (n === null ? '' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const num = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(/,/g, '')));

const Field: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; className?: string }> = ({ label, value, onChange, placeholder, mono = true, className = '' }) => (
  <label className={`block ${className}`}>
    <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-1">{label}</span>
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      inputMode={mono ? 'decimal' : 'text'}
      className={`w-full h-10 px-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-slate-600 outline-none focus:border-amber-400/40 ${mono ? 'font-mono' : ''}`}
    />
  </label>
);

export const TradeJournalPanel: React.FC<TradeJournalPanelProps> = ({ isOpen, onClose, enabled, onSetEnabled, onToast }) => {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM | null>(null);
  const [closing, setClosing] = useState<{ id: string; exit: string; pnl: string } | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiFetch<Payload>('/api/journal'));
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

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError('');
    setBusy('save');
    try {
      const body: Record<string, unknown> = {
        symbol: form.symbol,
        direction: form.direction,
        entry: num(form.entry),
        stop: num(form.stop),
        target: num(form.target),
        timeframe: form.timeframe,
        notes: form.notes,
      };
      if (form.exit.trim() || form.pnl.trim()) Object.assign(body, { exit: num(form.exit), pnl: num(form.pnl), status: 'CLOSED' });
      setData(await apiFetch<Payload>('/api/journal', { method: 'POST', body: JSON.stringify(body) }));
      setForm(null);
      onToast('Trade saved to your journal.', 'success');
    } catch (err: any) {
      setError(err?.message || 'Could not save the trade.');
    } finally {
      setBusy(null);
    }
  };

  const closeTrade = (e: React.FormEvent) => {
    e.preventDefault();
    if (!closing) return;
    const { id, exit, pnl } = closing;
    run(`close:${id}`, async () => {
      setData(await apiFetch<Payload>(`/api/journal/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status: 'CLOSED', exit: num(exit) ?? null, pnl: num(pnl) ?? null }) }));
      setClosing(null);
    });
  };
  const remove = (id: string) =>
    run(`del:${id}`, async () => {
      setData(await apiFetch<Payload>(`/api/journal/${encodeURIComponent(id)}`, { method: 'DELETE' }));
    });

  const s = data?.stats;
  const trades = (data?.trades || []).filter(t => filter === 'ALL' || t.status === filter);
  const set = (k: keyof typeof EMPTY_FORM) => (v: string) => setForm(f => (f ? { ...f, [k]: v } : f));

  const toolbar = enabled ? (
    <div className="px-4 pb-3">
      {!form ? (
        <button
          type="button"
          onClick={() => {
            setForm({ ...EMPTY_FORM });
            setError('');
          }}
          className="w-full h-11 rounded-2xl bg-gradient-to-r from-amber-500 to-rose-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 hover:brightness-110 cursor-pointer shadow-[0_12px_40px_-14px_rgba(245,158,11,.7)]"
        >
          <Plus className="w-4 h-4" /> Log a trade
        </button>
      ) : (
        <form onSubmit={save} className="rounded-2xl bg-white/[0.03] border border-white/[0.08] p-3 space-y-2.5 mx-fade-in">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white">New trade</span>
            <button type="button" onClick={() => setForm(null)} aria-label="Cancel" className="ml-auto w-7 h-7 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] flex items-center justify-center cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
            <Field label="Market" value={form.symbol} onChange={v => set('symbol')(v.toUpperCase())} placeholder="EURUSD" mono={false} />
            <div className="flex h-10 p-1 rounded-xl bg-white/[0.04] border border-white/[0.08]" role="radiogroup" aria-label="Direction">
              {(['LONG', 'SHORT'] as const).map(d => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={form.direction === d}
                  onClick={() => set('direction')(d)}
                  className={`px-3 rounded-lg text-xs font-bold cursor-pointer transition ${form.direction === d ? (d === 'LONG' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white') : 'text-slate-400 hover:text-white'}`}
                >
                  {d === 'LONG' ? 'Buy' : 'Sell'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Entry" value={form.entry} onChange={set('entry')} placeholder="0.00" />
            <Field label="Stop loss" value={form.stop} onChange={set('stop')} placeholder="optional" />
            <Field label="Target" value={form.target} onChange={set('target')} placeholder="optional" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Exit (if closed)" value={form.exit} onChange={set('exit')} placeholder="still open" />
            <Field label="P/L (if closed)" value={form.pnl} onChange={set('pnl')} placeholder="e.g. 120 or -45" />
          </div>
          <div>
            <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-1">Timeframe</span>
            <div className="flex gap-1 overflow-x-auto no-scrollbar">
              {TFS.map(tf => (
                <button key={tf || 'none'} type="button" onClick={() => set('timeframe')(tf)} className={`h-7 px-2.5 rounded-lg text-[11px] font-semibold shrink-0 cursor-pointer ${form.timeframe === tf ? 'bg-white text-slate-900' : 'bg-white/[0.04] text-slate-400 hover:text-white'}`}>
                  {tf || 'None'}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="block text-[10px] font-medium uppercase tracking-wider text-slate-500 mb-1">Notes</span>
            <textarea
              value={form.notes}
              onChange={e => set('notes')(e.target.value)}
              maxLength={600}
              rows={2}
              placeholder="Why you took it, how it went"
              className="w-full px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-slate-600 outline-none focus:border-amber-400/40 resize-none"
            />
          </label>
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <button type="submit" disabled={busy === 'save'} className="w-full h-10 rounded-xl bg-white text-slate-900 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-100 cursor-pointer disabled:opacity-60">
            {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save trade
          </button>
        </form>
      )}
    </div>
  ) : undefined;

  return (
    <PluginSheet
      isOpen={isOpen}
      onClose={onClose}
      label="Trade Journal"
      title="Trade Journal"
      subtitle={enabled ? (s ? `${s.total} trade${s.total === 1 ? '' : 's'} · ${s.open} open` : 'Your trades, in one place') : 'Log trades, learn what works'}
      icon={NotebookPen}
      gradient="from-amber-500/25 to-rose-500/25"
      iconTone="text-amber-200"
      enabled={enabled}
      switching={busy === 'off'}
      onSwitchOff={() => run('off', () => onSetEnabled(false))}
      toolbar={toolbar}
    >
      {!enabled ? (
        <PluginIntro
          icon={NotebookPen}
          glow="bg-amber-400/20"
          ring="from-amber-400/30 to-rose-500/30"
          title="Turn on your trade journal"
          text="Signals you watch with a price alert are logged and scored by themselves. Log your other trades by hand, and MarketX works out your win rate, R and best markets."
          points={[
            { icon: BellRing, tone: 'text-violet-300 bg-violet-500/10', t: 'Automatic from price alerts', d: 'Logged when you turn an alert on, scored once when it ends' },
            { icon: NotebookPen, tone: 'text-amber-300 bg-amber-500/10', t: 'Manual when you want', d: 'Market, direction, entry, stop and target' },
            { icon: Target, tone: 'text-emerald-300 bg-emerald-500/10', t: 'Results scored for you', d: 'Win, loss or break-even, and the R you made' },
            { icon: BarChart3, tone: 'text-sky-300 bg-sky-500/10', t: 'Stats that teach', d: 'Win rate, total R, P/L, streaks and best markets' },
          ]}
          cta="Turn on journal"
          ctaGradient="from-amber-500 to-rose-500"
          busy={busy === 'on'}
          onApprove={() => run('on', () => onSetEnabled(true))}
          onLater={onClose}
          footnote="Private to you. Turning it off keeps your trades."
        />
      ) : loading && !data ? (
        <div className="py-16 flex justify-center text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="pt-3 space-y-4">
          {s && s.total > 0 && (
            <>
              <div className="rounded-2xl p-4 bg-gradient-to-br from-amber-500/[0.10] via-white/[0.02] to-rose-500/[0.08] border border-white/[0.08]">
                <div className="flex items-end gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">Win rate</div>
                    <div className="text-3xl font-semibold text-white tabular-nums">{s.winRate === null ? '–' : `${s.winRate}%`}</div>
                  </div>
                  <div className="pb-1 text-xs text-slate-400">
                    <span className="text-emerald-300 font-semibold">{s.wins}W</span> · <span className="text-rose-300 font-semibold">{s.losses}L</span>
                    {s.breakeven > 0 && <> · {s.breakeven} BE</>}
                  </div>
                  {s.streak && s.streak.count > 1 && (
                    <span className={`ml-auto mb-1 h-6 px-2 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 ${s.streak.kind === 'WIN' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                      <Flame className="w-3 h-3" /> {s.streak.count} {s.streak.kind === 'WIN' ? 'wins' : 'losses'} in a row
                    </span>
                  )}
                </div>
                {s.winRate !== null && (
                  <div className="mt-3 h-1.5 rounded-full bg-rose-500/30 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300 transition-[width] duration-700" style={{ width: `${s.winRate}%` }} />
                  </div>
                )}
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  {[
                    { k: 'Total R', v: s.totalR === null ? '–' : fmtR(s.totalR), tone: (s.totalR || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300' },
                    { k: 'Avg R', v: s.avgR === null ? '–' : fmtR(s.avgR), tone: (s.avgR || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300' },
                    { k: 'P/L', v: s.pnl === null ? '–' : fmtMoney(s.pnl), tone: (s.pnl || 0) >= 0 ? 'text-emerald-300' : 'text-rose-300' },
                  ].map(x => (
                    <div key={x.k} className="rounded-xl bg-black/20 py-2">
                      <div className={`text-sm font-semibold font-mono tabular-nums ${x.tone}`}>{x.v}</div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">{x.k}</div>
                    </div>
                  ))}
                </div>
              </div>
              {s.markets.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
                  {s.markets.map(m => (
                    <span key={m.symbol} className="h-7 px-2.5 rounded-full bg-white/[0.04] border border-white/[0.07] text-[11px] text-slate-300 inline-flex items-center gap-1.5 shrink-0">
                      {m.symbol === s.bestMarket && <TrendingUp className="w-3 h-3 text-emerald-300" />}
                      <span className="font-mono font-semibold text-white">{m.symbol}</span> {m.winRate}% · {m.trades}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {data && data.trades.length > 0 ? (
            <div>
              <div className="flex items-center gap-1 pb-2">
                {(['ALL', 'OPEN', 'CLOSED'] as const).map(f => (
                  <button key={f} type="button" onClick={() => setFilter(f)} className={`h-7 px-2.5 rounded-full text-[11px] font-medium cursor-pointer ${filter === f ? 'bg-white/[0.1] text-white' : 'text-slate-500 hover:text-white'}`}>
                    {f === 'ALL' ? 'All' : f === 'OPEN' ? `Open · ${s?.open || 0}` : `Closed · ${s?.closed || 0}`}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                {trades.map(t => {
                  const long = t.direction === 'LONG';
                  const res = t.result;
                  const auto = t.source === 'AUTO' ? t.auto : undefined;
                  // Auto trades are closed by their price alert; only a handed-over one is closed by hand
                  const canClose = t.status === 'OPEN' && (!auto || auto.state === 'HANDED_OVER');
                  return (
                    <div key={t.id} className="p-3 rounded-2xl bg-white/[0.035] border border-white/[0.08]">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white font-mono truncate">{t.symbol}</span>
                        <span className={`h-5 px-2 rounded-full text-[10px] font-bold inline-flex items-center ${long ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>{long ? 'BUY' : 'SELL'}</span>
                        {t.timeframe && <span className="h-5 px-1.5 rounded-md bg-white/[0.06] text-[10px] font-mono text-slate-300 inline-flex items-center">{t.timeframe}</span>}
                        {t.status === 'OPEN' ? (
                          <span className="h-5 px-2 rounded-full border border-sky-500/30 bg-sky-500/10 text-[10px] font-semibold text-sky-300 inline-flex items-center gap-1">
                            {auto?.state === 'TRACKING' && <span className="w-1.5 h-1.5 rounded-full bg-sky-300 animate-pulse" aria-hidden="true" />}
                            {auto?.state === 'TRACKING' ? 'Tracking' : 'Open'}
                          </span>
                        ) : (
                          <span className={`h-5 px-2 rounded-full text-[10px] font-semibold inline-flex items-center ${res === 'WIN' ? 'bg-emerald-500/15 text-emerald-300' : res === 'LOSS' ? 'bg-rose-500/15 text-rose-300' : 'bg-white/[0.06] text-slate-300'}`}>
                            {res === 'WIN' ? 'Win' : res === 'LOSS' ? 'Loss' : res === 'NO_FILL' ? 'No fill' : 'Break-even'}
                          </span>
                        )}
                        {auto && (
                          <span title="Logged and scored automatically from your price alert" className="h-5 px-1.5 rounded-md bg-violet-500/15 border border-violet-500/25 text-[10px] font-semibold text-violet-200 inline-flex items-center gap-1">
                            <Zap className="w-2.5 h-2.5" /> Auto
                          </span>
                        )}
                        {t.userStrategy && (
                          <span title={`Found with your personal strategy: ${t.userStrategy}`} className="h-5 px-1.5 rounded-md bg-fuchsia-500/10 border border-fuchsia-400/25 text-[10px] font-semibold text-fuchsia-200 inline-flex items-center max-w-[9rem] truncate">
                            Personal strategy
                          </span>
                        )}
                        <span className="ml-auto text-xs font-mono tabular-nums text-right">
                          {t.r !== null && <span className={t.r >= 0 ? 'text-emerald-300' : 'text-rose-300'}>{fmtR(t.r)}</span>}
                          {t.pnl !== null && <span className={`ml-1.5 ${t.pnl >= 0 ? 'text-emerald-300/80' : 'text-rose-300/80'}`}>{fmtMoney(t.pnl)}</span>}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500 font-mono">
                        <span>Entry <span className="text-slate-300">{formatMarketPrice(t.entry)}</span></span>
                        {t.stop !== null && <span>SL <span className="text-slate-300">{formatMarketPrice(t.stop)}</span></span>}
                        {t.target !== null && <span>TP <span className="text-slate-300">{formatMarketPrice(t.target)}</span></span>}
                        {t.exit !== null && <span>Exit <span className="text-slate-300">{formatMarketPrice(t.exit)}</span></span>}
                      </div>
                      {auto?.summary && (
                        <p className={`mt-1.5 text-xs leading-relaxed ${auto.state === 'DONE' ? 'text-slate-300' : 'text-slate-400'}`}>
                          {auto.state === 'DONE' && auto.tpsHit > 0 && (
                            <span className="inline-flex gap-0.5 mr-1.5 align-middle" aria-label={`${auto.tpsHit} of ${auto.targets.length} targets`}>
                              {auto.targets.map((_, i) => (
                                <span key={i} className={`w-1.5 h-3 rounded-sm ${i < auto.tpsHit ? 'bg-emerald-400' : 'bg-white/[0.1]'}`} />
                              ))}
                            </span>
                          )}
                          {auto.summary}
                        </p>
                      )}
                      {t.notes && <p className="mt-1.5 text-xs text-slate-400 leading-relaxed line-clamp-2">{t.notes}</p>}
                      {closing?.id === t.id ? (
                        <form onSubmit={closeTrade} className="mt-2.5 flex items-end gap-2 mx-fade-in">
                          <Field label="Exit price" value={closing.exit} onChange={v => setClosing(c => (c ? { ...c, exit: v } : c))} placeholder="0.00" className="flex-1" />
                          <Field label="or P/L" value={closing.pnl} onChange={v => setClosing(c => (c ? { ...c, pnl: v } : c))} placeholder="e.g. 80" className="flex-1" />
                          <button type="submit" aria-label={`Close the ${t.symbol} trade`} disabled={busy === `close:${t.id}` || (!closing.exit.trim() && !closing.pnl.trim())} className="h-10 px-3 rounded-xl bg-white text-slate-900 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50">
                            {busy === `close:${t.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Close
                          </button>
                        </form>
                      ) : (
                        <div className="mt-2 flex items-center gap-1.5">
                          {canClose && (
                            <button type="button" onClick={() => setClosing({ id: t.id, exit: '', pnl: '' })} className="h-7 px-2.5 rounded-lg bg-white/[0.06] text-[11px] font-medium text-white hover:bg-white/[0.1] cursor-pointer inline-flex items-center gap-1 whitespace-nowrap">
                              <ChevronDown className="w-3 h-3" /> Close trade
                            </button>
                          )}
                          <span className="ml-auto text-[10px] text-slate-500">{t.status === 'CLOSED' && t.closedAt ? `Closed ${ago(t.closedAt)}` : `Opened ${ago(t.openedAt)}`}</span>
                          <button type="button" onClick={() => remove(t.id)} disabled={busy === `del:${t.id}`} aria-label={`Delete the ${t.symbol} trade`} title="Delete" className="w-7 h-7 -mr-1 rounded-full text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 flex items-center justify-center cursor-pointer disabled:opacity-50">
                            {busy === `del:${t.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {!trades.length && <p className="py-6 text-center text-xs text-slate-500">No {filter === 'OPEN' ? 'open' : 'closed'} trades.</p>}
              </div>
            </div>
          ) : (
            !form && (
              <div className="py-10 text-center px-6">
                <span className="mx-auto w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center">
                  <NotebookPen className="w-5 h-5 text-amber-300" />
                </span>
                <p className="mt-3 text-sm font-medium text-slate-200">Your journal is ready</p>
                <p className="mt-1 text-xs text-slate-500 leading-relaxed">Turn on a price alert on any signal and the trade lands here by itself, or log a trade by hand.</p>
              </div>
            )
          )}
        </div>
      )}
    </PluginSheet>
  );
};

export default TradeJournalPanel;
