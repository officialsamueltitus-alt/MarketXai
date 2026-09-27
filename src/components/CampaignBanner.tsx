import React, { useEffect, useState } from 'react';
import { XShareReward, UserProfile } from '../types';
import { Check, Clock, ArrowRight, Zap, Gift } from 'lucide-react';
import {
  CAMPAIGN_STEPS,
  CampaignProgress,
  MARKETX_X_URL,
  loadCampaignProgress,
  openExternal,
  saveCampaignProgress,
} from '../utils/campaign';

interface CampaignBannerProps {
  userProfile: UserProfile;
  xShareReward?: XShareReward | null;
  onOpenShareModal: () => void;
  onOpenEmailReceipt?: () => void;
  className?: string;
  compact?: boolean;
}

const XLogo = ({ className = 'w-4 h-4' }: { className?: string }) => (
  <svg className={`${className} fill-current`} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

export function useCampaignProgress(username: string): [CampaignProgress, (patch: Partial<CampaignProgress>) => void] {
  const [progress, setProgress] = useState<CampaignProgress>(() => loadCampaignProgress(username));
  useEffect(() => {
    setProgress(loadCampaignProgress(username));
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.username === username) setProgress(detail.progress);
    };
    window.addEventListener('mx-campaign-progress', onChange);
    return () => window.removeEventListener('mx-campaign-progress', onChange);
  }, [username]);
  const update = (patch: Partial<CampaignProgress>) => {
    const next = { ...loadCampaignProgress(username), ...patch };
    saveCampaignProgress(username, next);
    setProgress(next);
  };
  return [progress, update];
}

export function useCountdown(unlockAt?: number, active?: boolean) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!active || !unlockAt) return;
    const tick = () => {
      const diff = unlockAt - Date.now();
      if (diff <= 0) return setText('Unlocking…');
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1000);
      setText(`${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [unlockAt, active]);
  return text;
}

export const CampaignBanner: React.FC<CampaignBannerProps> = ({
  userProfile,
  xShareReward,
  onOpenShareModal,
  className = '',
  compact = false,
}) => {
  const [progress, updateProgress] = useCampaignProgress(userProfile.username);
  const isPending = xShareReward?.status === 'pending';
  const isCredited = xShareReward?.status === 'credited';
  const countdown = useCountdown(xShareReward?.unlockAt, isPending);

  const doneMap: Record<string, boolean> = {
    follow: progress.follow || !!xShareReward,
    engage: progress.engage || !!xShareReward,
    download: progress.download || !!xShareReward,
    post: !!xShareReward,
    reward: isCredited,
  };
  const doneCount = CAMPAIGN_STEPS.filter(s => doneMap[s.id]).length;
  const nextStep = CAMPAIGN_STEPS.find(s => !doneMap[s.id]);

  const stepAction = (id: string) => {
    if (id === 'follow') {
      updateProgress({ follow: true });
      openExternal(MARKETX_X_URL);
    } else if (id === 'engage') {
      updateProgress({ engage: true });
      openExternal(MARKETX_X_URL);
    } else if (id === 'download' || id === 'post') {
      onOpenShareModal();
    }
  };

  return (
    <section
      className={`relative overflow-hidden rounded-3xl border border-white/[0.07] bg-[#111114] ${compact ? 'p-4' : 'p-5 sm:p-6'} ${className}`}
      aria-label="Earn credits on X"
    >
      <div className="pointer-events-none absolute -top-20 -right-16 w-56 h-56 rounded-full bg-indigo-600/15 blur-3xl" aria-hidden="true" />

      {/* Header */}
      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-10 h-10 rounded-2xl bg-white text-black flex items-center justify-center shrink-0">
            <XLogo className="w-[18px] h-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wider text-indigo-300">Campaign</p>
            <h3 className={`${compact ? 'text-[15px]' : 'text-lg'} font-semibold text-white tracking-tight`}>
              Earn 10 free credits on X
            </h3>
          </div>
        </div>
        <span
          className={`shrink-0 h-7 px-2.5 rounded-full text-xs font-medium inline-flex items-center gap-1.5 ${
            isCredited
              ? 'bg-emerald-500/10 text-emerald-300'
              : isPending
              ? 'bg-cyan-500/10 text-cyan-300'
              : 'bg-amber-500/10 text-amber-200'
          }`}
        >
          {isCredited ? (
            <>
              <Check className="w-3.5 h-3.5" /> Claimed
            </>
          ) : isPending ? (
            <>
              <Clock className="w-3.5 h-3.5" /> <span className="font-mono">{countdown}</span>
            </>
          ) : (
            <>
              <Zap className="w-3.5 h-3.5 fill-current" /> +10 credits
            </>
          )}
        </span>
      </div>

      {/* Progress */}
      <div className="relative mt-4 flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-cyan-300 transition-[width] duration-500"
            style={{ width: `${(doneCount / CAMPAIGN_STEPS.length) * 100}%` }}
          />
        </div>
        <span className="text-xs font-mono text-slate-400 shrink-0">
          {doneCount}/{CAMPAIGN_STEPS.length}
        </span>
      </div>

      {/* Steps */}
      <ol className={`relative mt-4 grid gap-2 ${compact ? '' : 'sm:grid-cols-2 lg:grid-cols-5 lg:gap-2.5'}`}>
        {CAMPAIGN_STEPS.map((step, i) => {
          const done = doneMap[step.id];
          const isNext = nextStep?.id === step.id;
          const clickable = !done && step.id !== 'reward';
          return (
            <li key={step.id}>
              <div
                className={`h-full flex ${compact ? 'items-center' : 'lg:flex-col lg:items-start'} items-center gap-3 p-3 rounded-2xl border transition-colors ${
                  done
                    ? 'border-emerald-500/15 bg-emerald-500/[0.04]'
                    : isNext
                    ? 'border-indigo-400/30 bg-indigo-500/[0.06]'
                    : 'border-white/[0.06] bg-white/[0.02]'
                }`}
              >
                <span
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                    done ? 'bg-emerald-400 text-slate-950' : isNext ? 'bg-white text-slate-950' : 'bg-white/[0.06] text-slate-400'
                  }`}
                >
                  {done ? <Check className="w-3.5 h-3.5" /> : step.id === 'reward' ? <Gift className="w-3.5 h-3.5" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-100 leading-snug">
                    {step.id === 'follow' ? (
                      <span>
                        Follow{' '}
                        <button
                          type="button"
                          onClick={() => stepAction('follow')}
                          className="font-semibold text-white underline decoration-indigo-400/60 underline-offset-4 hover:decoration-indigo-300 cursor-pointer"
                          title="Open @_MarketXai on X"
                        >
                          Market<span className="text-indigo-300">X</span>
                        </button>
                      </span>
                    ) : (
                      step.title
                    )}
                  </div>
                  {!compact && <p className="text-xs text-slate-500 mt-0.5 leading-snug">{step.detail}</p>}
                </div>
                {clickable && step.id !== 'follow' && (
                  <button
                    type="button"
                    onClick={() => stepAction(step.id)}
                    className={`${compact ? '' : 'lg:hidden'} h-7 px-2.5 rounded-full text-xs font-medium text-slate-200 bg-white/[0.06] hover:bg-white/[0.12] transition-colors shrink-0 cursor-pointer`}
                  >
                    {step.id === 'engage' ? 'Open' : 'Go'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Footer */}
      <div className="relative mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {isCredited
            ? '+10 credits were added to your balance. Thanks for supporting MarketX!'
            : isPending
            ? 'Posted! Your credits unlock automatically when the timer ends.'
            : 'Complete the steps in order. Credits arrive 10 hours after you post.'}
        </p>
        <button
          type="button"
          onClick={onOpenShareModal}
          className="h-10 px-4 rounded-full bg-white text-slate-950 text-sm font-medium hover:bg-slate-200 active:scale-[0.98] transition inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
        >
          {isPending ? 'View progress' : isCredited ? 'Share again' : 'Start earning'}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </section>
  );
};
