import { describe, expect, test } from 'bun:test';
import { createSessionToken, isValidSessionToken, OWNER_EMAIL, SESSION_MAX_AGE_SECONDS, sessionEmail } from './session';

function requestWithCookie(cookie: string): Request {
  return new Request('http://localhost/admin', { headers: { cookie } });
}

describe('isValidSessionToken', () => {
  test('accepts a fresh token', () => {
    expect(isValidSessionToken(createSessionToken('s3cret', 1000), 's3cret', 2000)).toBe(true);
  });

  test('rejects an expired token', () => {
    const token = createSessionToken('s3cret', 1000);
    expect(isValidSessionToken(token, 's3cret', 1000 + SESSION_MAX_AGE_SECONDS * 1000)).toBe(false);
  });

  test('rejects a tampered signature', () => {
    const token = createSessionToken('s3cret', 1000);
    const last = token.at(-1) === '0' ? '1' : '0';
    expect(isValidSessionToken(`${token.slice(0, -1)}${last}`, 's3cret', 2000)).toBe(false);
  });

  test('rejects a signature with garbage appended', () => {
    const token = createSessionToken('s3cret', 1000);
    for (const suffix of ['g', '0', 'zzgarbage']) {
      expect(isValidSessionToken(`${token}${suffix}`, 's3cret', 2000)).toBe(false);
    }
  });

  test('rejects a token signed with another secret', () => {
    expect(isValidSessionToken(createSessionToken('other', 1000), 's3cret', 2000)).toBe(false);
  });

  test('never accepts anything without a secret', () => {
    expect(isValidSessionToken(createSessionToken(''), '', 2000)).toBe(false);
    expect(isValidSessionToken(createSessionToken('x'), undefined, 2000)).toBe(false);
  });

  test('rejects garbage', () => {
    for (const token of ['', 'abc', '123.', '.deadbeef']) {
      expect(isValidSessionToken(token, 's3cret', 2000)).toBe(false);
    }
  });
});

describe('sessionEmail', () => {
  test('reads the cookie among others', () => {
    const token = createSessionToken('s3cret');
    expect(sessionEmail(requestWithCookie(`lang=ru; bg_session=${token}`), 's3cret')).toBe(OWNER_EMAIL);
    expect(sessionEmail(requestWithCookie('lang=ru'), 's3cret')).toBeNull();
  });
});
