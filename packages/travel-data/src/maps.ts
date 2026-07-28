import {
  defaultProviderExecutionPolicy,
  type ProviderFallbackPolicy,
  type TravelDataOperation,
} from "./contracts.js";

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface MapContextInput {
  center: Coordinates;
  style: "outdoors" | "streets";
  zoom: number;
}

export interface MapContextValue {
  attribution: {
    href: string;
    text: string;
  };
  availability: "available";
  center: Coordinates;
  interactive: boolean;
  offlineUseAllowed: false;
  projection: "mercator";
  style: MapContextInput["style"];
  zoom: number;
}

export type GeocodeFeatureType =
  | "address"
  | "country"
  | "district"
  | "locality"
  | "neighborhood"
  | "place"
  | "postcode"
  | "region"
  | "street";

interface GeocodeInputBase {
  countryCodes?: readonly string[];
  limit?: number;
  types?: readonly GeocodeFeatureType[];
}

export interface ForwardGeocodeInput extends GeocodeInputBase {
  kind: "forward";
  proximity?: Coordinates;
  query: string;
}

export interface ReverseGeocodeInput extends GeocodeInputBase {
  coordinates: Coordinates;
  kind: "reverse";
}

export type GeocodeInput = ForwardGeocodeInput | ReverseGeocodeInput;
export type GeocodeStorage = "permanent" | "temporary";
export type GeocodeConfidence = "exact" | "high" | "low" | "medium" | "unknown";

export interface GeocodeMatch {
  address?: string;
  confidence: GeocodeConfidence;
  coordinates: Coordinates;
  countryCode?: string;
  featureType: GeocodeFeatureType;
  id: string;
  locality?: string;
  name: string;
  region?: string;
}

export interface GeocodeValue {
  matches: readonly GeocodeMatch[];
  queryKind: GeocodeInput["kind"];
  resolution: "ambiguous" | "not_found" | "resolved";
  storage: GeocodeStorage;
}

export type RouteMode = "cycling" | "driving" | "walking";

export interface RouteInput {
  mode: RouteMode;
  trafficAware?: boolean;
  waypoints: readonly Coordinates[];
}

export interface RouteGeometry {
  coordinates: readonly Coordinates[];
  type: "LineString";
}

export interface RouteConfidence {
  explanation: string;
  level: "provider_estimate";
}

export interface RouteValue {
  availability: "available";
  confidence: RouteConfidence;
  distanceMeters: number;
  durationSeconds: number;
  geometry?: RouteGeometry;
  mode: RouteMode;
  retrievedAt: string;
  trafficBasis: "current_and_historical" | "none";
  waypoints: readonly Coordinates[];
}

const geocodeFeatureTypes = new Set<GeocodeFeatureType>([
  "address",
  "country",
  "district",
  "locality",
  "neighborhood",
  "place",
  "postcode",
  "region",
  "street",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isCoordinates(value: unknown): value is Coordinates {
  if (!isRecord(value)) return false;
  return (
    typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === "string";
}

function isGeocodeMatch(value: unknown): value is GeocodeMatch {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    typeof value.featureType === "string" &&
    geocodeFeatureTypes.has(value.featureType as GeocodeFeatureType) &&
    ["exact", "high", "low", "medium", "unknown"].includes(value.confidence as string) &&
    isCoordinates(value.coordinates) &&
    isOptionalString(value.address) &&
    isOptionalString(value.countryCode) &&
    isOptionalString(value.locality) &&
    isOptionalString(value.region)
  );
}

export function isGeocodeValue(value: unknown): value is GeocodeValue {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.matches) &&
    value.matches.every(isGeocodeMatch) &&
    ["forward", "reverse"].includes(value.queryKind as string) &&
    ["ambiguous", "not_found", "resolved"].includes(value.resolution as string) &&
    ["permanent", "temporary"].includes(value.storage as string) &&
    (value.resolution === "not_found" ? value.matches.length === 0 : value.matches.length > 0)
  );
}

export function isMapContextValue(value: unknown): value is MapContextValue {
  if (!isRecord(value) || !isRecord(value.attribution)) return false;
  return (
    value.availability === "available" &&
    isCoordinates(value.center) &&
    typeof value.interactive === "boolean" &&
    value.offlineUseAllowed === false &&
    value.projection === "mercator" &&
    (value.style === "outdoors" || value.style === "streets") &&
    typeof value.zoom === "number" &&
    Number.isFinite(value.zoom) &&
    typeof value.attribution.href === "string" &&
    typeof value.attribution.text === "string"
  );
}

export function isRouteValue(value: unknown): value is RouteValue {
  if (!isRecord(value) || !isRecord(value.confidence)) return false;
  const geometry = value.geometry;
  return (
    value.availability === "available" &&
    value.confidence.level === "provider_estimate" &&
    typeof value.confidence.explanation === "string" &&
    typeof value.distanceMeters === "number" &&
    Number.isFinite(value.distanceMeters) &&
    value.distanceMeters >= 0 &&
    typeof value.durationSeconds === "number" &&
    Number.isFinite(value.durationSeconds) &&
    value.durationSeconds >= 0 &&
    ["cycling", "driving", "walking"].includes(value.mode as string) &&
    typeof value.retrievedAt === "string" &&
    Number.isFinite(Date.parse(value.retrievedAt)) &&
    (value.trafficBasis === "current_and_historical" || value.trafficBasis === "none") &&
    Array.isArray(value.waypoints) &&
    value.waypoints.length >= 2 &&
    value.waypoints.every(isCoordinates) &&
    (geometry === undefined ||
      (isRecord(geometry) &&
        geometry.type === "LineString" &&
        Array.isArray(geometry.coordinates) &&
        geometry.coordinates.length >= 2 &&
        geometry.coordinates.every(isCoordinates)))
  );
}

const launchExecutionPolicy = {
  ...defaultProviderExecutionPolicy,
  circuitBreaker: { failureThreshold: 3, openForMs: 30_000 },
  retry: {
    ...defaultProviderExecutionPolicy.retry,
    maxAttempts: 2,
    maxDelayMs: 2_000,
  },
  timeoutMs: 4_000,
};

export const mapContextOperation: TravelDataOperation<MapContextInput, MapContextValue> = {
  cacheKey: (input) => input,
  cachePolicy: {
    dataClass: "map",
    freshForMs: 60 * 60_000,
    key: "map.context.launch",
    mode: "none",
    staleWhileRevalidateForMs: 0,
    version: 1,
  },
  dataClass: "map",
  executionPolicy: launchExecutionPolicy,
  name: "maps.context",
  validateValue: isMapContextValue,
};

export function createGeocodeOperation(
  storage: GeocodeStorage,
  fallback?: ProviderFallbackPolicy<GeocodeValue>,
): TravelDataOperation<GeocodeInput, GeocodeValue> {
  const permanent = storage === "permanent";
  return {
    cacheKey: (input) => input,
    cachePolicy: {
      dataClass: "geocode",
      freshForMs: permanent ? 30 * 24 * 60 * 60_000 : 60 * 60_000,
      key: `geocode.launch.${storage}`,
      mode: permanent ? "durable" : "none",
      staleWhileRevalidateForMs: permanent ? 60 * 24 * 60 * 60_000 : 0,
      version: 1,
    },
    canCache: permanent
      ? (result) =>
          result.value.storage === "permanent" &&
          result.sources.every((source) => source.provider === "mapbox")
      : () => false,
    dataClass: "geocode",
    executionPolicy: launchExecutionPolicy,
    fallback,
    name: `maps.geocode.${storage}`,
    validateValue: isGeocodeValue,
  };
}

export function createRouteOperation(
  fallback?: ProviderFallbackPolicy<RouteValue>,
): TravelDataOperation<RouteInput, RouteValue> {
  return {
    cacheKey: (input) => input,
    cachePolicy: {
      dataClass: "route",
      freshForMs: 15 * 60_000,
      key: "route.launch",
      mode: "ephemeral",
      staleWhileRevalidateForMs: 15 * 60_000,
      version: 1,
    },
    dataClass: "route",
    executionPolicy: launchExecutionPolicy,
    fallback,
    name: "maps.route",
    validateValue: isRouteValue,
  };
}
