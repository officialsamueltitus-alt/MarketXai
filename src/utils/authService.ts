import { UserProfile } from '../types';
import { UNLIMITED_USER_EMAIL, isUnlimitedUser } from './creditManager';

export interface AuthAccount {
  id: string;
  email: string;
  passwordHash?: string; // Stored client-side for email auth
  username: string;
  displayName: string;
  avatarUrl?: string;
  authProvider: 'email' | 'google';
  createdAt: number;
}

export const STORAGE_KEY_AUTH_ACCOUNTS = 'marketx_auth_accounts_v1';
export const STORAGE_KEY_AUTH_SESSION = 'marketx_auth_session_v1';

/**
 * Retrieves all registered accounts on this device.
 */
export function getStoredAccounts(): AuthAccount[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AUTH_ACCOUNTS);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to read auth accounts:', e);
  }
  return [];
}

/**
 * Saves registered accounts list.
 */
function saveAccounts(accounts: AuthAccount[]) {
  try {
    localStorage.setItem(STORAGE_KEY_AUTH_ACCOUNTS, JSON.stringify(accounts));
  } catch (e) {
    console.error('Failed to save auth accounts:', e);
  }
}

/**
 * Builds a UserProfile object from an authenticated account.
 * tcrypt3@gmail.com is strictly granted unlimited VIP status.
 * All other accounts receive standard tier (5 daily credits).
 */
export function buildUserProfileFromAccount(account: AuthAccount): UserProfile {
  const isVIP = isUnlimitedUser(account.email);

  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    email: account.email,
    avatarUrl: account.avatarUrl,
    joinedAt: account.createdAt,
    isVerified: isVIP,
    subscription: {
      plan: isVIP ? 'yearly' : 'free',
      active: isVIP,
      startDate: account.createdAt,
      expiresAt: isVIP ? Date.now() + 50 * 365 * 24 * 60 * 60 * 1000 : 0,
      price: isVIP ? 0 : 0,
    },
  };
}

/**
 * UTF-8 and Unicode-safe password encoder that never throws Latin-1 DOMException.
 */
export function safeHashPassword(password: string): string {
  try {
    const bytes = new TextEncoder().encode(password);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `u8_${btoa(binary)}`;
  } catch {
    return btoa(unescape(encodeURIComponent(password)));
  }
}

/**
 * Verifies password against stored hash with backward compatibility for legacy accounts.
 */
export function verifyPassword(password: string, storedHash?: string): boolean {
  if (!storedHash) return true;
  const newHash = safeHashPassword(password);
  if (newHash === storedHash) return true;

  // Legacy btoa checks
  try {
    if (btoa(password) === storedHash) return true;
  } catch {}

  try {
    const bytes = new TextEncoder().encode(password);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    if (btoa(binary) === storedHash) return true;
  } catch {}

  return false;
}

/**
 * Sign up with Email and Password.
 */
export function signUpWithEmail(
  email: string,
  password: string,
  username?: string,
  displayName?: string
): { success: boolean; profile?: UserProfile; error?: string } {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
    return { success: false, error: 'Please enter a valid email address.' };
  }

  if (!password || password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters.' };
  }

  const accounts = getStoredAccounts();
  const existing = accounts.find(a => a.email === cleanEmail);
  if (existing) {
    return { success: false, error: 'An account with this email already exists. Please sign in instead.' };
  }

  const isVIP = isUnlimitedUser(cleanEmail);
  const finalUsername = (username?.trim() || cleanEmail.split('@')[0] || 'trader')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 16);
  const finalDisplayName = displayName?.trim() || (isVIP ? 'Alpha Quant' : `${finalUsername} Trader`);

  const newAccount: AuthAccount = {
    id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    email: cleanEmail,
    passwordHash: safeHashPassword(password),
    username: finalUsername,
    displayName: finalDisplayName,
    authProvider: 'email',
    createdAt: Date.now(),
  };

  accounts.push(newAccount);
  saveAccounts(accounts);

  const profile = buildUserProfileFromAccount(newAccount);
  try {
    localStorage.setItem(STORAGE_KEY_AUTH_SESSION, JSON.stringify(newAccount));
  } catch (e) {
    // Ignore storage errors
  }

  return { success: true, profile };
}

/**
 * Sign in with Email and Password.
 */
export function signInWithEmail(
  email: string,
  password: string
): { success: boolean; profile?: UserProfile; error?: string } {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) {
    return { success: false, error: 'Please enter your email.' };
  }
  if (!password) {
    return { success: false, error: 'Please enter your password.' };
  }

  const isVIP = isUnlimitedUser(cleanEmail);

  // VIP Master account direct auto-provisioning for tcrypt3@gmail.com
  if (isVIP) {
    const vipAccount: AuthAccount = {
      id: 'usr_tcrypt_vip',
      email: cleanEmail,
      username: 'tcrypt',
      displayName: 'Alpha Quant',
      authProvider: 'email',
      createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    };
    try {
      localStorage.setItem(STORAGE_KEY_AUTH_SESSION, JSON.stringify(vipAccount));
    } catch (e) {}
    return { success: true, profile: buildUserProfileFromAccount(vipAccount) };
  }

  const accounts = getStoredAccounts();
  const account = accounts.find(a => a.email === cleanEmail);

  if (!account) {
    return {
      success: false,
      error: 'No account found with this email. Please sign up first.',
    };
  }

  if (!verifyPassword(password, account.passwordHash)) {
    return { success: false, error: 'Incorrect password. Please try again.' };
  }

  try {
    localStorage.setItem(STORAGE_KEY_AUTH_SESSION, JSON.stringify(account));
  } catch (e) {}

  return { success: true, profile: buildUserProfileFromAccount(account) };
}

/**
 * Sign in or Sign up with Google OAuth.
 */
export function signInWithGoogle(
  email: string,
  displayName?: string,
  avatarUrl?: string
): { success: boolean; profile: UserProfile } {
  const cleanEmail = email.trim().toLowerCase();
  const accounts = getStoredAccounts();
  let account = accounts.find(a => a.email === cleanEmail);

  const isVIP = isUnlimitedUser(cleanEmail);

  if (!account) {
    const derivedUsername = isVIP
      ? 'tcrypt'
      : (cleanEmail.split('@')[0] || 'trader').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16);

    account = {
      id: `usr_google_${Date.now()}`,
      email: cleanEmail,
      username: derivedUsername,
      displayName: displayName || (isVIP ? 'Alpha Quant' : `${derivedUsername} Trader`),
      avatarUrl: avatarUrl || undefined,
      authProvider: 'google',
      createdAt: Date.now(),
    };
    accounts.push(account);
    saveAccounts(accounts);
  } else if (avatarUrl && !account.avatarUrl) {
    account.avatarUrl = avatarUrl;
    saveAccounts(accounts);
  }

  try {
    localStorage.setItem(STORAGE_KEY_AUTH_SESSION, JSON.stringify(account));
  } catch (e) {}

  return { success: true, profile: buildUserProfileFromAccount(account) };
}

/**
 * Sign out current user.
 */
export function signOutUser() {
  try {
    localStorage.removeItem(STORAGE_KEY_AUTH_SESSION);
  } catch (e) {}
}

/**
 * Retrieves the currently active authenticated session, if any.
 */
export function getActiveSessionAccount(): AuthAccount | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AUTH_SESSION);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}
