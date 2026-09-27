import React from 'react';
import { Crown, DollarSign, CalendarClock, Receipt } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { Badge, Card, Empty, ErrorNote, Spinner, Stat, fmtDate, fmtDateTime, fmtMoney, fmtNum, fmtUsd, useAdminData } from './ui';

export const SubscriptionsSection: React.FC = () => {
  const { data, error, loading, reload } = useAdminData<any>(() => apiFetch('/api/admin/subscriptions'));
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;
  const { summary, subscribers, payments } = data;
  const currencies = Object.entries(summary.byCurrency as Record<string, number>);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Active subscribers" value={fmtNum(summary.activeSubscribers)} hint={`${summary.monthly} monthly · ${summary.yearly} yearly`} icon={Crown} tone="bg-amber-500/15 text-amber-300" />
        <Stat label="Revenue (7d)" value={fmtUsd(summary.revenueUsd7d)} icon={DollarSign} tone="bg-emerald-500/15 text-emerald-300" />
        <Stat label="Revenue (30d)" value={fmtUsd(summary.revenueUsd30d)} icon={DollarSign} tone="bg-emerald-500/15 text-emerald-300" />
        <Stat label="Revenue (all time)" value={fmtUsd(summary.revenueUsdTotal)} hint={`${fmtNum(summary.paymentsCount)} successful payments`} icon={Receipt} />
      </div>

      <Card title="Amounts received by currency">
        {currencies.length ? (
          <div className="flex flex-wrap gap-2">
            {currencies.map(([cur, amt]) => (
              <span key={cur} className="h-9 px-3.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-sm text-slate-200 inline-flex items-center gap-2 tabular-nums">
                <span className="text-slate-500 text-xs">{cur}</span> {fmtMoney(amt, cur)}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No payments yet.</p>
        )}
      </Card>

      <Card
        title="Active subscribers"
        action={
          summary.expiringSoon > 0 && (
            <Badge tone="amber">
              <CalendarClock className="w-3 h-3" /> {summary.expiringSoon} expiring within 7 days
            </Badge>
          )
        }
      >
        {subscribers.length ? (
          <ul className="divide-y divide-white/[0.05]">
            {subscribers.map((s: any) => (
              <li key={s.uid} className="py-2.5 grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1fr)_110px_150px] items-center gap-3 text-sm">
                <span className="min-w-0">
                  <span className="block text-slate-200 truncate">@{s.username}</span>
                  <span className="block text-xs text-slate-500 truncate">{s.email}</span>
                </span>
                <Badge tone="violet">Pro {s.plan}</Badge>
                <span className="col-span-2 sm:col-span-1 text-xs text-slate-400 sm:text-right">
                  Since {fmtDate(s.startDate)} · until {fmtDate(s.expiresAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No active subscribers yet.</Empty>
        )}
      </Card>

      <Card title="Payments">
        {payments.length ? (
          <div className="-mx-4 sm:mx-0 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="font-medium px-4 sm:px-2 py-2">Date</th>
                  <th className="font-medium px-2 py-2">User</th>
                  <th className="font-medium px-2 py-2">Plan</th>
                  <th className="font-medium px-2 py-2 text-right">Amount</th>
                  <th className="font-medium px-2 py-2 text-right">USD</th>
                  <th className="font-medium px-2 py-2">Channel</th>
                  <th className="font-medium px-4 sm:px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {payments.map((p: any) => (
                  <tr key={p.reference}>
                    <td className="px-4 sm:px-2 py-2.5 text-slate-400 whitespace-nowrap">{fmtDateTime(p.createdAt)}</td>
                    <td className="px-2 py-2.5 text-slate-200 max-w-[180px] truncate">{p.username ? `@${p.username}` : p.email}</td>
                    <td className="px-2 py-2.5 text-slate-300 capitalize">{p.plan}</td>
                    <td className="px-2 py-2.5 text-right text-slate-200 tabular-nums whitespace-nowrap">{fmtMoney(p.amount, p.currency)}</td>
                    <td className="px-2 py-2.5 text-right text-slate-400 tabular-nums">{p.usdAmount ? fmtUsd(p.usdAmount) : '—'}</td>
                    <td className="px-2 py-2.5 text-slate-400">{p.channel || '—'}</td>
                    <td className="px-4 sm:px-2 py-2.5">
                      <Badge tone={p.status === 'fulfilled' ? 'green' : p.status === 'pending' ? 'gray' : 'amber'}>{p.status === 'fulfilled' ? 'paid' : p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No payments yet.</Empty>
        )}
      </Card>
    </div>
  );
};
