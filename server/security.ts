import { perWorkerAtLeast } from './workers';
import type { NextFunction, Request, Response } from 'express';

// ===========================================================================
// Shared HTTP security: trusted client IP, security headers (CSP, HSTS, framing),
// CORS allow-list, cross-site request blocking, per-key throttles and safe errors.
// ===========================================================================

const isProd = () => process.env.NODE_ENV === 'production';

/**
 * The client's IP for rate limiting and audit logs. Never trusts the client-supplied (left-most)
 * X-Forwarded-For entry: uses CLIENT_IP_HEADER if configured, else Cloudflare's CF-Connecting-IP
 * (Render's edge overwrites it), else the right-most X-Forwarded-For hop added by the proxy.
 */
export function clientIp(req: Request): string {
  const custom = (process.env.CLIENT_IP_HEADER || '').toLowerCase().trim();
  const pick = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h || '').trim();
  if (custom) {
    const v = pick(req.headers[custom]);
    if (v) return v.split(',').pop()!.trim();
  }
  const cf = pick(req.headers['cf-connecting-ip']);
  if (cf) return cf;
  const xff = pick(req.headers['x-forwarded-for']);
  if (xff) {
    const hops = xff.split(',').map(s => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.socket.remoteAddress || 'unknown';
}

function originOf(url: string | undefined | null): string | null {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/** Origins allowed to call the API with credentials: APP_URL, VITE_API_URL's site, ALLOWED_ORIGINS. */
export function allowedOrigins(): Set<string> {
  const set = new Set<string>();
  for (const v of [process.env.APP_URL, ...(process.env.ALLOWED_ORIGINS || '').split(',')]) {
    const o = originOf(v?.trim());
    if (o) {
      set.add(o);
      // Accept both the apex and www variants of the site
      const u = new URL(o);
      set.add(u.hostname.startsWith('www.') ? o.replace('://www.', '://') : o.replace('://', '://www.'));
    }
  }
  if (!isProd()) {
    set.add('http://localhost:3000');
    set.add('http://127.0.0.1:3000');
    set.add('http://localhost:5173');
  }
  return set;
}

function sameHost(req: Request, origin: string): boolean {
  try {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    return !!host && new URL(origin).host === host;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
const CSP = [
  "default-src 'self'",
  // App bundles are same-origin; Paystack checkout and Google sign-in load their own scripts
  "script-src 'self' https://js.paystack.co https://*.paystack.co https://*.paystack.com https://accounts.google.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https: wss:",
  'frame-src https://*.paystack.co https://*.paystack.com https://accounts.google.com',
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=(self "https://checkout.paystack.com"), usb=(), interest-cohort=()');
  // Legacy XSS auditors can be abused; modern guidance is to disable them
  res.setHeader('X-XSS-Protection', '0');
  // Popups (Google sign-in, Paystack) still work; other sites can't grab a window handle to ours
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  if (isProd()) {
    const https = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    // The Vite dev server injects inline scripts, so CSP is enforced in production builds only
    res.setHeader('Content-Security-Policy', https ? `${CSP}; upgrade-insecure-requests` : CSP);
    if (https) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  next();
}

// ---------------------------------------------------------------------------
// CORS allow-list + cross-site request blocking
// ---------------------------------------------------------------------------
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Server-to-server callbacks (no browser Origin)
const ORIGIN_EXEMPT = new Set(['/api/payments/webhook']);

export function corsAndOriginGuard(req: Request, res: Response, next: NextFunction) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
  const allowed = origin && (sameHost(req, origin) || allowedOrigins().has(origin));

  if (origin && allowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    if (!allowed) return res.sendStatus(403);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    res.setHeader('Access-Control-Max-Age', '600');
    return res.sendStatus(204);
  }

  // Block cross-site state changes (defence in depth on top of SameSite cookies)
  if (req.path.startsWith('/api/') && MUTATING.has(req.method) && !ORIGIN_EXEMPT.has(req.path)) {
    if (origin && !allowed) {
      return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'Cross-site request blocked.' });
    }
    // No Origin header: the browser's own marker still says where it came from (a page on another site is refused)
    if (!origin && String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
      return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'Cross-site request blocked.' });
    }
    // State-changing API calls must be JSON (HTML forms can't send it cross-site without CORS)
    const type = String(req.headers['content-type'] || '');
    const hasBody = Number(req.headers['content-length'] || 0) > 0 || !!req.headers['transfer-encoding'];
    if (hasBody && !type.toLowerCase().startsWith('application/json')) {
      return res.status(415).json({ error: 'UNSUPPORTED_MEDIA_TYPE', message: 'Requests must be JSON.' });
    }
  }
  next();
}

// ---------------------------------------------------------------------------
// Per-key throttle (per email, per account) independent of IP addresses
// ---------------------------------------------------------------------------
export function createKeyedThrottle(options: { windowMs: number; max: number }) {
  // In multi-core mode each worker enforces its share, so the combined limit stays the same
  const opts = { ...options, max: perWorkerAtLeast(options.max) };
  const hits = new Map<string, number[]>();
  setInterval(() => {
    const now = Date.now();
    for (const [k, list] of hits) {
      const fresh = list.filter(t => now - t < opts.windowMs);
      if (fresh.length) hits.set(k, fresh);
      else hits.delete(k);
    }
  }, opts.windowMs).unref();
  return {
    /** Records an attempt; returns minutes to wait if the key is over its limit. */
    hit(key: string): number {
      const now = Date.now();
      const list = (hits.get(key) || []).filter(t => now - t < opts.windowMs);
      if (list.length >= opts.max) {
        hits.set(key, list);
        return Math.max(1, Math.ceil((opts.windowMs - (now - list[0])) / 60000));
      }
      list.push(now);
      hits.set(key, list);
      return 0;
    },
    /** Minutes to wait without recording an attempt (0 = allowed). */
    check(key: string): number {
      const now = Date.now();
      const list = (hits.get(key) || []).filter(t => now - t < opts.windowMs);
      return list.length >= opts.max ? Math.max(1, Math.ceil((opts.windowMs - (now - list[0])) / 60000)) : 0;
    },
    clear(key: string) {
      hits.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// Errors: never leak stack traces or internals
// ---------------------------------------------------------------------------
export function apiNotFound(req: Request, res: Response) {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Not found.' });
}

export function jsonErrorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);
  const status = Number(err?.status || err?.statusCode) || 500;
  if (status === 413) return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'That request is too large.' });
  if (status === 400 && err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'INVALID_JSON', message: 'The request body is not valid JSON.' });
  }
  if (status >= 500) console.error(`[MarketX] ${req.method} ${req.path} failed:`, err?.message || err);
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: status >= 500 ? 'SERVER_ERROR' : 'BAD_REQUEST',
    message: status >= 500 ? 'Something went wrong. Please try again.' : 'The request could not be processed.',
  });
}

/** Recursively drops keys Firestore reserves or that could confuse object handling. */
export function stripReservedKeys<T>(value: T, depth = 0): T {
  if (depth > 12 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => stripReservedKeys(v, depth + 1)) as any;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/^__.*__$/.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype' || k.length > 200) continue;
    out[k] = stripReservedKeys(v, depth + 1);
  }
  return out as T;
}
