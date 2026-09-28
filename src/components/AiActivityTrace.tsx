import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, X, Square, ArrowUpRight } from 'lucide-react';
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

const Timeline: React.FC<{ steps: ActivityStep[]; now: number; tokens: Record<string, number> | null; newsStepHasNews?: boolean }> = ({
  steps,
  now,
  tokens,
  newsStepHasNews = false,
}) => (
  <ol className="relative">
    {steps.map((step, i) => {
      const last = i === steps.length - 1;
      const elapsed = (step.endedAt ?? now) - step.startedAt;
      const tok = tokens?.[step.id];
      return (
        <li key={step.id} className="mx-rise relative flex gap-3 pb-3 last:pb-0">
          {!last && <span className="absolute left-[7.5px] top-5 bottom-0 w-px bg-white/[0.08]" aria-hidden="true" />}
          <span className="mt-0.5 shrink-0">
            {step.id === 'news' && newsStepHasNews && step.status === 'done' ? (
              <span className="w-4 h-4 rounded-full bg-amber-400/15 flex items-center justify-center">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              </span>
            ) : (
              <StepIcon status={step.status} />
            )}
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

/** Soft yellow dot that marks "today's news is available" */
const NewsDot: React.FC<{ pulse?: boolean; className?: string }> = ({ pulse = false, className = '' }) => (
  <span className={`relative inline-flex w-2 h-2 shrink-0 ${className}`} aria-hidden="true">
    {pulse && <span className="absolute inset-0 rounded-full bg-amber-400/60 mx-ping-live" />}
    <span className="relative w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.15)]" />
  </span>
);

// Today's fundamentals, inside the process report: one aligned list (time | item | tag)
const NewsPanel: React.FC<{ news: NewsBrief }> = ({ news }) => {
  const now = Date.now();
  const events = news.events || [];
  const headlines = (news.headlines || []).filter(h => h && h.title);
  type Row = { key: string; time: string; title: string; meta: string; tag?: { text: string; cls: string }; href?: string | null };
  const rows: Row[] = [
    ...events.map((e, i) => {
      const holiday = e.impact === 'HOLIDAY';
      const upcoming = e.at != null && e.at > now;
      return {
        key: `e${i}`,
        time: e.at == null ? 'All day' : timeFmt(e.at),
        title: e.title,
        meta: [
          e.currency,
          e.at != null ? (upcoming ? untilFmt(e.at - now) : 'released') : '',
          e.forecast ? `forecast ${e.forecast}` : '',
          e.previous ? `previous ${e.previous}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        tag: holiday
          ? { text: 'Holiday', cls: 'bg-sky-500/10 text-sky-300' }
          : upcoming
            ? { text: 'High impact', cls: 'bg-amber-500/15 text-amber-300' }
            : { text: 'Released', cls: 'bg-white/[0.05] text-slate-400' },
      };
    }),
    ...headlines.map((h, i) => ({
      key: `h${i}`,
      time: timeFmt(h.publishedAt),
      title: h.title,
      meta: h.source,
      href: typeof h.url === 'string' && /^https:\/\//i.test(h.url) ? h.url : null,
    })),
  ];

  return (
    <section className="mt-3 pt-3 border-t border-white/[0.06]" aria-label="Today's news">
      <header className="flex items-center gap-2">
        <NewsDot />
        <span className="text-[13px] font-medium text-slate-100">Today's news</span>
        <span className="text-[12px] text-slate-500">{dayFmt(news.day)}</span>
        <span className="ml-auto text-[11px] text-slate-500">Until midnight</span>
      </header>

      {news.guidance && (
        <p className="mt-2 pl-3 border-l-2 border-amber-400/50 text-xs text-slate-300 leading-relaxed">{news.guidance}</p>
      )}

      <ul className="mt-2.5 divide-y divide-white/[0.05] rounded-xl border border-white/[0.06] bg-white/[0.015] overflow-hidden">
        {rows.map(r => {
          const inner = (
            <>
              <span className="text-[11px] font-mono text-slate-500 tabular-nums pt-px">{r.time}</span>
              <span className="min-w-0">
                <span className="block text-[13px] text-slate-200 leading-snug break-words group-hover:text-white">{r.title}</span>
                <span className="block text-[11px] text-slate-500 mt-0.5 truncate">{r.meta}</span>
              </span>
              {r.tag ? (
                <span className={`self-start text-[10px] font-medium px-1.5 h-[18px] rounded-md inline-flex items-center whitespace-nowrap ${r.tag.cls}`}>{r.tag.text}</span>
              ) : r.href ? (
                <ArrowUpRight className="self-start w-3.5 h-3.5 mt-0.5 text-slate-500 group-hover:text-slate-300" />
              ) : (
                <span />
              )}
            </>
          );
          const cls = 'grid grid-cols-[3.75rem_minmax(0,1fr)_auto] items-start gap-x-3 px-3 py-2.5';
          return (
            <li key={r.key}>
              {r.href ? (
                <a href={r.href} target="_blank" rel="noopener noreferrer nofollow" className={`group ${cls} hover:bg-white/[0.03] transition-colors`}>
                  {inner}
                </a>
              ) : (
                <div className={cls}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

// Live, step-by-step view of what MarketX is doing, collapsing to "Worked for Ns" when finished
export const AiActivityTrace: React.FC<AiActivityTraceProps> = ({ steps, running, startedAt, durationSeconds, legacySteps, seed, news }) => {
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  // Mounted on first open and kept, so closing animates too
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (open) setOpened(true);
  }, [open]);

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
        {currentNews && (
          <span className="inline-flex items-center pl-0.5" title={`${newsCount} news item${newsCount === 1 ? '' : 's'} today`}>
            <NewsDot pulse={!open} />
            <span className="sr-only">{`, ${newsCount} news item${newsCount === 1 ? '' : 's'} for today`}</span>
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {/* Smooth expand/collapse (grid rows 0fr -> 1fr) */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          {(open || opened) && (
            <div className="mt-2 mb-1 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
              <Timeline steps={list} now={now} tokens={tokens} newsStepHasNews={!!currentNews} />
              {currentNews && <NewsPanel news={currentNews} />}
              {expiredNews && (
                <p className="mt-3 pt-3 border-t border-white/[0.06] text-xs text-slate-500">
                  The news for {dayFmt(news!.day)} has expired. Run a new analysis for today's news.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
