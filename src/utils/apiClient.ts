import { getApiUrl } from './api';

export interface PaymentsPublicConfig {
  enabled: boolean;
  publicKey: string;
  currency: string;
  monthlyAmount: number;
  yearlyAmount: number;
  /** Currency and amounts Paystack actually charges (e.g. NGN equivalent of the USD price) */
  chargeCurrency?: string;
  chargeMonthlyAmount?: number | null;
  chargeYearlyAmount?: number | null;
  benefits?: PlanBenefits;
}

export interface PlanBenefits {
  freeDailyAnalyses: number;
  proDailyAnalyses: number;
  startingCredits: number;
}

export function formatMoney(amount: number, currency: string, compact = false): string {
  const whole = compact && Number.isInteger(amount);
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${whole ? amount : amount.toFixed(2)}`;
  }
}

// Mirrors the server's plan rules (used until /api/public-config loads)
export const DEFAULT_BENEFITS: PlanBenefits = {
  freeDailyAnalyses: 3,
  proDailyAnalyses: 10,
  startingCredits: 5,
};

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

// The session lives in an httpOnly cookie, sent automatically with same-origin requests.
// `timeoutMs` gives up on a request a phone silently dropped (screen lock, app switch), so nothing loads forever.
export async function apiFetch<T = any>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (rest.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let signal = rest.signal;
  if (timeoutMs) {
    const ctrl = new AbortController();
    rest.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
    signal = ctrl.signal;
  }
  let res: Response;
  try {
    res = await fetch(getApiUrl(path), { credentials: 'include', ...rest, headers, signal });
  } catch (err) {
    if (timedOut) throw new ApiError(0, 'TIMEOUT', 'This is taking too long. Check your connection and try again.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || 'REQUEST_FAILED', data?.message || 'Request failed. Please try again.');
  }
  return data as T;
}
