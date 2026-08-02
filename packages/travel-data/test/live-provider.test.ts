import { describe, expect, test } from "vitest";

import {
  evaluateLiveConditions,
  type ProviderAdapterResult,
  type TravelDataAdapter,
  type WeatherForecastInput,
  type WeatherForecastValue,
} from "../src/index.js";
import { OpenMeteoLiveConditionSource } from "../src/server/index.js";

const now = new Date("2026-08-02T08:00:00.000Z");
const placeId = "47000000-0000-4000-8000-000000000031";
const tripId = "47000000-0000-4000-8000-000000000032";
const target = {
  coordinates: { latitude: 1.3521, longitude: 103.8198 },
  itineraryItemId: "47000000-0000-4000-8000-000000000033",
  localDate: "2026-08-05",
  placeId,
  timezone: "Asia/Singapore",
  tripId,
};

function fixtureAdapter(
  result: ProviderAdapterResult<WeatherForecastValue>,
): TravelDataAdapter<WeatherForecastInput, WeatherForecastValue> {
  return {
    dataClass: "weather_forecast",
    execute: async () => result,
    operation: "weather.forecast",
    provider: "open-meteo",
  };
}

function forecastResult(
  availability: WeatherForecastValue["availability"] = "available",
): ProviderAdapterResult<WeatherForecastValue> {
  return {
    operation: "weather.forecast",
    provider: "open-meteo",
    sources: [
      {
        offlineUseAllowed: true,
        provider: "open-meteo",
        redistributionAllowed: true,
        retrievedAt: "2026-08-02T07:55:00.000Z",
        sourceKind: "licensed_provider",
        sourceUrl: "https://open-meteo.com/en/docs",
        title: "Open-Meteo forecast",
      },
    ],
    status: "success",
    value: {
      availability,
      coordinates: target.coordinates,
      model: "best_match",
      period: { endsAt: "2026-08-05T01:00", startsAt: "2026-08-05T00:00" },
      points: [
        {
          at: "2026-08-05T00:00",
          precipitationMillimeters: 14,
          precipitationProbabilityPercent: 82,
          relativeHumidityPercent: 93,
          temperatureCelsius: 26,
          ultravioletIndex: 0,
          weatherCode: 65,
          windSpeedKilometersPerHour: 22,
        },
      ],
      timezone: "Asia/Singapore",
      units: {
        precipitation: "millimeter",
        precipitationProbability: "percent",
        relativeHumidity: "percent",
        temperature: "celsius",
        ultravioletIndex: "index",
        windSpeed: "kilometer_per_hour",
      },
    },
  };
}

describe("Open-Meteo live-condition source", () => {
  test("maps a changed severe forecast into a sourced impact candidate", async () => {
    const source = new OpenMeteoLiveConditionSource(fixtureAdapter(forecastResult()), {
      clock: () => now,
      jitter: () => 0,
      sleep: async () => undefined,
    });
    const batches = await source.refresh({
      requestId: "weather-change-fixture",
      signal: new AbortController().signal,
      targets: [target],
    });
    const evaluation = evaluateLiveConditions([target], batches, { now });

    expect(batches).toEqual([
      expect.objectContaining({
        events: [
          expect.objectContaining({
            confidence: 0.82,
            eventId: `forecast:${placeId}:2026-08-05`,
            severity: "high",
          }),
        ],
        placeId,
        state: "fresh",
      }),
    ]);
    expect(evaluation.impacts).toEqual([
      expect.objectContaining({
        itineraryItemId: target.itineraryItemId,
        sourceUrl: "https://open-meteo.com/en/docs",
      }),
    ]);
  });

  test("keeps partial forecasts below the advisory confidence threshold", async () => {
    const source = new OpenMeteoLiveConditionSource(fixtureAdapter(forecastResult("partial")), {
      clock: () => now,
    });
    const batches = await source.refresh({
      requestId: "partial-weather-fixture",
      signal: new AbortController().signal,
      targets: [target],
    });
    const evaluation = evaluateLiveConditions([target], batches, { now });

    expect(batches[0]?.events[0]?.confidence).toBe(0.6);
    expect(evaluation.impacts).toEqual([]);
    expect(evaluation.ignored.lowConfidence).toBe(1);
  });

  test("normalizes provider outages without fabricating events", async () => {
    const source = new OpenMeteoLiveConditionSource(
      fixtureAdapter({
        error: { code: "unavailable", message: "Redacted provider outage.", retryable: true },
        operation: "weather.forecast",
        provider: "open-meteo",
        status: "error",
      }),
      { clock: () => now, sleep: async () => undefined },
    );
    const batches = await source.refresh({
      requestId: "outage-weather-fixture",
      signal: new AbortController().signal,
      targets: [target],
    });

    expect(batches).toEqual([
      {
        checkedAt: now.toISOString(),
        events: [],
        kind: "weather",
        placeId,
        provider: "open-meteo",
        state: "unavailable",
      },
    ]);
  });
});
