import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'bg_session';
export const SESSION_MAX_AGE_SECONDS = 2_592_000;
export const OWNER_EMAIL = 'begenchgeldyev@gmail.com';

function sign(secret: string, expiresAtMs: number): string {
  return createHmac('sha256', secret).update(`owner:${expiresAtMs}`).digest('hex');
}

export function createSessionToken(secret: string, now: number = Date.now()): string {
  const expiresAtMs = now + SESSION_MAX_AGE_SECONDS * 1000;
  return `${expiresAtMs}.${sign(secret, expiresAtMs)}`;
}

export function isValidSessionToken(token: string, secret: string | undefined, now: number = Date.now()): boolean {
  if (!secret) return false;

  const [expiresAt, signature, ...rest] = token.split('.');
  if (!expiresAt || !signature || rest.length > 0) return false;
  if (!/^\d+$/.test(expiresAt)) return false;

  const expiresAtMs = Number(expiresAt);
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now) return false;

  const expected = Buffer.from(sign(secret, expiresAtMs), 'hex');
  const actual = Buffer.from(signature, 'hex');
  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }

  return null;
}

export function sessionEmail(req: Request, secret: string | undefined = process.env.ADMIN_SECRET): string | null {
  const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE);
  if (!token || !isValidSessionToken(token, secret)) return null;

  return OWNER_EMAIL;
}
