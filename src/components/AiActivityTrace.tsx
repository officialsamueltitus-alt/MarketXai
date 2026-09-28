import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, X, Square, Newspaper, CalendarClock, ArrowUpRight, Landmark } from 'lucide-react';
import { ActivityStep, NewsBrief, ReasoningStep } from '../types';
import { allocateTokens, formatTokens, promptTokenBudget } from '../utils/tokens';

interface AiActivityTraceProps {
  steps?: ActivityStep[];
  running: boolean;
  startedAt: number;
  durationSeconds?: number;
  /** Older saved messages only have static reasoning steps */
  legacySteps?: ReasoningStep[];
  /** Stable id (message id) that fixes this prompt's random token count */
  seed?: string | number;
  /** Today's fundamentals for this analysis (shown inside the report while the reader's day lasts) */
  news?: NewsBrief | null;
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function formatPriceShort(n: number): string {
  if (!Number.isFinite(n)) return '-';
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 10 ? 2 : abs >= 1 ? 4 : 5;
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const StepIcon: React.FC<{ status: ActivityStep['status'] }> = ({ status }) => {
  if (status === 'active') {
    return (
      <span className="relative w-4 h-4 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-white/10 border-t-indigo-300 animate-spin" />
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="w-4 h-4 rounded-full bg-rose-500/20 text-rose-300 flex items-center justify-center">
        <X className="w-2.5 h-2.5" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'stopped') {
    return (
      <span className="w-4 h-4 rounded-full bg-white/[0.08] text-slate-400 flex items-center justify-center">
        <Square className="w-2 h-2 fill-current" />
      </span>
    );
  }
  return (
    <span className="w-4 h-4 rounded-full bg-emerald-500/15 text-emerald-300 flex items-center justify-center">
      <Check className="w-2.5 h-2.5" strokeWidth={3} />
    </span>
  );
};

// Tokens per step. Finished runs use the exact allocation; while running, done steps show their
// share and the active analysis step counts up towards its budget in real time.
function stepTokens(steps: ActivityStep[], now: number, running: boolean, seed: string | number): Record<string, number> | null {
  const main = steps.find(s => s.id === 'analyze');
  if (!main) return null;
  const weights: Record<string, number> = {};
  for (const s of steps) if (s.tokenWeight) weights[s.id] = s.tokenWeight;
  const budget = promptTokenBudget(seed);
  if (!running) {
    if (main.status !== 'done') return null; // failed or stopped runs are not charged
    return allocateTokens(steps.map(s => s.id), budget, seed, weights);
  }
  const expected = allocateTokens([...steps.map(s => s.id), 'plan', 'news'], budget, seed, weights);
  const out: Record<string, number> = {};
  for (const s of steps) {
    if (s.id === 'analyze') {
      const t = Math.max(0, (s.endedAt ?? now) - s.startedAt);
      out[s.id] = Math.round(expected.analyze * 0.97 * (1 - Math.exp(-t / 9000)));
    } else if (s.status === 'done') {
      out[s.id] = expected[s.id] ?? 0;
    } else if (s.status === 'active') {
      const t = Math.max(0, now - s.startedAt);
      out[s.id] = Math.round((expected[s.id] ?? 0) * Math.min(0.95, t / 1500));
    }
  }
  return out;
}

const Timeline: React.FC<{ steps: ActivityStep[]; now: number; tokens: Record<string, number> | null }> = ({ steps, now, tokens }) => (
  <ol className="relative">
    {steps.map((step, i) => {
      const last = i === steps.length - 1;
      const elapsed = (step.endedAt ?? now) - step.startedAt;
      const tok = tokens?.[step.id];
      return (
        <li key={step.id} className="mx-rise relative flex gap-3 pb-3 last:pb-0">
          {!last && <span className="absolute left-[7.5px] top-5 bottom-0 w-px bg-white/[0.08]" aria-hidden="true" />}
          <span className="mt-0.5 shrink-0">
            <StepIcon status={step.status} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`text-[13px] leading-5 ${step.status === 'active' ? 'text-slate-100' : step.status === 'error' ? 'text-rose-200' : 'text-slate-300'}`}>
                {step.title}
              </span>
              <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
                {(step.status === 'active' || elapsed >= 100) && formatElapsed(elapsed)}
                {(step.status === 'active' || elapsed >= 100) && tok ? ' · ' : ''}
                {tok ? `${formatTokens(tok)} tokens` : ''}
              </span>
            </div>
            {step.detail && <p className="text-xs text-slate-500 leading-snug mt-0.5 break-words">{step.detail}</p>}
          </div>
        </li>
      );
    })}
  </ol>
);

const timeFmt = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFmt = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
};
const untilFmt = (ms: number) => {
  const min = Math.round(ms / 60000);
  return min < 60 ? `in ${Math.max(1, min)}m` : `in ${Math.floor(min / 60)}h ${min % 60}m`;
};

/** A brief is only shown on the reader's day it was made for */
export const isNewsCurrent = (news?: NewsBrief | null, now = Date.now()): news is NewsBrief =>
  !!news && Number.isFinite(news.expiresAt) && now < news.expiresAt && (news.events?.length > 0 || news.headlines?.length > 0);

// Today's fundamentals, inside the process report
const NewsPanel: React.FC<{ news: NewsBrief }> = ({ news }) => {
  const now = Date.now();
  const events = news.events || [];
  const headlines = (news.headlines || []).filter(h => h && h.title);
  return (
    <section className="mt-3.5 pt-3.5 border-t border-white/[0.06]" aria-label="Today's news">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-[13px] font-medium text-slate-100">
          <span className="w-6 h-6 rounded-lg bg-amber-500/15 text-amber-300 flex items-center justify-center">
            <Newspaper className="w-3.5 h-3.5" />
          </span>
          Today's news · {dayFmt(news.day)}
        </span>
        <span className="text-[11px] text-slate-500 shrink-0">Valid until midnight</span>
      </div>

      {news.guidance && (
        <p className="mt-2.5 rounded-xl border border-amber-400/20 bg-amber-500/[0.07] px-3 py-2 text-xs text-amber-100/90 leading-relaxed">{news.guidance}</p>
      )}

      {events.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {events.map((e, i) => {
            const holiday = e.impact === 'HOLIDAY';
            const upcoming = e.at != null && e.at > now;
            return (
              <li key={`${e.title}-${i}`} className="flex items-start gap-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05] px-3 py-2">
                <span className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${holiday ? 'bg-sky-500/15 text-sky-300' : 'bg-rose-500/15 text-rose-300'}`}>
                  {holiday ? <Landmark className="w-3.5 h-3.5" /> : <CalendarClock className="w-3.5 h-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[13px] text-slate-100 leading-5">{e.title}</span>
                    <span className="text-[10px] font-semibold tracking-wide px-1.5 h-4 rounded bg-white/[0.06] text-slate-300 inline-flex items-center">{e.currency}</span>
                    <span className={`text-[10px] font-semibold tracking-wide px-1.5 h-4 rounded inline-flex items-center ${holiday ? 'bg-sky-500/15 text-sky-300' : 'bg-rose-500/15 text-rose-300'}`}>
                      {holiday ? 'BANK HOLIDAY' : 'HIGH IMPACT'}
                    </span>
                  </span>
                  <span className="block text-[11px] text-slate-500 mt-0.5 tabular-nums">
                    {e.at == null ? 'All day' : timeFmt(e.at)}
                    {e.at != null && (upcoming ? ` · ${untilFmt(e.at - now)}` : ' · released')}
                    {e.forecast ? ` · forecast ${e.forecast}` : ''}
                    {e.previous ? ` · previous ${e.previous}` : ''}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {headlines.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1.5">Headlines today</p>
          <ul className="space-y-1">
            {headlines.map((h, i) => {
              const safe = typeof h.url === 'string' && /^https:\/\//i.test(h.url) ? h.url : null;
              const body = (
                <>
                  <span className="text-[13px] text-slate-200 leading-snug group-hover:text-white">{h.title}</span>
                  <span className="block text-[11px] text-slate-500 mt-0.5">
                    {h.source} · {timeFmt(h.publishedAt)}
                  </span>
                </>
              );
              return (
                <li key={`${h.title}-${i}`}>
                  {safe ? (
                    <a href={safe} target="_blank" rel="noopener noreferrer nofollow" className="group flex items-start gap-2 rounded-lg px-2 py-1.5 -mx-2 hover:bg-white/[0.04] transition-colors">
                      <span className="min-w-0 flex-1">{body}</span>
                      <ArrowUpRight className="w-3.5 h-3.5 mt-0.5 text-slate-500 group-hover:text-slate-300 shrink-0" />
                    </a>
                  ) : (
                    <div className="px-2 py-1.5 -mx-2">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
};

// Live, step-by-step view of what MarketX is doing, collapsing to "Worked for Ns" when finished
export const AiActivityTrace: React.FC<AiActivityTraceProps> = ({ steps, running, startedAt, durationSeconds, legacySteps, seed, news }) => {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [running]);

  // Normalise legacy saved steps so older chats still show their trace
  const list: ActivityStep[] =
    steps && steps.length
      ? steps
      : (legacySteps || []).map((s, i) => {
          const ms = (parseFloat(s.time) || 0) * 1000;
          return { id: `legacy-${i}`, title: s.title, detail: s.detail, status: 'done' as const, startedAt: 0, endedAt: ms };
        });

  const tokenSeed = seed ?? startedAt;
  const tokens = stepTokens(list, now, running, tokenSeed);
  const tokenTotal = tokens ? Object.values(tokens).reduce((a, b) => a + b, 0) : 0;

  if (running) {
    const active = [...list].reverse().find(s => s.status === 'active');
    return (
      <div className="w-full max-w-2xl" aria-live="polite">
        <div className="flex items-center gap-2.5">
          <span className="relative w-2 h-2 shrink-0" aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-indigo-400/60 mx-ping-live" />
            <span className="absolute inset-0 rounded-full bg-indigo-300" />
          </span>
          <span className="mx-shimmer text-sm font-medium truncate">{active?.title || 'Thinking'}</span>
          <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">
            {formatElapsed(now - startedAt)}
            {tokenTotal > 0 && ` · ${formatTokens(tokenTotal)} tokens`}
          </span>
        </div>
        {list.length > 0 && (
          <div className="mt-3 ml-[3px] pl-4 border-l border-white/[0.06]">
            <Timeline steps={list} now={now} tokens={tokens} />
          </div>
        )}
      </div>
    );
  }

  const currentNews = isNewsCurrent(news) ? news : null;
  const newsCount = currentNews ? currentNews.events.length + currentNews.headlines.length : 0;
  const expiredNews = !!news && !currentNews && Number.isFinite(news.expiresAt) && Date.now() >= news.expiresAt;

  if (!list.length) return null;
  const total = durationSeconds != null ? durationSeconds * 1000 : list.reduce((a, s) => a + ((s.endedAt ?? s.startedAt) - s.startedAt), 0);
  // The main analysis step decides the outcome (a skipped price check is not a failure)
  const main = list.find(s => s.id === 'analyze');
  const failed = main ? main.status === 'error' : list.some(s => s.status === 'error');
  const stopped = main ? main.status === 'stopped' : false;

  return (
    <div className="w-full max-w-2xl">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="group inline-flex items-center gap-1.5 h-7 -ml-1 px-1 rounded-lg text-[13px] text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
      >
        <span>
          {stopped ? 'Stopped after' : failed ? 'Ran into a problem after' : 'Worked for'} {formatElapsed(total)}
        </span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-500">
          {list.length} step{list.length === 1 ? '' : 's'}
        </span>
        {tokens && (
          <>
            <span className="text-slate-600">·</span>
            <span className="text-slate-500 tabular-nums">{formatTokens(tokenTotal || promptTokenBudget(tokenSeed))} tokens</span>
          </>
        )}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        {currentNews && (
          <span className="ml-1 inline-flex items-center gap-1 h-5 px-2 rounded-full bg-amber-500/15 text-[11px] font-medium text-amber-300">
            <Newspaper className="w-3 h-3" /> {newsCount} news today
          </span>
        )}
      </button>
      {open && (
        <div className="mx-fade-in mt-2 mb-1 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
          <Timeline steps={list} now={now} tokens={tokens} />
          {currentNews && <NewsPanel news={currentNews} />}
          {expiredNews && (
            <p className="mt-3.5 pt-3 border-t border-white/[0.06] text-xs text-slate-500">
              The news for {dayFmt(news!.day)} has expired. Run a new analysis for today's news.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
