import { describe, expect, test } from 'bun:test';
import { createSessionToken, OWNER_EMAIL } from '../auth/session';
import { resolveEmail } from './pep';

process.env.ADMIN_SECRET = 'test-secret';

function get(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/admin', { headers });
}

describe('resolveEmail', () => {
  test('ignores a spoofed x-user-email header', () => {
    expect(resolveEmail(get({ 'x-user-email': OWNER_EMAIL }))).toBeNull();
  });

  test('ignores the old dev-user-email cookie', () => {
    expect(resolveEmail(get({ cookie: 'dev-user-email=begenchgeldyev%40gmail.com' }))).toBeNull();
  });

  test('returns the owner for a valid session', () => {
    expect(resolveEmail(get({ cookie: `bg_session=${createSessionToken('test-secret')}` }))).toBe(OWNER_EMAIL);
  });
});
