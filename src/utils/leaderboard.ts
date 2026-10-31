// Shared by the leaderboard panel and the profile's standings card: monthly levels and their colours.
export interface Tier { id: string; label: string; min: number; next: { label: string; min: number } | null }

const TIER_STYLE: Record<string, { ring: string; chip: string; bar: string }> = {
  ROOKIE: { ring: 'from-slate-400 to-slate-600', chip: 'bg-slate-500/15 text-slate-300', bar: 'from-slate-400 to-slate-300' },
  EXPLORER: { ring: 'from-sky-400 to-cyan-500', chip: 'bg-sky-500/15 text-sky-300', bar: 'from-sky-400 to-cyan-300' },
  ANALYST: { ring: 'from-emerald-400 to-teal-500', chip: 'bg-emerald-500/15 text-emerald-300', bar: 'from-emerald-400 to-teal-300' },
  STRATEGIST: { ring: 'from-violet-400 to-indigo-500', chip: 'bg-violet-500/15 text-violet-300', bar: 'from-violet-400 to-indigo-300' },
  MARKET_PRO: { ring: 'from-amber-300 to-orange-500', chip: 'bg-amber-500/15 text-amber-300', bar: 'from-amber-300 to-orange-400' },
  LEGEND: { ring: 'from-fuchsia-400 via-amber-300 to-cyan-300', chip: 'bg-fuchsia-500/15 text-fuchsia-300', bar: 'from-fuchsia-400 via-amber-300 to-cyan-300' },
};
export const tierStyle = (id?: string) => TIER_STYLE[id || 'ROOKIE'] || TIER_STYLE.ROOKIE;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (key: string) => MONTHS[Number(key.split('-')[1]) - 1] || key;
export const monthYear = (key: string) => `${monthName(key)} ${key.split('-')[0]}`;
