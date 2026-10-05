import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Fingerprint, Search } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

// Profile → "Your MarketX ID": the trader's own Solana address. Searching it on Solscan lists every trade they took
// on MarketX and its result. The ID is activated on Solana the first time it is opened (a minute or two), so explorers
// show the account straight away.
interface TraderIdInfo {
  id: string;
  solscan: string;
  onSolana?: boolean;
}

export const TraderIdCard: React.FC = () => {
  const [info, setInfo] = useState<TraderIdInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (n = 0) =>
      apiFetch<TraderIdInfo>('/api/trader-id')
        .then(r => {
          if (!live) return;
          setInfo(r);
          // Still being activated: check again a few times while the profile is open
          if (!r.onSolana && n < 8) timer = setTimeout(() => load(n + 1), 30_000);
        })
        .catch(() => live && setFailed(true));
    load();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, []);
  const copy = () =>
    info &&
    navigator.clipboard
      ?.writeText(info.id)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});

  return (
    <section className="rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-4">
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
          <Fingerprint className="w-4 h-4 text-emerald-300" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Your MarketX ID</p>
          <p className="text-[11px] text-slate-400 truncate">Your trades and results on Solana</p>
        </div>
        {info && (
          <span className={`shrink-0 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[10px] font-semibold ${info.onSolana ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-200'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${info.onSolana ? 'bg-emerald-400' : 'bg-amber-300 animate-pulse'}`} />
            {info.onSolana ? 'On Solana' : 'Activating'}
          </span>
        )}
      </div>
      {info ? (
        <>
          <button type="button" onClick={copy} title="Copy your MarketX ID" className="mt-3 w-full flex items-center gap-2 px-3 h-10 rounded-xl bg-black/25 border border-white/[0.06] text-left cursor-pointer hover:border-white/[0.15]">
            <span className="flex-1 min-w-0 font-mono text-xs text-slate-200 truncate">{info.id}</span>
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0" />}
          </button>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <a href={info.solscan} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 hover:text-emerald-200">
              View my trades on Solscan <ExternalLink className="w-3 h-3" />
            </a>
            <a href={`/checker?id=${encodeURIComponent(info.id)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-300 hover:text-white">
              <Search className="w-3 h-3" /> Open in ID checker
            </a>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
            {info.onSolana
              ? 'A trade shows up on Solscan once it ends, or a day after you got it.'
              : 'Your ID is being activated on Solana. This takes a minute or two; trades show up once they end.'}{' '}
            Anyone with your ID can see your public profile and results, never your email or credits. Never send funds to it.
          </p>
        </>
      ) : (
        <p className="mt-3 text-[11px] text-slate-500">{failed ? 'Unavailable right now. Try again later.' : 'Loading…'}</p>
      )}
    </section>
  );
};
