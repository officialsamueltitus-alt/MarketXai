// Daily analyses refill every day at 3:00 AM in the site's time zone (CREDIT_RESET_TZ, default Africa/Lagos),
// not 24 hours after the last use. Everyone shares the same refill moment, so it can't be moved by changing a
// device clock or time zone.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const CREDIT_RESET_TZ = (() => {
  const tz = String(process.env.CREDIT_RESET_TZ || '').trim();
  return tz && validZone(tz) ? tz : 'Africa/Lagos';
})();
export const CREDIT_RESET_HOUR = 3;
/** e.g. "3:00 AM Lagos time", for messages written on the server (the site shows the reader's own clock) */
export const CREDIT_RESET_LABEL = `3:00 AM ${CREDIT_RESET_TZ.split('/').pop()!.replace(/_/g, ' ')} time`;

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: CREDIT_RESET_TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** The zone's offset from UTC at an instant (local wall clock minus UTC), in ms. */
function offsetAt(at: number): number {
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(at))) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return wall - Math.floor(at / 1000) * 1000;
}

/** The most recent 3:00 AM refill at or before `now`. */
export function lastDailyReset(now: number = Date.now()): number {
  const wall = new Date(now + offsetAt(now));
  let boundaryWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), CREDIT_RESET_HOUR);
  if (boundaryWall > now + offsetAt(now)) boundaryWall -= DAY_MS;
  // Wall clock → instant, using the offset in force at that moment (correct across daylight saving changes)
  let instant = boundaryWall - offsetAt(boundaryWall - offsetAt(now));
  if (instant > now) instant = lastDailyReset(now - DAY_MS + HOUR_MS);
  return instant;
}

/** The next 3:00 AM refill after `now`. */
export function nextDailyReset(now: number = Date.now()): number {
  return lastDailyReset(lastDailyReset(now) + DAY_MS + 3 * HOUR_MS);
}

/** True when a quota last refilled at `lastReset` is due for today's refill. */
export function isDailyResetDue(lastReset: number, now: number = Date.now()): boolean {
  return !(lastReset >= lastDailyReset(now));
}
