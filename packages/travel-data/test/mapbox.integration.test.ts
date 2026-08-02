import { describe, expect, test } from "vitest";

import {
  createGeocodeOperation,
  createRouteOperation,
  mapContextOperation,
  MemoryTravelDataCache,
  TravelDataCoordinator,
  type ProviderSuccess,
  type RouteInput,
  type RouteValue,
  type TravelDataTelemetryEvent,
} from "../src/index.js";
import {
  createLaunchMapsProviderBundle,
  MapboxGeocodingAdapter,
  MapboxRoutingAdapter,
  readLaunchMapsConfig,
} from "../src/server/index.js";
import { FixtureTravelDataAdapter } from "../src/testing.js";
import ambiguousGeocodeFixture from "./fixtures/mapbox/geocode-ambiguous.json";
import tokyoGeocodeFixture from "./fixtures/mapbox/geocode-tokyo.json";
import newYorkDrivingFixture from "./fixtures/mapbox/route-new-york-driving.json";
import parisWalkingFixture from "./fixtures/mapbox/route-paris-walking.json";
import unavailableRouteFixture from "./fixtures/mapbox/route-unavailable.json";

const accessToken = "pk.fixture-mapbox-server-token";
const baseUrl = "https://localhost";
const fixtureNow = new Date("2026-07-28T00:00:00.000Z");
const parisRoute: RouteInput = {
  mode: "walking",
  waypoints: [
    { latitude: 48.8584, longitude: 2.2945 },
    { latitude: 48.8661, longitude: 2.3125 },
  ],
};

function response(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status,
  });
}

function fixtureFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    return handler(url, init);
  }) as typeof fetch;
}

function context() {
  return {
    requestId: "fixture-request",
    signal: new AbortController().signal,
  };
}

function routeSuccess(provider: string): ProviderSuccess<RouteValue> {
  return {
    operation: "maps.route",
    provider,
    sources: [
      {
        attributionText: "Approved self-hosted fixture",
        license: "ODbL fixture review",
        offlineUseAllowed: false,
        provider,
        redistributionAllowed: true,
        retrievedAt: fixtureNow.toISOString(),
        sourceUrl: "https://fixtures.example/routes",
      },
    ],
    status: "success",
    value: {
      availability: "available",
      confidence: {
        explanation: "Recorded fixture route.",
        level: "provider_estimate",
      },
      distanceMeters: 1800,
      durationSeconds: 1400,
      mode: "walking",
      retrievedAt: fixtureNow.toISOString(),
      trafficBasis: "none",
      waypoints: parisRoute.waypoints,
    },
  };
}

describe("Mapbox launch provider adapters", () => {
  test("reads server configuration and returns provider-neutral map context without exposing the key", async () => {
    const config = readLaunchMapsConfig({
      MAPS_API_KEY: accessToken,
      MAPS_PROVIDER: "mapbox",
    });
    const providers = createLaunchMapsProviderBundle(config, {
      baseUrl,
      clock: () => fixtureNow,
      fetch: fixtureFetch(() => response({})),
    });
    const result = await new TravelDataCoordinator(mapContextOperation, {
      primary: providers.map,
    }).execute({
      center: { latitude: 1.3521, longitude: 103.8198 },
      style: "streets",
      zoom: 12,
    });

    expect(result.status).toBe("success");
    expect(result.status === "success" && result.value).toMatchObject({
      attribution: { text: "© Mapbox © OpenStreetMap" },
      availability: "available",
      offlineUseAllowed: false,
      projection: "mercator",
    });
    expect(JSON.stringify(providers)).not.toContain(accessToken);
  });

  test("normalizes a permanent Tokyo geocode and caches only the storage-approved result", async () => {
    const urls: URL[] = [];
    const adapter = new MapboxGeocodingAdapter({
      accessToken,
      baseUrl,
      clock: () => fixtureNow,
      fetch: fixtureFetch((url) => {
        urls.push(url);
        return response(tokyoGeocodeFixture, 200, {
          "x-rate-limit-limit": "300",
          "x-rate-limit-remaining": "299",
        });
      }),
      storage: "permanent",
    });
    const coordinator = new TravelDataCoordinator(
      createGeocodeOperation("permanent"),
      { primary: adapter },
      { cache: new MemoryTravelDataCache(), clock: () => fixtureNow },
    );

    const first = await coordinator.execute(
      { countryCodes: ["JP"], kind: "forward", query: "Tokyo" },
      { locale: "en" },
    );
    const cached = await coordinator.execute(
      { countryCodes: ["JP"], kind: "forward", query: "Tokyo" },
      { locale: "en" },
    );

    expect(first.status).toBe("success");
    expect(first.status === "success" && first.value).toMatchObject({
      matches: [
        {
          confidence: "high",
          countryCode: "JP",
          name: "Tokyo",
        },
      ],
      resolution: "resolved",
      storage: "permanent",
    });
    expect(cached.status === "success" && cached.freshness.cache).toBe("hit");
    expect(urls).toHaveLength(1);
    expect(urls[0]?.searchParams.get("permanent")).toBe("true");
    expect(urls[0]?.searchParams.get("access_token")).toBe(accessToken);
  });

  test("never caches temporary geocodes and surfaces ambiguous matches explicitly", async () => {
    let calls = 0;
    const adapter = new MapboxGeocodingAdapter({
      accessToken,
      baseUrl,
      clock: () => fixtureNow,
      fetch: fixtureFetch(() => {
        calls += 1;
        return response(ambiguousGeocodeFixture);
      }),
      storage: "temporary",
    });
    const coordinator = new TravelDataCoordinator(
      createGeocodeOperation("temporary"),
      { primary: adapter },
      { cache: new MemoryTravelDataCache(), clock: () => fixtureNow },
    );

    const first = await coordinator.execute({ kind: "forward", query: "Springfield" });
    await coordinator.execute({ kind: "forward", query: "Springfield" });

    expect(first.status).toBe("success");
    expect(first.status === "success" && first.value.resolution).toBe("ambiguous");
    expect(first.status === "success" && first.warnings).toContain(
      "Geocoding returned multiple or low-confidence matches; user confirmation is required.",
    );
    expect(calls).toBe(2);
  });

  test("normalizes representative Paris walking and New York traffic-aware routes", async () => {
    const fixtures = [parisWalkingFixture, newYorkDrivingFixture];
    const adapter = new MapboxRoutingAdapter({
      accessToken,
      baseUrl,
      clock: () => fixtureNow,
      fetch: fixtureFetch((url) => {
        const fixture = url.pathname.includes("driving-traffic") ? fixtures[1] : fixtures[0];
        return response(fixture, 200, { "x-rate-limit-remaining": "298" });
      }),
    });

    const walking = await adapter.execute(parisRoute, context());
    const driving = await adapter.execute(
      {
        mode: "driving",
        trafficAware: true,
        waypoints: [
          { latitude: 40.7128, longitude: -74.006 },
          { latitude: 40.6782, longitude: -73.9442 },
        ],
      },
      context(),
    );

    expect(walking.status).toBe("success");
    expect(walking.status === "success" && walking.value).toMatchObject({
      availability: "available",
      distanceMeters: 1820.4,
      durationSeconds: 1420.8,
      mode: "walking",
      retrievedAt: fixtureNow.toISOString(),
      trafficBasis: "none",
    });
    expect(walking.status === "success" && walking.sources[0]).toMatchObject({
      attributionText: "© Mapbox © OpenStreetMap",
      offlineUseAllowed: false,
      provider: "mapbox",
    });
    expect(driving.status === "success" && driving.value.trafficBasis).toBe(
      "current_and_historical",
    );
  });

  test("returns explicit route-unavailable and rate-limit states", async () => {
    const unavailable = new MapboxRoutingAdapter({
      accessToken,
      baseUrl,
      fetch: fixtureFetch(() => response(unavailableRouteFixture)),
    });
    const limited = new MapboxRoutingAdapter({
      accessToken,
      baseUrl,
      clock: () => fixtureNow,
      fetch: fixtureFetch(() =>
        response({ code: "TooManyRequests" }, 429, {
          "retry-after": "2",
          "x-rate-limit-remaining": "0",
        }),
      ),
    });

    const noRoute = await unavailable.execute(parisRoute, context());
    const quota = await limited.execute(parisRoute, context());

    expect(noRoute).toMatchObject({
      reason: "unsupported_coverage",
      status: "unavailable",
    });
    expect(quota).toMatchObject({
      reason: "rate_limited",
      remaining: 0,
      retryAfterMs: 2000,
      status: "quota",
    });
  });

  test("bounds a hanging request with the coordinator timeout", async () => {
    const adapter = new MapboxRoutingAdapter({
      accessToken,
      baseUrl,
      fetch: fixtureFetch(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) return;
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      ),
    });
    const baseOperation = createRouteOperation();
    const operation = {
      ...baseOperation,
      executionPolicy: {
        ...baseOperation.executionPolicy,
        retry: { ...baseOperation.executionPolicy.retry, maxAttempts: 1 },
        timeoutMs: 5,
      },
    };

    const result = await new TravelDataCoordinator(operation, { primary: adapter }).execute(
      parisRoute,
    );

    expect(result.status).toBe("error");
    expect(result.status === "error" && result.error.code).toBe("timeout");
  });

  test("serves stale route data while revalidating and refreshes it once", async () => {
    let now = new Date(fixtureNow);
    let calls = 0;
    const adapter = new MapboxRoutingAdapter({
      accessToken,
      baseUrl,
      clock: () => new Date(now),
      fetch: fixtureFetch(() => {
        calls += 1;
        return response(calls === 1 ? parisWalkingFixture : newYorkDrivingFixture);
      }),
    });
    const coordinator = new TravelDataCoordinator(
      createRouteOperation(),
      { primary: adapter },
      { cache: new MemoryTravelDataCache(), clock: () => new Date(now) },
    );

    await coordinator.execute(parisRoute);
    now = new Date("2026-07-28T00:15:00.001Z");
    const stale = await coordinator.execute(parisRoute);

    expect(stale.status).toBe("stale");
    expect(stale.status === "stale" && stale.value.distanceMeters).toBe(1820.4);
    expect(stale.status === "stale" && stale.freshness.revalidating).toBe(true);
    await coordinator.waitForRevalidations();

    const refreshed = await coordinator.execute(parisRoute);
    expect(refreshed.status === "success" && refreshed.value.distanceMeters).toBe(9410.2);
    expect(calls).toBe(2);
  });

  test("uses only an explicitly accepted route fallback and redacts sensitive inputs from telemetry", async () => {
    const telemetry: TravelDataTelemetryEvent[] = [];
    const primary = new MapboxRoutingAdapter({
      accessToken,
      baseUrl,
      fetch: fixtureFetch(() => response({ code: "ServerError" }, 503)),
    });
    const fallback = new FixtureTravelDataAdapter<RouteInput, RouteValue>({
      dataClass: "route",
      operation: "maps.route",
      provider: "self-hosted-fixture",
      steps: [{ result: routeSuccess("self-hosted-fixture") }],
    });
    const operation = createRouteOperation({
      accepts: ({ candidate }) =>
        candidate.provider === "self-hosted-fixture" &&
        candidate.sources.every((item) => item.redistributionAllowed),
      triggers: ["provider_unavailable"],
    });
    const result = await new TravelDataCoordinator(
      operation,
      { fallbacks: [fallback], primary },
      {
        sleep: async () => undefined,
        telemetry: (event) => {
          telemetry.push(event);
        },
      },
    ).execute(parisRoute, { requestId: "safe-correlation-id" });

    expect(result.status).toBe("success");
    expect(result.provider).toBe("self-hosted-fixture");
    expect(result.fallbackFrom).toBe("mapbox");
    const serializedTelemetry = JSON.stringify(telemetry);
    expect(serializedTelemetry).not.toContain(accessToken);
    expect(serializedTelemetry).not.toContain("48.8584");
    expect(serializedTelemetry).not.toContain("2.2945");
  });
});
