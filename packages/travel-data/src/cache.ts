import type { ProviderSuccess, TravelDataCachePolicy, TravelDataClass } from "./contracts.js";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

export interface TravelDataCacheEntry<TValue> {
  cachedAt: string;
  expiresAt: string;
  policyKey: string;
  policyVersion: number;
  result: ProviderSuccess<TValue>;
  staleAt: string;
}

export interface TravelDataCache {
  delete(key: string): Promise<void>;
  get<TValue>(key: string): Promise<TravelDataCacheEntry<TValue> | undefined>;
  set<TValue>(key: string, entry: TravelDataCacheEntry<TValue>): Promise<void>;
}

export class MemoryTravelDataCache implements TravelDataCache {
  private readonly entries = new Map<string, TravelDataCacheEntry<unknown>>();

  async delete(key: string) {
    this.entries.delete(key);
  }

  async get<TValue>(key: string) {
    return this.entries.get(key) as TravelDataCacheEntry<TValue> | undefined;
  }

  async set<TValue>(key: string, entry: TravelDataCacheEntry<TValue>) {
    this.entries.set(key, entry as TravelDataCacheEntry<unknown>);
  }
}

export interface TravelDataCacheKeyInput {
  input: unknown;
  locale?: string;
  operation: string;
  policy: Pick<TravelDataCachePolicy, "key" | "version">;
  provider: string;
}

/** Hashes normalized input so cache keys do not expose precise locations, dates, or free text. */
export async function createTravelDataCacheKey(input: TravelDataCacheKeyInput) {
  const canonical = canonicalJson({
    input: input.input,
    locale: input.locale ?? null,
    operation: input.operation,
    policyKey: input.policy.key,
    policyVersion: input.policy.version,
    provider: input.provider,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hash = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `travel-data:${input.policy.key}:v${input.policy.version}:${hash}`;
}

function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Cache key numbers must be finite.");
    return JSON.stringify(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Cache key input must not be circular.");
    seen.add(value);
    const serialized = `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
    seen.delete(value);
    return serialized;
  }
  if (typeof value === "object") {
    if (seen.has(value)) throw new TypeError("Cache key input must not be circular.");
    seen.add(value);
    const record = value as Record<string, unknown>;
    const serialized = `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], seen)}`)
      .join(",")}}`;
    seen.delete(value);
    return serialized;
  }
  throw new TypeError(`Cache key input cannot contain ${typeof value} values.`);
}

function policy(
  dataClass: TravelDataClass,
  freshForMs: number,
  staleWhileRevalidateForMs: number,
  mode: TravelDataCachePolicy["mode"] = "ephemeral",
): TravelDataCachePolicy {
  return {
    dataClass,
    freshForMs,
    key: `${dataClass}.evaluation`,
    mode,
    staleWhileRevalidateForMs,
    version: 1,
  };
}

/**
 * Conservative evaluation defaults derived from WDL-28. Production adapters
 * must replace these when provider terms, launch coverage, and budgets are approved.
 */
export const evaluationCachePolicies = {
  advisory: policy("advisory", hour, 5 * hour),
  climate: policy("climate", 30 * day, 60 * day, "durable"),
  closure: policy("closure", 6 * hour, 18 * hour),
  currency: policy("currency", day, day, "durable"),
  editorial: policy("editorial", 90 * day, 90 * day, "durable"),
  emergency: policy("emergency", hour, 5 * hour),
  event: policy("event", 6 * hour, 6 * hour),
  geocode: policy("geocode", hour, 0),
  holiday: policy("holiday", 30 * day, 30 * day, "durable"),
  map: policy("map", hour, 0, "none"),
  media: policy("media", day, 0, "durable"),
  place_catalog: policy("place_catalog", 31 * day, 62 * day, "durable"),
  place_details: policy("place_details", day, day),
  route: policy("route", 15 * minute, 15 * minute),
  visa: policy("visa", hour, 5 * hour),
  weather_alert: policy("weather_alert", 15 * minute, 45 * minute),
  weather_forecast: policy("weather_forecast", 30 * minute, 90 * minute),
} as const satisfies Record<TravelDataClass, TravelDataCachePolicy>;

export function validateCachePolicy(inputPolicy: TravelDataCachePolicy) {
  if (!/^[a-z][a-z0-9_.-]{0,99}$/.test(inputPolicy.key)) {
    throw new Error("Cache policy keys must be lowercase identifiers of at most 100 characters.");
  }
  if (!Number.isInteger(inputPolicy.version) || inputPolicy.version < 1) {
    throw new Error("Cache policy versions must be positive integers.");
  }
  if (!Number.isInteger(inputPolicy.freshForMs) || inputPolicy.freshForMs < 1) {
    throw new Error("Cache freshForMs must be a positive integer.");
  }
  if (
    !Number.isInteger(inputPolicy.staleWhileRevalidateForMs) ||
    inputPolicy.staleWhileRevalidateForMs < 0
  ) {
    throw new Error("Cache staleWhileRevalidateForMs must be a non-negative integer.");
  }
}
