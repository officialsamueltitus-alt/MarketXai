import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, ArrowUp, Bell, BookOpen, Bot, ChartLine, ChevronLeft, ChevronRight, Eye, Flame, KeyRound, Landmark, LoaderCircle, Lock, Mail, Mic,
  NotebookPen, Radar, Send, ShieldCheck, SlidersHorizontal, Sparkles, Target, Trophy, UserRound, WandSparkles,
} from 'lucide-react';
import { MarketXIcon } from '../components/MarketXIcon';
import { MarketXText } from '../components/MarketXText';
import { TelegramIcon, XLogoIcon, YouTubeIcon } from '../components/SocialIcons';
import { DemoClip, useOnScreen, type DemoId } from './demos';
import './landing.css';

// MarketX landing page (owner-specified, Oct 2026): what signed-out visitors see first, laid out section by section on the
// owner's reference video (gradient hero card with phones and floating objects, a phone in soft rings with an annotation,
// stacked colourful pills, a scrolling list panel, a highlighted goal list, a white "choose" showcase of rotating clip cards,
// a progress ring with two cards, device screens around big gradient text, a stacked card carousel, three-column pricing,
// a gradient call-to-action card with the footer, and "Contact us"). Every app section asks to sign up or sign in; the
// stand-alone public pages (the ID checker and the guide) open directly. Demo clips are animated replicas with example numbers.

interface LandingProps {
  onSignUp: () => void;
  onSignIn: () => void;
  onHaveCode: () => void;
  onOpenTerms?: (tab: 'terms' | 'privacy') => void;
  notice?: string | null;
}

const SUPPORT_EMAIL = 'help.marketx@gmail.com';

/** Adds .lx-in to [data-reveal] elements as they scroll into view (inside the landing's own scroller) */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll('[data-reveal]'));
    if (typeof IntersectionObserver === 'undefined') return items.forEach(i => i.classList.add('lx-in'));
    const io = new IntersectionObserver(
      entries => entries.forEach(e => e.isIntersecting && (e.target.classList.add('lx-in'), io.unobserve(e.target))),
      { root: el, rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
    );
    items.forEach(i => io.observe(i));
    return () => io.disconnect();
  }, [root]);
}

/** Steps through `count` items every `ms` while `on` */
function useTicker(count: number, ms: number, on: boolean) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setI(v => (v + 1) % count), ms);
    return () => clearInterval(t);
  }, [count, ms, on]);
  return [i, setI] as const;
}

// Stacked pill colours from the reference
const MARKETS: Array<[string, string, string]> = [
  ['XAU/USD', '#3b4cf0', '#fff'],
  ['BTC/USDT', '#eef542', '#0b0b12'],
  ['EUR/USD', '#ffffff', '#0b0b12'],
  ['NAS100', '#c9b8f5', '#0b0b12'],
  ['GBP/JPY', '#b8f5dc', '#0b0b12'],
  ['ETH/USDT', '#6d3fd0', '#fff'],
  ['$WIF', '#fbd0dc', '#0b0b12'],
  ['Volatility 75', '#67d4f5', '#0b0b12'],
];

const TOOLS: Array<{ icon: React.ElementType; name: string; tag: string; tagBg: string; meta: string; grad: string }> = [
  { icon: Bell, name: 'Price alerts', tag: 'Free', tagBg: '#b8f5dc', meta: 'entry, TPs, stop', grad: 'linear-gradient(135deg,#34d399,#0ea5e9)' },
  { icon: Eye, name: 'Watchlist', tag: 'Pro', tagBg: '#c9b8f5', meta: 'up to 12 pairs', grad: 'linear-gradient(135deg,#818cf8,#c084fc)' },
  { icon: NotebookPen, name: 'Trade journal', tag: 'Pro', tagBg: '#c9b8f5', meta: 'scored by price', grad: 'linear-gradient(135deg,#f472b6,#fb923c)' },
  { icon: WandSparkles, name: 'Strategy Builder', tag: 'Pro', tagBg: '#c9b8f5', meta: '10 setups', grad: 'linear-gradient(135deg,#a78bfa,#6366f1)' },
  { icon: ShieldCheck, name: 'Token safety', tag: 'Free', tagBg: '#b8f5dc', meta: 'Solana tokens', grad: 'linear-gradient(135deg,#22c55e,#84cc16)' },
  { icon: Landmark, name: 'Fundamental Analysis', tag: 'Pro', tagBg: '#c9b8f5', meta: 'CPI, NFP, rates', grad: 'linear-gradient(135deg,#38bdf8,#6366f1)' },
  { icon: SlidersHorizontal, name: 'Preference Mode', tag: 'Pro', tagBg: '#c9b8f5', meta: 'your way to trade', grad: 'linear-gradient(135deg,#fbbf24,#f97316)' },
  { icon: Radar, name: 'Track record', tag: 'Free', tagBg: '#b8f5dc', meta: 'wins, losses, R', grad: 'linear-gradient(135deg,#67e8f9,#3b82f6)' },
];

const GOALS: Array<[string, string, React.ElementType, string]> = [
  ['Find', 'the trade', ChartLine, 'Quality 78'],
  ['Automate', 'it on MT5', Bot, 'Order placed'],
  ['Read', 'the news first', Landmark, 'CPI · 55%'],
  ['Check', 'the token', ShieldCheck, 'Low risk'],
  ['Prove', 'every call', Sparkles, 'Sealed'],
];

const SHOWCASE: Array<{ id: DemoId; icon: React.ElementType; tint: string; title: string; text: string }> = [
  { id: 'analyze', icon: ChartLine, tint: '#e6f542', title: 'Analyze a trade', text: 'Name a market and a timeframe. MarketX reads the live candles and returns the entry, stop loss and three targets, or a clear No signal.' },
  { id: 'matt', icon: Mic, tint: '#b8f5dc', title: 'Talk back with Matt', text: 'Ask out loud and Matt answers out loud: your account, any MarketX tool, or what a market is doing right now.' },
  { id: 'fundamental', icon: Landmark, tint: '#fcd9a8', title: 'Fundamental Analysis', text: 'CPI, NFP, rate decisions: the most likely outcome with its odds, and the pairs it moves for or against. Recheck it when the figure is out.' },
  { id: 'safety', icon: ShieldCheck, tint: '#ff7a6b', title: 'Token safety check', text: 'Before you buy a Solana token, MarketX reads it from the chain: mint and freeze authority, liquidity, top holders, one clear score.' },
  { id: 'records', icon: Sparkles, tint: '#c9b8f5', title: 'Records on Solana', text: 'Every signal is sealed on the Solana blockchain when it is issued, and its result is written there once it closes. Anyone can check it.' },
];

const FAQ: Array<{ q: string; a: string; bg: string }> = [
  { q: 'Is MarketX free?', a: 'Yes, to start: 3 SI analyses every day, price alerts and your track record. Pro adds the Trading Agent, Fundamental Analysis, the watchlist and more.', bg: '#b8f5dc' },
  { q: 'How is a trade plan made?', a: 'From live candles: a supply or demand zone, a Fibonacci entry, RSI and the trend. If the move already happened, you get a clear No signal.', bg: '#eef542' },
  { q: 'Can anyone check the results?', a: 'Yes. Every signal is sealed on Solana when it is issued and its result is written there when it closes. Open any MarketX ID in the checker.', bg: '#a9c4ff' },
  { q: 'Which markets can I ask?', a: 'Forex, gold and metals, indices, stocks, crypto, memes by ticker or contract address, and synthetic indices.', bg: '#fbd0dc' },
  { q: 'Is this financial advice?', a: 'No. MarketX gives analysis for research and education. Expect losing streaks and keep the risk on each trade small.', bg: '#c9b8f5' },
];

const Phone: React.FC<{ demo: DemoId; className?: string; style?: React.CSSProperties; float?: boolean }> = ({ demo, className = '', style, float }) => (
  <div className={`lx-phone ${float ? 'float' : ''} ${className}`} style={style}>
    <div className="lx-phone-screen">
      <div className="lx-phone-notch" />
      <DemoClip id={demo} compact />
    </div>
  </div>
);

export const LandingPage: React.FC<LandingProps> = ({ onSignUp, onSignIn, onHaveCode, onOpenTerms, notice }) => {
  const scroller = useRef<HTMLDivElement>(null);
  useReveal(scroller);

  // Nav at the top on the hero, at the bottom once scrolled (and the back-to-top bump shows)
  const [down, setDown] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = () => setDown(el.scrollTop > 140);
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);

  const [goalRef, goalOn] = useOnScreen<HTMLDivElement>();
  const [goal] = useTicker(GOALS.length, 1900, goalOn);

  const [showRef, showOn] = useOnScreen<HTMLDivElement>();
  const [hold, setHold] = useState(false);
  const [active, setActive] = useTicker(SHOWCASE.length, 8500, showOn && !hold);
  const pick = (i: number) => {
    setActive(i);
    setHold(true);
    window.setTimeout(() => setHold(false), 20000);
  };
  const cur = SHOWCASE[active];

  const [faqRef, faqOn] = useOnScreen<HTMLDivElement>();
  const [faq, setFaq] = useTicker(FAQ.length, 5000, faqOn);

  const [checkId, setCheckId] = useState('');
  const openChecker = (e: React.FormEvent) => {
    e.preventDefault();
    const id = checkId.trim();
    window.location.href = id ? `/checker?id=${encodeURIComponent(id)}` : '/checker';
  };

  // Contact: opens the visitor's own mail app with the message written in (nothing is sent through MarketX)
  const [contact, setContact] = useState({ name: '', email: '', message: '' });
  const sendContact = (e: React.FormEvent) => {
    e.preventDefault();
    const body = `Hello MarketX,\n\n${contact.message.trim()}\n\nName: ${contact.name.trim()}\nEmail: ${contact.email.trim()}`;
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('MarketX question')}&body=${encodeURIComponent(body)}`;
  };

  const go = (id: string) => scroller.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div ref={scroller} className="lx h-[100dvh] w-full overflow-y-auto overflow-x-hidden overscroll-contain select-text">
      {/* ---------------- 1. Hero: gradient card, phones and floating objects ---------------- */}
      <section className="px-3 sm:px-5 pt-[max(76px,calc(env(safe-area-inset-top)+66px))]">
        <div className="lx-hero-card max-w-6xl mx-auto pt-14 sm:pt-20 text-center">
          {notice && <p className="relative z-10 mx-auto mb-6 max-w-md text-[13px] text-amber-900 bg-amber-100/70 border border-amber-300/60 rounded-xl px-3 py-2">{notice}</p>}
          <h1 data-reveal className="relative z-10 px-5 text-[36px] sm:text-[64px] font-bold tracking-[-0.035em] leading-[1.02] text-[#2b2d42]">
            Your trading <span className="whitespace-nowrap">co-pilot</span>
          </h1>
          <div data-reveal="2" className="relative z-10 mt-3">
            <span className="lx-underline">Free to start</span>
          </div>
          <div data-reveal="3" className="relative z-10 mt-6 flex flex-wrap justify-center gap-2.5 px-5">
            <button type="button" onClick={onSignUp} className="lx-outline">
              <ArrowRight className="w-4 h-4" /> Create account
            </button>
            <button type="button" onClick={onSignIn} className="lx-outline">
              <UserRound className="w-4 h-4" /> Sign in
            </button>
          </div>
          <button type="button" onClick={onHaveCode} className="relative z-10 mt-3 inline-flex items-center gap-1.5 text-[12px] text-[#3730a3] hover:text-[#1e1b4b] cursor-pointer bg-transparent border-0">
            <KeyRound className="w-3.5 h-3.5" /> I have a pass code
          </button>

          {/* Phones rise from the bottom edge of the card, objects float around them */}
          <div className="relative mt-10 h-[380px] sm:h-[460px]">
            <div className="lx-blob lx-blob-fuzzy w-16 h-16 sm:w-24 sm:h-24 left-[6%] sm:left-[16%] top-[2%]" />
            <div className="lx-blob lx-blob-gloss w-14 h-14 sm:w-20 sm:h-20 right-[6%] sm:right-[19%] top-[44%]" style={{ animationDelay: '-3s' }} />
            <div className="lx-mini hidden sm:block left-[19%] top-[22%] z-20" style={{ animationDelay: '-2s' }}>
              <div className="w-[118px] rounded-[26px] bg-[#0b0b10] border-2 border-[#2a2a31] p-3 text-left shadow-2xl">
                <p className="text-[9px] text-[#9b9cab]">Price alert</p>
                <p className="text-[9px] text-emerald-300 mt-0.5">Entry reached</p>
                <p className="mt-1 text-[22px] font-semibold text-white tabular-nums">00:34</p>
                <p className="mt-1 h-5 rounded-full bg-[#2f5bff] text-[9px] text-white grid place-items-center">XAU/USD · LONG</p>
              </div>
            </div>
            <div className="lx-mini right-[4%] sm:right-[22%] top-[6%] z-20" style={{ animationDelay: '-5s' }}>
              <div className="relative w-[78px] h-[70px] sm:w-[92px] sm:h-[80px] rounded-2xl bg-white shadow-xl grid place-items-end p-2.5">
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold text-white bg-[#1e1b4b] rounded-md px-1.5 py-0.5">+2.1R</span>
                <div className="flex items-end gap-1 h-full w-full">
                  {[40, 62, 50, 78, 92].map((h, i) => (
                    <span key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: 'linear-gradient(#8b5cf6,#6366f1)' }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="absolute left-1/2 bottom-0 flex items-end gap-4 sm:gap-6 -translate-x-1/2">
              <Phone demo="records" className="hidden sm:block !w-[230px] !h-[468px] translate-y-[60px] -rotate-[4deg]" />
              <Phone demo="analyze" className="!w-[210px] !h-[428px] sm:!w-[230px] sm:!h-[468px] translate-y-[70px] sm:translate-y-[40px]" />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 2. Phone in soft rings + annotation ---------------- */}
      <section className="relative pt-20 pb-24 overflow-hidden">
        <div className="lx-rings">
          <div className="lx-bands" />
          <div className="lx-ring" />
          <div className="lx-ring" />
          <div className="lx-ring" />
        </div>
        <div className="relative z-10 flex justify-center">
          <Phone demo="fundamental" float className="scale-[0.9] sm:scale-100" />
        </div>
        <div data-reveal className="relative z-10 mt-10 px-5 text-center">
          <svg className="lx-curve hidden sm:block absolute left-1/2 -top-[190px] ml-[150px]" width="90" height="200" viewBox="0 0 90 200" fill="none" aria-hidden="true">
            <circle cx="6" cy="6" r="4" fill="#fff" />
            <path d="M6 6 C 80 30, 90 120, 20 196" stroke="#fff" strokeWidth="1.2" />
          </svg>
          <div className="mx-auto w-10 h-10 rounded-full bg-white text-[#0b0b12] grid place-items-center">
            <Target className="w-5 h-5" />
          </div>
          <h2 className="mt-5 text-[26px] sm:text-[38px] font-bold tracking-[-0.03em] leading-tight max-w-2xl mx-auto">
            Get the most accurate plan for your market and check it before you trade
          </h2>
          <p className="mt-3 text-[14px] text-[#9b9cab] max-w-lg mx-auto">Built from live candles: zone, Fibonacci entry, RSI and trend. Already moved? You get No signal.</p>
        </div>
      </section>

      {/* ---------------- 3. Split with stacked colourful pills ---------------- */}
      <section className="px-5 py-20">
        <div className="max-w-6xl mx-auto grid md:grid-cols-[0.9fr_1.1fr] gap-10 items-center">
          <div>
            <p data-reveal className="text-[12px] text-[#9b9cab]">Forex, metals, indices, stocks, coins and memes</p>
            <h2 data-reveal="2" className="mt-3 text-[30px] sm:text-[42px] font-bold tracking-[-0.03em] leading-[1.08]">
              Ask any market,
              <br />
              on any timeframe
            </h2>
            <button data-reveal="3" type="button" onClick={onSignUp} className="lx-btn lx-btn-light mt-7">
              Analyze a market <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <div data-reveal="2" className="relative h-[400px] rounded-[26px] bg-[#111114] overflow-hidden">
            <div className="absolute inset-x-[20%] top-0">
              <div className="lx-pill-col">
                {[...MARKETS, ...MARKETS].map(([m, bg, fg], i) => (
                  <div key={i} className="lx-pill" style={{ background: bg, color: fg }}>
                    {m}
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-[#111114] to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#111114] to-transparent" />
          </div>
        </div>
      </section>

      {/* ---------------- 4. Scrolling list panel ---------------- */}
      <section className="px-5 py-16">
        <div className="max-w-6xl mx-auto grid md:grid-cols-[0.9fr_1.1fr] gap-10 items-center">
          <div>
            <p data-reveal className="text-[12px] text-[#9b9cab]">One prompt away, every day</p>
            <h2 data-reveal="2" className="mt-3 text-[30px] sm:text-[42px] font-bold tracking-[-0.03em] leading-[1.08]">
              Explore every tool
              <br />
              a trader needs
            </h2>
          </div>
          <div data-reveal="2" className="relative h-[360px] rounded-[26px] bg-[#111114] p-3 overflow-hidden">
            <div className="lx-list-col">
              {[...TOOLS, ...TOOLS].map((t, i) => (
                <button key={i} type="button" onClick={onSignUp} className="lx-row" tabIndex={i >= TOOLS.length ? -1 : 0} aria-hidden={i >= TOOLS.length || undefined}>
                  <span className="w-12 h-12 shrink-0 rounded-xl grid place-items-center text-white" style={{ background: t.grad }}>
                    <t.icon className="w-5 h-5" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-semibold text-white">{t.name}</span>
                    <span className="mt-1 flex items-center gap-2">
                      <span className="lx-tag" style={{ background: t.tagBg }}>{t.tag}</span>
                      <span className="text-[11px] text-[#7d7e8c]">{t.meta}</span>
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-[#7d7e8c]" />
                </button>
              ))}
            </div>
            <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-[#111114] to-transparent pointer-events-none" />
            <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#111114] to-transparent pointer-events-none" />
          </div>
        </div>
      </section>

      {/* ---------------- 5. Define your goal ---------------- */}
      <section ref={goalRef} className="px-5 py-28 text-center">
        <p data-reveal className="text-[22px] sm:text-[30px] font-bold tracking-[-0.02em]">Define your goal</p>
        <div className="relative mt-10 h-14">
          <span key={goal} className="lx-badge-in absolute left-1/2 -translate-x-1/2 bottom-0 inline-flex items-center gap-2">
            <span className="w-9 h-9 rounded-full bg-white text-[#0b0b12] grid place-items-center">
              {React.createElement(GOALS[goal][2], { className: 'w-4 h-4' })}
            </span>
            <span className="h-6 px-2.5 rounded-md bg-[#b8f5dc] text-[#0b0b12] text-[11px] font-semibold grid place-items-center whitespace-nowrap">{GOALS[goal][3]}</span>
          </span>
        </div>
        <div className="lx-goals mt-3">
          <div className="lx-goals-in" style={{ transform: `translateY(calc(var(--lx-gh) * ${-goal}))` }}>
            {GOALS.map(([a, b], i) => (
              <p key={a} className={`lx-goal ${i === goal ? 'on' : ''} ${i < goal ? 'past' : ''}`}>
                <b>{a}</b>&nbsp;{b}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- 6. White showcase: choose, rotating clip cards ---------------- */}
      <section id="lx-show" ref={showRef} className="lx-white px-5 py-20 sm:py-24 rounded-[32px] mx-3 sm:mx-5 overflow-hidden">
        <div className="max-w-6xl mx-auto">
          <p data-reveal className="text-[12px] text-[#3b3b4a]">What do you want MarketX to do?</p>
          <h2 data-reveal="2" className="relative mt-2 inline-block text-[36px] sm:text-[52px] font-bold tracking-[-0.035em] leading-[1.02]">
            Choose
            <br />
            your tool
            <span className="lx-sticker absolute -right-16 sm:-right-24 top-[46%] -rotate-[14deg] bg-[#e9d5ff] text-[#6d28d9]">Analyze</span>
            <span className="lx-sticker absolute -right-[118px] sm:-right-[150px] top-[78%] rotate-[2deg] bg-[#67d4f5] text-[#0b3b57]">Matt</span>
          </h2>
          <div className="mt-14 grid md:grid-cols-[1fr_1.1fr] gap-12 items-center">
            <div>
              <div className="flex flex-wrap gap-2.5">
                {SHOWCASE.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pick(i)}
                    aria-label={s.title}
                    aria-pressed={i === active}
                    className={`lx-chip ${i === active ? 'on' : ''}`}
                    style={i === active ? { background: s.tint } : undefined}
                  >
                    <s.icon className="w-[18px] h-[18px]" />
                  </button>
                ))}
              </div>
              <div key={cur.id} className="lx-step mt-7">
                <h3 className="text-[26px] font-bold tracking-[-0.02em]">{cur.title}</h3>
                <p className="mt-3 text-[14.5px] text-[#55556a] leading-relaxed max-w-sm">{cur.text}</p>
                <button type="button" onClick={onSignUp} className="lx-btn mt-6 bg-[#0b0b12] text-white hover:bg-black">
                  Try it <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="relative h-[520px]">
              <div className="lx-clip-ghost -top-10 rotate-[4deg]" />
              <div key={cur.id} className="lx-clip lx-clip-in absolute inset-0">
                {showOn && <DemoClip id={cur.id} />}
              </div>
              <div className="lx-clip-ghost -bottom-12 -rotate-[3deg]" />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 7. Progress ring + two cards ---------------- */}
      <section className="px-5 py-24">
        <div className="max-w-6xl mx-auto">
          <div data-reveal className="relative rounded-[30px] bg-[#111114] py-14 grid place-items-center overflow-hidden">
            <svg width="240" height="240" viewBox="0 0 240 240" className="-rotate-90" aria-hidden="true">
              <circle cx="120" cy="120" r="110" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3" />
              <circle cx="120" cy="120" r="110" fill="none" stroke="url(#lxr)" strokeWidth="3" strokeLinecap="round" className="lx-progress" />
              <defs>
                <linearGradient id="lxr" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0" stopColor="#8ec5fc" />
                  <stop offset="1" stopColor="#e0c3fc" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center">
              <div>
                <div className="flex items-center justify-center gap-2" aria-hidden="true">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#a5b4fc]" />
                  <span className="w-6 h-px bg-[#a5b4fc]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-[#a5b4fc]" />
                  <span className="w-7 h-7 rounded-full bg-[#2a2440] border border-[#a5b4fc] grid place-items-center">
                    <Flame className="w-3.5 h-3.5 text-orange-300" />
                  </span>
                  <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
                  <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
                </div>
                <p className="mt-3 text-[20px] sm:text-[22px] font-bold leading-tight">
                  Track how every
                  <br />
                  trade ends
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4 grid md:grid-cols-2 gap-4">
            <div data-reveal className="relative rounded-[26px] bg-[#111114] p-6 overflow-hidden">
              <div className="h-[200px] relative">
                <div className="absolute left-0 top-2 w-[150px] rounded-2xl bg-[#1d1d24] border border-white/[0.06] p-3">
                  <div className="flex -space-x-1.5">
                    {['#fb923c', '#f472b6', '#a78bfa'].map(c => <span key={c} className="w-5 h-5 rounded-full border-2 border-[#1d1d24]" style={{ background: c }} />)}
                  </div>
                  <p className="mt-2 text-[11px] text-white">Best result</p>
                  <p className="text-[10px] text-[#7d7e8c]">XAU/USD · 1H</p>
                </div>
                <div className="absolute right-0 top-0 text-right">
                  <p className="text-[11px] text-[#7d7e8c]">Win rate</p>
                  <p className="text-[30px] font-semibold">62%</p>
                </div>
                <svg className="absolute inset-x-0 bottom-0" viewBox="0 0 300 90" preserveAspectRatio="none" height="90" width="100%" aria-hidden="true">
                  <path d="M0 70 C 40 70, 60 30, 100 40 S 160 80, 200 40 S 260 10, 300 20" fill="none" stroke="#818cf8" strokeWidth="2.5" />
                  <circle cx="200" cy="40" r="5" fill="#fff" />
                </svg>
                <span className="absolute left-[60%] bottom-[60px] text-[10px] bg-[#2a2a33] rounded-md px-1.5 py-0.5">+2.1R</span>
              </div>
              <p className="mt-4 text-[18px] font-bold text-center">Keep up with your best results</p>
              <p className="mt-1 text-[13px] text-[#7d7e8c] text-center">Journal and track record, scored by price.</p>
              <span className="lx-demo-tag !top-3 !bottom-auto">Demo</span>
            </div>
            <div data-reveal="2" className="relative rounded-[26px] bg-[#111114] p-6 overflow-hidden">
              <div className="h-[200px] relative grid place-items-center">
                <div className="lx-orbit w-[190px] h-[190px]" />
                <div className="lx-orbit w-[260px] h-[260px]" />
                <div className="lx-planet w-20 h-20 -translate-x-10 -translate-y-6" />
                <div className="absolute right-[24%] top-[8%]">
                  <div className="lx-cone" />
                </div>
                <span className="absolute left-[30%] top-[2%] inline-flex items-center gap-1 text-[10px] bg-[#2a2a33] rounded-full pl-1 pr-2 py-0.5">
                  <Flame className="w-3 h-3 text-orange-300" /> Keep it up
                </span>
                <div className="absolute right-[18%] bottom-[2%] w-[86px] h-[86px] rounded-full bg-[#6d3fd0] grid place-items-center text-center shadow-[0_0_40px_rgba(109,63,208,.6)]">
                  <div>
                    <Trophy className="w-4 h-4 mx-auto text-[#fde68a]" />
                    <p className="text-[18px] font-bold leading-none mt-1">Top 10</p>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-[18px] font-bold text-center">Climb the monthly leaderboard</p>
              <p className="mt-1 text-[13px] text-[#7d7e8c] text-center">Points for every analysis, reset on the 1st.</p>
              <span className="lx-demo-tag !top-3 !bottom-auto">Demo</span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 8. Device screens around big gradient "MT5" ---------------- */}
      <section className="relative px-5 py-40 overflow-hidden text-center">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(50% 45% at 50% 55%, rgba(99,102,241,0.2), transparent 70%)' }} />
        <div className="lx-device left-[4%] top-[6%]" style={{ animationDelay: '-2s' }}>
          <p className="flex justify-between text-[9px] text-[#7d7e8c]"><span>Agent</span><span>running</span></p>
          <p className="mt-1.5 text-[13px] font-semibold text-white">Day 2 of 7</p>
          <p className="mt-2 h-7 rounded-full bg-[#2f5bff] text-white text-[11px] font-semibold grid place-items-center">Stop the run</p>
        </div>
        <div className="lx-device right-[5%] top-[4%]" style={{ animationDelay: '-6s' }}>
          <p className="flex justify-between text-[9px] text-[#7d7e8c]"><span>Order placed</span><span>9:55</span></p>
          <p className="mt-1.5 text-[12px] font-semibold text-white">XAUUSD · BUY LIMIT</p>
          <p className="mt-1 text-[22px] font-semibold tabular-nums">0.10 lots</p>
        </div>
        <div className="lx-device hidden sm:block left-[10%] bottom-[8%]" style={{ animationDelay: '-4s' }}>
          <p className="text-[9px] text-[#7d7e8c]">Linking MT5</p>
          <LoaderCircle className="mt-2 w-5 h-5 mx-auto text-[#a5b4fc] animate-spin" />
          <p className="mt-2 text-center text-[11px]">Step 2 of 3</p>
        </div>
        <div className="lx-device hidden sm:block right-[9%] bottom-[10%]" style={{ animationDelay: '-8s' }}>
          <p className="flex justify-between text-[9px] text-[#7d7e8c]"><span>BTCUSD</span><span>closed</span></p>
          <p className="mt-1.5 text-[22px] font-semibold text-emerald-300">+2.1R</p>
          <p className="mt-1 h-6 rounded-full bg-[#2f5bff] text-white text-[10px] font-semibold grid place-items-center">Target reached</p>
        </div>
        <p data-reveal className="relative text-[17px] sm:text-[22px] font-semibold text-[#b9bac6]">The Trading Agent trades on your</p>
        <p data-reveal="2" className="relative mt-1 text-[96px] sm:text-[170px] font-bold tracking-[-0.05em] leading-none lx-grad-text">MT5</p>
        <p data-reveal="3" className="relative mt-4 text-[14px] text-[#9b9cab] max-w-md mx-auto">
          Set your markets, risk and trades a day. It places the order, manages it to the target or the stop, and tells you every step.
        </p>
        <button data-reveal="4" type="button" onClick={onSignUp} className="relative lx-btn lx-btn-blue mt-8">
          Meet the Trading Agent <ArrowRight className="w-4 h-4" />
        </button>
      </section>

      {/* ---------------- 9. Stacked cards carousel ---------------- */}
      <section ref={faqRef} className="px-5 py-24 text-center">
        <p data-reveal className="text-[11px] text-[#9b9cab]">Questions & answers</p>
        <h2 data-reveal="2" className="mt-1 text-[24px] sm:text-[30px] font-bold tracking-[-0.02em]">What traders ask</h2>
        <div className="mt-14 flex items-center justify-center gap-4 sm:gap-10">
          <button type="button" aria-label="Previous" onClick={() => setFaq(f => (f - 1 + FAQ.length) % FAQ.length)} className="lx-nav-round shrink-0">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="lx-stack">
            {FAQ.map((f, i) => {
              const d = (i - faq + FAQ.length) % FAQ.length;
              const style: React.CSSProperties =
                d === 0
                  ? { transform: 'rotate(0deg)', zIndex: 5, opacity: 1 }
                  : d === 1
                    ? { transform: 'translate(10px, -10px) rotate(5deg)', zIndex: 4, opacity: 1 }
                    : d === 2
                      ? { transform: 'translate(-12px, 6px) rotate(-6deg)', zIndex: 3, opacity: 1 }
                      : { transform: 'translateY(40px) rotate(-12deg) scale(0.9)', zIndex: 1, opacity: 0 };
              return (
                <div key={f.q} className="lx-stack-card text-left" style={{ ...style, background: f.bg }} aria-hidden={d !== 0}>
                  <span className="w-9 h-9 rounded-full bg-black/10 grid place-items-center">
                    <MarketXIcon size="sm" />
                  </span>
                  <p className="mt-4 text-[19px] font-bold leading-snug">{f.q}</p>
                  <p className="mt-3 text-[14px] leading-relaxed text-[#26263a]">{f.a}</p>
                </div>
              );
            })}
          </div>
          <button type="button" aria-label="Next" onClick={() => setFaq(f => (f + 1) % FAQ.length)} className="lx-nav-round shrink-0">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* ---------------- 10. Unlock all benefits (pricing) ---------------- */}
      <section className="px-5 py-24">
        <div className="max-w-5xl mx-auto text-center">
          <Lock data-reveal className="w-5 h-5 mx-auto" />
          <h2 data-reveal="2" className="mt-3 text-[26px] sm:text-[32px] font-bold tracking-[-0.02em]">Unlock all benefits</h2>
          <div className="mt-12 grid md:grid-cols-3 gap-6 md:gap-4 items-center text-left">
            <div data-reveal className="px-2">
              <p className="text-[13px] pb-3 border-b border-white/15">Free</p>
              <p className="mt-6 text-[34px] font-bold">$0</p>
              <p className="text-[13px]">3 SI analyses every day</p>
              <p className="mt-2 text-[12px] text-[#7d7e8c]">Price alerts, track record and token safety included.</p>
            </div>
            <div data-reveal="2" className="lx-price-hi p-6">
              <p className="text-[13px] pb-3 border-b border-white/15">Pro · 3 months</p>
              <p className="mt-6 text-[34px] font-bold">
                $30 <span className="text-[11px] font-normal text-[#9b9cab] align-top">per 3 months</span>
              </p>
              <ul className="mt-5 space-y-2 text-[12.5px] text-[#b9bac6]">
                {['10 SI analyses every day', 'Trading Agent on your MT5', 'Fundamental Analysis, Watchlist, Strategy Builder', 'Talk back with Matt'].map(t => (
                  <li key={t} className="flex gap-2">
                    <Flame className="w-3.5 h-3.5 mt-0.5 text-orange-300 shrink-0" /> {t}
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex gap-2">
                <button type="button" onClick={onSignUp} className="lx-btn lx-btn-blue lx-btn-sm flex-1">Get Pro</button>
                <button type="button" onClick={onSignIn} className="lx-btn lx-btn-blue lx-btn-sm flex-1 !bg-[#2a2a33]">Sign in</button>
              </div>
            </div>
            <div data-reveal="3" className="px-2">
              <p className="text-[13px] pb-3 border-b border-white/15">Pro · Yearly</p>
              <p className="mt-6 text-[34px] font-bold">
                $176 <span className="text-[11px] font-normal text-[#9b9cab] align-top line-through">$200</span>
              </p>
              <p className="text-[13px] flex items-center gap-2">
                per year <span className="text-[10px] font-semibold text-[#0b0b12] bg-[#a5b4fc] rounded-full px-2 py-0.5">12% off</span>
              </p>
              <p className="mt-2 text-[12px] text-[#7d7e8c]">Everything in Pro, for 12 months.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- 11. Gradient CTA card ---------------- */}
      <section className="px-3 sm:px-5 pb-10">
        <div data-reveal className="lx-hero-card max-w-6xl mx-auto px-6 sm:px-14 pt-12 sm:pt-16 pb-12 sm:pb-16 text-left">
          <div className="relative z-10 max-w-md">
            <h2 className="text-[34px] sm:text-[50px] font-bold tracking-[-0.035em] leading-[1.02] text-[#1e1b2e]">
              Your trading
              <br />
              co-pilot is ready
            </h2>
            <ul className="mt-5 space-y-1.5 text-[13px] text-[#2b2d42]">
              {['Trade plans from live prices, any market', 'A trading agent on your MT5', 'Every result on Solana'].map(t => (
                <li key={t} className="flex items-center gap-2">
                  <Flame className="w-3.5 h-3.5 text-orange-500" /> {t}
                </li>
              ))}
            </ul>
            <div className="mt-7 flex flex-wrap gap-2.5">
              <button type="button" onClick={onSignUp} className="lx-outline">
                <ArrowRight className="w-4 h-4" /> Create account
              </button>
              <button type="button" onClick={onSignIn} className="lx-outline">
                <UserRound className="w-4 h-4" /> Sign in
              </button>
            </div>
            <span className="lx-underline mt-3 ml-1">Free to start</span>
            <p className="mt-3 text-[11.5px] text-[#3b3354]">Invite-only: we email you a personal pass code to open your account.</p>
          </div>
          <div className="hidden lg:block absolute right-6 top-0 bottom-0 w-[500px] pointer-events-none">
            <Phone demo="matt" className="absolute left-0 top-6 rotate-[16deg] !w-[230px] !h-[468px]" />
            <Phone demo="safety" className="absolute left-[240px] top-20 rotate-[16deg] !w-[210px] !h-[428px]" />
          </div>
        </div>
      </section>

      {/* ---------------- 12. Contact us ---------------- */}
      <section id="lx-contact" className="px-5 py-24">
        <div className="max-w-6xl mx-auto grid md:grid-cols-[1.4fr_1fr] gap-12">
          <div>
            <h2 data-reveal className="text-[34px] sm:text-[46px] font-bold tracking-[-0.03em]">
              Contact{' '}
              <span className="inline-block -rotate-[8deg] rounded-lg px-2.5 text-[#1e1b4b]" style={{ background: 'var(--lx-grad)' }}>
                us
              </span>
            </h2>
            <form data-reveal="2" onSubmit={sendContact} className="mt-8 space-y-6 max-w-lg">
              <label className="block">
                <span className="text-[11px] text-[#9b9cab]">What's your name?</span>
                <input className="lx-field" value={contact.name} onChange={e => setContact(c => ({ ...c, name: e.target.value.slice(0, 80) }))} placeholder="Your name" autoComplete="name" />
              </label>
              <label className="block">
                <span className="text-[11px] text-[#9b9cab]">What's your email?</span>
                <input className="lx-field" type="email" value={contact.email} onChange={e => setContact(c => ({ ...c, email: e.target.value.slice(0, 120) }))} placeholder="name@example.com" autoComplete="email" />
              </label>
              <label className="block">
                <span className="text-[11px] text-[#9b9cab]">How can we help you?</span>
                <textarea className="lx-field resize-none" rows={3} value={contact.message} onChange={e => setContact(c => ({ ...c, message: e.target.value.slice(0, 1500) }))} placeholder="Message" required />
              </label>
              <button type="submit" className="lx-btn lx-btn-blue">
                <Send className="w-4 h-4" /> Send
              </button>
            </form>
          </div>
          <div data-reveal="3" className="space-y-4 text-[13px] text-[#b9bac6] md:pt-24">
            <a href={`mailto:${SUPPORT_EMAIL}`} className="flex items-center gap-3 hover:text-white">
              <Mail className="w-4 h-4" /> {SUPPORT_EMAIL}
            </a>
            <a href="/blog" className="flex items-center gap-3 hover:text-white">
              <BookOpen className="w-4 h-4" /> Read the guide
            </a>
            <div className="flex gap-2 pt-2">
              <a href="https://x.com/_MarketX" target="_blank" rel="noopener noreferrer" aria-label="MarketX on X" className="lx-nav-round"><XLogoIcon className="w-3.5 h-3.5" /></a>
              <a href="/go/telegram" target="_blank" rel="noopener noreferrer" aria-label="MarketX on Telegram" className="lx-nav-round"><TelegramIcon className="w-3.5 h-3.5" /></a>
              <a href="/go/youtube" target="_blank" rel="noopener noreferrer" aria-label="MarketX on YouTube" className="lx-nav-round"><YouTubeIcon className="w-3.5 h-3.5" /></a>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer className="px-5 pb-36 pt-4">
        <div className="max-w-6xl mx-auto grid md:grid-cols-[1.4fr_1fr_1fr] gap-8">
          <div>
            <div className="flex items-center gap-3 rounded-2xl bg-[#16161b] p-3 max-w-sm">
              <span className="w-10 h-10 rounded-xl bg-white/90 grid place-items-center">
                <MarketXIcon size="sm" />
              </span>
              <span className="flex-1 text-[13px] font-medium">Start trading today</span>
              <button type="button" onClick={onSignUp} aria-label="Create account" className="w-8 h-8 rounded-full bg-[#2f5bff] grid place-items-center">
                <ArrowRight className="w-4 h-4" />
              </button>
              <button type="button" onClick={onSignIn} aria-label="Sign in" className="w-8 h-8 rounded-full bg-[#2f5bff] grid place-items-center">
                <UserRound className="w-4 h-4" />
              </button>
            </div>
            <p className="mt-4 text-[11px] text-[#5d5e6b]">© 2026 MarketX, Your Trading Co-Pilot. Built by SpiriTech Labs.</p>
          </div>
          <nav className="flex flex-col gap-2.5 text-[12.5px] text-[#9b9cab]" aria-label="MarketX pages">
            <button type="button" onClick={() => go('lx-show')} className="text-left hover:text-white">Features</button>
            <button type="button" onClick={onSignUp} className="text-left hover:text-white">Trading Agent</button>
            <a href="/checker" className="hover:text-white">ID checker</a>
            <button type="button" onClick={() => go('lx-contact')} className="text-left hover:text-white">Contact us</button>
          </nav>
          <div className="flex flex-col gap-2.5 text-[12.5px] text-[#9b9cab]">
            <a href="/blog" className="hover:text-white">Guide</a>
            {onOpenTerms && (
              <>
                <button type="button" onClick={() => onOpenTerms('terms')} className="text-left hover:text-white">Terms of Service</button>
                <button type="button" onClick={() => onOpenTerms('privacy')} className="text-left hover:text-white">Privacy Policy</button>
              </>
            )}
            <div className="flex gap-2 pt-1">
              <a href="https://x.com/_MarketX" target="_blank" rel="noopener noreferrer" aria-label="MarketX on X" className="lx-nav-round !w-7 !h-7"><XLogoIcon className="w-3 h-3" /></a>
              <a href="/go/telegram" target="_blank" rel="noopener noreferrer" aria-label="MarketX on Telegram" className="lx-nav-round !w-7 !h-7"><TelegramIcon className="w-3 h-3" /></a>
              <a href="/go/youtube" target="_blank" rel="noopener noreferrer" aria-label="MarketX on YouTube" className="lx-nav-round !w-7 !h-7"><YouTubeIcon className="w-3 h-3" /></a>
            </div>
          </div>
        </div>
        <p className="max-w-6xl mx-auto mt-8 text-[11px] text-[#4a4b57] leading-relaxed">
          Trading carries risk. MarketX gives analysis for research and education, not financial advice. Expect losing streaks and keep your risk per trade small.
        </p>
      </footer>

      {/* ---------------- Pill nav (top on the hero, bottom once scrolled) + back-to-top bump ---------------- */}
      <nav className={`lx-nav ${down ? 'down' : ''}`} aria-label="MarketX">
        <a href="/" className="flex items-center gap-1.5 pr-2 mr-1" aria-label="MarketX home">
          <MarketXIcon size="sm" />
          <MarketXText className="text-[14px] hidden sm:inline" />
        </a>
        <button type="button" className="lx-nav-link hidden md:inline-flex" onClick={() => go('lx-show')}>Features</button>
        <button type="button" className="lx-nav-link hidden md:inline-flex" onClick={onSignUp}>Trading Agent</button>
        <a className="lx-nav-link" href="/checker">ID checker</a>
        <a className="lx-nav-link" href="/blog">Guide</a>
        <button type="button" className="lx-nav-link hidden lg:inline-flex" onClick={() => go('lx-contact')}>Contact us</button>
        <button type="button" className="lx-nav-round ml-1" onClick={onSignIn} aria-label="Sign in">
          <UserRound className="w-4 h-4" />
        </button>
        <button type="button" className="lx-btn lx-btn-light lx-btn-sm ml-1" onClick={onSignUp}>Get started</button>
      </nav>
      <button type="button" aria-label="Back to top" className={`lx-up ${down ? 'show' : ''}`} onClick={() => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
        <ArrowUp className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default LandingPage;
