import { MemoryTravelDataCache } from "../cache.js";
import { TravelDataCoordinator, type TravelDataCoordinatorOptions } from "../coordinator.js";
import type { TravelDataAdapter } from "../contracts.js";
import type {
  LiveConditionBatch,
  LiveConditionEvent,
  LiveConditionTarget,
  LiveImpactSeverity,
} from "../live.js";
import {
  weatherForecastOperation,
  type WeatherForecastInput,
  type WeatherForecastPoint,
  type WeatherForecastValue,
} from "../practical.js";

const severityRank: Record<LiveImpactSeverity, number> = {
  critical: 3,
  high: 2,
  low: 0,
  moderate: 1,
};

function pointSeverity(point: WeatherForecastPoint): LiveImpactSeverity {
  const code = point.weatherCode ?? 0;
  const probability = point.precipitationProbabilityPercent ?? 0;
  const precipitation = point.precipitationMillimeters ?? 0;
  const wind = point.windSpeedKilometersPerHour ?? 0;
  if (code >= 95 || wind >= 90) return "critical";
  if (
    [65, 67, 75, 82, 86].includes(code) ||
    probability >= 80 ||
    precipitation >= 25 ||
    wind >= 65
  ) {
    return "high";
  }
  if (
    (code >= 51 && code <= 63) ||
    (code >= 71 && code <= 73) ||
    [80, 81, 85].includes(code) ||
    probability >= 60 ||
    precipitation >= 10 ||
    wind >= 40
  ) {
    return "moderate";
  }
  return "low";
}

function strongestSeverity(points: readonly WeatherForecastPoint[]) {
  return points.reduce<LiveImpactSeverity>((strongest, point) => {
    const candidate = pointSeverity(point);
    return severityRank[candidate] > severityRank[strongest] ? candidate : strongest;
  }, "low");
}

function groupsByPlace(targets: readonly LiveConditionTarget[]) {
  const groups = new Map<string, LiveConditionTarget[]>();
  for (const target of targets) {
    const group = groups.get(target.placeId) ?? [];
    group.push(target);
    groups.set(target.placeId, group);
  }
  return groups;
}

export class OpenMeteoLiveConditionSource {
  private readonly clock: () => Date;
  private readonly coordinator: TravelDataCoordinator<WeatherForecastInput, WeatherForecastValue>;

  constructor(
    adapter: TravelDataAdapter<WeatherForecastInput, WeatherForecastValue>,
    options: TravelDataCoordinatorOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.coordinator = new TravelDataCoordinator(
      weatherForecastOperation,
      { primary: adapter },
      { ...options, cache: options.cache ?? new MemoryTravelDataCache() },
    );
  }

  async refresh(input: {
    requestId: string;
    signal: AbortSignal;
    targets: readonly LiveConditionTarget[];
  }): Promise<LiveConditionBatch[]> {
    const batches: LiveConditionBatch[] = [];
    for (const [placeId, targets] of groupsByPlace(input.targets)) {
      const first = targets[0];
      if (!first) continue;
      if (
        targets.some(
          (target) =>
            target.timezone !== first.timezone ||
            target.coordinates.latitude !== first.coordinates.latitude ||
            target.coordinates.longitude !== first.coordinates.longitude,
        )
      ) {
        throw new Error("Live-condition targets for one place must share location context.");
      }
      const dates = targets.map(({ localDate }) => localDate).toSorted();
      const result = await this.coordinator.execute(
        {
          coordinates: first.coordinates,
          endDate: dates.at(-1)!,
          startDate: dates[0]!,
          timezone: first.timezone,
        },
        { requestId: input.requestId, signal: input.signal },
      );
      if (result.status !== "success" && result.status !== "stale") {
        batches.push({
          checkedAt: this.clock().toISOString(),
          events: [],
          kind: "weather",
          placeId,
          provider: result.provider,
          state: "unavailable",
        });
        continue;
      }

      const source = result.sources[0];
      if (!source) throw new Error("A normalized weather forecast must preserve its source.");
      const confidence = result.value.availability === "available" ? 0.82 : 0.6;
      const events: LiveConditionEvent[] = [];
      for (const localDate of new Set(dates)) {
        const points = result.value.points.filter((point) => point.at.slice(0, 10) === localDate);
        if (points.length === 0) continue;
        const severity = strongestSeverity(points);
        events.push({
          confidence,
          endDate: localDate,
          eventId: `forecast:${placeId}:${localDate}`,
          kind: "weather",
          placeId,
          provider: result.provider,
          severity,
          source,
          staleAt: result.freshness.state === "stale" ? result.freshness.staleAt : undefined,
          startDate: localDate,
          summary:
            severity === "low"
              ? "The refreshed forecast has no material weather impact for this date."
              : `The refreshed forecast indicates ${severity} weather impact for this date.`,
          updatedAt: source.publishedAt ?? source.retrievedAt,
        });
      }
      batches.push({
        checkedAt: this.clock().toISOString(),
        events,
        kind: "weather",
        placeId,
        provider: result.provider,
        state: result.status === "stale" ? "stale" : "fresh",
      });
    }
    return batches;
  }
}

export function combineLiveConditionSources(
  ...sources: Array<{
    refresh(input: {
      requestId: string;
      signal: AbortSignal;
      targets: readonly LiveConditionTarget[];
    }): Promise<readonly LiveConditionBatch[]>;
  }>
) {
  return {
    async refresh(input: {
      requestId: string;
      signal: AbortSignal;
      targets: readonly LiveConditionTarget[];
    }) {
      const batches = await Promise.all(sources.map((source) => source.refresh(input)));
      return batches.flat();
    },
  };
}
