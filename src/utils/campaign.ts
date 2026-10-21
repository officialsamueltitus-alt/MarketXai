// X campaign: shared step definitions + per-user progress for the manual (link-out) steps.
// Progress is a convenience stored on this device only; the reward itself is timed and granted by the server.

export const MARKETX_X_HANDLE = '@_MarketX';
export const MARKETX_X_URL = 'https://x.com/_MarketX';
/** Opens the MarketX Telegram channel (the server redirects to the invite link, which never ships in the page) */
export const MARKETX_TELEGRAM_URL = '/go/telegram';
/** Opens the MarketX YouTube channel (a server redirect; the channel address lives on the server) */
export const MARKETX_YOUTUBE_URL = '/go/youtube';

export type CampaignStepId = 'follow' | 'engage' | 'download' | 'post' | 'reward';

export interface CampaignProgress {
  follow: boolean;
  engage: boolean;
  download: boolean;
}

export const CAMPAIGN_STEPS: Array<{ id: CampaignStepId; title: string; detail: string }> = [
  { id: 'follow', title: 'Follow MarketX', detail: 'Follow @_MarketX on X' },
  { id: 'engage', title: 'Comment, tag & repost', detail: 'Comment on the pinned post, tag 2 trader friends and repost it' },
  { id: 'download', title: 'Download your card', detail: 'Save your personal HD trader card' },
  { id: 'post', title: 'Post on X', detail: 'Share your card with the pre-written post' },
  { id: 'reward', title: 'Get +10 credits', detail: 'Credited to your account 10 hours after posting' },
];

const EMPTY: CampaignProgress = { follow: false, engage: false, download: false };
const key = (username: string) => `mx_campaign_progress_${username || 'guest'}`;

export function loadCampaignProgress(username: string): CampaignProgress {
  try {
    const raw = localStorage.getItem(key(username));
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

export function saveCampaignProgress(username: string, progress: CampaignProgress) {
  try {
    localStorage.setItem(key(username), JSON.stringify(progress));
  } catch {}
  // Let other open campaign views (banner + modal) update live
  window.dispatchEvent(new CustomEvent('mx-campaign-progress', { detail: { username, progress } }));
}

// Opens an external X page in a new tab (falls back to same tab if popups are blocked)
export function openExternal(url: string) {
  const w = window.open(url, '_blank');
  if (w) {
    try {
      w.opener = null;
    } catch {}
  } else {
    window.location.href = url;
  }
}
