import React, { useEffect, useState } from 'react';
import { ChevronRight, Crown, Trophy } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { monthYear, tierStyle, type Tier } from '../utils/leaderboard';

// Profile → "My standings": this month's place, level and points (live) and every past month the trader scored in.
interface Standing { month: string; current: boolean; points: number; tier: Tier; rank: number | null; activeDays: number; analyses: number }
interface Standings { months: Standing[]; hidden: boolean; best: { month: string; points: number; tier: Tier; rank: number | null } | null }

const medal = (rank: number | null) => (rank === 1 ? 'text-amber-300' : rank === 2 ? 'text-slate-200' : rank === 3 ? 'text-orange-300' : 'text-white');

export const StandingsCard: React.FC<{ onOpenBoard?: () => void }> = ({ onOpenBoard }) => {
  const [data, setData] = useState<Standings | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      apiFetch<Standings>('/api/leaderboard/standings')
        .then(d => live && setData(d))
        .catch(() => live && setFailed(true));
    load();
    // This month's place moves as traders score: refreshed while the profile is open
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  if (failed && !data) return null;
  const now = data?.months.find(m => m.current) || null;
  const past = (data?.months || []).filter(m => !m.current);
  const shownPast = all ? past : past.slice(0, 3);
  const t = tierStyle(now?.tier.id);
  const toNext = now?.tier.next ? Math.min(100, ((now.points - now.tier.min) / (now.tier.next.min - now.tier.min)) * 100) : 100;
  return (
    <section className="rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-4">
      <div className="flex items-center gap-2.5">
        <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400/25 to-fuchsia-500/25 border border-white/[0.08] flex items-center justify-center shrink-0">
          <Trophy className="w-4 h-4 text-amber-300" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">My standings</p>
          <p className="text-[11px] text-slate-500 truncate">Your place, level and points on the monthly leaderboard</p>
        </div>
        {onOpenBoard && (
          <button type="button" onClick={onOpenBoard} className="shrink-0 inline-flex items-center gap-0.5 h-8 px-3 rounded-full text-[11px] font-semibold text-violet-200 bg-violet-500/10 hover:bg-violet-500/20 cursor-pointer">
            Board <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {!data ? (
        <div className="mt-3 h-20 rounded-2xl mx-lb-skel" aria-label="Loading" />
      ) : (
        <>
          <div className="mt-3 flex items-center gap-3 rounded-2xl bg-black/20 border border-white/[0.05] p-3">
            <div className={`w-14 h-14 rounded-2xl p-[2px] bg-gradient-to-br ${t.ring} shrink-0`}>
              <div className="w-full h-full rounded-[14px] bg-[var(--mx-bg-2)] flex flex-col items-center justify-center">
                <span className="text-[9px] uppercase tracking-wider text-slate-500 leading-none">Rank</span>
                <span className={`mt-0.5 text-lg font-bold tabular-nums leading-none ${medal(now?.rank ?? null)}`}>{now?.rank ? `#${now.rank}` : '–'}</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">This month</p>
              <div className="flex items-center gap-2">
                <span className="text-xl font-semibold text-white tabular-nums">{(now?.points || 0).toLocaleString()}</span>
                <span className="text-[11px] text-slate-400">points</span>
                <span className={`ml-auto inline-flex items-center h-6 px-2.5 rounded-full text-[10px] font-semibold ${t.chip}`}>{now?.tier.label || 'Rookie'}</span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <span className={`block h-full rounded-full bg-gradient-to-r ${t.bar}`} style={{ width: `${now ? toNext : 0}%` }} />
              </div>
              <p className="mt-1 text-[10px] text-slate-500">
                {!now ? 'Run an analysis or ask a question to get on the board.' : now.tier.next ? `${(now.tier.next.min - now.points).toLocaleString()} points to ${now.tier.next.label}` : 'Top level reached.'}
              </p>
            </div>
          </div>

          {past.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Past months</p>
              <ul className="mt-1.5 space-y-1.5">
                {shownPast.map(m => {
                  const ms = tierStyle(m.tier.id);
                  return (
                    <li key={m.month} className="flex items-center gap-2.5 rounded-2xl border border-white/[0.05] bg-black/10 px-3 py-2">
                      <span className={`w-9 text-center text-sm font-bold tabular-nums ${medal(m.rank)}`}>
                        {m.rank && m.rank <= 3 ? <Crown className="inline w-3.5 h-3.5 -mt-0.5" /> : null}
                        {m.rank ? `#${m.rank}` : '–'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold text-white">{monthYear(m.month)}</span>
                        <span className="block text-[10px] text-slate-500">
                          {m.activeDays} active day{m.activeDays === 1 ? '' : 's'} · {m.analyses} analys{m.analyses === 1 ? 'is' : 'es'}
                        </span>
                      </span>
                      <span className={`inline-flex items-center h-5 px-2 rounded-full text-[9px] font-semibold ${ms.chip}`}>{m.tier.label}</span>
                      <span className="w-16 text-right text-xs font-semibold text-white tabular-nums">{m.points.toLocaleString()} <span className="text-[9px] text-slate-500 font-normal">pts</span></span>
                    </li>
                  );
                })}
              </ul>
              {past.length > 3 && (
                <button type="button" onClick={() => setAll(v => !v)} className="mt-2 w-full h-8 rounded-xl text-[11px] font-semibold text-violet-300 hover:bg-white/[0.04] cursor-pointer">
                  {all ? 'Show fewer' : `Show all ${past.length} months`}
                </button>
              )}
            </div>
          )}
          {data.hidden && <p className="mt-2 text-[10px] text-slate-500">You are hidden from the public boards; your place is where you would stand.</p>}
        </>
      )}
    </section>
  );
};
