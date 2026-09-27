import React, { useEffect, useState } from 'react';
import { Check, ChevronDown, X, Square } from 'lucide-react';
import { ActivityStep, ReasoningStep } from '../types';

interface AiActivityTraceProps {
  steps?: ActivityStep[];
  running: boolean;
  startedAt: number;
  durationSeconds?: number;
  /** Older saved messages only have static reasoning steps */
  legacySteps?: ReasoningStep[];
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

const Timeline: React.FC<{ steps: ActivityStep[]; now: number }> = ({ steps, now }) => (
  <ol className="relative">
    {steps.map((step, i) => {
      const last = i === steps.length - 1;
      const elapsed = (step.endedAt ?? now) - step.startedAt;
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
              {(step.status === 'active' || elapsed >= 100) && (
                <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">{formatElapsed(elapsed)}</span>
              )}
            </div>
            {step.detail && <p className="text-xs text-slate-500 leading-snug mt-0.5 break-words">{step.detail}</p>}
          </div>
        </li>
      );
    })}
  </ol>
);

// Live, step-by-step view of what MarketX is doing, collapsing to "Worked for Ns" when finished
export const AiActivityTrace: React.FC<AiActivityTraceProps> = ({ steps, running, startedAt, durationSeconds, legacySteps }) => {
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

  if (running) {
    const active = [...list].reverse().find(s => s.status === 'active');
    return (
      <div className="w-full max-w-2xl" aria-live="polite">
        <div className="flex items-center gap-2.5">
          <span className="relative w-2 h-2 shrink-0" aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-indigo-400/60 animate-ping" />
            <span className="absolute inset-0 rounded-full bg-indigo-300" />
          </span>
          <span className="mx-shimmer text-sm font-medium truncate">{active?.title || 'Thinking'}</span>
          <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0">{formatElapsed(now - startedAt)}</span>
        </div>
        {list.length > 0 && (
          <div className="mt-3 ml-[3px] pl-4 border-l border-white/[0.06]">
            <Timeline steps={list} now={now} />
          </div>
        )}
      </div>
    );
  }

  if (!list.length) return null;
  const total = durationSeconds != null ? durationSeconds * 1000 : list.reduce((a, s) => a + ((s.endedAt ?? s.startedAt) - s.startedAt), 0);
  const failed = list.some(s => s.status === 'error');
  const stopped = list.some(s => s.status === 'stopped');

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
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mx-fade-in mt-2 mb-1 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5">
          <Timeline steps={list} now={now} />
        </div>
      )}
    </div>
  );
};
