import { describe, expect, test } from 'bun:test';
import { isValidSessionToken, SESSION_MAX_AGE_SECONDS } from '@bg/core';
import { createRateLimiter } from '../http/rate-limit';
import { AuthController } from './auth.controller';

const PASSWORD = 'pw';

function controller(overrides: Partial<ConstructorParameters<typeof AuthController>[0]> = {}) {
  return new AuthController({
    adminSecret: PASSWORD,
    rateLimiter: createRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 }),
    secureCookies: false,
    ...overrides,
  });
}

function loginRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function logoutRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: '{}',
  });
}

function cookieValue(setCookie: string, name = 'bg_session'): string {
  return setCookie.slice(`${name}=`.length).split(';')[0];
}

describe('AuthController', () => {
  test('logs in with the right password', async () => {
    const res = await controller().login(loginRequest({ secret: PASSWORD }), '1.2.3.4');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('bg_session=');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(cookie).not.toContain('Secure');
    expect(isValidSessionToken(cookieValue(cookie), PASSWORD)).toBe(true);
  });

  test('marks the cookie Secure in production', async () => {
    const res = await controller({ secureCookies: true }).login(loginRequest({ secret: PASSWORD }), '1.2.3.4');
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Secure');
  });

  test('refuses a wrong password', async () => {
    const res = await controller().login(loginRequest({ secret: 'nope' }), '1.2.3.4');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'wrong password' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('refuses every password when ADMIN_SECRET is unset', async () => {
    const res = await controller({ adminSecret: undefined }).login(loginRequest({ secret: '' }), '1.2.3.4');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'wrong password' });
  });

  test('refuses a secret that is not a string', async () => {
    for (const body of [{}, { secret: 42 }, { secret: null }]) {
      const res = await controller().login(loginRequest(body), '1.2.3.4');
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'secret is required' });
    }

    const malformed = await controller().login(loginRequest('not json'), '1.2.3.4');
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'request body must be JSON' });
  });

  test('blocks the sixth attempt, even with the right password', async () => {
    const guarded = controller();
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await guarded.login(loginRequest({ secret: 'wrong' }), '1.2.3.4');
      expect(res.status).toBe(403);
    }

    const blocked = await guarded.login(loginRequest({ secret: PASSWORD }), '1.2.3.4');
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'too many login attempts, try again later' });
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(blocked.headers.get('set-cookie')).toBeNull();
  });

  test('refuses cross-site and non-JSON logins', async () => {
    const guarded = controller({ rateLimiter: createRateLimiter({ limit: 1, windowMs: 60_000 }) });

    const crossSite = await guarded.login(loginRequest({ secret: PASSWORD }, { 'Sec-Fetch-Site': 'cross-site' }), '1.2.3.4');
    expect(crossSite.status).toBe(403);

    const plainText = await guarded.login(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ secret: PASSWORD }),
      }),
      '1.2.3.4',
    );
    expect(plainText.status).toBe(415);

    // Neither refusal charges the rate limit.
    const allowed = await guarded.login(loginRequest({ secret: PASSWORD }), '1.2.3.4');
    expect(allowed.status).toBe(200);
  });

  test('logout clears the cookie', async () => {
    const res = await controller({ secureCookies: true }).logout(logoutRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('bg_session=;');
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Secure');
  });

  test('refuses a logout that is not JSON', async () => {
    const res = await controller().logout(
      new Request('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{}',
      }),
    );
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'requests must be JSON' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
