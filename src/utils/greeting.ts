// Welcome line for a new chat: picked at random from warm greetings for the reader's local time of day,
// including the midnight hours, and never the same line twice in a row.

export type DayPart = 'midnight' | 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night';

/** Local hour → part of the day. Midnight hours are 00:00 to 03:59. */
export function dayPart(hour: number): DayPart {
  if (hour < 4) return 'midnight';
  if (hour < 6) return 'dawn';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'night';
}

// "{n}" is replaced by ", Name" (or nothing when we don't know the name)
const LINES: Record<DayPart, string[]> = {
  midnight: [
    'Hello, night owl{n}',
    'Burning the midnight oil{n}?',
    'The markets never sleep, and neither do you{n}',
    'Midnight hours, sharp mind{n}',
    'Quiet night, clear charts{n}',
    'Still up{n}? Let’s make it count',
  ],
  dawn: [
    'Up before the sun{n}',
    'Early bird gets the setup{n}',
    'A fresh start before sunrise{n}',
    'Good early morning{n}',
  ],
  morning: [
    'Good morning{n}',
    'Rise and shine{n}',
    'Fresh day, fresh setups{n}',
    'Morning{n}. Coffee and charts?',
    'Top of the morning{n}',
    'A bright new trading day{n}',
  ],
  afternoon: [
    'Good afternoon{n}',
    'Hope your day is going great{n}',
    'Afternoon{n}. Ready for the next move?',
    'Lovely to see you this afternoon{n}',
    'Keep the momentum going{n}',
  ],
  evening: [
    'Good evening{n}',
    'Evening{n}. Time to plan the next move',
    'Welcome back this evening{n}',
    'Hope today treated you well{n}',
    'Unwind and review the charts{n}',
  ],
  night: [
    'Good evening{n}',
    'Night owl mode on{n}',
    'Late session, calm mind{n}',
    'One more look before bed{n}?',
    'The night shift has begun{n}',
  ],
};

// Warm lines that suit any hour, mixed in now and then
const ANYTIME = ['Welcome back{n}', 'Great to see you{n}', 'Ready when you are{n}', 'Hello{n}! Let’s find something good'];

const SUBTITLES: Record<DayPart, string[]> = {
  midnight: ['What market should we look at tonight?', 'Crypto is awake. What should we check?', 'Let’s find a clean setup while it’s quiet.'],
  dawn: ['What market should we look at first today?', 'Let’s get ahead of the day. Which market?'],
  morning: ['What market should we analyze today?', 'Which chart should we start the day with?', 'Let’s find today’s best setup.'],
  afternoon: ['What market should we analyze next?', 'Which chart is on your mind?', 'Let’s find your next setup.'],
  evening: ['What market should we look at this evening?', 'Which chart should we review?', 'Let’s plan tomorrow’s trades.'],
  night: ['What market should we look at tonight?', 'One last chart before you rest?', 'Let’s find a setup for the night session.'],
};

const LAST_KEY = 'mx_last_greeting';

function pick<T>(list: T[], avoid: (x: T) => boolean, rnd: () => number): T {
  const pool = list.length > 1 ? list.filter(x => !avoid(x)) : list;
  return pool[Math.floor(rnd() * pool.length)] ?? list[0];
}

/** A random greeting and subtitle for this hour, different from the last one shown. */
export function pickGreeting(name: string, now = new Date(), rnd: () => number = Math.random): { title: string; subtitle: string } {
  const part = dayPart(now.getHours());
  let last = '';
  try {
    last = sessionStorage.getItem(LAST_KEY) || '';
  } catch {}
  // About one in four greetings is an any-time line; the rest match the time of day
  const lines = rnd() < 0.25 ? ANYTIME : LINES[part];
  const template = pick(lines, t => t === last, rnd);
  try {
    sessionStorage.setItem(LAST_KEY, template);
  } catch {}
  const title = template.replace('{n}', name ? `, ${name}` : '');
  const subtitle = pick(SUBTITLES[part], () => false, rnd);
  return { title, subtitle };
}
