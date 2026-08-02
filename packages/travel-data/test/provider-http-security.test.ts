import { describe, expect, test } from "vitest";

import { normalizedProviderBaseUrl } from "../src/server/provider-http.js";

describe("provider HTTP security boundary", () => {
  test("allows only the approved HTTPS provider host", () => {
    expect(normalizedProviderBaseUrl("https://api.mapbox.com/", "Mapbox", ["api.mapbox.com"])).toBe(
      "https://api.mapbox.com",
    );
    expect(() =>
      normalizedProviderBaseUrl("https://169.254.169.254/latest/meta-data", "Mapbox", [
        "api.mapbox.com",
      ]),
    ).toThrow(/approved provider host/);
    expect(() =>
      normalizedProviderBaseUrl("https://metadata.internal.test", "Mapbox", ["api.mapbox.com"]),
    ).toThrow(/approved provider host/);
    expect(() =>
      normalizedProviderBaseUrl("https://api.mapbox.com:444", "Mapbox", ["api.mapbox.com"]),
    ).toThrow(/approved provider host/);
    expect(() =>
      normalizedProviderBaseUrl("https://user:password@api.mapbox.com", "Mapbox", [
        "api.mapbox.com",
      ]),
    ).toThrow(/credential-free/);
  });

  test("permits HTTP only for explicit loopback fixtures", () => {
    expect(
      normalizedProviderBaseUrl("http://127.0.0.1:8787/", "Fixture", ["api.example.com"]),
    ).toBe("http://127.0.0.1:8787");
    expect(() =>
      normalizedProviderBaseUrl("ftp://localhost/", "Fixture", ["api.example.com"]),
    ).toThrow(/HTTP/);
    expect(() =>
      normalizedProviderBaseUrl("http://api.example.com/", "Provider", ["api.example.com"]),
    ).toThrow(/HTTPS/);
  });
});
