import React, { useState } from 'react';
import { ExternalLink, Link2, Loader2, RefreshCw, Wallet } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { Badge, Card, ErrorNote, Spinner, fmtDateTime, timeAgo, useAdminData } from './ui';

// Solana signal proofs: is the proof wallet set and funded, which batches are waiting and why, and "Anchor now".
const REASON: Record<string, { label: string; tone: 'green' | 'amber' | 'red' | 'violet' | 'gray' }> = {
  ANCHORED: { label: 'On Solana', tone: 'green' },
  PENDING: { label: 'Sent, confirming', tone: 'violet' },
  NO_WALLET: { label: 'No proof wallet', tone: 'red' },
  LOW_BALANCE: { label: 'Wallet needs SOL', tone: 'amber' },
  FAILED: { label: 'Send failed', tone: 'red' },
};
const solscanTx = (tx: string) => `https://solscan.io/tx/${encodeURIComponent(tx)}`;
const solscanAddr = (a: string) => `https://solscan.io/account/${encodeURIComponent(a)}`;
const sol = (lamports: number | null | undefined) => (lamports == null ? 'unknown' : `${(lamports / 1e9).toLocaleString('en-US', { maximumFractionDigits: 6 })} SOL`);

export const ProofsCard: React.FC = () => {
  const { data, error, loading, reload } = useAdminData<any>(() => apiFetch('/api/admin/proofs'));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (loading && !data) return <Card title="Solana signal proofs"><Spinner /></Card>;
  if (error) return <Card title="Solana signal proofs"><ErrorNote message={error} onRetry={reload} /></Card>;
  if (!data) return null;
  const anchorNow = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await apiFetch<any>('/api/admin/proofs/anchor', { method: 'POST' });
      setNote(r.busy ? 'Another run is already in progress. Refresh in a minute.' : `${r.batched} new signal(s) batched, ${r.anchored} batch(es) written on Solana.`);
      reload();
    } catch (e: any) {
      setNote(e?.message || 'Could not run it now.');
    } finally {
      setBusy(false);
    }
  };
  const w = data.wallet;
  const low = w && w.lamports != null && w.lamports < data.minLamports;
  const head = !w ? REASON.NO_WALLET : low ? REASON.LOW_BALANCE : data.waitingCount ? (data.waiting[0]?.status === 'PENDING' ? REASON.PENDING : REASON.FAILED) : REASON.ANCHORED;

  return (
    <Card
      title={<span className="inline-flex items-center gap-2">Solana signal proofs <Badge tone={head.tone}>{!w ? head.label : data.waitingCount ? `${data.waitingCount} waiting · ${head.label}` : low ? head.label : 'All on Solana'}</Badge></span>}
      action={
        <span className="flex items-center gap-2">
          <button type="button" onClick={reload} aria-label="Refresh" className="h-8 w-8 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] inline-flex items-center justify-center cursor-pointer"><RefreshCw className="w-3.5 h-3.5" /></button>
          <button type="button" onClick={anchorNow} disabled={busy} className="h-8 px-3 rounded-lg bg-violet-500/90 hover:bg-violet-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />} Anchor now
          </button>
        </span>
      }
    >
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 min-w-0">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 flex items-center gap-1.5"><Wallet className="w-3 h-3" /> Proof wallet</div>
          {w ? (
            <a href={solscanAddr(w.address)} target="_blank" rel="noopener noreferrer" className="mt-1 block font-mono text-xs text-violet-200 hover:text-white truncate">{w.address} <ExternalLink className="inline w-3 h-3" /></a>
          ) : (
            <p className="mt-1 text-xs text-rose-300">Not set. Add SOLANA_PROOF_SECRET_KEY on Render (the wallet's private key), then redeploy.</p>
          )}
        </div>
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Balance</div>
          <div className={`mt-1 font-semibold ${low ? 'text-amber-300' : 'text-white'}`}>{w ? sol(w.lamports) : '—'}</div>
          {low && <p className="text-[11px] text-amber-300/90 mt-0.5">Send about 0.02 SOL to the wallet above.</p>}
          {w && w.lamports == null && <p className="text-[11px] text-amber-300/90 mt-0.5">The RPC did not answer. Check SOLANA_RPC_URL.</p>}
        </div>
        <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3">
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Network</div>
          <div className="mt-1 text-xs text-slate-300">RPC {data.rpcHost}</div>
          <div className="text-[11px] text-slate-500">New batch every {data.batchEveryMin} min · retries every {data.retryEveryMin} min · {data.unbatched} signal(s) not batched yet</div>
        </div>
      </div>
      {note && <p className="mt-3 text-xs text-slate-300">{note}</p>}
      {data.waiting.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">Waiting batches</div>
          <ul className="divide-y divide-white/[0.05]">
            {data.waiting.map((b: any) => (
              <li key={b.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-mono text-slate-300">{b.id}</span>
                <Badge tone={(REASON[b.status] || REASON.FAILED).tone}>{(REASON[b.status] || REASON.FAILED).label}</Badge>
                <span className="text-slate-500">{b.count} signal(s) · made {timeAgo(b.createdAt)} · {b.tries} tries{b.lastTryAt ? ` · last ${timeAgo(b.lastTryAt)}` : ''}</span>
                {b.lastError && <span className="basis-full text-slate-400">{b.lastError}</span>}
                {b.tx && <a href={solscanTx(b.tx)} target="_blank" rel="noopener noreferrer" className="text-violet-300 hover:text-white">Sent tx <ExternalLink className="inline w-3 h-3" /></a>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {data.lastAnchored.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">On Solana ({data.anchoredCount})</div>
          <ul className="divide-y divide-white/[0.05]">
            {data.lastAnchored.map((b: any) => (
              <li key={b.id} className="py-2 flex flex-wrap items-center gap-x-3 text-xs">
                <span className="font-mono text-slate-300">{b.id}</span>
                <span className="text-slate-500">{b.count} signal(s) · {fmtDateTime(b.at)}</span>
                {b.tx && <a href={solscanTx(b.tx)} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-white">View on Solscan <ExternalLink className="inline w-3 h-3" /></a>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};
