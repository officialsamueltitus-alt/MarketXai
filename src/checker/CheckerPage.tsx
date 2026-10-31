import { AskMattButton } from '../components/AskMattButton';
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Search, Loader2, XCircle, Copy, Check, ExternalLink, Calendar, Fingerprint, TrendingUp, TrendingDown, ChevronDown, CalendarRange, History } from 'lucide-react';
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
  record: Summary;
  recent: Result[];
  /** Months with results, newest first */
  months?: Array<Summary & { month: string }>;
  firstAt?: number | null;
  thisMonth?: string;
}
interface Summary { results: number; wins: number; losses: number; missed: number; ended?: number; winRate: number | null; totalR?: number | null }
interface Result { symbol: string; timeframe: string; direction: 'LONG' | 'SHORT'; outcome: 'WIN' | 'LOSS' | 'MISSED' | 'ENDED'; tpsHit: number; closedAt: number; r?: number }
type Range = { kind: 'all' } | { kind: 'month'; month: string } | { kind: 'custom'; from: string; to: string };
/** Results shown at first, and how many each "See more" adds */
const FIRST = 5;
const MORE = 10;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (m: string) => `${MONTHS[Number(m.split('-')[1]) - 1] || m} ${m.split('-')[0]}`;
const prevMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`;
};
const isoDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fmtR = (r?: number | null) => (typeof r === 'number' ? `${r > 0 ? '+' : ''}${r.toFixed(2)}R` : '—');
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
            <AskMattButton variant="link" className="mt-1" label="What is a MarketX ID?" ask={{ q: 'What is a MarketX ID, how do I activate mine, and how does the public checker work?', label: 'MarketX ID' }} />
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

            <RecordSection profile={profile} />
          </>
        )}

        <p className="mt-6 px-1 text-[11px] text-slate-500 leading-relaxed">
          The checker only shows a trader’s public profile and their trade results. Email addresses, credits and payment details are never shown.
          Past results don’t guarantee future ones.
        </p>
        <p className="mt-4 text-center text-[11px] text-slate-500">
          MarketX · Built by <span className="text-slate-300 font-medium">SpiriTech Labs</span>
        </p>
      </main>
    </div>
  );
}

/** Record on Solana: the trader's results for any period (all time, this month, a past month or custom dates), a few at
 *  a time with "See more" */
function RecordSection({ profile }: { profile: PublicProfile }) {
  const thisMonth = profile.thisMonth || isoDay(Date.now()).slice(0, 7);
  const lastMonth = prevMonth(thisMonth);
  const months = profile.months || [];
  const earlier = months.filter(m => m.month !== thisMonth && m.month !== lastMonth);
  const [range, setRange] = useState<Range>({ kind: 'all' });
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState(profile.firstAt ? isoDay(profile.firstAt) : isoDay(Date.now() - 30 * 86400_000));
  const [to, setTo] = useState(isoDay(Date.now()));
  const [items, setItems] = useState<Result[]>(profile.recent.slice(0, FIRST));
  const [summary, setSummary] = useState<Summary>(profile.record);
  const [total, setTotal] = useState(profile.record.results);
  const [next, setNext] = useState<number | null>(profile.record.results > FIRST ? FIRST : null);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const query = (r: Range, offset: number, limit: number) => {
    const q = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    if (r.kind === 'month') q.set('month', r.month);
    if (r.kind === 'custom') {
      q.set('from', String(new Date(`${r.from}T00:00:00`).getTime()));
      q.set('to', String(new Date(`${r.to}T23:59:59.999`).getTime()));
    }
    return apiFetch<{ summary: Summary; items: Result[]; total: number; nextOffset: number | null }>(`/api/checker/${encodeURIComponent(profile.id)}/records?${q}`);
  };
  const pick = async (r: Range) => {
    setRange(r);
    if (r.kind !== 'custom') setCustomOpen(false);
    setErr(null);
    setLoading(true);
    try {
      const d = await query(r, 0, FIRST);
      setItems(d.items);
      setSummary(d.summary);
      setTotal(d.total);
      setNext(d.nextOffset);
    } catch (e: any) {
      setErr(e?.message || 'Could not load these results.');
    } finally {
      setLoading(false);
    }
  };
  const seeMore = async () => {
    if (next == null) return;
    setMore(true);
    try {
      const d = await query(range, next, MORE);
      setItems(cur => [...cur, ...d.items]);
      setNext(d.nextOffset);
    } catch (e: any) {
      setErr(e?.message || 'Could not load more results.');
    } finally {
      setMore(false);
    }
  };
  const label = range.kind === 'all' ? 'All time' : range.kind === 'month' ? monthLabel(range.month) : `${day(new Date(`${range.from}T00:00:00`).getTime())} – ${day(new Date(`${range.to}T00:00:00`).getTime())}`;
  const chip = (on: boolean) =>
    `shrink-0 h-9 px-3.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 border transition cursor-pointer ${on ? 'bg-white text-slate-900 border-white' : 'border-white/[0.1] bg-white/[0.03] text-slate-300 hover:bg-white/[0.07] hover:text-white'}`;
  const isMonth = (m: string) => range.kind === 'month' && range.month === m;

  return (
    <section className="mt-4 rounded-[28px] border border-white/[0.08] bg-[var(--mx-surface)] p-5 sm:p-7">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl bg-violet-500/15 text-violet-300 flex items-center justify-center shrink-0">
          <History className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white">Record on Solana</h3>
          <p className="text-[11px] text-slate-500 truncate">{label}</p>
        </div>
      </div>

      {/* Period: all time, this month, last month, an earlier month, or custom dates */}
      <div className="mt-4 -mx-1 px-1 flex gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Period">
        <button type="button" className={chip(range.kind === 'all')} onClick={() => pick({ kind: 'all' })}>
          All time
        </button>
        <button type="button" className={chip(isMonth(thisMonth))} onClick={() => pick({ kind: 'month', month: thisMonth })}>
          This month
        </button>
        <button type="button" className={chip(isMonth(lastMonth))} onClick={() => pick({ kind: 'month', month: lastMonth })}>
          Last month
        </button>
        {earlier.length > 0 && (
          <label className={`${chip(range.kind === 'month' && !isMonth(thisMonth) && !isMonth(lastMonth))} relative pr-8`}>
            <Calendar className="w-3.5 h-3.5" />
            <span>{range.kind === 'month' && !isMonth(thisMonth) && !isMonth(lastMonth) ? monthLabel(range.month) : 'Earlier months'}</span>
            <ChevronDown className="w-3.5 h-3.5 absolute right-3 pointer-events-none" />
            <select
              aria-label="Pick a month"
              value={range.kind === 'month' ? range.month : ''}
              onChange={e => e.target.value && pick({ kind: 'month', month: e.target.value })}
              className="absolute inset-0 opacity-0 cursor-pointer"
            >
              <option value="">Pick a month</option>
              {earlier.map(m => (
                <option key={m.month} value={m.month}>
                  {monthLabel(m.month)} · {m.results} result{m.results === 1 ? '' : 's'}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className={chip(range.kind === 'custom' || customOpen)} onClick={() => setCustomOpen(v => !v)} aria-expanded={customOpen}>
          <CalendarRange className="w-3.5 h-3.5" /> Custom
        </button>
      </div>
      {customOpen && (
        <form
          className="mx-rise mt-3 grid grid-cols-2 sm:grid-cols-[1fr_1fr_auto] gap-2 p-3 rounded-2xl bg-black/20 border border-white/[0.06]"
          onSubmit={e => {
            e.preventDefault();
            if (!from || !to) return;
            const [a, b] = from <= to ? [from, to] : [to, from];
            setCustomOpen(false);
            pick({ kind: 'custom', from: a, to: b });
          }}
        >
          <label className="min-w-0">
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">From</span>
            <input type="date" value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-black/30 border border-white/[0.1] text-sm text-white [color-scheme:dark]" />
          </label>
          <label className="min-w-0">
            <span className="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">To</span>
            <input type="date" value={to} min={from || undefined} max={isoDay(Date.now())} onChange={e => setTo(e.target.value)} className="w-full h-10 px-3 rounded-xl bg-black/30 border border-white/[0.1] text-sm text-white [color-scheme:dark]" />
          </label>
          <button type="submit" className="col-span-2 sm:col-span-1 self-end h-10 px-5 rounded-xl bg-white text-slate-900 text-sm font-semibold hover:bg-slate-200 cursor-pointer">
            Show results
          </button>
        </form>
      )}

      {/* The period's numbers */}
      <div className={`mt-4 grid grid-cols-2 sm:grid-cols-5 gap-2 tabular-nums transition-opacity ${loading ? 'opacity-50' : ''}`}>
        {(
          [
            ['Results', String(summary.results), 'text-white'],
            ['Wins', String(summary.wins), 'text-emerald-300'],
            ['Losses', String(summary.losses), 'text-rose-300'],
            ['Win rate', summary.winRate == null ? '—' : `${summary.winRate}%`, 'text-white'],
            ['Total R', fmtR(summary.totalR), (summary.totalR ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'],
          ] as const
        ).map(([k, v, c]) => (
          <div key={k} className="min-w-0 p-3 rounded-2xl bg-black/20 border border-white/[0.05] last:col-span-2 sm:last:col-span-1">
            <div className={`text-lg font-semibold ${c}`}>{v}</div>
            <div className="text-[11px] text-slate-500">{k}</div>
          </div>
        ))}
      </div>

      {err && <p className="mt-3 text-xs text-rose-300">{err}</p>}
      {loading ? (
        <div className="mt-4 space-y-2" aria-label="Loading">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-12 rounded-2xl bg-white/[0.04] animate-pulse" />
          ))}
        </div>
      ) : items.length ? (
        <>
          <ul className="mt-4 space-y-1.5">
            {items.map((r, i) => {
              const o = OUTCOME[r.outcome] || OUTCOME.MISSED;
              return (
                <li key={`${r.closedAt}-${i}`} className="mx-rise flex items-center gap-3 px-3 py-2.5 rounded-2xl bg-black/15 border border-white/[0.04]">
                  <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${r.direction === 'LONG' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'}`}>
                    {r.direction === 'LONG' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm">
                      <span className="font-mono text-white truncate">{r.symbol}</span>
                      <span className="text-[11px] text-slate-500">{r.timeframe}</span>
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {r.direction === 'LONG' ? 'Buy' : 'Sell'} · {day(r.closedAt)}
                    </span>
                  </span>
                  <span className={`shrink-0 h-6 px-2.5 rounded-full inline-flex items-center text-[11px] font-semibold ${o[1]}`}>
                    {o[0]}
                    {r.outcome === 'WIN' && r.tpsHit ? ` · TP${r.tpsHit}` : ''}
                    {typeof r.r === 'number' ? ` · ${fmtR(r.r)}` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[11px] text-slate-500 tabular-nums">
              Showing {items.length} of {total}
            </span>
            {next != null && (
              <button
                type="button"
                onClick={seeMore}
                disabled={more}
                className="h-9 px-4 rounded-full border border-white/[0.1] bg-white/[0.04] text-xs font-semibold text-white hover:bg-white/[0.08] disabled:opacity-60 cursor-pointer inline-flex items-center gap-1.5"
              >
                {more ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronDown className="w-3.5 h-3.5" />} See more
              </button>
            )}
          </div>
        </>
      ) : (
        <p className="mt-4 text-sm text-slate-500">
          {range.kind === 'all' ? 'No finished trades yet. Results show here once trades end.' : 'No finished trades in this period.'}
        </p>
      )}
    </section>
  );
}
