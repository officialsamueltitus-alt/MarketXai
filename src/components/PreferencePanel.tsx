import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, Check, Loader2, Shield, Crosshair, Wallet, LayoutList, AlignLeft, LineChart, RotateCcw, Zap, Hand, BellRing, Calculator, ScanSearch, Target, CandlestickChart, ChevronRight, Timer, Sun, CalendarRange, Infinity as InfinityIcon } from 'lucide-react';
import { TradeCalculator, type CalcSeed } from './TradeCalculator';
import { SUPPORTED_TIMEFRAMES } from '../utils/timeframe';
import { DEFAULT_PREFERENCES, formatMoney, type Currency, type Preferences } from '../utils/preferences';
import type { AlertMode } from '../types';
import { PluginSheet } from './PluginSheet';
import { RdmTimeframePicker } from './RdmTimeframePicker';
import { STYLE_FRAMES, STYLE_INFO, hasStyleChoice, styleFrames, styleFramesLabel, type TradeStyle } from '../utils/tradeStyle';

// /preference: the trader's own defaults (server/preferences.ts). Every change saves on its own.
interface PreferencePanelProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: Preferences;
  /** Saves a change (any subset); resolves with the saved preferences */
  onSave: (change: Partial<Preferences> | { reset: true }) => Promise<void>;
  /** RDM is Pro only after the free period */
  rdmLocked: boolean;
  /** Price alerts: shown when they are on */
  alertsEnabled: boolean;
  alertsMode: AlertMode | null;
  onSetAlertsMode: (mode: AlertMode) => Promise<void>;
  /** Opened from a trade card: the calculator is filled with that trade and scrolled into view */
  calcSeed?: CalcSeed | null;
}

const CURRENCIES: Currency[] = ['USD', 'NGN', 'EUR', 'GBP'];
const MARKETS: Array<{ id: Preferences['homeMarket']; label: string }> = [
  { id: 'all', label: 'All pairs' },
  { id: 'forex', label: 'Forex' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'stock', label: 'Equities' },
  { id: 'commodity', label: 'Commodities' },
];
const tfLabel = (tf: string) => (tf === 'RDM' ? 'RDM' : tf.replace(/^(\d+)M$/, '$1m'));

const Section: React.FC<{ icon: React.ElementType; title: string; text: string; children: React.ReactNode }> = ({ icon: Icon, title, text, children }) => (
  <section className="p-4 rounded-3xl bg-gradient-to-br from-white/[0.045] to-white/[0.015] border border-white/[0.08]">
    <div className="flex items-start gap-3">
      <span className="w-8 h-8 rounded-xl bg-white/[0.06] border border-white/[0.06] flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-slate-200" />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="text-xs text-slate-500 leading-relaxed">{text}</p>
      </div>
    </div>
    <div className="mt-3.5">{children}</div>
  </section>
);

const seg = (on: boolean) =>
  `h-8 px-3 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${on ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'}`;

export const PreferencePanel: React.FC<PreferencePanelProps> = ({ isOpen, onClose, preferences: p, onSave, rdmLocked, alertsEnabled, alertsMode, onSetAlertsMode, calcSeed }) => {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState(p.accountSize ? String(p.accountSize) : '');
  const [risk, setRisk] = useState(p.riskPct);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fields follow the saved values when they change elsewhere (or after a reset)
  useEffect(() => setAccount(p.accountSize ? String(p.accountSize) : ''), [p.accountSize]);
  useEffect(() => setRisk(p.riskPct), [p.riskPct]);
  useEffect(() => () => {
    if (debounce.current) clearTimeout(debounce.current);
  }, []);
  useEffect(() => {
    if (!isOpen || !calcSeed) return;
    const t = setTimeout(() => document.getElementById('mx-trade-calculator')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 250);
    return () => clearTimeout(t);
  }, [isOpen, calcSeed]);

  const save = async (change: Partial<Preferences> | { reset: true }) => {
    setState('saving');
    setError(null);
    try {
      await onSave(change);
      setState('saved');
      setTimeout(() => setState(s => (s === 'saved' ? 'idle' : s)), 1800);
    } catch (err: any) {
      setState('error');
      setError(err?.message || 'Could not save that change.');
    }
  };
  const saveLater = (change: Partial<Preferences>) => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => save(change), 600);
  };

  const accountNum = Number(account);
  const riskAmount = accountNum > 0 ? (accountNum * risk) / 100 : null;
  const isDefault = JSON.stringify({ ...p, updatedAt: undefined }) === JSON.stringify({ ...DEFAULT_PREFERENCES, updatedAt: undefined });

  return (
    <PluginSheet
      isOpen={isOpen}
      onClose={onClose}
      label="Preference Mode"
      title="Preference Mode"
      subtitle="Your defaults, everywhere in MarketX"
      icon={SlidersHorizontal}
      gradient="from-amber-500/25 to-rose-500/25"
      iconTone="text-amber-200"
      enabled={false}
      width="sm:w-[520px]"
      toolbar={
        <div className="px-5 pb-2 flex items-center gap-2 text-[11px] h-6" aria-live="polite">
          {state === 'saving' && (
            <span className="inline-flex items-center gap-1.5 text-slate-400">
              <Loader2 className="w-3 h-3 animate-spin" /> Saving…
            </span>
          )}
          {state === 'saved' && (
            <span className="inline-flex items-center gap-1.5 text-emerald-300">
              <Check className="w-3 h-3" /> Saved
            </span>
          )}
          {state === 'error' && <span className="text-rose-300">{error}</span>}
          {state === 'idle' && <span className="text-slate-500">Changes save on their own.</span>}
          {!isDefault && (
            <button type="button" onClick={() => save({ reset: true })} className="ml-auto inline-flex items-center gap-1 text-slate-400 hover:text-white cursor-pointer">
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          )}
        </div>
      }
    >
      <div className="pt-4 space-y-3">
        <Section icon={ScanSearch} title="Analysis mode" text="How MarketX decides a trade is ready. Used by every analysis and by your watchlist.">
          <div className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-2" role="radiogroup" aria-label="Analysis mode">
            {(
              [
                ['NORMAL', 'Normal', 'Signals a fresh, untouched zone ahead of price, with a limit entry. The way MarketX works by default.', Target, 'text-sky-300'],
                ['CONFIRMATION', 'Confirmation', 'Waits for price to reach the zone and prove it holds, then gives a market entry with a tighter stop.', CandlestickChart, 'text-emerald-300'],
              ] as const
            ).map(([id, title, text, Icon, tone]) => {
              const on = p.analysisMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => !on && save({ analysisMode: id })}
                  className={`relative p-3 rounded-2xl text-left border transition cursor-pointer ${
                    on ? (id === 'CONFIRMATION' ? 'bg-emerald-500/[0.07] border-emerald-400/50' : 'bg-white/[0.07] border-sky-400/50') : 'bg-black/20 border-white/[0.06] hover:bg-white/[0.05]'
                  }`}
                >
                  <span className="flex items-center justify-between">
                    <Icon className={`w-4 h-4 ${tone}`} />
                    <span
                      className={`w-4 h-4 rounded-full border flex items-center justify-center ${on ? (id === 'CONFIRMATION' ? 'border-emerald-400 bg-emerald-400' : 'border-sky-400 bg-sky-400') : 'border-white/20'}`}
                      aria-hidden="true"
                    >
                      {on && <Check className="w-2.5 h-2.5 text-slate-950" strokeWidth={3} />}
                    </span>
                  </span>
                  <span className="mt-1.5 block text-sm font-semibold text-white">{title}</span>
                  <span className="block text-[11px] text-slate-500 leading-snug">{text}</span>
                </button>
              );
            })}
          </div>
          {p.analysisMode === 'CONFIRMATION' && (
            <div className="mt-2.5 p-3 rounded-2xl bg-emerald-500/[0.04] border border-emerald-400/15 mx-fade-in">
              <div className="text-[11px] font-medium uppercase tracking-wider text-emerald-300/80 mb-2">How confirmation works</div>
              <ol className="space-y-1.5">
                {[
                  ['Zone found', 'MarketX finds the setup and its point of interest, as usual. No order yet.'],
                  ['Price confirms', 'When price reaches the zone, a lower timeframe must show it holding: a liquidity sweep or false breakout, an engulfing candle, a pin bar, a morning or evening star, or a structure break, checked with RSI.'],
                  ['Trade ready', 'Only then you get the entry and the alert, with the stop beyond the reaction wick (even after a wick-out or false breakout).'],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-emerald-400/15 text-emerald-200 text-[10px] font-bold flex items-center justify-center shrink-0 mt-px">{i + 1}</span>
                    <span className="min-w-0 text-[11px] leading-snug text-slate-400">
                      <span className="font-semibold text-slate-200">{t}.</span> {d}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-500">
                <ChevronRight className="w-3 h-3" /> Fewer trades, each one confirmed. Analyses say "waiting for confirmation" until price confirms.
              </p>
            </div>
          )}
        </Section>

        <Section icon={Timer} title="Trade type" text="The kind of trades you take. Every analysis, your personal strategy and your watchlist only give trades of this type.">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Trade type">
            {(
              [
                ['ANY', InfinityIcon, 'text-slate-300', 'border-white/30 bg-white/[0.06]'],
                ['SCALP', Zap, 'text-cyan-300', 'border-cyan-400/50 bg-cyan-500/[0.07]'],
                ['DAY', Sun, 'text-amber-300', 'border-amber-400/50 bg-amber-500/[0.07]'],
                ['SWING', CalendarRange, 'text-fuchsia-300', 'border-fuchsia-400/50 bg-fuchsia-500/[0.07]'],
              ] as const
            ).map(([id, Icon, tone, onTone]) => {
              const on = (p.tradeStyle || 'ANY') === id;
              const info = STYLE_INFO[id as TradeStyle];
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => !on && save({ tradeStyle: id })}
                  className={`p-3 rounded-2xl text-left border transition cursor-pointer ${on ? onTone : 'bg-black/20 border-white/[0.06] hover:bg-white/[0.05]'}`}
                >
                  <span className="flex items-center justify-between">
                    <Icon className={`w-4 h-4 ${tone}`} />
                    <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${on ? 'border-white bg-white' : 'border-white/20'}`} aria-hidden="true">
                      {on && <Check className="w-2.5 h-2.5 text-slate-950" strokeWidth={3} />}
                    </span>
                  </span>
                  <span className="mt-1.5 block text-sm font-semibold text-white">{id === 'ANY' ? 'All types' : info.label}</span>
                  <span className="block text-[11px] text-slate-500 leading-snug">{info.hold}</span>
                  <span className="mt-1 block text-[10px] font-mono text-slate-400">{id === 'ANY' ? info.frames : styleFramesLabel(id as TradeStyle, p.styleTimeframes?.[id as Exclude<TradeStyle, 'ANY'>])}</span>
                </button>
              );
            })}
          </div>
          {p.tradeStyle && p.tradeStyle !== 'ANY' && (() => {
            const style = p.tradeStyle as Exclude<TradeStyle, 'ANY'>;
            const chosen = p.styleTimeframes?.[style] || [];
            const active = styleFrames(style, chosen);
            const custom = hasStyleChoice(style, chosen);
            const tone = style === 'SCALP' ? 'bg-cyan-400 text-slate-950 border-cyan-300' : style === 'DAY' ? 'bg-amber-400 text-slate-950 border-amber-300' : 'bg-fuchsia-400 text-slate-950 border-fuchsia-300';
            // At least one timeframe stays on; ticking every one is stored as "all of the type's"
            const toggle = (tf: string) => {
              const next = active.includes(tf) ? active.filter(x => x !== tf) : STYLE_FRAMES[style].filter(x => x === tf || active.includes(x));
              if (!next.length) return;
              save({ styleTimeframes: { ...p.styleTimeframes, [style]: next.length === STYLE_FRAMES[style].length ? [] : next } } as Partial<Preferences>);
            };
            return (
              <div className="mt-2.5 p-3 rounded-2xl bg-black/20 border border-white/[0.06] mx-fade-in">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{STYLE_INFO[style].short} timeframes</span>
                  {custom && (
                    <button type="button" onClick={() => save({ styleTimeframes: { ...p.styleTimeframes, [style]: [] } } as Partial<Preferences>)} className="text-[11px] text-slate-400 hover:text-white cursor-pointer">
                      Use all
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`${STYLE_INFO[style].label} timeframes`}>
                  {STYLE_FRAMES[style].map(tf => {
                    const on = active.includes(tf);
                    return (
                      <button
                        key={tf}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(tf)}
                        title={on && active.length === 1 ? 'Keep at least one timeframe' : undefined}
                        className={`min-w-[44px] px-3 py-1.5 rounded-full text-xs font-mono font-semibold border transition cursor-pointer ${on ? tone : 'bg-white/[0.03] text-slate-400 border-white/10 hover:text-white hover:bg-white/[0.07]'}`}
                      >
                        {tf.replace(/^(\d+)M$/, '$1m')}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[11px] leading-snug text-slate-500">
                  {custom ? (
                    <>
                      <span className="text-slate-200">Only {styleFramesLabel(style, chosen)}.</span> These override every other timeframe on MarketX (the composer, RDM, your watchlist and your
                      strategy) until you change them or switch the trade type off.
                    </>
                  ) : (
                    <>Every {STYLE_INFO[style].short.toLowerCase()} timeframe is on. Tap one to switch it off and keep only the ones you trade.</>
                  )}
                </p>
              </div>
            );
          })()}
          {(p.tradeStyle === 'DAY' || p.tradeStyle === 'SWING') && (
            <p className="mt-2.5 p-3 rounded-2xl bg-amber-500/[0.05] border border-amber-400/15 text-[11px] leading-snug text-slate-400 mx-fade-in">
              <span className="font-semibold text-amber-200">Close by 9:00 PM WAT{p.tradeStyle === 'SWING' ? ' on Friday' : ''}.</span> With a price alert on, MarketX reminds you 30 minutes before. A trade
              still open then, in profit or in loss, is recorded as <span className="text-slate-200">ended</span> at that price in your alerts, journal, track record and its Solana record.
            </p>
          )}
          {p.tradeStyle === 'SCALP' && (
            <p className="mt-2.5 p-3 rounded-2xl bg-cyan-500/[0.05] border border-cyan-400/15 text-[11px] leading-snug text-slate-400 mx-fade-in">
              <span className="font-semibold text-cyan-200">Scalps only.</span> Analyses run on {styleFramesLabel('SCALP', p.styleTimeframes?.SCALP)} charts (another timeframe you pick moves to the nearest of them), so entries, stops and targets are close together.
            </p>
          )}
        </Section>

        <Section icon={LineChart} title="Analysis defaults" text="What a new prompt starts with. You can still change it in the composer for any single prompt.">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1.5">Timeframe</div>
          <div className="flex gap-1 overflow-x-auto no-scrollbar p-1 rounded-full bg-black/25 border border-white/[0.08]" role="radiogroup" aria-label="Default timeframe">
            {[...SUPPORTED_TIMEFRAMES, 'RDM'].map(tf => {
              const locked = tf === 'RDM' && rdmLocked;
              return (
                <button
                  key={tf}
                  type="button"
                  role="radio"
                  aria-checked={p.timeframe === tf}
                  disabled={locked}
                  title={locked ? 'RDM is a Pro feature' : tf === 'RDM' ? 'Scans every timeframe and picks the best setup' : undefined}
                  onClick={() => save({ timeframe: tf })}
                  className={`${seg(p.timeframe === tf)} font-mono px-2.5 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  {tfLabel(tf)}
                </button>
              );
            })}
          </div>
          <div id="mx-rdm-timeframes" className="mt-3 p-3 rounded-2xl bg-black/20 border border-white/[0.06]">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">RDM timeframes</span>
              {rdmLocked && <span className="text-[10px] font-semibold text-amber-300">Pro</span>}
            </div>
            <p className="text-[11px] text-slate-500 leading-snug mb-2">Choose the timeframes RDM searches, or All. Used wherever you pick RDM: the composer and the watchlist.</p>
            <RdmTimeframePicker value={p.rdmTimeframes} onChange={next => onSave({ rdmTimeframes: next })} disabled={rdmLocked} />
            {p.tradeStyle && p.tradeStyle !== 'ANY' && hasStyleChoice(p.tradeStyle, p.styleTimeframes?.[p.tradeStyle]) && (
              <p className="mt-2 text-[11px] leading-snug text-amber-200/80">
                Your {STYLE_INFO[p.tradeStyle].short.toLowerCase()} timeframes are on, so RDM scans {styleFramesLabel(p.tradeStyle, p.styleTimeframes[p.tradeStyle])} for now.
              </p>
            )}
          </div>
          <div className="mt-3 text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1.5">Stop loss</div>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Default stop loss">
            {([['normal', 'Normal', 'Beyond the zone with room to breathe', Shield], ['tight', 'Tight', 'Closer stop, smaller risk per trade', Crosshair]] as const).map(([id, label, text, Icon]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={p.slMode === id}
                onClick={() => save({ slMode: id })}
                className={`p-3 rounded-2xl text-left border transition cursor-pointer ${p.slMode === id ? 'bg-white/[0.07] border-sky-400/50' : 'bg-black/20 border-white/[0.06] hover:bg-white/[0.05]'}`}
              >
                <Icon className={`w-4 h-4 ${id === 'tight' ? 'text-amber-300' : 'text-slate-300'}`} />
                <span className="mt-1.5 block text-sm font-semibold text-white">{label}</span>
                <span className="block text-[11px] text-slate-500 leading-snug">{text}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section icon={Wallet} title="Risk and money" text="Every trade card shows what you risk and what each target pays, in your money.">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Account size</span>
              <input
                inputMode="decimal"
                value={account}
                placeholder="e.g. 5000"
                onChange={e => {
                  const v = e.target.value.replace(/[^0-9.]/g, '');
                  setAccount(v);
                  if (v === '') saveLater({ accountSize: null });
                  else if (Number(v) >= 1) saveLater({ accountSize: Number(v) });
                }}
                aria-label="Account size"
                className="mt-1.5 w-full h-11 px-3 rounded-2xl bg-black/25 border border-white/[0.08] text-white tabular-nums focus:outline-none focus:border-sky-400/50"
              />
            </label>
            <div>
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Currency</span>
              <div className="mt-1.5 flex gap-0.5 p-1 h-11 items-center rounded-2xl bg-black/25 border border-white/[0.08]" role="radiogroup" aria-label="Account currency">
                {CURRENCIES.map(c => (
                  <button key={c} type="button" role="radio" aria-checked={p.currency === c} onClick={() => save({ currency: c })} className={`${seg(p.currency === c)} px-2 h-8 font-mono text-[11px]`}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Risk per trade</span>
            <span className="text-sm font-semibold text-white tabular-nums">{risk.toFixed(2)}%</span>
          </div>
          <input
            type="range"
            min={0.25}
            max={5}
            step={0.25}
            value={risk}
            onChange={e => {
              const v = Number(e.target.value);
              setRisk(v);
              saveLater({ riskPct: v });
            }}
            aria-label="Risk per trade in percent"
            className="mt-2 w-full accent-sky-400 cursor-pointer"
          />
          <div className="flex justify-between text-[10px] text-slate-500 tabular-nums">
            <span>0.25%</span>
            <span>1%</span>
            <span>2%</span>
            <span>5%</span>
          </div>
          <div className="mt-3 p-3 rounded-2xl bg-sky-500/[0.07] border border-sky-400/20 text-xs text-slate-300 leading-relaxed">
            {riskAmount != null ? (
              <>
                You risk <span className="text-white font-semibold">{formatMoney(riskAmount, p.currency)}</span> per trade. A 1:3 target pays{' '}
                <span className="text-emerald-300 font-semibold">{formatMoney(riskAmount * 3, p.currency)}</span>.
                {risk > 2 && <span className="block mt-1 text-amber-300">Above 2% a short losing streak cuts deep. Most pros stay at 0.5% to 1%.</span>}
              </>
            ) : (
              'Add your account size to see your risk and rewards in money on every trade.'
            )}
          </div>
        </Section>

        <div id="mx-trade-calculator" className="scroll-mt-2">
          <Section icon={Calculator} title="Trade calculator" text="Work out the lot size for your risk, or check what a lot size puts at risk, for any pair on your account.">
            <TradeCalculator accountSize={account ? Number(account) || null : p.accountSize} currency={p.currency} riskPct={risk} seed={calcSeed} />
          </Section>
        </div>

        <Section icon={LayoutList} title="How results look" text="Only changes how a trade is shown to you, never the analysis itself.">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Result view">
            {([['DETAILED', 'Detailed', 'Full write-up under every trade', AlignLeft], ['SIMPLE', 'Simple', 'Levels first, write-up folded away', LayoutList]] as const).map(([id, label, text, Icon]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={p.view === id}
                onClick={() => save({ view: id })}
                className={`p-3 rounded-2xl text-left border transition cursor-pointer ${p.view === id ? 'bg-white/[0.07] border-sky-400/50' : 'bg-black/20 border-white/[0.06] hover:bg-white/[0.05]'}`}
              >
                <Icon className="w-4 h-4 text-slate-300" />
                <span className="mt-1.5 block text-sm font-semibold text-white">{label}</span>
                <span className="block text-[11px] text-slate-500 leading-snug">{text}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1.5">Markets tab opens on</div>
          <div className="flex gap-1 overflow-x-auto no-scrollbar p-1 rounded-full bg-black/25 border border-white/[0.08]" role="radiogroup" aria-label="Markets tab opens on">
            {MARKETS.map(m => (
              <button key={m.id} type="button" role="radio" aria-checked={p.homeMarket === m.id} onClick={() => save({ homeMarket: m.id })} className={`${seg(p.homeMarket === m.id)} shrink-0`}>
                {m.label}
              </button>
            ))}
          </div>
        </Section>

        {alertsEnabled && (
          <Section icon={BellRing} title="Price alerts" text="Auto watches every new trade by itself. Manual: you tap Get price alert.">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-black/25 border border-white/[0.08]" role="radiogroup" aria-label="Price alert mode">
              {([['AUTO', 'Auto', Zap], ['MANUAL', 'Manual', Hand]] as const).map(([id, label, Icon]) => (
                <button key={id} type="button" role="radio" aria-checked={alertsMode === id} onClick={() => alertsMode !== id && onSetAlertsMode(id)} className={`${seg(alertsMode === id)} inline-flex items-center justify-center gap-1.5`}>
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </Section>
        )}
        <p className="px-2 pb-2 text-[11px] text-slate-500 leading-relaxed">
          Preferences shape your view and starting values. MarketX finds and scores setups the same way for everyone.
        </p>
      </div>
    </PluginSheet>
  );
};
