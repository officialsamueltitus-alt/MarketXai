import React from 'react';
import { Users, Crown, DollarSign, KeyRound, UserPlus } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { PasscodesCard } from './Passcodes';
import { Card, ColumnChart, ErrorNote, RankBars, Spinner, Stat, fmtNum, fmtUsd, timeAgo, useAdminData } from './ui';

export const ACTIVITY_LABEL: Record<string, string> = {
  signup: 'Joined',
  signin: 'Signed in',
  analysis: 'Analysis',
  chat: 'Question',
  payment: 'Payment',
  gift: 'Gift',
  profile: 'Profile',
  reward: 'Reward',
  deleted: 'Deleted',
  admin: 'Admin',
};

export const ActivityList: React.FC<{ items: any[]; showUser?: boolean }> = ({ items, showUser = true }) => (
  <ul className="divide-y divide-white/[0.05]">
    {items.map(a => (
      <li key={a.id} className="py-2.5 flex items-start gap-3 min-w-0">
        <span className="mt-0.5 h-6 px-2 rounded-full bg-white/[0.05] text-[11px] text-slate-300 inline-flex items-center shrink-0">
          {ACTIVITY_LABEL[a.type] || a.type}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-slate-200 truncate">
            {showUser && a.username && <span className="text-slate-400">@{a.username} · </span>}
            {a.title}
          </span>
          {a.detail && <span className="block text-xs text-slate-500 truncate">{a.detail}</span>}
        </span>
        <span className="text-[11px] text-slate-500 shrink-0 tabular-nums">{timeAgo(a.ts)}</span>
      </li>
    ))}
  </ul>
);

export const Overview: React.FC = () => {
  const { data, error, loading, reload } = useAdminData<any>(() => apiFetch('/api/admin/overview'));
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;
  const { users, usage, revenue, passcodes, topPairs, recent } = data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Users" value={fmtNum(users.total)} hint={`+${fmtNum(users.new7d)} this week · ${fmtNum(users.activeToday)} active today`} icon={Users} />
        <Stat label="Pro users" value={fmtNum(users.pro)} hint={`${users.suspended} suspended · ${users.banned} banned`} icon={Crown} tone="bg-amber-500/15 text-amber-300" />
        <Stat label="Revenue (30d)" value={fmtUsd(revenue.last30Usd)} hint={`${fmtUsd(revenue.totalUsd)} all time`} icon={DollarSign} tone="bg-emerald-500/15 text-emerald-300" />
        <Stat
          label="Pass codes open"
          value={`${passcodes.available} of ${passcodes.size}`}
          hint={`Batch ${passcodes.batch} · ${passcodes.redeemed} redeemed · ${passcodes.waiting} waiting${passcodes.full ? ' · full' : ''}`}
          icon={KeyRound}
          tone="bg-cyan-500/15 text-cyan-300"
        />
      </div>

      <PasscodesCard />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Prompts today" value={fmtNum(usage.today)} />
        <Stat label="Prompts 7d" value={fmtNum(usage.week)} />
        <Stat label="Prompts 30d" value={fmtNum(usage.month)} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="Prompts per day · last 30 days" className="lg:col-span-2">
          <ColumnChart ariaLabel="Prompts per day over the last 30 days" data={usage.series.map((d: any) => ({ label: d.day, value: d.prompts }))} unit=" prompts" />
        </Card>
        <Card title="Most prompted pairs · 7 days">
          <RankBars rows={topPairs} />
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card title="New sign-ups · last 30 days" className="lg:col-span-1">
          <ColumnChart
            height={140}
            ariaLabel="New sign-ups per day over the last 30 days"
            data={usage.series.map((d: any) => ({ label: d.day, value: d.signups }))}
            unit=" sign-ups"
          />
          <p className="mt-2 text-xs text-slate-500 flex items-center gap-1.5">
            <UserPlus className="w-3.5 h-3.5" /> {fmtNum(usage.series.reduce((a: number, d: any) => a + d.signups, 0))} in 30 days
          </p>
        </Card>
        <Card title="Recent activity" className="lg:col-span-2">
          {recent.length ? <ActivityList items={recent} /> : <p className="text-sm text-slate-500">No activity yet.</p>}
        </Card>
      </div>
    </div>
  );
};
