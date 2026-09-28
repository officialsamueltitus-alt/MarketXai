import React, { useEffect, useState } from 'react';
import { Info, CheckCircle2, AlertTriangle, X, ArrowUpRight } from 'lucide-react';
import { getApiUrl } from '../utils/api';

interface Banner {
  id: string;
  title: string;
  message: string;
  tone: 'info' | 'success' | 'warning';
  link?: string | null;
}

const TONES = {
  info: { cls: 'bg-indigo-500/12 text-indigo-100 border-indigo-400/20', icon: Info },
  success: { cls: 'bg-emerald-500/12 text-emerald-100 border-emerald-400/20', icon: CheckCircle2 },
  warning: { cls: 'bg-amber-500/12 text-amber-100 border-amber-400/20', icon: AlertTriangle },
};

const KEY = 'mx_banner_dismissed';

// Site-wide notice published from the admin console; dismissible per banner
export const SiteBanner: React.FC = () => {
  const [banner, setBanner] = useState<Banner | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      fetch(getApiUrl('/api/site/banner'))
        .then(r => (r.ok ? r.json() : null))
        .then(d => alive && setBanner(d?.banner || null))
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!banner || banner.id === dismissed) return null;
  const { cls, icon: Icon } = TONES[banner.tone] || TONES.info;
  const link = banner.link && /^https:\/\/[^\s<>"']+$/i.test(banner.link) ? banner.link : null;
  const long = (banner.message || '').length > 70;

  return (
    <div className="mx-fade-in relative z-40 px-2 sm:px-4 pt-2" role="status" aria-label="Announcement">
      <div className={`max-w-5xl mx-auto rounded-2xl border ${cls} flex items-start gap-2.5 sm:gap-3 pl-3 pr-1.5 py-2 sm:py-2.5`}>
        <span className="mt-0.5 w-6 h-6 rounded-lg bg-white/[0.08] flex items-center justify-center shrink-0">
          <Icon className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0 flex-1 text-[13px] leading-snug">
          <p className="min-w-0">
            <span className="font-semibold break-words">{banner.title}</span>
            {banner.message && (
              <span className={`opacity-80 break-words ${expanded ? '' : 'max-sm:line-clamp-1'} max-sm:block sm:inline`}>
                <span className="hidden sm:inline"> · </span>
                {banner.message}
              </span>
            )}
          </p>
          {(link || long) && (
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              {long && (
                <button type="button" onClick={() => setExpanded(v => !v)} className="sm:hidden text-xs font-medium underline underline-offset-2 opacity-90 cursor-pointer">
                  {expanded ? 'Show less' : 'Read more'}
                </button>
              )}
              {link && (
                <a href={link} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-0.5 text-xs font-semibold underline underline-offset-2">
                  Learn more <ArrowUpRight className="w-3 h-3" />
                </a>
              )}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss notice"
          onClick={() => {
            setDismissed(banner.id);
            try {
              localStorage.setItem(KEY, banner.id);
            } catch {}
          }}
          className="w-8 h-8 rounded-full inline-flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-white/[0.08] shrink-0 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
