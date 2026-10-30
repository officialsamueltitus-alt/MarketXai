import React, { useEffect, useRef, useState } from 'react';
import { Check, CircleDot, ExternalLink, Landmark, Mic, Search, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';

// Looping product clips for the landing page: small animated replicas of the real screens (analysis, Matt talk back,
// Fundamental Analysis, token safety, results sealed on Solana). Each restarts on a timer while it is on screen and
// rests when it isn't, so the page stays light. Owner-specified: the screens are shown in light mode (white), like the site. Figures are illustrative and the clips are tagged "Demo".

/** Counts up every `ms` while `active` (each count remounts a clip, which restarts its animations) */
export function useCycle(ms: number, active: boolean) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN(x => x + 1), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return n;
}

/** True while the element is on screen */
export function useOnScreen<T extends Element>(rootMargin = '0px') {
  const ref = useRef<T | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setOn(true);
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return [ref, on] as const;
}

/** Types `text` from `startMs`, one character every `speed` ms */
function useTyped(text: string, startMs: number, speed = 45) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let i = 0;
    let t: ReturnType<typeof setInterval>;
    const s = setTimeout(() => {
      t = setInterval(() => {
        i += 1;
        setN(i);
        if (i >= text.length) clearInterval(t);
      }, speed);
    }, startMs);
    return () => {
      clearTimeout(s);
      clearInterval(t);
    };
  }, [text, startMs, speed]);
  return text.slice(0, n);
}

const delay = (ms: number): React.CSSProperties => ({ animationDelay: `${ms}ms` });
const Row: React.FC<{ k: string; v: string; tone?: string }> = ({ k, v, tone }) => (
  <div className="flex items-center justify-between text-[12px] py-1.5 border-t border-black/[0.06] first:border-0">
    <span className="text-[#6b6b7b]">{k}</span>
    <span className={`font-semibold tabular-nums ${tone || 'text-[#0b0b12]'}`}>{v}</span>
  </div>
);

// ---------------------------------------------------------------------------
// 1. Analyze a trade
// ---------------------------------------------------------------------------
function AnalyzeRun({ compact }: { compact?: boolean }) {
  const typed = useTyped('Analyze gold on the 1H', 300, 55);
  const steps = ['Looking at prompt', 'Finding tools', 'Using tools · RSI · EMA · zones', 'Checking the live price', 'Building the plan'];
  return (
    <div className={`flex flex-col h-full ${compact ? 'p-3 pt-10' : 'p-5'}`}>
      <div className="rounded-2xl bg-[#f4f4f8] border border-black/[0.08] px-3.5 py-3 text-[13px] text-[#0b0b12] min-h-[44px]">
        {typed}
        <span className="lx-caret" />
      </div>
      <div className="mt-3 space-y-1.5">
        {steps.map((s, i) => (
          <div key={s} className="lx-step flex items-center gap-2 text-[11.5px] text-[#6b6b7b]" style={delay(1700 + i * 380)}>
            <Check className="w-3.5 h-3.5 text-emerald-500" /> {s}
          </div>
        ))}
      </div>
      <div className="lx-pop mt-3 rounded-2xl bg-white shadow-[0_8px_24px_-14px_rgba(30,20,80,0.35)] border border-black/[0.08] p-3.5" style={delay(3900)}>
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 text-[11px] font-bold">LONG</span>
          <span className="text-[14px] font-semibold">XAU/USD · 1H</span>
          <span className="ml-auto text-[10.5px] text-[#6b6b7b]">Quality 78/100</span>
        </div>
        <div className="mt-2.5">
          <Row k="Entry zone" v="3,982.40 – 3,986.10" />
          <Row k="Stop loss" v="3,974.80" tone="text-rose-600" />
          <Row k="TP1 · TP2 · TP3" v="3,998.6 · 4,011.2 · 4,026.0" tone="text-emerald-600" />
          <Row k="Reward to risk" v="1 : 3.4" />
        </div>
        <div className="lx-step mt-2 inline-flex items-center gap-1.5 text-[10.5px] text-violet-600" style={delay(4700)}>
          <ShieldCheck className="w-3.5 h-3.5" /> Sealed on Solana
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Matt talk back
// ---------------------------------------------------------------------------
function MattRun() {
  const reply = useTyped('Gold is holding its 1H demand zone. A buy only makes sense on a pullback into it, with the stop under the zone.', 2600, 32);
  return (
    <div className="relative flex flex-col items-center h-full p-5 pt-8">
      <div className="absolute inset-0 grid place-items-center pointer-events-none">
        <div className="w-[260px] h-[260px] rounded-full border border-violet-400/15" />
      </div>
      <div className="lx-orb mt-4" />
      <div className="lx-wave mt-6 flex items-end gap-1 h-8">
        {Array.from({ length: 14 }).map((_, i) => (
          <i key={i} style={{ height: 32, animationDelay: `${(i % 7) * 90}ms` }} />
        ))}
      </div>
      <div className="mt-6 w-full space-y-2.5">
        <div className="lx-step ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-[#0b0b12] text-white px-3.5 py-2 text-[12.5px]" style={delay(600)}>
          <Mic className="inline w-3 h-3 mr-1 -mt-0.5" /> Is gold a buy today?
        </div>
        <div className="lx-step max-w-[88%] rounded-2xl rounded-bl-md bg-[#f1f1f6] border border-black/[0.08] px-3.5 py-2 text-[12.5px] text-[#26263a] min-h-[54px]" style={delay(2300)}>
          <span className="text-violet-600 font-semibold">Matt · </span>
          {reply}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Fundamental Analysis
// ---------------------------------------------------------------------------
function FundamentalRun() {
  const scen = [
    { k: 'Hotter than forecast', p: 55, c: '#a78bfa' },
    { k: 'In line', p: 30, c: '#93c5fd' },
    { k: 'Cooler', p: 15, c: '#5d5e6b' },
  ];
  return (
    <div className="flex flex-col h-full p-5">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl bg-sky-500/15 text-sky-700 grid place-items-center">
          <Landmark className="w-4 h-4" />
        </span>
        <div>
          <p className="text-[13.5px] font-semibold">US CPI (YoY)</p>
          <p className="text-[11px] text-[#6b6b7b]">Today · 1:30 PM · forecast 3.2%</p>
        </div>
        <span className="ml-auto text-[10.5px] px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-600 font-semibold">High impact</span>
      </div>
      <div className="mt-4 space-y-3">
        {scen.map((s, i) => (
          <div key={s.k}>
            <div className="flex justify-between text-[11.5px] mb-1">
              <span className={i === 0 ? 'text-[#0b0b12] font-semibold' : 'text-[#6b6b7b]'}>{s.k}</span>
              <span className="tabular-nums text-[#6b6b7b]">{s.p}%</span>
            </div>
            <div className="lx-bar h-2 rounded-full bg-[#f1f1f6] overflow-hidden" style={{ width: '100%' }}>
              <i style={{ width: `${s.p}%`, background: s.c, ...delay(400 + i * 250) }} />
            </div>
          </div>
        ))}
      </div>
      <div className="lx-step mt-4 flex flex-wrap gap-1.5" style={delay(1800)}>
        {[
          ['USD/JPY', 'For', 'bg-emerald-500/15 text-emerald-600'],
          ['XAU/USD', 'Against', 'bg-rose-500/15 text-rose-600'],
          ['EUR/USD', 'Against', 'bg-rose-500/15 text-rose-600'],
        ].map(([p, b, c]) => (
          <span key={p} className={`text-[11px] px-2 py-1 rounded-lg ${c}`}>
            {p} · {b}
          </span>
        ))}
      </div>
      <div className="lx-pop mt-auto rounded-2xl bg-sky-500/10 border border-sky-400/20 p-3" style={delay(3400)}>
        <p className="text-[11px] uppercase tracking-wider text-sky-700 font-semibold">Recheck · Released</p>
        <p className="mt-1 text-[13px]">
          Actual <b className="text-[#0b0b12]">3.4%</b> vs forecast 3.2%: hotter, the most likely outcome held.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Token safety check
// ---------------------------------------------------------------------------
function SafetyRun() {
  const checks: Array<[string, boolean]> = [
    ['Mint authority revoked', true],
    ['No freeze authority', true],
    ['Liquidity locked', true],
    ['Top 10 holders own 18%', false],
  ];
  return (
    <div className="flex flex-col h-full p-5">
      <div className="rounded-2xl bg-[#f4f4f8] border border-black/[0.08] px-3.5 py-3 text-[13px] flex items-center gap-2">
        <Search className="w-4 h-4 text-[#6b6b7b]" /> Is $WIF safe?
      </div>
      <div className="lx-step mt-3 text-[11.5px] text-[#6b6b7b] flex items-center gap-2" style={delay(500)}>
        <CircleDot className="w-3.5 h-3.5 text-violet-600" /> Reading the token from the Solana blockchain
      </div>
      <div className="mt-4 flex items-center gap-5">
        <svg width="132" height="76" viewBox="0 0 132 76" aria-hidden="true">
          <path d="M8 70 A58 58 0 0 1 124 70" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="10" strokeLinecap="round" />
          <path d="M8 70 A58 58 0 0 1 124 70" fill="none" stroke="url(#lxg)" strokeWidth="10" strokeLinecap="round" />
          <defs>
            <linearGradient id="lxg" x1="0" x2="1">
              <stop offset="0" stopColor="#fb7185" />
              <stop offset=".5" stopColor="#fbbf24" />
              <stop offset="1" stopColor="#34d399" />
            </linearGradient>
          </defs>
          <g className="lx-needle" style={{ ['--lx-to' as any]: '40deg', transformOrigin: '66px 70px', animationDelay: '900ms' } as React.CSSProperties}>
            <line x1="66" y1="70" x2="66" y2="20" stroke="#0b0b12" strokeWidth="3" strokeLinecap="round" />
          </g>
          <circle cx="66" cy="70" r="6" fill="#0b0b12" />
        </svg>
        <div className="lx-pop" style={delay(1700)}>
          <p className="text-[30px] font-bold tabular-nums leading-none">72</p>
          <p className="mt-1 text-[11px] font-semibold text-emerald-600 tracking-wider">LOW RISK</p>
        </div>
      </div>
      <div className="mt-4 space-y-1.5">
        {checks.map(([k, ok], i) => (
          <div key={k} className="lx-step flex items-center gap-2 text-[12px]" style={delay(2200 + i * 300)}>
            {ok ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <TriangleAlert className="w-3.5 h-3.5 text-amber-500" />}
            <span className={ok ? 'text-[#26263a]' : 'text-amber-700'}>{k}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Results sealed on Solana
// ---------------------------------------------------------------------------
function RecordsRun() {
  const rows = [
    ['XAU/USD', 'LONG', 'WIN', '+2.4R', '4kZp…9Qbm'],
    ['BTC/USDT', 'SHORT', 'WIN', '+1.8R', '7Hc2…Lw3x'],
    ['GBP/USD', 'LONG', 'LOSS', '−1.0R', '2Nf8…Tq6a'],
    ['NAS100', 'LONG', 'WIN', '+3.1R', '9Pr4…Mv1c'],
  ];
  return (
    <div className="flex flex-col h-full p-5">
      <div className="flex items-center gap-2">
        <span className="w-8 h-8 rounded-xl grid place-items-center" style={{ background: 'linear-gradient(135deg,#9945ff,#14f195)' }}>
          <Sparkles className="w-4 h-4 text-white" />
        </span>
        <div>
          <p className="text-[13.5px] font-semibold">Signal results on Solana</p>
          <p className="text-[11px] text-[#6b6b7b]">Sealed when issued · readable once closed</p>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {rows.map((r, i) => (
          <div key={r[4]} className="lx-pop rounded-xl bg-[#f7f7fa] border border-black/[0.07] px-3 py-2.5 flex items-center gap-2.5 text-[12px]" style={delay(300 + i * 650)}>
            <span className="font-semibold w-[68px]">{r[0]}</span>
            <span className={r[1] === 'LONG' ? 'text-emerald-600' : 'text-rose-600'}>{r[1]}</span>
            <span className={`ml-auto px-1.5 py-0.5 rounded-md text-[10.5px] font-bold ${r[2] === 'WIN' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-600'}`}>
              {r[2]} {r[3]}
            </span>
            <span className="hidden sm:inline-flex items-center gap-1 text-[10.5px] text-violet-600 font-mono">
              {r[4]} <ExternalLink className="w-3 h-3" />
            </span>
          </div>
        ))}
      </div>
      <p className="lx-step mt-auto text-[11px] text-[#6b6b7b]" style={delay(3200)}>
        Anyone can check them on Solscan: no edits, no deletions.
      </p>
    </div>
  );
}

export type DemoId = 'analyze' | 'matt' | 'fundamental' | 'safety' | 'records';
const RUNS: Record<DemoId, { el: React.FC<{ compact?: boolean }>; ms: number }> = {
  analyze: { el: AnalyzeRun, ms: 8000 },
  matt: { el: MattRun, ms: 9000 },
  fundamental: { el: FundamentalRun, ms: 7000 },
  safety: { el: SafetyRun, ms: 6500 },
  records: { el: RecordsRun, ms: 7000 },
};

/** One looping clip: replays while on screen, rests off screen */
export const DemoClip: React.FC<{ id: DemoId; compact?: boolean; className?: string }> = ({ id, compact, className = '' }) => {
  const [ref, on] = useOnScreen<HTMLDivElement>();
  const n = useCycle(RUNS[id].ms, on);
  const Run = RUNS[id].el;
  return (
    <div ref={ref} className={`relative h-full bg-white text-[#0b0b12] ${className}`}>
      <span className="lx-demo-tag">Demo</span>
      {on && <Run key={`${id}-${n}`} compact={compact} />}
    </div>
  );
};
