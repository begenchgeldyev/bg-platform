export type RateLimitResult = { ok: true } | { ok: false; retryAfterMs: number };

export type RateLimiter = { take(key: string): RateLimitResult };

type RateLimiterOptions = { limit: number; windowMs: number; now?: () => number };

export function createRateLimiter({ limit, windowMs, now = Date.now }: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    take(key) {
      const time = now();
      const windowStart = time - windowMs;
      for (const [other, stamps] of hits) {
        if ((stamps.at(-1) ?? 0) <= windowStart) {
          hits.delete(other);
        }
      }

      const recent = (hits.get(key) ?? []).filter((stamp) => stamp > windowStart);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterMs: recent[0] + windowMs - time };
      }

      recent.push(time);
      hits.set(key, recent);
      return { ok: true };
    },
  };
}
