// Live fundamentals for an analysis: today's high-impact economic events (ForexFactory weekly calendar) and
// today's asset-relevant headlines (Dow Jones / MarketWatch wires). Everything is scoped to the reader's own
// calendar day: a brief belongs to one day, expires at that day's midnight, and nothing is ever invented;
// when no fundamental applies to the asset today the brief is null and nothing is shown.

export interface CalendarEvent {
  title: string;
  country: string; // currency code, e.g. USD
  impact: 'HIGH' | 'HOLIDAY';
  at: number; // ms (for holidays: the calendar day's timestamp)
  forecast: string;
  previous: string;
}

/** Every release on this week's calendar, any impact (daily news alerts); the analysis keeps using `getCalendar` (high impact) */
export interface EconEvent {
  title: string;
  country: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  at: number;
  forecast: string;
  previous: string;
  /** The released figure, when the calendar has it */
  actual: string;
}

export interface WireHeadline {
  title: string;
  url?: string;
  publishedAt: number;
  source: string;
}

export interface NewsBriefEvent {
  title: string;
  currency: string;
  impact: 'HIGH' | 'HOLIDAY';
  /** Release time (ms); null for all-day items such as bank holidays */
  at: number | null;
  forecast?: string;
  previous?: string;
}

export interface NewsBrief {
  /** Reader's calendar day, YYYY-MM-DD */
  day: string;
  timeZone: string;
  /** Reader's midnight at the end of `day` (ms): the brief is not shown after this */
  expiresAt: number;
  checkedAt: number;
  symbol: string;
  events: NewsBriefEvent[];
  headlines: WireHeadline[];
  /** One line for the process report */
  summary: string;
  /** What the news means for executing this analysis today */
  guidance: string;
}

export interface AssetRef {
  symbol: string;
  name: string;
  type: 'crypto' | 'stock' | 'forex' | 'commodity' | 'synthetic' | string;
}

// ---------------------------------------------------------------------------
// Feeds (cached, refreshed on demand)
// ---------------------------------------------------------------------------
let calendar: CalendarEvent[] = [];
let fullCalendar: EconEvent[] = [];
let calendarFetchedAt = 0;
let headlines: WireHeadline[] = [];
let headlinesFetchedAt = 0;
let inflight: Promise<void> | null = null;

const WIRE_FEEDS: Array<[string, string]> = [
  ['https://feeds.content.dowjones.io/public/rss/mw_topstories', 'MarketWatch'],
  ['https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', 'MarketWatch'],
  ['https://feeds.content.dowjones.io/public/rss/mw_marketpulse', 'MarketWatch'],
];
const HEADLINE_TTL = 3 * 60 * 1000;
const CALENDAR_TTL = 30 * 60 * 1000;

const decodeEntities = (t: string) =>
  t
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x2019;|&#8217;|&rsquo;/g, "'")
    .replace(/&#x2018;|&#8216;|&lsquo;/g, "'")
    .replace(/&#x201C;|&#x201D;|&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#x2014;|&#8212;|&mdash;/g, ',')
    .replace(/&#x2013;|&#8211;|&ndash;/g, ',')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** Parses RSS <item>s: title, link and pubDate (items without a valid date are skipped: freshness must be provable). */
export function parseRssItems(xml: string, source: string): WireHeadline[] {
  const out: WireHeadline[] = [];
  for (const m of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const item = m[0];
    const pick = (tag: string) => {
      const r = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(item);
      return r ? decodeEntities(r[1]) : '';
    };
    const title = pick('title').slice(0, 220);
    const link = pick('link');
    const publishedAt = Date.parse(pick('pubDate') || pick('dc:date'));
    if (!title || !Number.isFinite(publishedAt)) continue;
    out.push({ title, source, publishedAt, ...(/^https:\/\//i.test(link) ? { url: link.slice(0, 500) } : {}) });
  }
  return out;
}

async function fetchHeadlines(): Promise<void> {
  const results = await Promise.allSettled(
    WIRE_FEEDS.map(async ([url, source]) => {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (MarketX news)' }, signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseRssItems(await res.text(), source);
    })
  );
  const merged = new Map<string, WireHeadline>();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const h of r.value) {
      const key = h.title.toLowerCase();
      if (!merged.has(key)) merged.set(key, h);
    }
  }
  if (merged.size) {
    headlines = [...merged.values()].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 150);
    headlinesFetchedAt = Date.now();
  }
}

async function fetchCalendar(): Promise<void> {
  try {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers: { 'User-Agent': 'Mozilla/5.0 (MarketX news)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) return;
    const IMPACTS: Record<string, EconEvent['impact']> = { High: 'HIGH', Medium: 'MEDIUM', Low: 'LOW' };
    fullCalendar = data
      .filter((it: any) => IMPACTS[it?.impact] && it.title && it.country && it.date)
      .map((it: any): EconEvent | null => {
        const at = Date.parse(it.date);
        if (!Number.isFinite(at)) return null;
        return {
          title: String(it.title).slice(0, 160),
          country: String(it.country).toUpperCase().slice(0, 4),
          impact: IMPACTS[it.impact],
          at,
          forecast: String(it.forecast || '').slice(0, 24),
          previous: String(it.previous || '').slice(0, 24),
          actual: String(it.actual || '').slice(0, 24),
        };
      })
      .filter(Boolean) as EconEvent[];
    calendar = data
      .filter((it: any) => (it?.impact === 'High' || it?.impact === 'Holiday') && it.title && it.country && it.date)
      .map((it: any): CalendarEvent | null => {
        const at = Date.parse(it.date);
        if (!Number.isFinite(at)) return null;
        return {
          title: String(it.title).slice(0, 160),
          country: String(it.country).toUpperCase().slice(0, 4),
          impact: it.impact === 'Holiday' ? 'HOLIDAY' : 'HIGH',
          at,
          forecast: String(it.forecast || '').slice(0, 24),
          previous: String(it.previous || '').slice(0, 24),
        };
      })
      .filter(Boolean) as CalendarEvent[];
    calendarFetchedAt = Date.now();
  } catch (err: any) {
    console.warn(`[MarketX Feed] ForexFactory calendar unavailable: ${err?.message || err}`);
  }
}

/** Refreshes whichever feed is stale; concurrent callers share one refresh. */
export function refreshNewsFeeds(force = false): Promise<void> {
  if (inflight) return inflight;
  const now = Date.now();
  const tasks: Promise<void>[] = [];
  if (force || now - headlinesFetchedAt > HEADLINE_TTL) tasks.push(fetchHeadlines().catch(() => {}));
  if (force || now - calendarFetchedAt > CALENDAR_TTL || !calendar.length) tasks.push(fetchCalendar());
  if (!tasks.length) return Promise.resolve();
  inflight = Promise.all(tasks)
    .then(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Waits for fresh feeds, but never longer than `ms` (the analysis must not stall on a slow feed). */
export async function refreshNewsFeedsWithin(ms: number): Promise<void> {
  await Promise.race([refreshNewsFeeds(), new Promise<void>(resolve => setTimeout(resolve, ms))]);
}

export const getCalendar = () => calendar;
export const getFullCalendar = () => fullCalendar;
export const getHeadlines = () => headlines;

/** Test hook: load feed data directly. */
export function __setNewsFeedsForTest(data: { calendar?: CalendarEvent[]; fullCalendar?: EconEvent[]; headlines?: WireHeadline[] }) {
  if (data.fullCalendar) fullCalendar = data.fullCalendar;
  if (data.calendar) {
    calendar = data.calendar;
    calendarFetchedAt = Date.now();
  }
  if (data.headlines) {
    headlines = data.headlines;
    headlinesFetchedAt = Date.now();
  }
}

// ---------------------------------------------------------------------------
// Reader's calendar day
// ---------------------------------------------------------------------------
/** A valid IANA time zone from the client, or UTC. */
const tzVerdicts = new Map<string, string>();
export function resolveTimeZone(tz: unknown): string {
  if (typeof tz !== 'string' || !tz || tz.length > 64 || !/^[A-Za-z_+\-/0-9]+$/.test(tz)) return 'UTC';
  // Validating a zone builds a formatter (slow); remember the answer (bounded: there are ~600 real zones)
  const known = tzVerdicts.get(tz);
  if (known) return known;
  let out = 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    out = tz;
  } catch {}
  if (tzVerdicts.size < 2000) tzVerdicts.set(tz, out);
  return out;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
/** YYYY-MM-DD of `ms` in `tz`. */
export function dayKey(ms: number, tz: string): string {
  let f = dayFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(tz, f);
  }
  return f.format(ms);
}

/** First instant (ms) after `now` that falls on the next calendar day in `tz` (DST-safe, minute precision). */
export function endOfDay(now: number, tz: string): number {
  const today = dayKey(now, tz);
  let lo = now;
  let hi = now + 27 * 3600e3;
  while (hi - lo > 60e3) {
    const mid = Math.floor((lo + hi) / 2);
    if (dayKey(mid, tz) === today) lo = mid;
    else hi = mid;
  }
  // Midnight falls on a minute boundary in (lo, hi]
  const floor = Math.floor(hi / 60e3) * 60e3;
  return floor > now && dayKey(floor, tz) !== today ? floor : floor + 60e3;
}

// ---------------------------------------------------------------------------
// What moves this asset
// ---------------------------------------------------------------------------
const FIAT = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'NZD', 'CHF', 'CNY'];

const CURRENCY_TERMS: Record<string, string[]> = {
  USD: ['dollar', 'fed', 'federal reserve', 'powell', 'fomc', 'treasury yields', 'u.s. inflation', 'cpi', 'jobs report', 'nonfarm payrolls', 'rate cut', 'rate hike'],
  EUR: ['euro', 'ecb', 'lagarde', 'eurozone', 'euro zone'],
  GBP: ['pound', 'sterling', 'bank of england', 'boe', 'bailey'],
  JPY: ['yen', 'bank of japan', 'boj', 'ueda'],
  AUD: ['australian dollar', 'aussie', 'rba', 'reserve bank of australia'],
  CAD: ['canadian dollar', 'loonie', 'bank of canada'],
  NZD: ['new zealand dollar', 'kiwi', 'rbnz'],
  CHF: ['swiss franc', 'franc', 'snb', 'swiss national bank'],
  CNY: ['yuan', 'renminbi', 'pboc', "people's bank of china"],
};

const ASSET_TERMS: Array<[RegExp, string[]]> = [
  [/BTC|BITCOIN/, ['bitcoin', 'btc', 'crypto', 'cryptocurrency', 'bitcoin etf']],
  [/ETH|ETHEREUM/, ['ethereum', 'ether', 'crypto']],
  [/SOL|SOLANA/, ['solana', 'crypto']],
  [/XRP/, ['xrp', 'ripple', 'crypto']],
  [/DOGE/, ['dogecoin', 'crypto']],
  [/XAU|GOLD/, ['gold', 'bullion', 'precious metals']],
  [/XAG|SILVER/, ['silver', 'precious metals']],
  [/OIL|WTI|BRENT|USOIL|UKOIL/, ['oil', 'crude', 'opec', 'brent', 'wti']],
  [/SPX|S&P|US500|SP500/, ['s&p 500', 'stock market', 'wall street', 'stocks']],
  [/IXIC|NASDAQ|NDX|US100/, ['nasdaq', 'tech stocks', 'wall street']],
  [/DJI|DOW|US30/, ['dow', 'dow jones', 'wall street']],
];

/** Calendar currencies whose releases move this asset (synthetic indices have none). */
export function currenciesForAsset(asset: AssetRef): string[] {
  if (asset.type === 'synthetic') return [];
  const sym = asset.symbol.toUpperCase().replace(/[^A-Z0-9&]/g, '');
  const out = FIAT.filter(c => sym.includes(c));
  // Gold, silver, oil, crypto, US stocks and indices trade against USD liquidity
  if (asset.type !== 'forex' && !out.includes('USD')) out.push('USD');
  return out;
}

/** Headline keywords for this asset (lower case). */
export function keywordsForAsset(asset: AssetRef): string[] {
  if (asset.type === 'synthetic') return [];
  const sym = asset.symbol.toUpperCase();
  const words = new Set<string>();
  for (const [re, terms] of ASSET_TERMS) if (re.test(sym) || re.test(asset.name.toUpperCase())) terms.forEach(t => words.add(t));
  if (asset.type === 'stock') {
    const company = asset.name.replace(/\b(inc|corp|corporation|co|ltd|plc|holdings|class [a-z])\b\.?/gi, '').split(/[\s(]/)[0];
    if (company && company.length >= 3) words.add(company.toLowerCase());
  }
  // Macro drivers for every non-synthetic asset priced in (or against) these currencies
  for (const c of currenciesForAsset(asset)) (CURRENCY_TERMS[c] || []).forEach(t => words.add(t));
  return [...words];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function headlineMatches(title: string, keywords: string[], ticker: string | null): boolean {
  const lower = title.toLowerCase();
  if (keywords.some(k => new RegExp(`(^|[^a-z0-9])${escapeRe(k)}([^a-z0-9]|$)`).test(lower))) return true;
  // Stock tickers only as a standalone upper-case word (so "ARM" does not match "farm")
  return !!ticker && new RegExp(`(^|[^A-Za-z0-9])${escapeRe(ticker)}([^A-Za-z0-9]|$)`).test(title);
}

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------
export function buildDailyNewsBrief(asset: AssetRef, timeZone: string, now = Date.now()): NewsBrief | null {
  const tz = resolveTimeZone(timeZone);
  const currencies = currenciesForAsset(asset);
  const keywords = keywordsForAsset(asset);
  if (!currencies.length && !keywords.length) return null;
  const today = dayKey(now, tz);

  const events: NewsBriefEvent[] = calendar
    .filter(ev => currencies.includes(ev.country))
    // Timed releases fall on the reader's day in the reader's zone; all-day holidays use the calendar's own date (New York)
    .filter(ev => (ev.impact === 'HOLIDAY' ? dayKey(ev.at, 'America/New_York') === today : dayKey(ev.at, tz) === today))
    .sort((a, b) => a.at - b.at)
    .slice(0, 8)
    .map(ev => ({
      title: ev.title,
      currency: ev.country,
      impact: ev.impact,
      at: ev.impact === 'HOLIDAY' ? null : ev.at,
      ...(ev.forecast ? { forecast: ev.forecast } : {}),
      ...(ev.previous ? { previous: ev.previous } : {}),
    }));

  const ticker = asset.type === 'stock' ? asset.symbol.toUpperCase().replace(/[^A-Z.]/g, '') || null : null;
  const relevant = headlines
    .filter(h => dayKey(h.publishedAt, tz) === today && h.publishedAt <= now + 5 * 60e3)
    .filter(h => headlineMatches(h.title, keywords, ticker && ticker.length >= 2 ? ticker : null))
    .slice(0, 5)
    .map(h => ({ title: h.title, source: h.source, publishedAt: h.publishedAt, ...(h.url && /^https:\/\//i.test(h.url) ? { url: h.url } : {}) }));

  if (!events.length && !relevant.length) return null;

  const fmtUtc = (ms: number) => new Date(ms).toISOString().slice(11, 16) + ' UTC';
  const upcoming = events.filter(e => e.impact === 'HIGH' && e.at != null && e.at > now);
  const released = events.filter(e => e.impact === 'HIGH' && e.at != null && e.at <= now);
  const holidays = events.filter(e => e.impact === 'HOLIDAY');

  const parts: string[] = [];
  if (upcoming.length) parts.push(`${upcoming.length} high-impact release${upcoming.length > 1 ? 's' : ''} ahead (next: ${upcoming[0].title}, ${upcoming[0].currency}, ${fmtUtc(upcoming[0].at!)})`);
  if (released.length) parts.push(`${released.length} already released today`);
  if (holidays.length) parts.push(`${holidays.map(h => `${h.currency} ${h.title.toLowerCase().includes('holiday') ? h.title : `${h.title} holiday`}`).join(', ')}`);
  if (relevant.length) parts.push(`${relevant.length} ${asset.symbol} headline${relevant.length > 1 ? 's' : ''} today`);

  let guidance: string;
  if (upcoming.length) {
    guidance = `Expect volatility around ${upcoming[0].title} (${upcoming[0].currency}). Avoid entering in the minutes before the release; let the first candle settle, then only use the planned limit entry.`;
  } else if (holidays.length) {
    guidance = `A bank holiday thins ${holidays.map(h => h.currency).join('/')} liquidity today: spreads can widen and moves can be erratic. Consider smaller size.`;
  } else if (released.length) {
    guidance = `Today's high-impact ${released.map(e => e.currency).filter((c, i, a) => a.indexOf(c) === i).join('/')} data is out; price may still be repricing it, so confirm the zone holds before the entry fills.`;
  } else {
    guidance = `Fresh headlines can move ${asset.symbol} today; keep to the planned levels and do not chase a news spike.`;
  }

  return {
    day: today,
    timeZone: tz,
    expiresAt: endOfDay(now, tz),
    checkedAt: now,
    symbol: asset.symbol,
    events,
    headlines: relevant,
    summary: parts.join(' · '),
    guidance,
  };
}

/** A brief that is still for the reader's current day. */
export function isBriefCurrent(brief: NewsBrief | null | undefined, now = Date.now()): brief is NewsBrief {
  return !!brief && now < brief.expiresAt;
}

/**
 * The legacy single-alert shape still used by the write-up and the AI prompt, derived from the brief
 * (the first upcoming release, else a holiday, else the latest released event). Null when there are no events.
 */
/** Window around a high-impact release in which a fresh trade gets a news heads-up */
export const NEWS_HOLD_BEFORE_MS = 2 * 60 * 60 * 1000;
export const NEWS_HOLD_AFTER_MS = 15 * 60 * 1000;

/** The high-impact release close to now (due within 2 hours or released in the last 15 minutes), if any */
export function imminentHighImpact(brief: NewsBrief | null, now = Date.now()): NewsBriefEvent | null {
  if (!brief) return null;
  return (
    brief.events.find(e => e.impact === 'HIGH' && e.at != null && e.at - now <= NEWS_HOLD_BEFORE_MS && now - e.at <= NEWS_HOLD_AFTER_MS) || null
  );
}

export function newsBriefToAlert(brief: NewsBrief | null, symbol: string) {
  if (!brief || !brief.events.length) return null;
  const now = brief.checkedAt;
  const ev =
    brief.events.find(e => e.impact === 'HIGH' && e.at != null && e.at > now) ||
    brief.events.find(e => e.impact === 'HOLIDAY') ||
    [...brief.events].reverse().find(e => e.impact === 'HIGH') ||
    brief.events[0];
  const holiday = ev.impact === 'HOLIDAY';
  const time = ev.at != null ? `${new Date(ev.at).toISOString().slice(11, 16)} UTC` : 'All Day';
  return {
    detected: true as const,
    title: `${ev.title} [${ev.currency}]`,
    impactLevel: holiday ? ('BANK_HOLIDAY' as const) : ('HIGH' as const),
    category: holiday ? ('BANK_HOLIDAY' as const) : ('MACRO_ECONOMIC' as const),
    scheduledTime: `Today · ${time}`,
    date: 'Today',
    time,
    timeHorizon: 'TODAY (Real-Time)' as const,
    affectedCurrency: `${ev.currency} · ${symbol}`,
    forecast: ev.forecast || 'N/A',
    previous: ev.previous || 'N/A',
    source: 'ForexFactory economic calendar',
    secondarySource: brief.headlines.length ? 'MarketWatch / Dow Jones wire' : undefined,
    ...(brief.headlines[0] ? { breakingHeadline: brief.headlines[0].title } : {}),
    volatilityWarning: holiday
      ? `Bank holiday for ${ev.currency} today: thinner liquidity and wider spreads are likely on ${symbol}.`
      : `High-impact ${ev.currency} release today (${time}); expect a volatility spike on ${symbol} around it.`,
    executionGuidance: brief.guidance,
  };
}

/** Plain-text block for the AI prompt: every event and headline for today, or an explicit "none". */
export function newsBriefPromptBlock(brief: NewsBrief | null, symbol: string): string {
  if (!brief) {
    return `TODAY'S FUNDAMENTALS (reader's day, live):
- None. No high-impact economic release, bank holiday or ${symbol}-relevant headline today. Do not mention news or invent any.`;
  }
  const t = (ms: number | null) => (ms == null ? 'all day' : new Date(ms).toISOString().slice(11, 16) + ' UTC');
  const lines = [`TODAY'S FUNDAMENTALS (reader's day ${brief.day}, ${brief.timeZone}; valid for today only, live):`];
  for (const e of brief.events) {
    const state = e.at == null ? '' : e.at > brief.checkedAt ? ' (upcoming)' : ' (released)';
    lines.push(`- ${e.impact === 'HOLIDAY' ? 'Bank holiday' : 'High impact'} · ${e.currency} · ${e.title} · ${t(e.at)}${state}${e.forecast ? ` · forecast ${e.forecast}` : ''}${e.previous ? ` · previous ${e.previous}` : ''}`);
  }
  for (const h of brief.headlines) lines.push(`- Headline (${h.source}, ${t(h.publishedAt)}): "${h.title}"`);
  lines.push(`- Guidance: ${brief.guidance}`);
  lines.push('- Mention only these items when discussing news; they apply to today only.');
  return lines.join('\n');
}
