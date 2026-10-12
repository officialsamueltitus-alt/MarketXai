import React, { useEffect, useState } from 'react';
import { ArrowLeft, Search, Loader2, XCircle, Copy, Check, ExternalLink, Calendar, Fingerprint, TrendingUp, TrendingDown } from 'lucide-react';
import { MarketXIcon } from '../components/MarketXIcon';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { apiFetch } from '../utils/apiClient';

// Public ID checker at /checker: paste a MarketX ID (a trader's Solana address) and see who it belongs to: picture,
// name, username, verified badge, join date and their on-chain trade record. Never email, credits or plan details.
interface PublicProfile {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
  joinedAt: number;
  onSolana: boolean;
  solscan: string;
  record: { results: number; wins: number; losses: number; missed: number; winRate: number | null; totalR?: number | null };
  recent: Array<{ symbol: string; timeframe: string; direction: 'LONG' | 'SHORT'; outcome: 'WIN' | 'LOSS' | 'MISSED' | 'ENDED'; tpsHit: number; closedAt: number; r?: number }>;
}
const ID_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const day = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const OUTCOME: Record<string, [string, string]> = {
  WIN: ['Win', 'text-emerald-300 bg-emerald-500/10'],
  LOSS: ['Loss', 'text-rose-300 bg-rose-500/10'],
  MISSED: ['Missed', 'text-slate-300 bg-white/[0.06]'],
  ENDED: ['Ended', 'text-amber-300 bg-amber-500/10'],
};

export default function CheckerPage() {
  const initial = new URLSearchParams(window.location.search).get('id') || '';
  const [input, setInput] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const prev = document.title;
    document.title = 'ID checker · MarketX';
    if (initial) lookup(initial);
    return () => {
      document.title = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function lookup(raw: string) {
    const id = raw.trim();
    setProfile(null);
    if (!ID_RE.test(id)) {
      setError('That does not look like a MarketX ID. Paste the full ID from the trader’s profile.');
      return;
    }
    setError(null);
    setLoading(true);
    history.replaceState(null, '', `/checker?id=${encodeURIComponent(id)}`);
    try {
      const r = await apiFetch<{ profile: PublicProfile }>(`/api/checker/${encodeURIComponent(id)}`);
      setProfile(r.profile);
    } catch (e: any) {
      setError(e?.message || 'No MarketX trader has this ID.');
    } finally {
      setLoading(false);
    }
  }
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
            <span className="text-sm font-semibold text-white truncate">ID checker</span>
          </span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pb-20">
        <section className="relative mt-6 sm:mt-10 overflow-hidden rounded-[28px] border border-white/[0.08] bg-[var(--mx-surface)] px-5 py-7 sm:px-8 sm:py-9">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_0%_0%,rgba(139,92,246,0.28),transparent_55%),radial-gradient(80%_120%_at_100%_0%,rgba(16,185,129,0.2),transparent_55%)]" />
          <div className="relative">
            <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">Check a MarketX ID</h1>
            <p className="mt-1.5 text-sm text-slate-400">Paste a trader’s MarketX ID to see who they are and their record on Solana.</p>
            <form
              className="mt-5 flex flex-col sm:flex-row gap-2"
              onSubmit={e => {
                e.preventDefault();
                lookup(input);
              }}
            >
              <label className="flex-1 min-w-0 flex items-center gap-2 h-12 px-4 rounded-2xl bg-black/30 border border-white/[0.1] focus-within:border-violet-400/60 transition">
                <Fingerprint className="w-4 h-4 text-slate-500 shrink-0" />
                <input
                  value={input}
                  onChange={e => setInput(e.target.value.replace(/\s/g, '').slice(0, 64))}
                  placeholder="Paste a MarketX ID"
                  aria-label="MarketX ID"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="flex-1 min-w-0 bg-transparent font-mono text-sm text-white placeholder:font-sans placeholder:text-slate-600 focus:outline-none"
                />
              </label>
              <button type="submit" disabled={loading || !input} className="h-12 px-6 rounded-2xl bg-white text-slate-900 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-200 disabled:opacity-60 cursor-pointer transition">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Check
              </button>
            </form>
            {error && (
              <p className="mt-3 flex items-start gap-2 text-sm text-rose-300">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
              </p>
            )}
          </div>
        </section>

        {profile && (
          <>
            <section className="mt-4 rounded-[28px] border border-white/[0.08] bg-[var(--mx-surface)] p-5 sm:p-7">
              <div className="flex items-center gap-4">
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" className="w-20 h-20 rounded-full object-cover border border-white/[0.1] shrink-0" />
                ) : (
                  <span className="w-20 h-20 rounded-full bg-gradient-to-br from-violet-500/40 to-emerald-500/30 border border-white/[0.1] flex items-center justify-center text-2xl font-semibold text-white shrink-0">
                    {(profile.displayName || profile.username || '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl sm:text-2xl font-semibold text-white truncate">{profile.displayName || profile.username}</h2>
                    {profile.verified && <VerifiedBadge size="md" />}
                  </div>
                  <p className="text-sm text-slate-400 truncate">@{profile.username}</p>
                  <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-slate-500">
                    <Calendar className="w-3 h-3" /> Joined {day(profile.joinedAt)}
                  </p>
                </div>
              </div>
              <div className="mt-5 p-3 rounded-2xl bg-black/25 border border-white/[0.06]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] uppercase tracking-wider text-slate-500">MarketX ID</span>
                  <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold ${profile.onSolana ? 'text-emerald-300' : 'text-amber-200'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${profile.onSolana ? 'bg-emerald-400' : 'bg-amber-300'}`} />
                    {profile.onSolana ? 'On Solana' : 'Not activated yet'}
                  </span>
                </div>
                <button type="button" onClick={() => copy(profile.id)} className="mt-1 w-full flex items-center gap-2 text-left cursor-pointer" title="Copy the ID">
                  <span className="flex-1 min-w-0 font-mono text-xs sm:text-sm text-slate-200 break-all">{profile.id}</span>
                  {copied ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : <Copy className="w-4 h-4 text-slate-500 shrink-0" />}
                </button>
                <a href={profile.solscan} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 hover:text-emerald-200">
                  View every trade on Solscan <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </section>

            <section className="mt-4 rounded-[28px] border border-white/[0.08] bg-[var(--mx-surface)] p-5 sm:p-7">
              <h3 className="text-sm font-semibold text-white">Record on Solana</h3>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 tabular-nums">
                {[
                  ['Results', String(profile.record.results), 'text-white'],
                  ['Wins', String(profile.record.wins), 'text-emerald-300'],
                  ['Losses', String(profile.record.losses), 'text-rose-300'],
                  ['Win rate', profile.record.winRate == null ? '—' : `${profile.record.winRate}%`, 'text-white'],
                  ['Total R', typeof profile.record.totalR === 'number' ? `${profile.record.totalR > 0 ? '+' : ''}${profile.record.totalR.toFixed(2)}R` : '—', (profile.record.totalR ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'],
                ].map(([k, v, c]) => (
                  <div key={k} className="min-w-0 p-3 rounded-2xl bg-black/20 border border-white/[0.05] last:col-span-2 sm:last:col-span-1">
                    <div className={`text-lg font-semibold ${c}`}>{v}</div>
                    <div className="text-[11px] text-slate-500">{k}</div>
                  </div>
                ))}
              </div>
              {profile.recent.length ? (
                <ul className="mt-4 divide-y divide-white/[0.05]">
                  {profile.recent.map((r, i) => (
                    <li key={i} className="py-2.5 flex items-center gap-3 text-sm">
                      {r.direction === 'LONG' ? <TrendingUp className="w-4 h-4 text-emerald-300 shrink-0" /> : <TrendingDown className="w-4 h-4 text-rose-300 shrink-0" />}
                      <span className="font-mono text-white truncate">{r.symbol}</span>
                      <span className="text-xs text-slate-500">{r.timeframe}</span>
                      <span className={`ml-auto shrink-0 h-6 px-2.5 rounded-full inline-flex items-center text-[11px] font-semibold ${(OUTCOME[r.outcome] || OUTCOME.MISSED)[1]}`}>
                        {(OUTCOME[r.outcome] || OUTCOME.MISSED)[0]}
                        {r.outcome === 'WIN' && r.tpsHit ? ` · TP${r.tpsHit}` : ''}
                        {typeof r.r === 'number' ? ` · ${r.r > 0 ? '+' : ''}${r.r.toFixed(2)}R` : ''}
                      </span>
                      <span className="hidden sm:inline text-xs text-slate-500 w-24 text-right shrink-0">{day(r.closedAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-slate-500">No finished trades yet. Results show here once trades end.</p>
              )}
            </section>
          </>
        )}

        <p className="mt-6 px-1 text-[11px] text-slate-500 leading-relaxed">
          The checker only shows a trader’s public profile and their trade results. Email addresses, credits and payment details are never shown.
          Past results don’t guarantee future ones.
        </p>
      </main>
    </div>
  );
}
