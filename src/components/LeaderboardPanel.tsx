import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, ChevronDown, Crown, Eye, EyeOff, Flame, Info, Loader2, RefreshCw, Sparkles, Trophy, Users, X, Zap } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { VerifiedBadge } from './VerifiedBadge';
import { InviteCard } from './InviteCard';

// Leaderboard (owner-specified): two boards behind one animated switch.
//   Usage     : this month's most active traders. Points from real use (analyses, questions, Fundamental Analysis, Matt),
//               a level for every trader, a live countdown to the monthly reset, last month's champions.
//   Referrals : who brought the most traders to MarketX, plus the trader's own invite link.
// Public rows carry display name, username, picture and badge only. Traders can hide themselves.
export type Board = 'usage' | 'referrals';
interface Tier { id: string; label: string; min: number; next: { label: string; min: number } | null }
interface Person { rank: number; username: string; displayName: string; avatarUrl: string | null; verified: boolean; isMe?: boolean }
interface UsageRow extends Person {
  points: number;
  tier: Tier;
  analyses: number;
  questions: number;
  fundamentals: number;
  matt: number;
  activeDays: number;
  streak: number;
  topPair: string | null;
}
interface UsageData {
  month: string;
  resetsAt: number;
  scoring: { points: Record<'analysis' | 'question' | 'fundamental' | 'matt', number>; activeDay: number };
  rows: UsageRow[];
  me: Omit<UsageRow, keyof Person> & { rank: number | null; hidden: boolean };
  lastMonth: { month: string; top: Array<Person & { points: number; tier: Tier }> };
}
interface RefRow extends Person { invited: number; thisMonth: number }
interface RefData {
  month: string;
  rows: RefRow[];
  me: { rank: number | null; invited: number; thisMonth: number; earned: number; hidden: boolean };
  program: { enabled: boolean; credits: number };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (key: string) => MONTHS[Number(key.split('-')[1]) - 1] || key;
const TIER_STYLE: Record<string, { ring: string; chip: string; bar: string }> = {
  ROOKIE: { ring: 'from-slate-400 to-slate-600', chip: 'bg-slate-500/15 text-slate-300', bar: 'from-slate-400 to-slate-300' },
  EXPLORER: { ring: 'from-sky-400 to-cyan-500', chip: 'bg-sky-500/15 text-sky-300', bar: 'from-sky-400 to-cyan-300' },
  ANALYST: { ring: 'from-emerald-400 to-teal-500', chip: 'bg-emerald-500/15 text-emerald-300', bar: 'from-emerald-400 to-teal-300' },
  STRATEGIST: { ring: 'from-violet-400 to-indigo-500', chip: 'bg-violet-500/15 text-violet-300', bar: 'from-violet-400 to-indigo-300' },
  MARKET_PRO: { ring: 'from-amber-300 to-orange-500', chip: 'bg-amber-500/15 text-amber-300', bar: 'from-amber-300 to-orange-400' },
  LEGEND: { ring: 'from-fuchsia-400 via-amber-300 to-cyan-300', chip: 'bg-fuchsia-500/15 text-fuchsia-300', bar: 'from-fuchsia-400 via-amber-300 to-cyan-300' },
};
const tierStyle = (id?: string) => TIER_STYLE[id || 'ROOKIE'] || TIER_STYLE.ROOKIE;

function Avatar({ p, size = 36, ring }: { p: Pick<Person, 'avatarUrl' | 'displayName' | 'username'>; size?: number; ring?: string }) {
  const letter = (p.displayName || p.username || '?').trim().slice(0, 1).toUpperCase();
  return (
    <span className={`relative inline-flex shrink-0 rounded-full p-[2px] bg-gradient-to-br ${ring || 'from-white/15 to-white/5'}`} style={{ width: size, height: size }}>
      <span className="w-full h-full rounded-full overflow-hidden bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center text-white font-semibold" style={{ fontSize: size * 0.38 }}>
        {p.avatarUrl ? <img src={p.avatarUrl} alt="" loading="lazy" className="w-full h-full object-cover" /> : letter}
      </span>
    </span>
  );
}

/** Counts up to a number once (on first show / when it changes) */
function useCountUp(value: number, ms = 700) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      setShown(Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

function Countdown({ to }: { to: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, to - now);
  const d = Math.floor(left / 86400000);
  const h = Math.floor((left % 86400000) / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  const cell = (v: number, l: string) => (
    <span className="flex flex-col items-center min-w-[42px] px-1.5 py-1.5 rounded-xl bg-black/25 border border-white/[0.06]">
      <span key={v} className="mx-lb-tick text-base font-semibold text-white tabular-nums leading-none">{String(v).padStart(2, '0')}</span>
      <span className="mt-1 text-[9px] uppercase tracking-wider text-slate-500">{l}</span>
    </span>
  );
  return (
    <div className="flex items-center gap-1.5" aria-label={`Resets in ${d} days ${h} hours ${m} minutes`}>
      {cell(d, 'days')}
      {cell(h, 'hrs')}
      {cell(m, 'min')}
      {cell(s, 'sec')}
    </div>
  );
}

function Podium<T extends Person>({ rows, value, unit }: { rows: T[]; value: (r: T) => number; unit: string }) {
  const [first, second, third] = rows;
  const slot = (r: T | undefined, place: 1 | 2 | 3) => {
    const h = place === 1 ? 'h-24' : place === 2 ? 'h-16' : 'h-12';
    const ring = place === 1 ? 'from-amber-200 via-amber-400 to-orange-500' : place === 2 ? 'from-slate-200 to-slate-400' : 'from-orange-300 to-amber-700';
    return (
      <div className={`mx-lb-podium flex-1 min-w-0 flex flex-col items-center`} style={{ animationDelay: `${place === 1 ? 160 : place === 2 ? 60 : 260}ms` }}>
        {r ? (
          <>
            <div className="relative">
              {place === 1 && <Crown className="mx-lb-crown absolute -top-5 left-1/2 -translate-x-1/2 w-5 h-5 text-amber-300" />}
              <Avatar p={r} size={place === 1 ? 64 : 50} ring={ring} />
              {r.verified && (
                <span className="absolute -bottom-0.5 -right-0.5">
                  <VerifiedBadge size="sm" />
                </span>
              )}
            </div>
            <p className={`mt-1.5 max-w-full truncate text-xs font-semibold ${r.isMe ? 'text-violet-200' : 'text-white'}`}>{r.displayName || r.username}</p>
            <p className="max-w-full truncate text-[10px] text-slate-500">@{r.username}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-200 tabular-nums">
              {value(r).toLocaleString()} <span className="text-slate-500 font-normal">{unit}</span>
            </p>
          </>
        ) : (
          <div className="h-[92px] flex items-end pb-2 text-[10px] text-slate-600">Open spot</div>
        )}
        <div className={`mx-lb-step mt-2 w-full ${h} rounded-t-2xl border border-white/[0.06] flex items-start justify-center pt-1.5 ${place === 1 ? 'bg-gradient-to-b from-amber-400/25 to-amber-400/[0.02]' : place === 2 ? 'bg-gradient-to-b from-slate-300/20 to-transparent' : 'bg-gradient-to-b from-orange-400/20 to-transparent'}`}>
          <span className="text-lg font-bold text-white/80 tabular-nums">{place}</span>
        </div>
      </div>
    );
  };
  return (
    <div className="flex items-end gap-2 px-1 pt-6">
      {slot(second, 2)}
      {slot(first, 1)}
      {slot(third, 3)}
    </div>
  );
}

function UsageMix({ r, scoring }: { r: Pick<UsageRow, 'analyses' | 'questions' | 'fundamentals' | 'matt'>; scoring: UsageData['scoring'] }) {
  const parts = [
    { label: 'Analyses', n: r.analyses, w: r.analyses * scoring.points.analysis, c: 'bg-violet-400' },
    { label: 'Fundamentals', n: r.fundamentals, w: r.fundamentals * scoring.points.fundamental, c: 'bg-sky-400' },
    { label: 'Questions', n: r.questions, w: r.questions * scoring.points.question, c: 'bg-emerald-400' },
    { label: 'Matt', n: r.matt, w: r.matt * scoring.points.matt, c: 'bg-amber-300' },
  ];
  const total = parts.reduce((s, p) => s + p.w, 0) || 1;
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden bg-white/[0.05]">
        {parts.map(p => (p.w ? <span key={p.label} className={`mx-lb-seg ${p.c}`} style={{ width: `${(p.w / total) * 100}%` }} /> : null))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {parts.map(p => (
          <span key={p.label} className="inline-flex items-center gap-1 text-[10px] text-slate-400">
            <span className={`w-1.5 h-1.5 rounded-full ${p.c}`} />
            {p.label} <span className="text-slate-200 font-semibold tabular-nums">{p.n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function UsageBoardView({ data, onToggleHidden, hiding }: { data: UsageData; onToggleHidden: () => void; hiding: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [rules, setRules] = useState(false);
  const me = data.me;
  const points = useCountUp(me.points);
  const tier = tierStyle(me.tier.id);
  const toNext = me.tier.next ? Math.min(100, ((me.points - me.tier.min) / (me.tier.next.min - me.tier.min)) * 100) : 100;
  const monthStart = useMemo(() => {
    const [y, m] = data.month.split('-').map(Number);
    return Date.UTC(y, m - 1, 1);
  }, [data.month]);
  const elapsed = Math.min(100, Math.max(0, ((Date.now() - monthStart) / (data.resetsAt - monthStart)) * 100));
  const rest = data.rows.slice(3);

  return (
    <div className="space-y-3">
      {/* Season hero: the month, a live countdown to the reset */}
      <section className="mx-lb-hero relative overflow-hidden rounded-3xl border border-white/[0.07] p-4">
        <div className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-violet-200/80 font-semibold inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Season
            </p>
            <p className="mt-0.5 text-xl font-semibold text-white tracking-tight">{monthName(data.month)}</p>
            <p className="text-[11px] text-slate-400">The board resets to zero at the end of the month.</p>
          </div>
          <Trophy className="mx-lb-trophy w-9 h-9 text-amber-300/90 shrink-0" />
        </div>
        <div className="relative mt-3 flex flex-wrap items-center justify-between gap-2">
          <Countdown to={data.resetsAt} />
          <span className="text-[10px] text-slate-500">{Math.round(elapsed)}% of the season gone</span>
        </div>
        <div className="relative mt-2 h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <span className="mx-lb-grow block h-full rounded-full bg-gradient-to-r from-violet-400 via-fuchsia-400 to-amber-300" style={{ width: `${elapsed}%` }} />
        </div>
      </section>

      {/* You */}
      <section className="rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-4">
        <div className="flex items-center gap-3">
          <div className={`relative w-14 h-14 rounded-2xl p-[2px] bg-gradient-to-br ${tier.ring} shrink-0`}>
            <div className="w-full h-full rounded-[14px] bg-[var(--mx-bg-2)] flex flex-col items-center justify-center">
              <span className="text-[9px] uppercase tracking-wider text-slate-500 leading-none">Rank</span>
              <span className="mt-0.5 text-lg font-bold text-white tabular-nums leading-none">{me.rank ? `#${me.rank}` : '–'}</span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-2xl font-semibold text-white tabular-nums leading-none">{points.toLocaleString()}</p>
              <span className="text-[11px] text-slate-400">points</span>
              <span className={`ml-auto inline-flex items-center h-6 px-2.5 rounded-full text-[10px] font-semibold ${tier.chip}`}>{me.tier.label}</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <span className={`mx-lb-grow block h-full rounded-full bg-gradient-to-r ${tier.bar}`} style={{ width: `${toNext}%` }} />
            </div>
            <p className="mt-1 text-[10px] text-slate-500">
              {me.tier.next ? `${(me.tier.next.min - me.points).toLocaleString()} points to ${me.tier.next.label}` : 'Top level reached. Legend!'}
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-2xl bg-black/20 border border-white/[0.05] py-2">
            <p className="text-sm font-semibold text-white tabular-nums inline-flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-orange-400" />
              {me.streak}
            </p>
            <p className="text-[10px] text-slate-500">Best streak</p>
          </div>
          <div className="rounded-2xl bg-black/20 border border-white/[0.05] py-2">
            <p className="text-sm font-semibold text-white tabular-nums">{me.activeDays}</p>
            <p className="text-[10px] text-slate-500">Active days</p>
          </div>
          <div className="rounded-2xl bg-black/20 border border-white/[0.05] py-2">
            <p className="text-sm font-semibold text-white truncate px-1">{me.topPair || '–'}</p>
            <p className="text-[10px] text-slate-500">Top market</p>
          </div>
        </div>
        <div className="mt-3">
          <UsageMix r={me} scoring={data.scoring} />
        </div>
        <button type="button" onClick={() => setRules(v => !v)} className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-300 hover:text-violet-200 cursor-pointer">
          <Info className="w-3 h-3" /> How points work <ChevronDown className={`w-3 h-3 transition-transform ${rules ? 'rotate-180' : ''}`} />
        </button>
        {rules && (
          <div className="mx-rise mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
            {[
              ['Analysis', data.scoring.points.analysis],
              ['Fundamental read', data.scoring.points.fundamental],
              ['Market question', data.scoring.points.question],
              ['Matt message', data.scoring.points.matt],
              ['First action of the day', data.scoring.activeDay],
            ].map(([l, n]) => (
              <span key={String(l)} className="flex items-center justify-between px-2.5 h-8 rounded-xl bg-black/20 border border-white/[0.05]">
                <span className="text-slate-400">{l}</span>
                <span className="font-semibold text-white">+{n}</span>
              </span>
            ))}
            <p className="col-span-2 mt-1 text-[10px] text-slate-500 leading-relaxed">
              Each kind counts up to a daily limit, so steady use beats spam. Points start from zero on the 1st of every month.
            </p>
          </div>
        )}
      </section>

      {data.rows.length ? (
        <>
          <Podium rows={data.rows.slice(0, 3)} value={r => r.points} unit="pts" />
          <ol className="space-y-1.5">
            {rest.map((r, i) => {
              const t = tierStyle(r.tier.id);
              const expanded = open === r.rank;
              return (
                <li key={r.rank} className="mx-lb-row" style={{ animationDelay: `${Math.min(i * 35, 600)}ms` }}>
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : r.rank)}
                    aria-expanded={expanded}
                    className={`w-full text-left rounded-2xl border px-3 py-2.5 transition-colors cursor-pointer ${r.isMe ? 'border-violet-400/40 bg-violet-500/[0.08]' : 'border-white/[0.06] bg-[var(--mx-surface)] hover:border-white/[0.14]'}`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="w-7 text-center text-xs font-bold text-slate-400 tabular-nums">{r.rank}</span>
                      <Avatar p={r} size={34} ring={t.ring} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 text-[13px] font-semibold text-white truncate">
                          <span className="truncate">{r.displayName || r.username}</span>
                          {r.verified && <VerifiedBadge size="sm" />}
                          {r.isMe && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-200">You</span>}
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-slate-500 truncate">
                          <span className={`px-1.5 rounded-full ${t.chip}`}>{r.tier.label}</span>
                          {r.streak > 1 && (
                            <span className="inline-flex items-center gap-0.5">
                              <Flame className="w-2.5 h-2.5 text-orange-400" />
                              {r.streak}d
                            </span>
                          )}
                          {r.topPair && <span className="truncate">· {r.topPair}</span>}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block text-sm font-semibold text-white tabular-nums">{r.points.toLocaleString()}</span>
                        <span className="block text-[9px] text-slate-500">pts</span>
                      </span>
                      <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    </div>
                    {expanded && (
                      <div className="mx-rise mt-2.5 pl-9">
                        <UsageMix r={r} scoring={data.scoring} />
                        <p className="mt-1.5 text-[10px] text-slate-500">
                          Active {r.activeDays} day{r.activeDays === 1 ? '' : 's'} this month · @{r.username}
                        </p>
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        <div className="rounded-3xl border border-dashed border-white/[0.1] p-6 text-center">
          <Zap className="mx-auto w-6 h-6 text-violet-300" />
          <p className="mt-2 text-sm font-semibold text-white">The season just started</p>
          <p className="mt-1 text-xs text-slate-400">Run an analysis or ask a question to take the first spot.</p>
        </div>
      )}

      {data.lastMonth.top.length > 0 && (
        <section className="rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-3.5">
          <p className="text-[11px] font-semibold text-slate-300 inline-flex items-center gap-1.5">
            <Crown className="w-3.5 h-3.5 text-amber-300" /> {monthName(data.lastMonth.month)} champions
          </p>
          <div className="mt-2.5 flex gap-2">
            {data.lastMonth.top.map(r => (
              <div key={r.rank} className="flex-1 min-w-0 flex items-center gap-2 rounded-2xl bg-black/20 border border-white/[0.05] p-2">
                <Avatar p={r} size={28} ring={r.rank === 1 ? 'from-amber-200 to-orange-500' : r.rank === 2 ? 'from-slate-200 to-slate-400' : 'from-orange-300 to-amber-700'} />
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold text-white truncate">{r.displayName || r.username}</span>
                  <span className="block text-[9px] text-slate-500 tabular-nums">#{r.rank} · {r.points.toLocaleString()} pts</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <VisibilityRow hidden={me.hidden} onToggle={onToggleHidden} busy={hiding} />
    </div>
  );
}

function VisibilityRow({ hidden, onToggle, busy }: { hidden: boolean; onToggle: () => void; busy: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={busy}
      className="w-full flex items-center gap-2.5 px-3.5 h-12 rounded-2xl border border-white/[0.06] bg-[var(--mx-surface)] text-left cursor-pointer hover:border-white/[0.14] disabled:opacity-60"
    >
      {hidden ? <EyeOff className="w-4 h-4 text-slate-400" /> : <Eye className="w-4 h-4 text-emerald-300" />}
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-semibold text-white">{hidden ? 'You are hidden from the boards' : 'You are shown on the boards'}</span>
        <span className="block text-[10px] text-slate-500">Only your name, username and picture are shown, never your email.</span>
      </span>
      <span className={`relative w-9 h-5 rounded-full transition-colors ${hidden ? 'bg-white/15' : 'bg-emerald-500'}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-300 ${hidden ? 'translate-x-0.5' : 'translate-x-[18px]'}`} />
      </span>
    </button>
  );
}

function ReferralBoardView({ data, onToggleHidden, hiding }: { data: RefData; onToggleHidden: () => void; hiding: boolean }) {
  const invited = useCountUp(data.me.invited);
  return (
    <div className="space-y-3">
      <section className="mx-lb-hero mx-lb-hero-ref relative overflow-hidden rounded-3xl border border-white/[0.07] p-4">
        <div className="relative flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl p-[2px] bg-gradient-to-br from-cyan-300 to-violet-500 shrink-0">
            <div className="w-full h-full rounded-[14px] bg-[var(--mx-bg-2)] flex flex-col items-center justify-center">
              <span className="text-[9px] uppercase tracking-wider text-slate-500 leading-none">Rank</span>
              <span className="mt-0.5 text-lg font-bold text-white tabular-nums leading-none">{data.me.rank ? `#${data.me.rank}` : '–'}</span>
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-semibold text-white tabular-nums leading-none">
              {invited.toLocaleString()} <span className="text-sm font-normal text-slate-400">trader{data.me.invited === 1 ? '' : 's'} invited</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-400">
              {data.me.thisMonth} this month
              {data.program.enabled ? ` · ${data.program.credits} credits per invite` : ''}
            </p>
          </div>
        </div>
      </section>

      <InviteCard compact />

      {data.rows.length ? (
        <>
          <Podium rows={data.rows.slice(0, 3)} value={r => r.invited} unit="invited" />
          <ol className="space-y-1.5">
            {data.rows.slice(3).map((r, i) => (
              <li key={r.rank} className="mx-lb-row" style={{ animationDelay: `${Math.min(i * 35, 600)}ms` }}>
                <div className={`flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 ${r.isMe ? 'border-violet-400/40 bg-violet-500/[0.08]' : 'border-white/[0.06] bg-[var(--mx-surface)]'}`}>
                  <span className="w-7 text-center text-xs font-bold text-slate-400 tabular-nums">{r.rank}</span>
                  <Avatar p={r} size={34} ring="from-cyan-300/70 to-violet-500/70" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-[13px] font-semibold text-white">
                      <span className="truncate">{r.displayName || r.username}</span>
                      {r.verified && <VerifiedBadge size="sm" />}
                      {r.isMe && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-200">You</span>}
                    </span>
                    <span className="block text-[10px] text-slate-500 truncate">
                      @{r.username}
                      {r.thisMonth > 0 ? ` · +${r.thisMonth} this month` : ''}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-sm font-semibold text-white tabular-nums">{r.invited.toLocaleString()}</span>
                    <span className="block text-[9px] text-slate-500">invited</span>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="rounded-3xl border border-dashed border-white/[0.1] p-6 text-center">
          <Users className="mx-auto w-6 h-6 text-cyan-300" />
          <p className="mt-2 text-sm font-semibold text-white">No invites yet</p>
          <p className="mt-1 text-xs text-slate-400">Share your link above and be the first name on this board.</p>
        </div>
      )}

      <VisibilityRow hidden={data.me.hidden} onToggle={onToggleHidden} busy={hiding} />
    </div>
  );
}

export const LeaderboardPanel: React.FC<{ isOpen: boolean; onClose: () => void; initialBoard?: Board }> = ({ isOpen, onClose, initialBoard = 'usage' }) => {
  const [board, setBoard] = useState<Board>(initialBoard);
  const [dir, setDir] = useState<'left' | 'right'>('left');
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [refs, setRefs] = useState<RefData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hiding, setHiding] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const load = useCallback(async (which: Board) => {
    setLoading(true);
    setError(null);
    try {
      const d = await apiFetch<any>(`/api/leaderboard?board=${which}`);
      if (which === 'usage') setUsage(d);
      else setRefs(d);
    } catch (err: any) {
      setError(err?.message || 'The leaderboard is unavailable right now.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setBoard(initialBoard);
  }, [isOpen, initialBoard]);
  useEffect(() => {
    if (!isOpen) return;
    if (board === 'usage' ? !usage : !refs) load(board);
  }, [isOpen, board, usage, refs, load]);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const switchTo = (b: Board) => {
    if (b === board) return;
    setDir(b === 'referrals' ? 'left' : 'right');
    setBoard(b);
  };
  const hidden = board === 'usage' ? usage?.me.hidden : refs?.me.hidden;
  const toggleHidden = async () => {
    setHiding(true);
    try {
      await apiFetch('/api/leaderboard/visibility', { method: 'POST', body: JSON.stringify({ hidden: !hidden }) });
      // Both boards change: load them again
      setUsage(null);
      setRefs(null);
    } catch {
      /* keep as is */
    } finally {
      setHiding(false);
    }
  };

  if (!isOpen) return null;
  const data = board === 'usage' ? usage : refs;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Leaderboard">
      <button type="button" aria-label="Close leaderboard" onClick={onClose} className="absolute inset-0 bg-black/60 mx-fade-in cursor-default" />
      <section className="mx-sheet absolute inset-x-0 bottom-0 max-h-[94dvh] sm:inset-y-3 sm:right-3 sm:left-auto sm:bottom-3 sm:max-h-none sm:w-[480px] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[var(--mx-bg-2)] border border-white/[0.08] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)] overflow-hidden">
        <div className="sm:hidden flex justify-center pt-2.5" aria-hidden="true">
          <span className="w-10 h-1 rounded-full bg-white/15" />
        </div>
        <header className="flex items-center gap-2.5 px-5 pt-4 sm:pt-5 pb-3">
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400/25 to-fuchsia-500/25 border border-white/[0.08] flex items-center justify-center shrink-0">
            <Trophy className="w-4 h-4 text-amber-300" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white tracking-tight leading-tight">Leaderboard</h2>
            <p className="text-[11px] text-slate-500 truncate">The most active traders and the top inviters on MarketX</p>
          </div>
          <button
            type="button"
            onClick={() => load(board)}
            disabled={loading}
            className="ml-auto w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] cursor-pointer disabled:opacity-50"
            aria-label="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.08] cursor-pointer" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* The switch: a pill that slides between the two boards */}
        <div className="px-5 pb-3">
          <div role="tablist" aria-label="Board" className="relative grid grid-cols-2 p-1 rounded-2xl bg-black/25 border border-white/[0.06]">
            <span
              aria-hidden="true"
              className={`mx-lb-pill absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-xl ${board === 'usage' ? 'translate-x-0 mx-lb-pill-usage' : 'translate-x-full mx-lb-pill-ref'}`}
            />
            {(
              [
                ['usage', 'Usage', BarChart3],
                ['referrals', 'Referrals', Users],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={board === id}
                onClick={() => switchTo(id)}
                className={`relative z-[1] h-10 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${board === id ? 'text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-safe pb-5">
          <div key={board} className={dir === 'left' ? 'mx-lb-in-left' : 'mx-lb-in-right'}>
            {data ? (
              board === 'usage' ? (
                <UsageBoardView data={data as UsageData} onToggleHidden={toggleHidden} hiding={hiding} />
              ) : (
                <ReferralBoardView data={data as RefData} onToggleHidden={toggleHidden} hiding={hiding} />
              )
            ) : error ? (
              <div className="rounded-3xl border border-white/[0.07] p-6 text-center">
                <p className="text-sm text-slate-300">{error}</p>
                <button type="button" onClick={() => load(board)} className="mt-3 h-9 px-4 rounded-full bg-white text-slate-900 text-xs font-semibold cursor-pointer">
                  Try again
                </button>
              </div>
            ) : (
              <div className="space-y-2" aria-label="Loading">
                {[0, 1, 2, 3, 4].map(i => (
                  <div key={i} className="mx-lb-skel h-14 rounded-2xl" style={{ animationDelay: `${i * 90}ms` }} />
                ))}
                <p className="pt-2 text-center text-[11px] text-slate-500 inline-flex w-full justify-center items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Loading the board…
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
