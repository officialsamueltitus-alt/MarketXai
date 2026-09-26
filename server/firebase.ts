import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

// Firebase Admin is configured from FIREBASE_SERVICE_ACCOUNT: the service-account JSON
// (raw JSON or base64-encoded) downloaded from Firebase Console → Project settings → Service accounts.
let app: App | null = null;
let initError: string | null = null;

function parseServiceAccount(raw: string): Record<string, any> {
  const trimmed = raw.trim();
  const json = trimmed.startsWith('{') ? trimmed : Buffer.from(trimmed, 'base64').toString('utf8');
  const parsed = JSON.parse(json);
  // Render and other hosts often store the key with literal "\n" sequences
  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

function ensureApp(): App | null {
  if (app) return app;
  if (initError) return null;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    initError = 'FIREBASE_SERVICE_ACCOUNT is not set';
    return null;
  }
  try {
    const serviceAccount = parseServiceAccount(raw);
    app = getApps()[0] || initializeApp({ credential: cert(serviceAccount as any) });
    return app;
  } catch (err: any) {
    initError = `Invalid FIREBASE_SERVICE_ACCOUNT: ${err?.message || err}`;
    console.error(`[MarketX Firebase] ${initError}`);
    return null;
  }
}

export function isFirebaseConfigured(): boolean {
  return ensureApp() !== null;
}

export function firebaseStatus(): string | null {
  ensureApp();
  return initError;
}

export function adminAuth(): Auth {
  const a = ensureApp();
  if (!a) throw new Error(initError || 'Firebase is not configured');
  return getAuth(a);
}

export function db(): Firestore {
  const a = ensureApp();
  if (!a) throw new Error(initError || 'Firebase is not configured');
  return getFirestore(a);
}

// Public web config served to the browser (these values are not secrets)
export function getFirebaseWebConfig() {
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!apiKey || !projectId) return null;
  return {
    apiKey,
    projectId,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
    appId: process.env.FIREBASE_APP_ID || undefined,
  };
}
