import React, { useEffect, useRef } from 'react';
import { Check, Loader2, X, type LucideIcon } from 'lucide-react';
import { AskMattButton } from './AskMattButton';
import type { MattAsk } from '../utils/matt';

// Shared shell for the command panels (/watchlist, /trade-journal, /track-record): a bottom sheet on phones and a
// right-hand panel on larger screens, with an on/off switch in the header once the command is switched on.
interface PluginSheetProps {
  isOpen: boolean;
  onClose: () => void;
  label: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  /** Icon tile gradient, e.g. "from-violet-500/25 to-sky-500/25" */
  gradient: string;
  iconTone: string;
  /** Shows the switch when the command is on */
  enabled: boolean;
  switching?: boolean;
  onSwitchOff?: () => void;
  children: React.ReactNode;
  /** Pinned under the header (e.g. an add form) */
  toolbar?: React.ReactNode;
  width?: string;
  /** "Ask Matt" about this command, in the header */
  ask?: MattAsk;
}

export const PluginSheet: React.FC<PluginSheetProps> = ({ isOpen, onClose, label, title, subtitle, icon: Icon, gradient, iconTone, enabled, switching, onSwitchOff, children, toolbar, width = 'sm:w-[460px]', ask }) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" aria-label={`Close ${label}`} onClick={onClose} className="absolute inset-0 bg-black/60 mx-fade-in cursor-default" />
      <section className={`mx-sheet absolute inset-x-0 bottom-0 max-h-[92dvh] sm:inset-y-3 sm:right-3 sm:left-auto sm:bottom-3 sm:max-h-none ${width} flex flex-col rounded-t-3xl sm:rounded-3xl bg-[var(--mx-bg-2)] border border-white/[0.08] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)] overflow-hidden`}>
        <div className="sm:hidden flex justify-center pt-2.5" aria-hidden="true">
          <span className="w-10 h-1 rounded-full bg-white/15" />
        </div>
        <header className="flex items-center gap-2.5 px-5 pt-4 sm:pt-5 pb-3">
          <span className={`w-9 h-9 rounded-xl bg-gradient-to-br ${gradient} border border-white/[0.08] flex items-center justify-center shrink-0`}>
            <Icon className={`w-4 h-4 ${iconTone}`} />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white tracking-tight leading-tight">{title}</h2>
            <p className="text-[11px] text-slate-500 truncate">{subtitle}</p>
          </div>
          {ask && <AskMattButton ask={ask} label="Ask" className="ml-auto" />}
          {enabled && onSwitchOff && (
            <button
              type="button"
              role="switch"
              aria-checked="true"
              aria-label={`${label} on`}
              title={`Turn off ${label}`}
              disabled={switching}
              onClick={onSwitchOff}
              className={`${ask ? '' : 'ml-auto'} h-7 w-12 rounded-full bg-emerald-500/80 relative transition-colors cursor-pointer disabled:opacity-60 shrink-0`}
            >
              <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white shadow" />
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className={`${(enabled && onSwitchOff) || ask ? '' : 'ml-auto'} w-8 h-8 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] flex items-center justify-center cursor-pointer shrink-0`}>
            <X className="w-4 h-4" />
          </button>
        </header>
        {toolbar}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-5 border-t border-white/[0.05]">{children}</div>
      </section>
    </div>
  );
};

/** The "turn it on" screen of a command: a glowing icon, what it does, and the approve button */
export const PluginIntro: React.FC<{
  icon: LucideIcon;
  glow: string;
  ring: string;
  title: string;
  text: string;
  points: Array<{ icon: LucideIcon; tone: string; t: string; d: string }>;
  cta: string;
  ctaGradient: string;
  busy?: boolean;
  onApprove: () => void;
  onLater: () => void;
  footnote: string;
}> = ({ icon: Icon, glow, ring, title, text, points, cta, ctaGradient, busy, onApprove, onLater, footnote }) => (
  <div className="pt-6 text-center">
    <div className="relative mx-auto w-24 h-24">
      <span className={`absolute inset-0 rounded-full ${glow} animate-ping [animation-duration:2.4s]`} />
      <span className={`absolute inset-2 rounded-full bg-gradient-to-br ${ring} border border-white/10`} />
      <span className="absolute inset-0 flex items-center justify-center">
        <Icon className="w-9 h-9 text-white" />
      </span>
    </div>
    <h3 className="mt-5 text-xl font-semibold text-white tracking-tight">{title}</h3>
    <p className="mt-1.5 text-sm text-slate-400 leading-relaxed px-2">{text}</p>
    <ul className="mt-5 space-y-2 text-left">
      {points.map(({ icon: PIcon, tone, t, d }) => (
        <li key={t} className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06]">
          <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
            <PIcon className="w-4 h-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium text-white">{t}</span>
            <span className="block text-xs text-slate-500">{d}</span>
          </span>
        </li>
      ))}
    </ul>
    <button
      type="button"
      disabled={busy}
      onClick={onApprove}
      className={`mt-5 w-full h-12 rounded-2xl bg-gradient-to-r ${ctaGradient} text-white text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-[0_12px_40px_-12px_rgba(99,102,241,.8)] hover:brightness-110 active:scale-[0.99] transition cursor-pointer disabled:opacity-70`}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
      {cta}
    </button>
    <button type="button" onClick={onLater} className="mt-2 w-full h-10 rounded-2xl text-sm text-slate-400 hover:text-white cursor-pointer">
      Not now
    </button>
    <p className="mt-2 text-[11px] text-slate-500">{footnote}</p>
  </div>
);

export const ago = (ts: number) => {
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};
