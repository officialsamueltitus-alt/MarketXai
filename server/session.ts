import crypto from 'crypto';
import type { Request, Response } from 'express';

// Signed, httpOnly session cookie. Payload: { uid, v (session version), exp }.
// Bumping a user's sessionVersion (e.g. on password reset) invalidates all existing sessions.
export const SESSION_COOKIE = 'mx_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let cachedSecret: Buffer | null | undefined;

function getSecret(): Buffer | null {
  if (cachedSecret !== undefined) return cachedSecret;
  const explicit = process.env.SESSION_SECRET;
  if (explicit && explicit.length >= 32) {
    cachedSecret = Buffer.from(explicit);
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    // Fallback: derive from the service-account private key (already a server secret)
    console.warn('[MarketX Auth] SESSION_SECRET not set (or < 32 chars); deriving it from FIREBASE_SERVICE_ACCOUNT. Set SESSION_SECRET for independent rotation.');
    cachedSecret = crypto.createHash('sha256').update(`marketx-session:${process.env.FIREBASE_SERVICE_ACCOUNT}`).digest();
  } else {
    cachedSecret = null;
  }
  return cachedSecret;
}

export function isSessionConfigured(): boolean {
  return getSecret() !== null;
}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

function sign(data: string, secret: Buffer): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function createSessionToken(uid: string, version: number): string {
  const secret = getSecret();
  if (!secret) throw new Error('Session secret is not configured');
  const payload = b64url(JSON.stringify({ uid, v: version, exp: Date.now() + SESSION_TTL_MS }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string): { uid: string; v: number } | null {
  const secret = getSecret();
  if (!secret || !token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload, secret);
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.uid !== 'string' || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return { uid: data.uid, v: Number(data.v) || 0 };
  } catch {
    return null;
  }
}

export function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function setSessionCookie(res: Response, uid: string, version: number) {
  res.cookie(SESSION_COOKIE, createSessionToken(uid, version), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
}

// scrypt password hashing: "scrypt$<saltB64>$<hashB64>"
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)))
  );
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | undefined | null): Promise<boolean> {
  if (!stored) return false;
  const [algo, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await new Promise<Buffer>((resolve, reject) =>
    crypto.scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 }, (err, key) =>
      err ? reject(err) : resolve(key)
    )
  );
  return crypto.timingSafeEqual(actual, expected);
}

// One-time tokens (email verification, password reset) are stored hashed
export function newOneTimeToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
