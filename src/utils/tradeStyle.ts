// Trade type (Preference Mode, owner-specified): Scalp, Day or Swing. Shared by the server (analysis, Strategy Builder,
// watchlist, alerts, journal, track record, Solana records) and the client (Preference Mode, composer chip, cards).
//
// - Every analysis runs on a timeframe of the chosen type, whatever timeframe was asked for or whatever strategy is on
//   (the nearest one of the type; RDM scans only the type's timeframes). The trader can narrow each type to some of its
//   timeframes (`styleTimeframes`); that choice then overrides every other timeframe setting (RDM included) until changed.
// - Day trades end at 9:00 PM WAT the same day; swing trades end at 9:00 PM WAT on Friday (before the weekend). A trade
//   still open then is recorded as ENDED (closed at that time, in profit or loss) in the alert, journal, track record and
//   the Solana result record, and the trader is told to close it (heads-up 30 minutes before, then at the close).
// - Scalp trades have no forced close (their targets are minutes away on 1m to 15m charts).
import { SUPPORTED_TIMEFRAMES, timeframeMinutes } from './timeframe';

export type TradeStyle = 'ANY' | 'SCALP' | 'DAY' | 'SWING';
export const TRADE_STYLES: TradeStyle[] = ['ANY', 'SCALP', 'DAY', 'SWING'];

export const STYLE_FRAMES: Record<Exclude<TradeStyle, 'ANY'>, string[]> = {
  SCALP: ['1M', '3M', '5M', '15M'],
  DAY: ['15M', '30M', '1H', '2H'],
  SWING: ['4H', '6H', '8H', '12H', '1D', '1W'],
};

export const STYLE_INFO: Record<TradeStyle, { label: string; short: string; hold: string; frames: string }> = {
  ANY: { label: 'All trade types', short: 'Any', hold: 'Any holding time, on the timeframe you pick', frames: '1m to 1W' },
  SCALP: { label: 'Scalp trade', short: 'Scalp', hold: 'Quick trades held minutes to about an hour', frames: '1m, 3m, 5m, 15m' },
  DAY: { label: 'Day trade', short: 'Day', hold: 'Opened and closed the same day, by 9:00 PM WAT', frames: '15m, 30m, 1H, 2H' },
  SWING: { label: 'Swing trade', short: 'Swing', hold: 'Held for days, closed by Friday 9:00 PM WAT', frames: '4H, 6H, 8H, 12H, 1D, 1W' },
};

export const readTradeStyle = (v: unknown): TradeStyle => (v === 'SCALP' || v === 'DAY' || v === 'SWING' ? v : 'ANY');

/** The trader's own timeframe choice per trade type (Preference Mode); [] or missing = every timeframe of that type */
export type StyleTimeframes = Partial<Record<Exclude<TradeStyle, 'ANY'>, string[]>>;

/**
 * A valid timeframe choice for a trade type: only that type's timeframes, no repeats, in engine order. Every timeframe
 * of the type is stored as [] ("all"). null = not a valid list.
 */
export function normalizeStyleFrames(style: Exclude<TradeStyle, 'ANY'>, list: unknown): string[] | null {
  if (!Array.isArray(list)) return null;
  const want = new Set(list.map(x => String(x || '').trim().toUpperCase()));
  for (const tf of want) if (!STYLE_FRAMES[style].includes(tf)) return null;
  const out = STYLE_FRAMES[style].filter(tf => want.has(tf));
  return out.length === STYLE_FRAMES[style].length ? [] : out;
}

/** Stored choices with anything invalid dropped (a bad entry falls back to every timeframe of that type) */
export function readStyleTimeframes(v: unknown): Required<StyleTimeframes> {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  return {
    SCALP: normalizeStyleFrames('SCALP', o.SCALP) || [],
    DAY: normalizeStyleFrames('DAY', o.DAY) || [],
    SWING: normalizeStyleFrames('SWING', o.SWING) || [],
  };
}

/** The timeframes a trade type works with: the trader's choice for it, else every timeframe of the type (ANY: all) */
export function styleFrames(style: TradeStyle, custom?: string[] | null): string[] {
  if (style === 'ANY') return [...SUPPORTED_TIMEFRAMES];
  const chosen = custom?.length ? STYLE_FRAMES[style].filter(tf => custom.includes(tf)) : [];
  return chosen.length ? chosen : [...STYLE_FRAMES[style]];
}

/** True when the trader narrowed this trade type to some of its timeframes */
export const hasStyleChoice = (style: TradeStyle, custom?: string[] | null) => style !== 'ANY' && styleFrames(style, custom).length < STYLE_FRAMES[style].length;

/** "1m, 5m" (the chosen ones) or "1m, 3m, 5m, 15m" (all of the type) */
export const styleFramesLabel = (style: TradeStyle, custom?: string[] | null) =>
  style === 'ANY' ? STYLE_INFO.ANY.frames : styleFrames(style, custom).map(tf => tf.replace(/^(\d+)M$/, '$1m')).join(', ');

/** The timeframe of this type nearest to the one asked for (unchanged when it already fits) */
export function fitTimeframe(tf: string, style: TradeStyle, custom?: string[] | null): string {
  if (style === 'ANY') return tf;
  const allowed = styleFrames(style, custom);
  if (allowed.includes(tf)) return tf;
  const target = Math.log(timeframeMinutes(tf));
  return allowed.reduce((best, x) => (Math.abs(Math.log(timeframeMinutes(x)) - target) < Math.abs(Math.log(timeframeMinutes(best)) - target) ? x : best), allowed[0]);
}

/**
 * RDM under a trade type. The trader picked timeframes for the type: exactly those (they override the RDM choice).
 * Otherwise the trader's RDM timeframes inside the type (all of the type's when none overlap).
 */
export function styleRdmFrames(rdm: string[], style: TradeStyle, custom?: string[] | null): string[] {
  if (style === 'ANY') return rdm;
  if (hasStyleChoice(style, custom)) return styleFrames(style, custom);
  const inside = rdm.filter(tf => STYLE_FRAMES[style].includes(tf));
  return inside.length ? inside : [...STYLE_FRAMES[style]];
}

/**
 * A personal strategy under a trade type (the type wins over the strategy's own timeframes): the frames the strategy
 * trades among those asked; else its own timeframes inside the type (the nearest one for a single timeframe); else the
 * type's frames as asked, so a trade of the chosen type is still looked for.
 */
export function styleStrategyFrames(ruleTfs: string[], frames: string[], style: TradeStyle, custom?: string[] | null): string[] {
  if (!ruleTfs.length) return frames;
  const hit = frames.filter(tf => ruleTfs.includes(tf));
  if (hit.length || style === 'ANY') return hit;
  const allowed = styleFrames(style, custom);
  const inside = ruleTfs.filter(tf => allowed.includes(tf));
  if (!inside.length) return frames;
  if (frames.length !== 1) return inside;
  const target = Math.log(timeframeMinutes(frames[0]));
  return [inside.reduce((best, x) => (Math.abs(Math.log(timeframeMinutes(x)) - target) < Math.abs(Math.log(timeframeMinutes(best)) - target) ? x : best), inside[0])];
}

// West Africa Time is UTC+1 all year (no daylight saving): 9:00 PM WAT = 20:00 UTC
const WAT_OFFSET_MS = 3600e3;
const CLOSE_UTC_HOUR = 20;
/** A day trade issued less than this before 9:00 PM WAT belongs to the next day's session */
const DAY_MIN_LEFT_MS = 30 * 60e3;
/** A swing trade issued less than this before Friday 9:00 PM WAT runs to the next Friday */
const SWING_MIN_LEFT_MS = 24 * 3600e3;
/** The heads-up to close comes this long before the close */
export const CLOSE_WARNING_MS = 30 * 60e3;

/** When a trade of this type must be closed (null: no forced close) */
export function closeDeadline(style: TradeStyle, issuedAt: number): number | null {
  if (style !== 'DAY' && style !== 'SWING') return null;
  const wat = new Date(issuedAt + WAT_OFFSET_MS);
  let d = Date.UTC(wat.getUTCFullYear(), wat.getUTCMonth(), wat.getUTCDate(), CLOSE_UTC_HOUR);
  if (style === 'DAY') {
    while (d - issuedAt < DAY_MIN_LEFT_MS) d += 86400e3;
    return d;
  }
  // Swing: Friday 9:00 PM WAT (WAT weekday of the close = UTC weekday at 20:00 UTC)
  for (let i = 0; i < 14; i++) {
    if (new Date(d).getUTCDay() === 5 && d - issuedAt >= SWING_MIN_LEFT_MS) return d;
    d += 86400e3;
  }
  return d;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "9:00 PM WAT, Mon 12 Oct" */
export function closeByText(t: number): string {
  const w = new Date(t + WAT_OFFSET_MS);
  const h = w.getUTCHours();
  const m = String(w.getUTCMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'} WAT, ${DAYS[w.getUTCDay()]} ${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]}`;
}

/** What a served result carries (strategy.tradeStyle) */
export interface TradeStyleTag {
  style: Exclude<TradeStyle, 'ANY'>;
  label: string;
  /** When the trade must be closed (day and swing), epoch ms */
  closeBy: number | null;
  closeByText: string | null;
  /** The timeframe the analysis asked for, when the trade type moved it */
  askedTimeframe?: string;
}
