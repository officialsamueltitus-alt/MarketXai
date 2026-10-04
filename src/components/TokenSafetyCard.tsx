import React, { useMemo, useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldX, ShieldQuestion, Check, AlertTriangle, X, HelpCircle, RefreshCw, ExternalLink, ChevronDown, Copy } from 'lucide-react';
import type { TokenSafety } from '../types';
import { apiFetch } from '../utils/apiClient';

// Token safety (Solana tokens): verdict, score ring and every on-chain check, next to an analysis or an answer.
const TONE = {
  LOW_RISK: { label: 'Low risk', icon: ShieldCheck, text: 'text-emerald-300', pill: 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200', ring: '#34d399', glow: 'from-emerald-500/[0.12]' },
  CAUTION: { label: 'Caution', icon: ShieldAlert, text: 'text-amber-300', pill: 'bg-amber-500/15 border-amber-400/30 text-amber-200', ring: '#fbbf24', glow: 'from-amber-500/[0.12]' },
  HIGH_RISK: { label: 'High risk', icon: ShieldX, text: 'text-rose-300', pill: 'bg-rose-500/15 border-rose-400/30 text-rose-200', ring: '#fb7185', glow: 'from-rose-500/[0.14]' },
  UNKNOWN: { label: 'Not checked', icon: ShieldQuestion, text: 'text-slate-300', pill: 'bg-white/[0.06] border-white/[0.1] text-slate-300', ring: '#94a3b8', glow: 'from-white/[0.05]' },
} as const;
const STATUS = {
  fail: { icon: X, cls: 'bg-rose-500/15 text-rose-300', order: 0 },
  warn: { icon: AlertTriangle, cls: 'bg-amber-500/15 text-amber-300', order: 1 },
  unknown: { icon: HelpCircle, cls: 'bg-white/[0.06] text-slate-400', order: 2 },
  pass: { icon: Check, cls: 'bg-emerald-500/15 text-emerald-300', order: 3 },
} as const;

const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)}h ago`;
};
const short = (s: string) => `${s.slice(0, 4)}…${s.slice(-4)}`;

const ScoreRing: React.FC<{ score: number; color: string }> = ({ score, color }) => {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" role="img" aria-label={`Safety score ${score} out of 100`} className="shrink-0">
      <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
      <circle cx="24" cy="24" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 24 24)" />
      <text x="24" y="28" textAnchor="middle" fontSize="12" fontWeight="700" fill="white">{score}</text>
    </svg>
  );
};

export const TokenSafetyCard: React.FC<{ safety: TokenSafety }> = ({ safety: initial }) => {
  const [safety, setSafety] = useState(initial);
  const [open, setOpen] = useState(initial.verdict !== 'LOW_RISK');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const t = TONE[safety.verdict] || TONE.UNKNOWN;
  const Icon = t.icon;
  const checks = useMemo(() => [...safety.checks].sort((a, b) => STATUS[a.status].order - STATUS[b.status].order), [safety.checks]);
  const counts = useMemo(() => ({ fail: checks.filter(c => c.status === 'fail').length, warn: checks.filter(c => c.status === 'warn').length, pass: checks.filter(c => c.status === 'pass').length }), [checks]);
  const recheck = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await apiFetch<{ tokenSafety: TokenSafety | null }>(`/api/token-safety/${encodeURIComponent(safety.mint)}`);
      if (r.tokenSafety) setSafety(r.tokenSafety);
    } catch {
    } finally {
      setBusy(false);
    }
  };
  const copy = () => {
    navigator.clipboard?.writeText(safety.mint).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <section className={`not-prose mt-3 rounded-2xl border border-white/[0.08] bg-gradient-to-br ${t.glow} to-transparent overflow-hidden font-sans`} aria-label="Token safety check">
      <div className="p-3.5 flex items-start gap-3">
        <ScoreRing score={safety.score} color={t.ring} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-white">
              <Icon className={`w-4 h-4 ${t.text}`} /> Token safety
            </span>
            <span className={`h-5 px-2 rounded-full border text-[10px] font-bold uppercase tracking-wide inline-flex items-center ${t.pill}`}>{t.label}</span>
          </div>
          <p className="mt-1 text-xs text-slate-300 leading-relaxed">{safety.headline}</p>
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-slate-500 tabular-nums">
            {counts.fail > 0 && <span className="text-rose-300">{counts.fail} risk{counts.fail === 1 ? '' : 's'}</span>}
            {counts.warn > 0 && <span className="text-amber-300">{counts.warn} to watch</span>}
            <span className="text-emerald-300/90">{counts.pass} passed</span>
          </div>
        </div>
      </div>

      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="w-full flex items-center justify-between px-3.5 h-9 border-t border-white/[0.06] text-[11px] font-medium text-slate-300 hover:text-white cursor-pointer">
        {open ? 'Hide the checks' : `See all ${checks.length} checks`}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="px-3.5 pb-3 space-y-2">
          {checks.map(c => {
            const S = STATUS[c.status];
            const SI = S.icon;
            return (
              <li key={c.id} className="flex items-start gap-2.5">
                <span className={`mt-px w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${S.cls}`}>
                  <SI className="w-3 h-3" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-white">{c.label}</span>
                  <span className="block text-[11px] text-slate-400 leading-relaxed">{c.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="px-3.5 py-2.5 border-t border-white/[0.06] flex items-center gap-2 flex-wrap text-[10px] text-slate-500">
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 font-mono hover:text-white cursor-pointer" title="Copy the token address">
          <Copy className="w-3 h-3" /> {copied ? 'Copied' : short(safety.mint)}
        </button>
        <span>· Checked {ago(safety.checkedAt)} · {safety.sources.join(', ')}</span>
        <span className="ml-auto flex items-center gap-1.5">
          <a href={`https://solscan.io/token/${encodeURIComponent(safety.mint)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-white/[0.05] hover:bg-white/[0.09] text-slate-300 hover:text-white">
            Solscan <ExternalLink className="w-3 h-3" />
          </a>
          <button type="button" onClick={recheck} disabled={busy} aria-label="Check again" className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-white/[0.05] hover:bg-white/[0.09] text-slate-300 hover:text-white cursor-pointer disabled:opacity-60">
            <RefreshCw className={`w-3 h-3 ${busy ? 'animate-spin' : ''}`} /> Recheck
          </button>
        </span>
      </div>
      <p className="px-3.5 pb-3 text-[10px] text-slate-500 leading-relaxed">On-chain checks lower the risk of a rug pull; they can't remove it. Not financial advice.</p>
    </section>
  );
};

/** On-chain proof of a signal: opens its public verification page */
export const ProofBadge: React.FC<{ proof: { id: string; hash: string } }> = ({ proof }) => (
  <a
    href={`/proof/${encodeURIComponent(proof.id)}`}
    target="_blank"
    rel="noopener noreferrer"
    title={`Sealed the moment it was served. Fingerprint ${proof.hash}. Tap to verify it on Solana.`}
    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-gradient-to-r from-violet-500/15 to-emerald-500/15 border border-violet-400/30 text-[11px] font-semibold text-violet-100 hover:brightness-125 transition"
  >
    <ShieldCheck className="w-3.5 h-3.5 text-emerald-300" />
    Proof on Solana
    <span className="font-mono text-[10px] text-violet-200/70">{proof.hash.slice(0, 6)}</span>
  </a>
);
