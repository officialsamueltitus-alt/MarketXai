import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Copy, X } from 'lucide-react';
import { getApiUrl } from '../utils/api';

export interface Promo {
  code: string;
  monthlyPct: number;
  yearlyPct: number;
  endsAt: number | null;
  title: string;
  text: string;
}

const FESTIVE = /christmas|xmas|holiday|festive|noel|santa|mkxcmas/i;

/** "12d 4h", "5h 12m", "18m" until the offer ends */
function timeLeft(endsAt: number, now: number): string | null {
  const ms = endsAt - now;
  if (ms <= 0) return null;
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${Math.max(1, m)}m`;
}

// Fixed snow pattern (no randomness between renders): left %, size px, duration s, delay s, drift px, opacity
const FLAKES: [number, number, number, number, number, number][] = [
  [4, 2, 9, 0, 10, 0.7], [11, 3, 12, 3, -8, 0.5], [18, 2, 8, 6, 14, 0.8], [26, 1.5, 11, 1.5, -6, 0.6], [33, 2.5, 10, 4.5, 12, 0.55],
  [41, 2, 13, 7, -10, 0.7], [48, 1.5, 9, 2, 8, 0.5], [55, 3, 12, 5.5, -12, 0.45], [62, 2, 10, 0.8, 10, 0.75], [69, 1.5, 8.5, 3.8, -7, 0.6],
  [76, 2.5, 11.5, 6.4, 9, 0.5], [83, 2, 9.5, 1.2, -9, 0.7], [90, 1.5, 12.5, 4.2, 6, 0.55], [96, 2, 10.5, 7.5, -11, 0.65],
  [8, 1.5, 14, 8.5, 7, 0.4], [37, 1.5, 14.5, 9.2, -5, 0.4], [58, 2, 13.5, 10, 6, 0.45], [87, 1.5, 15, 11, -6, 0.4],
];

/** Hanging baubles for the festive card (gold, crimson, emerald), each on its own thread, gently swaying */
const Ornaments: React.FC = () => (
  <div className="pointer-events-none absolute top-0 right-14 flex items-start gap-3" aria-hidden="true">
    {[
      { len: 26, r: 9, c1: '#fde8b0', c2: '#d79a35', c3: '#8a5a12', d: '4.8s', delay: '0s' },
      { len: 44, r: 11, c1: '#ff9a9a', c2: '#d72638', c3: '#6d0f1c', d: '5.6s', delay: '-1.2s' },
      { len: 18, r: 7, c1: '#a7f3d0', c2: '#10b981', c3: '#065f46', d: '4.2s', delay: '-2.1s' },
    ].map((o, i) => (
      <svg
        key={i}
        className="mx-ornament"
        style={{ ['--d' as any]: o.d, ['--delay' as any]: o.delay }}
        width={o.r * 2 + 2}
        height={o.len + o.r * 2 + 6}
        viewBox={`0 0 ${o.r * 2 + 2} ${o.len + o.r * 2 + 6}`}
      >
        <defs>
          <radialGradient id={`mx-orn-${i}`} cx="35%" cy="30%" r="75%">
            <stop offset="0%" stopColor={o.c1} />
            <stop offset="55%" stopColor={o.c2} />
            <stop offset="100%" stopColor={o.c3} />
          </radialGradient>
        </defs>
        <line x1={o.r + 1} y1="0" x2={o.r + 1} y2={o.len} stroke="rgba(246,212,138,0.45)" strokeWidth="1" />
        <rect x={o.r - 2} y={o.len - 1} width="6" height="5" rx="1.2" fill="#e9c27a" />
        <circle cx={o.r + 1} cy={o.len + o.r + 3} r={o.r} fill={`url(#mx-orn-${i})`} />
        <ellipse cx={o.r - o.r * 0.25} cy={o.len + o.r * 0.6 + 3} rx={o.r * 0.32} ry={o.r * 0.2} fill="rgba(255,255,255,0.55)" />
      </svg>
    ))}
  </div>
);

const Star: React.FC<{ className?: string; style?: React.CSSProperties }> = ({ className, style }) => (
  <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden="true">
    <path d="M12 1.5l2.6 7.9H23l-6.8 4.9 2.6 7.9L12 17.3 5.2 22.2l2.6-7.9L1 9.4h8.4z" fill="currentColor" />
  </svg>
);

// Promo pop-up (owner-specified): pops up every time someone enters the site (each page load) while a coupon with the
// banner on is live. Closing it hides it until the next time the site is opened or reloaded. Christmas promos get the
// festive card (snow, ornaments, gold); any other promo the same card in MarketX colours.
export const PromoBanner: React.FC<{ onClaim: (code: string) => void }> = ({ onClaim }) => {
  const [promo, setPromo] = useState<Promo | null>(null);
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    fetch(getApiUrl('/api/promo'))
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const p: Promo | null = d?.promo || null;
        if (!alive || !p || !/^[A-Z0-9_-]{3,24}$/.test(p.code)) return;
        setPromo(p);
        // A beat after the page settles, so it pops in instead of flashing with the first paint
        timer = setTimeout(() => alive && setShown(true), 1200);
      })
      .catch(() => {});
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Live countdown + Escape to close, only while it is on screen
  useEffect(() => {
    if (!shown) return;
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShown(false);
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(tick);
      window.removeEventListener('keydown', onKey);
    };
  }, [shown]);

  const festive = useMemo(() => !!promo && FESTIVE.test(`${promo.code} ${promo.title} ${promo.text}`), [promo]);

  if (!promo || !shown) return null;

  const close = () => setShown(false);
  const copy = () => {
    navigator.clipboard?.writeText(promo.code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {}
    );
  };
  const offers = [promo.monthlyPct > 0 && { pct: promo.monthlyPct, plan: 'Monthly' }, promo.yearlyPct > 0 && { pct: promo.yearlyPct, plan: 'Yearly' }].filter(Boolean) as {
    pct: number;
    plan: string;
  }[];
  const best = Math.max(0, ...offers.map(o => o.pct));
  const sameAll = offers.every(o => o.pct === best);
  const left = promo.endsAt ? timeLeft(promo.endsAt, now) : null;
  const endsOn = promo.endsAt ? new Date(promo.endsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' }) : null;

  // The word "Christmas" (or the first word) in the headline gets the gold treatment
  const title = promo.title || 'A special offer on MarketX Pro';
  const hi = festive ? title.match(/christmas|holiday|xmas/i) : null;
  const headline = hi ? (
    <>
      {title.slice(0, hi.index)}
      <span className="bg-gradient-to-r from-[#fff1c9] via-[#f3c76b] to-[#e09a3a] bg-clip-text text-transparent">{hi[0]}</span>
      {title.slice((hi.index || 0) + hi[0].length)}
    </>
  ) : (
    title
  );

  const accent = festive ? 'text-[#f3d28b]' : 'text-indigo-200';

  return (
    <div
      className="mx-promo-in fixed z-[60] inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[400px]"
      role="dialog"
      aria-label={title}
    >
      {/* Hairline frame: gold to crimson for Christmas, MarketX violet otherwise */}
      <div
        className={`relative rounded-[28px] p-[1px] shadow-[0_40px_100px_-24px_rgba(0,0,0,0.75)] ${
          festive ? 'bg-gradient-to-br from-[#f6d48a]/80 via-white/[0.08] to-[#d72638]/60' : 'bg-gradient-to-br from-indigo-400/70 via-white/[0.08] to-cyan-400/50'
        }`}
      >
        <div
          className="relative overflow-hidden rounded-[27px]"
          style={{
            background: festive
              ? 'linear-gradient(160deg, #0c1d16 0%, #0a0f1a 48%, #1a0a12 100%)'
              : 'linear-gradient(160deg, #11112a 0%, #0a0d18 55%, #071a20 100%)',
          }}
        >
          {/* Aurora light */}
          <div
            className={`pointer-events-none absolute -top-24 -left-16 w-64 h-64 rounded-full blur-3xl ${festive ? 'bg-[#d72638]/25' : 'bg-indigo-500/25'}`}
            aria-hidden="true"
          />
          <div
            className={`pointer-events-none absolute -bottom-28 -right-16 w-72 h-72 rounded-full blur-3xl ${festive ? 'bg-emerald-500/20' : 'bg-cyan-500/15'}`}
            aria-hidden="true"
          />
          {festive && <div className="pointer-events-none absolute top-10 left-1/3 w-40 h-24 rounded-full bg-[#f3c76b]/10 blur-2xl" aria-hidden="true" />}

          {/* Snow */}
          {festive && (
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              {FLAKES.map(([l, size, d, delay, dx, o], i) => (
                <span
                  key={i}
                  className="mx-snowflake"
                  style={{
                    left: `${l}%`,
                    width: size,
                    height: size,
                    ['--d' as any]: `${d}s`,
                    ['--delay' as any]: `-${delay}s`,
                    ['--dx' as any]: `${dx}px`,
                    ['--o' as any]: o,
                    filter: size > 2 ? 'blur(0.4px)' : undefined,
                  }}
                />
              ))}
            </div>
          )}
          {festive && <Ornaments />}

          <button
            type="button"
            onClick={close}
            aria-label="Close offer"
            className="absolute top-3.5 right-3.5 z-20 w-8 h-8 rounded-full bg-white/[0.06] text-white/70 hover:text-white hover:bg-white/[0.14] backdrop-blur inline-flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="relative p-5 sm:p-6">
            {/* Eyebrow */}
            <div className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.24em] ${accent}`}>
              <Star className="w-3 h-3 mx-twinkle" />
              {festive ? 'Holiday offer' : 'Special offer'}
            </div>

            <h2 className="mt-3 pr-24 text-[22px] sm:text-[24px] leading-[1.15] font-semibold tracking-tight text-white">{headline}</h2>
            {promo.text && <p className="mt-2.5 text-[13.5px] leading-relaxed text-white/65">{promo.text}</p>}

            {/* The offers */}
            {offers.length > 0 && (
              <div className={`mt-5 grid gap-2.5 ${offers.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {offers.map(o => (
                  <div
                    key={o.plan}
                    className="relative rounded-2xl border border-white/[0.09] bg-white/[0.035] px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                  >
                    <div className="flex items-start gap-1">
                      <span className="text-[38px] leading-[0.9] font-semibold tracking-tighter text-white tabular-nums">{o.pct}</span>
                      <span className="flex flex-col leading-none pt-0.5">
                        <span className={`text-[15px] font-semibold ${accent}`}>%</span>
                        <span className="mt-0.5 text-[9px] font-bold tracking-[0.18em] text-white/60">OFF</span>
                      </span>
                    </div>
                    <span className="mt-2 block text-[11.5px] text-white/55">Pro {o.plan}</span>
                    {!sameAll && o.pct === best && (
                      <span
                        className={`absolute top-2.5 right-2.5 h-5 px-1.5 rounded-full text-[9px] font-bold uppercase tracking-wider inline-flex items-center ${
                          festive ? 'bg-[#f3c76b]/15 text-[#f6d48a]' : 'bg-indigo-400/15 text-indigo-200'
                        }`}
                      >
                        Best
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* The code, as a ticket */}
            <div className="relative mt-2.5">
              <button
                type="button"
                onClick={copy}
                aria-label={`Copy code ${promo.code}`}
                className="group w-full h-[52px] rounded-2xl border border-dashed border-white/[0.18] bg-white/[0.03] hover:bg-white/[0.06] px-4 flex items-center justify-between gap-3 transition-colors cursor-pointer"
              >
                <span className="flex flex-col items-start leading-none">
                  <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-white/45">Your code</span>
                  <span className="mt-1.5 font-mono text-[16px] font-bold tracking-[0.22em] text-white">{promo.code}</span>
                </span>
                <span
                  className={`h-8 px-2.5 rounded-xl inline-flex items-center gap-1.5 text-[11px] font-medium transition-colors ${
                    copied ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-white/70 group-hover:text-white'
                  }`}
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </span>
              </button>
            </div>

            {/* Claim */}
            <button
              type="button"
              onClick={() => {
                close();
                onClaim(promo.code);
              }}
              className={`mx-shine group relative overflow-hidden mt-3 w-full h-12 rounded-2xl text-[14px] font-semibold inline-flex items-center justify-center gap-2 active:scale-[0.99] transition cursor-pointer ${
                festive
                  ? 'text-[#1d1304] shadow-[0_12px_30px_-10px_rgba(231,180,90,0.6)]'
                  : 'bg-white text-slate-950 hover:bg-slate-100 shadow-[0_12px_30px_-12px_rgba(129,140,248,0.6)]'
              }`}
              style={festive ? { background: 'linear-gradient(135deg, #fbe7b2 0%, #efc36c 45%, #d4943a 100%)' } : undefined}
            >
              {festive ? `Claim ${sameAll ? '' : 'up to '}${best}% off Pro` : 'Claim offer'}
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </button>

            <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-white/45">
              {left ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full mx-twinkle ${festive ? 'bg-[#f3c76b]' : 'bg-indigo-300'}`} />
                  Limited time · ends in <span className="text-white/75 font-medium tabular-nums">{left}</span>
                  {endsOn && <span className="hidden sm:inline">· {endsOn}</span>}
                </span>
              ) : (
                <span />
              )}
              <span>Applied at checkout</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
