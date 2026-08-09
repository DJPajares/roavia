import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runReleaseSmoke } from "./smoke.mjs";

const token = "release-smoke-token-that-is-longer-than-32-characters";

function response(body, init) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), init);
}

function healthyFetch(url, init) {
  const pathname = new URL(url).pathname;
  if (pathname === "/health" && url.startsWith("https://app.")) {
    return Promise.resolve(response({ data: { service: "web", status: "ok" } }));
  }
  if (pathname === "/health") {
    return Promise.resolve(response({ data: { service: "api", status: "ok" } }));
  }
  if (pathname === "/ready") {
    return Promise.resolve(
      response({ data: { checks: { database: "ok", queue: "ok" }, status: "ready" } }),
    );
  }
  if (pathname === "/internal/metrics") {
    assert.equal(init.headers.authorization, `Bearer ${token}`);
    return Promise.resolve(
      response("# TYPE roavia_api_requests_total counter\nroavia_api_requests_total 1"),
    );
  }
  if (pathname === "/manifest.webmanifest") {
    return Promise.resolve(response({ name: "Roavia", start_url: "/" }));
  }
  return Promise.resolve(response("missing", { status: 404 }));
}

describe("release smoke", () => {
  it("verifies public health, dependency readiness, metrics, and the PWA manifest", async () => {
    const result = await runReleaseSmoke({
      apiBaseUrl: "https://api.roavia.test",
      fetchImpl: healthyFetch,
      metricsToken: token,
      webBaseUrl: "https://app.roavia.test",
    });

    assert.equal(result.checks, 5);
  });

  it("fails when runtime dependencies are not ready", async () => {
    await assert.rejects(
      () =>
        runReleaseSmoke({
          apiBaseUrl: "https://api.roavia.test",
          fetchImpl: (url, init) => {
            if (new URL(url).pathname === "/ready") {
              return Promise.resolve(
                response({ data: { status: "unavailable" } }, { status: 503 }),
              );
            }
            return healthyFetch(url, init);
          },
          metricsToken: token,
          webBaseUrl: "https://app.roavia.test",
        }),
      /returned 503/,
    );
  });

  it("rejects non-TLS production URLs", async () => {
    await assert.rejects(
      () =>
        runReleaseSmoke({
          apiBaseUrl: "http://api.roavia.test",
          fetchImpl: healthyFetch,
          metricsToken: token,
          webBaseUrl: "https://app.roavia.test",
        }),
      /must use HTTPS/,
    );
  });
});
