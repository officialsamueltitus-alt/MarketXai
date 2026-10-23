import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, Check, Loader2, Shield, Crosshair, Wallet, LayoutList, AlignLeft, LineChart, RotateCcw, Zap, Hand, BellRing, Calculator, ScanSearch, Target, CandlestickChart, ChevronRight, Timer, Sun, CalendarRange, Infinity as InfinityIcon, Newspaper } from 'lucide-react';
import { TradeCalculator, type CalcSeed } from './TradeCalculator';
import { SUPPORTED_TIMEFRAMES } from '../utils/timeframe';
import { DEFAULT_PREFERENCES, NEWS_IMPACTS, formatMoney, newsImpactLabel, type Currency, type NewsImpact, type Preferences } from '../utils/preferences';
import type { AlertMode } from '../types';
import { PluginSheet } from './PluginSheet';
import { RdmTimeframePicker } from './RdmTimeframePicker';
import { AskMattButton } from './AskMattButton';
import type { MattAsk } from '../utils/matt';
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

const Section: React.FC<{ icon: React.ElementType; title: string; text: string; children: React.ReactNode; ask?: MattAsk }> = ({ icon: Icon, title, text, children, ask }) => (
  <section className="p-4 rounded-3xl bg-gradient-to-br from-white/[0.045] to-white/[0.015] border border-white/[0.08]">
    <div className="flex items-start gap-3">
      <span className="w-8 h-8 rounded-xl bg-white/[0.06] border border-white/[0.06] flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-slate-200" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold text-white flex items-center justify-between gap-2">
          {title}
          {ask && <AskMattButton variant="link" ask={ask} />}
        </h3>
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
      ask={{ q: "What can I set in Preference Mode and how does each setting change MarketX?", label: "Preference Mode" }}
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
        <Section icon={ScanSearch} title="Analysis mode" text="How MarketX decides a trade is ready. Used by every analysis and by your watchlist." ask={{ q: "What is the difference between Normal and Confirmation analysis mode, and which should I use?", label: "Analysis mode" }}>
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
              <p className="mt-1.5 flex items-start gap-1 text-[10px] leading-snug text-slate-500">
                <ChevronRight className="w-3 h-3 shrink-0 mt-px" /> Your Strategy Builder strategies follow it too: a setup your rules find is only called once price reaches its zone and confirms it.
              </p>
            </div>
          )}
          {/* Steady mode (owner-specified option C): a switch for Normal analysis */}
          <div className={`mt-2.5 flex items-center justify-between gap-3 p-3 rounded-2xl border ${p.steadyMode && p.analysisMode === 'NORMAL' ? 'bg-lime-500/[0.05] border-lime-400/20' : 'bg-black/20 border-white/[0.06]'}`}>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${p.steadyMode ? 'bg-lime-400' : 'bg-slate-600'}`} />
                Steady mode
              </div>
              <div className="text-[11px] text-slate-500 leading-snug">
                {p.analysisMode === 'CONFIRMATION'
                  ? 'Works with Normal analysis. Switch to Normal to use it.'
                  : p.steadyMode
                    ? 'On: wider stops, limit entries on the 1H and 4H charts, calm markets only.'
                    : 'Off. For traders who want to win more often and sit through smaller drops.'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={p.steadyMode}
              aria-label="Steady mode"
              onClick={() => save({ steadyMode: !p.steadyMode })}
              className={`h-7 w-12 rounded-full relative transition-colors cursor-pointer shrink-0 ${p.steadyMode ? 'bg-lime-500/80' : 'bg-white/[0.12]'}`}
            >
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${p.steadyMode ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
          {p.steadyMode && p.analysisMode === 'NORMAL' && (
            <p className="mt-2 text-[11px] text-slate-500 leading-snug mx-fade-in">
              Your stop sits 3× further from the entry, with the same targets, so use a smaller lot to risk the same money. Only limit entries on the 1H and 4H
              charts, and none while the market is moving too fast. In our tests about half of these trades won, with much smaller drops, but each win pays less.
            </p>
          )}
        </Section>

        <Section icon={Timer} title="Trade type" text="The kind of trades you take. Every analysis, your personal strategy and your watchlist only give trades of this type." ask={{ q: "How do Scalp, Day and Swing trade types work, including choosing my own timeframes and the 9:00 PM WAT close?", label: "Trade type" }}>
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

        <Section icon={LineChart} title="Analysis defaults" text="What a new prompt starts with. You can still change it in the composer for any single prompt." ask={{ q: "How do the analysis defaults work: the default timeframe, RDM timeframes and Normal vs Tight stop loss?", label: "Analysis defaults" }}>
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

        <Section icon={Wallet} title="Risk and money" text="Every trade card shows what you risk and what each target pays, in your money." ask={{ q: "How does the risk and money strip on trade cards work with my account size and risk per trade?", label: "Risk and money" }}>
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
                {risk > 0.5 && <span className="block mt-1 text-amber-300">Expect losing streaks: MarketX suggests 0.5% or less per trade.</span>}
              </>
            ) : (
              'Add your account size to see your risk and rewards in money on every trade.'
            )}
          </div>
        </Section>

        <Section
          icon={Shield}
          title="Secure half"
          text="An optional way to manage every trade: at +1R take half off and move your stop to entry, so a trade that turns back still ends in profit."
          ask={{ q: 'How does Secure half work, and how does it change my alerts, journal and results?', label: 'Secure half' }}
        >
          <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-black/20 border border-white/[0.06]">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">{p.secureHalf ? 'Secure half is on' : 'Secure half at 1R'}</div>
              <div className="text-[11px] text-slate-500 leading-snug">
                {p.secureHalf ? 'Trade cards show the +1R price; new price alerts tell you when to take half.' : 'Off. Every trade runs whole to its targets or stop.'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={p.secureHalf}
              aria-label="Secure half at 1R"
              onClick={() => save({ secureHalf: !p.secureHalf })}
              className={`h-7 w-12 rounded-full relative transition-colors cursor-pointer shrink-0 ${p.secureHalf ? 'bg-emerald-500/80' : 'bg-white/[0.12]'}`}
            >
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${p.secureHalf ? 'right-1' : 'left-1'}`} />
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-2 leading-snug">
            You win more often, but your big winners are smaller: half the trade is closed at 1R. Price alerts started while this is on send a "secure half"
            notice at +1R, then treat entry as the stop, and your journal and results score the trade that way (half at +1R, the rest at the target or at entry).
          </p>
        </Section>

        <div id="mx-trade-calculator" className="scroll-mt-2">
          <Section icon={Calculator} title="Trade calculator" text="Work out the lot size for your risk, or check what a lot size puts at risk, for any pair on your account." ask={{ q: "How do I use the trade calculator to find my lot size, and what are standard, mini and micro lots?", label: "Trade calculator" }}>
            <TradeCalculator accountSize={account ? Number(account) || null : p.accountSize} currency={p.currency} riskPct={risk} seed={calcSeed} />
          </Section>
        </div>

        <Section
          icon={Newspaper}
          title="News alerts"
          text="Every morning at 7:00 AM WAT, a notification and an email with the releases due in the next 24 hours, each with a short briefing and a button to analyze it."
          ask={{ q: 'How do daily news alerts work, and which impact levels should I choose?', label: 'News alerts' }}
        >
          {(() => {
            const na = p.newsAlerts || DEFAULT_PREFERENCES.newsAlerts;
            const all = na.impacts.length === NEWS_IMPACTS.length;
            const setImpacts = (impacts: NewsImpact[]) => impacts.length && save({ newsAlerts: { ...na, impacts } });
            const toggle = (x: NewsImpact) => (all ? setImpacts([x]) : na.impacts.includes(x) ? na.impacts.length > 1 && setImpacts(na.impacts.filter(i => i !== x)) : setImpacts([...na.impacts, x]));
            const tone: Record<NewsImpact, string> = { HIGH: 'bg-rose-400', MEDIUM: 'bg-amber-400', LOW: 'bg-slate-400' };
            return (
              <>
                <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-black/20 border border-white/[0.06]">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">{na.enabled ? 'News alerts are on' : 'Daily news alerts'}</div>
                    <div className="text-[11px] text-slate-500 leading-snug">{na.enabled ? `${newsImpactLabel(na.impacts)} · notification and email` : 'Off. Switch on to get the day’s releases each morning.'}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={na.enabled}
                    aria-label="Daily news alerts"
                    onClick={() => save({ newsAlerts: { ...na, enabled: !na.enabled } })}
                    className={`h-7 w-12 rounded-full relative transition-colors cursor-pointer shrink-0 ${na.enabled ? 'bg-emerald-500/80' : 'bg-white/[0.12]'}`}
                  >
                    <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${na.enabled ? 'right-1' : 'left-1'}`} />
                  </button>
                </div>
                <div className="mt-3 text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1.5">Which news</div>
                <div className="grid grid-cols-4 gap-1 p-1 rounded-full bg-black/25 border border-white/[0.08]" role="group" aria-label="News impact">
                  {NEWS_IMPACTS.map(x => (
                    <button key={x} type="button" aria-pressed={!all && na.impacts.includes(x)} onClick={() => toggle(x)} className={`${seg(!all && na.impacts.includes(x))} inline-flex items-center justify-center gap-1.5`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${tone[x]}`} />
                      {x.charAt(0) + x.slice(1).toLowerCase()}
                    </button>
                  ))}
                  <button type="button" aria-pressed={all} onClick={() => setImpacts([...NEWS_IMPACTS])} className={seg(all)}>
                    All
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 mt-2 leading-snug">
                  Tap one or more. High impact moves markets most; medium and low add more of the calendar. Nothing is sent on a day with no matching release.
                </p>
              </>
            );
          })()}
        </Section>

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
          <Section icon={BellRing} title="Price alerts" text="Auto watches every new trade by itself. Manual: you tap Get price alert." ask={{ q: "How do price alerts work, and what is the difference between Auto and Manual?", label: "Price alerts" }}>
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
