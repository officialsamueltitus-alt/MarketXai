import React, { useEffect, useState } from 'react';
import { ArrowLeft, ShieldCheck, CheckCircle2, XCircle, Loader2, Clock, ExternalLink, Copy, Fingerprint, Layers, Link2, FileText } from 'lucide-react';
import { MarketXIcon } from '../components/MarketXIcon';
import { apiFetch } from '../utils/apiClient';
import { STYLE_INFO, closeByText } from '../utils/tradeStyle';
import { formatMarketPrice } from '../utils/formatPrice';

// Public proof page at /proof/<id>: everything is recomputed in this browser from the sealed signal, so nobody has to
// take MarketX's word for it. 1) the fingerprint matches the signal, 2) the fingerprint is in the batch's Merkle root,
// 3) the root was written to Solana in a transaction anyone can open.
interface ProofResponse {
  proof: { id: string; hash: string; canonical: string; prefix: string; issuedAt: number; status: 'SEALED' | 'BATCHED' | 'ANCHORED'; tag?: 'PERSONAL_STRATEGY'; style?: 'SCALP' | 'DAY' | 'SWING'; closeBy?: number | null };
  batch: null | {
    id: string;
    count: number;
    root: string;
    rootMatches: boolean;
    path: Array<{ side: 'L' | 'R'; hash: string }>;
    memo: string;
    createdAt: number;
    anchor: { status: 'ANCHORED' | 'WAITING'; tx: string | null; slot: number | null; at: number | null };
  };
  /** The readable record: the trade and its result written on Solana in plain words once the trade ends (or after 24h) */
  reveal?: null | {
    state: 'TRACKING' | 'POSTING' | 'POSTED';
    revealAt: number;
    result: null | { code: 'WIN' | 'LOSS' | 'MISSED' | 'NOT_TRIGGERED' | 'OPEN' | 'NO_DATA' | 'ENDED'; text: string; final: boolean };
    memo: string | null;
    tx: string | null;
    at: number | null;
  };
  /** The MarketX ID of the trader who got this signal: their Solana address, listing all their trade records */
  traderId?: string | null;
}
const RESULT_TONE: Record<string, string> = {
  WIN: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200',
  LOSS: 'bg-rose-500/15 border-rose-400/30 text-rose-200',
  MISSED: 'bg-slate-500/15 border-slate-400/30 text-slate-200',
  NOT_TRIGGERED: 'bg-slate-500/15 border-slate-400/30 text-slate-200',
  OPEN: 'bg-sky-500/15 border-sky-400/30 text-sky-200',
  ENDED: 'bg-amber-500/15 border-amber-400/30 text-amber-200',
  NO_DATA: 'bg-slate-500/15 border-slate-400/30 text-slate-300',
};
const solscan = (tx: string) => `https://solscan.io/tx/${encodeURIComponent(tx)}`;
const explorer = (tx: string) => `https://explorer.solana.com/tx/${encodeURIComponent(tx)}`;
const TxLinks: React.FC<{ tx: string }> = ({ tx }) => (
  <span className="mt-2 flex flex-wrap gap-2">
    <a href={solscan(tx)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] text-slate-200">
      Solscan <ExternalLink className="w-3 h-3" />
    </a>
    <a href={explorer(tx)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] text-slate-200">
      Solana Explorer <ExternalLink className="w-3 h-3" />
    </a>
  </span>
);
type Step = 'ok' | 'bad' | 'wait' | 'pending';

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = (h: string) => Uint8Array.from(h.match(/../g)!.map(x => parseInt(x, 16)));
const sha256 = async (bytes: Uint8Array) => hex(await crypto.subtle.digest('SHA-256', bytes));
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const short = (s: string, n = 10) => (s.length > n * 2 ? `${s.slice(0, n)}…${s.slice(-n)}` : s);

const StepRow: React.FC<{ state: Step; title: string; text: React.ReactNode; icon: React.ElementType }> = ({ state, title, text, icon: Icon }) => (
  <li className="flex gap-3 p-4 rounded-2xl bg-white/[0.03] border border-white/[0.07]">
    <span className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.06] flex items-center justify-center shrink-0">
      <Icon className="w-5 h-5 text-slate-200" />
    </span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-white">{title}</span>
        {state === 'ok' && <CheckCircle2 className="w-4 h-4 text-emerald-300" aria-label="Verified" />}
        {state === 'bad' && <XCircle className="w-4 h-4 text-rose-300" aria-label="Does not match" />}
        {state === 'wait' && <Clock className="w-4 h-4 text-amber-300" aria-label="Waiting" />}
        {state === 'pending' && <Loader2 className="w-4 h-4 text-slate-400 animate-spin" aria-label="Checking" />}
      </div>
      <div className="mt-1 text-xs text-slate-400 leading-relaxed break-words">{text}</div>
    </div>
  </li>
);

export default function ProofPage() {
  const id = decodeURIComponent(window.location.pathname.split('/')[2] || '');
  const [data, setData] = useState<ProofResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hashOk, setHashOk] = useState<Step>('pending');
  const [pathOk, setPathOk] = useState<Step>('pending');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const prev = document.title;
    document.title = 'Signal proof · MarketX';
    return () => {
      document.title = prev;
    };
  }, []);
  useEffect(() => {
    apiFetch<ProofResponse>(`/api/proofs/${encodeURIComponent(id)}`)
      .then(setData)
      .catch(err => setError(err?.message || 'Proof not found.'));
  }, [id]);
  // While a step is still waiting (seal on its way to Solana, result being written), check again on its own
  const waiting = !!data && (data.batch?.anchor.status !== 'ANCHORED' || data.reveal?.state === 'POSTING');
  useEffect(() => {
    if (!waiting) return;
    let tries = 0;
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (++tries > 40) return clearInterval(t);
      apiFetch<ProofResponse>(`/api/proofs/${encodeURIComponent(id)}`)
        .then(next => {
          setHashOk('pending');
          setPathOk('pending');
          setData(next);
        })
        .catch(() => {});
    }, 15_000);
    return () => clearInterval(t);
  }, [waiting, id]);
  // The two checks, done here in the browser
  useEffect(() => {
    if (!data) return;
    (async () => {
      const enc = new TextEncoder();
      const h = await sha256(enc.encode(data.proof.prefix + data.proof.canonical));
      setHashOk(h === data.proof.hash ? 'ok' : 'bad');
      if (!data.batch) return setPathOk('wait');
      let cur = unhex(await sha256(cat(new Uint8Array([0]), unhex(data.proof.hash))));
      for (const step of data.batch.path) {
        const sib = unhex(step.hash);
        cur = unhex(await sha256(step.side === 'R' ? cat(new Uint8Array([1]), cur, sib) : cat(new Uint8Array([1]), sib, cur)));
      }
      setPathOk([...cur].map(x => x.toString(16).padStart(2, '0')).join('') === data.batch.root ? 'ok' : 'bad');
    })().catch(() => setHashOk('bad'));
  }, [data]);

  let signal: any = null;
  try {
    signal = data ? JSON.parse(data.proof.canonical) : null;
  } catch {}
  const anchored = data?.batch?.anchor.status === 'ANCHORED' && data.batch.anchor.tx;
  const allGood = hashOk === 'ok' && pathOk === 'ok' && anchored;
  const copy = (text: string) =>
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });

  return (
    <div className="mx-backdrop min-h-[100dvh] text-slate-200 overflow-x-clip">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[var(--mx-bg)] pt-[env(safe-area-inset-top)]">
        <div className="max-w-3xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
          <a href="/" className="inline-flex items-center gap-2 h-9 pl-2.5 pr-3.5 rounded-full border border-white/[0.08] bg-white/[0.03] text-sm font-medium text-slate-200 hover:bg-white/[0.07] hover:text-white transition">
            <ArrowLeft className="w-4 h-4" />
            <span>MarketX</span>
          </a>
          <span className="inline-flex items-center gap-2 min-w-0">
            <MarketXIcon size="sm" />
            <span className="text-sm font-semibold text-white truncate">Signal proof</span>
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-20">
        {error ? (
          <div className="mt-16 text-center">
            <XCircle className="w-10 h-10 mx-auto text-rose-300" />
            <h1 className="mt-4 text-xl font-semibold text-white">Proof not found</h1>
            <p className="mt-1 text-sm text-slate-400">{error}</p>
          </div>
        ) : !data ? (
          <div className="mt-24 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            <section className="relative mt-6 sm:mt-10 overflow-hidden rounded-[28px] border border-white/[0.08] bg-[var(--mx-surface)] px-5 py-7 sm:px-8 sm:py-9">
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_0%_0%,rgba(139,92,246,0.3),transparent_55%),radial-gradient(80%_120%_at_100%_0%,rgba(16,185,129,0.22),transparent_55%)]" />
              <div className="relative">
                <span className={`inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-xs font-semibold ${allGood ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200' : 'bg-amber-500/15 border-amber-400/30 text-amber-200'}`}>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {allGood ? 'Verified on Solana' : hashOk === 'bad' || pathOk === 'bad' ? 'Does not verify' : 'Sealed, waiting for Solana'}
                </span>
                {data.proof.tag === 'PERSONAL_STRATEGY' && (
                  <span title="Found with the trader's own strategy (Strategy Builder), not the MarketX engine" className="ml-2 inline-flex items-center h-7 px-3 rounded-full border border-violet-400/30 bg-violet-500/15 text-xs font-semibold text-violet-100">
                    Personal strategy
                  </span>
                )}
                {data.proof.style && (
                  <span
                    title={data.proof.closeBy ? `Closes by ${closeByText(data.proof.closeBy)}; still open then = ended at the price then` : undefined}
                    className="ml-2 inline-flex items-center h-7 px-3 rounded-full border border-amber-400/30 bg-amber-500/10 text-xs font-semibold text-amber-100"
                  >
                    {STYLE_INFO[data.proof.style].label}
                    {data.proof.closeBy ? ` · closes ${closeByText(data.proof.closeBy).split(',')[0]}` : ''}
                  </span>
                )}
                {signal && (
                  <>
                    <h1 className="mt-4 text-2xl sm:text-3xl font-semibold text-white tracking-tight">
                      {signal.direction === 'LONG' ? 'Buy' : 'Sell'} {signal.symbol} <span className="text-slate-400 font-normal">on the {signal.timeframe}</span>
                    </h1>
                    <p className="mt-1 text-sm text-slate-400">{data.proof.tag === 'PERSONAL_STRATEGY' ? 'Found with the trader\'s personal strategy on MarketX' : 'Served by MarketX'} {when(signal.issuedAt)}</p>
                    {data.traderId && (
                      <a
                        href={`https://solscan.io/account/${encodeURIComponent(data.traderId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Every trade this trader took on MarketX, with its result, on Solscan"
                        className="mt-2 inline-flex max-w-full items-center gap-1.5 text-xs text-slate-300 hover:text-white"
                      >
                        <span className="shrink-0 text-slate-500">MarketX ID</span>
                        <span className="font-mono truncate">{short(data.traderId, 6)}</span>
                        <span className="shrink-0 text-emerald-300">All trades</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    )}
                    <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm tabular-nums">
                      <div className="p-3 rounded-2xl bg-black/25 border border-white/[0.06]">
                        <div className="text-[10px] uppercase tracking-wider text-amber-300/80">Entry</div>
                        <div className="mt-0.5 font-semibold text-white">{formatMarketPrice(signal.entry.optimal)}</div>
                        <div className="text-[10px] text-slate-500">{formatMarketPrice(signal.entry.min)} to {formatMarketPrice(signal.entry.max)}</div>
                      </div>
                      <div className="p-3 rounded-2xl bg-black/25 border border-white/[0.06]">
                        <div className="text-[10px] uppercase tracking-wider text-rose-300/80">Stop loss</div>
                        <div className="mt-0.5 font-semibold text-white">{formatMarketPrice(signal.stop)}</div>
                      </div>
                      {signal.targets.map((t: number, i: number) => (
                        <div key={i} className="p-3 rounded-2xl bg-black/25 border border-white/[0.06]">
                          <div className="text-[10px] uppercase tracking-wider text-emerald-300/80">TP{i + 1}</div>
                          <div className="mt-0.5 font-semibold text-white">{formatMarketPrice(t)}</div>
                        </div>
                      ))}
                    </div>
                    {(data.reveal?.result || anchored) && (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {data.reveal?.result && (
                          <span className={`inline-flex items-center h-8 px-3 rounded-full border text-xs font-semibold ${RESULT_TONE[data.reveal.result.code] || RESULT_TONE.NO_DATA}`}>{data.reveal.result.text}</span>
                        )}
                        {data.reveal?.state === 'POSTED' && data.reveal.tx && (
                          <a href={solscan(data.reveal.tx)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white text-slate-900 text-xs font-semibold hover:bg-slate-200 transition">
                            <FileText className="w-3.5 h-3.5" /> Read the result on Solscan <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                        {anchored && (
                          <a href={solscan(data.batch!.anchor.tx!)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white/[0.07] border border-white/[0.1] text-xs font-semibold text-slate-100 hover:bg-white/[0.12] transition">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" /> Seal on Solscan <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </section>

            <h2 className="mt-8 mb-3 text-sm font-semibold text-white">Checked in your browser</h2>
            <ol className="space-y-2.5">
              <StepRow
                state={hashOk}
                icon={Fingerprint}
                title="The fingerprint matches this signal"
                text={
                  <>
                    SHA-256 of the sealed signal is{' '}
                    <button type="button" onClick={() => copy(data.proof.hash)} className="font-mono text-slate-200 hover:text-white inline-flex items-center gap-1 cursor-pointer">
                      {short(data.proof.hash)} <Copy className="w-3 h-3" />
                    </button>
                    {copied && <span className="ml-1 text-emerald-300">Copied</span>}. Change one digit of a level and it would no longer match.
                  </>
                }
              />
              <StepRow
                state={pathOk}
                icon={Layers}
                title="It is part of a sealed batch"
                text={
                  data.batch ? (
                    <>
                      One of {data.batch.count.toLocaleString('en-US')} signals in batch <span className="font-mono">{data.batch.id}</span>. Its Merkle root is{' '}
                      <span className="font-mono text-slate-200">{short(data.batch.root)}</span>.
                    </>
                  ) : (
                    'Signals are written to Solana within a minute or two. This page updates by itself.'
                  )
                }
              />
              <StepRow
                state={anchored ? 'ok' : 'wait'}
                icon={Link2}
                title="The batch is written on Solana"
                text={
                  anchored ? (
                    <>
                      Written {data.batch!.anchor.at ? when(data.batch!.anchor.at) : ''} in transaction{' '}
                      <span className="font-mono text-slate-200">{short(data.batch!.anchor.tx!, 8)}</span>. Open it and read the memo: it carries the same root.
                      <TxLinks tx={data.batch!.anchor.tx!} />
                    </>
                  ) : data.batch ? (
                    'The batch is sealed and on its way to Solana. This page updates by itself.'
                  ) : (
                    'Waiting for its batch. This page updates by itself.'
                  )
                }
              />
              {data.reveal && (
                <StepRow
                  state={data.reveal.state === 'POSTED' ? 'ok' : 'wait'}
                  icon={FileText}
                  title="The trade and its result, in plain words on Solana"
                  text={
                    data.reveal.state === 'POSTED' && data.reveal.tx ? (
                      <>
                        Written {data.reveal.at ? when(data.reveal.at) : ''}. Anyone can open the transaction and read the pair, entry, stop, targets, time and
                        result in its memo, no blockchain knowledge needed. The fingerprint in it matches the seal above.
                        {data.reveal.memo && <span className="mt-2 block p-2.5 rounded-xl bg-black/30 border border-white/[0.06] font-mono text-[11px] text-slate-300 break-words">{data.reveal.memo}</span>}
                        <TxLinks tx={data.reveal.tx} />
                      </>
                    ) : data.reveal.state === 'POSTING' ? (
                      <>The result is in: {data.reveal.result?.text}. It is being written on Solana now. Check back in a few minutes.</>
                    ) : (
                      <>
                        While the trade runs, only its sealed fingerprint is public, so nobody can copy it. When it ends, or by {when(data.reveal.revealAt)} at the
                        latest, the trade and its result are written on Solana in plain words.
                      </>
                    )
                  }
                />
              )}
            </ol>

            <details className="mt-6 rounded-2xl bg-white/[0.02] border border-white/[0.06]">
              <summary className="px-4 h-11 flex items-center text-xs font-medium text-slate-300 cursor-pointer">How to check it yourself</summary>
              <div className="px-4 pb-4 text-xs text-slate-400 leading-relaxed space-y-2">
                <p>1. SHA-256 the text below (it starts with the line <span className="font-mono">marketx-signal-v1</span>). It must equal the fingerprint.</p>
                <p>2. Leaf = SHA-256(0x00 + fingerprint). For each step of the path, node = SHA-256(0x01 + left + right). The last node must equal the root.</p>
                <p>3. Open the transaction: its memo reads <span className="font-mono break-all">{data.batch?.memo || 'MarketX proof v1 <batch> <root> n=<count>'}</span>.</p>
                <pre className="mt-2 p-3 rounded-xl bg-black/40 border border-white/[0.06] text-[11px] text-slate-300 whitespace-pre-wrap break-all">{data.proof.prefix + data.proof.canonical}</pre>
              </div>
            </details>
            <p className="mt-6 text-[11px] text-slate-500 leading-relaxed">
              A proof shows when a signal was served and that it was never edited. It says nothing about whether the trade will win. Proofs never include a
              name or email: the result record is listed under the trader's MarketX ID only.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
