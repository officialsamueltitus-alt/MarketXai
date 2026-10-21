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
  ImagePlus,
  Radar,
  Landmark,
} from 'lucide-react';
import { MarketXIcon } from '../components/MarketXIcon';

// The MarketX Site Guide, served as its own page at /blog. Static content only: nothing here is user input.

const UPDATED = 'October 2026';

type Row = string[];

interface Section {
  id: string;
  title: string;
  icon: React.ElementType;
  lead: string;
  /** Up to two screenshots of what the section describes (public/guide, demo account, no real data) */
  shots?: Shot[];
  body: React.ReactNode;
}

interface Shot {
  src: string;
  alt: string;
  w: number;
  h: number;
}

// Screenshots: lazy loaded, sized up front (no layout jump), shown at phone width so the text stays readable
const Shots: React.FC<{ shots: Shot[] }> = ({ shots }) => (
  <div className={`mt-5 grid gap-4 ${shots.length > 1 ? 'sm:grid-cols-2' : ''} justify-items-center`}>
    {shots.map(s => (
      <figure key={s.src} className="w-full max-w-[340px]">
        <div className="rounded-2xl overflow-hidden border border-white/[0.08] bg-black shadow-[0_18px_50px_-20px_rgba(0,0,0,0.8)]">
          <img src={s.src} alt={s.alt} width={s.w} height={s.h} loading="lazy" decoding="async" className="block w-full h-auto" />
        </div>
        <figcaption className="mt-2 text-[13px] text-slate-400 leading-relaxed text-center px-2">{s.alt}</figcaption>
      </figure>
    ))}
  </div>
);

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
    shots: [{ src: '/guide/start-welcome.webp', alt: "The welcome screen: create an account, sign in, or enter the pass code from your email.", w: 786, h: 1300 }, { src: '/guide/start-signin.webp', alt: "Signing in: tick the Terms and Privacy box, then use your email and password.", w: 786, h: 1004 }],
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
              Check your inbox for your personal <B>pass code</B>. It is sent once and stays valid for 48 hours. An unused code expires and your seat
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
    shots: [{ src: '/guide/nav-markets.webp', alt: "Markets shows live prices. Ask SI is where you chat and run analyses.", w: 786, h: 1280 }, { src: '/guide/nav-sidebar.webp', alt: "The sidebar: a new chat, your notifications, saved setups and chat history.", w: 640, h: 720 }],
    title: 'Finding your way around',
    icon: Compass,
    lead: 'Everything sits in two places: the top bar across the page and the sidebar on the left. On phones and tablets, tap the sidebar button at the top left to open it.',
    body: (
      <>
        <Table
          head={['Section', 'Where to find it', 'What it does']}
          rows={[
            ['Markets', 'Top bar, view switch', 'Live prices and ready made prompts for forex, gold, crypto, stocks and indices. Tap any card to analyze it.'],
            ['Ask SI', 'Top bar, view switch', 'The chat where you type prompts and get trade plans.'],
            ['SI engines', 'Top bar, Models button', 'Shows the active MarketX Engine and engines coming soon.'],
            ['New chat', 'Top bar or sidebar', 'Starts a fresh conversation.'],
            ['Credits', 'Top bar credit pill, or Sidebar, Settings, Credits', "Your balance, today's analyses, and plans."],
            ['Notifications', 'Top bar bell', 'Analyses, sign ins, payments, rewards and replies from support.'],
            ['Profile', 'Top bar avatar, or Sidebar, Settings, Profile', 'Your stats, plan, gifting, campaign and account options.'],
            ['History', 'Sidebar', 'Your saved trade setups and past chats.'],
            ['Settings', 'Sidebar, Settings', 'Credits, Profile, Tools, Support chat, theme, and Terms and Privacy at the bottom.'],
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
    shots: [{ src: '/guide/run-timeframe.webp', alt: "Tap the timeframe button to pick a timeframe, or RDM to scan them all.", w: 786, h: 374 }, { src: '/guide/run-steps.webp', alt: "The process report shows every step as it happens, from Starting to the analysis.", w: 786, h: 1240 }],
    title: 'Running an analysis',
    icon: LineChart,
    lead: "Name the market and the timeframe in one sentence, press Enter, and MarketX returns a trade plan built from that timeframe's live candles.",
    body: (
      <>
        <Steps
          items={[
            <>
              Open <B>Ask SI</B>, or tap a card on <B>Markets</B>, which fills the prompt for you.
            </>,
            <>
              Type what you want, for example <em>Analyze EUR/USD on the 1H</em> or <em>BTC 15 min setup</em>. Supported markets include forex pairs, gold and silver,
              oil, crypto, stocks, major indices and synthetic indices.
            </>,
            <>
              Tap the <B>timeframe</B> button on the input box to open the full row of timeframes: <B>RDM, 1m, 3m, 5m, 15m, 30m, 1H, 2H, 4H, 6H, 8H, 12H, 1D and
              1W</B>. The one you pick stays selected, even after you close the site, until you change it. A timeframe written in your prompt (such as 5m, 2H,
              daily or weekly) takes priority for that prompt.
            </>,
            <>
              Optional: choose <B>Normal SL</B> or <B>Tight SL</B> on the input box (see Stop loss options).
            </>,
            <>
              Optional: attach a chart screenshot with the image button, or paste one with Ctrl+V (Cmd+V on Mac), and type the pair. MarketX then reads that
              chart (see Analyzing a chart screenshot).
            </>,
            <>
              Press <B>Enter</B> or the send button. Use <B>Shift+Enter</B> for a new line. While it works you can press <B>Stop</B> to cancel.
            </>,
          ]}
        />
        <Note title="Any coin or meme" tone="emerald">
          Beyond forex, gold, stocks and the big coins, you can analyze any cryptocurrency or meme that trades: coins listed on the major exchanges,
          plus tokens that only trade on-chain on Solana, Base, Ethereum, BSC and more. Name it the way you would on X: <B>$WIF</B>,{' '}
          <B>BONK/USDT</B>, <B>analyze ansem on the 1H</B>, <B>moo deng 4H</B>, or paste the token's <B>contract address</B>. MarketX finds the live
          market, its live price and its candles. Tiny meme prices are shown in full, like $0.0000009645. If a coin isn't listed anywhere with enough
          liquidity to trade, you're told so and no credit is used.
        </Note>
        <Note title="RDM: let MarketX pick the timeframe" tone="emerald">
          Choose <B>RDM</B> (random) in the timeframe row and MarketX scans every timeframe from 1m to 1W for you, or only the ones you pick: when you
          tap RDM, the timeframes it searches drop down right under it (the list stays closed until you tap RDM, and tapping it again folds it away).
          Tap <B>All</B>, or tap the timeframes you want (for example 1H, 4H and 1D), then press <B>Save</B> (or <B>Cancel</B> to keep your last
          choice); the list folds away. Your choice is saved to Preference Mode and used everywhere you pick RDM, in the input box and on the watchlist. It keeps only valid, high probability setups
          where price sits between the entry and the first target, with none of the entry, stop loss or targets reached yet, and gives you the strongest one. The
          result shows an <B>RDM · picked 1H</B> tag (or whichever timeframe it used) and the write up lists the timeframes that had a valid setup. If no timeframe
          has one, you get a clear No signal. One analysis, one credit.
        </Note>
        <Note title="Buy or sell only?">
          Say so in the prompt, for example short setup on gold 4H. If there is no valid setup in that direction, you get the best valid plan or a clear No signal.
        </Note>
        <Note title="Ask about any pair">
          Questions get a written answer, not a trade plan. Ask about trading in general (what is a liquidity sweep?) or about any market: <B>tell me about
          WIF</B>, <B>BONK market cap</B>, <B>EUR/USD price</B>, <B>why is gold rising today?</B>, <B>is BTC bullish?</B> The answer uses the pair's live
          price and today's move, what the market is and where it trades, and today's news. For coins that trade on-chain it also covers the chain,
          contract address, liquidity, trading volume, market cap and how long the pool has existed. For a trade plan, ask for it: <B>Analyze EUR/USD on the
          4H</B>.
        </Note>
        <Note title="Exact answers, checked on the web" tone="emerald">
          MarketX answers the exact question you ask, with the direct answer first. When the answer depends on facts that change (a listing, a launch,
          token supply, a company's news, economic data or anything recent), it searches the web as it writes, and the process report shows{' '}
          <B>Searching the web</B> while it looks, then the sites it used. Those sites are also listed under the answer. Live prices always come from
          the live market, never from a web page.
        </Note>
        <Note title="Just typed a pair?" tone="emerald">
          Send only a pair, like <B>EURUSD</B>, <B>gold</B> or <B>$WIF</B>, and MarketX asks what you want to know about it, with two buttons:{' '}
          <B>Analyze</B> for a trade plan, or <B>Info</B> for the pair's details. Asking is free; a credit is only used once you pick one. Add a timeframe or
          a word like buy, sell, setup or outlook (gold 4H, sell BTC) to go straight to the analysis.
        </Note>
        <Note title="Just say it" tone="emerald">
          Tap the <B>mic</B> in the input box (or in the Ask box on <B>Markets</B>) and speak: <em>Analyze gold on the 4 hour</em>, <em>Is WIF safe?</em> or{' '}
          <em>Fundamental analysis CPI</em>. Your words appear as you talk, and the moment you stop, MarketX sends them like a typed message. Say{' '}
          <em>Open my watchlist</em> (or price alerts, trade journal, track record, Strategy Builder, Preference Mode) to open a tool. Tap the glowing button to
          send early, or the X to cancel. Voice is free; an analysis still uses one credit as usual. Your browser asks once for microphone access.
        </Note>
        <Note title="Watch it work">
          After you send, the process report shows each step as it happens: <B>Starting…</B>, <B>Waking up MarketX engine</B>, <B>Looking at prompt</B> (the analysis begins once these three are done; Stop works at any time),
          then reading your request, <B>Finding tools</B>, then <B>Using tools</B>, checking the
          live price, checking today's news and building the plan. It then folds into one line such as Worked for 14s. A yellow dot on that line means there is news for this market today; tap the line to see it.
        </Note>
        <Note title="Tools">
          Tap <B>Tools</B> under the input box, or type / in the input, to see every tool. Live now: <B>/watchlist</B>, <B>/price-alerts</B>, <B>/trade-journal</B>, <B>/track-record</B> (see
          Watchlist, journal and track record below), <B>/preference</B> (see Preference Mode below), <B>/strategy-builder</B> (see Strategy Builder below) and <B>/fundamental-analysis</B> (see Fundamental Analysis below). Still
          in private testing and marked Soon: Trading Agent, MT5 Connector, <B>/indicators</B> (add your favourite indicators to every analysis) and{' '}
          <B>/connect-tradingview</B> (link TradingView and analyze straight from your charts). They open for everyone once testing ends.
        </Note>
        <P>Each reply shows the tokens it used. One analysis or answer costs one credit. The arrows on the input box jump to the top or bottom of a long chat.</P>
      </>
    ),
  },
  {
    id: 'chart-screenshots',
    shots: [{ src: '/guide/chart-attach.webp', alt: "A chart screenshot attached and ready. Name the pair, then send.", w: 786, h: 354 }],
    title: 'Analyzing a chart screenshot',
    icon: ImagePlus,
    lead: 'Upload a screenshot of any candlestick chart, tell MarketX which pair it is, and it analyzes exactly what the chart shows with the same strategy it uses for live analyses.',
    body: (
      <>
        <Steps
          items={[
            <>
              Press the <B>image button</B> on the input box, or paste a screenshot with Ctrl+V (Cmd+V on Mac). PNG, JPG and WebP images work.
            </>,
            <>
              Type the pair, for example <em>EURUSD</em>, <em>Gold</em> or <em>BTC</em>. If you forget, the input box reminds you.
            </>,
            <>
              Send. MarketX reads the price scale, the last price, the swings and the timeframe label on your chart, then marks the zones, the entry, the stop loss
              and three targets from that chart.
            </>,
          ]}
        />
        <Note title="Read from your chart">
          The result starts with Read from your chart and shows the chart's last price next to today's live price. If price has moved since you took the
          screenshot, check the levels before you trade.
        </Note>
        <Note title="Not a chart?" tone="amber">
          Photos, documents and other images are not analyzed. You get a short message and the analysis is refunded. The same happens if a chart can't be read.
        </Note>
        <Note title="Free until 1 November">Chart screenshot analysis is free for everyone until 1 November 2026, then part of Pro. Typing the market works on every plan.</Note>
      </>
    ),
  },
  {
    id: 'reading-a-result',
    shots: [{ src: '/guide/result-levels.webp', alt: "A result: the direction, confluence, optimal entry, stop loss, TP1 and risk to reward.", w: 786, h: 810 }, { src: '/guide/result-alerts.webp', alt: "Price alerts watch the entry, targets and stop for you, with the live price on each trade.", w: 786, h: 1114 }],
    title: 'Reading a result',
    icon: Target,
    lead: 'Every analysis ends in one of four outcomes: a trade plan, No signal, No signal, already mitigated, or No signal, already moved. MarketX only calls a trade from a fresh, untouched level with a strong reward to risk, while price is still near the entry.',
    body: (
      <>
        <Table
          head={['Part of the card', 'What it tells you']}
          rows={[
            ['Direction', 'BUY LIMIT or SELL LIMIT: a pending order in a zone price has not reached yet. BUY NOW or SELL NOW (market): price is making the first touch of a fresh zone right now, so the trade is taken at the current price.'],
            ['Entry (Limit Zone)', 'The price range to enter in, with the Optimal price marked.'],
            ['Stop Loss', 'Where the idea is wrong and the trade should close.'],
            ['TP1, TP2, TP3', 'Three targets, each with its reward to risk and a suggested share of the position to close.'],
            ['Risk : Reward', 'The ratio to the final target. Trade plans need at least 1 : 2.5.'],
            ['Zones', 'Levels to watch: Untouched ones are still valid, Mitigated ones have already been used by price.'],
            ['Points of interest', 'Demand order blocks (discount), supply zones (premium), fair value gaps and the golden pocket pool, each marked unmitigated or mitigated.'],
            ['Write up', 'The full reasoning, the market structure and the timeframe used.'],
            ['Recheck', 'On every result. After a signal, Recheck zones replays the latest live candles and price over the zone, entry, stop and targets and tells you if the setup is still valid, filled, stopped out, has reached a target or is already mitigated. After a No signal, Recheck market checks whether the zones listed were tapped and whether a fresh setup has formed since (run a new analysis to get its levels). Free, no credit used.'],
            ['High impact news', 'A warning when major news may move the market soon, with guidance.'],
          ]}
        />
        <Note title="No signal">There is no clean, high probability setup right now. The card still shows the key zones to watch so you can check back later.</Note>
        <Note title="No signal, already mitigated" tone="amber">
          Before any signal, every candle since the zone formed is checked on the timeframe you asked for. If price has already entered the zone and returned,
          touched the entry, hit the stop loss or reached any target (TP1, TP2 or TP3), the trade has played out and is not offered. The note names which level
          was reached and when.
        </Note>
        <Note title="No signal, already moved" tone="amber">
          A trade is only offered while price is still close to its entry. For a buy the entry is at or below the current price and the targets are well above
          it; for a sell the entry is at or above the current price and the targets are well below it. This applies to pending (limit) and buy now or sell now
          (market) trades alike. If price has already travelled a large part of the way toward TP1, or is sitting near the stop loss, the move is under way and
          you get <B>No signal, already moved, close to TP</B> (or close to the stop loss) with the prices named, instead of a late entry.
        </Note>
        <Note title="How the points of interest are found">
          1. The recent swing high and low set the dealing range. 2. Its 0.50 equilibrium splits premium (above) from discount (below), and the 0.618 to 0.705
          golden pocket is measured on the swing. 3. Demand is only bought in discount and supply only sold in premium, next to their fair value gaps and the
          golden pocket pool. 4. Every point is checked for taps; only untouched ones ahead of price, paying at least 1 : 2.5, can become a trade.
        </Note>
        <Note title="Only the current price range">
          Zones are taken only from the most recent price action on your timeframe, inside the range price is trading in now, and ranked by strength, freshness
          and Fibonacci confluence. If the live candles can't be loaded to check the levels, you get No signal rather than an unverified trade.
        </Note>
        <P>Use the copy buttons on the card to copy the trade parameters or the full write up.</P>
      </>
    ),
  },
  {
    id: 'stop-loss-options',
    shots: [{ src: '/guide/sl-tighten.webp', alt: "Tighten SL on a result recalculates a closer stop for the same setup.", w: 786, h: 880 }],
    title: 'Stop loss options',
    icon: SlidersHorizontal,
    lead: "Normal SL gives the trade breathing room past the zone; Tight SL sits just past each zone. You can also tighten the stop after a result.",
    body: (
      <>
        <Note title="Tight SL on the input box (before you send)">
          <B>Normal SL</B> (the default) places the stop a little past the point where the zone is proven wrong, with room for the usual wicks of that
          timeframe, so a quick spike through the zone edge does not stop you out. <B>Tight SL</B> works with each zone found on the timeframe you ask for and
          places the stop just past that zone, so the stop follows the zone itself. It improves reward to risk but is easier to hit. Switch the toggle on the
          input box, or set your default in Preference Mode.
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
    id: 'watchlist-and-tools',
    shots: [
      { src: '/guide/watchlist.webp', alt: 'The watchlist: each pair with its timeframe, a setup ready or building, Get the plan and Scan now.', w: 780, h: 1180 },
      { src: '/guide/connectors.webp', alt: 'Tools: the ones in use, each with a switch to turn it off.', w: 780, h: 966 },
    ],
    title: 'Watchlist, journal and track record',
    icon: Radar,
    lead: 'Four tools keep working for you after the chat: the watchlist finds setups on your pairs, price alerts follow your trades, the journal keeps your results, and the track record shows how signals played out.',
    body: (
      <>
        <Steps
          items={[
            <>
              <B>/watchlist.</B> Type it in the input and approve the watchlist once. MarketX then watches the pairs you add on its own, all day.
            </>,
            <>
              <B>Add a pair</B> (EURUSD, gold, BTC, a meme coin) and pick a timeframe. Pick <B>RDM</B> to have the pair scanned on every timeframe, or only on the RDM timeframes you
              chose (the same choice as in the input box and Preference Mode; change it there or right here and every RDM pair follows). With a trade type
              on, pairs only scan that type's timeframes, and only the ones you kept for it if you narrowed them. Before a pair
              is added, MarketX confirms it can read its live price and chart; if it can't, the pair is not added and you are told why.
            </>,
            <>
              Each pair shows <B>Setup ready</B>, <B>Building</B> (a fresh zone price is getting close to) or <B>Watching</B>. When a setup is found you get a
              notification and an email, once per setup. Tap <B>Get the plan</B> for the full analysis with entry, stop and targets.
            </>,
          ]}
        />
        <Note title="Price alerts, journal and track record">
          <B>/price-alerts</B> follows a trade plan's entry, targets and stop for you. <B>/trade-journal</B> works by itself and by hand. Turn on a price alert
          on a signal and the trade is written into your journal straight away, marked <B>Auto</B>. When the alert ends, the journal scores it: the
          target or stop reached, the R and how long it took. A trade that reaches TP1 is a win straight away and is updated if it goes on to TP2 or TP3.
          If price comes back to the stop after TP1, it stays a win, scored at the furthest target reached. Only a trade that goes from the entry straight
          to the stop is a loss. If the entry was never reached it shows <B>No fill</B> and stays out of your stats. Trades you
          take elsewhere you log yourself; close them with the exit price or profit and loss. Either way you get your win rate, R, streak and best markets. <B>/track-record</B> shows how
          your price alert signals played out (TP1, TP2, TP3 reached, stopped or moved before entry) with the R of each result and your total R, and the same
          results across MarketX. The same rule applies everywhere, including the public ID checker and the result records on Solana: TP1 first is a win.
        </Note>
        <Note title="How a hit is judged">
          MarketX follows each alert on live one-minute prices and tells you within seconds when price reaches your entry, a target or the stop. Each
          message also shows the price at that moment (<B>Price now</B>), so you can compare it with your own chart. Your broker's price can differ a
          little from MarketX's, so a stop or target only counts once price has clearly traded through it, not when a wick just touches it. The same rule
          applies to stops and targets, so it never favours wins, and it is the rule your journal, track record and Solana records use too. If your
          broker's price is often far from the price MarketX shows, keep that difference in mind when you place your orders.
        </Note>
        <Note title="Sound and phone notifications">
          While MarketX is open, a new watchlist setup plays a short chime (turn it off with <B>Sound when a setup is found</B> in the watchlist). Open
          <B> Settings</B> in the side menu and switch on <B>Phone notifications</B>: setups and alert hits then reach your phone or computer with its own
          notification sound, even when MarketX is closed. Tap one to open that exact pair or alert. On iPhone and iPad, first tap Share, then Add to Home Screen, and
          open MarketX from there.
        </Note>
        <Note title="Tools">
          Every tool you turn on appears in Tools: tap <B>Tools</B> under the input box, or find it in Settings. Modes that change your answers (Fundamental
          Analysis, Strategy Builder, Confirmation, your trade type) show as small coloured dots on the Tools button and sit at the top under Active now. Open a
          tool from there, or use its switch to turn it off. Turning one off keeps your pairs, trades and results.
        </Note>
        <Note title="Free and Pro">
          Price alerts, the track record and the <B>RDM</B> timeframe are free for everyone. The watchlist, trade journal, Strategy Builder, Fundamental
          Analysis, Preference Mode and chart screenshot analysis are free for everyone until 1 November 2026, then part of Pro. On the Free plan they
          pause, and your pairs, trades and settings are kept for when you upgrade.
        </Note>
        <Note title="Not trading advice" tone="amber">
          A setup on the watchlist is a level worth looking at, not an instruction to trade. Check the plan, size your risk and decide for yourself.
        </Note>
      </>
    ),
  },
  {
    id: 'strategy-builder',
    title: 'Strategy Builder',
    icon: Target,
    lead: 'Run your own strategy instead of the MarketX engine: write it in your own words, answer a few questions, or start from SMC, ICT and other popular methods.',
    body: (
      <>
        <Steps
          items={[
            <>
              <B>/strategy-builder.</B> Type it in the input. Tap <B>New strategy</B> and explain your strategy the way you would to a friend (what you look for, where
              the stop goes, where you take profit, which timeframes and markets), then answer the guided questions: the setup, direction, timeframes, markets,
              what keeps you out of a trade (trend, RSI, sessions), your stop and your targets.
            </>,
            <>
              Or open the <B>strategy library</B>: SMC order blocks, ICT liquidity sweeps with fair value gaps (with or without the London and New York killzones),
              trend pullbacks, moving average crossovers, breakout and retest, RSI divergence, support and resistance, Bollinger mean reversion, the London
              breakout and the Wyckoff spring. Use one as it is or tweak it.
            </>,
            <>
              <B>Review your rules.</B> MarketX shows your strategy as clear rules, and lists anything it can't automate (news, discretion) so you keep that part
              in mind yourself. Name it, then <B>Save and use</B>.
            </>,
            <>
              <B>Turn it on.</B> While the Strategy Builder is on, MarketX finds every trade with your strategy instead of its own engine, in your analyses and
              on your watchlist. Everything else stays the same: the signal, RDM, timeframes, credits, price alerts and the journal. Each trade is tagged
              <B>Personal strategy</B>, on its card, in your journal and track record, and on its Solana record. A violet chip next to the input box shows which
              strategy is running; tap it to switch or turn the Strategy Builder off.
            </>,
          ]}
        />
        <Note title="Good to know">
          Your strategy only trades the timeframes and markets you chose; ask for another and it says so. If your strategy finds nothing, you get a clear No
          signal with the reason and your rules. Results from your own strategy count in your own track record, not in MarketX's. The Strategy Builder is free until
          1 November 2026, then part of Pro.
        </Note>
      </>
    ),
  },
  {
    id: 'fundamental-analysis',
    title: 'Fundamental Analysis',
    icon: Landmark,
    lead: 'Ask /fundamental-analysis about CPI, NFP, PPI, a rate decision or any release: what it is most likely to show, and which pairs it favours or works against. Your normal analyses keep working as usual.',
    body: (
      <>
        <Steps
          items={[
            <>
              <B>Switch it on.</B> Type /fundamental-analysis in the input, press Enter and turn it on. A blue dot on the <B>Tools</B> button under the input box
              shows it is on; open Tools any time to open it again or switch it off.
            </>,
            <>
              <B>Ask with the tool.</B> Type /fundamental-analysis followed by what you want read: "/fundamental-analysis CPI", "/fundamental-analysis next
              ECB decision", "/fundamental-analysis how will NFP move gold?". You can also tap a topic, or one of this week's high-impact releases, inside the
              tool. On an analysis card that has today's news, tap <B>Check fundamental</B> for a read of that news for the pair.
            </>,
            <>
              <B>MarketX does the homework.</B> It reads this week's economic calendar, the last releases against their forecasts, the latest news from the BBC,
              CNBC and MarketWatch, and searches reputable sources for the consensus and what central banks are saying.
            </>,
            <>
              <B>Read the result.</B> You get the most likely outcome with its odds, every scenario and what it would do to the currency, the past releases, what
              drives the number, the risks to the view, and the pairs it moves most. Each pair shows its live price and a <B>For</B> or <B>Against</B> tag:
              For means the most likely outcome favours the pair rising, Against means it weighs on the pair.
            </>,
            <>
              <B>Recheck it later.</B> Tap <B>Recheck</B> on the result to read it again with live data. The card tells you whether the release is out:
              <B> Actual</B> then shows the published figure and whether it beat or missed the forecast (until then it says Pending), what is new since your
              last read, whether the forecast changed, and whether the most likely outcome and each pair's For or Against still hold:
              <B> Still valid</B>, <B>Changed</B> or <B>Released</B>. The card updates in place. A recheck uses one analysis credit.
            </>,
            <>
              <B>Find it again.</B> Every read is kept under <B>Fundamentals</B> in the History section of the side menu, and you get an email with the
              outcome, its odds, the forecast and the pairs for and against, plus a button that opens that exact read.
            </>,
            <>
              <B>Save and share it.</B> Tap <B>Save image</B> to keep the card as a picture (on iPhone, choose Save Image to put it in Photos; on Android
              it lands in Downloads, which your gallery shows), <B>Share</B> to send the picture with a short write-up to any app, or <B>Post on X</B> for
              a brief post with the key points. Before the release it shares the forecast; once the figure is out, the result against the forecast.
            </>,
          ]}
        />
        <Note title="Good to know">
          Only messages that start with /fundamental-analysis get a fundamental read. Everything else you ask, with the tool on or off, is a normal analysis
          or answer, exactly as before. Each read uses one analysis credit, and a message that isn't about fundamentals is not charged. A fundamental read gives
          the odds of each outcome, never a certainty: releases surprise and markets can react in unexpected ways, so manage your risk around big releases.
        </Note>
        <Note title="Free until 1 November">Fundamental Analysis, its rechecks and the daily news alerts are free for everyone until 1 November 2026, then part of Pro.</Note>
      </>
    ),
  },
  {
    id: 'preference-mode',
    title: 'Preference Mode',
    icon: SlidersHorizontal,
    lead: 'Preference Mode sets your own defaults, your risk per trade and how results look, and has a trade calculator for your lot size.',
    body: (
      <>
        <Steps
          items={[
            <>
              <B>/preference.</B> Type it in the input, or open it from Tools (under the input box). Choose your <B>analysis mode</B> (Normal or Confirmation, see below), the timeframe and stop loss new prompts start with, which timeframes <B>RDM</B> searches (All, or the ones you tick), your account size, currency and risk per trade, whether results
              show the full write-up or lead with the levels, and which list the Markets tab opens on. Every change
              saves on its own.
            </>,
          ]}
        />
        <Note title="News alerts" tone="emerald">
          Switch on <B>News alerts</B> in Preference Mode and choose which news you want: <B>High</B>, <B>Medium</B>, <B>Low</B> impact, any mix,
          or <B>All</B>. Every morning at 7:00 AM WAT you get a notification and an email with the releases due in the next 24 hours. Each one has a
          short three-line briefing (what it is, what to watch against the forecast, the pairs it moves) and an <B>Analyze it</B> button that opens
          MarketX with the fundamental read ready to send. Switch it on during the day and the rest of that day's releases come within minutes.
        </Note>
        <Note title="Analysis mode: Normal or Confirmation" tone="emerald">
          <B>Normal</B> (the default) gives you a fresh, untouched zone ahead of price with a limit entry. <B>Confirmation</B> waits: MarketX
          still finds the zone, but only calls the trade once price reaches it and a lower timeframe shows it holding, such as a liquidity sweep or
          false breakout, an engulfing candle, a pin bar, a morning or evening star, or a structure break. Then you get the entry at market with the
          stop beyond the reaction wick, and the watchlist only says ready at that moment. Until then the result says <B>waiting for
          confirmation</B> and shows the zone. Fewer trades, each one confirmed. A green chip next to the input box shows when it is on.
        </Note>
        <Note title="Trade type: Scalp, Day or Swing" tone="amber">
          Pick the kind of trades you take and every analysis, your personal strategy and your watchlist only give trades of that type. <B>Scalp</B>{' '}
          uses 1m to 15m charts, <B>Day</B> uses 15m to 2H and <B>Swing</B> uses 4H to 1W; if you ask for another timeframe, MarketX uses the nearest
          one of your type and says so. Under the trade type cards you can also keep <B>only the timeframes you trade</B>: tap a timeframe to switch it
          off (for example scalps on the 5m and 15m only). While your trade type is on, those timeframes win over every other timeframe on MarketX,
          including the timeframe you pick in the input box, your RDM choice, your watchlist pairs and your personal strategy, until you change them,
          tap <B>Use all</B>, or switch the trade type back to All types. MarketX remembers your choice for each type.
          A day trade must be closed by <B>9:00 PM WAT</B> the same day, a swing trade by <B>9:00 PM WAT on Friday</B>.
          With a price alert on, you get a reminder 30 minutes before, then a message to close it. A trade still open at that time, in profit or in
          loss, is recorded as <B>ended</B> at the price then, in your alerts, journal, track record and its Solana record. <B>All types</B> (the
          default) works as before. A chip next to the input box shows your trade type.
        </Note>
        <Note title="Trade calculator">
          In Preference Mode, the trade calculator works out the lot size for the risk you choose, or shows what a lot size you already have in mind puts
          at risk. Enter your account size, then your entry and stop prices (or the stop in pips or points). It handles forex, gold, silver, oil, indices,
          crypto, stocks and synthetics, converts to your account currency, and rounds down so you never risk more than you set. Tap <B>Lot size</B> on
          any trade card to open it already filled with that trade.
        </Note>
        <Note title="Your trade, in your money">
          With an account size set, every trade card shows what you risk if the stop is hit and what each target pays, worked out from your risk per trade.
          Preferences only change your view and starting values. MarketX finds and scores setups the same way for everyone.
        </Note>
        <Note title="Price alerts: Auto or Manual">
          When you turn on price alerts you choose <B>Auto</B> (every trade MarketX gives you afterwards is watched by itself) or <B>Manual</B> (you tap Get
          price alert on the trades you want). Switch any time in the alerts panel or in Preference Mode.
        </Note>
        <Note title="Free until 1 November">Preference Mode and the trade calculator are free for everyone until 1 November 2026, then part of Pro.</Note>
      </>
    ),
  },
  {
    id: 'token-safety-and-proofs',
    title: 'Token safety and signal proofs',
    icon: ShieldCheck,
    lead: 'Two checks built on Solana: a safety check on Solana tokens before you trade them, and a public proof of every signal MarketX gives.',
    body: (
      <>
        <Steps
          items={[
            <>
              <B>Token safety.</B> Ask in the chat, for free: <B>is $WIF safe?</B>, <B>rug check</B> followed by a contract address, or type <B>/token-safety</B>
              and the token. You can also tap <B>Safety check</B> after typing just a coin. It works for any Solana token, including coins listed on
              exchanges like WIF or BONK, and it also appears under analyses and answers about Solana tokens. It reads the token straight from the blockchain: whether more can still be minted, whether wallets can be frozen, special transfer
              rules, how much the largest holders own, whether the liquidity is locked, the pool's size and age, and known danger flags.
            </>,
            <>
              You get a score and a level: <B>Low risk</B>, <B>Caution</B> or <B>High risk</B>, with every check explained in plain words. Tap <B>Recheck</B> for a
              fresh read, or <B>Solscan</B> to see the token yourself.
            </>,
            <>
              <B>Signal proofs.</B> Every buy or sell signal is sealed the moment it is served: a fingerprint of its levels and time, written to the Solana
              blockchain within a minute or two. Tap <B>Proof on Solana</B> on a trade card to open its proof page, where your browser checks the fingerprint,
              the batch and the Solana transaction for you.
            </>,
            <>
              <B>The result, in plain words.</B> While a trade runs, only its fingerprint is public, so nobody can copy it. When it ends, or a day after it was
              given, the trade itself (pair, entry, stop, targets, time) and its result are written on Solana in readable text. Tap <B>Read the result on
              Solscan</B> on the proof page to see it, no blockchain knowledge needed.
            </>,
            <>
              <B>Your MarketX ID.</B> Every trader has their own MarketX ID, a Solana address shown on your <B>Profile</B>. Activate it once
              by sending a small amount of SOL to it (the exact amount is shown on your Profile), so it exists on Solana. Anyone can paste an ID into the <B>ID checker</B> (on the home page, or marketx.world/checker) to see that trader's public
              profile and results. Search it on Solscan (or tap
              <B> View my trades on Solscan</B>) to see every trade you took on MarketX and its result. Your name and email are never on chain, and the ID
              is for records only: never send funds to it.
            </>,
          ]}
        />
        <Note title="Why it matters">
          A proof shows exactly when a signal was given and that it was never edited afterwards, so the track record can be trusted. It doesn't say whether a
          trade will win, and it never includes who asked for the signal.
        </Note>
        <Note title="A check, not a guarantee" tone="amber">
          The safety check lowers the risk of a rug pull; it can't remove it. A Low risk token can still lose value. Size every trade with care.
        </Note>
      </>
    ),
  },
  {
    id: 'credits-and-plans',
    shots: [{ src: '/guide/credits-balance.webp', alt: "Your credits and today\u2019s analyses, with the time they refill.", w: 786, h: 1460 }, { src: '/guide/credits-pro.webp', alt: "Plans: Pro gives you more analyses every day.", w: 786, h: 1604 }],
    title: 'Credits, daily analyses and plans',
    icon: CreditCard,
    lead: "Each analysis uses one of today's analyses. When they are used up, new prompts pause until your analyses refill automatically at 3:00 AM every day. Campaign credits work differently: they are used first, and while you have any left your daily analyses are paused and kept (no 3:00 AM refill), then they pick up again once the campaign credits run out. If an analysis fails, it is refunded automatically.",
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
          Tap the credit pill in the top bar, or open Sidebar, Settings, Credits. You see your balance, today's analyses left, and a countdown to the next
          refill. Daily analyses refill every day at 3:00 AM Lagos time (the site shows it in your own time), with no rollover.
        </Note>
        <Note title="Upgrade or refill">
          In Credits choose Upgrade to Pro (or Refill or change plan), pick Monthly or Yearly, and pay through the secure checkout by card, bank transfer or USSD
          where available. Pro switches on as soon as the payment is confirmed, and you get a notification and an email receipt. Current prices are always shown
          in the Plans window.
        </Note>
        <Note title="Coupon codes">
          Have a coupon code? Type it in the coupon box in Plans and tap Apply: the discounted price shows before you pay and is what you are charged. A
          code only works while its offer is running.
        </Note>
        <Note title="Daily limit reached?" tone="amber">
          Campaign credits are always used before your daily analyses, so the limit only shows once they are gone; the credit pill shows how many are left.
          When both are used up the input box shows Refills at 3:00 AM and new prompts are paused. Your analyses come back automatically at 3:00 AM, no refresh needed. Pro gives you
          10 analyses a day instead of 3.
        </Note>
      </>
    ),
  },
  {
    id: 'sharing-and-earning',
    shots: [{ src: '/guide/share-rewards.webp', alt: "The Rewards tab lists the campaigns where you can earn free credits.", w: 786, h: 1310 }, { src: '/guide/share-gift.webp', alt: "Gift credits to another trader with their username.", w: 786, h: 1240 }],
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
            <B>Share to X.</B> Press Share on any result card, from MarketX or from your own strategy in the Strategy Builder, and X opens with your post
            already written: buy or sell, the pair and timeframe, the entry, stop, targets and reward to risk, the link to the trade's Solana proof, and where
            it came from (Personal strategy, Confirmed or RDM). A no signal result shares the reason instead. The post always fits X's length limit, and it is
            copied for you too in case your browser blocks the new window.
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
            <B>Follow us.</B> Updates and new features are posted on X at @_MarketX and in the MarketX Telegram community (the Telegram button in the sidebar and on the Direct institutional desk).
          </>,
        ]}
      />
    ),
  },
  {
    id: 'account-and-settings',
    shots: [{ src: '/guide/account-profile.webp', alt: "Your profile: name, username, plan and stats.", w: 786, h: 1608 }, { src: '/guide/account-settings.webp', alt: "Settings: appearance, credits, profile, connectors, support and terms.", w: 640, h: 924 }],
    title: 'Your account and settings',
    icon: UserCog,
    lead: "Your profile, preferences and saved work are all reachable from the sidebar's Settings and the top bar avatar.",
    body: (
      <>
        <Points
          items={[
            <>
              <B>Profile.</B> Shows your name, @username, plan, analyses, credits and analyses left today. Use Edit profile to change your display name, username or
              photo, then Save Changes. You can also share your profile.
            </>,
            <>
              <B>Theme.</B> In Settings choose Light, Dark or System (follows your device). The Settings button stays at the bottom of the side menu when it
              is open; the settings scroll above it, so it is always in reach.
            </>,
            <>
              <B>Tools.</B> In Settings, the tools you have turned on (watchlist, price alerts, trade journal, track record). Two are shown;
              the expand icon opens the full list. Open a tool or switch it off from there.
            </>,
            <>
              <B>Notifications.</B> The bell shows analyses, sign ins, payments, rewards and support replies. Filter them, mark them read or clear them. Turn Email
              me about activity on or off; security alerts are always emailed. If you leave or close MarketX while an analysis is running, you still get a
              notification when it is ready, and tapping it opens that exact result.
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
    shots: [{ src: '/guide/help-support.webp', alt: "Support chat: message the MarketX team from inside the app.", w: 786, h: 1204 }, { src: '/guide/help-desk.webp', alt: "The help desk on the home page: support chat, email, X, Telegram and this guide.", w: 786, h: 1540 }],
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
        <Note title="Ask Matt" tone="emerald">
          <B>Matt</B> is MarketX's help assistant. Switch to it with the <B>Ask SI / Matt</B> switch at the top of the side menu, type <B>/matt</B> in the input, or tap <B>Ask Matt</B> on a
          trade card or in any panel to have that exact thing explained. Your chats with Matt are kept: tap the <B>History</B> icon at the top of the Matt page to
          go back to any of them, search them, or delete one; <B>New chat</B> starts a fresh one. Matt answers questions about MarketX features, tools and settings, your own account
          (plan, credits, what is switched on), events and promos, and the markets (what a pair is, what moves it, its sessions). Matt doesn't place trades or
          give financial advice; for a trade plan use Ask SI. Questions about how MarketX is built or run are private and get "Not available"; asking them
          repeatedly pauses Matt for your account for a while.
        </Note>
        <Note title="Email">You can also write to help.marketx@gmail.com.</Note>
        <Note title="Quick fixes">
          <B>"Please slow down" or "Too many requests":</B> wait a minute and try again; it clears on its own. <B>A page looks broken after an update:</B>{' '}
          refresh it once. <B>No alerts on your phone:</B> check that Phone notifications is on in Settings and that your phone allows notifications for
          MarketX. <B>An alert doesn't match your broker:</B> see How a hit is judged in the watchlist section. <B>Still stuck?</B> Open Support chat
          and tell us what you tapped and what you saw.
        </Note>
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
                {s.shots && s.shots.length > 0 && <Shots shots={s.shots.slice(0, 2)} />}
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
