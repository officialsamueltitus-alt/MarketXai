import { BellRing, NotebookPen, Radar, Trophy, type LucideIcon } from 'lucide-react';
import type { PluginId, PluginStates } from '../types';

// The commands that run as plugins: once switched on they are listed under Settings, Connectors / Plugins,
// where each can be opened or switched off.
export interface PluginInfo {
  id: PluginId;
  label: string;
  slash: string;
  description: string;
  icon: LucideIcon;
  /** Icon tile colours */
  tint: string;
}

export const PLUGINS: PluginInfo[] = [
  { id: 'alerts', label: 'Price Alerts', slash: '/price-alerts', description: 'Entry, targets and stop on your setups', icon: BellRing, tint: 'bg-sky-500/15 border-sky-500/30 text-sky-300' },
  { id: 'watchlist', label: 'Watchlist', slash: '/watchlist', description: 'Scans your pairs for setups, 24/7', icon: Radar, tint: 'bg-violet-500/15 border-violet-500/30 text-violet-300' },
  { id: 'journal', label: 'Trade Journal', slash: '/trade-journal', description: 'Your trades, win rate and R', icon: NotebookPen, tint: 'bg-amber-500/15 border-amber-500/30 text-amber-300' },
  { id: 'trackRecord', label: 'Track Record', slash: '/track-record', description: 'How MarketX signals played out', icon: Trophy, tint: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' },
];

export const NO_PLUGINS: PluginStates = { alerts: false, watchlist: false, journal: false, trackRecord: false };

/** Slash command id (ChatInput) for each plugin */
export const PLUGIN_COMMAND: Record<string, PluginId> = { alerts: 'alerts', watchlist: 'watchlist', journal: 'journal', trackrecord: 'trackRecord' };

export const enabledPlugins = (states?: PluginStates | null) => PLUGINS.filter(p => !!states?.[p.id]);
