import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, Check, Loader2, Shield, Crosshair, Wallet, LayoutList, AlignLeft, LineChart, RotateCcw, Zap, Hand, BellRing, Calculator } from 'lucide-react';
import { TradeCalculator, type CalcSeed } from './TradeCalculator';
import { SUPPORTED_TIMEFRAMES } from '../utils/timeframe';
import { DEFAULT_PREFERENCES, formatMoney, type Currency, type Preferences } from '../utils/preferences';
import type { AlertMode } from '../types';
import { PluginSheet } from './PluginSheet';

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
