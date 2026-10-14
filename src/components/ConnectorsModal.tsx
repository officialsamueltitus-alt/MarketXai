import React, { useEffect, useRef, useState } from 'react';
import { Puzzle, X, SlidersHorizontal, ChevronRight, Landmark } from 'lucide-react';
import type { PluginId, PluginStates } from '../types';
import { PLUGINS } from '../utils/plugins';
import { PluginRow } from './PluginRow';

interface ConnectorsModalProps {
  isOpen: boolean;
  onClose: () => void;
  states: PluginStates;
  onOpen: (id: PluginId) => void;
  onToggle: (id: PluginId, enabled: boolean) => Promise<void>;
  /** "Free till 1 Nov" while the commands are open to everyone, "Pro" once they are Pro only */
  badge?: string | null;
  /** Tools without an on/off switch (Preference Mode) */
  onOpenTool?: (id: 'preference' | 'fundamental') => void;
}

const TOOLS = [
  { id: 'preference' as const, label: 'Preference Mode', slash: '/preference', text: 'Your defaults, risk and view', icon: SlidersHorizontal, tint: 'bg-amber-500/15 border-amber-500/30 text-amber-300' },
  { id: 'fundamental' as const, label: 'Fundamental Analysis', slash: '/fundamental-analysis', text: 'CPI, NFP, PPI, rate decisions and the pairs they move', icon: Landmark, tint: 'bg-sky-500/15 border-sky-500/30 text-sky-300' },
];

/** Connectors / Plugins, full view: every command that is on, plus the ones that can be turned on */
export const ConnectorsModal: React.FC<ConnectorsModalProps> = ({ isOpen, onClose, states, onOpen, onToggle, badge, onOpenTool }) => {
  const [busy, setBusy] = useState<PluginId | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);
  if (!isOpen) return null;
  const on = PLUGINS.filter(p => states[p.id]);
  const off = PLUGINS.filter(p => !states[p.id]);
  const toggle = async (id: PluginId) => {
    setBusy(id);
    try {
      await onToggle(id, !states[id]);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-label="Connectors and plugins">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/65 mx-fade-in cursor-default" />
      <section className="mx-sheet relative w-full sm:max-w-md max-h-[88dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[var(--mx-bg-2)] border border-white/[0.08] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)] overflow-hidden">
        <header className="flex items-center gap-2.5 px-5 pt-5 pb-3">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-fuchsia-500/25 to-sky-500/25 border border-white/[0.08] flex items-center justify-center">
            <Puzzle className="w-4 h-4 text-fuchsia-200" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white tracking-tight leading-tight flex items-center gap-2">
              Connectors / Plugins
              {badge && <span className="h-5 px-2 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-semibold text-amber-300 inline-flex items-center">{badge}</span>}
            </h2>
            <p className="text-[11px] text-slate-500">{on.length ? `${on.length} command${on.length === 1 ? '' : 's'} on` : 'No commands on yet'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto w-8 h-8 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] flex items-center justify-center cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-5 space-y-4 border-t border-white/[0.05] pt-3">
          {on.length > 0 && (
            <div>
              <div className="px-1 pb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">In use</div>
              <div className="space-y-2">
                {on.map(p => (
                  <PluginRow key={p.id} id={p.id} on busy={busy === p.id} onOpen={() => onOpen(p.id)} onToggle={() => toggle(p.id)} />
                ))}
              </div>
            </div>
          )}
          {off.length > 0 && (
            <div>
              <div className="px-1 pb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">Available</div>
              <div className="space-y-2">
                {off.map(p => (
                  <PluginRow key={p.id} id={p.id} on={false} busy={busy === p.id} onOpen={() => onOpen(p.id)} onToggle={() => onOpen(p.id)} />
                ))}
              </div>
            </div>
          )}
          {onOpenTool && (
            <div>
              <div className="px-1 pb-2 text-[11px] font-medium uppercase tracking-wider text-slate-500">Tools</div>
              <div className="space-y-2">
                {TOOLS.map(({ id, label, slash, text, icon: Icon, tint }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onOpenTool(id)}
                    className="w-full flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] text-left cursor-pointer transition"
                  >
                    <span className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${tint}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-white">{label} <span className="ml-1 text-[11px] font-mono text-slate-500">{slash}</span></span>
                      <span className="block text-xs text-slate-500 truncate">{text}</span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="text-center text-[11px] text-slate-500">Type a command in the chat, like /watchlist, to open it.</p>
        </div>
      </section>
    </div>
  );
};

export default ConnectorsModal;
