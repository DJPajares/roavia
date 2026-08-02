import { isIP } from "node:net";

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
    maxEntries?: number;
    windowMs?: number;
  } = {},
): RateLimiter {
  const limit = options.limit ?? 60;
  const maxEntries = options.maxEntries ?? 10_000;
  const windowMs = options.windowMs ?? 60_000;
  const entries = new Map<string, WindowEntry>();
  let lastPrunedAt = 0;

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    !Number.isInteger(maxEntries) ||
    maxEntries < 1 ||
    !Number.isInteger(windowMs) ||
    windowMs < 1
  ) {
    throw new RangeError(
      "Rate limits require positive integer limit, maxEntries, and windowMs values.",
    );
  }

  return {
    consume(key, now = new Date()) {
      const timestamp = now.getTime();
      const existing = entries.get(key);
      if (!existing && (timestamp - lastPrunedAt >= windowMs || entries.size >= maxEntries)) {
        for (const [entryKey, entry] of entries) {
          if (timestamp >= entry.startsAt + windowMs) entries.delete(entryKey);
        }
        lastPrunedAt = timestamp;
      }
      if (!existing && entries.size >= maxEntries) {
        const oldestKey = entries.keys().next().value as string | undefined;
        if (oldestKey) entries.delete(oldestKey);
      }
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

export function parseTrustedProxyHops(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 0;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error("TRUSTED_PROXY_HOPS must be an integer from 0 to 10.");
  }
  const hops = Number(value);
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > 10) {
    throw new Error("TRUSTED_PROXY_HOPS must be an integer from 0 to 10.");
  }
  return hops;
}

export function rateLimitClientAddress(input: {
  forwardedFor?: string;
  remoteAddress?: string;
  trustedProxyHops: number;
}): string {
  if (!Number.isInteger(input.trustedProxyHops) || input.trustedProxyHops < 0) {
    throw new RangeError("Trusted proxy hops must be a non-negative integer.");
  }
  if (input.trustedProxyHops > 0 && input.forwardedFor) {
    const forwarded = input.forwardedFor.split(",").map((value) => value.trim());
    const candidate = forwarded.at(-input.trustedProxyHops);
    if (candidate && isIP(candidate) !== 0) return candidate;
  }
  if (input.remoteAddress && isIP(input.remoteAddress) !== 0) return input.remoteAddress;
  return "unresolved-client";
}
