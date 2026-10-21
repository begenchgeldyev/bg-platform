import { createHash, timingSafeEqual } from 'node:crypto';
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from '@bg/core';
import type { RateLimiter } from '../http/rate-limit';
import { errorResponse, readJsonWithin, refuseCrossSite, refuseNonJson } from '../http/requests';

const MAX_LOGIN_BODY_BYTES = 4096;

type AuthControllerDeps = {
  adminSecret: string | undefined;
  rateLimiter: RateLimiter;
  secureCookies: boolean;
  now?: () => number;
};

// Comparing digests keeps the comparison constant-time whatever the two password lengths are.
function samePassword(given: string, expected: string): boolean {
  const givenDigest = createHash('sha256').update(given).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(givenDigest, expectedDigest);
}

function sessionCookie(value: string, maxAgeSeconds: number, secureCookies: boolean): string {
  const attributes = [`Path=/`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (secureCookies) {
    attributes.push('Secure');
  }
  return `${SESSION_COOKIE}=${value}; ${attributes.join('; ')}`;
}

export class AuthController {
  constructor(private readonly deps: AuthControllerDeps) {}

  async login(req: Request, clientIp: string): Promise<Response> {
    const { adminSecret, rateLimiter, secureCookies, now = Date.now } = this.deps;

    const crossSite = refuseCrossSite(req);
    if (crossSite) {
      return crossSite;
    }
    const nonJson = refuseNonJson(req);
    if (nonJson) {
      return nonJson;
    }

    const slot = rateLimiter.take(clientIp);
    if (!slot.ok) {
      return errorResponse(429, 'too many login attempts, try again later', {
        'Retry-After': String(Math.ceil(slot.retryAfterMs / 1000)),
      });
    }

    const body = await readJsonWithin(req, MAX_LOGIN_BODY_BYTES);
    if (!body.ok) {
      return body.response;
    }

    const secret = typeof body.value === 'object' && body.value !== null ? (body.value as { secret?: unknown }).secret : undefined;
    if (typeof secret !== 'string') {
      return errorResponse(400, 'secret is required');
    }

    if (!adminSecret || !samePassword(secret, adminSecret)) {
      return errorResponse(403, 'wrong password');
    }

    return Response.json(
      { ok: true },
      {
        headers: {
          'Set-Cookie': sessionCookie(createSessionToken(adminSecret, now()), SESSION_MAX_AGE_SECONDS, secureCookies),
        },
      },
    );
  }

  logout(req: Request): Response {
    const crossSite = refuseCrossSite(req);
    if (crossSite) {
      return crossSite;
    }
    const nonJson = refuseNonJson(req);
    if (nonJson) {
      return nonJson;
    }

    return Response.json({ ok: true }, { headers: { 'Set-Cookie': sessionCookie('', 0, this.deps.secureCookies) } });
  }
}
