import { describe, expect, test } from "vitest";

import nextConfig from "../next.config";

describe("web security headers", () => {
  test("applies the browser security baseline to every route", async () => {
    const routes = await nextConfig.headers?.();
    const headers = new Map(routes?.[0]?.headers.map((header) => [header.key, header.value]));

    expect(routes?.[0]?.source).toBe("/(.*)");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("Content-Security-Policy")).toContain("object-src 'none'");
    expect(headers.get("Permissions-Policy")).toContain("geolocation=()");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });
});
