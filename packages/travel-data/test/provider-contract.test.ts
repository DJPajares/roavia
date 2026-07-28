import { describe, expect, test } from "vitest";

import {
  createTravelDataCacheKey,
  defaultProviderExecutionPolicy,
  MemoryTravelDataCache,
  TravelDataCoordinator,
  type ProviderAdapterResult,
  type ProviderSuccess,
  type TravelDataOperation,
  type TravelDataTelemetryEvent,
} from "../src/index.js";
import { FixtureTravelDataAdapter } from "../src/testing.js";

interface FixtureInput {
  placeId: string;
}

interface FixtureValue {
  label: string;
  optionalDetail?: string;
}

const operationName = "place.details";

function source(provider: string) {
  return {
    attributionText: `${provider} fixture`,
    license: "fixture-only",
    offlineUseAllowed: false,
    provider,
    providerRecordId: "fixture-record",
    redistributionAllowed: true,
    retrievedAt: "2026-07-28T00:00:00.000Z",
    sourceUrl: `https://fixtures.example/${provider}`,
  };
}

function success(provider: string, label: string): ProviderSuccess<FixtureValue> {
  return {
    operation: operationName,
    provider,
    sources: [source(provider)],
    status: "success",
    usage: { costUnitName: "fixture", costUnits: 0, requests: 1 },
    value: { label },
  };
}

function operation(
  overrides: Partial<TravelDataOperation<FixtureInput, FixtureValue>> = {},
): TravelDataOperation<FixtureInput, FixtureValue> {
  return {
    cacheKey: (input) => ({ placeId: input.placeId }),
    cachePolicy: {
      dataClass: "place_details",
      freshForMs: 100,
      key: "place_details.fixture",
      mode: "ephemeral",
      staleWhileRevalidateForMs: 200,
      version: 1,
    },
    dataClass: "place_details",
    executionPolicy: {
      ...defaultProviderExecutionPolicy,
      circuitBreaker: { failureThreshold: 3, openForMs: 1_000 },
      retry: {
        ...defaultProviderExecutionPolicy.retry,
        initialDelayMs: 10,
        jitterRatio: 0,
        maxAttempts: 1,
        maxDelayMs: 100,
      },
      timeoutMs: 25,
    },
    name: operationName,
    validateValue: (value): value is FixtureValue =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as Record<string, unknown>).label === "string",
    ...overrides,
  };
}

function adapter(
  provider: string,
  steps: ConstructorParameters<
    typeof FixtureTravelDataAdapter<FixtureInput, FixtureValue>
  >[0]["steps"],
) {
  return new FixtureTravelDataAdapter<FixtureInput, FixtureValue>({
    dataClass: "place_details",
    operation: operationName,
    provider,
    steps,
  });
}

describe("provider-neutral travel-data contracts", () => {
  test("normalizes success, preserves provenance, and serves a deterministic cache hit", async () => {
    const primary = adapter("fixture-primary", [{ result: success("fixture-primary", "Marina") }]);
    const telemetry: TravelDataTelemetryEvent[] = [];
    const coordinator = new TravelDataCoordinator(
      operation(),
      { primary },
      {
        cache: new MemoryTravelDataCache(),
        clock: () => new Date("2026-07-28T00:00:00.000Z"),
        telemetry: (event) => {
          telemetry.push(event);
        },
      },
    );

    const first = await coordinator.execute({ placeId: "sensitive-place-id" });
    const cached = await coordinator.execute({ placeId: "sensitive-place-id" });

    expect(first.status).toBe("success");
    expect(first.status === "success" && first.freshness.cache).toBe("network");
    expect(cached.status).toBe("success");
    expect(cached.status === "success" && cached.freshness.cache).toBe("hit");
    expect(cached.status === "success" && cached.sources[0]).toMatchObject({
      license: "fixture-only",
      providerRecordId: "fixture-record",
      sourceUrl: "https://fixtures.example/fixture-primary",
    });
    expect(primary.calls).toHaveLength(1);
    expect(JSON.stringify(telemetry)).not.toContain("sensitive-place-id");

    const left = await createTravelDataCacheKey({
      input: { b: 2, placeId: "sensitive-place-id", a: 1 },
      operation: operationName,
      policy: operation().cachePolicy,
      provider: "fixture-primary",
    });
    const right = await createTravelDataCacheKey({
      input: { placeId: "sensitive-place-id", a: 1, b: 2 },
      operation: operationName,
      policy: operation().cachePolicy,
      provider: "fixture-primary",
    });
    expect(left).toBe(right);
    expect(left).not.toContain("sensitive-place-id");
  });

  test("returns stale data immediately and refreshes it through a single background call", async () => {
    let now = new Date("2026-07-28T00:00:00.000Z");
    const primary = adapter("fixture-primary", [
      { result: success("fixture-primary", "version-one") },
      { result: success("fixture-primary", "version-two") },
    ]);
    const coordinator = new TravelDataCoordinator(
      operation(),
      { primary },
      {
        cache: new MemoryTravelDataCache(),
        clock: () => new Date(now),
      },
    );

    await coordinator.execute({ placeId: "place-1" });
    now = new Date("2026-07-28T00:00:00.101Z");
    const stale = await coordinator.execute({ placeId: "place-1" });
    const concurrentStale = await coordinator.execute({ placeId: "place-1" });

    expect(stale.status).toBe("stale");
    expect(stale.status === "stale" && stale.value.label).toBe("version-one");
    expect(stale.status === "stale" && stale.freshness.revalidating).toBe(true);
    expect(concurrentStale.status).toBe("stale");
    await coordinator.waitForRevalidations();

    const refreshed = await coordinator.execute({ placeId: "place-1" });
    expect(refreshed.status === "success" && refreshed.value.label).toBe("version-two");
    expect(primary.calls).toHaveLength(2);
  });

  test("turns a hanging fixture into a bounded timeout without leaking an exception", async () => {
    const primary = adapter("fixture-timeout", [{ waitForAbort: true }]);
    const coordinator = new TravelDataCoordinator(
      operation({
        executionPolicy: {
          ...operation().executionPolicy,
          timeoutMs: 5,
        },
      }),
      { primary },
    );

    const result = await coordinator.execute({ placeId: "place-1" });

    expect(result.status).toBe("error");
    expect(result.status === "error" && result.error).toEqual({
      code: "timeout",
      message: "Provider request exceeded its execution timeout.",
      providerCode: undefined,
      retryAfterMs: undefined,
      retryable: true,
    });
    expect(primary.calls).toHaveLength(1);
  });

  test("keeps partial values explicit and returns unsupported coverage without a call", async () => {
    const partial = adapter("fixture-partial", [
      { result: success("fixture-partial", "known-fields-only") },
    ]);
    const partialResult = await new TravelDataCoordinator(operation(), {
      primary: partial,
    }).execute({ placeId: "place-1" });
    expect(partialResult.status).toBe("success");
    expect(
      partialResult.status === "success" && partialResult.value.optionalDetail,
    ).toBeUndefined();

    const unsupported = new FixtureTravelDataAdapter<FixtureInput, FixtureValue>({
      dataClass: "place_details",
      operation: operationName,
      provider: "fixture-unsupported",
      steps: [{ result: success("fixture-unsupported", "never-called") }],
      supports: () => false,
    });
    const unsupportedResult = await new TravelDataCoordinator(operation(), {
      primary: unsupported,
    }).execute({ placeId: "place-1" });
    expect(unsupportedResult.status).toBe("unavailable");
    expect(unsupportedResult.status === "unavailable" && unsupportedResult.reason).toBe(
      "unsupported_coverage",
    );
    expect(unsupported.calls).toHaveLength(0);
  });

  test("surfaces exhausted quota and retries a bounded rate limit using retry-after", async () => {
    const exhausted = adapter("fixture-quota", [
      {
        result: {
          operation: operationName,
          provider: "fixture-quota",
          reason: "quota_exhausted",
          remaining: 0,
          resetAt: "2026-07-29T00:00:00.000Z",
          status: "quota",
        },
      },
    ]);
    const exhaustedResult = await new TravelDataCoordinator(operation(), {
      primary: exhausted,
    }).execute({ placeId: "place-1" });
    expect(exhaustedResult.status).toBe("quota");
    expect(exhausted.calls).toHaveLength(1);

    const limited = adapter("fixture-rate", [
      {
        result: {
          operation: operationName,
          provider: "fixture-rate",
          reason: "rate_limited",
          remaining: 0,
          retryAfterMs: 20,
          status: "quota",
        },
      },
      { result: success("fixture-rate", "after-backoff") },
    ]);
    const delays: number[] = [];
    const retryingOperation = operation({
      executionPolicy: {
        ...operation().executionPolicy,
        retry: { ...operation().executionPolicy.retry, maxAttempts: 2 },
      },
    });
    const retried = await new TravelDataCoordinator(
      retryingOperation,
      { primary: limited },
      {
        sleep: async (delay) => {
          delays.push(delay);
        },
      },
    ).execute({ placeId: "place-1" });

    expect(retried.status).toBe("success");
    expect(retried.attempts).toBe(2);
    expect(delays).toEqual([20]);
  });

  test("rejects invalid normalized output and never exposes the fixture exception", async () => {
    const invalidResult = {
      operation: operationName,
      provider: "fixture-invalid",
      sources: [],
      status: "success",
      value: { wrong: true },
    } as unknown as ProviderAdapterResult<FixtureValue>;
    const primary = adapter("fixture-invalid", [{ result: invalidResult }]);
    const result = await new TravelDataCoordinator(operation(), { primary }).execute({
      placeId: "place-1",
    });

    expect(result.status).toBe("error");
    expect(result.status === "error" && result.error.code).toBe("invalid_response");
    expect(result.status === "error" && result.error.message).not.toContain("wrong");
  });

  test("uses only an explicitly compatible fallback", async () => {
    const primary = adapter("fixture-primary", [
      {
        result: {
          operation: operationName,
          provider: "fixture-primary",
          reason: "provider_unavailable",
          status: "unavailable",
        },
      },
    ]);
    const fallback = adapter("fixture-fallback", [
      { result: success("fixture-fallback", "safe-fallback") },
    ]);
    const fallbackOperation = operation({
      fallback: {
        accepts: ({ candidate }) => candidate.sources.every((item) => item.redistributionAllowed),
        triggers: ["provider_unavailable"],
      },
    });

    const result = await new TravelDataCoordinator(fallbackOperation, {
      fallbacks: [fallback],
      primary,
    }).execute({ placeId: "place-1" });

    expect(result.status).toBe("success");
    expect(result.provider).toBe("fixture-fallback");
    expect(result.fallbackFrom).toBe("fixture-primary");
    expect(primary.calls).toHaveLength(1);
    expect(fallback.calls).toHaveLength(1);
  });

  test("opens the circuit after a provider outage and blocks a retry storm", async () => {
    const primary = adapter("fixture-outage", [
      {
        result: {
          operation: operationName,
          provider: "fixture-outage",
          reason: "provider_unavailable",
          status: "unavailable",
        },
      },
    ]);
    const circuitOperation = operation({
      cachePolicy: { ...operation().cachePolicy, mode: "none" },
      executionPolicy: {
        ...operation().executionPolicy,
        circuitBreaker: { failureThreshold: 1, openForMs: 1_000 },
      },
    });
    const coordinator = new TravelDataCoordinator(circuitOperation, { primary });

    const first = await coordinator.execute({ placeId: "place-1" });
    const blocked = await coordinator.execute({ placeId: "place-1" });

    expect(first.status).toBe("unavailable");
    expect(blocked.status).toBe("unavailable");
    expect(blocked.status === "unavailable" && blocked.reason).toBe("circuit_open");
    expect(primary.calls).toHaveLength(1);
  });
});
