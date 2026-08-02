import { describe, expect, test } from "vitest";

import {
  createFixedWindowRateLimiter,
  parseTrustedProxyHops,
  rateLimitClientAddress,
} from "../src/rate-limit.js";

describe("rate-limit trust boundary", () => {
  test("selects forwarded addresses only from the configured proxy depth", () => {
    expect(
      rateLimitClientAddress({
        forwardedFor: "192.0.2.10, 198.51.100.20",
        remoteAddress: "203.0.113.30",
        trustedProxyHops: 0,
      }),
    ).toBe("203.0.113.30");
    expect(
      rateLimitClientAddress({
        forwardedFor: "192.0.2.10, 198.51.100.20",
        remoteAddress: "203.0.113.30",
        trustedProxyHops: 1,
      }),
    ).toBe("198.51.100.20");
    expect(
      rateLimitClientAddress({
        forwardedFor: "attacker-controlled",
        remoteAddress: "203.0.113.30",
        trustedProxyHops: 1,
      }),
    ).toBe("203.0.113.30");
  });

  test("validates proxy configuration and bounds in-memory identities", () => {
    expect(parseTrustedProxyHops(undefined)).toBe(0);
    expect(parseTrustedProxyHops("2")).toBe(2);
    expect(() => parseTrustedProxyHops("-1")).toThrow(/integer from 0 to 10/);
    expect(() => parseTrustedProxyHops("11")).toThrow(/integer from 0 to 10/);

    const limiter = createFixedWindowRateLimiter({ limit: 1, maxEntries: 2 });
    expect(limiter.consume("one").allowed).toBe(true);
    expect(limiter.consume("two").allowed).toBe(true);
    expect(limiter.consume("three").allowed).toBe(true);
    expect(limiter.consume("one").allowed).toBe(true);
  });
});
