import { describe, expect, test } from "vitest";

import * as travelData from "../src/index.js";
import {
  climateOperation,
  convertCurrencyEstimate,
  createHolidayOperation,
  currencyRateOperation,
  divideCurrencyRates,
  launchDestinationCodes,
  MemoryTravelDataCache,
  TravelDataCoordinator,
  travelAdvisoryOperation,
  weatherForecastOperation,
  type ClimateInput,
  type HolidayInput,
  type OfficialSourceCategory,
  type WeatherForecastInput,
} from "../src/index.js";
import {
  CalendarificHolidayAdapter,
  createLaunchPracticalDataProviderBundle,
  EcbCurrencyAdapter,
  GovUkTravelAdvisoryAdapter,
  OfficialSourceRegistryAdapter,
  OpenMeteoClimateAdapter,
  OpenMeteoForecastAdapter,
  readLaunchPracticalDataConfig,
} from "../src/server/index.js";
import holidayFixture from "./fixtures/calendarific/holidays-tokyo.json";
import { launchRatesCsv as ecbFixture } from "./fixtures/ecb/launch-rates.js";
import climateFixture from "./fixtures/open-meteo/climate-sydney.json";
import forecastFixture from "./fixtures/open-meteo/forecast-singapore.json";
import advisoryFixture from "./fixtures/govuk/advisory-thailand.json";

const weatherKey = "weather-fixture-server-key";
const holidayKey = "holiday-fixture-server-key";
const fixtureNow = new Date("2026-07-29T12:00:00.000Z");
const weatherInput: WeatherForecastInput = {
  coordinates: { latitude: 1.3521, longitude: 103.8198 },
  endDate: "2026-08-01",
  startDate: "2026-08-01",
  timezone: "Asia/Singapore",
};
const climateInput: ClimateInput = {
  coordinates: { latitude: -33.8688, longitude: 151.2093 },
  endDate: "2025-07-02",
  models: ["CMCC_CM2_VHR4", "MRI_AGCM3_2_S"],
  startDate: "2025-07-01",
  timezone: "Australia/Sydney",
};
const holidayInput: HolidayInput = {
  countryCode: "JP",
  locale: "en",
  subdivision: "JP-13",
  year: 2026,
};

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status,
  });
}

function textResponse(body: string, status = 200, headers: HeadersInit = {}) {
  return new Response(body, { headers: { "content-type": "text/csv", ...headers }, status });
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
  return { requestId: "launch-provider-fixture", signal: new AbortController().signal };
}

describe("launch practical-data provider configuration", () => {
  test("requires the approved opt-in providers and keeps credentials out of serialized bundles", () => {
    const config = readLaunchPracticalDataConfig({
      ADVISORY_PROVIDER: "govuk",
      CURRENCY_PROVIDER: "ecb",
      HOLIDAY_API_KEY: holidayKey,
      HOLIDAY_PROVIDER: "calendarific",
      WEATHER_API_KEY: weatherKey,
      WEATHER_PROVIDER: "open-meteo",
    });
    const bundle = createLaunchPracticalDataProviderBundle(config, {
      calendarificBaseUrl: "https://localhost/api/v2",
      clock: () => fixtureNow,
      ecbBaseUrl: "https://localhost/service/data/EXR",
      fetch: fixtureFetch(() => jsonResponse({})),
      govUkBaseUrl: "https://localhost/api/content",
      openMeteoClimateBaseUrl: "https://localhost/climate",
      openMeteoForecastBaseUrl: "https://localhost/forecast",
    });

    expect(Object.keys(bundle.officialSources).toSorted()).toEqual([
      "closure",
      "emergency",
      "event",
      "holiday",
      "visa",
      "weather_alert",
    ]);
    expect(JSON.stringify(bundle)).not.toContain(weatherKey);
    expect(JSON.stringify(bundle)).not.toContain(holidayKey);
    expect(() =>
      readLaunchPracticalDataConfig({
        ADVISORY_PROVIDER: "govuk",
        CURRENCY_PROVIDER: "ecb",
        HOLIDAY_API_KEY: holidayKey,
        HOLIDAY_PROVIDER: "nager-date",
        WEATHER_API_KEY: weatherKey,
        WEATHER_PROVIDER: "open-meteo",
      }),
    ).toThrow("HOLIDAY_PROVIDER must be set to the approved launch provider: calendarific.");
  });

  test("keeps concrete providers outside the root and browser-safe package export", () => {
    expect(Object.keys(travelData)).not.toEqual(
      expect.arrayContaining([
        "CalendarificHolidayAdapter",
        "EcbCurrencyAdapter",
        "GovUkTravelAdvisoryAdapter",
        "OpenMeteoForecastAdapter",
      ]),
    );
    expect(JSON.stringify(createHolidayOperation())).not.toMatch(
      /Calendarific|OpenMeteo|GovUk|EcbCurrency|API_KEY/,
    );
  });
});

describe("Open-Meteo launch adapters", () => {
  test("normalizes Singapore forecast units, freshness, source, and availability", async () => {
    const urls: URL[] = [];
    let redirect: RequestRedirect | undefined;
    const adapter = new OpenMeteoForecastAdapter({
      apiKey: weatherKey,
      clock: () => fixtureNow,
      fetch: fixtureFetch((url, init) => {
        urls.push(url);
        redirect = init?.redirect;
        return jsonResponse(forecastFixture);
      }),
      forecastBaseUrl: "https://localhost/forecast",
    });
    const result = await new TravelDataCoordinator(
      weatherForecastOperation,
      { primary: adapter },
      { clock: () => fixtureNow },
    ).execute(weatherInput, { region: "SG" });

    expect(result).toMatchObject({ status: "success" });
    expect(result.status === "success" && result.value).toMatchObject({
      availability: "available",
      model: "best_match",
      period: { endsAt: "2026-08-01T02:00", startsAt: "2026-08-01T00:00" },
      timezone: "Asia/Singapore",
      units: {
        precipitation: "millimeter",
        temperature: "celsius",
        windSpeed: "kilometer_per_hour",
      },
    });
    expect(result.status === "success" && result.value.points[2]).toMatchObject({
      precipitationMillimeters: 0.2,
      temperatureCelsius: 25.5,
      weatherCode: 51,
    });
    expect(result.status === "success" && result.sources[0]).toMatchObject({
      offlineUseAllowed: true,
      provider: "open-meteo",
      redistributionAllowed: true,
      sourceKind: "licensed_provider",
    });
    expect(urls[0]?.searchParams.get("temperature_unit")).toBe("celsius");
    expect(urls[0]?.searchParams.get("apikey")).toBe(weatherKey);
    expect(redirect).toBe("error");
    expect(JSON.stringify(result)).not.toContain(weatherKey);
  });

  test("preserves conflicting Sydney climate models as separate uncertain series", async () => {
    const adapter = new OpenMeteoClimateAdapter({
      apiKey: weatherKey,
      climateBaseUrl: "https://localhost/climate",
      clock: () => fixtureNow,
      fetch: fixtureFetch(() => jsonResponse(climateFixture)),
    });
    const result = await new TravelDataCoordinator(
      climateOperation,
      { primary: adapter },
      { clock: () => fixtureNow },
    ).execute(climateInput, { region: "AU" });

    expect(result).toMatchObject({ status: "success" });
    expect(result.status === "success" && result.value.series).toHaveLength(2);
    expect(
      result.status === "success" && result.value.series[0]?.points[0]?.meanTemperatureCelsius,
    ).toBe(13.4);
    expect(
      result.status === "success" && result.value.series[1]?.points[0]?.meanTemperatureCelsius,
    ).toBe(15.6);
    expect(result.status === "success" && result.value.warning).toContain("compare models");
    expect(result.status === "success" && result.sources[0]?.sourceUrl).toBe(
      "https://open-meteo.com/en/docs/climate-api",
    );
  });

  test("returns stale cached forecasts while revalidating after the 30-minute freshness window", async () => {
    let now = new Date(fixtureNow);
    const adapter = new OpenMeteoForecastAdapter({
      apiKey: weatherKey,
      clock: () => now,
      fetch: fixtureFetch(() => jsonResponse(forecastFixture)),
      forecastBaseUrl: "https://localhost/forecast",
    });
    const coordinator = new TravelDataCoordinator(
      weatherForecastOperation,
      { primary: adapter },
      { cache: new MemoryTravelDataCache(), clock: () => now },
    );

    expect((await coordinator.execute(weatherInput)).status).toBe("success");
    now = new Date(fixtureNow.getTime() + 31 * 60_000);
    const stale = await coordinator.execute(weatherInput);
    expect(stale.status).toBe("stale");
    expect(stale.status === "stale" && stale.freshness).toMatchObject({
      revalidating: true,
      state: "stale",
    });
    await coordinator.waitForRevalidations();
  });

  test("maps quota, invalid payload, and timeout without leaking provider details", async () => {
    const quota = await new OpenMeteoForecastAdapter({
      apiKey: weatherKey,
      clock: () => fixtureNow,
      fetch: fixtureFetch(() => jsonResponse({ reason: "customer-secret detail" }, 429)),
      forecastBaseUrl: "https://localhost/forecast",
    }).execute(weatherInput, context());
    expect(quota).toMatchObject({ reason: "rate_limited", status: "quota" });
    expect(JSON.stringify(quota)).not.toContain("customer-secret detail");

    const invalid = await new OpenMeteoForecastAdapter({
      apiKey: weatherKey,
      clock: () => fixtureNow,
      fetch: fixtureFetch(() => jsonResponse({ hourly: { time: [] } })),
      forecastBaseUrl: "https://localhost/forecast",
    }).execute(weatherInput, context());
    expect(invalid).toMatchObject({ error: { code: "invalid_response" }, status: "error" });

    const timeoutOperation = {
      ...weatherForecastOperation,
      cachePolicy: { ...weatherForecastOperation.cachePolicy, mode: "none" as const },
      executionPolicy: {
        ...weatherForecastOperation.executionPolicy,
        retry: { ...weatherForecastOperation.executionPolicy.retry, maxAttempts: 1 },
        timeoutMs: 5,
      },
    };
    const timeoutAdapter = new OpenMeteoForecastAdapter({
      apiKey: weatherKey,
      forecastBaseUrl: "https://localhost/forecast",
      fetch: fixtureFetch(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      ),
    });
    const timeout = await new TravelDataCoordinator(timeoutOperation, {
      primary: timeoutAdapter,
    }).execute(weatherInput);
    expect(timeout).toMatchObject({ error: { code: "timeout" }, status: "error" });
  });
});

describe("holiday, advisory, and official-source adapters", () => {
  test("normalizes Calendarific dates but keeps them provisional, online-only, and uncached", async () => {
    const urls: URL[] = [];
    const adapter = new CalendarificHolidayAdapter({
      apiKey: holidayKey,
      baseUrl: "https://localhost/api/v2",
      clock: () => fixtureNow,
      fetch: fixtureFetch((url) => {
        urls.push(url);
        return jsonResponse(holidayFixture, 200, { "x-ratelimit-remaining": "499" });
      }),
    });
    const operation = createHolidayOperation();
    const result = await new TravelDataCoordinator(
      operation,
      { primary: adapter },
      { clock: () => fixtureNow },
    ).execute(holidayInput, { region: "JP" });

    expect(operation.cachePolicy.mode).toBe("none");
    expect(result.status).toBe("success");
    expect(result.status === "success" && result.value.holidays).toEqual([
      expect.objectContaining({ date: "2026-07-20", status: "provisional", types: ["national"] }),
      expect.objectContaining({
        date: "2026-08-01",
        status: "provisional",
        types: ["local", "observance"],
      }),
    ]);
    expect(result.status === "success" && result.sources[0]).toMatchObject({
      offlineUseAllowed: false,
      redistributionAllowed: false,
      trustTier: "tier_3",
    });
    expect(urls[0]?.searchParams.get("location")).toBe("jp-13");
    expect(JSON.stringify(result)).not.toContain(holidayKey);
  });

  test("does not select an unapproved holiday fallback after quota exhaustion", async () => {
    const adapter = new CalendarificHolidayAdapter({
      apiKey: holidayKey,
      baseUrl: "https://localhost/api/v2",
      clock: () => fixtureNow,
      fetch: fixtureFetch(() => jsonResponse({ meta: { code: 429 } }, 429)),
    });
    const base = createHolidayOperation({
      accepts: () => true,
      triggers: ["rate_limited"],
    });
    const operation = {
      ...base,
      executionPolicy: {
        ...base.executionPolicy,
        retry: { ...base.executionPolicy.retry, maxAttempts: 1, retryRateLimits: false },
      },
    };
    const result = await new TravelDataCoordinator(operation, { primary: adapter }).execute(
      holidayInput,
    );

    expect(result).toMatchObject({ reason: "no_safe_fallback", status: "unavailable" });
  });

  test("ingests source-only GOV.UK advice for GB travelers and rejects nationality generalization", async () => {
    const adapter = new GovUkTravelAdvisoryAdapter({
      baseUrl: "https://localhost/api/content",
      clock: () => fixtureNow,
      fetch: fixtureFetch(() => jsonResponse(advisoryFixture)),
    });
    const result = await new TravelDataCoordinator(
      travelAdvisoryOperation,
      { primary: adapter },
      { clock: () => fixtureNow },
    ).execute({ destination: "bangkok", travelerCountryCode: "GB" });

    expect(result.status).toBe("success");
    expect(result.status === "success" && result.value).toMatchObject({
      availability: "available",
      destination: "bangkok",
      manualReviewRequired: true,
      travelerCountryCode: "GB",
    });
    expect(result.status === "success" && result.value.topicLinks).toEqual({
      entryRequirements: "https://www.gov.uk/foreign-travel-advice/thailand/entry-requirements",
      health: "https://www.gov.uk/foreign-travel-advice/thailand/health",
      safetyAndSecurity: "https://www.gov.uk/foreign-travel-advice/thailand/safety-and-security",
    });
    expect(result.status === "success" && result.sources[0]).toMatchObject({
      sourceKind: "official_authority",
      trustTier: "tier_1",
    });

    const unsupported = await adapter.execute(
      { destination: "bangkok", travelerCountryCode: "US" },
      context(),
    );
    expect(unsupported).toMatchObject({
      error: { code: "unsupported_coverage" },
      reason: "unsupported_coverage",
      status: "unavailable",
    });
  });

  test("traces every launch destination and official category to a reviewed source record", async () => {
    const categories: readonly OfficialSourceCategory[] = [
      "closure",
      "emergency",
      "event",
      "holiday",
      "visa",
      "weather_alert",
    ];
    for (const category of categories) {
      const adapter = new OfficialSourceRegistryAdapter({ category, clock: () => fixtureNow });
      for (const destination of launchDestinationCodes) {
        const result = await adapter.execute({ category, destination }, context());
        expect(result.status, `${destination}:${category}`).toBe("success");
        expect(result.status === "success" && result.value.links[0]).toMatchObject({
          category,
          reviewedAt: "2026-07-29",
        });
        expect(result.status === "success" && result.sources[0]).toMatchObject({
          sourceKind: "official_authority",
          trustTier: "tier_1",
        });
      }
    }
  });
});

describe("ECB launch currency adapter", () => {
  test("normalizes dated cross-rates and deterministic half-up estimate conversion", async () => {
    const urls: URL[] = [];
    const adapter = new EcbCurrencyAdapter({
      baseUrl: "https://localhost/service/data/EXR",
      clock: () => fixtureNow,
      fetch: fixtureFetch((url) => {
        urls.push(url);
        return textResponse(ecbFixture);
      }),
    });
    const result = await new TravelDataCoordinator(
      currencyRateOperation,
      { primary: adapter },
      { clock: () => fixtureNow },
    ).execute({ baseCurrency: "USD", quoteCurrencies: ["JPY", "EUR", "THB"] });

    expect(result.status).toBe("success");
    expect(result.status === "success" && result.value).toMatchObject({
      asOf: "2026-07-29",
      availability: "available",
      baseCurrency: "USD",
      kind: "planning_estimate",
    });
    expect(result.status === "success" && result.value.rates).toEqual([
      { quoteCurrency: "JPY", rate: divideCurrencyRates("186.27", "1.138") },
      { quoteCurrency: "EUR", rate: divideCurrencyRates("1", "1.138") },
      { quoteCurrency: "THB", rate: divideCurrencyRates("38.157", "1.138") },
    ]);
    expect(
      convertCurrencyEstimate({
        amountMinor: 123,
        baseCurrency: "USD",
        quoteCurrency: "SGD",
        rate: "1.5",
      }),
    ).toEqual({ amountMinor: 185, currency: "SGD", estimate: true, rounding: "half_up" });
    expect(result.status === "success" && result.sources[0]).toMatchObject({
      offlineUseAllowed: true,
      provider: "ecb",
      redistributionAllowed: true,
      sourceKind: "official_authority",
    });
    expect(urls[0]?.pathname).toContain("D.JPY+THB+USD.EUR.SP00.A");
  });

  test("marks an old common rate set stale and rejects incomplete payloads", async () => {
    const staleAdapter = new EcbCurrencyAdapter({
      baseUrl: "https://localhost/service/data/EXR",
      clock: () => new Date("2026-08-10T12:00:00.000Z"),
      fetch: fixtureFetch(() => textResponse(ecbFixture)),
    });
    const stale = await staleAdapter.execute(
      { baseCurrency: "EUR", quoteCurrencies: ["SGD", "JPY"] },
      context(),
    );
    expect(stale.status === "success" && stale.value.availability).toBe("stale");
    expect(stale.status === "success" && stale.sources[0]?.expiresAt).toBeUndefined();
    expect(stale.status === "success" && stale.warnings?.[0]).toContain("older than");

    const incomplete = await new EcbCurrencyAdapter({
      baseUrl: "https://localhost/service/data/EXR",
      clock: () => fixtureNow,
      fetch: fixtureFetch(() => textResponse(ecbFixture.replace(/^.*JPY.*\n/m, ""))),
    }).execute({ baseCurrency: "EUR", quoteCurrencies: ["JPY"] }, context());
    expect(incomplete).toMatchObject({ error: { code: "invalid_response" }, status: "error" });
  });
});
