import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppNotification, NotificationType } from '../types';
import { Bell, CheckCheck, Trash2, X, Sparkles, TrendingUp, ShieldCheck, Gift, LineChart, ChevronRight, Mail, Megaphone } from 'lucide-react';

interface NotificationCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  onMarkAllAsRead: () => void;
  onClearAll: () => void;
  onDismissNotification: (id: string) => void;
  onMarkRead?: (id: string) => void;
  onNotificationAction?: (notification: AppNotification) => void;
  /** Activity email preference (security emails always send) */
  emailActivity?: boolean;
  onToggleEmailActivity?: (enabled: boolean) => void;
  /** Opens an announcement from the MarketX team in full */
  onOpenAnnouncement?: (notification: AppNotification) => void;
}

type Filter = 'all' | 'unread' | 'updates' | 'activity' | 'account' | 'rewards';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'updates', label: 'Updates' },
  { id: 'activity', label: 'Analyses' },
  { id: 'account', label: 'Account' },
  { id: 'rewards', label: 'Rewards' },
];

const KIND: Record<NotificationType, { icon: React.ElementType; tone: string }> = {
  analysis: { icon: LineChart, tone: 'bg-indigo-500/15 text-indigo-300' },
  market: { icon: TrendingUp, tone: 'bg-cyan-500/15 text-cyan-300' },
  security: { icon: ShieldCheck, tone: 'bg-amber-500/15 text-amber-300' },
  reward: { icon: Gift, tone: 'bg-emerald-500/15 text-emerald-300' },
  credit: { icon: Sparkles, tone: 'bg-emerald-500/15 text-emerald-300' },
  system: { icon: Bell, tone: 'bg-white/[0.06] text-slate-300' },
  announcement: { icon: Megaphone, tone: 'bg-indigo-500/20 text-indigo-200' },
};

function matches(n: AppNotification, f: Filter): boolean {
  switch (f) {
    case 'unread':
      return !n.read;
    case 'updates':
      return n.type === 'announcement';
    case 'activity':
      return n.type === 'analysis' || n.type === 'market';
    case 'account':
      return n.type === 'security' || n.type === 'system';
    case 'rewards':
      return n.type === 'reward' || n.type === 'credit';
    default:
      return true;
  }
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return 'Earlier';
}

function actionLabel(n: AppNotification): string | null {
  if (n.actionPrompt) return 'Analyze';
  switch (n.actionType) {
    case 'open_pricing':
      return 'View plans';
    case 'open_campaign':
      return 'Open campaign';
    case 'view_receipt':
      return 'View';
    case 'open_profile':
      return 'Open profile';
    default:
      return null;
  }
}

// Notification center: side panel on desktop, bottom sheet on phones
export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  isOpen,
  onClose,
  notifications,
  onMarkAllAsRead,
  onClearAll,
  onDismissNotification,
  onMarkRead,
  onNotificationAction,
  emailActivity = true,
  onToggleEmailActivity,
  onOpenAnnouncement,
}) => {
  const [filter, setFilter] = useState<Filter>('all');
  const [confirmClear, setConfirmClear] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    setConfirmClear(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const unread = notifications.filter(n => !n.read).length;
  const groups = useMemo(() => {
    const list = notifications.filter(n => matches(n, filter)).sort((a, b) => b.timestamp - a.timestamp);
    const out: { label: string; items: AppNotification[] }[] = [];
    for (const n of list) {
      const label = dayLabel(n.timestamp);
      const g = out.find(x => x.label === label);
      if (g) g.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [notifications, filter]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Notifications">
      <button type="button" aria-label="Close notifications" onClick={onClose} className="absolute inset-0 bg-black/60 mx-fade-in cursor-default" />

      <section className="mx-sheet absolute inset-x-0 bottom-0 max-h-[88dvh] sm:inset-y-3 sm:right-3 sm:left-auto sm:bottom-3 sm:max-h-none sm:w-[420px] flex flex-col rounded-t-3xl sm:rounded-3xl bg-[var(--mx-bg-2)] border border-white/[0.08] shadow-[0_24px_80px_-20px_rgba(0,0,0,0.9)] overflow-hidden">
        {/* Grab handle (mobile) */}
        <div className="sm:hidden flex justify-center pt-2.5" aria-hidden="true">
          <span className="w-10 h-1 rounded-full bg-white/15" />
        </div>

        {/* Header */}
        <header className="flex items-center gap-2 px-4 sm:px-5 pt-4 sm:pt-5 pb-3 min-w-0">
          <h2 className="text-lg font-semibold text-white tracking-tight truncate">Notifications</h2>
          {unread > 0 && (
            <span className="h-5 min-w-5 px-1.5 rounded-full bg-indigo-500 text-[11px] font-semibold text-white inline-flex items-center justify-center shrink-0">
              {unread}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onMarkAllAsRead}
              disabled={!unread}
              title="Mark all read"
              aria-label="Mark all read"
              className="h-8 px-2.5 rounded-full text-xs text-slate-300 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 disabled:hover:bg-transparent inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              <span className="max-[400px]:hidden">Mark all read</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-full text-slate-400 hover:text-white hover:bg-white/[0.06] inline-flex items-center justify-center transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Filters */}
        <nav className="grid grid-cols-3 gap-1.5 px-4 sm:px-5 pb-3" aria-label="Filter notifications">
          {FILTERS.map(f => {
            const count = f.id === 'all' ? 0 : notifications.filter(n => matches(n, f.id) && !n.read).length;
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={active}
                className={`h-8 min-w-0 px-2 rounded-full text-xs font-medium whitespace-nowrap inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                  active ? 'bg-white text-slate-950' : 'bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]'
                }`}
              >
                <span className="truncate">{f.label}</span>
                {count > 0 && (
                  <span
                    className={`h-4 min-w-4 px-1 rounded-full text-[10px] leading-none inline-flex items-center justify-center shrink-0 tabular-nums ${
                      active ? 'bg-slate-950/10 text-slate-700' : 'bg-white/[0.08] text-slate-300'
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* List */}
        <div className="flex-1 min-h-[240px] overflow-y-auto overscroll-contain px-3 pb-3 border-t border-white/[0.05]">
          {groups.length === 0 ? (
            <div className="h-full min-h-[260px] flex flex-col items-center justify-center text-center px-8">
              <span className="w-12 h-12 rounded-2xl bg-white/[0.04] flex items-center justify-center text-slate-500">
                <Bell className="w-5 h-5" />
              </span>
              <p className="mt-3 text-sm font-medium text-slate-200">{filter === 'unread' ? "You're all caught up" : 'Nothing here yet'}</p>
              <p className="mt-1 text-xs text-slate-500">Analyses, sign-ins, payments and rewards will show up here.</p>
            </div>
          ) : (
            groups.map(group => (
              <div key={group.label}>
                <div className="px-2 pt-4 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">{group.label}</div>
                <ul className="space-y-0.5">
                  {group.items.map(n => {
                    const kind = KIND[n.type] || KIND.system;
                    const Icon = kind.icon;
                    const action = actionLabel(n);
                    if (n.type === 'announcement') {
                      return (
                        <li key={n.id} className="group relative">
                          <button
                            type="button"
                            onClick={() => {
                              if (!n.read) onMarkRead?.(n.id);
                              onOpenAnnouncement?.(n);
                            }}
                            className={`w-full text-left rounded-2xl border p-3 pr-9 transition-colors cursor-pointer ${
                              n.read
                                ? 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'
                                : 'border-indigo-400/25 bg-gradient-to-br from-indigo-500/[0.12] to-transparent hover:from-indigo-500/[0.16]'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${kind.tone}`}>
                                <Icon className="w-3.5 h-3.5" />
                              </span>
                              <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-200">MarketX Team</span>
                              <span className="ml-auto text-[11px] text-slate-500 tabular-nums">{timeAgo(n.timestamp)}</span>
                            </span>
                            <span className={`mt-2 block text-sm leading-snug break-words ${n.read ? 'text-slate-200' : 'text-white font-semibold'}`}>{n.title}</span>
                            {n.message && <span className="mt-1 block text-xs text-slate-400 leading-relaxed line-clamp-3 break-words">{n.message}</span>}
                            <span className="mt-2 inline-flex items-center gap-0.5 text-xs font-medium text-indigo-300">
                              Read announcement <ChevronRight className="w-3 h-3" />
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onDismissNotification(n.id)}
                            aria-label="Dismiss notification"
                            className="absolute right-1.5 top-2 w-7 h-7 rounded-full text-slate-500 hover:text-white hover:bg-white/[0.08] inline-flex items-center justify-center transition sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      );
                    }
                    return (
                      <li key={n.id} className="group relative">
                        <button
                          type="button"
                          onClick={() => {
                            if (!n.read) onMarkRead?.(n.id);
                            if (action) onNotificationAction?.(n);
                          }}
                          className={`w-full text-left flex gap-3 p-2.5 pr-9 rounded-2xl transition-colors cursor-pointer ${
                            n.read ? 'hover:bg-white/[0.03]' : 'bg-white/[0.035] hover:bg-white/[0.06]'
                          }`}
                        >
                          <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${kind.tone}`}>
                            <Icon className="w-4 h-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start gap-2">
                              <span className={`text-[13px] leading-snug ${n.read ? 'text-slate-300' : 'text-white font-medium'}`}>{n.title}</span>
                              <span className="ml-auto text-[11px] text-slate-500 shrink-0 tabular-nums pt-px">{timeAgo(n.timestamp)}</span>
                            </span>
                            {n.message && <span className="mt-0.5 block text-xs text-slate-500 leading-relaxed line-clamp-2">{n.message}</span>}
                            {action && (
                              <span className="mt-1.5 inline-flex items-center gap-0.5 text-xs font-medium text-indigo-300">
                                {action} <ChevronRight className="w-3 h-3" />
                              </span>
                            )}
                          </span>
                        </button>
                        {!n.read && <span className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-indigo-400" aria-label="Unread" />}
                        <button
                          type="button"
                          onClick={() => onDismissNotification(n.id)}
                          aria-label="Dismiss notification"
                          className="absolute right-1.5 top-2 w-7 h-7 rounded-full text-slate-500 hover:text-white hover:bg-white/[0.08] inline-flex items-center justify-center transition sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        {/* Footer: email preference + clear */}
        <footer className="border-t border-white/[0.06] px-4 sm:px-5 py-3 flex items-center gap-2 sm:gap-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {onToggleEmailActivity && (
            <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer select-none">
              <Mail className="w-4 h-4 text-slate-500 shrink-0" />
              <span className="min-w-0">
                <span className="block text-xs text-slate-200">Email me about activity</span>
                <span className="block text-[11px] text-slate-500 leading-snug">Security alerts are always emailed</span>
              </span>
              <input
                type="checkbox"
                className="sr-only peer"
                checked={emailActivity}
                onChange={e => onToggleEmailActivity(e.target.checked)}
              />
              <span
                aria-hidden="true"
                className="ml-auto relative w-9 h-5 rounded-full bg-white/[0.12] peer-checked:bg-indigo-500 transition-colors shrink-0 after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400"
              />
            </label>
          )}
          {notifications.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (confirmClear) {
                  onClearAll();
                  setConfirmClear(false);
                } else setConfirmClear(true);
              }}
              aria-label={confirmClear ? 'Confirm clearing all notifications' : 'Clear all notifications'}
              title={confirmClear ? 'Confirm' : 'Clear all'}
              className={`h-8 px-3 rounded-full text-xs inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer ${
                confirmClear ? 'bg-rose-500/15 text-rose-300' : 'text-slate-400 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className={confirmClear ? '' : 'max-[400px]:hidden'}>{confirmClear ? 'Confirm' : 'Clear all'}</span>
            </button>
          )}
        </footer>
      </section>
    </div>
  );
};
