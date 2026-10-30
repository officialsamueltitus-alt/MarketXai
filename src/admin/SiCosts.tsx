import React, { useEffect, useState } from 'react';
import { CalendarDays, CalendarRange, Cpu, Loader2, Search, Wallet } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { Card, ColumnChart, Empty, ErrorNote, Spinner, Stat, fmtNum, useAdminData } from './ui';

// Admin → SI costs: what the SI engine really costs, from the token counts it reports on every call, against what a
// credit sells for. Prices are editable here (copy them from the engine provider's billing page).

const KIND_LABEL: Record<string, string> = {
  analysis: 'Analysis',
  question: 'Question',
  fundamental: 'Fundamental read',
  matt: 'Matt chat',
  mattVoice: 'Matt talk back',
  voice: 'Voice input',
  strategy: 'Strategy Builder',
  other: 'Other',
  background: 'Background (news briefings…)',
};
/** Credits each action uses, to compare cost with what it brings in */
const KIND_CREDITS: Record<string, number> = { analysis: 1, question: 1, fundamental: 2 };

const usd = (n: number | null | undefined, digits = 4) =>
  n == null ? '—' : `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : fmtNum(n));

export const SiCostsSection: React.FC = () => {
  const { data, error, loading, reload } = useAdminData<any>(() => apiFetch('/api/admin/si-costs'));
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;
  const { totals, kinds, models, series, prices, creditPrice } = data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Cost today" value={usd(totals.today, 2)} icon={Wallet} />
        <Stat label="Last 7 days" value={usd(totals.week, 2)} icon={CalendarDays} />
        <Stat label="Last 30 days" value={usd(totals.cost30, 2)} hint={`${fmtNum(totals.calls30)} engine calls`} icon={CalendarRange} />
        <Stat
          label="Web searches this month"
          value={fmtNum(totals.monthSearches)}
          hint={totals.freeSearchesLeft > 0 ? `${fmtNum(totals.freeSearchesLeft)} still free this month` : 'free allowance used up'}
          icon={Search}
          tone="bg-cyan-500/15 text-cyan-300"
        />
      </div>
      {totals.freeSearchCredit > 0 && (
        <p className="text-xs text-slate-500">
          The costs count every web search at the paid rate. This month's free allowance covers about {usd(totals.freeSearchCredit, 2)} of them, so the real bill is that much lower.
        </p>
      )}

      <Card title="Engine cost per day · last 30 days (cents)">
        <ColumnChart ariaLabel="Engine cost per day over the last 30 days" data={series.map((d: any) => ({ label: d.day, value: Math.round(d.cost * 100) }))} unit="¢" />
      </Card>

      <Card title={`Cost per action · last 30 days · a credit sells for ${usd(creditPrice.low, 2)} to ${usd(creditPrice.high, 2)}`}>
        {kinds.length ? (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-1 py-2 font-medium">Action</th>
                  <th className="px-1 py-2 font-medium text-right">Actions</th>
                  <th className="px-1 py-2 font-medium text-right">Calls</th>
                  <th className="px-1 py-2 font-medium text-right">Tokens in / out</th>
                  <th className="px-1 py-2 font-medium text-right">Searches</th>
                  <th className="px-1 py-2 font-medium text-right">Total</th>
                  <th className="px-1 py-2 font-medium text-right">Per action</th>
                  <th className="px-1 py-2 font-medium text-right">Margin at {usd(creditPrice.low, 2)}/credit</th>
                </tr>
              </thead>
              <tbody>
                {kinds.map((k: any) => {
                  const credits = KIND_CREDITS[k.kind];
                  const earns = credits ? credits * creditPrice.low : null;
                  const margin = earns && k.perAction != null ? Math.round(((earns - k.perAction) / earns) * 100) : null;
                  return (
                    <tr key={k.kind} className="border-t border-white/[0.06] text-slate-300">
                      <td className="px-1 py-2 text-white">{KIND_LABEL[k.kind] || k.kind}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{fmtNum(k.actions)}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{fmtNum(k.calls)}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{tokens(k.in)} / {tokens(k.out)}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{fmtNum(k.searches)}</td>
                      <td className="px-1 py-2 text-right tabular-nums">{usd(k.cost, 2)}</td>
                      <td className="px-1 py-2 text-right tabular-nums text-white">{usd(k.perAction)}</td>
                      <td className={`px-1 py-2 text-right tabular-nums ${margin == null ? 'text-slate-500' : margin < 20 ? 'text-rose-300' : margin < 50 ? 'text-amber-300' : 'text-emerald-300'}`}>
                        {margin == null ? '—' : `${margin}% (${credits} credit${credits === 1 ? '' : 's'})`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-500">
              The trading agent makes no engine calls (it reads the charts with MarketX's own engine), so its credits don't appear here. Free daily
              analyses cost the same as paid ones but bring in nothing; Pro brings in its monthly price.
            </p>
          </div>
        ) : (
          <Empty>No engine calls recorded yet. Costs appear here from the first analysis after this update.</Empty>
        )}
      </Card>

      <Card title="By model · last 30 days">
        {models.length ? (
          <div className="space-y-2">
            {models.map((m: any) => (
              <div key={m.name} className="flex items-center justify-between gap-3 text-sm border-t border-white/[0.06] pt-2 first:border-0 first:pt-0">
                <span className="text-white flex items-center gap-2 min-w-0">
                  <Cpu className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span className="truncate">{m.name}</span>
                </span>
                <span className="text-slate-400 tabular-nums text-xs shrink-0">
                  {fmtNum(m.calls)} calls · {tokens(m.in)} in / {tokens(m.out)} out · <span className="text-white">{usd(m.cost, 2)}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No model usage yet.</Empty>
        )}
      </Card>

      <PricesCard prices={prices} onSaved={reload} />
    </div>
  );
};

const PricesCard: React.FC<{ prices: any; onSaved: () => void }> = ({ prices, onSaved }) => {
  const toRows = (p: any) => Object.entries(p.models || {}).map(([name, v]: [string, any]) => ({ name, in: String(v.in), out: String(v.out) }));
  const [rows, setRows] = useState(() => toRows(prices));
  const [search, setSearch] = useState(String(prices.searchPer1k));
  const [free, setFree] = useState(String(prices.freeSearchesPerMonth));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    setRows(toRows(prices));
    setSearch(String(prices.searchPer1k));
    setFree(String(prices.freeSearchesPerMonth));
  }, [prices]);

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const models = Object.fromEntries(rows.filter(r => r.name.trim()).map(r => [r.name.trim().toLowerCase(), { in: Number(r.in), out: Number(r.out) }]));
      await apiFetch('/api/admin/si-costs/prices', { method: 'PUT', body: JSON.stringify({ prices: { models, searchPer1k: Number(search), freeSearchesPerMonth: Number(free) } }) });
      setMsg({ ok: true, text: 'Saved. New calls are costed at these prices.' });
      onSaved();
    } catch (err: any) {
      setMsg({ ok: false, text: err?.message || 'Could not save.' });
    } finally {
      setSaving(false);
    }
  };
  const field = 'h-9 px-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-sm text-white tabular-nums w-full';

  return (
    <Card title="Prices (USD)">
      <p className="text-xs text-slate-500 mb-3">
        Per 1 million tokens, input and output (thinking counts as output). The starting figures are estimates: copy the real ones from the engine provider's
        billing page so the costs above are exact. A change applies to calls from now on.
      </p>
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_90px_90px] gap-2 text-[11px] uppercase tracking-wide text-slate-500">
          <span>Model</span>
          <span>Input</span>
          <span>Output</span>
        </div>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_90px_90px] gap-2">
            <input value={r.name} onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, name: e.target.value.slice(0, 60) } : x)))} aria-label="Model" className={field} />
            <input value={r.in} inputMode="decimal" onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, in: e.target.value.replace(/[^0-9.]/g, '') } : x)))} aria-label={`${r.name} input price`} className={field} />
            <input value={r.out} inputMode="decimal" onChange={e => setRows(rs => rs.map((x, j) => (j === i ? { ...x, out: e.target.value.replace(/[^0-9.]/g, '') } : x)))} aria-label={`${r.name} output price`} className={field} />
          </div>
        ))}
        <button type="button" onClick={() => setRows(rs => [...rs, { name: '', in: '0', out: '0' }])} className="text-xs text-slate-400 hover:text-white cursor-pointer">
          + Add a model
        </button>
        <div className="grid grid-cols-2 gap-2 pt-2">
          <label className="text-xs text-slate-400 space-y-1">
            <span>Web searches, $ per 1,000</span>
            <input value={search} inputMode="decimal" onChange={e => setSearch(e.target.value.replace(/[^0-9.]/g, ''))} className={field} />
          </label>
          <label className="text-xs text-slate-400 space-y-1">
            <span>Free searches a month</span>
            <input value={free} inputMode="numeric" onChange={e => setFree(e.target.value.replace(/[^0-9]/g, ''))} className={field} />
          </label>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="h-9 px-4 rounded-full bg-white text-slate-950 text-sm font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save prices
        </button>
        {msg && <span className={`text-xs ${msg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{msg.text}</span>}
      </div>
    </Card>
  );
};
