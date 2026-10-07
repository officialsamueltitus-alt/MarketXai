import React, { useEffect, useState } from 'react';
import { Check, Layers } from 'lucide-react';
import { SUPPORTED_TIMEFRAMES } from '../utils/timeframe';
import { normalizeRdmTimeframes, rdmLabel } from '../utils/preferences';

// Which timeframes RDM scans. One setting (Preference Mode, `rdmTimeframes`) shared by the composer, the RDM analysis and
// RDM pairs on the watchlist: [] means every timeframe. Picking here saves it, so the choice works everywhere.
interface RdmTimeframePickerProps {
  /** The saved choice ([] = all) */
  value: string[];
  /** Saves a new choice ([] = all) */
  onChange: (next: string[]) => Promise<void> | void;
  /** Smaller chips for the composer pop-up and the watchlist */
  compact?: boolean;
  disabled?: boolean;
}

const label = (tf: string) => tf.replace(/^(\d+)M$/, '$1m');

export const RdmTimeframePicker: React.FC<RdmTimeframePickerProps> = ({ value, onChange, compact, disabled }) => {
  // Shown at once; follows the saved value when it changes elsewhere (or when a save fails)
  const [choice, setChoice] = useState<string[]>(() => normalizeRdmTimeframes(value) || []);
  const [hint, setHint] = useState<string | null>(null);
  useEffect(() => setChoice(normalizeRdmTimeframes(value) || []), [value]);

  const all = choice.length === 0;
  const isOn = (tf: string) => !all && choice.includes(tf);
  const commit = async (next: string[]) => {
    const clean = normalizeRdmTimeframes(next) || [];
    const before = choice;
    setChoice(clean);
    setHint(null);
    try {
      await onChange(clean);
    } catch (err: any) {
      setChoice(before);
      setHint(err?.message || 'Could not save that. Try again.');
    }
  };
  const toggle = (tf: string) => {
    // From "All", the first tap starts a choice with that timeframe; after that each tap adds or removes one
    const next = all ? [tf] : choice.includes(tf) ? choice.filter(x => x !== tf) : [...choice, tf];
    if (!next.length) {
      setHint('Keep at least one timeframe, or choose All.');
      return;
    }
    commit(next);
  };

  const chip = (on: boolean) =>
    `${compact ? 'h-7 px-2 text-[11px] rounded-lg' : 'h-8 px-2.5 text-xs rounded-xl'} shrink-0 font-mono font-semibold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
      on ? 'bg-indigo-500/20 text-indigo-100 border-indigo-400/50' : 'text-slate-400 border-white/[0.08] bg-white/[0.02] hover:text-white hover:bg-white/[0.06]'
    }`;

  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Timeframes RDM scans">
        <button
          type="button"
          aria-pressed={all}
          disabled={disabled}
          onClick={() => !all && commit([])}
          className={`${chip(all)} font-sans inline-flex items-center gap-1`}
          title="RDM scans every timeframe"
        >
          <Layers className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} /> All
        </button>
        {SUPPORTED_TIMEFRAMES.map(tf => (
          <button
            key={tf}
            type="button"
            aria-pressed={isOn(tf)}
            disabled={disabled}
            onClick={() => toggle(tf)}
            className={chip(isOn(tf))}
            title={isOn(tf) ? `Remove the ${label(tf)} from RDM` : all ? `Scan only the ${label(tf)} (tap more to add)` : `Add the ${label(tf)} to RDM`}
          >
            {label(tf)}
          </button>
        ))}
      </div>
      <p className={`mt-1.5 ${compact ? 'text-[10px]' : 'text-[11px]'} leading-snug ${hint ? 'text-amber-300' : 'text-slate-500'}`} aria-live="polite">
        {hint || (
          <>
            <Check className="inline w-3 h-3 -mt-0.5 mr-0.5 text-emerald-300" />
            RDM scans {all ? 'every timeframe' : rdmLabel(choice)} and picks the strongest setup. Saved to Preference Mode, used everywhere.
          </>
        )}
      </p>
    </div>
  );
};
