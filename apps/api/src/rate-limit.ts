export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
}

export interface RateLimiter {
  consume(key: string, now?: Date): RateLimitResult;
}

interface WindowEntry {
  count: number;
  startsAt: number;
}

export function createFixedWindowRateLimiter(
  options: {
    limit?: number;
    windowMs?: number;
  } = {},
): RateLimiter {
  const limit = options.limit ?? 60;
  const windowMs = options.windowMs ?? 60_000;
  const entries = new Map<string, WindowEntry>();

  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) {
    throw new RangeError("Rate limits require positive integer limit and windowMs values.");
  }

  return {
    consume(key, now = new Date()) {
      const timestamp = now.getTime();
      const existing = entries.get(key);
      const entry =
        !existing || timestamp >= existing.startsAt + windowMs
          ? { count: 0, startsAt: timestamp }
          : existing;
      entry.count += 1;
      entries.set(key, entry);

      return {
        allowed: entry.count <= limit,
        limit,
        remaining: Math.max(0, limit - entry.count),
        resetAt: new Date(entry.startsAt + windowMs),
      };
    },
  };
}
