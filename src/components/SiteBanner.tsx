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

  return (
    <div className={`mx-fade-in relative z-40 border-b ${cls}`} role="status">
      <div className="max-w-5xl mx-auto flex items-center gap-2.5 pl-4 pr-2 py-2 text-[13px]">
        <Icon className="w-4 h-4 shrink-0" />
        <p className="min-w-0 flex-1 leading-snug">
          <span className="font-semibold">{banner.title}</span>
          {banner.message && <span className="opacity-80"> · {banner.message}</span>}
          {banner.link && (
            <a href={banner.link} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 font-medium underline underline-offset-2">
              Learn more <ArrowUpRight className="w-3 h-3" />
            </a>
          )}
        </p>
        <button
          type="button"
          aria-label="Dismiss notice"
          onClick={() => {
            setDismissed(banner.id);
            try {
              localStorage.setItem(KEY, banner.id);
            } catch {}
          }}
          className="w-7 h-7 rounded-full inline-flex items-center justify-center opacity-70 hover:opacity-100 hover:bg-white/[0.08] shrink-0 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};
