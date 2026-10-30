// Pro features (owner-specified): open to everyone until 1 November 2026 (Lagos midnight), then Pro only.
// The server enforces every one of them (server/proAccess.ts); this list is what the app badges and locks.
// Price alerts, the track record and the RDM timeframe stay free for everyone.
export type ProFeature = 'watchlist' | 'journal' | 'strategy' | 'fundamental' | 'preference' | 'chart' | 'voice' | 'agent';

export const PRO_FEATURES: Record<ProFeature, string> = {
  watchlist: 'Watchlist',
  journal: 'Trade Journal',
  strategy: 'Strategy Builder',
  fundamental: 'Fundamental Analysis',
  preference: 'Preference Mode',
  chart: 'Chart screenshot analysis',
  voice: 'Voice input',
  agent: 'Trading Agent',
};

/** Slash command / tool / plugin ids that are Pro features */
export const isProFeatureId = (id: string): id is ProFeature => id in PRO_FEATURES;

export const proMessage = (f: ProFeature) => `${PRO_FEATURES[f]} is a Pro feature. Upgrade to Pro to use it.`;
