import React, { useEffect, useState } from 'react';
import { Landmark, Loader2, CalendarClock, Newspaper, History, Target, ArrowUpRight, ArrowDownRight, ChevronRight } from 'lucide-react';
import { PluginSheet } from './PluginSheet';
import { apiFetch } from '../utils/apiClient';
import { FUNDAMENTAL_EXAMPLES } from '../utils/fundamental';

// /fundamental-analysis: switch the command on or off, see how it works, pick a topic or one of this week's
// high-impact releases. While it is on, "/fundamental-analysis <topic>" gets a fundamental read; every other prompt
// stays a normal analysis.

interface Upcoming {
  title: string;
  currency: string;
  at: number;
  forecast: string;
  previous: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  enabled: boolean;
  /** Turns the command on or off (saved on the account) */
  onSetEnabled: (enabled: boolean) => Promise<void>;
  /** Asks a fundamental question in the chat (turns the command on first when needed) */
  onAsk: (prompt: string) => void;
}

const STEPS = [
  { icon: History, title: 'Past releases', text: 'The last releases against their forecasts, and the trend they show.' },
  { icon: Newspaper, title: 'The news', text: 'BBC, CNBC, MarketWatch and a live search of reputable sources.' },
  { icon: Target, title: 'Most likely outcome', text: 'Each scenario with its odds, then the outcome most likely to print.' },
  { icon: ArrowUpRight, title: 'Pairs, for or against', text: 'The pairs it moves most, with live prices, and whether it favours them.' },
];

const dayTime = (ms: number) => new Date(ms).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

export const FundamentalPanel: React.FC<Props> = ({ isOpen, onClose, enabled, onSetEnabled, onAsk }) => {
  const [busy, setBusy] = useState(false);
  const [upcoming, setUpcoming] = useState<Upcoming[] | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let live = true;
    apiFetch<{ enabled: boolean; upcoming: Upcoming[] }>('/api/fundamental')
      .then(d => live && setUpcoming(Array.isArray(d.upcoming) ? d.upcoming : []))
      .catch(() => live && setUpcoming([]));
    return () => {
      live = false;
    };
  }, [isOpen]);

  const toggle = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await onSetEnabled(next);
    } finally {
      setBusy(false);
    }
  };
  const ask = (prompt: string) => {
    onAsk(prompt);
    onClose();
  };

  return (
    <PluginSheet
      isOpen={isOpen}
      onClose={onClose}
      label="Fundamental Analysis"
      title="Fundamental Analysis"
      subtitle="CPI, NFP, PPI, rate decisions: the likely outcome and the pairs it moves"
      icon={Landmark}
      gradient="from-sky-500/25 to-amber-500/20"
      iconTone="text-sky-300"
      enabled={enabled}
      switching={busy}
      onSwitchOff={() => toggle(false)}
      ask={{ q: 'How does Fundamental Analysis work on MarketX, and how do I read the result?', label: 'Fundamental Analysis' }}
    >
      <div className="pt-4 space-y-5">
        {/* On / off */}
        <div className={`rounded-2xl border p-4 ${enabled ? 'border-emerald-400/25 bg-emerald-500/[0.06]' : 'border-white/[0.08] bg-white/[0.02]'}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-white">{enabled ? 'Fundamental Analysis is on' : 'Turn on Fundamental Analysis'}</div>
              <p className="text-[12px] text-slate-400 mt-1 leading-relaxed">
                {enabled ? (
                  <>
                    Type <b className="text-sky-200 font-mono text-[11.5px]">/fundamental-analysis</b> then what you want read, e.g.{' '}
                    <b className="text-sky-200 font-mono text-[11.5px]">/fundamental-analysis CPI</b>. Everything else you ask stays a normal analysis.
                  </>
                ) : (
                  'Turn it on, then type /fundamental-analysis followed by a release or market (CPI, NFP, PPI, a rate decision) for the likely outcome and the pairs it moves. Your normal analyses work as usual.'
                )}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              aria-label="Fundamental Analysis"
              disabled={busy}
              onClick={() => toggle(!enabled)}
              className={`h-7 w-12 rounded-full relative transition-colors cursor-pointer disabled:opacity-60 shrink-0 ${enabled ? 'bg-emerald-500/80' : 'bg-white/[0.12]'}`}
            >
              {busy ? (
                <Loader2 className="w-4 h-4 animate-spin text-white absolute top-1.5 left-4" />
              ) : (
                <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${enabled ? 'right-1' : 'left-1'}`} />
              )}
            </button>
          </div>
          <p className="text-[11px] text-slate-500 mt-2.5">Uses one analysis credit per read. A question that isn't about fundamentals is refunded.</p>
        </div>

        {/* How it works */}
        <section>
          <h3 className="text-[12px] font-semibold text-white mb-2">What you get</h3>
          <div className="grid grid-cols-2 gap-2">
            {STEPS.map(s => (
              <div key={s.title} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                <s.icon className="w-4 h-4 text-sky-300" />
                <div className="text-[12px] font-semibold text-slate-100 mt-1.5">{s.title}</div>
                <p className="text-[11px] text-slate-400 leading-snug mt-0.5">{s.text}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-2.5 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1"><ArrowUpRight className="w-3.5 h-3.5 text-emerald-300" /><b className="text-emerald-300">For</b> favours the pair rising</span>
            <span className="inline-flex items-center gap-1"><ArrowDownRight className="w-3.5 h-3.5 text-rose-300" /><b className="text-rose-300">Against</b> weighs on it</span>
          </div>
        </section>

        {/* Quick topics */}
        <section>
          <h3 className="text-[12px] font-semibold text-white mb-2">Ask about</h3>
          <div className="flex flex-wrap gap-1.5">
            {FUNDAMENTAL_EXAMPLES.map(e => (
              <button
                key={e.label}
                type="button"
                onClick={() => ask(e.prompt)}
                className="h-8 px-3 rounded-full border border-sky-400/25 bg-sky-500/[0.07] hover:bg-sky-500/[0.15] text-[12px] font-medium text-sky-100 cursor-pointer transition-colors"
              >
                {e.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-2">Or type your own: "/fundamental-analysis How will the BoE decision affect GBP/USD?", "/fundamental-analysis gold this week". Analysis cards with today's news also have a <b className="text-sky-300">Check fundamental</b> button.</p>
        </section>

        {/* This week */}
        <section>
          <h3 className="text-[12px] font-semibold text-white mb-2 inline-flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5 text-amber-300" /> High-impact releases this week
          </h3>
          {upcoming === null ? (
            <div className="flex items-center gap-2 text-[12px] text-slate-500 py-3">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading the calendar…
            </div>
          ) : upcoming.length === 0 ? (
            <p className="text-[12px] text-slate-500 py-2">No more high-impact releases on this week's calendar.</p>
          ) : (
            <div className="rounded-2xl border border-white/[0.07] divide-y divide-white/[0.05] overflow-hidden">
              {upcoming.map(e => (
                <button
                  key={e.title + e.at}
                  type="button"
                  onClick={() => ask(`${e.currency} ${e.title} release`)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.04] cursor-pointer transition-colors"
                >
                  <span className="w-11 h-7 rounded-md bg-white/[0.06] text-[11px] font-bold text-slate-200 flex items-center justify-center shrink-0">{e.currency}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-slate-100 truncate">{e.title}</span>
                    <span className="block text-[11px] text-slate-500 truncate">
                      {dayTime(e.at)}
                      {e.forecast ? ` · forecast ${e.forecast}` : ''}
                      {e.previous ? ` · previous ${e.previous}` : ''}
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </PluginSheet>
  );
};
