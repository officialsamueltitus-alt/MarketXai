import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getApiUrl } from './api';

export interface PaymentsPublicConfig {
  enabled: boolean;
  publicKey: string;
  currency: string;
  monthlyAmount: number;
  yearlyAmount: number;
}

export interface PublicConfig {
  firebase: { apiKey: string; authDomain: string; projectId: string; appId?: string } | null;
  payments: PaymentsPublicConfig;
}

let configPromise: Promise<PublicConfig> | null = null;
let firebaseApp: FirebaseApp | null = null;
let authInstance: Auth | null = null;

// Runtime config comes from the server so Render env vars apply without a rebuild
export function loadPublicConfig(): Promise<PublicConfig> {
  if (!configPromise) {
    configPromise = fetch(getApiUrl('/api/public-config'))
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch(err => {
        configPromise = null;
        throw err;
      });
  }
  return configPromise;
}

export async function getFirebaseAuth(): Promise<Auth | null> {
  if (authInstance) return authInstance;
  const config = await loadPublicConfig();
  if (!config.firebase) return null;
  firebaseApp = initializeApp(config.firebase);
  authInstance = getAuth(firebaseApp);
  return authInstance;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// fetch wrapper that attaches the signed-in user's Firebase ID token
export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const auth = authInstance;
  const user = auth?.currentUser;
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (user) headers.set('Authorization', `Bearer ${await user.getIdToken()}`);

  const res = await fetch(getApiUrl(path), { ...init, headers });
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || 'REQUEST_FAILED', data?.message || 'Request failed. Please try again.');
  }
  return data as T;
}
