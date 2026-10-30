import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, ArrowUp, Bot, BookOpen, ChartLine, ChevronLeft, ChevronRight, Flame, KeyRound, Landmark, LoaderCircle, Lock, Mail, Mic, Send,
  ShieldCheck, Sparkles, Target, Trophy, UserRound,
} from 'lucide-react';
import { MarketXIcon } from '../components/MarketXIcon';
import { MarketXText } from '../components/MarketXText';
import { TelegramIcon, XLogoIcon, YouTubeIcon } from '../components/SocialIcons';
import { formatMarketPrice } from '../utils/formatPrice';
import type { MarketQuote } from '../types';
import { DemoClip, type DemoId } from './demos';
import { ease, lerp, seg, useEnter, useScene } from './scenes';
import './landing.css';

// MarketX landing page (owner-specified, Oct 2026): what signed-out visitors see first, built on the owner's reference video
// with its scroll-driven motion: each scene pins to the screen while the scroll plays it (the hero card slides away and the
// phone stays and lands in the rings, the market pills fly in as a deck, fan out, scroll and turn into live price rows, the
// goal list steps, clip cards rotate through the white showcase, the ring draws then splits into two cards, device screens
// rise around a big "MT5", the Q&A deck turns, the Pro card opens and closes, and the CTA card grows in). Prices are the same
// live feed as the signed-in home page; only real quotes are shown. Every app section asks to sign up or sign in; the ID
// checker and the guide open directly. Demo clips are animated replicas with example numbers.

interface LandingProps {
  onSignUp: () => void;
  onSignIn: () => void;
  onHaveCode: () => void;
  onOpenTerms?: (tab: 'terms' | 'privacy') => void;
  /** The live price feed shared with the home page */
  tickers?: MarketQuote[];
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

const css = (el: HTMLElement | SVGElement | null | undefined, s: Partial<CSSStyleDeclaration>) => {
  if (el) Object.assign(el.style, s);
};

// ---------------- Live prices (the home page feed, real quotes only) ----------------
const FEATURED: Array<{ symbol: string; label: string; color: string; ink: string }> = [
  { symbol: 'XAU/USD', label: 'Gold', color: '#3b4cf0', ink: '#fff' },
  { symbol: 'BTC/USDT', label: 'Bitcoin', color: '#eef542', ink: '#0b0b12' },
  { symbol: 'EUR/USD', label: 'Euro / Dollar', color: '#ffffff', ink: '#0b0b12' },
  { symbol: 'ETH/USDT', label: 'Ethereum', color: '#c9b8f5', ink: '#0b0b12' },
  { symbol: 'GBP/JPY', label: 'Pound / Yen', color: '#b8f5dc', ink: '#0b0b12' },
  { symbol: 'NVDA', label: 'Nvidia', color: '#6d3fd0', ink: '#fff' },
  { symbol: 'SOL/USDT', label: 'Solana', color: '#fbd0dc', ink: '#0b0b12' },
  { symbol: 'USD/JPY', label: 'Dollar / Yen', color: '#67d4f5', ink: '#0b0b12' },
];
const SPARE_COLORS = ['#fde68a', '#a7f3d0', '#c4b5fd', '#fecaca'];

const isReal = (t?: MarketQuote) => !!t && t.price > 0 && (t.asOf || 0) > 0;

/** The featured markets that have a real quote; a missing one is swapped for another live market */
function useLiveMarkets(tickers: MarketQuote[] = []) {
  return useMemo(() => {
    const by = new Map(tickers.filter(isReal).map(t => [t.symbol, t]));
    const used = new Set<string>();
    const rows = FEATURED.map(f => {
      const t = by.get(f.symbol);
      if (t) used.add(f.symbol);
      return { ...f, quote: t };
    });
    const spare = tickers.filter(t => isReal(t) && !used.has(t.symbol) && !FEATURED.some(f => f.symbol === t.symbol));
    let s = 0;
    return rows.map((r, i) =>
      r.quote || !spare[s] ? r : { symbol: spare[s].symbol, label: spare[s].name || spare[s].symbol, color: SPARE_COLORS[i % 4], ink: '#0b0b12', quote: spare[s++] }
    );
  }, [tickers]);
}

/** A price that flashes green or red when it ticks */
const LivePrice: React.FC<{ price: number; className?: string }> = ({ price, className = '' }) => {
  const prev = useRef(price);
  const [dir, setDir] = useState(0);
  useEffect(() => {
    if (price === prev.current) return;
    setDir(price > prev.current ? 1 : -1);
    prev.current = price;
    const t = setTimeout(() => setDir(0), 800);
    return () => clearTimeout(t);
  }, [price]);
  return <span className={`tabular-nums transition-colors duration-500 ${dir > 0 ? 'text-emerald-300' : dir < 0 ? 'text-rose-300' : ''} ${className}`}>{formatMarketPrice(price)}</span>;
};

const Change: React.FC<{ v: number; className?: string }> = ({ v, className = '' }) => (
  <span className={`tabular-nums ${v >= 0 ? 'text-emerald-400' : 'text-rose-400'} ${className}`}>
    {v >= 0 ? '+' : ''}
    {(Number(v) || 0).toFixed(2)}%
  </span>
);

// ---------------- Content ----------------
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

// Device screens around "MT5": x (% of width), where they start below the screen and how fast they rise
const DEVICES: Array<{ x: number; base: number; speed: number; el: React.ReactNode; hideSm?: boolean }> = [
  { x: 3, base: 0.75, speed: 1.35, el: (<><p className="flex justify-between text-[9px] text-[#6b6b7b]"><span>Agent</span><span>running</span></p><p className="mt-1.5 text-[13px] font-semibold text-[#0b0b12]">Day 2 of 7</p><p className="mt-2 h-7 rounded-full bg-[#2f5bff] text-white text-[11px] font-semibold grid place-items-center">Stop the run</p></>) },
  { x: 76, base: 0.62, speed: 1.2, el: (<><p className="flex justify-between text-[9px] text-[#6b6b7b]"><span>Order placed</span><span>9:55</span></p><p className="mt-1.5 text-[12px] font-semibold text-[#0b0b12]">XAUUSD · BUY LIMIT</p><p className="mt-1 text-[22px] font-semibold tabular-nums">0.10 lots</p></>) },
  { x: 24, base: 1.05, speed: 1.6, hideSm: true, el: (<><p className="text-[9px] text-[#6b6b7b]">Linking MT5</p><LoaderCircle className="mt-2 w-5 h-5 mx-auto text-violet-500 animate-spin" /><p className="mt-2 text-center text-[11px]">Step 2 of 3</p></>) },
  { x: 12, base: 1.25, speed: 1.55, el: (<><p className="flex justify-between text-[9px] text-[#6b6b7b]"><span>BTCUSD</span><span>closed</span></p><p className="mt-1.5 text-[22px] font-semibold text-emerald-600">+2.1R</p><p className="mt-1 h-6 rounded-full bg-[#2f5bff] text-white text-[10px] font-semibold grid place-items-center">Target reached</p></>) },
  { x: 86, base: 1.15, speed: 1.6, el: (<><p className="text-[9px] text-[#6b6b7b]">Risk per trade</p><p className="mt-1.5 text-[24px] font-semibold">0.5%</p><p className="text-[10px] text-[#6b6b7b]">2 trades a day</p></>) },
  { x: 64, base: 1.4, speed: 1.7, hideSm: true, el: (<><p className="text-[9px] text-[#6b6b7b]">Trades</p><p className="mt-1.5 text-[24px] font-semibold tabular-nums">−&nbsp;1/2&nbsp;+</p><p className="mt-1 h-6 rounded-full bg-[#2f5bff] text-white text-[10px] font-semibold grid place-items-center">Preview</p></>) },
];

const Phone = React.forwardRef<HTMLDivElement, { demo: DemoId; className?: string; style?: React.CSSProperties }>(({ demo, className = '', style }, ref) => (
  <div ref={ref} className={`lx-phone ${className}`} style={style}>
    <div className="lx-phone-screen">
      <div className="lx-phone-notch" />
      <DemoClip id={demo} compact />
    </div>
  </div>
));
Phone.displayName = 'Phone';

export const LandingPage: React.FC<LandingProps> = ({ onSignUp, onSignIn, onHaveCode, onOpenTerms, tickers }) => {
  const scroller = useRef<HTMLDivElement>(null);
  useReveal(scroller);
  const markets = useLiveMarkets(tickers);
  const liveCount = markets.filter(m => m.quote).length;

  // Nav at the top on the hero, at the bottom once scrolled (and the back-to-top bump shows)
  const [down, setDown] = useState(false);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = () => setDown(el.scrollTop > 140);
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);
  const go = (id: string) => scroller.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // ---------- Scene 1: hero card slides away, the phone stays and lands in the rings, then the annotation ----------
  const s1 = useRef<HTMLDivElement>(null);
  const s1card = useRef<HTMLDivElement>(null);
  const s1phone = useRef<HTMLDivElement>(null);
  const s1rings = useRef<HTMLDivElement>(null);
  const s1note = useRef<HTMLDivElement>(null);
  const s1curve = useRef<SVGSVGElement>(null);
  const s1path = useRef<SVGPathElement>(null);
  useScene(s1, scroller, (p, vh, vw) => {
    const mobile = vw < 640;
    const s = Math.min(mobile ? 0.8 : 1, (vh * (mobile ? 0.62 : 0.72)) / 610);
    const H = 610 * s;
    const a = ease(seg(p, 0.04, 0.34));
    const b = seg(p, 0.22, 0.48);
    const c = ease(seg(p, 0.56, 0.92));
    const y0 = Math.max(vh * (mobile ? 0.6 : 0.52), mobile ? 380 : 430);
    const y1 = (vh - H) / 2;
    const y2 = y1 - vh * (mobile ? 0.36 : 0.44);
    const y = c > 0 ? lerp(y1, y2, c) : lerp(y0, y1, a);
    css(s1card.current, { transform: `translate3d(0, ${-a * (vh + 60)}px, 0)` });
    css(s1phone.current, { transform: `translate3d(-50%, ${y}px, 0) scale(${s})` });
    css(s1rings.current, { opacity: String(b), transform: `scale(${0.85 + 0.15 * b})` });
    css(s1note.current, { top: `${y2 + H + (mobile ? 22 : 34)}px`, opacity: String(c), transform: `translateY(${(1 - c) * 50}px)` });
    css(s1curve.current, { left: `calc(50% + ${150 * s - 8}px)`, top: `${y2 + H - 80}px`, opacity: String(c) });
    css(s1path.current, { strokeDashoffset: String(400 * (1 - seg(p, 0.7, 0.97))) });
  });

  // ---------- Scene 2: market pills fly in as a deck, fan out, scroll, then turn into live price rows ----------
  const ROW = 66;
  const s2 = useRef<HTMLDivElement>(null);
  const s2panel = useRef<HTMLDivElement>(null);
  const s2bg = useRef<HTMLDivElement>(null);
  const s2track = useRef<HTMLDivElement>(null);
  const s2t1 = useRef<HTMLDivElement>(null);
  const s2t2 = useRef<HTMLDivElement>(null);
  const pillRefs = useRef<Array<HTMLDivElement | null>>([]);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  useScene(s2, scroller, p => {
    const panelH = s2panel.current?.clientHeight || 440;
    const n = FEATURED.length;
    const a = ease(seg(p, 0.02, 0.2));
    const b = ease(seg(p, 0.24, 0.42));
    const c = ease(seg(p, 0.44, 0.58));
    const d = ease(seg(p, 0.6, 0.76));
    const e = ease(seg(p, 0.8, 0.97));
    const maxScroll = Math.max(0, n * ROW - panelH + 24);
    css(s2track.current, { transform: `translate3d(0, ${-maxScroll * (0.5 * c + 0.5 * e)}px, 0)` });
    css(s2bg.current, { opacity: String(seg(p, 0.08, 0.24)) });
    css(s2t1.current, { opacity: String(1 - d), transform: `translateY(${-d * 24}px)` });
    css(s2t2.current, { opacity: String(d), transform: `translateY(${(1 - d) * 24}px)` });
    const stackTop = panelH / 2 - 27;
    for (let i = 0; i < n; i++) {
      const pill = pillRefs.current[i];
      const row = rowRefs.current[i];
      const stackDy = stackTop + i * 7 - i * ROW;
      const dy = stackDy * (1 - b) + (1 - a) * -170;
      const dx = (1 - a) * 220 - d * 70;
      const rot = (1 - a) * -30 - (1 - b) * (8 - i * 1.2);
      css(pill, {
        transform: `translate3d(${dx}px, ${dy}px, 0) rotate(${rot}deg) scale(${(0.6 + 0.4 * a) * (1 - 0.45 * d)})`,
        opacity: String(a * (1 - d)),
        zIndex: String(n - i),
      });
      css(row, { opacity: String(d), transform: `translateY(${(1 - d) * 10}px)` });
    }
  });

  // ---------- Scene 3: "Define your goal" then the list steps with the scroll ----------
  const s3 = useRef<HTMLDivElement>(null);
  const s3head = useRef<HTMLDivElement>(null);
  const s3list = useRef<HTMLDivElement>(null);
  const s3badge = useRef<HTMLDivElement>(null);
  const [goal, setGoal] = useState(0);
  useScene(s3, scroller, p => {
    const a = ease(seg(p, 0.06, 0.18));
    css(s3head.current, { opacity: String(1 - a), transform: `translateY(${-a * 90}px) scale(${1 - a * 0.1})` });
    css(s3list.current, { opacity: String(a) });
    css(s3badge.current, { opacity: String(a), transform: `translateY(${(1 - a) * 220}px)` });
    setGoal(Math.min(GOALS.length - 1, Math.floor(seg(p, 0.18, 0.96) * GOALS.length)));
  });

  // ---------- Scene 4: white showcase, stickers fly in, clip cards rotate through ----------
  const s4 = useRef<HTMLDivElement>(null);
  const s4head = useRef<HTMLDivElement>(null);
  const s4info = useRef<HTMLDivElement>(null);
  const s4dark = useRef<HTMLDivElement>(null);
  const stickA = useRef<HTMLSpanElement>(null);
  const stickB = useRef<HTMLSpanElement>(null);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [shown, setShown] = useState(0);
  useScene(s4, scroller, (p, _vh, vw) => {
    const st = ease(seg(p, 0, 0.08));
    css(stickA.current, { opacity: String(st), transform: `translate(${(1 - st) * 70}px, ${(1 - st) * -40}px) rotate(${lerp(40, -14, st)}deg)` });
    css(stickB.current, { opacity: String(seg(p, 0.03, 0.1)), transform: `translate(${(1 - st) * 90}px, ${(1 - st) * 30}px) rotate(${lerp(-30, 3, st)}deg)` });
    const h = ease(seg(p, 0.1, 0.2));
    css(s4head.current, { opacity: String(1 - h * 0.85), transform: `translateY(${-h * 150}px)` });
    css(s4head.current?.parentElement, { opacity: String(1 - seg(p, 0.16, 0.22)) });
    const info = ease(seg(p, 0.17, 0.25));
    css(s4info.current, { opacity: String(info), transform: `translateY(${(1 - info) * 40}px)` });
    // u: -1 (first card still below) → N-1, holding on each card before moving to the next
    const n = SHOWCASE.length;
    const u = seg(p, 0.13, 0.95) * n - 1;
    const k = Math.floor(u);
    const ue = Math.min(n - 1, k + ease(seg(u - k, 0.45, 1)));
    for (let i = 0; i < n; i++) {
      const el = cardRefs.current[i];
      const rel = i - ue;
      const H = el?.offsetHeight || 500;
      css(el, {
        transform: `translate3d(${rel * 18}px, ${rel * H * 1.08}px, 0) rotate(${rel * 7}deg)`,
        // On phones the card leaving upwards would cross the text above it, so it fades out as it goes
        opacity: String(Math.abs(rel) >= 1.6 ? 0 : vw < 768 && rel < 0 ? Math.max(0, 1 + rel * 2.2) : 1),
      });
    }
    setShown(Math.max(0, Math.min(n - 1, Math.round(ue))));
    css(s4dark.current, { opacity: String(seg(p, 0.95, 1)) });
  });

  // ---------- Scene 5: ring draws, then splits into two cards ----------
  const s5 = useRef<HTMLDivElement>(null);
  const s5panel = useRef<HTMLDivElement>(null);
  const s5ring = useRef<SVGCircleElement>(null);
  const s5cards = useRef<HTMLDivElement>(null);
  const [ringStep, setRingStep] = useState(0);
  useScene(s5, scroller, (p, vh) => {
    const a = ease(seg(p, 0, 0.12));
    const r = seg(p, 0.1, 0.55);
    const b = ease(seg(p, 0.6, 0.88));
    css(s5panel.current, { opacity: String(a * (1 - b)), transform: `scale(${(0.92 + 0.08 * a) * (1 - 0.4 * b)})` });
    css(s5ring.current, { strokeDashoffset: String(690 * (1 - 0.86 * r)) });
    css(s5cards.current, { opacity: String(b), transform: `translateY(${(1 - b) * vh * 0.6}px)` });
    setRingStep(Math.min(4, Math.floor(r * 5)));
  });

  // ---------- Scene 6: device screens rise at their own speeds around "MT5" ----------
  const s6 = useRef<HTMLDivElement>(null);
  const s6text = useRef<HTMLDivElement>(null);
  const devRefs = useRef<Array<HTMLDivElement | null>>([]);
  useScene(s6, scroller, (p, vh, vw) => {
    const o = ease(seg(p, 0.12, 0.32)) * (1 - seg(p, 0.9, 1));
    // Phones: the screens pass behind the text, so they dim while it shows
    const dim = vw < 640 ? String(1 - 0.75 * o) : '1';
    DEVICES.forEach((d, i) => css(devRefs.current[i], { transform: `translate3d(0, ${(d.base - p * d.speed) * vh}px, 0)`, opacity: dim }));
    css(s6text.current, { opacity: String(o), transform: `translateY(-50%) scale(${0.9 + 0.1 * o})` });
  });

  // ---------- Scene 7: Q&A deck rises in and turns with the scroll ----------
  const s7 = useRef<HTMLDivElement>(null);
  const s7deck = useRef<HTMLDivElement>(null);
  const s7head = useRef<HTMLDivElement>(null);
  const [faqScroll, setFaqScroll] = useState(0);
  const [faqNudge, setFaqNudge] = useState(0);
  useScene(s7, scroller, (p, vh) => {
    const a = ease(seg(p, 0, 0.25));
    css(s7head.current, { opacity: String(seg(p, 0, 0.15)) });
    css(s7deck.current, { opacity: String(a), transform: `translateY(${(1 - a) * vh * 0.45}px) rotate(${(1 - a) * 16}deg)` });
    setFaqScroll(Math.min(FAQ.length - 1, Math.floor(seg(p, 0.3, 0.98) * FAQ.length)));
  });
  const faq = (((faqScroll + faqNudge) % FAQ.length) + FAQ.length) % FAQ.length;

  // ---------- Scene 8: the Pro card opens, then closes as you leave ----------
  const s8 = useRef<HTMLDivElement>(null);
  const s8wrap = useRef<HTMLDivElement>(null);
  const s8bg = useRef<HTMLDivElement>(null);
  const s8more = useRef<HTMLDivElement>(null);
  const s8card = useRef<HTMLDivElement>(null);
  useScene(s8, scroller, p => {
    const e = ease(seg(p, 0.12, 0.34)) * (1 - ease(seg(p, 0.76, 0.96)));
    css(s8wrap.current, { opacity: String(0.35 + 0.65 * seg(p, 0, 0.1)) });
    css(s8bg.current, { opacity: String(e) });
    css(s8more.current, { maxHeight: `${e * 240}px`, opacity: String(e) });
    css(s8card.current, { transform: `scale(${0.97 + 0.03 * e})` });
  });

  // ---------- CTA card grows in ----------
  const s9 = useRef<HTMLDivElement>(null);
  const s9phones = useRef<HTMLDivElement>(null);
  useEnter(s9, scroller, p => {
    const e = ease(p);
    css(s9.current, { transform: `translateY(${(1 - e) * 60}px) scale(${0.88 + 0.12 * e})`, opacity: String(0.3 + 0.7 * e) });
    css(s9phones.current, { transform: `translateX(${(1 - e) * 160}px) rotate(${(1 - e) * 10}deg)` });
  });

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

  const heroChips = markets.filter(m => m.quote).slice(0, 3);

  return (
    <div ref={scroller} className="lx h-[100dvh] w-full overflow-y-auto overflow-x-hidden overscroll-contain select-text">
      {/* ================= Scene 1: hero card → phone in rings → annotation ================= */}
      <section ref={s1} className="lx-scene" style={{ height: '340vh' }}>
        <div className="lx-stage">
          <div ref={s1rings} className="lx-rings" style={{ opacity: 0 }}>
            <div className="lx-bands" />
            <div className="lx-ring" />
            <div className="lx-ring" />
            <div className="lx-ring" />
          </div>

          <div ref={s1card} className="lx-hero-card absolute left-3 right-3 sm:left-5 sm:right-5 top-[max(72px,calc(env(safe-area-inset-top)+62px))] bottom-4 max-w-6xl mx-auto text-center will-change-transform">
            <h1 className="relative z-10 mt-10 sm:mt-14 px-5 text-[36px] sm:text-[62px] font-bold tracking-[-0.035em] leading-[1.02] text-[#2b2d42]">
              Your trading <span className="whitespace-nowrap">co-pilot</span>
            </h1>
            <div className="relative z-10 mt-3">
              <span className="lx-underline">Free to start</span>
            </div>
            <div className="relative z-10 mt-5 flex flex-wrap justify-center gap-2.5 px-5">
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
            {/* Live prices, right on the hero */}
            <div className="relative z-10 mt-4 flex flex-wrap justify-center gap-1.5 sm:gap-2 px-3 min-h-[30px]" aria-live="off">
              {heroChips.length ? (
                heroChips.map((m, i) => (
                  <span key={m.symbol} className={`lx-live-chip ${i === 2 ? 'lx-sm-hide' : ''}`}>
                    <span className="lx-live-dot" />
                    <b>{m.label}</b>
                    <LivePrice price={m.quote!.price} />
                    <Change v={m.quote!.change24h} className="!text-[11px]" />
                  </span>
                ))
              ) : (
                <span className="lx-live-chip opacity-70">
                  <span className="lx-live-dot" /> Connecting to live prices…
                </span>
              )}
            </div>

            <div className="lx-blob lx-blob-fuzzy w-16 h-16 sm:w-24 sm:h-24 left-[6%] sm:left-[17%] bottom-[30%]" />
            <div className="lx-blob lx-blob-gloss w-14 h-14 sm:w-20 sm:h-20 right-[6%] sm:right-[20%] bottom-[14%]" style={{ animationDelay: '-3s' }} />
            <div className="lx-mini hidden md:block left-[calc(50%-330px)] bottom-[20%] z-20" style={{ animationDelay: '-2s' }}>
              <div className="w-[118px] rounded-[26px] bg-white border-2 border-[#2a2a31] p-3 text-left shadow-2xl">
                <p className="text-[9px] text-[#6b6b7b]">Price alert</p>
                <p className="text-[9px] text-emerald-600 mt-0.5">Entry reached</p>
                <p className="mt-1 text-[22px] font-semibold text-[#0b0b12] tabular-nums">00:34</p>
                <p className="mt-1 h-5 rounded-full bg-[#2f5bff] text-[9px] text-white grid place-items-center">XAU/USD · LONG</p>
              </div>
            </div>
            <div className="lx-mini right-[5%] sm:right-[calc(50%-300px)] bottom-[36%] z-20" style={{ animationDelay: '-5s' }}>
              <div className="relative w-[78px] h-[70px] sm:w-[92px] sm:h-[80px] rounded-2xl bg-white shadow-xl grid place-items-end p-2.5">
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold text-white bg-[#1e1b4b] rounded-md px-1.5 py-0.5">+2.1R</span>
                <div className="flex items-end gap-1 h-full w-full">
                  {[40, 62, 50, 78, 92].map((h, i) => (
                    <span key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: 'linear-gradient(#8b5cf6,#6366f1)' }} />
                  ))}
                </div>
              </div>
            </div>
            <Phone demo="records" className="hidden md:block absolute left-[calc(50%-290px)] -bottom-[150px] !w-[220px] !h-[448px] -rotate-[5deg]" />
          </div>

          {/* The phone that stays while the card slides away */}
          <Phone ref={s1phone} demo="analyze" className="absolute left-1/2 top-0 z-20 origin-top will-change-transform" />

          <svg ref={s1curve} className="lx-curve absolute z-10 hidden sm:block" width="90" height="150" viewBox="0 0 90 150" fill="none" aria-hidden="true" style={{ opacity: 0 }}>
            <circle cx="6" cy="6" r="4" fill="#fff" />
            <path ref={s1path} d="M6 6 C 80 24, 92 96, 18 146" stroke="#fff" strokeWidth="1.2" strokeDasharray="400" strokeDashoffset="400" />
          </svg>
          <div ref={s1note} className="absolute inset-x-0 z-10 px-5 text-center" style={{ opacity: 0 }}>
            <div className="mx-auto w-10 h-10 rounded-full bg-white text-[#0b0b12] grid place-items-center">
              <Target className="w-5 h-5" />
            </div>
            <h2 className="mt-4 text-[24px] sm:text-[36px] font-bold tracking-[-0.03em] leading-tight max-w-2xl mx-auto">
              Get the most accurate plan for your market and check it before you trade
            </h2>
            <p className="mt-3 text-[13.5px] text-[#9b9cab] max-w-lg mx-auto">Built from live candles: zone, Fibonacci entry, RSI and trend. Already moved? You get No signal.</p>
          </div>
        </div>
      </section>

      {/* ================= Scene 2: pills deck → fan → live price rows ================= */}
      <section ref={s2} className="lx-scene" style={{ height: '420vh' }}>
        <div className="lx-stage">
          <div className="h-full max-w-6xl mx-auto px-5 flex flex-col md:grid md:grid-cols-[0.85fr_1.15fr] md:items-center gap-6 md:gap-10 pt-[88px] pb-[96px] md:py-0">
            <div className="relative h-[120px] md:h-[200px] shrink-0">
              <div ref={s2t1} className="absolute inset-0 flex flex-col justify-center">
                <p className="text-[12px] text-[#9b9cab]">Forex, metals, indices, stocks, coins and memes</p>
                <h2 className="mt-2 text-[28px] sm:text-[42px] font-bold tracking-[-0.03em] leading-[1.08]">
                  Ask any market,
                  <br />
                  on any timeframe
                </h2>
              </div>
              <div ref={s2t2} className="absolute inset-0 flex flex-col justify-center" style={{ opacity: 0 }}>
                <p className="text-[12px] text-[#9b9cab] inline-flex items-center gap-2">
                  <span className="lx-live-dot" /> {liveCount ? `${liveCount} markets streaming now` : 'Connecting to live prices'}
                </p>
                <h2 className="mt-2 text-[28px] sm:text-[42px] font-bold tracking-[-0.03em] leading-[1.08]">
                  Live prices,
                  <br />
                  right now
                </h2>
                <button type="button" onClick={onSignUp} className="lx-btn lx-btn-light lx-btn-sm mt-4 self-start hidden md:inline-flex">
                  Analyze a market <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div ref={s2panel} className="relative flex-1 md:flex-none md:h-[460px] min-h-0 rounded-[26px] overflow-hidden">
              <div ref={s2bg} className="absolute inset-0 bg-[#111114]" style={{ opacity: 0 }} />
              <div ref={s2track} className="absolute inset-x-0 top-0 will-change-transform">
                {markets.map((m, i) => (
                  <div key={i} className="absolute inset-x-3" style={{ top: 12 + i * ROW, height: ROW - 10 }}>
                    <div
                      ref={el => {
                        rowRefs.current[i] = el;
                      }}
                      className="lx-row h-full"
                      style={{ opacity: 0 }}
                      onClick={onSignUp}
                      role="button"
                      tabIndex={-1}
                    >
                      <span className="w-10 h-10 shrink-0 rounded-xl grid place-items-center text-[11px] font-bold" style={{ background: m.color, color: m.ink }}>
                        {m.symbol.split('/')[0].slice(0, 4)}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13.5px] font-semibold text-white truncate">{m.label}</span>
                        <span className="mt-1 flex items-center gap-2">
                          <span className="lx-tag" style={{ background: m.color, color: m.ink }}>{m.symbol}</span>
                          {m.quote?.live && <span className="lx-live-dot" title="Live" />}
                        </span>
                      </span>
                      <span className="text-right">
                        {m.quote ? (
                          <>
                            <LivePrice price={m.quote.price} className="block text-[14px] font-semibold text-white" />
                            <Change v={m.quote.change24h} className="text-[11.5px]" />
                          </>
                        ) : (
                          <span className="block w-16 h-3 rounded bg-white/10 animate-pulse" />
                        )}
                      </span>
                    </div>
                    <div
                      ref={el => {
                        pillRefs.current[i] = el;
                      }}
                      className="lx-pill absolute inset-y-0 left-[16%] right-[16%] will-change-transform"
                      style={{ background: m.color, color: m.ink, opacity: 0 }}
                    >
                      {m.label}
                    </div>
                  </div>
                ))}
              </div>
              <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#000] to-transparent pointer-events-none" />
            </div>
          </div>
        </div>
      </section>

      {/* ================= Scene 3: Define your goal ================= */}
      <section ref={s3} className="lx-scene" style={{ height: '420vh' }}>
        <div className="lx-stage grid place-items-center px-5 text-center">
          <div ref={s3head} className="absolute inset-0 grid place-items-center">
            <p className="text-[26px] sm:text-[36px] font-bold tracking-[-0.02em]">Define your goal</p>
          </div>
          <div className="relative w-full">
            <div ref={s3badge} className="relative h-14" style={{ opacity: 0 }}>
              <span key={goal} className="lx-badge-in absolute left-1/2 -translate-x-1/2 bottom-0 inline-flex items-center gap-2">
                <span className="w-9 h-9 rounded-full bg-white text-[#0b0b12] grid place-items-center">{React.createElement(GOALS[goal][2], { className: 'w-4 h-4' })}</span>
                <span className="h-6 px-2.5 rounded-md bg-[#b8f5dc] text-[#0b0b12] text-[11px] font-semibold grid place-items-center whitespace-nowrap">{GOALS[goal][3]}</span>
              </span>
            </div>
            <div ref={s3list} className="lx-goals mt-3" style={{ opacity: 0 }}>
              <div className="lx-goals-in" style={{ transform: `translateY(calc(var(--lx-gh) * ${-goal}))` }}>
                {GOALS.map(([a, b], i) => (
                  <p key={a} className={`lx-goal ${i === goal ? 'on' : ''} ${i < goal ? 'past' : ''}`}>
                    <b>{a}</b>&nbsp;{b}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= Scene 4: white showcase with rotating clip cards ================= */}
      <section id="lx-show" ref={s4} className="lx-scene lx-white rounded-t-[32px] mx-2 sm:mx-4" style={{ height: '600vh' }}>
        <div className="lx-stage">
          <div className="relative h-full max-w-6xl mx-auto px-5">
            <div className="absolute inset-x-5 top-[16%] md:top-[22%] z-10">
              <div ref={s4head}>
                <p className="text-[12px] text-[#3b3b4a]">What do you want MarketX to do?</p>
                <h2 className="relative mt-2 inline-block text-[38px] sm:text-[60px] font-bold tracking-[-0.035em] leading-[1.02]">
                  Choose
                  <br />
                  your tool
                  <span ref={stickA} className="lx-sticker absolute -right-16 sm:-right-24 top-[46%] bg-[#e9d5ff] text-[#6d28d9]" style={{ opacity: 0 }}>
                    Analyze
                  </span>
                  <span ref={stickB} className="lx-sticker absolute -right-[112px] sm:-right-[152px] top-[78%] bg-[#67d4f5] text-[#0b3b57]" style={{ opacity: 0 }}>
                    Matt
                  </span>
                </h2>
              </div>
            </div>

            <div ref={s4info} className="absolute inset-x-5 md:right-auto md:w-[42%] top-[84px] md:top-1/2 md:-translate-y-1/2 z-10" style={{ opacity: 0 }}>
              <div className="flex flex-wrap gap-2">
                {SHOWCASE.map((s, i) => (
                  <span key={s.id} className={`lx-chip ${i === shown ? 'on' : ''}`} style={i === shown ? { background: s.tint } : undefined} aria-hidden="true">
                    <s.icon className="w-[18px] h-[18px]" />
                  </span>
                ))}
              </div>
              <div key={shown} className="lx-step mt-4 md:mt-7">
                <h3 className="text-[22px] md:text-[28px] font-bold tracking-[-0.02em]">{SHOWCASE[shown].title}</h3>
                <p className="mt-2 md:mt-3 text-[13.5px] md:text-[14.5px] text-[#55556a] leading-relaxed max-w-sm">{SHOWCASE[shown].text}</p>
                <button type="button" onClick={onSignUp} className="lx-btn lx-btn-sm md:h-11 mt-4 md:mt-6 bg-[#0b0b12] text-white hover:bg-black">
                  Try it <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Clip cards: the one in view plays, the ones above and below wait tilted */}
            <div className="absolute left-5 right-5 md:left-auto md:right-5 md:w-[50%] top-[52%] md:top-1/2 h-[42%] md:h-[min(560px,64vh)] md:-translate-y-1/2">
              {SHOWCASE.map((s, i) => (
                <div
                  key={s.id}
                  ref={el => {
                    cardRefs.current[i] = el;
                  }}
                  className="lx-clip absolute inset-0 will-change-transform"
                  style={{ opacity: 0 }}
                >
                  {i === shown ? (
                    <DemoClip id={s.id} />
                  ) : (
                    <div className="lxs-wait h-full grid place-items-center text-center px-6">
                      <div>
                        <span className="mx-auto w-12 h-12 rounded-2xl grid place-items-center" style={{ background: s.tint, color: '#0b0b12' }}>
                          <s.icon className="w-5 h-5" />
                        </span>
                        <p className="mt-3 text-[15px] font-semibold">{s.title}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div ref={s4dark} className="absolute inset-0 bg-black pointer-events-none" style={{ opacity: 0 }} />
        </div>
      </section>

      {/* ================= Scene 5: ring → two cards ================= */}
      <section ref={s5} className="lx-scene" style={{ height: '320vh' }}>
        <div className="lx-stage grid place-items-center px-4">
          <div ref={s5panel} className="absolute w-[min(1100px,92vw)] h-[min(520px,62vh)] rounded-[30px] bg-[#111114] grid place-items-center will-change-transform" style={{ opacity: 0 }}>
            <svg width="250" height="250" viewBox="0 0 240 240" className="-rotate-90" aria-hidden="true">
              <circle cx="120" cy="120" r="110" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="2.5" />
              <circle ref={s5ring} cx="120" cy="120" r="110" fill="none" stroke="url(#lxr)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="690" strokeDashoffset="690" />
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
                  {[0, 1, 2, 3, 4].map(i =>
                    i === 2 ? (
                      <span key={i} className={`w-7 h-7 rounded-full grid place-items-center border transition-colors ${ringStep >= 2 ? 'bg-[#2a2440] border-[#a5b4fc]' : 'bg-white/5 border-white/10'}`}>
                        {ringStep >= 3 ? <Flame className="w-3.5 h-3.5 text-orange-300" /> : <span className="w-2 h-2 rounded-full bg-white/30" />}
                      </span>
                    ) : (
                      <span key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${ringStep > i ? 'bg-[#a5b4fc]' : 'bg-white/20'}`} />
                    )
                  )}
                </div>
                <p className="mt-3 text-[20px] sm:text-[22px] font-bold leading-tight">
                  Track how every
                  <br />
                  trade ends
                </p>
              </div>
            </div>
          </div>

          <div ref={s5cards} className="relative w-full max-w-6xl grid md:grid-cols-2 gap-3 md:gap-4" style={{ opacity: 0 }}>
            <div className="relative rounded-[26px] bg-[#111114] p-5 sm:p-6 overflow-hidden">
              <div className="h-[130px] sm:h-[190px] relative">
                <div className="absolute left-0 top-1 w-[140px] rounded-2xl bg-[#1d1d24] border border-white/[0.06] p-3">
                  <div className="flex -space-x-1.5">
                    {['#fb923c', '#f472b6', '#a78bfa'].map(c => (
                      <span key={c} className="w-5 h-5 rounded-full border-2 border-[#1d1d24]" style={{ background: c }} />
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-white">Best result</p>
                  <p className="text-[10px] text-[#7d7e8c]">XAU/USD · 1H</p>
                </div>
                <div className="absolute right-0 top-0 text-right">
                  <p className="text-[11px] text-[#7d7e8c]">Win rate</p>
                  <p className="text-[28px] font-semibold">62%</p>
                </div>
                <svg className="absolute inset-x-0 bottom-0" viewBox="0 0 300 90" preserveAspectRatio="none" height="70" width="100%" aria-hidden="true">
                  <path d="M0 70 C 40 70, 60 30, 100 40 S 160 80, 200 40 S 260 10, 300 20" fill="none" stroke="#818cf8" strokeWidth="2.5" />
                  <circle cx="200" cy="40" r="5" fill="#fff" />
                </svg>
              </div>
              <p className="mt-3 text-[17px] font-bold text-center">Keep up with your best results</p>
              <p className="mt-1 text-[12.5px] text-[#7d7e8c] text-center">Journal and track record, scored by price.</p>
              <span className="lx-demo-tag on-dark !top-3 !bottom-auto">Demo</span>
            </div>
            <div className="relative rounded-[26px] bg-[#111114] p-5 sm:p-6 overflow-hidden">
              <div className="h-[130px] sm:h-[190px] relative grid place-items-center">
                <div className="lx-orbit w-[150px] h-[150px] sm:w-[190px] sm:h-[190px]" />
                <div className="lx-orbit w-[210px] h-[210px] sm:w-[260px] sm:h-[260px]" />
                <div className="lx-planet w-16 h-16 sm:w-20 sm:h-20 -translate-x-10 -translate-y-4" />
                <div className="absolute right-[24%] top-[6%]">
                  <div className="lx-cone" />
                </div>
                <span className="absolute left-[28%] top-0 inline-flex items-center gap-1 text-[10px] bg-[#2a2a33] rounded-full pl-1 pr-2 py-0.5">
                  <Flame className="w-3 h-3 text-orange-300" /> Keep it up
                </span>
                <div className="absolute right-[16%] bottom-0 w-[72px] h-[72px] sm:w-[86px] sm:h-[86px] rounded-full bg-[#6d3fd0] grid place-items-center text-center shadow-[0_0_40px_rgba(109,63,208,.6)]">
                  <div>
                    <Trophy className="w-4 h-4 mx-auto text-[#fde68a]" />
                    <p className="text-[15px] sm:text-[17px] font-bold leading-none mt-1">Top 10</p>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-[17px] font-bold text-center">Climb the monthly leaderboard</p>
              <p className="mt-1 text-[12.5px] text-[#7d7e8c] text-center">Points for every analysis, reset on the 1st.</p>
              <span className="lx-demo-tag on-dark !top-3 !bottom-auto">Demo</span>
            </div>
          </div>
        </div>
      </section>

      {/* ================= Scene 6: device screens around MT5 ================= */}
      <section ref={s6} className="lx-scene" style={{ height: '280vh' }}>
        <div className="lx-stage">
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(50% 45% at 50% 50%, rgba(99,102,241,0.2), transparent 70%)' }} />
          {DEVICES.map((d, i) => (
            <div
              key={i}
              ref={el => {
                devRefs.current[i] = el;
              }}
              className={`absolute top-0 will-change-transform ${d.hideSm ? 'hidden sm:block' : ''}`}
              style={{ left: `${d.x}%` }}
            >
              <div className="lx-device !relative !animate-none">{d.el}</div>
            </div>
          ))}
          <div ref={s6text} className="absolute inset-x-0 top-1/2 px-5 text-center z-10" style={{ opacity: 0 }}>
            <p className="text-[17px] sm:text-[22px] font-semibold text-[#b9bac6]">The Trading Agent trades on your</p>
            <p className="mt-1 text-[96px] sm:text-[170px] font-bold tracking-[-0.05em] leading-none lx-grad-text">MT5</p>
            <p className="mt-4 text-[14px] text-[#9b9cab] max-w-md mx-auto">Set your markets, risk and trades a day. It places the order, manages it to the target or the stop, and tells you every step.</p>
            <button type="button" onClick={onSignUp} className="lx-btn lx-btn-blue mt-7">
              Meet the Trading Agent <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* ================= Scene 7: Q&A deck ================= */}
      <section ref={s7} className="lx-scene" style={{ height: '300vh' }}>
        <div className="lx-stage grid place-items-center px-5 text-center">
          <div>
            <div ref={s7head} style={{ opacity: 0 }}>
              <p className="text-[11px] text-[#9b9cab]">Questions & answers</p>
              <h2 className="mt-1 text-[24px] sm:text-[30px] font-bold tracking-[-0.02em]">What traders ask</h2>
            </div>
            <div className="mt-12 flex items-center justify-center gap-3 sm:gap-10">
              <button type="button" aria-label="Previous question" onClick={() => setFaqNudge(n => n - 1)} className="lx-nav-round shrink-0">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div ref={s7deck} className="lx-stack will-change-transform" style={{ opacity: 0 }}>
                {FAQ.map((f, i) => {
                  const d = (i - faq + FAQ.length) % FAQ.length;
                  const style: React.CSSProperties =
                    d === 0
                      ? { transform: 'rotate(0deg)', zIndex: 5, opacity: 1 }
                      : d === 1
                        ? { transform: 'translate(10px, -10px) rotate(5deg)', zIndex: 4, opacity: 1 }
                        : d === 2
                          ? { transform: 'translate(-12px, 6px) rotate(-6deg)', zIndex: 3, opacity: 1 }
                          : { transform: 'translateY(-60px) rotate(-14deg) scale(0.9)', zIndex: 1, opacity: 0 };
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
              <button type="button" aria-label="Next question" onClick={() => setFaqNudge(n => n + 1)} className="lx-nav-round shrink-0">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ================= Scene 8: Unlock all benefits ================= */}
      <section ref={s8} className="lx-scene" style={{ height: '240vh' }}>
        <div className="lx-stage grid place-items-center px-5">
          <div ref={s8wrap} className="w-full max-w-5xl text-center" style={{ opacity: 0 }}>
            <Lock className="w-5 h-5 mx-auto" />
            <h2 className="mt-3 text-[26px] sm:text-[32px] font-bold tracking-[-0.02em]">Unlock all benefits</h2>
            <div className="mt-8 sm:mt-12 grid md:grid-cols-3 gap-5 md:gap-4 items-center text-left">
              <div className="px-2">
                <p className="text-[13px] pb-3 border-b border-white/15">Free</p>
                <p className="mt-4 sm:mt-6 text-[30px] sm:text-[34px] font-bold">$0</p>
                <p className="text-[13px]">3 SI analyses every day</p>
              </div>
              <div ref={s8card} className="relative p-5 sm:p-6">
                <div ref={s8bg} className="lx-price-hi absolute inset-0" style={{ opacity: 0 }} />
                <div className="relative">
                  <p className="text-[13px] pb-3 border-b border-white/15">Pro · 3 months</p>
                  <p className="mt-4 sm:mt-6 text-[30px] sm:text-[34px] font-bold">
                    $30 <span className="text-[11px] font-normal text-[#9b9cab] align-top">per 3 months</span>
                  </p>
                  <div ref={s8more} className="overflow-hidden" style={{ maxHeight: 0, opacity: 0 }}>
                    <ul className="mt-4 space-y-2 text-[12.5px] text-[#b9bac6]">
                      {['10 SI analyses every day', 'Trading Agent on your MT5', 'Fundamental Analysis, Watchlist, Strategy Builder', 'Talk back with Matt'].map(t => (
                        <li key={t} className="flex gap-2">
                          <Flame className="w-3.5 h-3.5 mt-0.5 text-orange-300 shrink-0" /> {t}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-5 flex gap-2">
                      <button type="button" onClick={onSignUp} className="lx-btn lx-btn-blue lx-btn-sm flex-1">Get Pro</button>
                      <button type="button" onClick={onSignIn} className="lx-btn lx-btn-blue lx-btn-sm flex-1 !bg-[#2a2a33]">Sign in</button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="px-2">
                <p className="text-[13px] pb-3 border-b border-white/15">Pro · Yearly</p>
                <p className="mt-4 sm:mt-6 text-[30px] sm:text-[34px] font-bold">
                  $176 <span className="text-[11px] font-normal text-[#9b9cab] align-top line-through">$200</span>
                </p>
                <p className="text-[13px] flex items-center gap-2">
                  per year <span className="text-[10px] font-semibold text-[#0b0b12] bg-[#a5b4fc] rounded-full px-2 py-0.5">12% off</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= CTA card (grows in) ================= */}
      <section className="px-3 sm:px-5 pt-10 pb-10">
        <div ref={s9} className="lx-hero-card max-w-6xl mx-auto px-6 sm:px-14 pt-12 sm:pt-16 pb-12 sm:pb-16 text-left will-change-transform">
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
          <div ref={s9phones} className="hidden lg:block absolute right-6 top-0 bottom-0 w-[500px] pointer-events-none will-change-transform">
            <Phone demo="matt" className="absolute left-0 top-6 rotate-[16deg] !w-[230px] !h-[468px]" />
            <Phone demo="safety" className="absolute left-[240px] top-20 rotate-[16deg] !w-[210px] !h-[428px]" />
          </div>
        </div>

        {/* ID checker strip */}
        <form onSubmit={openChecker} className="max-w-6xl mx-auto mt-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-[22px] bg-[#111114] px-5 py-4">
          <p className="text-[13px] text-[#b9bac6] flex-1">Check any trader's results, sealed on Solana</p>
          <div className="flex gap-2">
            <input
              value={checkId}
              onChange={e => setCheckId(e.target.value.slice(0, 64))}
              placeholder="Paste a MarketX ID"
              aria-label="MarketX ID"
              className="min-w-0 w-full sm:w-64 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] px-3.5 text-[13px] text-white placeholder:text-[#5d5e6b] outline-none focus:border-violet-400/50"
            />
            <button type="submit" className="lx-btn lx-btn-light lx-btn-sm h-10">Check</button>
          </div>
        </form>
      </section>

      {/* ================= Contact us ================= */}
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
              <a href="/go/telegram" target="_blank" rel="noopener noreferrer" aria-label="MarketX on Telegram" className="hover:opacity-85 transition-opacity"><TelegramIcon className="w-8 h-8" /></a>
              <a href="/go/youtube" target="_blank" rel="noopener noreferrer" aria-label="MarketX on YouTube" className="hover:opacity-85 transition-opacity"><YouTubeIcon className="w-8 h-8" /></a>
            </div>
          </div>
        </div>
      </section>

      {/* ================= Footer ================= */}
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
          </div>
        </div>
        <p className="max-w-6xl mx-auto mt-8 text-[11px] text-[#4a4b57] leading-relaxed">
          Trading carries risk. MarketX gives analysis for research and education, not financial advice. Expect losing streaks and keep your risk per trade small.
        </p>
      </footer>

      {/* ================= Pill nav (top on the hero, bottom once scrolled) + back-to-top bump ================= */}
      <nav className={`lx-nav ${down ? 'down' : ''}`} aria-label="MarketX">
        <a href="/" className="flex items-center gap-1.5 pr-2 mr-1" aria-label="MarketX home">
          <MarketXIcon size="sm" />
          <MarketXText className="text-[14px] hidden sm:inline whitespace-nowrap" />
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
