import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AppNotification, NotificationType } from '../types';
import {
  Bell,
  CheckCircle2,
  Trash2,
  X,
  Sparkles,
  TrendingUp,
  Zap,
  ExternalLink,
  ShieldCheck,
  Clock,
  Mail,
  ArrowRight,
  Gift
} from 'lucide-react';

interface NotificationCenterModalProps {
  isOpen: boolean;
  onClose: () => void;
  notifications: AppNotification[];
  onMarkAllAsRead: () => void;
  onClearAll: () => void;
  onDismissNotification: (id: string) => void;
  onNotificationAction?: (notification: AppNotification) => void;
}

export const NotificationCenterModal: React.FC<NotificationCenterModalProps> = ({
  isOpen,
  onClose,
  notifications,
  onMarkAllAsRead,
  onClearAll,
  onDismissNotification,
  onNotificationAction,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'reward' | 'market' | 'system'>('all');

  if (!isOpen) return null;

  const filteredNotifications = notifications.filter(n => {
    if (activeTab === 'all') return true;
    if (activeTab === 'reward') return n.type === 'reward' || n.type === 'credit';
    return n.type === activeTab;
  });

  const unreadCount = notifications.filter(n => !n.read).length;

  const formatTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const getNotificationIcon = (type: NotificationType) => {
    switch (type) {
      case 'reward':
      case 'credit':
        return (
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <Gift className="w-4 h-4" />
          </div>
        );
      case 'market':
        return (
          <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
            <TrendingUp className="w-4 h-4" />
          </div>
        );
      case 'system':
      default:
        return (
          <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/75 backdrop-blur-md"
      />

      {/* Modal Dialog Container with sleek obsidian glass design */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="relative w-full max-w-lg max-h-[85vh] flex flex-col bg-[#0f0f12]/95 border border-white/[0.14] rounded-2xl sm:rounded-3xl shadow-2xl shadow-black overflow-hidden z-10"
      >
        {/* Top Header */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between gap-3 bg-gradient-to-b from-white/[0.04] to-transparent shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shadow-sm relative">
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-cyan-400 ring-2 ring-[#0f0f12] animate-pulse" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Notification Center
                </h2>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/35">
                    {unreadCount} new
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Institutional rewards, market sweeps & account alerts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 sm:p-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter Tabs Bar + Quick Actions */}
        <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between gap-2 flex-wrap bg-black/20 shrink-0">
          <div className="flex items-center gap-1 bg-white/[0.03] p-0.5 rounded-xl border border-white/[0.06]">
            {(['all', 'reward', 'market', 'system'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all capitalize cursor-pointer ${
                  activeTab === tab
                    ? 'bg-indigo-600/40 text-white border border-indigo-500/40 shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab === 'all' ? 'All' : tab === 'reward' ? 'Rewards' : tab === 'market' ? 'Sweeps' : 'System'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-xs">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllAsRead}
                className="text-[11px] font-medium text-slate-400 hover:text-cyan-300 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <CheckCircle2 className="w-3 h-3" />
                <span>Mark all read</span>
              </button>
            )}
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={onClearAll}
                className="text-[11px] font-medium text-slate-400 hover:text-rose-400 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear all</span>
              </button>
            )}
          </div>
        </div>

        {/* Notifications Scrollable Feed */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 divide-y divide-white/[0.04]">
          {filteredNotifications.length > 0 ? (
            filteredNotifications.map(notification => (
              <div
                key={notification.id}
                className={`pt-2.5 first:pt-0 group relative rounded-xl p-3 transition-all ${
                  !notification.read
                    ? 'bg-indigo-500/[0.08] border border-indigo-500/20'
                    : 'bg-white/[0.02] hover:bg-white/[0.05] border border-transparent'
                }`}
              >
                <div className="flex items-start gap-3">
                  {getNotificationIcon(notification.type)}

                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <h4 className="text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                          {notification.title}
                        </h4>
                        {!notification.read && (
                          <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0 animate-ping" />
                        )}
                      </div>
                      <span className="text-[10px] font-mono text-slate-500 shrink-0">
                        {formatTimeAgo(notification.timestamp)}
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed font-normal">
                      {notification.message}
                    </p>

                    {/* Action button if present */}
                    {notification.actionType && (
                      <div className="pt-1.5 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onNotificationAction?.(notification);
                            onClose();
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 text-xs font-semibold transition-all hover:scale-102 cursor-pointer"
                        >
                          <span>
                            {notification.actionType === 'view_receipt'
                              ? 'View Reward'
                              : notification.actionType === 'open_campaign'
                              ? 'View Campaign'
                              : notification.actionType === 'analyze_prompt'
                              ? 'Analyze Setup'
                              : 'View Details'}
                          </span>
                          <ArrowRight className="w-3 h-3 text-indigo-300" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Dismiss button */}
                  <button
                    type="button"
                    onClick={() => onDismissNotification(notification.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-white/[0.08] text-slate-500 hover:text-slate-200 transition-all cursor-pointer shrink-0"
                    title="Dismiss notification"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="py-12 text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-slate-400 mx-auto">
                <Bell className="w-5 h-5 text-slate-500" />
              </div>
              <h3 className="text-sm font-semibold text-slate-200">
                All caught up!
              </h3>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                No active notifications in this category. You will receive real-time alerts when liquidity sweeps or rewards occur.
              </p>
            </div>
          )}
        </div>

        {/* Footer info stating Built by SpiriTech Labs */}
        <div className="p-3 border-t border-white/[0.06] bg-black/40 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>MarketX Institutional Dispatch</span>
          </div>
          <span className="font-mono text-[10px] text-slate-500">
            Built by SpiriTech Labs
          </span>
        </div>
      </motion.div>
    </div>
  );
};
