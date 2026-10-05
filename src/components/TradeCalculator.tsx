import React, { useEffect, useMemo, useState } from 'react';
import { Calculator, AlertTriangle, RefreshCw, Info } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { formatMoney, type Currency } from '../utils/preferences';
import { LOT_TYPES, MARKET_PRESETS, QUOTE_CURRENCIES, calculate, distancesFromPrices, guessFromSymbol, lotBreakdown, pipSize, usesPips, type CalcMarket } from '../utils/tradeCalc';

// Trade calculator (Preference Mode): find the lot size for your risk, or check what a lot size risks.
export interface CalcSeed {
  symbol: string;
  entry?: number;
  stop?: number;
  tp?: number;
}
interface TradeCalculatorProps {
  /** From Preference Mode (editable here without changing the saved value) */
  accountSize: number | null;
  currency: Currency;
  riskPct: number;
  /** Levels from a trade card ("Calculate lot size") */
  seed?: CalcSeed | null;
}

const num = (v: string) => {
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
};
const clean = (v: string) => v.replace(/[^0-9.,]/g, '');
const lotText = (n: number) => (n >= 100 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toFixed(2));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** "7 micro lots", "2 mini + 5 micro lots", "1 standard + 3 mini lots" */
const lotSplit = (lots: number) => {
  const b = lotBreakdown(lots);
  const parts = [b.standard && `${b.standard} standard`, b.mini && `${b.mini} mini`, b.micro && `${b.micro} micro`].filter(Boolean) as string[];
  if (!parts.length) return '';
  if (parts.length === 1) return plural(b.standard || b.mini || b.micro, parts[0].split(' ')[1] + ' lot');
  return `${parts.join(' + ')} lots`;
};
// Example pip move per market, for the hint under the stop distance
const PIP_HINT: Partial<Record<CalcMarket, string>> = {
  gold: '1 pip on gold = a 0.10 move (2,650.00 to 2,650.10). A 1.00 move is 10 pips.',
  silver: '1 pip on silver = a 0.01 move (31.50 to 31.51).',
  oil: '1 pip on oil = a 0.01 move (70.50 to 70.51).',
};

const Field: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string; suffix?: string; aria?: string }> = ({ label, value, onChange, placeholder, suffix, aria }) => (
  <label className="block min-w-0">
    <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</span>
    <span className="mt-1.5 flex items-center h-11 px-3 rounded-2xl bg-black/25 border border-white/[0.08] focus-within:border-sky-400/50 transition">
      <input
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(clean(e.target.value))}
        aria-label={aria || label}
        className="flex-1 min-w-0 bg-transparent text-white tabular-nums placeholder:text-slate-600 focus:outline-none"
      />
      {suffix && <span className="ml-2 text-[11px] text-slate-500 shrink-0">{suffix}</span>}
    </span>
  </label>
);

const seg = (on: boolean) =>
  `h-8 px-3 rounded-full text-xs font-semibold whitespace-nowrap transition cursor-pointer ${on ? 'bg-white text-slate-900' : 'text-slate-300 hover:text-white hover:bg-white/[0.06]'}`;

export const TradeCalculator: React.FC<TradeCalculatorProps> = ({ accountSize, currency, riskPct, seed }) => {
  const [mode, setMode] = useState<'size' | 'check'>('size');
  const [symbol, setSymbol] = useState('EURUSD');
  const guess = useMemo(() => guessFromSymbol(symbol), [symbol]);
  const [market, setMarket] = useState<CalcMarket>(guess.market);
  const [contract, setContract] = useState(String(MARKET_PRESETS[guess.market].contract));
  const [quote, setQuote] = useState<string>(guess.quote);
  const [account, setAccount] = useState(accountSize ? String(accountSize) : '');
  const [risk, setRisk] = useState(String(riskPct));
  const [lots, setLots] = useState('0.10');
  const [stopBy, setStopBy] = useState<'price' | 'pips'>('price');
  const [entry, setEntry] = useState('');
  const [stop, setStop] = useState('');
  const [tp, setTp] = useState('');
  const [pips, setPips] = useState('20');
  const [fx, setFx] = useState('1');
  const [fxState, setFxState] = useState<'live' | 'manual' | 'loading' | 'unavailable' | 'same'>('same');

  // Typing a symbol picks the market, contract size and quote currency (all still editable)
  useEffect(() => {
    setMarket(guess.market);
    setContract(String(MARKET_PRESETS[guess.market].contract));
    setQuote(guess.quote);
  }, [guess]);
  useEffect(() => setAccount(accountSize ? String(accountSize) : ''), [accountSize]);
  useEffect(() => setRisk(String(riskPct)), [riskPct]);
  // Levels from a trade card
  useEffect(() => {
    if (!seed) return;
    setSymbol(seed.symbol);
    setStopBy('price');
    setMode('size');
    if (seed.entry) setEntry(String(seed.entry));
    if (seed.stop) setStop(String(seed.stop));
    setTp(seed.tp ? String(seed.tp) : '');
  }, [seed]);
  // Live rate from the quote currency to the account currency
  const loadFx = async () => {
    if (quote === currency) {
      setFx('1');
      setFxState('same');
      return;
    }
    setFxState('loading');
    try {
      const r = await apiFetch<{ rate: number }>(`/api/fx?from=${quote}&to=${currency}`);
      setFx(String(Number(r.rate.toPrecision(6))));
      setFxState('live');
    } catch {
      setFxState('unavailable');
    }
  };
  useEffect(() => {
    loadFx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, currency]);

  // Pips as traders count them (forex 0.0001 / JPY 0.01, gold 0.10, silver and oil 0.01); indices, crypto, stocks: points (1.00)
  const pip = pipSize(market, quote);
  const pipWord = usesPips(market) ? 'pips' : 'points';
  const levels = stopBy === 'price' ? distancesFromPrices(num(entry), num(stop), tp ? num(tp) : null) : null;
  const levelsError = stopBy === 'price' && entry && stop && !levels ? (num(entry) === num(stop) ? 'Entry and stop can’t be the same price.' : 'The take profit must be on the other side of the entry from the stop.') : null;
  const distance = stopBy === 'price' ? levels?.distance ?? NaN : num(pips) * pip;
  const result = calculate({
    account: num(account),
    riskPct: mode === 'size' ? num(risk) : undefined,
    lots: mode === 'check' ? num(lots) : undefined,
    contract: num(contract),
    distance,
    rewardDistance: levels?.rewardDistance ?? null,
    fx: num(fx),
    pip,
  });
  const riskTooHigh = result && result.riskPct > 2.0001;

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-black/25 border border-white/[0.08]" role="tablist" aria-label="Calculator mode">
        <button type="button" role="tab" aria-selected={mode === 'size'} onClick={() => setMode('size')} className={seg(mode === 'size')}>
          Find my lot size
        </button>
        <button type="button" role="tab" aria-selected={mode === 'check'} onClick={() => setMode('check')} className={seg(mode === 'check')}>
          Check my lot
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="block min-w-0">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Pair or market</span>
          <input
            value={symbol}
            onChange={e => setSymbol(e.target.value.slice(0, 24))}
            placeholder="EURUSD, XAUUSD, NAS100"
            aria-label="Pair or market"
            className="mt-1.5 w-full h-11 px-3 rounded-2xl bg-black/25 border border-white/[0.08] text-white font-mono uppercase placeholder:normal-case placeholder:font-sans placeholder:text-slate-600 focus:outline-none focus:border-sky-400/50"
          />
        </label>
        <label className="block min-w-0">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Market type</span>
          <select
            value={market}
            onChange={e => {
              const m = e.target.value as CalcMarket;
              setMarket(m);
              setContract(String(MARKET_PRESETS[m].contract));
            }}
            aria-label="Market type"
            className="mt-1.5 w-full h-11 px-3 rounded-2xl bg-black/25 border border-white/[0.08] text-white focus:outline-none focus:border-sky-400/50 cursor-pointer"
          >
            {(Object.keys(MARKET_PRESETS) as CalcMarket[]).map(m => (
              <option key={m} value={m} className="bg-slate-900">
                {MARKET_PRESETS[m].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label={`Account size (${currency})`} value={account} onChange={setAccount} placeholder="e.g. 5000" aria="Account size" />
        {mode === 'size' ? <Field label="Risk per trade" value={risk} onChange={setRisk} suffix="%" aria="Risk per trade in percent" /> : <Field label="Lot size" value={lots} onChange={setLots} suffix="lots" aria="Lot size" />}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Stop loss</span>
          <div className="flex gap-0.5 p-0.5 rounded-full bg-black/25 border border-white/[0.08]" role="radiogroup" aria-label="Stop loss as">
            <button type="button" role="radio" aria-checked={stopBy === 'price'} onClick={() => setStopBy('price')} className={`${seg(stopBy === 'price')} h-7 px-2.5 text-[11px]`}>
              Prices
            </button>
            <button type="button" role="radio" aria-checked={stopBy === 'pips'} onClick={() => setStopBy('pips')} className={`${seg(stopBy === 'pips')} h-7 px-2.5 text-[11px] capitalize`}>
              {pipWord}
            </button>
          </div>
        </div>
        {stopBy === 'price' ? (
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            <Field label="Entry" value={entry} onChange={setEntry} placeholder="1.0850" aria="Entry price" />
            <Field label="Stop" value={stop} onChange={setStop} placeholder="1.0830" aria="Stop loss price" />
            <Field label="Target" value={tp} onChange={setTp} placeholder="optional" aria="Take profit price (optional)" />
          </div>
        ) : (
          <div className="mt-1.5">
            <Field label={`Stop distance`} value={pips} onChange={setPips} suffix={pipWord} aria={`Stop distance in ${pipWord}`} />
            {market !== 'forex' && <p className="mt-1 px-1 text-[11px] text-slate-500">{PIP_HINT[market] || '1 point = a 1.00 move in price (NAS100 from 20,100 to 20,101 is 1 point).'}</p>}
          </div>
        )}
        {levelsError && <p className="mt-1.5 px-1 text-[11px] text-rose-300">{levelsError}</p>}
      </div>

      <details className="group rounded-2xl bg-black/20 border border-white/[0.06]">
        <summary className="list-none flex items-center justify-between px-3 h-10 text-xs text-slate-300 cursor-pointer">
          <span>
            Contract {Number(contract || 0).toLocaleString('en-US')} per lot · quoted in {quote}
            {quote !== currency && fxState !== 'unavailable' ? ` · 1 ${quote} = ${fx} ${currency}` : ''}
          </span>
          <span className="text-slate-500 group-open:rotate-180 transition-transform">⌄</span>
        </summary>
        <div className="px-3 pb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Contract size" value={contract} onChange={setContract} suffix="per lot" aria="Contract size per lot" />
            <label className="block min-w-0">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Quoted in</span>
              <select
                value={quote}
                onChange={e => setQuote(e.target.value)}
                aria-label="Quote currency"
                className="mt-1.5 w-full h-11 px-3 rounded-2xl bg-black/25 border border-white/[0.08] text-white focus:outline-none focus:border-sky-400/50 cursor-pointer"
              >
                {[...new Set([quote, ...QUOTE_CURRENCIES])].map(c => (
                  <option key={c} value={c} className="bg-slate-900">
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-slate-500">{MARKET_PRESETS[market].note}</p>
          {quote !== currency && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field
                  label={`1 ${quote} in ${currency}`}
                  value={fx}
                  onChange={v => {
                    setFx(v);
                    setFxState('manual');
                  }}
                  aria="Exchange rate"
                />
              </div>
              <button type="button" onClick={loadFx} aria-label="Load the live rate" title="Load the live rate" className="h-11 w-11 rounded-2xl bg-white/[0.05] border border-white/[0.08] text-slate-300 hover:text-white flex items-center justify-center cursor-pointer">
                <RefreshCw className={`w-4 h-4 ${fxState === 'loading' ? 'animate-spin' : ''}`} />
              </button>
            </div>
          )}
          {fxState === 'unavailable' && <p className="text-[11px] text-amber-300">Live rate unavailable right now. Enter it by hand.</p>}
        </div>
      </details>

      {/* Result */}
      <div className="p-4 rounded-3xl bg-gradient-to-br from-sky-500/[0.1] via-violet-500/[0.07] to-fuchsia-500/[0.08] border border-white/[0.08]" aria-live="polite">
        {result ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-slate-400">{mode === 'size' ? 'Your lot size' : 'Money at risk'}</div>
                <div className="mt-1 text-4xl font-semibold text-white tracking-tight tabular-nums">
                  {mode === 'size' ? `${lotText(result.lots)}` : formatMoney(result.risk, currency)}
                  {mode === 'size' && <span className="ml-1.5 text-base font-medium text-slate-400">lots</span>}
                </div>
                {mode === 'size' && lotBreakdown(result.lots).type && (
                  <div className="mt-1 text-xs text-slate-300">
                    {lotBreakdown(result.lots).type} lot · {lotSplit(result.lots)}
                  </div>
                )}
              </div>
              <div className="text-right text-xs text-slate-400 tabular-nums shrink-0">
                {levels && <div className={levels.direction === 'BUY' ? 'text-emerald-300' : 'text-rose-300'}>{levels.direction === 'BUY' ? 'Buy' : 'Sell'} setup</div>}
                <div>{result.stopPips.toLocaleString('en-US', { maximumFractionDigits: 1 })} {pipWord} stop</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs tabular-nums">
              {mode === 'size' ? (
                <div className="p-2.5 rounded-2xl bg-black/20">
                  <div className="text-[10px] text-rose-300/80">If stopped</div>
                  <div className="font-semibold text-rose-200">-{formatMoney(result.risk, currency)}</div>
                  <div className="text-[10px] text-slate-500">{result.riskPct.toFixed(2)}% of account</div>
                </div>
              ) : (
                <div className="p-2.5 rounded-2xl bg-black/20">
                  <div className="text-[10px] text-slate-400">Of your account</div>
                  <div className={`font-semibold ${riskTooHigh ? 'text-amber-300' : 'text-white'}`}>{result.riskPct.toFixed(2)}%</div>
                  <div className="text-[10px] text-slate-500">{lotText(result.lots)} lots</div>
                </div>
              )}
              <div className="p-2.5 rounded-2xl bg-black/20">
                <div className="text-[10px] text-slate-400">Per {pipWord === 'pips' ? 'pip' : 'point'}</div>
                <div className="font-semibold text-white">{formatMoney(result.pipValue, currency)}</div>
                <div className="text-[10px] text-slate-500">at {lotText(result.lots)} lots</div>
              </div>
              {result.reward != null ? (
                <div className="p-2.5 rounded-2xl bg-black/20">
                  <div className="text-[10px] text-emerald-300/80">At target</div>
                  <div className="font-semibold text-emerald-200">+{formatMoney(result.reward, currency)}</div>
                  <div className="text-[10px] text-slate-500">1 : {result.rr!.toFixed(2)}</div>
                </div>
              ) : (
                <div className="p-2.5 rounded-2xl bg-black/20">
                  <div className="text-[10px] text-slate-400">Position</div>
                  <div className="font-semibold text-white">{result.units.toLocaleString('en-US', { maximumFractionDigits: 4 })}</div>
                  <div className="text-[10px] text-slate-500">units</div>
                </div>
              )}
            </div>
            {/* The lot sizes traders use, with the pip value of each on this market */}
            <div className="mt-3 grid grid-cols-3 gap-1.5" role="group" aria-label="Lot sizes">
              {LOT_TYPES.map(t => {
                const on = lotBreakdown(result.lots).type === t.name;
                const Tag = mode === 'check' ? 'button' : 'div';
                return (
                  <Tag
                    key={t.name}
                    {...(mode === 'check' ? { type: 'button' as const, onClick: () => setLots(t.lots.toFixed(2)), 'aria-label': `Use 1 ${t.name.toLowerCase()} lot, ${t.lots.toFixed(2)}` } : {})}
                    className={`p-2 rounded-xl text-left tabular-nums border transition ${on ? 'bg-white/[0.1] border-sky-300/40' : 'bg-black/15 border-transparent'} ${mode === 'check' ? 'cursor-pointer hover:bg-white/[0.08]' : ''}`}
                  >
                    <div className={`text-[10px] font-semibold ${on ? 'text-sky-200' : 'text-slate-400'}`}>{t.name}</div>
                    <div className="text-sm font-semibold text-white">{t.lots.toFixed(2)}</div>
                    <div className="text-[10px] text-slate-500">{formatMoney(result.pipValuePerLot * t.lots, currency)}/{pipWord === 'pips' ? 'pip' : 'pt'}</div>
                  </Tag>
                );
              })}
            </div>
            {mode === 'size' && !result.belowMinimum && <p className="mt-2 text-[11px] text-slate-500">Rounded down to the nearest 0.01 lot so you never risk more than you set.</p>}
            {result.belowMinimum && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                The right size is under 0.01 lots ({result.rawLots.toFixed(4)}), the smallest most brokers allow. Use a wider account, a bigger risk % or a closer stop.
              </p>
            )}
            {riskTooHigh && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                That's more than 2% of your account on one trade. A few losses in a row would cut deep.
              </p>
            )}
          </>
        ) : (
          <p className="flex items-start gap-2 text-sm text-slate-400">
            <Calculator className="w-4 h-4 shrink-0 mt-0.5 text-sky-300" />
            Enter your account size, {mode === 'size' ? 'risk %' : 'lot size'} and stop to see the result.
          </p>
        )}
      </div>
      <p className="flex items-start gap-1.5 px-1 text-[11px] text-slate-500 leading-relaxed">
        <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
        Contract sizes follow the common standard. Check your broker's contract size for indices, synthetics and some metals; you can change it above.
      </p>
    </div>
  );
};
