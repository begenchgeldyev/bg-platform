import { describe, expect, test } from 'bun:test';
import { createRateLimiter } from './rate-limit';

describe('createRateLimiter', () => {
  test('allows `limit` takes per window and says when the next one is allowed', () => {
    let time = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => time });
    expect(limiter.take('a')).toEqual({ ok: true });
    time = 100;
    expect(limiter.take('a')).toEqual({ ok: true });
    time = 400;
    expect(limiter.take('a')).toEqual({ ok: false, retryAfterMs: 600 });
  });

  test('frees a slot once the oldest take leaves the window', () => {
    let time = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => time });
    limiter.take('a');
    time = 1000;
    expect(limiter.take('a')).toEqual({ ok: true });
  });

  test('counts each key separately', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
    limiter.take('a');
    expect(limiter.take('b')).toEqual({ ok: true });
    expect(limiter.take('a').ok).toBe(false);
  });
});
