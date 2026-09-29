import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Megaphone, X } from 'lucide-react';
import { AppNotification } from '../types';
import { MarketXIcon } from './MarketXIcon';
import { getApiUrl } from '../utils/api';

/** A broadcast picture: only the site's own image endpoint is ever loaded */
export const safeBroadcastImage = (src: unknown): string | null =>
  typeof src === 'string' && /^\/api\/broadcast-image\/bc-\d{10,15}-[0-9a-f]{6}$/.test(src) ? getApiUrl(src) : null;
/** The full, original picture (opened on tap) for a broadcast picture */
export const fullBroadcastImage = (src: unknown): string | null => {
  const s = safeBroadcastImage(src);
  return s ? `${s}/full` : null;
};

/** https links in plain text become safe anchors; everything else stays text (never HTML). */
export const LinkifiedText: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  const parts = text.split(/(https:\/\/[^\s<>"')\]]+)/g);
  return (
    <span className={className}>
      {parts.map((part, i) =>
        /^https:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-indigo-300 underline decoration-indigo-300/40 underline-offset-2 hover:decoration-indigo-300 break-all"
            onClick={e => e.stopPropagation()}
          >
            {part.replace(/^https:\/\/(www\.)?/, '')}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </span>
  );
};

/** Blank lines split paragraphs; single line breaks are kept. */
export const AnnouncementBody: React.FC<{ message: string; className?: string }> = ({ message, className = '' }) => (
  <div className={`space-y-3 ${className}`}>
    {message
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(Boolean)
      .map((p, i) => (
        <p key={i} className="whitespace-pre-line break-words">
          <LinkifiedText text={p} />
        </p>
      ))}
  </div>
);

export const safeAnnouncementLink = (n: AppNotification) => (typeof n.link === 'string' && /^https:\/\/[^\s<>"']+$/i.test(n.link) ? n.link : null);

export const formatAnnouncementDate = (ts: number) =>
  new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

interface AnnouncementModalProps {
  announcement: AppNotification | null;
  onClose: () => void;
}

// A message from the MarketX team: bottom sheet on phones, centred card on larger screens
export const AnnouncementModal: React.FC<AnnouncementModalProps> = ({ announcement, onClose }) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!announcement) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    closeBtn.current?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [announcement]);

  if (!announcement || typeof document === 'undefined') return null;
  const link = safeAnnouncementLink(announcement);
  const image = safeBroadcastImage(announcement.image);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-5" role="dialog" aria-modal="true" aria-label="Announcement">
      <button type="button" aria-label="Close announcement" onClick={onClose} className="absolute inset-0 bg-black/70 mx-fade-in cursor-default" />
      <article className="mx-pop-in relative w-full sm:max-w-lg max-h-[88dvh] flex flex-col rounded-t-[28px] sm:rounded-[28px] bg-[var(--mx-bg-2)] border border-white/[0.08] shadow-[0_30px_90px_-20px_rgba(0,0,0,0.85)] overflow-hidden">
        {/* Header */}
        <header className="relative shrink-0 px-5 sm:px-6 pt-5 pb-4 border-b border-white/[0.06] bg-gradient-to-b from-indigo-500/[0.12] to-transparent">
          <div className="sm:hidden flex justify-center -mt-2 mb-3" aria-hidden="true">
            <span className="w-10 h-1 rounded-full bg-white/15" />
          </div>
          <div className="flex items-center gap-3">
            <span className="relative w-10 h-10 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0">
              <MarketXIcon size="sm" />
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center ring-2 ring-[var(--mx-bg-2)]">
                <Megaphone className="w-2.5 h-2.5" />
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-white">MarketX Team</span>
              <span className="block text-[11px] text-slate-400">Announcement · {formatAnnouncementDate(announcement.timestamp)}</span>
            </span>
            <button
              ref={closeBtn}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-9 h-9 -mr-1 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] flex items-center justify-center shrink-0 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <h2 className="mt-4 text-lg sm:text-xl font-semibold text-white tracking-tight leading-snug break-words">{announcement.title}</h2>
        </header>

        {/* Message */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6 py-4 text-[15px] text-slate-300 leading-relaxed">
          {image && (
            <a href={fullBroadcastImage(announcement.image) || image} target="_blank" rel="noopener noreferrer" className="block mb-4" aria-label="Open the full picture">
              <img src={image} alt="" loading="lazy" className="w-full h-auto max-h-[60dvh] object-contain rounded-2xl border border-white/[0.08] bg-black/30" />
              <span className="mt-1.5 block text-center text-[11px] text-slate-500">Tap the picture to view it in full</span>
            </a>
          )}
          <AnnouncementBody message={announcement.message || ''} />
        </div>

        {/* Actions */}
        <footer className="shrink-0 px-5 sm:px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-white/[0.06] flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`h-11 px-5 rounded-2xl text-sm font-semibold cursor-pointer transition ${
              link ? 'border border-white/[0.12] text-slate-200 hover:bg-white/[0.06]' : 'bg-white text-slate-950 hover:bg-slate-200'
            }`}
          >
            Got it
          </button>
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="h-11 px-5 rounded-2xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 transition inline-flex items-center justify-center gap-1.5"
            >
              Learn more <ArrowUpRight className="w-4 h-4" />
            </a>
          )}
        </footer>
      </article>
    </div>,
    document.body
  );
};
