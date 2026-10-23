import React, { useEffect, useState } from 'react';
import { Check, Copy, Gift, Link2, Loader2, Share2, Users } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { inviteLink } from '../utils/referral';

// Profile → "Invite traders" (owner-specified): the trader's own invite link, how many joined with it and the credits it
// earned. Rewards are only given while the MarketX team has the invite program on; the server decides everything.
export interface ReferralInfo {
  code: string;
  invited: number;
  thisMonth: number;
  earned: number;
  program: { enabled: boolean; credits: number };
}

export const InviteCard: React.FC<{ compact?: boolean; onOpenBoard?: () => void }> = ({ compact, onOpenBoard }) => {
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    apiFetch<ReferralInfo>('/api/referrals/me')
      .then(r => live && setInfo(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  const link = info ? inviteLink(info.code) : '';
  const copy = () =>
    navigator.clipboard
      ?.writeText(link)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => {});
  const share = () => {
    const text = 'I use MarketX to analyze any market and get the full trade plan. Join with my invite:';
    if (navigator.share) navigator.share({ title: 'Join me on MarketX', text, url: link }).catch(() => {});
    else copy();
  };

  return (
    <section className="mx-invite relative rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-4 overflow-hidden">
      <div className="mx-invite-glow pointer-events-none absolute -top-16 -right-10 w-48 h-40 rounded-full" aria-hidden="true" />
      <div className="relative flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500/25 to-cyan-400/25 border border-violet-400/30 flex items-center justify-center shrink-0">
          <Users className="w-4 h-4 text-violet-200" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Invite traders</p>
          <p className="text-[11px] text-slate-400 truncate">
            {info?.program.enabled ? `Earn ${info.program.credits} credits for every trader who joins` : 'Share your link and climb the referrals board'}
          </p>
        </div>
        {info?.program.enabled && (
          <span className="shrink-0 inline-flex items-center gap-1 h-6 px-2.5 rounded-full bg-emerald-500/10 text-emerald-300 text-[10px] font-semibold">
            <Gift className="w-3 h-3" /> +{info.program.credits}
          </span>
        )}
      </div>

      {info ? (
        <>
          <div className="relative mt-3 grid grid-cols-3 gap-2">
            {[
              { label: 'Invited', value: info.invited },
              { label: 'This month', value: info.thisMonth },
              { label: 'Credits earned', value: info.earned },
            ].map(s => (
              <div key={s.label} className="rounded-2xl bg-black/20 border border-white/[0.05] px-3 py-2.5">
                <p className="text-lg font-semibold text-white tabular-nums leading-none">{s.value.toLocaleString()}</p>
                <p className="mt-1 text-[10px] text-slate-400">{s.label}</p>
              </div>
            ))}
          </div>
          <div className="relative mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={copy}
              title="Copy your invite link"
              className="flex-1 min-w-0 flex items-center gap-2 px-3 h-10 rounded-xl bg-black/25 border border-white/[0.06] text-left cursor-pointer hover:border-white/[0.15]"
            >
              <Link2 className="w-3.5 h-3.5 text-violet-300 shrink-0" />
              <span className="flex-1 min-w-0 font-mono text-[11px] text-slate-200 truncate">{link.replace(/^https?:\/\//, '')}</span>
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
            </button>
            <button
              type="button"
              onClick={share}
              className="h-10 px-3.5 rounded-xl bg-white text-slate-900 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-slate-200 cursor-pointer shrink-0"
            >
              <Share2 className="w-3.5 h-3.5" /> Share
            </button>
          </div>
          {!compact && (
            <p className="relative mt-2.5 text-[11px] text-slate-500 leading-relaxed">
              {info.program.enabled
                ? 'Credits arrive when the trader you invited activates their account with their pass code. They are used first, before your daily analyses.'
                : 'Anyone who signs up with your link counts as your invite. Invite rewards are not on yet: when the MarketX team turns them on, new invites earn credits.'}
              {onOpenBoard && (
                <>
                  {' '}
                  <button type="button" onClick={onOpenBoard} className="font-semibold text-violet-300 hover:text-violet-200 cursor-pointer">
                    See the referrals board
                  </button>
                </>
              )}
            </p>
          )}
        </>
      ) : (
        <p className="relative mt-3 text-[11px] text-slate-500 inline-flex items-center gap-1.5">
          {failed ? 'Unavailable right now. Try again later.' : (<><Loader2 className="w-3 h-3 animate-spin" /> Making your invite link…</>)}
        </p>
      )}
    </section>
  );
};
