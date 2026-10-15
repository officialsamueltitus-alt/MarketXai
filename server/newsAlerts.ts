// ===========================================================================
// Daily news alerts (owner-specified, Preference Mode → News alerts, `users.preferences.newsAlerts {enabled, impacts}`).
//
// Every morning from NEWS_ALERT_HOUR (default 7:00 AM in the site time zone, WAT), each trader who switched it on gets
// ONE notification and ONE email with the releases due in the next 24 hours that match the impacts they chose (high,
// medium, low, or all), from the live economic calendar fetched at send time. Each release in the email carries a
// three-line briefing (written once per day for everyone, `writeNewsBriefings`; a plain template when the engine is
// unavailable) and its own "Analyze it" button, which opens MarketX with "/fundamental-analysis <release>" ready.
// A trader who switches it on later in the day gets the rest of that day's releases at the next sweep. Each trader is
// sent once per day (`users.newsAlertsDay`, claimed in a transaction). Nothing is sent when no release matches.
// ===========================================================================
import { addNotification, siteLink, userRef, type UserDoc } from './account';
import { db, isFirebaseConfigured } from './firebase';
import { IS_LEAD_WORKER } from './workers';
import { sendEmail } from './mailer';
import { CREDIT_RESET_TZ } from './dailyReset';
import { getFullCalendar, refreshNewsFeedsWithin, type EconEvent } from './news';
import { writeNewsBriefings, type BriefEvent } from './fundamental';
import { readNewsAlerts, newsImpactLabel, type NewsImpact } from '../src/utils/preferences';

const HOUR = Math.max(0, Math.min(23, Number(process.env.NEWS_ALERT_HOUR) || 7));
const SWEEP_MS = Math.max(5000, Number(process.env.NEWS_ALERT_SWEEP_MS) || 10 * 60_000);
const WINDOW_MS = 24 * 3600_000;
const MAX_IN_MAIL = 12;

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: CREDIT_RESET_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: CREDIT_RESET_TZ, hour: '2-digit', hourCycle: 'h23' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: CREDIT_RESET_TZ, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short' });
const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: CREDIT_RESET_TZ, weekday: 'short', day: 'numeric', month: 'short' });
const tzName = (s: string) => (CREDIT_RESET_TZ === 'Africa/Lagos' ? s.replace(/GMT\+1$/, 'WAT') : s);
const TZ_LABEL = CREDIT_RESET_TZ === 'Africa/Lagos' ? 'WAT' : CREDIT_RESET_TZ;
export const siteDay = (t = Date.now()) => dayFmt.format(new Date(t));
export const releaseTime = (t: number) => tzName(timeFmt.format(new Date(t)));

const PAIRS: Record<string, string> = {
  USD: 'EUR/USD, USD/JPY, gold (XAU/USD) and US indices',
  EUR: 'EUR/USD, EUR/GBP and EUR/JPY',
  GBP: 'GBP/USD, EUR/GBP and GBP/JPY',
  JPY: 'USD/JPY, EUR/JPY and GBP/JPY',
  AUD: 'AUD/USD and AUD/JPY',
  NZD: 'NZD/USD and AUD/NZD',
  CAD: 'USD/CAD and oil-linked pairs',
  CHF: 'USD/CHF and EUR/CHF',
  CNY: 'AUD/USD, NZD/USD and risk assets',
};
const eventId = (e: EconEvent) => `${e.country}|${e.title}|${e.at}`;
const topicOf = (e: EconEvent) => `${e.country} ${e.title}`;

/** A plain three-line briefing from the calendar figures (used when the engine is unavailable) */
export function templateBriefing(e: EconEvent): string[] {
  const cur = e.country;
  const what = /rate|fomc|cash rate|bank rate|refinancing|policy/i.test(e.title)
    ? `The ${cur} rate decision is due ${releaseTime(e.at)}: every word on the next move can swing the ${cur}.`
    : `${cur} ${e.title} is due ${releaseTime(e.at)}, a ${e.impact.toLowerCase()} impact release traders watch closely.`;
  const watch = e.forecast
    ? `Forecast ${e.forecast}${e.previous ? ` (previous ${e.previous})` : ''}: a stronger print tends to lift the ${cur}, a weaker one weighs on it.`
    : `${e.previous ? `Last time it printed ${e.previous}. ` : ''}A surprise either way can move the ${cur} fast.`;
  const pairs = `Watch ${PAIRS[cur] || `${cur} pairs`}; spreads can widen around the release, so size your risk.`;
  return [what, watch, pairs];
}

/** The releases due in the next 24 hours with one of the chosen impacts, high impact first, then by time */
export function eventsFor(impacts: NewsImpact[], now = Date.now(), events: EconEvent[] = getFullCalendar()): EconEvent[] {
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  return events
    .filter(e => impacts.includes(e.impact) && e.at > now && e.at <= now + WINDOW_MS)
    .sort((a, b) => rank[a.impact] - rank[b.impact] || a.at - b.at);
}

// One set of briefings per release per day, shared by every trader
const briefCache = new Map<string, { day: string; lines: string[] }>();
async function briefingsFor(events: EconEvent[]): Promise<Map<string, string[]>> {
  const day = siteDay();
  const missing = events.filter(e => briefCache.get(eventId(e))?.day !== day);
  if (missing.length) {
    const ids = new Map(missing.map((e, i) => [`e${i + 1}`, e]));
    const written = await writeNewsBriefings([...ids].map(([id, e]): BriefEvent => ({ id, title: e.title, country: e.country, impact: e.impact, at: e.at, forecast: e.forecast, previous: e.previous })));
    for (const [id, e] of ids) briefCache.set(eventId(e), { day, lines: written[id] || templateBriefing(e) });
    if (briefCache.size > 500) for (const [k, v] of briefCache) if (v.day !== day) briefCache.delete(k);
  }
  return new Map(events.map(e => [eventId(e), briefCache.get(eventId(e))?.lines || templateBriefing(e)]));
}

/** Sends one trader today's alert (once per day); false when nothing matched or it was already sent */
async function sendTo(uid: string, doc: UserDoc, now = Date.now()): Promise<boolean> {
  const prefs = readNewsAlerts((doc as any)?.preferences?.newsAlerts);
  if (!prefs.enabled || doc.status === 'banned' || doc.status === 'suspended') return false;
  const day = siteDay(now);
  if ((doc as any).newsAlertsDay === day) return false;
  const events = eventsFor(prefs.impacts, now);
  // Claimed first, so a restart never sends twice; a day with nothing to send is claimed too
  const claimed = await db().runTransaction(async tx => {
    const snap = await tx.get(userRef(uid));
    if (!snap.exists || (snap.data() as any).newsAlertsDay === day) return false;
    tx.update(userRef(uid), { newsAlertsDay: day });
    return true;
  });
  if (!claimed || !events.length) return false;
  const shown = events.slice(0, MAX_IN_MAIL);
  const briefs = await briefingsFor(shown);
  const high = events.filter(e => e.impact === 'HIGH').length;
  const label = newsImpactLabel(prefs.impacts).toLowerCase();
  const first = shown[0];
  const headline = `${events.length} release${events.length === 1 ? '' : 's'} to watch${high && prefs.impacts.length > 1 ? ` (${high} high impact)` : ''}`;
  await addNotification(uid, {
    type: 'market',
    title: `Today's news: ${headline}`,
    message: `First up: ${first.country} ${first.title}, ${releaseTime(first.at)}. Tap to analyze it.`,
    actionType: 'analyze_prompt',
    actionPrompt: `/fundamental-analysis ${topicOf(first)}`,
  } as any).catch(() => {});
  const to = doc.email;
  if (to) {
    await sendEmail(
      to,
      `Today's market news: ${headline} · ${dateFmt.format(new Date(now))}`,
      [
        `Here is what's on the economic calendar for the next 24 hours (${label}), with what to watch on each. Times are in ${TZ_LABEL}.`,
        ...(events.length > shown.length ? [`Showing the first ${shown.length} of ${events.length}; open Fundamental Analysis for the rest.`] : []),
      ],
      {
        priority: 'high',
        sections: shown.map(e => ({
          tag: `${e.country} · ${e.impact.toLowerCase()} impact · ${releaseTime(e.at)}`,
          title: e.title,
          lines: briefs.get(eventId(e)) || templateBriefing(e),
          cta: { label: 'Analyze it on MarketX', url: siteLink(`/?fundamental=${encodeURIComponent(topicOf(e))}`) },
        })),
        cta: { label: 'Open MarketX', url: siteLink('/?news=1') },
        note: 'Fundamental reads give the odds of each outcome, never a certainty. Change or switch off these alerts in Preference Mode → News alerts.',
      }
    );
  }
  return true;
}

/** One sweep: from the alert hour, every trader with news alerts on who hasn't had today's yet */
export async function sweepNewsAlerts(now = Date.now()): Promise<number> {
  if (Number(hourFmt.format(new Date(now))) < HOUR) return 0;
  const snap = await db().collection('users').where('preferences.newsAlerts.enabled', '==', true).get();
  const day = siteDay(now);
  const due = snap.docs.filter(d => (d.data() as any).newsAlertsDay !== day);
  if (!due.length) return 0;
  await refreshNewsFeedsWithin(6000).catch(() => {});
  let n = 0;
  for (const d of due) {
    try {
      if (await sendTo(d.id, d.data() as UserDoc, now)) n++;
    } catch (err: any) {
      console.warn('[MarketX News alerts] one trader failed:', err?.message || err);
    }
  }
  return n;
}

export function startNewsAlerts() {
  if (!isFirebaseConfigured() || !IS_LEAD_WORKER) return;
  const run = () =>
    sweepNewsAlerts()
      .then(n => n && console.log(`[MarketX News alerts] sent ${n} daily news alert(s)`))
      .catch(err => console.warn('[MarketX News alerts] sweep failed:', err?.message || err));
  setTimeout(run, Math.min(SWEEP_MS, 60_000)).unref();
  setInterval(run, SWEEP_MS).unref();
}
