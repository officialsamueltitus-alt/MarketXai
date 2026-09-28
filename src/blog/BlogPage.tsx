import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Compass,
  CreditCard,
  LifeBuoy,
  LineChart,
  MessageCircle,
  Rocket,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  UserCog,
} from 'lucide-react';
import { MarketXIcon } from '../components/MarketXIcon';

// The MarketX Site Guide, served as its own page at /blog. Static content only: nothing here is user input.

const UPDATED = 'September 2026';

type Row = string[];

interface Section {
  id: string;
  title: string;
  icon: React.ElementType;
  lead: string;
  body: React.ReactNode;
}

const B: React.FC<{ children: React.ReactNode }> = ({ children }) => <strong className="font-semibold text-white">{children}</strong>;

const Table: React.FC<{ head: Row; rows: Row[] }> = ({ head, rows }) => (
  <div className="mt-4 -mx-1 overflow-x-auto rounded-2xl border border-white/[0.07]">
    <table className="w-full min-w-[520px] text-left text-sm">
      <thead className="bg-white/[0.04] text-[12px] uppercase tracking-wider text-slate-400">
        <tr>
          {head.map(h => (
            <th key={h} className="px-4 py-3 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-white/[0.06]">
        {rows.map(r => (
          <tr key={r[0]} className="align-top">
            {r.map((c, i) => (
              <td key={i} className={`px-4 py-3 leading-relaxed ${i === 0 ? 'font-medium text-white whitespace-nowrap' : 'text-slate-400'}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Steps: React.FC<{ items: React.ReactNode[] }> = ({ items }) => (
  <ol className="mt-4 space-y-3">
    {items.map((it, i) => (
      <li key={i} className="grid grid-cols-[1.75rem_1fr] gap-3">
        <span className="mt-0.5 w-7 h-7 rounded-full bg-indigo-500/15 text-indigo-200 text-[12px] font-semibold flex items-center justify-center tabular-nums">
          {i + 1}
        </span>
        <span className="text-[15px] text-slate-300 leading-relaxed">{it}</span>
      </li>
    ))}
  </ol>
);

const Points: React.FC<{ items: React.ReactNode[] }> = ({ items }) => (
  <ul className="mt-4 space-y-2.5">
    {items.map((it, i) => (
      <li key={i} className="flex gap-3 text-[15px] text-slate-300 leading-relaxed">
        <span className="mt-2.5 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" aria-hidden="true" />
        <span>{it}</span>
      </li>
    ))}
  </ul>
);

const P: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="mt-4 text-[15px] text-slate-300 leading-relaxed">{children}</p>;

const Note: React.FC<{ title: string; children: React.ReactNode; tone?: 'indigo' | 'amber' | 'emerald' }> = ({ title, children, tone = 'indigo' }) => {
  const tones = {
    indigo: 'border-indigo-400/20 bg-indigo-500/[0.07]',
    amber: 'border-amber-400/20 bg-amber-500/[0.07]',
    emerald: 'border-emerald-400/20 bg-emerald-500/[0.07]',
  };
  return (
    <div className={`mt-4 rounded-2xl border px-4 py-3.5 ${tones[tone]}`}>
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 text-sm text-slate-300 leading-relaxed">{children}</p>
    </div>
  );
};

const SECTIONS: Section[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    icon: Rocket,
    lead: 'MarketX is invite only: you create an account, receive a personal pass code by email, and your account opens once you enter that code.',
    body: (
      <>
        <Steps
          items={[
            <>
              Open the site and choose <B>Create account</B>. Sign up with your email and a password of at least 8 characters, or with Google. Tick the Terms and
              Privacy box; it is required to continue.
            </>,
            <>
              Check your inbox for your <B>pass code</B> (format MX XXXX XXXX). It is sent once and stays valid for 48 hours. An unused code expires and your seat
              is released.
            </>,
            <>
              Enter the code on the <B>Enter your pass code</B> screen, together with the email you signed up with. You will see <B>Access granted</B> and your
              account is ready with starter credits.
            </>,
            <>
              Open the confirmation email and verify your address. Your profile shows <B>Email verified</B> once this is done.
            </>,
          ]}
        />
        <Note title="Signing in later">
          Use Sign in with your email and password. Google sign in only works for accounts that were created with that same Google account.
        </Note>
        <Note title="Forgot your password?">
          On the sign in screen choose Reset your password, enter your email, and follow the link we send you to choose a new one.
        </Note>
        <Note title="Batch fully allocated?" tone="amber">
          New sign ups open in batches. If you see this message, all seats in the current batch are taken; try again later.
        </Note>
      </>
    ),
  },
  {
    id: 'finding-your-way',
    title: 'Finding your way around',
    icon: Compass,
    lead: 'Everything sits in two places: the top bar across the page and the sidebar on the left. On phones and tablets, tap the sidebar button at the top left to open it.',
    body: (
      <>
        <Table
          head={['Section', 'Where to find it', 'What it does']}
          rows={[
            ['Markets', 'Top bar, view switch', 'Live prices and ready made prompts for forex, gold, crypto, stocks and indices. Tap any card to analyze it.'],
            ['Ask AI', 'Top bar, view switch', 'The chat where you type prompts and get trade plans.'],
            ['AI engines', 'Top bar, Models button', 'Shows the active MarketX Engine and engines coming soon.'],
            ['New chat', 'Top bar or sidebar', 'Starts a fresh conversation.'],
            ['Credits', 'Top bar credit pill, or Sidebar, Settings, Credits', "Your balance, today's analyses, and plans."],
            ['Notifications', 'Top bar bell', 'Analyses, sign ins, payments, rewards and replies from support.'],
            ['Profile', 'Top bar avatar, or Sidebar, Settings, Profile', 'Your stats, plan, gifting, campaign and account options.'],
            ['History', 'Sidebar', 'Your saved trade setups and past chats.'],
            ['Settings', 'Sidebar, Settings', 'Credits, Profile, Support chat, theme, and Terms and Privacy at the bottom.'],
            ['Support chat', 'Settings, or the Direct institutional desk on Markets', 'Message the MarketX team and read their replies.'],
            ['Site Guide', 'Direct institutional desk on Markets, or /blog', 'This guide.'],
          ]}
        />
        <P>
          Press <B>Esc</B> to close any open window or panel on a computer.
        </P>
      </>
    ),
  },
  {
    id: 'running-an-analysis',
    title: 'Running an analysis',
    icon: LineChart,
    lead: "Name the market and the timeframe in one sentence, press Enter, and MarketX returns a trade plan built from that timeframe's live candles.",
    body: (
      <>
        <Steps
          items={[
            <>
              Open <B>Ask AI</B>, or tap a card on <B>Markets</B>, which fills the prompt for you.
            </>,
            <>
              Type what you want, for example <em>Analyze EUR/USD on the 1H</em> or <em>BTC 15 min setup</em>. Supported markets include forex pairs, gold and silver,
              oil, crypto, stocks, major indices and synthetic indices.
            </>,
            <>
              Pick a timeframe on the input box: <B>15m, 1H, 4H or 1D</B>. A timeframe written in your prompt (such as 5m, 30m, 2H, daily or weekly) always takes
              priority.
            </>,
            <>
              Optional: choose <B>Normal SL</B> or <B>Tight SL</B> on the input box (see Stop loss options).
            </>,
            <>Optional: attach a chart screenshot with the image button, or paste one with Ctrl+V (Cmd+V on Mac), and ask about it.</>,
            <>
              Press <B>Enter</B> or the send button. Use <B>Shift+Enter</B> for a new line. While it works you can press <B>Stop</B> to cancel.
            </>,
          ]}
        />
        <Note title="Buy or sell only?">
          Say so in the prompt, for example short setup on gold 4H. If there is no valid setup in that direction, you get the best valid plan or a clear No signal.
        </Note>
        <Note title="Questions work too">Ask things like what is a liquidity sweep? and you get a plain answer instead of a trade plan.</Note>
        <Note title="Commands">Type / in the input to see upcoming tools such as the Trading Agent and MT5 Connector. They are marked Coming soon.</Note>
        <P>Each reply shows the tokens it used, and the arrows on the input box jump to the top or bottom of a long chat.</P>
      </>
    ),
  },
  {
    id: 'reading-a-result',
    title: 'Reading a result',
    icon: Target,
    lead: 'Every analysis ends in one of three outcomes: a trade plan, No signal, or No signal, already mitigated. MarketX only calls a trade from a fresh, untouched level with a strong reward to risk.',
    body: (
      <>
        <Table
          head={['Part of the card', 'What it tells you']}
          rows={[
            ['Direction', 'BUY ZONE / BUY LIMIT or SELL ZONE / SELL LIMIT: the side to trade, placed as a limit order.'],
            ['Entry (Limit Zone)', 'The price range to enter in, with the Optimal price marked.'],
            ['Stop Loss', 'Where the idea is wrong and the trade should close.'],
            ['TP1, TP2, TP3', 'Three targets, each with its reward to risk and a suggested share of the position to close.'],
            ['Risk : Reward', 'The ratio to the final target. Trade plans need at least 1 : 2.5.'],
            ['Zones', 'Levels to watch: Untouched ones are still valid, Mitigated ones have already been used by price.'],
            ['Write up', 'The full reasoning, the market structure and the timeframe used.'],
            ['High impact news', 'A warning when major news may move the market soon, with guidance.'],
          ]}
        />
        <Note title="No signal">There is no clean, high probability setup right now. The card still shows the key zones to watch so you can check back later.</Note>
        <Note title="No signal, already mitigated" tone="amber">
          A setup existed, but price has already reached its zone, entry, stop loss or first target. The trade has played out, so it is not offered again. The note
          names which level was reached and when.
        </Note>
        <P>Use the copy buttons on the card to copy the trade parameters or the full write up.</P>
      </>
    ),
  },
  {
    id: 'stop-loss-options',
    title: 'Stop loss options',
    icon: SlidersHorizontal,
    lead: "You can ask for a tighter stop before an analysis or after one; either way the stop stays wide enough for the timeframe's normal price swings.",
    body: (
      <>
        <Note title="Tight SL on the input box (before you send)">
          Switch the toggle from Normal SL to Tight SL. The next analysis places a smaller stop, which improves reward to risk but is easier to hit. Switch back to
          Normal SL for the standard stop.
        </Note>
        <Note title="Tighten Stop Loss on a result (after you get a plan)">
          Press Tighten Stop Loss on the card. You keep the exact same setup: the same entry, zone and targets. Only the stop moves closer, to the nearest valid
          level, and the reward to risk is recalculated. If the stop cannot be tightened safely, MarketX tells you and keeps it where it is. This counts as one
          analysis.
        </Note>
      </>
    ),
  },
  {
    id: 'credits-and-plans',
    title: 'Credits, daily analyses and plans',
    icon: CreditCard,
    lead: 'Each analysis uses one of your daily analyses, plus one credit if you have any; you can keep going while either is left. If an analysis fails, it is refunded automatically.',
    body: (
      <>
        <Table
          head={['', 'Free', 'Pro']}
          rows={[
            ['Daily analyses', '3', '10'],
            ['Starter credits', '5 on joining', '5 on joining'],
            ['Full trade plans, live prices', 'Included', 'Included'],
            ['Verified trader badge', 'No', 'Yes'],
            ['Billing', 'None', 'Monthly or yearly'],
          ]}
        />
        <Note title="Check your balance">
          Tap the credit pill in the top bar, or open Sidebar, Settings, Credits. You see your balance, today's analyses and tokens, and when your daily analyses
          reset. Daily analyses renew 24 hours after your last reset.
        </Note>
        <Note title="Upgrade or refill">
          In Credits choose Upgrade to Pro (or Refill or change plan), pick Monthly or Yearly, and pay through the secure checkout by card, bank transfer or USSD
          where available. Pro switches on as soon as the payment is confirmed, and you get a notification and an email receipt. Current prices are always shown
          in the Plans window.
        </Note>
        <Note title="Out of credits?" tone="amber">
          The input box shows Out of credits. Wait for your daily analyses to renew, earn credits through the X campaign, receive a gift, or upgrade.
        </Note>
      </>
    ),
  },
  {
    id: 'sharing-and-earning',
    title: 'Sharing and earning',
    icon: Share2,
    lead: 'You can share any trade plan as an image, earn free credits by posting about MarketX on X, and send credits to friends.',
    body: (
      <Points
        items={[
          <>
            <B>Download a setup.</B> On a result card press Image to save a high resolution PNG of the trade plan.
          </>,
          <>
            <B>Share to X.</B> Press Share on the card to open a ready made post with the setup.
          </>,
          <>
            <B>Earn credits on X.</B> Open the Campaign banner (in Profile, or from a notification) and press Start earning. Complete the steps in order and post;
            your credits unlock automatically 10 hours after you post, and a receipt is emailed to you.
          </>,
          <>
            <B>Gift credits.</B> Open Profile, Gift credits, enter the recipient's @username, choose an amount, add an optional message and send. The credits leave
            your balance and arrive in theirs straight away. You cannot gift to yourself.
          </>,
          <>
            <B>Follow us.</B> Updates and new features are posted on X at @_MarketXai.
          </>,
        ]}
      />
    ),
  },
  {
    id: 'account-and-settings',
    title: 'Your account and settings',
    icon: UserCog,
    lead: "Your profile, preferences and saved work are all reachable from the sidebar's Settings and the top bar avatar.",
    body: (
      <>
        <Points
          items={[
            <>
              <B>Profile.</B> Shows your name, @username, plan, analyses, credits and tokens used today. Use Edit profile to change your display name, username or
              photo, then Save Changes. You can also share your profile.
            </>,
            <>
              <B>Theme.</B> In Settings choose Light, Dark or System (follows your device).
            </>,
            <>
              <B>Notifications.</B> The bell shows analyses, sign ins, payments, rewards and support replies. Filter them, mark them read or clear them. Turn Email
              me about activity on or off; security alerts are always emailed.
            </>,
            <>
              <B>History.</B> The sidebar lists your saved trade setups and chats. Open one to pick up where you left off, delete a single setup or chat, or use
              Clear Everything to remove them all.
            </>,
            <>
              <B>Sign out.</B> In Profile, press Sign out.
            </>,
            <>
              <B>Delete account.</B> In Profile, press Delete account, enter your password (leave it empty if you signed up with Google) and type DELETE to
              confirm. This permanently removes your account and its data and cannot be undone.
            </>,
          ]}
        />
        <P>MarketX works in any modern browser on phones, tablets and computers, including Safari on iPhone and iPad.</P>
      </>
    ),
  },
  {
    id: 'getting-help',
    title: 'Getting help',
    icon: LifeBuoy,
    lead: 'The fastest way to reach the MarketX team is the Support chat; the team usually replies within a few hours.',
    body: (
      <>
        <Steps
          items={[
            <>
              Open <B>Support chat</B> from the Direct institutional desk on the Markets page, or from the sidebar: <B>Settings</B>, then <B>Support chat</B>.
            </>,
            <>Pick a popular topic (Billing and Pro, Credits, An analysis, Account and login, Report a bug) or write your own message, and press Enter to send.</>,
            <>When the team replies you get a notification, an email with a link back to the chat, and a badge on the Support chat row.</>,
          ]}
        />
        <Note title="Email">You can also write to help.marketx@gmail.com.</Note>
        <Note title="Terms and Privacy">
          The last row in Settings opens the Terms of Service, Privacy Policy and Risk Disclosure. Each has a short summary at the top; switch between them with the
          tabs.
        </Note>
      </>
    ),
  },
  {
    id: 'trading-responsibly',
    title: 'Trading responsibly and keeping your account safe',
    icon: ShieldCheck,
    lead: 'MarketX analyses are research, not financial advice: you decide every trade and the risk you take.',
    body: (
      <Points
        items={[
          'Use a stop loss on every trade and risk only a small part of your account per idea.',
          'Treat No signal as useful: waiting for a clean setup is part of the plan.',
          'Prices can gap and news can move markets past planned levels; check the high impact news warning before you enter.',
          'Keep your password and pass code private. MarketX staff will never ask for your password, pass code or card details, in the support chat or by email.',
          'If you notice a sign in you do not recognise, reset your password right away and message Support chat.',
        ]}
      />
    ),
  },
];

export default function BlogPage() {
  const [active, setActive] = useState(SECTIONS[0].id);
  const [showTop, setShowTop] = useState(false);
  const readMinutes = useMemo(() => 8, []);

  useEffect(() => {
    const prev = document.title;
    document.title = 'MarketX Site Guide';
    return () => {
      document.title = prev;
    };
  }, []);

  // Highlight the section being read (the last one whose top has passed the sticky bars), and show the
  // back-to-top button once the reader scrolls
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const offset = window.innerWidth >= 1024 ? 120 : 170;
      let current = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top - offset <= 0) current = s.id;
      }
      // At the very bottom the last section counts as read even if it is short
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = SECTIONS[SECTIONS.length - 1].id;
      setActive(current);
      setShowTop(window.scrollY > 600);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
    // Deep link to a section (e.g. /blog#getting-help)
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash && SECTIONS.some(s => s.id === hash)) setTimeout(() => document.getElementById(hash)?.scrollIntoView(), 0);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Keep the highlighted chip visible in the phone contents bar (horizontal scroll only)
  const chipsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = chipsRef.current;
    const chip = bar?.querySelector<HTMLElement>(`a[href="#${active}"]`);
    if (!bar || !chip) return;
    const left = chip.offsetLeft - (bar.clientWidth - chip.clientWidth) / 2;
    bar.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }, [active]);

  const goTo = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
    setActive(id);
  };

  return (
    <div className="mx-backdrop min-h-[100dvh] text-slate-200 overflow-x-clip">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[var(--mx-bg)] pt-[env(safe-area-inset-top)]">
        <div className="max-w-6xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
          <a
            href="/"
            className="inline-flex items-center gap-2 h-9 pl-2.5 pr-3.5 rounded-full border border-white/[0.08] bg-white/[0.03] text-sm font-medium text-slate-200 hover:bg-white/[0.07] hover:text-white transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Back to MarketX</span>
            <span className="sm:hidden">Back</span>
          </a>
          <a href="/" className="inline-flex items-center gap-2 min-w-0" aria-label="MarketX home">
            <MarketXIcon size="sm" />
            <span className="text-sm font-semibold text-white truncate">MarketX</span>
          </a>
          <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-indigo-500/10 text-[13px] font-medium text-indigo-200">
            <BookOpen className="w-4 h-4" />
            <span className="hidden sm:inline">Site Guide</span>
            <span className="sm:hidden">Guide</span>
          </span>
        </div>
      </header>

      {/* Hero */}
      <div className="relative overflow-hidden border-b border-white/[0.06]">
        <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[640px] h-[320px] rounded-full bg-indigo-600/15 blur-3xl" aria-hidden="true" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-10 sm:pb-14">
          <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-indigo-300">MarketX Blog · Guide</p>
          <h1 className="mt-3 text-3xl sm:text-5xl font-semibold text-white tracking-tight max-w-3xl leading-[1.1]">MarketX Site Guide</h1>
          <p className="mt-4 text-base sm:text-lg text-slate-400 max-w-2xl leading-relaxed">
            MarketX turns a one line prompt into a full trade plan built from live market data: entry, stop loss and three targets, or a clear No signal when there is
            no clean setup. This guide shows where everything is and how to use it.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2 text-[13px] text-slate-400">
            <span className="inline-flex items-center h-8 px-3 rounded-full border border-white/[0.08]">Updated {UPDATED}</span>
            <span className="inline-flex items-center h-8 px-3 rounded-full border border-white/[0.08]">{readMinutes} min read</span>
            <span className="inline-flex items-center h-8 px-3 rounded-full border border-white/[0.08]">{SECTIONS.length} sections</span>
          </div>
        </div>
      </div>

      {/* Mobile contents */}
      <nav className="lg:hidden sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 border-b border-white/[0.06] bg-[var(--mx-bg)]" aria-label="Guide contents">
        <div ref={chipsRef} className="no-scrollbar flex gap-2 overflow-x-auto px-4 py-2.5">
          {SECTIONS.map((s, i) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={goTo(s.id)}
              className={`shrink-0 h-8 px-3 rounded-full text-[13px] inline-flex items-center gap-1.5 transition ${
                active === s.id ? 'bg-white text-slate-950 font-medium' : 'bg-white/[0.05] text-slate-300'
              }`}
            >
              <span className="tabular-nums opacity-60">{i + 1}</span> {s.title.split(' ').slice(0, 3).join(' ')}
            </a>
          ))}
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 lg:grid lg:grid-cols-[240px_1fr] lg:gap-12">
        {/* Desktop contents */}
        <aside className="hidden lg:block">
          <nav className="sticky top-24" aria-label="Guide contents">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500 mb-3">On this page</p>
            <ul className="space-y-0.5">
              {SECTIONS.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    onClick={goTo(s.id)}
                    className={`flex items-start gap-2.5 rounded-xl px-3 py-2 text-[13px] leading-snug transition ${
                      active === s.id ? 'bg-white/[0.07] text-white font-medium' : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="tabular-nums text-slate-500 w-4 shrink-0">{i + 1}</span>
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
            <a
              href="/?support=1"
              className="mt-6 flex items-center gap-2.5 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3.5 text-[13px] text-slate-300 hover:bg-white/[0.06] transition"
            >
              <MessageCircle className="w-4 h-4 text-emerald-300 shrink-0" />
              Still stuck? Open Support chat
            </a>
          </nav>
        </aside>

        {/* Articles */}
        <main className="min-w-0 space-y-6 sm:space-y-8">
          {SECTIONS.map((s, i) => {
            const Icon = s.icon;
            return (
              <article
                key={s.id}
                id={s.id}
                className="scroll-mt-32 lg:scroll-mt-24 rounded-3xl border border-white/[0.07] bg-[var(--mx-surface)] p-5 sm:p-8"
              >
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-indigo-300" />
                  </span>
                  <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-slate-500">Part {i + 1}</span>
                </div>
                <h2 className="mt-4 text-xl sm:text-2xl font-semibold text-white tracking-tight">{s.title}</h2>
                <p className="mt-2 text-[15px] sm:text-base text-slate-300 leading-relaxed">{s.lead}</p>
                {s.body}
              </article>
            );
          })}

          {/* Closing call to action */}
          <section className="rounded-3xl border border-indigo-400/20 bg-indigo-500/[0.08] p-6 sm:p-8 text-center">
            <h2 className="text-xl sm:text-2xl font-semibold text-white tracking-tight">Ready to analyze a market?</h2>
            <p className="mt-2 text-[15px] text-slate-300">Head back to MarketX and send your first prompt.</p>
            <div className="mt-5 flex flex-col sm:flex-row items-center justify-center gap-2.5">
              <a href="/" className="h-11 px-5 rounded-2xl bg-white text-slate-950 text-sm font-semibold hover:bg-slate-200 transition inline-flex items-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Back to MarketX
              </a>
              <a
                href="/?support=1"
                className="h-11 px-5 rounded-2xl border border-white/[0.12] text-slate-200 text-sm font-medium hover:bg-white/[0.06] transition inline-flex items-center gap-2"
              >
                <MessageCircle className="w-4 h-4" /> Open Support chat
              </a>
            </div>
          </section>

          <footer className="pt-2 pb-[max(2rem,env(safe-area-inset-bottom))] text-center text-xs text-slate-500">
            MarketX · Built by SpiriTech Labs · Analyses are research, not financial advice.
          </footer>
        </main>
      </div>

      {showTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top"
          className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 w-11 h-11 rounded-full bg-white text-slate-950 shadow-lg flex items-center justify-center hover:bg-slate-200 transition cursor-pointer"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
