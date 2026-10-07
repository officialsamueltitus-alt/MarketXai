import { initializeApp, cert, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

// Firestore is used purely as the database (no Firebase Authentication).
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
    // A JSON error message quotes part of the input (the private key), so it is never logged as-is
    const why = err instanceof SyntaxError ? 'not valid JSON (or base64 JSON)' : String(err?.message || err).replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[key]').slice(0, 160);
    initError = `Invalid FIREBASE_SERVICE_ACCOUNT: ${why}`;
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

export function db(): Firestore {
  const a = ensureApp();
  if (!a) throw new Error(initError || 'Firebase is not configured');
  return getFirestore(a);
}
