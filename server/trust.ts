// ===========================================================================
// Anti-scam rules for anything one trader can show to another (usernames, display names, gift notes).
//
// - Nobody can pose as MarketX or its staff: names that read as MarketX, admin, support, official, moderator, staff,
//   help desk and the like are refused, including look-alike spellings (m4rketx, market.x, accents, repeated letters).
//   Owner and staff accounts (unlimited access) are exempt.
// - Gift notes can't carry links, contact details, handles or phone numbers: the classic "your account is flagged,
//   verify here / DM this number" message is refused before it reaches anyone.
// ===========================================================================

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '$': 's', '@': 'a', '|': 'l', '!': 'i' };

/** Lower case, accents and look-alike characters folded, separators removed, repeated letters collapsed */
export function foldName(raw: string): string {
  return String(raw || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[0-9$@|!]/g, c => LEET[c] ?? c)
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

// Brand and staff words (already folded: lower case, no separators, repeats collapsed)
const BRAND = ['marketx', 'marketxsi', 'marketxai'];
const STAFF = ['admin', 'administrator', 'suport', 'helpdesk', 'oficial', 'moderator', 'customercare', 'customerservice', 'customersuport', 'verification', 'verifier', 'securityteam', 'compliance', 'refund', 'recovery'];
// Only at the start or end of a name, so ordinary names that contain them (Mustafa) stay fine
const EDGE = ['staf'];
const EXACT = ['team', 'system', 'security', 'mod', 'help', 'owner', 'ceo', 'founder', 'bot', 'root'];

/** Whether a username or display name would let its owner pose as MarketX or its staff */
/** A display name as shown to others: text only, no hidden or direction-flipping characters, one line, at most 40 characters */
export function cleanDisplayName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim();
}

/** A profile picture others may see: an uploaded image (png/jpeg/webp data) or a Google account photo, nothing else
 *  (an address on any other site could log the IP of everyone who views the profile) */
export function safeAvatar(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 300_000) return null;
  if (/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' && !u.port && !u.username && !u.password && /(^|\.)googleusercontent\.com$/i.test(u.hostname)) return u.toString();
  } catch {}
  return null;
}

export function impersonates(raw: string): boolean {
  const f = foldName(raw);
  if (!f) return false;
  if (BRAND.some(b => f.includes(b))) return true;
  if (STAFF.some(w => f.includes(w))) return true;
  if (EDGE.some(w => f.startsWith(w) || f.endsWith(w))) return true;
  return EXACT.includes(f);
}

export const RESERVED_NAME_MESSAGE = "That name is reserved: it could look like MarketX or its team. Please choose another.";

/** Why a gift note can't be sent, or null when it is fine */
export function giftNoteProblem(note: string): string | null {
  const n = String(note || '');
  const compact = n.toLowerCase().replace(/\s+/g, '');
  if (/https?:|www\.|\b[a-z0-9-]{2,}\s*(\.|\(dot\)|\[dot\])\s*(com|net|org|io|xyz|me|co|app|link|site|online|info|biz|ly|gg|to|cc|ru|top|vip|club|live|pro|finance|exchange)\b/i.test(n))
    return 'Gift notes cannot contain links.';
  if (/t\.me|telegram|whatsapp|wa\.me|signal|discord|snapchat|instagram|facebook|tiktok|dm\s*me|inbox\s*me|text\s*me|call\s*me/i.test(n)) return 'Gift notes cannot contain contact details or social accounts.';
  if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(n) || /(^|\s)@[a-z0-9_]{2,}/i.test(n)) return 'Gift notes cannot contain email addresses or handles.';
  if (/\d{7,}/.test(compact.replace(/[^\d+]/g, '')) && /(\+?\d[\d\s().-]{6,}\d)/.test(n)) return 'Gift notes cannot contain phone numbers.';
  if (/(seed|recovery)\s*phrase|private\s*key|password|passcode|pass\s*code|verify\s*your|account\s*(is\s*)?(flagged|suspended|locked)|claim\s*(your|now)|wallet\s*connect/i.test(n))
    return 'That note looks like a scam message and was not sent.';
  return null;
}
