import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, BadgeCheck, Bot, BookOpen, Coins, KeyRound, Landmark, LineChart, Mic, Radar, ShieldCheck, Sparkles, Target } from 'lucide-react';
import { MarketXIcon } from '../components/MarketXIcon';
import { MarketXText } from '../components/MarketXText';
import { DemoClip, useOnScreen, type DemoId } from './demos';
import './landing.css';

// MarketX landing page (owner-specified, Oct 2026): what signed-out visitors see first. Styled on the owner's reference
// (dark product page with a phone in glowing rings, a floating pill nav, highlighted words, a white showcase of sliding
// clips, a progress ring, big gradient text and a gradient call-to-action card). Every app section asks to sign up or
// sign in; the stand-alone public pages (the ID checker and the guide) open directly.

interface LandingProps {
  onSignUp: () => void;
  onSignIn: () => void;
  onHaveCode: () => void;
  notice?: string | null;
}

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

const MARKETS: Array<[string, string]> = [
  ['XAU/USD', '#c4b5fd'],
  ['BTC/USDT', '#a7f3d0'],
  ['NAS100', '#e9ff7a'],
  ['EUR/USD', '#ddd6fe'],
  ['$WIF', '#fbcfe8'],
  ['ETH/USDT', '#a5f3fc'],
  ['GBP/JPY', '#fde68a'],
  ['Volatility 75', '#bbf7d0'],
];

const GOALS = ['Find the trade', 'Let the agent trade it', 'Read the news first', 'Check the token', 'Prove every call'];

const SHOWCASE: Array<{ id: DemoId; icon: React.ElementType; tint: string; title: string; text: string }> = [
  { id: 'analyze', icon: LineChart, tint: '#ede9fe', title: 'Analyze a trade', text: 'Name a market and a timeframe. MarketX reads the live candles and returns the entry, stop loss and three targets, or a clear No signal.' },
  { id: 'matt', icon: Mic, tint: '#dbeafe', title: 'Talk to Matt', text: 'Ask out loud and Matt answers out loud: your account, any MarketX tool, or what a market is doing right now.' },
  { id: 'fundamental', icon: Landmark, tint: '#e0f2fe', title: 'Fundamental Analysis', text: 'CPI, NFP, rate decisions: the most likely outcome with its odds, and the pairs it moves for or against. Recheck it when the figure is out.' },
  { id: 'safety', icon: ShieldCheck, tint: '#dcfce7', title: 'Token safety check', text: 'Before you buy a Solana token, MarketX reads it from the chain: mint and freeze authority, liquidity, top holders, one clear score.' },
  { id: 'records', icon: Sparkles, tint: '#fae8ff', title: 'Records on Solana', text: 'Every signal is sealed on the Solana blockchain when it is issued, and its result is written there once it closes. Anyone can check it.' },
];

export const LandingPage: React.FC<LandingProps> = ({ onSignUp, onSignIn, onHaveCode, notice }) => {
  const scroller = useRef<HTMLDivElement>(null);
  useReveal(scroller);

  // Word cycle (like the reference's "Define your goal" list)
  const [goalRef, goalOn] = useOnScreen<HTMLDivElement>();
  const [goal, setGoal] = useState(0);
  useEffect(() => {
    if (!goalOn) return;
    const t = setInterval(() => setGoal(g => (g + 1) % GOALS.length), 1700);
    return () => clearInterval(t);
  }, [goalOn]);

  // Showcase: cycles through the clips on its own, a chip jumps to one
  const [showRef, showOn] = useOnScreen<HTMLDivElement>();
  const [active, setActive] = useState(0);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (!showOn || hold) return;
    const t = setInterval(() => setActive(a => (a + 1) % SHOWCASE.length), 8500);
    return () => clearInterval(t);
  }, [showOn, hold]);
  const pick = (i: number) => {
    setActive(i);
    setHold(true);
    window.setTimeout(() => setHold(false), 20000);
  };
  const cur = SHOWCASE[active];

  const [checkId, setCheckId] = useState('');
  const openChecker = (e: React.FormEvent) => {
    e.preventDefault();
    const id = checkId.trim();
    window.location.href = id ? `/checker?id=${encodeURIComponent(id)}` : '/checker';
  };
  const go = (id: string) => scroller.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div ref={scroller} className="lx h-[100dvh] w-full overflow-y-auto overflow-x-hidden overscroll-contain select-text">
      {/* ---------------- Hero: phone in glowing rings ---------------- */}
      <section className="relative min-h-[100dvh] flex flex-col items-center pt-[max(28px,env(safe-area-inset-top))] pb-28 overflow-hidden">
        <header className="relative z-10 w-full max-w-6xl px-5 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2" aria-label="MarketX home">
            <MarketXIcon size="sm" />
            <MarketXText className="text-lg" />
          </a>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onSignIn} className="lx-btn lx-btn-ghost lx-btn-sm">
              Sign in
            </button>
            <button type="button" onClick={onSignUp} className="lx-btn lx-btn-light lx-btn-sm hidden sm:inline-flex">
              Create account
            </button>
          </div>
        </header>

        {notice && <p className="relative z-10 mt-4 mx-5 max-w-md text-center text-[13px] text-amber-200 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">{notice}</p>}

        <div className="relative z-10 mt-12 sm:mt-16 px-5 text-center max-w-3xl">
          <span data-reveal className="inline-flex items-center gap-2 h-7 px-3 rounded-full bg-white/[0.05] border border-white/[0.08] text-[12px] text-[#9b9cab]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Live across forex, gold, crypto, indices & stocks
          </span>
          <h1 data-reveal="2" className="mt-5 text-[40px] sm:text-[64px] leading-[1.02] font-bold tracking-[-0.04em]">
            Your trading <span className="lx-grad-text">co-pilot.</span>
          </h1>
          <p data-reveal="3" className="mt-5 text-[16px] sm:text-[18px] text-[#9b9cab] leading-relaxed max-w-xl mx-auto">
            Ask any market and get the trade: entry, stop loss and targets from live prices. Let the agent trade it on MT5, and see every result sealed on Solana.
          </p>
          <div data-reveal="4" className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={onSignUp} className="lx-btn lx-btn-grad">
              Get started <ArrowRight className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => go('lx-show')} className="lx-btn lx-btn-ghost">
              See it in action
            </button>
          </div>
          <button type="button" onClick={onHaveCode} className="mt-4 inline-flex items-center gap-1.5 text-[12px] text-[#a5b4fc] hover:text-white cursor-pointer bg-transparent border-0">
            <KeyRound className="w-3.5 h-3.5" /> I have a pass code
          </button>
        </div>

        <div className="relative mt-14 w-full flex justify-center" style={{ height: 640 }}>
          <div className="lx-rings">
            <div className="lx-glow" />
            <div className="lx-ring" />
            <div className="lx-ring" />
            <div className="lx-ring" />
            <div className="lx-ring" />
          </div>
          <div className="lx-phone relative z-10 scale-[0.86] sm:scale-100 origin-top">
            <div className="lx-phone-screen">
              <div className="lx-phone-notch" />
              <DemoClip id="analyze" compact />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Built from live candles (annotation) ---------------- */}
      <section className="relative px-5 pb-28 text-center">
        <div data-reveal className="mx-auto w-10 h-10 rounded-full bg-white text-[#0b0b12] grid place-items-center">
          <Target className="w-5 h-5" />
        </div>
        <h2 data-reveal="2" className="mt-5 text-[28px] sm:text-[40px] font-bold tracking-[-0.03em] leading-tight max-w-2xl mx-auto">
          Every plan is built from live candles and checked before you see it
        </h2>
        <p data-reveal="3" className="mt-4 text-[15px] text-[#9b9cab] max-w-xl mx-auto">
          Supply and demand zones with a Fibonacci entry, confirmed by RSI and the trend. Already moved or already hit? You get a clear No signal instead.
        </p>
      </section>

      {/* ---------------- Any market (pill column) ---------------- */}
      <section className="px-5 pb-28">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-10 items-center">
          <div>
            <p data-reveal className="text-[13px] text-[#9b9cab]">Forex, metals, indices, stocks, coins and memes</p>
            <h2 data-reveal="2" className="mt-3 text-[32px] sm:text-[46px] font-bold tracking-[-0.035em] leading-[1.05]">
              Ask any market,
              <br />
              on any timeframe
            </h2>
            <p data-reveal="3" className="mt-4 text-[15px] text-[#9b9cab] max-w-md">
              From gold on the 1H to a new Solana meme by its contract address. Or tap RDM and MarketX scans every timeframe for the strongest setup.
            </p>
            <button data-reveal="4" type="button" onClick={onSignUp} className="lx-btn lx-btn-light mt-7">
              Analyze a market <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <div data-reveal="2" className="relative h-[420px] rounded-[28px] bg-[#0c0c12] border border-white/[0.06] overflow-hidden">
            <div className="absolute inset-x-[18%] top-0">
              <div className="lx-pill-col">
                {[...MARKETS, ...MARKETS].map(([m, c], i) => (
                  <div key={i} className="lx-pill" style={{ background: c }}>
                    {m}
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#0c0c12] to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#0c0c12] to-transparent" />
          </div>
        </div>
      </section>

      {/* ---------------- Word cycle ---------------- */}
      <section ref={goalRef} className="px-5 py-24 text-center">
        <p data-reveal className="text-[14px] text-[#9b9cab]">One co-pilot. Everything you need to</p>
        <div className="mt-6 space-y-1">
          {GOALS.map((g, i) => (
            <p key={g} className={`lx-word ${i === goal ? 'on' : ''}`}>
              {g}
            </p>
          ))}
        </div>
      </section>

      {/* ---------------- White showcase: looping clips ---------------- */}
      <section id="lx-show" ref={showRef} className="lx-white px-5 py-24 rounded-t-[36px]">
        <div className="max-w-6xl mx-auto">
          <p data-reveal className="text-[13px] text-[#6b6b7b]">See it in action</p>
          <h2 data-reveal="2" className="mt-2 text-[32px] sm:text-[46px] font-bold tracking-[-0.035em] leading-[1.05]">
            Choose what you
            <br />
            want to do
          </h2>
          <div className="mt-12 grid md:grid-cols-[1fr_1.1fr] gap-10 items-center">
            <div>
              <div className="flex flex-wrap gap-3">
                {SHOWCASE.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pick(i)}
                    aria-label={s.title}
                    aria-pressed={i === active}
                    className={`lx-chip ${i === active ? 'on' : ''}`}
                    style={i === active ? { background: s.tint, color: '#3b2a8a' } : undefined}
                  >
                    <s.icon className="w-5 h-5" />
                  </button>
                ))}
              </div>
              <div key={cur.id} className="lx-step mt-8">
                <h3 className="text-[26px] font-bold tracking-[-0.02em]">{cur.title}</h3>
                <p className="mt-3 text-[15px] text-[#55556a] leading-relaxed max-w-md">{cur.text}</p>
                <button type="button" onClick={onSignUp} className="lx-btn mt-6 bg-[#0b0b12] text-white hover:bg-black">
                  Try it <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-8 flex gap-1.5" aria-hidden="true">
                {SHOWCASE.map((s, i) => (
                  <span key={s.id} className="h-1 rounded-full transition-all" style={{ width: i === active ? 28 : 10, background: i === active ? '#8b5cf6' : '#d9d9e3' }} />
                ))}
              </div>
            </div>
            <div className="relative h-[520px]">
              <div className="lx-clip-ghost -top-4 rotate-[3deg]" />
              <div key={cur.id} className="lx-clip lx-clip-in absolute inset-0 border border-black/5">
                {showOn && <DemoClip id={cur.id} />}
              </div>
              <div className="lx-clip-ghost -bottom-6 -rotate-[2deg]" />
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Track every result (progress ring) ---------------- */}
      <section className="px-5 py-24 bg-[#050507]">
        <div className="max-w-6xl mx-auto">
          <div data-reveal className="relative rounded-[32px] bg-[#0c0c12] border border-white/[0.06] py-16 grid place-items-center overflow-hidden">
            <svg width="240" height="240" viewBox="0 0 240 240" className="-rotate-90" aria-hidden="true">
              <circle cx="120" cy="120" r="110" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
              <circle cx="120" cy="120" r="110" fill="none" stroke="url(#lxr)" strokeWidth="4" strokeLinecap="round" className="lx-progress" />
              <defs>
                <linearGradient id="lxr" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0" stopColor="#93c5fd" />
                  <stop offset="1" stopColor="#a78bfa" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 grid place-items-center text-center px-6">
              <div>
                <Radar className="mx-auto w-5 h-5 text-violet-300" />
                <p className="mt-2 text-[22px] sm:text-[26px] font-bold leading-tight">
                  Track every
                  <br />
                  result
                </p>
              </div>
            </div>
          </div>
          <div className="mt-5 grid md:grid-cols-2 gap-5">
            <div data-reveal className="rounded-[28px] bg-[#0c0c12] border border-white/[0.06] p-6">
              <p className="text-[13px] text-[#9b9cab]">Price alerts, journal and track record</p>
              <div className="mt-4 h-28 flex items-end gap-1.5">
                {[30, 42, 38, 55, 48, 62, 58, 70, 66, 78, 74, 86].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%`, background: i > 8 ? 'linear-gradient(#a78bfa,#6366f1)' : 'rgba(255,255,255,0.08)' }} />
                ))}
              </div>
              <p className="mt-5 text-[19px] font-bold">Every alert followed to its target or its stop</p>
              <p className="mt-1.5 text-[14px] text-[#9b9cab]">Wins, losses and R scored by price, not by opinion, in your journal and your public track record.</p>
            </div>
            <div data-reveal="2" className="rounded-[28px] bg-[#0c0c12] border border-white/[0.06] p-6">
              <p className="text-[13px] text-[#9b9cab]">Check any trader</p>
              <form onSubmit={openChecker} className="mt-4 flex gap-2">
                <input
                  value={checkId}
                  onChange={e => setCheckId(e.target.value.slice(0, 64))}
                  placeholder="Paste a MarketX ID"
                  aria-label="MarketX ID"
                  className="min-w-0 flex-1 h-11 rounded-xl bg-white/[0.05] border border-white/[0.08] px-3.5 text-[14px] text-white placeholder:text-[#5d5e6b] outline-none focus:border-violet-400/50"
                />
                <button type="submit" className="lx-btn lx-btn-light h-11">
                  Check
                </button>
              </form>
              <p className="mt-5 text-[19px] font-bold flex items-center gap-2">
                <BadgeCheck className="w-5 h-5 text-violet-300" /> The ID checker
              </p>
              <p className="mt-1.5 text-[14px] text-[#9b9cab]">Every MarketX trader has an ID on Solana. Open it to see their track record, signal by signal, with the proof on chain.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Trading agent on MT5 (big gradient text) ---------------- */}
      <section className="relative px-5 py-32 overflow-hidden text-center">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(60% 50% at 50% 55%, rgba(139,92,246,0.18), transparent 70%)' }} />
        <div className="hidden md:block">
          <div className="lx-float-card left-[7%] top-[18%] rounded-2xl bg-[#101018] border border-white/[0.08] px-4 py-3 text-left text-[12px]" style={{ animationDelay: '-2s' }}>
            <p className="text-[#9b9cab]">Order placed</p>
            <p className="mt-1 font-semibold">BUY LIMIT XAUUSD · 0.10 lots</p>
          </div>
          <div className="lx-float-card right-[8%] top-[24%] rounded-2xl bg-[#101018] border border-white/[0.08] px-4 py-3 text-left text-[12px]" style={{ animationDelay: '-5s' }}>
            <p className="text-[#9b9cab]">Order filled</p>
            <p className="mt-1 font-semibold text-emerald-300">BTCUSD · stop and target set</p>
          </div>
          <div className="lx-float-card left-[12%] bottom-[16%] rounded-2xl bg-[#101018] border border-white/[0.08] px-4 py-3 text-left text-[12px]" style={{ animationDelay: '-1s' }}>
            <p className="text-[#9b9cab]">Target reached</p>
            <p className="mt-1 font-semibold text-emerald-300">+2.1R · +1.05% of the account</p>
          </div>
          <div className="lx-float-card right-[11%] bottom-[14%] rounded-2xl bg-[#101018] border border-white/[0.08] px-4 py-3 text-left text-[12px]" style={{ animationDelay: '-3.5s' }}>
            <p className="text-[#9b9cab]">Risk per trade</p>
            <p className="mt-1 font-semibold">0.5% · up to 2 trades a day</p>
          </div>
        </div>
        <p data-reveal className="relative text-[18px] sm:text-[22px] font-semibold text-[#c9c9d6]">
          <Bot className="inline w-5 h-5 mr-1.5 -mt-1" /> The Trading Agent works with
        </p>
        <p data-reveal="2" className="relative mt-2 text-[72px] sm:text-[140px] font-black tracking-[-0.06em] leading-none lx-grad-text">
          MT5
        </p>
        <p data-reveal="3" className="relative mt-6 text-[15px] text-[#9b9cab] max-w-lg mx-auto">
          Set your markets, risk per trade, trades a day and a profit target. The agent finds the setup, places the order on your MT5, manages it to the target or the stop, and tells you every step.
        </p>
        <button data-reveal="4" type="button" onClick={onSignUp} className="relative lx-btn lx-btn-grad mt-8">
          Meet the Trading Agent <ArrowRight className="w-4 h-4" />
        </button>
      </section>

      {/* ---------------- Gradient CTA card ---------------- */}
      <section className="px-5 pb-36">
        <div
          data-reveal
          className="relative max-w-6xl mx-auto rounded-[36px] overflow-hidden px-6 sm:px-14 py-14 sm:py-20 text-[#0b0b12]"
          style={{ background: 'linear-gradient(120deg, #a5c8ff 0%, #c4b5fd 55%, #e9d5ff 100%)' }}
        >
          <div className="relative z-10 max-w-lg">
            <h2 className="text-[34px] sm:text-[52px] font-bold tracking-[-0.04em] leading-[1.02]">Your trading co-pilot is ready</h2>
            <ul className="mt-6 space-y-2 text-[14.5px] text-[#2a2440]">
              {[
                [LineChart, 'Trade plans from live prices, any market'],
                [Bot, 'A trading agent on your MT5'],
                [Coins, 'Free to start: analyses every day'],
              ].map(([I, t]: any) => (
                <li key={t} className="flex items-center gap-2.5">
                  <I className="w-4 h-4 text-[#5b21b6]" /> {t}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <button type="button" onClick={onSignUp} className="lx-btn bg-[#0b0b12] text-white hover:bg-black">
                Create account <ArrowRight className="w-4 h-4" />
              </button>
              <button type="button" onClick={onSignIn} className="lx-btn bg-white/60 text-[#0b0b12] hover:bg-white/80">
                Sign in
              </button>
            </div>
            <p className="mt-4 text-[12px] text-[#3b3354]">MarketX is invite-only: we email you a personal pass code to open your account.</p>
          </div>
          <div className="hidden lg:block absolute right-10 top-10 bottom-[-90px] w-[300px]">
            <div className="lx-phone" style={{ animationDelay: '-3s' }}>
              <div className="lx-phone-screen">
                <div className="lx-phone-notch" />
                <DemoClip id="matt" compact />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Footer ---------------- */}
      <footer className="px-5 pb-32 border-t border-white/[0.06] pt-10">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row gap-6 sm:items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <MarketXIcon size="sm" />
              <MarketXText className="text-base" />
            </div>
            <p className="mt-2 text-[12px] text-[#5d5e6b]">Your Trading Co-Pilot · Built by SpiriTech Labs</p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-[#9b9cab]" aria-label="MarketX pages">
            <a href="/blog" className="hover:text-white inline-flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5" /> Guide
            </a>
            <a href="/checker" className="hover:text-white">ID checker</a>
            <a href="https://x.com/_MarketX" target="_blank" rel="noopener noreferrer" className="hover:text-white">X</a>
            <a href="/go/telegram" target="_blank" rel="noopener noreferrer" className="hover:text-white">Telegram</a>
            <a href="/go/youtube" target="_blank" rel="noopener noreferrer" className="hover:text-white">YouTube</a>
          </nav>
        </div>
        <p className="max-w-6xl mx-auto mt-6 text-[11px] text-[#4a4b57] leading-relaxed">
          Trading carries risk. MarketX gives analysis for research and education, not financial advice. Expect losing streaks and keep your risk per trade small.
        </p>
      </footer>

      {/* ---------------- Floating pill nav ---------------- */}
      <nav className="lx-nav" aria-label="MarketX">
        <span className="hidden sm:flex items-center gap-1.5 pr-2 mr-1 border-r border-white/[0.08]">
          <MarketXIcon size="sm" />
        </span>
        <button type="button" className="lx-nav-link hidden md:inline-flex" onClick={() => go('lx-show')}>
          Features
        </button>
        <button type="button" className="lx-nav-link hidden md:inline-flex" onClick={onSignUp}>
          Trading Agent
        </button>
        <a className="lx-nav-link" href="/checker">
          ID checker
        </a>
        <a className="lx-nav-link" href="/blog">
          Guide
        </a>
        <button type="button" className="lx-btn lx-btn-light lx-btn-sm ml-1" onClick={onSignUp}>
          Get started
        </button>
      </nav>
    </div>
  );
};

export default LandingPage;
