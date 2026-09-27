import React, { useState } from 'react';
import { Activity, CalendarDays, CalendarRange, MessageSquare, LineChart, UserPlus, LogIn, Users } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { Card, ColumnChart, Empty, ErrorNote, RankBars, Segmented, Spinner, Stat, fmtNum, useAdminData } from './ui';

export const UsageSection: React.FC = () => {
  const { data, error, loading, reload } = useAdminData<any>(() => apiFetch('/api/admin/usage'));
  const [range, setRange] = useState<'day' | 'week' | 'month'>('week');
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;
  const { totals, series, topPairs, topUsers } = data;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Daily usage" value={fmtNum(totals.today)} hint="prompts today" icon={Activity} />
        <Stat label="Weekly usage" value={fmtNum(totals.week)} hint="last 7 days" icon={CalendarDays} />
        <Stat label="Monthly usage" value={fmtNum(totals.month)} hint="last 30 days" icon={CalendarRange} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Analyses (30d)" value={fmtNum(totals.analysesMonth)} icon={LineChart} tone="bg-cyan-500/15 text-cyan-300" />
        <Stat label="Questions (30d)" value={fmtNum(totals.chatsMonth)} icon={MessageSquare} tone="bg-cyan-500/15 text-cyan-300" />
        <Stat label="Active users (30d)" value={fmtNum(totals.activeUsersMonth)} icon={Users} tone="bg-emerald-500/15 text-emerald-300" />
        <Stat label="Sign-ups (30d)" value={fmtNum(totals.signupsMonth)} icon={UserPlus} tone="bg-emerald-500/15 text-emerald-300" />
        <Stat label="Sign-ins (30d)" value={fmtNum(totals.signinsMonth)} icon={LogIn} tone="bg-emerald-500/15 text-emerald-300" />
      </div>

      <Card title="Prompts per day · last 30 days">
        <ColumnChart ariaLabel="Prompts per day over the last 30 days" data={series.map((d: any) => ({ label: d.day, value: d.prompts }))} unit=" prompts" />
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card
          title="Most prompted pairs"
          action={
            <Segmented
              label="Period"
              value={range}
              onChange={v => setRange(v as typeof range)}
              options={[
                { value: 'day', label: 'Today' },
                { value: 'week', label: '7 days' },
                { value: 'month', label: '30 days' },
              ]}
            />
          }
        >
          <RankBars rows={topPairs[range]} />
        </Card>
        <Card title="Most active users · 30 days">
          {topUsers.length ? (
            <RankBars rows={topUsers.map((u: any) => ({ name: `@${u.username}`, count: u.prompts }))} unit=" prompts" />
          ) : (
            <Empty>No usage yet.</Empty>
          )}
        </Card>
      </div>
    </div>
  );
};
