import { getApiUrl } from './api';

export interface PaymentsPublicConfig {
  enabled: boolean;
  publicKey: string;
  currency: string;
  monthlyAmount: number;
  yearlyAmount: number;
}

export interface PublicConfig {
  auth: { enabled: boolean; googleClientId: string | null };
  payments: PaymentsPublicConfig;
}

let configPromise: Promise<PublicConfig> | null = null;

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

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// The session lives in an httpOnly cookie, sent automatically with same-origin requests
export async function apiFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(getApiUrl(path), { credentials: 'include', ...init, headers });
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || 'REQUEST_FAILED', data?.message || 'Request failed. Please try again.');
  }
  return data as T;
}
