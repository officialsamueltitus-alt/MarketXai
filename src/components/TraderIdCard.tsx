import React, { useEffect, useState } from 'react';
import { Copy, ExternalLink, Fingerprint } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';

// Settings → "Your MarketX ID": the trader's own Solana address. Searching it on Solscan lists every trade they took
// on MarketX and its result, written on chain once each trade ends.
export const TraderIdCard: React.FC<{ onToast?: (msg: string) => void }> = ({ onToast }) => {
  const [id, setId] = useState<{ id: string; solscan: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    apiFetch<{ id: string; solscan: string }>('/api/trader-id')
      .then(r => live && setId(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  const copy = () =>
    id &&
    navigator.clipboard
      ?.writeText(id.id)
      .then(() => onToast?.('MarketX ID copied'))
      .catch(() => {});

  return (
    <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]">
      <div className="flex items-center gap-2 text-xs font-semibold text-white">
        <span className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
          <Fingerprint className="w-3.5 h-3.5 text-emerald-300" />
        </span>
        <span className="min-w-0">
          <span className="block">Your MarketX ID</span>
          <span className="block text-[10px] font-normal text-slate-400 truncate">Your trades and results on Solana</span>
        </span>
      </div>
      {id ? (
        <>
          <button type="button" onClick={copy} title="Copy your MarketX ID" className="mt-2 w-full flex items-center gap-1.5 px-2 h-8 rounded-lg bg-black/25 border border-white/[0.06] text-left cursor-pointer hover:border-white/[0.15]">
            <span className="flex-1 min-w-0 font-mono text-[11px] text-slate-200 truncate">{id.id}</span>
            <Copy className="w-3 h-3 text-slate-400 shrink-0" />
          </button>
          <a href={id.solscan} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300 hover:text-emerald-200">
            View my trades on Solscan <ExternalLink className="w-3 h-3" />
          </a>
          <p className="mt-1 text-[10px] text-slate-500 leading-relaxed">
            A trade shows up once it ends (or a day after you got it). Your name and email are never on chain. This ID is for records only: never send funds to it.
          </p>
        </>
      ) : (
        <p className="mt-2 text-[11px] text-slate-500">{failed ? 'Unavailable right now. Try again later.' : 'Loading…'}</p>
      )}
    </div>
  );
};
