import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Target, Plus, Loader2, Check, Trash2, Pencil, Sparkles, ChevronLeft, ChevronRight, AlertTriangle, BookOpen, Wand2,
  MessageSquareText, ListChecks, ShieldCheck, Power, Library,
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { SUPPORTED_TIMEFRAMES } from '../utils/timeframe';
import {
  DEFAULT_RULES, MARKETS, MAX_FREE_TEXT, SESSIONS, SETUPS, SETUP_IDS, describeRules, normalizeRules,
  type SetupId, type StrategyRules,
} from '../utils/strategyRules';
import { PluginSheet } from './PluginSheet';

// /strategy: the Strategy Builder. Traders explain their strategy (own words + guided questions) or start from the
// library, review the rules the strategy engine reads from it, save, and switch Strategy mode on: analyses and the
// watchlist then run their rules instead of the general MarketX engine. Same results, alerts and proofs.
interface Saved {
  id: string;
  name: string;
  freeText: string;
  guided: StrategyRules;
  rules: StrategyRules;
  summary: string;
  notSupported: string[];
  templateId: string | null;
  plain: string[];
}
interface Template { id: string; name: string; family: string; blurb: string; rules: StrategyRules; plain: string[] }
export interface StrategyState {
  enabled: boolean;
  activeId: string | null;
  strategies: Saved[];
  templates: Template[];
  engineReady: boolean;
  max: number;
}
interface Draft { rules: StrategyRules; summary: string; notSupported: string[]; usedEngine: boolean; plain: string[] }

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onToast: (message: string, type?: 'success' | 'info') => void;
  /** Called with the latest state (the composer chip and cards show the active strategy) */
  onState: (s: StrategyState) => void;
  /** Free until 1 Nov, then Pro: opens pricing when the server says so */
  onProRequired: (message: string) => void;
  /**
   * Opened from the Trading Agent page (owner-specified): picking a strategy here chooses what the AGENT trades with, kept
   * separate from the Strategy Builder on/off of the normal MarketX page (which this never changes). null = the MarketX engine.
   */
  agent?: { selectedId: string | null; onSelect: (id: string | null, name?: string) => void };
}

const tfLabel = (tf: string) => tf.replace(/^(\d+)M$/, '$1m');
const FAMILY_TONE: Record<string, string> = {
  SMC: 'text-violet-200 bg-violet-500/15 border-violet-400/25',
  ICT: 'text-sky-200 bg-sky-500/15 border-sky-400/25',
  Trend: 'text-emerald-200 bg-emerald-500/15 border-emerald-400/25',
  Breakout: 'text-amber-200 bg-amber-500/15 border-amber-400/25',
  Reversal: 'text-rose-200 bg-rose-500/15 border-rose-400/25',
  'Price action': 'text-orange-200 bg-orange-500/15 border-orange-400/25',
  'Mean reversion': 'text-cyan-200 bg-cyan-500/15 border-cyan-400/25',
  Session: 'text-indigo-200 bg-indigo-500/15 border-indigo-400/25',
  Wyckoff: 'text-fuchsia-200 bg-fuchsia-500/15 border-fuchsia-400/25',
};
const tone = (family: string) => FAMILY_TONE[family] || 'text-slate-200 bg-white/[0.06] border-white/[0.1]';
const chip = (on: boolean) =>
  `h-8 px-3 rounded-xl text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
    on ? 'bg-white text-slate-900 border-white' : 'text-slate-300 border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] hover:text-white'
  }`;
const QUESTIONS = [
  'What do you look for before you enter? (pattern, level, indicator)',
  'Do you buy, sell or both? Which timeframes and markets?',
  'Where does your stop loss go?',
  'Where do you take profit, and what is the minimum reward you accept?',
  'Anything that keeps you out of a trade? (trend, RSI, sessions)',
];

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="mt-4">
    <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
    {hint && <p className="mt-0.5 text-[11px] text-slate-500 leading-snug">{hint}</p>}
    <div className="mt-1.5">{children}</div>
  </div>
);
const NumberIn: React.FC<{ value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; label: string; suffix?: string }> = ({ value, onChange, step = 1, min, max, label, suffix }) => (
  <label className="inline-flex items-center gap-1.5 h-9 px-2.5 rounded-xl bg-black/25 border border-white/[0.08] text-xs text-slate-400">
    <span>{label}</span>
    <input
      type="number"
      inputMode="decimal"
      value={Number.isFinite(value) ? value : ''}
      step={step}
      min={min}
      max={max}
      onChange={e => onChange(Number(e.target.value))}
      className="w-14 bg-transparent text-white font-mono text-sm text-right focus:outline-none"
    />
    {suffix && <span>{suffix}</span>}
  </label>
);

export const StrategyBuilderPanel: React.FC<Props> = ({ isOpen, onClose, onToast, onState, onProRequired, agent }) => {
  const [state, setState] = useState<StrategyState | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<'home' | 'build'>('home');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [editId, setEditId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [freeText, setFreeText] = useState('');
  const [guided, setGuided] = useState<StrategyRules>(DEFAULT_RULES);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The parent passes a fresh onState on every render; reading it from a ref keeps `load` stable, so opening the
  // panel fetches once instead of re-fetching on every parent render (which ran into the API rate limit)
  const onStateRef = useRef(onState);
  onStateRef.current = onState;
  const apply = useCallback((s: StrategyState) => {
    setState(s);
    onStateRef.current(s);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      apply(await apiFetch<StrategyState>('/api/strategies'));
    } catch (e: any) {
      setError(e?.message || 'Could not load your strategies.');
    } finally {
      setLoading(false);
    }
  }, [apply]);
  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const call = async <T,>(key: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(key);
    setError(null);
    try {
      return await fn();
    } catch (e: any) {
      if (e?.status === 402 || e?.code === 'PRO_REQUIRED' || /Pro feature/.test(e?.message || '')) onProRequired(e?.message || 'The Strategy Builder is a Pro feature.');
      else setError(e?.message || 'Something went wrong. Please try again.');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const startBuild = (opts: { template?: Template; saved?: Saved } = {}) => {
    const base = opts.saved?.guided || opts.template?.rules || DEFAULT_RULES;
    setGuided(normalizeRules(base) || DEFAULT_RULES);
    setFreeText(opts.saved?.freeText || '');
    setName(opts.saved?.name || (opts.template ? opts.template.name : ''));
    setTemplateId(opts.saved?.templateId || opts.template?.id || null);
    setEditId(opts.saved?.id || null);
    setDraft(null);
    setError(null);
    setStep(opts.template ? 2 : 1);
    setView('build');
  };
  const set = (patch: Partial<StrategyRules>) => {
    setGuided(g => normalizeRules({ ...g, ...patch }) || g);
    setDraft(null);
  };
  const setNested = <K extends 'params' | 'filters' | 'stop' | 'targets'>(k: K, patch: Partial<StrategyRules[K]>) => {
    setGuided(g => normalizeRules({ ...g, [k]: { ...g[k], ...patch } }) || g);
    setDraft(null);
  };
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);

  const buildRules = async () => {
    const out = await call('compile', () => apiFetch<{ draft: Draft }>('/api/strategies/compile', { method: 'POST', body: JSON.stringify({ guided, freeText }) }));
    if (out) {
      setDraft(out.draft);
      setStep(3);
    }
  };
  const save = async (use: boolean) => {
    if (!draft) return;
    const body = JSON.stringify({ name, freeText, guided, rules: draft.rules, summary: draft.summary, notSupported: draft.notSupported, templateId, use: agent ? false : use });
    const out = await call('save', () =>
      editId ? apiFetch<StrategyState & { saved: Saved }>(`/api/strategies/${editId}`, { method: 'PUT', body }) : apiFetch<StrategyState & { saved: Saved }>('/api/strategies', { method: 'POST', body })
    );
    if (!out) return;
    if (agent) {
      apply(out);
      if (use) agent.onSelect(out.saved.id, out.saved.name);
      onToast(use ? `The agent will trade with "${out.saved.name}"` : `"${out.saved.name}" saved`, 'success');
      setView('home');
      return;
    }
    if (use && editId && !out.enabled) {
      const on = await call('mode', () => apiFetch<StrategyState>('/api/strategies/mode', { method: 'POST', body: JSON.stringify({ enabled: true, strategyId: out.saved.id }) }));
      if (on) apply(on);
    } else apply(out);
    onToast(use ? `Strategy Builder is on: "${out.saved.name}" now finds your trades` : `"${out.saved.name}" saved`, 'success');
    setView('home');
  };
  const setMode = async (enabled: boolean, strategyId?: string) => {
    const out = await call(`mode:${strategyId || 'off'}`, () => apiFetch<StrategyState>('/api/strategies/mode', { method: 'POST', body: JSON.stringify({ enabled, strategyId }) }));
    if (out) {
      apply(out);
      onToast(enabled ? 'Strategy Builder is on: your strategy finds your trades' : 'Strategy Builder is off: the MarketX engine finds your trades again', 'success');
    }
  };
  const remove = async (s: Saved) => {
    if (!window.confirm(`Delete "${s.name}"?`)) return;
    const out = await call(`del:${s.id}`, () => apiFetch<StrategyState>(`/api/strategies/${s.id}`, { method: 'DELETE' }));
    if (out) apply(out);
  };

  const active = state?.strategies.find(s => s.id === state.activeId) || null;
  const preview = useMemo(() => describeRules(guided), [guided]);

  // ---------------------------------------------------------------- home
  const home = (
    <div className="pt-4 space-y-4">
      {agent ? (
        <section className={`relative overflow-hidden p-4 rounded-3xl border ${agent.selectedId ? 'border-emerald-400/30 bg-emerald-500/[0.06]' : 'border-white/[0.08] bg-white/[0.03]'}`}>
          <div className="relative flex items-start gap-3">
            <span className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${agent.selectedId ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/[0.06] text-slate-300'}`}>
              <Target className="w-4 h-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-white">The agent's strategy</h3>
              <p className="mt-0.5 text-xs text-slate-400 leading-snug">
                {agent.selectedId && state?.strategies.find(x => x.id === agent.selectedId)
                  ? <>The agent trades with <span className="text-white font-medium">{state.strategies.find(x => x.id === agent.selectedId)!.name}</span>.</>
                  : 'The agent trades with the MarketX engine (default).'}{' '}
                Picking one here only changes the agent: your normal MarketX setup stays as it is.
              </p>
            </div>
            {agent.selectedId && (
              <button type="button" onClick={() => (agent.onSelect(null), onToast('The agent will trade with the MarketX engine', 'success'))} className="h-8 px-3 rounded-full text-xs font-semibold text-slate-200 border border-white/[0.12] hover:bg-white/[0.06] cursor-pointer shrink-0">
                Use MarketX engine
              </button>
            )}
          </div>
        </section>
      ) : (
      <section className={`relative overflow-hidden p-4 rounded-3xl border ${state?.enabled ? 'border-emerald-400/30 bg-emerald-500/[0.06]' : 'border-white/[0.08] bg-white/[0.03]'}`}>
        <div aria-hidden="true" className="pointer-events-none absolute -top-16 -right-10 w-48 h-48 rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.25),transparent_65%)]" />
        <div className="relative flex items-start gap-3">
          <span className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${state?.enabled ? 'bg-emerald-500/20 text-emerald-200' : 'bg-white/[0.06] text-slate-300'}`}>
            <Power className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-white">Strategy Builder {state?.enabled ? 'is on' : 'is off'}</h3>
            <p className="mt-0.5 text-xs text-slate-400 leading-snug">
              {state?.enabled && active
                ? <>MarketX finds your trades with <span className="text-white font-medium">{active.name}</span> instead of its own engine. Signals, RDM, timeframes, alerts, journal and Solana proofs (tagged Personal strategy) work as usual.</>
                : 'Turn it on with one of your strategies and MarketX finds every trade with your rules instead of its own engine. Off = the MarketX engine.'}
            </p>
          </div>
          {state?.enabled && (
            <button type="button" onClick={() => setMode(false)} disabled={!!busy} className="h-8 px-3 rounded-full text-xs font-semibold text-slate-200 border border-white/[0.12] hover:bg-white/[0.06] cursor-pointer shrink-0 disabled:opacity-60">
              Turn off
            </button>
          )}
        </div>
      </section>
      )}

      {!state?.engineReady && (
        <p className="flex items-start gap-2 p-3 rounded-2xl bg-amber-500/[0.06] border border-amber-400/20 text-[11px] text-amber-200/90 leading-snug">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> Reading strategies written in your own words is being set up. The guided questions and the library work now.
        </p>
      )}

      {/* My strategies */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">My strategies {state ? `· ${state.strategies.length}/${state.max}` : ''}</h3>
          <button type="button" onClick={() => startBuild()} disabled={!!state && state.strategies.length >= state.max} className="h-8 px-3 rounded-full bg-gradient-to-r from-violet-500 to-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:brightness-110 cursor-pointer disabled:opacity-40">
            <Plus className="w-3.5 h-3.5" /> New strategy
          </button>
        </div>
        {loading && !state ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-500" /></div>
        ) : !state?.strategies.length ? (
          <button type="button" onClick={() => startBuild()} className="w-full p-5 rounded-3xl border border-dashed border-white/[0.12] text-center hover:bg-white/[0.03] cursor-pointer">
            <Wand2 className="w-5 h-5 mx-auto text-violet-300" />
            <span className="mt-2 block text-sm font-semibold text-white">Build your first strategy</span>
            <span className="block text-xs text-slate-500">Explain it in your own words, answer a few questions, or start from the library below.</span>
          </button>
        ) : (
          <ul className="space-y-2">
            {state.strategies.map(s => {
              const on = agent ? agent.selectedId === s.id : state.enabled && state.activeId === s.id;
              return (
                <li key={s.id} className={`p-3.5 rounded-2xl border transition-colors ${on ? 'border-emerald-400/40 bg-emerald-500/[0.05]' : 'border-white/[0.08] bg-white/[0.03]'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white truncate">{s.name}</span>
                    <span className={`h-5 px-2 rounded-full border text-[10px] font-semibold inline-flex items-center shrink-0 ${tone(SETUPS[s.rules.setup].family)}`}>{SETUPS[s.rules.setup].short}</span>
                    {on && <span className="ml-auto h-5 px-2 rounded-full bg-emerald-500/20 text-emerald-200 text-[10px] font-bold inline-flex items-center gap-1 shrink-0"><Check className="w-3 h-3" /> In use</span>}
                  </div>
                  <p className="mt-1 text-xs text-slate-400 leading-snug line-clamp-2">{s.summary}</p>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    {!on && (
                      <button type="button" onClick={() => (agent ? (agent.onSelect(s.id, s.name), onToast(`The agent will trade with "${s.name}"`, 'success')) : setMode(true, s.id))} disabled={!!busy} className="h-8 px-3 rounded-full bg-white text-slate-900 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer disabled:opacity-60">
                        {busy === `mode:${s.id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />} Use this
                      </button>
                    )}
                    <button type="button" onClick={() => startBuild({ saved: s })} className="h-8 px-3 rounded-full text-xs font-medium text-slate-300 border border-white/[0.1] hover:bg-white/[0.06] inline-flex items-center gap-1 cursor-pointer">
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                    <button type="button" onClick={() => remove(s)} disabled={!!busy} aria-label={`Delete ${s.name}`} className="ml-auto w-8 h-8 rounded-full text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 flex items-center justify-center cursor-pointer disabled:opacity-60">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Library */}
      <section>
        <div className="flex items-center gap-1.5 mb-2">
          <Library className="w-3.5 h-3.5 text-slate-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Strategy library</h3>
        </div>
        <p className="text-[11px] text-slate-500 mb-2.5">Popular methods to use as they are or tweak to your taste. Each runs on its own rules, separate from the MarketX engine.</p>
        <div className="grid grid-cols-1 min-[440px]:grid-cols-2 gap-2">
          {(state?.templates || []).map(t => (
            <button key={t.id} type="button" onClick={() => startBuild({ template: t })} className="group p-3.5 rounded-2xl text-left border border-white/[0.08] bg-gradient-to-br from-white/[0.045] to-white/[0.01] hover:border-white/[0.18] transition cursor-pointer">
              <span className={`h-5 px-2 rounded-full border text-[10px] font-semibold inline-flex items-center ${tone(t.family)}`}>{t.family}</span>
              <span className="mt-2 block text-sm font-semibold text-white leading-snug">{t.name}</span>
              <span className="mt-1 block text-[11px] text-slate-500 leading-snug line-clamp-3">{t.blurb}</span>
              <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-300 group-hover:text-violet-200">
                Use and tweak <ChevronRight className="w-3 h-3" />
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );

  // ---------------------------------------------------------------- builder
  const steps = [
    { n: 1 as const, label: 'Explain', icon: MessageSquareText },
    { n: 2 as const, label: 'Guided', icon: ListChecks },
    { n: 3 as const, label: 'Review', icon: ShieldCheck },
  ];
  const build = (
    <div className="pt-3">
      <button type="button" onClick={() => setView('home')} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white cursor-pointer">
        <ChevronLeft className="w-3.5 h-3.5" /> Back to strategies
      </button>
      <div className="mt-3 grid grid-cols-3 gap-1 p-1 rounded-2xl bg-black/25 border border-white/[0.08]" role="tablist" aria-label="Build steps">
        {steps.map(({ n, label, icon: Icon }) => (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={step === n}
            disabled={n === 3 && !draft}
            onClick={() => setStep(n)}
            className={`h-9 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${step === n ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}
          >
            <Icon className="w-3.5 h-3.5" /> {n}. {label}
          </button>
        ))}
      </div>

      {step === 1 && (
        <div className="mt-4 mx-fade-in">
          <h3 className="text-base font-semibold text-white">Explain your strategy</h3>
          <p className="mt-1 text-xs text-slate-400 leading-relaxed">Write it the way you would explain it to a friend. These questions help:</p>
          <ul className="mt-2 space-y-1">
            {QUESTIONS.map(q => (
              <li key={q} className="flex items-start gap-2 text-[11px] text-slate-400"><Sparkles className="w-3 h-3 text-violet-300 shrink-0 mt-0.5" />{q}</li>
            ))}
          </ul>
          <textarea
            value={freeText}
            onChange={e => { setFreeText(e.target.value.slice(0, MAX_FREE_TEXT)); setDraft(null); }}
            rows={7}
            placeholder="e.g. I wait for price to sweep a swing low, then shift structure. I buy the fair value gap it leaves, stop under the sweep, and take profit at the last high, at least 1:2. Only London and New York, on the 15m and 1H."
            className="mt-3 w-full p-3.5 rounded-2xl bg-black/30 border border-white/[0.1] text-sm text-white placeholder:text-slate-600 leading-relaxed focus:outline-none focus:border-violet-400/60 resize-y"
          />
          <div className="mt-1 flex justify-between text-[10px] text-slate-500">
            <span>Optional: you can also only answer the guided questions.</span>
            <span>{freeText.length}/{MAX_FREE_TEXT}</span>
          </div>
          <button type="button" onClick={() => setStep(2)} className="mt-4 w-full h-11 rounded-2xl bg-white text-slate-900 text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer">
            Next: guided questions <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="mt-2 mx-fade-in">
          <Field label="1. What is your entry setup?" hint="Pick the closest one. Your own words fine-tune it.">
            <div className="grid grid-cols-1 gap-1.5" role="radiogroup" aria-label="Setup">
              {SETUP_IDS.map((id: SetupId) => {
                const on = guided.setup === id;
                return (
                  <button key={id} type="button" role="radio" aria-checked={on} onClick={() => set({ setup: id })} className={`p-2.5 rounded-xl text-left border transition cursor-pointer ${on ? 'border-violet-400/60 bg-violet-500/[0.08]' : 'border-white/[0.06] bg-black/20 hover:bg-white/[0.04]'}`}>
                    <span className="flex items-center gap-2">
                      <span className={`h-4 px-1.5 rounded border text-[9px] font-bold inline-flex items-center ${tone(SETUPS[id].family)}`}>{SETUPS[id].family}</span>
                      <span className="text-[13px] font-semibold text-white">{SETUPS[id].name}</span>
                    </span>
                    {on && <span className="mt-1 block text-[11px] text-slate-400 leading-snug">{SETUPS[id].explain}</span>}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="2. Which direction?">
            <div className="flex gap-1.5">
              {(['BOTH', 'LONG', 'SHORT'] as const).map(d => (
                <button key={d} type="button" onClick={() => set({ direction: d })} className={chip(guided.direction === d)}>{d === 'BOTH' ? 'Buys and sells' : d === 'LONG' ? 'Buys only' : 'Sells only'}</button>
              ))}
            </div>
          </Field>
          <Field label="3. Which timeframes?" hint="None selected = any timeframe.">
            <div className="flex flex-wrap gap-1.5">
              {SUPPORTED_TIMEFRAMES.map(tf => (
                <button key={tf} type="button" onClick={() => set({ timeframes: toggle(guided.timeframes, tf) })} className={`${chip(guided.timeframes.includes(tf))} font-mono px-2.5`}>{tfLabel(tf)}</button>
              ))}
            </div>
          </Field>
          <Field label="4. Which markets?" hint="None selected = every market.">
            <div className="flex flex-wrap gap-1.5">
              {MARKETS.map(m => (
                <button key={m} type="button" onClick={() => set({ markets: toggle(guided.markets, m) })} className={`${chip(guided.markets.includes(m))} capitalize`}>{m}</button>
              ))}
            </div>
          </Field>
          <Field label="5. What keeps you out of a trade?">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setNested('filters', { trendEma: guided.filters.trendEma ? null : 200 })} className={chip(!!guided.filters.trendEma)}>Only with the trend</button>
                {guided.filters.trendEma && <NumberIn label="EMA" value={guided.filters.trendEma} onChange={n => setNested('filters', { trendEma: n })} min={20} max={300} />}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setNested('filters', { rsiCap: guided.filters.rsiCap ? null : 70 })} className={chip(!!guided.filters.rsiCap)}>No buy when RSI is high</button>
                {guided.filters.rsiCap && <NumberIn label="RSI above" value={guided.filters.rsiCap} onChange={n => setNested('filters', { rsiCap: n })} min={55} max={90} />}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SESSIONS.map(s => (
                  <button key={s.id} type="button" onClick={() => setNested('filters', { sessions: toggle(guided.filters.sessions, s.id) })} className={chip(guided.filters.sessions.includes(s.id))}>{s.label} session</button>
                ))}
              </div>
            </div>
          </Field>
          <Field label="6. Where does your stop go?">
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setNested('stop', { type: 'STRUCTURE' })} className={chip(guided.stop.type === 'STRUCTURE')}>Beyond the setup (structure)</button>
              <button type="button" onClick={() => setNested('stop', { type: 'ATR' })} className={chip(guided.stop.type === 'ATR')}>ATR distance</button>
              {guided.stop.type === 'ATR' && <NumberIn label="×" value={guided.stop.atrMult} step={0.1} onChange={n => setNested('stop', { atrMult: n })} min={0.5} max={5} suffix="ATR" />}
            </div>
          </Field>
          <Field label="7. Where do you take profit?">
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setNested('targets', { type: 'STRUCTURE' })} className={chip(guided.targets.type === 'STRUCTURE')}>Next structure, then R</button>
              <button type="button" onClick={() => setNested('targets', { type: 'RR' })} className={chip(guided.targets.type === 'RR')}>Fixed R multiples</button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {[0, 1, 2].map(i => (
                <NumberIn key={i} label={`TP${i + 1}`} value={guided.targets.rr[i] ?? NaN} step={0.5} min={0.5} max={20} suffix="R" onChange={n => {
                  const rr = [...guided.targets.rr];
                  rr[i] = n;
                  setNested('targets', { rr: rr.filter(x => Number.isFinite(x)) });
                }} />
              ))}
              <NumberIn label="Min reward" value={guided.minRR} step={0.5} min={1} max={10} suffix="R" onChange={n => set({ minRR: n })} />
            </div>
          </Field>
          {(guided.setup === 'EMA_PULLBACK' || guided.setup === 'MA_CROSS' || guided.setup === 'BOLLINGER_REVERSION' || guided.setup !== 'SESSION_BREAKOUT') && (
            <Field label="8. Fine-tune">
              <div className="flex flex-wrap gap-1.5">
                {(guided.setup === 'EMA_PULLBACK' || guided.setup === 'MA_CROSS') && (
                  <>
                    <NumberIn label="Fast EMA" value={guided.params.emaFast} onChange={n => setNested('params', { emaFast: n })} min={3} max={100} />
                    <NumberIn label="Slow EMA" value={guided.params.emaSlow} onChange={n => setNested('params', { emaSlow: n })} min={5} max={300} />
                  </>
                )}
                {guided.setup === 'BOLLINGER_REVERSION' && (
                  <>
                    <NumberIn label="Bands" value={guided.params.bbPeriod} onChange={n => setNested('params', { bbPeriod: n })} min={10} max={50} />
                    <NumberIn label="Std dev" value={guided.params.bbStdDev} step={0.1} onChange={n => setNested('params', { bbStdDev: n })} min={1} max={3.5} />
                  </>
                )}
                {['BREAKOUT_RETEST', 'SR_BOUNCE', 'RANGE_SWEEP', 'RSI_DIVERGENCE', 'SMC_OB_RETEST', 'ICT_SWEEP_FVG'].includes(guided.setup) && (
                  <NumberIn label="Look back" value={guided.params.lookback} onChange={n => setNested('params', { lookback: n })} min={20} max={200} suffix="candles" />
                )}
                <NumberIn label="RSI period" value={guided.params.rsiPeriod} onChange={n => setNested('params', { rsiPeriod: n })} min={5} max={30} />
              </div>
            </Field>
          )}
          <div className="mt-4 p-3 rounded-2xl bg-black/20 border border-white/[0.06]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">Your rules so far</div>
            <ul className="space-y-0.5">{preview.map(l => <li key={l} className="text-[11px] text-slate-400 leading-snug">{l}</li>)}</ul>
          </div>
          <button type="button" onClick={buildRules} disabled={busy === 'compile'} className="mt-4 w-full h-12 rounded-2xl bg-gradient-to-r from-violet-500 to-emerald-500 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-[0_12px_40px_-12px_rgba(139,92,246,.8)] hover:brightness-110 cursor-pointer disabled:opacity-70">
            {busy === 'compile' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {freeText.trim() ? 'Read my strategy and build the rules' : 'Build the rules'}
          </button>
        </div>
      )}

      {step === 3 && draft && (
        <div className="mt-4 mx-fade-in">
          <h3 className="text-base font-semibold text-white">Review your rules</h3>
          <p className="mt-1 text-xs text-slate-400">{draft.usedEngine ? 'Read from your words and answers. ' : ''}MarketX runs exactly these rules on real candles, every analysis.</p>
          <div className="mt-3 p-3.5 rounded-2xl border border-violet-400/25 bg-violet-500/[0.05]">
            <p className="text-sm text-white leading-snug">{draft.summary}</p>
            <ul className="mt-2.5 space-y-1.5">
              {draft.plain.map(l => (
                <li key={l} className="flex items-start gap-2 text-xs text-slate-300 leading-snug"><Check className="w-3.5 h-3.5 text-emerald-300 shrink-0 mt-px" />{l}</li>
              ))}
            </ul>
          </div>
          {draft.notSupported.length > 0 && (
            <div className="mt-2.5 p-3 rounded-2xl bg-amber-500/[0.06] border border-amber-400/20">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-200"><AlertTriangle className="w-3.5 h-3.5" /> Not automated</div>
              <p className="mt-1 text-[11px] text-amber-100/80 leading-snug">These parts of your strategy can't be run as rules, so keep them in mind yourself: {draft.notSupported.join('; ')}.</p>
            </div>
          )}
          <label className="mt-4 block">
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Name</span>
            <input value={name} onChange={e => setName(e.target.value.slice(0, 48))} placeholder="e.g. My London sweep" className="mt-1.5 w-full h-11 px-3.5 rounded-2xl bg-black/30 border border-white/[0.1] text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-400/60" />
          </label>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => save(false)} disabled={!!busy || name.trim().length < 2} className="h-11 rounded-2xl border border-white/[0.12] text-sm font-semibold text-white hover:bg-white/[0.06] cursor-pointer disabled:opacity-40">
              {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Save'}
            </button>
            <button type="button" onClick={() => save(true)} disabled={!!busy || name.trim().length < 2} className="h-11 rounded-2xl bg-white text-slate-900 text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40">
              <Power className="w-4 h-4" /> {agent ? "Save and use for the agent" : "Save and use"}
            </button>
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-[10px] text-slate-500 leading-snug">
            <BookOpen className="w-3 h-3 shrink-0 mt-px" /> Results come from your rules, not from MarketX's engine, and count in your own track record. Every trade is still sealed on Solana.
          </p>
        </div>
      )}
    </div>
  );

  return (
    <PluginSheet
      isOpen={isOpen}
      onClose={onClose}
      ask={{ q: "How does the Strategy Builder work: building my own strategy, the library, and turning it on?", label: "Strategy Builder" }}
      label="Strategy Builder"
      title="Strategy Builder"
      subtitle={agent ? 'Pick or build the strategy your agent trades with' : state?.enabled && active ? `On · ${active.name}` : 'Your own strategy, run on real candles'}
      icon={Target}
      gradient="from-violet-500/30 to-emerald-500/25"
      iconTone="text-violet-100"
      enabled={false}
      width="sm:w-[540px]"
      toolbar={
        error ? (
          <p className="mx-5 mb-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-400/20 text-[11px] text-rose-200" role="alert">{error}</p>
        ) : null
      }
    >
      {view === 'home' ? home : build}
    </PluginSheet>
  );
};
