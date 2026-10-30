import React, { useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Check, CheckCircle2, Copy, Download, Share2, Landmark, Loader2, Minus, CalendarClock, Newspaper, AlertTriangle, RefreshCw, Sparkles, TrendingUp, TrendingDown } from 'lucide-react';
import type { CurrencyImpact, FundamentalBias, FundamentalPair, FundamentalRecheck, FundamentalReport } from '../utils/fundamental';
import { BIAS_LABEL } from '../utils/fundamental';
import { exactPrice } from '../utils/formatPrice';
import { AskMattButton } from './AskMattButton';
import { buildFundamentalShareText, prepareFundamentalCard, saveFundamentalCard, shareFundamentalCard } from '../utils/fundamentalShare';
import { openXPost } from '../utils/shareText';

// Fundamental Analysis result (/fundamental-analysis): the event, the most likely outcome with its odds, past
// releases, the scenarios, and the pairs it favours (For) or works against (Against), each with its live price.

const BIAS_TONE: Record<FundamentalBias, { pill: string; text: string; icon: typeof ArrowUpRight; bar: string }> = {
  FOR: { pill: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200', text: 'text-emerald-300', icon: ArrowUpRight, bar: 'bg-emerald-400' },
  AGAINST: { pill: 'bg-rose-500/15 border-rose-400/30 text-rose-200', text: 'text-rose-300', icon: ArrowDownRight, bar: 'bg-rose-400' },
  NEUTRAL: { pill: 'bg-white/[0.06] border-white/[0.12] text-slate-300', text: 'text-slate-300', icon: Minus, bar: 'bg-slate-400' },
};
const IMPACT_TONE: Record<CurrencyImpact, string> = {
  BULLISH: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200',
  BEARISH: 'bg-rose-500/15 border-rose-400/30 text-rose-200',
  NEUTRAL: 'bg-white/[0.06] border-white/[0.12] text-slate-300',
};
const impactText = (impact: CurrencyImpact, currency: string) => (impact === 'NEUTRAL' ? `Neutral ${currency}`.trim() : `${impact === 'BULLISH' ? 'Bullish' : 'Bearish'} ${currency}`.trim());

const ConfidenceRing: React.FC<{ value: number }> = ({ value }) => {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center shrink-0" title="How firm this read is (never a certainty)">
      <svg width="46" height="46" viewBox="0 0 46 46" role="img" aria-label={`Confidence ${value}%`} className="text-white">
        <circle cx="23" cy="23" r={r} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="4" />
        <circle cx="23" cy="23" r={r} fill="none" stroke="#38bdf8" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 23 23)" />
        <text x="23" y="27" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">{value}%</text>
      </svg>
      <span className="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">Confidence</span>
    </div>
  );
};

const num = (s?: string) => {
  const m = /-?\d+(?:\.\d+)?/.exec(String(s || '').replace(/,/g, ''));
  return m ? Number(m[0]) : null;
};
/** Above / below / in line with the forecast, for a past release */
const versus = (actual?: string, forecast?: string) => {
  const a = num(actual);
  const f = num(forecast);
  if (a === null || f === null) return null;
  if (Math.abs(a - f) < 1e-9) return { label: 'In line', cls: 'text-slate-400' };
  return a > f ? { label: 'Above', cls: 'text-sky-300' } : { label: 'Below', cls: 'text-amber-300' };
};

const PairTile: React.FC<{ p: FundamentalPair }> = ({ p }) => {
  const tone = BIAS_TONE[p.bias];
  const Icon = tone.icon;
  const dots = p.strength === 'HIGH' ? 3 : p.strength === 'MEDIUM' ? 2 : 1;
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-3 flex flex-col gap-2 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-white truncate">{p.symbol}</div>
          {p.price ? (
            <div className="text-[11px] text-slate-400 tabular-nums truncate">
              {exactPrice(p.price)}
              {typeof p.change24h === 'number' && (
                <span className={p.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}> {p.change24h >= 0 ? '+' : ''}{p.change24h.toFixed(2)}%</span>
              )}
              <span className="text-slate-500"> · live</span>
            </div>
          ) : (
            <div className="text-[11px] text-slate-500">Live price unavailable</div>
          )}
        </div>
        <span className={`inline-flex items-center gap-1 h-6 pl-1.5 pr-2 rounded-full border text-[11px] font-semibold shrink-0 ${tone.pill}`}>
          <Icon className="w-3.5 h-3.5" />
          {BIAS_LABEL[p.bias]}
        </span>
      </div>
      {p.reason && <p className="text-[11.5px] leading-snug text-slate-300">{p.reason}</p>}
      <div className="flex items-center gap-1.5 mt-auto" aria-label={`Strength ${p.strength.toLowerCase()}`} title={`Strength: ${p.strength.toLowerCase()}`}>
        {[1, 2, 3].map(i => (
          <span key={i} className={`h-1 w-5 rounded-full ${i <= dots ? tone.bar : 'bg-white/[0.08]'}`} />
        ))}
        <span className="text-[10px] uppercase tracking-wider text-slate-500 ml-1">{p.strength.toLowerCase()}</span>
      </div>
    </div>
  );
};

const RECHECK_TONE: Record<FundamentalRecheck['state'], { box: string; icon: typeof CheckCircle2; title: string; text: string }> = {
  STILL_VALID: { box: 'border-emerald-400/25 bg-emerald-500/[0.07]', icon: CheckCircle2, title: 'Still valid', text: 'text-emerald-300' },
  CHANGED: { box: 'border-amber-400/25 bg-amber-500/[0.07]', icon: AlertTriangle, title: 'Changed since your last read', text: 'text-amber-300' },
  RELEASED: { box: 'border-sky-400/25 bg-sky-500/[0.07]', icon: CalendarClock, title: 'Released', text: 'text-sky-300' },
};
const clock = (t?: number | null) => (t ? new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const until = (t: number) => {
  const m = Math.max(1, Math.round((t - Date.now()) / 60000));
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.round(m / 1440)} days`;
};

/** What "Recheck" found: released or not, forecast and outlook the same or changed */
const RecheckBanner: React.FC<{ rc: FundamentalRecheck }> = ({ rc }) => {
  const tone = RECHECK_TONE[rc.state] || RECHECK_TONE.STILL_VALID;
  const Icon = tone.icon;
  const lines = Array.isArray(rc.lines) ? rc.lines.map(String).slice(0, 6) : [];
  return (
    <section className={`rounded-2xl border p-3.5 ${tone.box}`} aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${tone.text}`}>
          <Icon className="w-3.5 h-3.5" /> Recheck · {tone.title}
        </span>
        <span className="text-[10.5px] text-slate-500">{clock(rc.checkedAt)}</span>
      </div>
      <p className="text-[13px] font-semibold text-white mt-1.5 leading-snug">{String(rc.headline || '')}</p>
      {rc.dueAt && rc.dueAt > Date.now() && (
        <p className="text-[11.5px] text-slate-300 mt-0.5">
          Due {clock(rc.dueAt)} (in {until(rc.dueAt)})
        </p>
      )}
      {lines.length > 0 && (
        <ul className="mt-2 space-y-1">
          {lines.map((l, i) => (
            <li key={i} className="flex gap-2 text-[11.5px] text-slate-300 leading-snug">
              <span className={`w-1 h-1 rounded-full mt-[7px] shrink-0 ${rc.state === 'CHANGED' ? 'bg-amber-400' : rc.state === 'RELEASED' ? 'bg-sky-400' : 'bg-emerald-400'}`} />
              {l}
            </li>
          ))}
        </ul>
      )}
      {Array.isArray(rc.news) && rc.news.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-white/[0.06]">
          <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1 inline-flex items-center gap-1">
            <Newspaper className="w-3 h-3" /> New since your last read
          </div>
          <ul className="space-y-1">
            {rc.news.slice(0, 3).map((n, i) => (
              <li key={i} className="text-[11.5px] text-slate-300 leading-snug">
                <span className="text-slate-500">{String(n.source || '')} · {clock(n.at)}: </span>
                {String(n.title || '')}
              </li>
            ))}
          </ul>
        </div>
      )}
      {rc.previousAt ? <p className="text-[10.5px] text-slate-500 mt-2">Compared with your read from {clock(rc.previousAt)}.</p> : null}
    </section>
  );
};

/** A stored read may come from an older version or a damaged history entry: fill every list and field so the card never breaks */
const safeReport = (x: any): FundamentalReport | null => {
  if (!x || typeof x !== 'object' || typeof x.event !== 'string') return null;
  const arr = (v: any) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const ml = x.mostLikely && typeof x.mostLikely === 'object' ? x.mostLikely : {};
  return {
    ...x,
    currency: String(x.currency || ''),
    category: String(x.category || ''),
    summary: String(x.summary || ''),
    releaseText: String(x.releaseText || ''),
    data: x.data && typeof x.data === 'object' ? x.data : {},
    history: arr(x.history),
    drivers: arr(x.drivers).map(String),
    risks: arr(x.risks).map(String),
    sources: arr(x.sources).map(String),
    scenarios: arr(x.scenarios).map((s: any) => ({ ...s, name: String(s.name || ''), probability: Math.max(0, Math.min(100, Number(s.probability) || 0)), impact: ['BULLISH', 'BEARISH'].includes(s.impact) ? s.impact : 'NEUTRAL' })),
    pairs: arr(x.pairs).filter((p: any) => typeof p.symbol === 'string').map((p: any) => ({ ...p, bias: ['FOR', 'AGAINST'].includes(p.bias) ? p.bias : 'NEUTRAL', strength: ['HIGH', 'LOW'].includes(p.strength) ? p.strength : 'MEDIUM', price: Number(p.price) > 0 ? Number(p.price) : null, change24h: Number.isFinite(Number(p.change24h)) && p.change24h !== null ? Number(p.change24h) : null })),
    mostLikely: { outcome: String(ml.outcome || ''), reasoning: String(ml.reasoning || ''), probability: Math.max(0, Math.min(100, Number(ml.probability) || 0)), impact: ['BULLISH', 'BEARISH'].includes(ml.impact) ? ml.impact : 'NEUTRAL' },
    confidence: Math.max(0, Math.min(90, Number(x.confidence) || 0)),
  };
};

export const FundamentalCard: React.FC<{
  report: FundamentalReport;
  markdown?: string;
  /** Reads the same question again now and compares it with this read (two analysis credits) */
  onRecheck?: () => void;
  rechecking?: boolean;
  /** Shown on the saved / shared picture */
  username?: string;
  isVerified?: boolean;
  /** Fundamental Analysis is Pro after the free period: Recheck, Save, Share and Post on X offer the upgrade instead */
  locked?: boolean;
  onLocked?: () => void;
}> = ({ report: raw, markdown, onRecheck, rechecking = false, username, isVerified, locked = false, onLocked }) => {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'share'>('');
  const [note, setNote] = useState('');
  const r = React.useMemo(() => safeReport(raw), [raw]);
  if (!r) return null;
  const forCount = r.pairs.filter(p => p.bias === 'FOR').length;
  const againstCount = r.pairs.filter(p => p.bias === 'AGAINST').length;
  const when = r.releaseAt
    ? new Date(r.releaseAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : r.releaseText;
  const statusLabel = r.status === 'UPCOMING' ? 'Upcoming' : r.status === 'RELEASED' ? 'Released' : 'Outlook';
  const copy = () => {
    try {
      navigator.clipboard.writeText(markdown || r.summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };
  const flash = (text: string) => {
    setNote(text);
    setTimeout(() => setNote(''), 2600);
  };
  const warm = () => void (locked || prepareFundamentalCard(r, username, isVerified));
  const save = async () => {
    if (locked) return onLocked?.();
    if (busy) return;
    setBusy('save');
    const out = await saveFundamentalCard(r, username, isVerified).catch(() => 'failed' as const);
    setBusy('');
    if (out === 'saved') flash('Picture saved');
    else if (out === 'failed') flash('Could not make the picture');
  };
  const share = async () => {
    if (locked) return onLocked?.();
    if (busy) return;
    setBusy('share');
    const out = await shareFundamentalCard(r, username, isVerified).catch(() => 'failed' as const);
    setBusy('');
    if (out === 'copied') flash('Text copied, picture saved');
    else if (out === 'failed') flash('Could not share');
  };
  const postOnX = () => (locked ? onLocked?.() : openXPost(buildFundamentalShareText(r, window.location.origin)));
  const mattAsk = {
    q: `Explain this fundamental analysis of ${r.event} in simple terms: what the most likely outcome means and why these pairs are for or against.`,
    label: `${r.event} fundamentals`,
    context: [
      `Fundamental analysis: ${r.event} (${r.currency}).`,
      `Most likely: ${r.mostLikely.outcome} (${r.mostLikely.probability}%), ${impactText(r.mostLikely.impact, r.currency)}.`,
      r.summary,
      `Pairs: ${r.pairs.map(p => `${p.symbol} ${BIAS_LABEL[p.bias]}`).join(', ')}.`,
    ].join('\n'),
  };
  // Actual: the released figure once it is out; Pending until then ("Awaiting figure" once the release time has passed)
  const releasedNow = !!r.data.actual;
  const pendingText = r.status === 'GENERAL' && !r.releaseAt ? '' : r.releaseAt && r.releaseAt <= Date.now() ? 'Awaiting figure' : 'Pending';
  const actualVs = releasedNow ? versus(r.data.actual, r.data.forecast) : null;
  const data: Array<[string, string | undefined]> = [
    ['Actual', r.data.actual || pendingText],
    ['Forecast', r.data.forecast],
    ['Previous', r.data.previous],
  ];

  return (
    <div className="rounded-2xl sm:rounded-3xl border border-white/[0.1] bg-[var(--mx-surface)] overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="relative px-4 sm:px-5 pt-4 pb-3.5 bg-gradient-to-br from-sky-500/[0.10] via-transparent to-amber-500/[0.06]">
        <div className="flex items-start gap-3">
          <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/25 to-amber-500/20 border border-white/[0.08] flex items-center justify-center shrink-0">
            <Landmark className="w-[18px] h-[18px] text-sky-300" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.14em] text-sky-300/90 font-semibold">Fundamental analysis</div>
            <h3 className="text-[15px] sm:text-base font-semibold text-white leading-snug mt-0.5">{r.event}</h3>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              {r.currency && <span className="h-5 px-2 rounded-md bg-white/[0.07] text-[10.5px] font-semibold text-slate-200 inline-flex items-center">{r.currency}</span>}
              {r.category && <span className="h-5 px-2 rounded-md bg-white/[0.04] text-[10.5px] text-slate-400 inline-flex items-center">{r.category}</span>}
              <span className={`h-5 px-2 rounded-md text-[10.5px] font-medium inline-flex items-center gap-1 ${r.status === 'UPCOMING' ? 'bg-amber-500/15 text-amber-200' : r.status === 'RELEASED' ? 'bg-sky-500/15 text-sky-200' : 'bg-white/[0.05] text-slate-300'}`}>
                <CalendarClock className="w-3 h-3" />
                {statusLabel}
                {when ? ` · ${when}` : ''}
              </span>
            </div>
          </div>
          <ConfidenceRing value={r.confidence} />
        </div>
        {onRecheck && (
          <button
            type="button"
            onClick={() => (locked ? onLocked?.() : onRecheck())}
            disabled={rechecking}
            title="Check again now: has it been released, is the forecast the same, does this read still hold? Uses 2 analysis credits."
            className="mt-3 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-sky-400/30 bg-sky-500/[0.1] text-[12px] font-semibold text-sky-100 hover:bg-sky-500/[0.18] disabled:opacity-70 disabled:cursor-wait cursor-pointer transition-colors"
          >
            {rechecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {rechecking ? 'Rechecking… the release, forecast and news' : 'Recheck'}
          </button>
        )}
        {r.summary && <p className="text-[12.5px] sm:text-[13px] leading-relaxed text-slate-300 mt-3">{r.summary}</p>}
      </div>

      <div className="px-4 sm:px-5 py-4 space-y-4">
        {r.recheck && typeof r.recheck === 'object' && typeof r.recheck.headline === 'string' && <RecheckBanner rc={r.recheck} />}
        {/* Most likely */}
        <section className="rounded-2xl border border-sky-400/20 bg-sky-500/[0.06] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sky-300">
              <Sparkles className="w-3.5 h-3.5" /> Most likely outcome
            </span>
            <span className={`h-6 px-2 rounded-full border text-[11px] font-semibold inline-flex items-center gap-1 ${IMPACT_TONE[r.mostLikely.impact]}`}>
              {r.mostLikely.impact === 'BULLISH' ? <TrendingUp className="w-3.5 h-3.5" /> : r.mostLikely.impact === 'BEARISH' ? <TrendingDown className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
              {impactText(r.mostLikely.impact, r.currency)}
            </span>
          </div>
          <div className="flex items-end justify-between gap-3 mt-2">
            <p className="text-[14px] sm:text-[15px] font-semibold text-white leading-snug">{r.mostLikely.outcome}</p>
            <span className="text-2xl font-bold text-sky-300 tabular-nums leading-none shrink-0">{r.mostLikely.probability}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.08] mt-2 overflow-hidden" aria-hidden="true">
            <div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-cyan-300" style={{ width: `${r.mostLikely.probability}%` }} />
          </div>
          {r.mostLikely.reasoning && <p className="text-[12px] leading-relaxed text-slate-300 mt-2.5">{r.mostLikely.reasoning}</p>}
        </section>

        {/* The numbers */}
        {data.some(([, v]) => v) && (
          <section className="grid grid-cols-3 gap-2">
            {data.map(([k, v]) => {
              const isActual = k === 'Actual';
              const out = isActual && releasedNow;
              const fresh = out && r.recheck?.state === 'RELEASED';
              return (
                <div key={k} className={`rounded-xl border px-3 py-2 min-w-0 ${out ? 'border-sky-400/35 bg-sky-500/[0.08]' : 'border-white/[0.07] bg-white/[0.02]'}`}>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
                    {k}
                    {fresh && <span className="normal-case tracking-normal text-[9.5px] font-semibold text-sky-300">· just out</span>}
                  </div>
                  <div className={`text-[12px] sm:text-[13px] font-semibold tabular-nums leading-tight break-words ${isActual && !releasedNow && v ? 'text-amber-300' : 'text-white'}`}>{v || '—'}</div>
                  {out && actualVs && <div className={`text-[10px] font-medium mt-0.5 ${actualVs.cls}`}>{actualVs.label === 'In line' ? 'In line with forecast' : `${actualVs.label} forecast`}</div>}
                </div>
              );
            })}
          </section>
        )}

        {/* Pairs */}
        {r.pairs.length > 0 && (
          <section>
            <div className="flex items-center justify-between gap-2 mb-2">
              <h4 className="text-[12px] font-semibold text-white">Pairs affected</h4>
              <span className="text-[11px] text-slate-400">
                <span className="text-emerald-300 font-semibold">{forCount} for</span> · <span className="text-rose-300 font-semibold">{againstCount} against</span>
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {r.pairs.map((p, i) => (
                <PairTile key={`${p.symbol}-${i}`} p={p} />
              ))}
            </div>
            <p className="text-[10.5px] text-slate-500 mt-1.5">For = the most likely outcome favours the pair rising. Against = it weighs on the pair.</p>
          </section>
        )}

        {/* Scenarios */}
        {r.scenarios.length > 0 && (
          <section>
            <h4 className="text-[12px] font-semibold text-white mb-2">Scenarios</h4>
            <div className="space-y-2">
              {r.scenarios.map((s, i) => (
                <div key={s.name + i} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-slate-100 truncate">{s.name}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <span className={`h-5 px-1.5 rounded-md border text-[10px] font-semibold inline-flex items-center ${IMPACT_TONE[s.impact]}`}>{impactText(s.impact, r.currency)}</span>
                      <span className="text-[13px] font-bold tabular-nums text-white w-10 text-right">{s.probability}%</span>
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-white/[0.07] mt-1.5 overflow-hidden" aria-hidden="true">
                    <div className={`h-full rounded-full ${i === 0 ? 'bg-sky-400' : 'bg-slate-400/70'}`} style={{ width: `${s.probability}%` }} />
                  </div>
                  {s.condition && <div className="text-[11px] text-slate-400 mt-1.5">{s.condition}</div>}
                  {s.explanation && <p className="text-[11.5px] text-slate-300 leading-snug mt-1">{s.explanation}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Past releases */}
        {r.history.length > 0 && (
          <section>
            <h4 className="text-[12px] font-semibold text-white mb-2">Past releases</h4>
            <div className="rounded-xl border border-white/[0.07] overflow-hidden">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="bg-white/[0.03] text-slate-500 text-[10px] uppercase tracking-wider">
                    <th className="text-left font-medium px-3 py-1.5">Period</th>
                    <th className="text-right font-medium px-3 py-1.5">Actual</th>
                    <th className="text-right font-medium px-3 py-1.5">Forecast</th>
                    <th className="text-right font-medium px-3 py-1.5">vs forecast</th>
                  </tr>
                </thead>
                <tbody>
                  {r.history.map((h, i) => {
                    const v = versus(h.actual, h.forecast);
                    return (
                      <tr key={h.period + i} className="border-t border-white/[0.05]">
                        <td className="px-3 py-1.5 text-slate-300">{h.period}</td>
                        <td className="px-3 py-1.5 text-right font-semibold text-white tabular-nums">{h.actual}</td>
                        <td className="px-3 py-1.5 text-right text-slate-400 tabular-nums">{h.forecast || '—'}</td>
                        <td className={`px-3 py-1.5 text-right font-medium ${v?.cls || 'text-slate-500'}`}>{v?.label || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Drivers and risks */}
        {(r.drivers.length > 0 || r.risks.length > 0) && (
          <section className="grid sm:grid-cols-2 gap-3">
            {r.drivers.length > 0 && (
              <div>
                <h4 className="text-[12px] font-semibold text-white mb-1.5">What drives it</h4>
                <ul className="space-y-1">
                  {r.drivers.map((d, i) => (
                    <li key={i} className="flex gap-2 text-[11.5px] text-slate-300 leading-snug">
                      <span className="w-1 h-1 rounded-full bg-sky-400 mt-[7px] shrink-0" />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.risks.length > 0 && (
              <div>
                <h4 className="text-[12px] font-semibold text-white mb-1.5 inline-flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 text-amber-300" />Risks to the view</h4>
                <ul className="space-y-1">
                  {r.risks.map((d, i) => (
                    <li key={i} className="flex gap-2 text-[11.5px] text-slate-300 leading-snug">
                      <span className="w-1 h-1 rounded-full bg-amber-400 mt-[7px] shrink-0" />
                      {d}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {/* Sources and actions */}
        <section className="pt-3 border-t border-white/[0.06] space-y-2.5">
          {r.sources.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Newspaper className="w-3.5 h-3.5 text-slate-500" />
              {r.sources.map(s => (
                <span key={s} className="h-5 px-2 rounded-md bg-white/[0.04] text-[10.5px] text-slate-400 inline-flex items-center">{s}</span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10.5px] text-slate-500">Fundamental read, not financial advice. Markets can react in unexpected ways.</p>
            <div className="flex flex-wrap items-center gap-1.5" onPointerEnter={warm} onTouchStart={warm} onFocus={warm}>
              {note && <span role="status" className="text-[10.5px] text-emerald-300">{note}</span>}
              <AskMattButton ask={mattAsk} />
              <button type="button" onClick={save} disabled={!!busy} title="Save the card as a picture" className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-white/[0.1] text-[11px] font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] cursor-pointer disabled:opacity-60 disabled:cursor-wait">
                {busy === 'save' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                Save image
              </button>
              <button type="button" onClick={share} disabled={!!busy} title="Share the card and a short write-up" className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-white/[0.1] text-[11px] font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] cursor-pointer disabled:opacity-60 disabled:cursor-wait">
                {busy === 'share' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                Share
              </button>
              <button type="button" onClick={postOnX} title="Post the key points on X" className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-white/[0.1] text-[11px] font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] cursor-pointer disabled:opacity-60 disabled:cursor-wait">
                <svg viewBox="0 0 24 24" className="w-3 h-3 fill-current" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                Post on X
              </button>
              <button type="button" onClick={copy} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full border border-white/[0.1] text-[11px] font-medium text-slate-300 hover:text-white hover:bg-white/[0.06] cursor-pointer">
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
