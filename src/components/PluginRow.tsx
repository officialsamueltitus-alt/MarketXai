import React from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import type { PluginId } from '../types';
import { PLUGINS } from '../utils/plugins';

/** "Pro" (or "Free until 1 Nov") on a Pro feature */
export const ProBadge: React.FC<{ text: string }> = ({ text }) => (
  <span className="h-[18px] px-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[9.5px] font-semibold text-amber-300 inline-flex items-center shrink-0 whitespace-nowrap">{text}</span>
);

/** One command row: opens the command, and a switch turns it on or off */
export const PluginRow: React.FC<{ id: PluginId; on: boolean; busy?: boolean; compact?: boolean; badge?: string | null; onOpen: () => void; onToggle: () => void }> = ({ id, on, busy, compact, badge, onOpen, onToggle }) => {
  const p = PLUGINS.find(x => x.id === id)!;
  const Icon = p.icon;
  return (
    <div className={`group flex items-center gap-2.5 rounded-2xl border transition-colors ${compact ? 'p-2' : 'p-3'} ${on ? 'bg-white/[0.035] border-white/[0.08] hover:bg-white/[0.06]' : 'bg-white/[0.015] border-white/[0.05]'}`}>
      <button type="button" onClick={onOpen} className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer">
        <span className={`relative ${compact ? 'w-8 h-8' : 'w-10 h-10'} rounded-xl border flex items-center justify-center shrink-0 ${p.tint}`}>
          <Icon className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          {on && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-[var(--mx-bg-2)]" aria-hidden="true" />}
        </span>
        <span className="min-w-0">
          <span className={`flex items-center gap-1.5 ${compact ? 'text-xs' : 'text-sm'} font-medium text-white min-w-0`}>
            <span className="truncate">{p.label}</span>
            {badge && <ProBadge text={badge} />}
          </span>
          <span className="block text-[11px] text-slate-500 truncate">{compact ? p.slash : p.description}</span>
        </span>
        {!compact && <ChevronRight className="ml-auto w-4 h-4 text-slate-600 group-hover:text-slate-300 shrink-0" />}
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${on ? 'Turn off' : 'Turn on'} ${p.label}`}
        title={on ? `Turn off ${p.label}` : `Turn on ${p.label}`}
        disabled={busy}
        onClick={onToggle}
        className={`relative ${compact ? 'h-5 w-9' : 'h-6 w-11'} rounded-full shrink-0 transition-colors cursor-pointer disabled:opacity-60 ${on ? 'bg-emerald-500/80' : 'bg-white/[0.12]'}`}
      >
        {busy ? (
          <Loader2 className="absolute inset-0 m-auto w-3 h-3 animate-spin text-white" />
        ) : (
          <span className={`absolute top-0.5 ${compact ? 'w-4 h-4' : 'w-5 h-5'} rounded-full bg-white shadow transition-all ${on ? (compact ? 'left-[18px]' : 'left-[22px]') : 'left-0.5'}`} />
        )}
      </button>
    </div>
  );
};
