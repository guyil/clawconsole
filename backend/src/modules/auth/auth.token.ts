/**
 * Minimal HMAC-signed access token, used by the single-shared-password
 * auth gate. We don't pull in jsonwebtoken / jose — the payload only
 * carries an expiry timestamp, and node's built-in ``crypto`` is enough.
 *
 * Format:  ``<base64url(payload)>.<base64url(hmacSha256(payload))>``
 * Payload: JSON ``{ "exp": <unix-seconds> }``
 *
 * On verify we always use ``timingSafeEqual`` so a malicious actor can't
 * shave bits off via comparison-timing side-channels, and we reject the
 * token whenever the embedded ``exp`` is in the past.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const ALG_VERSION = 'v1';

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const normal = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(normal, 'base64');
}

function hmac(secret: string, payload: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest();
}

export interface TokenPayload {
  exp: number;
  v: typeof ALG_VERSION;
}

export function signToken(secret: string, ttlSeconds: number): { token: string; expiresAt: number } {
  if (!secret) throw new Error('APP_AUTH_SECRET is required to sign auth tokens');
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload: TokenPayload = { exp, v: ALG_VERSION };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(payloadStr);
  const sigB64 = base64UrlEncode(hmac(secret, payloadB64));
  return { token: `${payloadB64}.${sigB64}`, expiresAt: exp };
}

export function verifyToken(secret: string, token: string | undefined | null): TokenPayload | null {
  if (!secret || !token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = hmac(secret, payloadB64);
    actual = base64UrlDecode(sigB64);
  } catch {
    return null;
  }
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let parsed: TokenPayload;
  try {
    parsed = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as TokenPayload;
  } catch {
    return null;
  }

  if (parsed.v !== ALG_VERSION) return null;
  if (typeof parsed.exp !== 'number') return null;
  if (parsed.exp < Math.floor(Date.now() / 1000)) return null;

  return parsed;
}

/**
 * Constant-time string compare for the shared password. We do NOT bcrypt
 * because the password is only ever read from a server-side env var; the
 * only attacker surface is a malicious login attempt against the route,
 * and timing-safe equality is sufficient against that.
 */
export function passwordMatches(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
