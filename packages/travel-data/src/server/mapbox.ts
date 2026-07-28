import {
  type GeocodeConfidence,
  type GeocodeFeatureType,
  type GeocodeInput,
  type GeocodeMatch,
  type GeocodeStorage,
  type GeocodeValue,
  isCoordinates,
  type MapContextInput,
  type MapContextValue,
  type RouteGeometry,
  type RouteInput,
  type RouteValue,
} from "../maps.js";
import {
  type ProviderAdapterResult,
  type ProviderErrorCode,
  type ProviderRequestContext,
  type ProviderSource,
  type ProviderUsage,
  type TravelDataAdapter,
  providerError,
} from "../contracts.js";

const provider = "mapbox";
const geocodingDocsUrl = "https://docs.mapbox.com/api/search/geocoding-v6/";
const directionsDocsUrl = "https://docs.mapbox.com/api/navigation/directions/";
const mapsDocsUrl = "https://docs.mapbox.com/mapbox-gl-js/guides/";
const mapboxLicenseUrl = "https://www.mapbox.com/legal/tos/";
const mapboxAttribution = "© Mapbox © OpenStreetMap";
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

type Fetch = typeof fetch;

interface MapboxAdapterOptions {
  accessToken: string;
  baseUrl?: string;
  clock?: () => Date;
  fetch?: Fetch;
}

export interface MapboxGeocodingAdapterOptions extends MapboxAdapterOptions {
  storage: GeocodeStorage;
}

export interface LaunchMapsEnvironment {
  MAPS_API_KEY?: string;
  MAPS_PROVIDER?: string;
}

export interface LaunchMapsConfig {
  accessToken: string;
  provider: "mapbox";
}

export interface LaunchMapsProviderBundle {
  map: MapboxMapAdapter;
  permanentGeocoding: MapboxGeocodingAdapter;
  routing: MapboxRoutingAdapter;
  temporaryGeocoding: MapboxGeocodingAdapter;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredToken(value: string) {
  if (value.trim().length < 8 || /\s/.test(value)) {
    throw new Error("A non-empty server-side Mapbox access token is required.");
  }
  return value;
}

function normalizedBaseUrl(value = "https://api.mapbox.com") {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("Mapbox adapter endpoints must use HTTPS outside local fixtures.");
  }
  return url.toString().replace(/\/$/, "");
}

function source(
  sourceUrl: string,
  retrievedAt: string,
  options: { expiresAt?: string; providerRecordId?: string } = {},
): ProviderSource {
  return {
    attributionText: mapboxAttribution,
    expiresAt: options.expiresAt,
    license: "Mapbox terms with OpenStreetMap attribution",
    licenseUrl: mapboxLicenseUrl,
    offlineUseAllowed: false,
    provider,
    providerRecordId: options.providerRecordId,
    redistributionAllowed: false,
    retrievedAt,
    sourceKind: "licensed_provider",
    sourceUrl,
    trustTier: "tier_3",
  };
}

function finiteHeader(headers: Headers, name: string) {
  const value = headers.get(name);
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function retryAfterMs(headers: Headers, now: Date) {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now.getTime()) : undefined;
}

function usage(headers: Headers): ProviderUsage {
  const resetSeconds = finiteHeader(headers, "x-rate-limit-reset");
  return {
    costUnitName: "request",
    costUnits: 1,
    quotaLimit: finiteHeader(headers, "x-rate-limit-limit"),
    quotaRemaining: finiteHeader(headers, "x-rate-limit-remaining"),
    quotaResetAt:
      resetSeconds === undefined ? undefined : new Date(resetSeconds * 1_000).toISOString(),
    requests: 1,
  };
}

function redactedProviderCode(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
  return normalized.length > 0 ? normalized : undefined;
}

async function responseCode(response: Response) {
  try {
    const body: unknown = await response.clone().json();
    return isRecord(body) ? redactedProviderCode(body.code) : undefined;
  } catch {
    return undefined;
  }
}

async function httpFailure<TValue>(
  response: Response,
  operation: string,
  now: Date,
): Promise<ProviderAdapterResult<TValue>> {
  const providerCode = await responseCode(response);
  if (response.status === 429) {
    const retryAfter = retryAfterMs(response.headers, now);
    return {
      error: {
        code: "rate_limited",
        message: "Map provider rate limit reached.",
        providerCode,
        retryAfterMs: retryAfter,
        retryable: true,
      },
      operation,
      provider,
      reason: "rate_limited",
      remaining: finiteHeader(response.headers, "x-rate-limit-remaining"),
      retryAfterMs: retryAfter,
      status: "quota",
    };
  }

  const mapping: Record<number, { code: ProviderErrorCode; retryable: boolean }> = {
    400: { code: "invalid_request", retryable: false },
    401: { code: "unauthorized", retryable: false },
    403: { code: "unauthorized", retryable: false },
    404: { code: "not_found", retryable: false },
    422: { code: "invalid_request", retryable: false },
  };
  const known = mapping[response.status];
  if (known) {
    return providerError(
      provider,
      operation,
      known.code,
      "Map provider rejected the normalized request.",
      known.retryable,
      { providerCode },
    );
  }
  if (response.status >= 500) {
    return {
      error: {
        code: "unavailable",
        message: "Map provider is temporarily unavailable.",
        providerCode,
        retryable: true,
      },
      operation,
      provider,
      reason: "provider_unavailable",
      status: "unavailable",
    };
  }
  return providerError(
    provider,
    operation,
    "invalid_response",
    "Map provider returned an unsupported HTTP response.",
    false,
    { providerCode },
  );
}

async function jsonBody(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function invalidRequest<TValue>(operation: string): ProviderAdapterResult<TValue> {
  return providerError(
    provider,
    operation,
    "invalid_request",
    "Map request did not satisfy the normalized input contract.",
    false,
  );
}

function invalidResponse<TValue>(operation: string): ProviderAdapterResult<TValue> {
  return providerError(
    provider,
    operation,
    "invalid_response",
    "Map provider response could not be normalized.",
    true,
  );
}

function isCountryCode(value: string) {
  return /^[a-zA-Z]{2}$/.test(value);
}

function isValidGeocodeInput(input: GeocodeInput) {
  const limit = input.limit ?? 5;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) return false;
  if (input.countryCodes?.some((code) => !isCountryCode(code))) return false;
  if (input.types?.some((type) => !geocodeFeatureTypes.has(type))) return false;
  if (input.kind === "reverse") return isCoordinates(input.coordinates);
  const words = input.query.trim().split(/\s+/).filter(Boolean);
  return (
    input.query.length > 0 &&
    input.query.length <= 256 &&
    words.length <= 20 &&
    !input.query.includes(";") &&
    (input.proximity === undefined || isCoordinates(input.proximity))
  );
}

function confidence(value: unknown): GeocodeConfidence {
  return value === "exact" || value === "high" || value === "medium" || value === "low"
    ? value
    : "unknown";
}

function nestedName(context: unknown, key: string) {
  if (!isRecord(context) || !isRecord(context[key])) return undefined;
  const value = context[key].name;
  return typeof value === "string" ? value : undefined;
}

function nestedCountryCode(context: unknown) {
  if (!isRecord(context) || !isRecord(context.country)) return undefined;
  const value = context.country.country_code;
  return typeof value === "string" && isCountryCode(value) ? value.toUpperCase() : undefined;
}

function featureCoordinates(feature: Record<string, unknown>, properties: Record<string, unknown>) {
  const propertyCoordinates = properties.coordinates;
  if (
    isRecord(propertyCoordinates) &&
    typeof propertyCoordinates.latitude === "number" &&
    typeof propertyCoordinates.longitude === "number"
  ) {
    const coordinates = {
      latitude: propertyCoordinates.latitude,
      longitude: propertyCoordinates.longitude,
    };
    return isCoordinates(coordinates) ? coordinates : undefined;
  }
  const geometry = feature.geometry;
  if (!isRecord(geometry) || !Array.isArray(geometry.coordinates)) return undefined;
  const [longitude, latitude] = geometry.coordinates;
  const coordinates = { latitude, longitude };
  return isCoordinates(coordinates) ? coordinates : undefined;
}

function normalizeGeocodeFeature(value: unknown): GeocodeMatch | undefined {
  if (!isRecord(value) || !isRecord(value.properties)) return undefined;
  const properties = value.properties;
  const id = properties.mapbox_id ?? value.id;
  const featureType = properties.feature_type;
  const name = properties.name_preferred ?? properties.name;
  const coordinates = featureCoordinates(value, properties);
  if (
    typeof id !== "string" ||
    typeof featureType !== "string" ||
    !geocodeFeatureTypes.has(featureType as GeocodeFeatureType) ||
    typeof name !== "string" ||
    !coordinates
  ) {
    return undefined;
  }
  const matchCode = properties.match_code;
  const context = properties.context;
  return {
    address: typeof properties.full_address === "string" ? properties.full_address : undefined,
    confidence: confidence(isRecord(matchCode) ? matchCode.confidence : undefined),
    coordinates,
    countryCode: nestedCountryCode(context),
    featureType: featureType as GeocodeFeatureType,
    id,
    locality: nestedName(context, "locality") ?? nestedName(context, "place"),
    name,
    region: nestedName(context, "region"),
  };
}

function geocodeResolution(input: GeocodeInput, matches: readonly GeocodeMatch[]) {
  if (matches.length === 0) return "not_found" as const;
  if (input.kind === "reverse") return "resolved" as const;
  const top = matches[0]!;
  if (top.confidence === "exact" || top.confidence === "high") return "resolved" as const;
  if (top.confidence === "low" || matches.length > 1) return "ambiguous" as const;
  return "resolved" as const;
}

function normalizeGeocodeBody(
  body: unknown,
  input: GeocodeInput,
  storage: GeocodeStorage,
): GeocodeValue | undefined {
  if (!isRecord(body) || body.type !== "FeatureCollection" || !Array.isArray(body.features)) {
    return undefined;
  }
  const matches = body.features.map(normalizeGeocodeFeature).filter((value) => value !== undefined);
  if (body.features.length > 0 && matches.length === 0) return undefined;
  return {
    matches,
    queryKind: input.kind,
    resolution: geocodeResolution(input, matches),
    storage,
  };
}

function isValidRouteInput(input: RouteInput) {
  return (
    ["cycling", "driving", "walking"].includes(input.mode) &&
    Array.isArray(input.waypoints) &&
    input.waypoints.length >= 2 &&
    input.waypoints.length <= 25 &&
    input.waypoints.every(isCoordinates) &&
    (input.trafficAware === undefined || typeof input.trafficAware === "boolean") &&
    !(input.trafficAware && input.mode !== "driving")
  );
}

function routeProfile(input: RouteInput) {
  if (input.mode === "driving" && input.trafficAware) return "driving-traffic";
  return input.mode;
}

function normalizeCoordinatePair(value: unknown) {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const coordinates = { latitude: value[1], longitude: value[0] };
  return isCoordinates(coordinates) ? coordinates : undefined;
}

function normalizeGeometry(value: unknown): RouteGeometry | undefined {
  if (!isRecord(value) || value.type !== "LineString" || !Array.isArray(value.coordinates)) {
    return undefined;
  }
  const coordinates = value.coordinates
    .map(normalizeCoordinatePair)
    .filter((item) => item !== undefined);
  return coordinates.length >= 2 ? { coordinates, type: "LineString" } : undefined;
}

function normalizedRouteWaypoints(
  body: Record<string, unknown>,
  fallback: RouteInput["waypoints"],
) {
  if (!Array.isArray(body.waypoints)) return fallback;
  const waypoints = body.waypoints
    .map((item) => (isRecord(item) ? normalizeCoordinatePair(item.location) : undefined))
    .filter((item) => item !== undefined);
  return waypoints.length >= 2 ? waypoints : fallback;
}

function normalizeRouteBody(
  body: Record<string, unknown>,
  input: RouteInput,
  retrievedAt: string,
): RouteValue | undefined {
  if (!Array.isArray(body.routes) || !isRecord(body.routes[0])) return undefined;
  const route = body.routes[0];
  if (
    typeof route.distance !== "number" ||
    !Number.isFinite(route.distance) ||
    route.distance < 0 ||
    typeof route.duration !== "number" ||
    !Number.isFinite(route.duration) ||
    route.duration < 0
  ) {
    return undefined;
  }
  const geometry = route.geometry === undefined ? undefined : normalizeGeometry(route.geometry);
  if (route.geometry !== undefined && !geometry) return undefined;
  return {
    availability: "available",
    confidence: {
      explanation:
        "The provider returned a routable path; duration remains an estimate and conditions can change.",
      level: "provider_estimate",
    },
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    geometry,
    mode: input.mode,
    retrievedAt,
    trafficBasis:
      input.mode === "driving" && input.trafficAware ? "current_and_historical" : "none",
    waypoints: normalizedRouteWaypoints(body, input.waypoints),
  };
}

abstract class MapboxHttpAdapter {
  protected readonly baseUrl: string;
  protected readonly clock: () => Date;
  protected readonly fetch: Fetch;
  readonly provider = provider;
  #accessToken: string;

  constructor(options: MapboxAdapterOptions) {
    this.#accessToken = requiredToken(options.accessToken);
    this.baseUrl = normalizedBaseUrl(options.baseUrl);
    this.clock = options.clock ?? (() => new Date());
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  protected authorize(url: URL) {
    url.searchParams.set("access_token", this.#accessToken);
    return url;
  }
}

export class MapboxMapAdapter implements TravelDataAdapter<MapContextInput, MapContextValue> {
  readonly dataClass = "map" as const;
  readonly operation = "maps.context";
  readonly provider = provider;
  readonly #clock: () => Date;
  #accessToken: string;

  constructor(options: MapboxAdapterOptions) {
    this.#accessToken = requiredToken(options.accessToken);
    this.#clock = options.clock ?? (() => new Date());
  }

  async execute(
    input: MapContextInput,
    _context: ProviderRequestContext,
  ): Promise<ProviderAdapterResult<MapContextValue>> {
    void this.#accessToken;
    if (
      !isCoordinates(input.center) ||
      (input.style !== "outdoors" && input.style !== "streets") ||
      !Number.isFinite(input.zoom) ||
      input.zoom < 0 ||
      input.zoom > 22
    ) {
      return invalidRequest(this.operation);
    }
    const retrievedAt = this.#clock().toISOString();
    return {
      operation: this.operation,
      provider,
      sources: [source(mapsDocsUrl, retrievedAt)],
      status: "success",
      usage: { costUnitName: "request", costUnits: 0, requests: 0 },
      value: {
        attribution: { href: "https://www.mapbox.com/about/maps/", text: mapboxAttribution },
        availability: "available",
        center: input.center,
        interactive: true,
        offlineUseAllowed: false,
        projection: "mercator",
        style: input.style,
        zoom: input.zoom,
      },
    };
  }
}

export class MapboxGeocodingAdapter
  extends MapboxHttpAdapter
  implements TravelDataAdapter<GeocodeInput, GeocodeValue>
{
  readonly dataClass = "geocode" as const;
  readonly operation: string;
  readonly storage: GeocodeStorage;

  constructor(options: MapboxGeocodingAdapterOptions) {
    super(options);
    this.storage = options.storage;
    this.operation = `maps.geocode.${options.storage}`;
  }

  async execute(
    input: GeocodeInput,
    context: ProviderRequestContext,
  ): Promise<ProviderAdapterResult<GeocodeValue>> {
    if (!isValidGeocodeInput(input)) return invalidRequest(this.operation);
    const path = input.kind === "forward" ? "forward" : "reverse";
    const url = this.authorize(new URL(`/search/geocode/v6/${path}`, this.baseUrl));
    url.searchParams.set("permanent", String(this.storage === "permanent"));
    url.searchParams.set("limit", String(input.limit ?? 5));
    if (context.locale) url.searchParams.set("language", context.locale);
    if (input.countryCodes?.length) {
      url.searchParams.set(
        "country",
        input.countryCodes.map((code) => code.toLowerCase()).join(","),
      );
    }
    if (input.types?.length) url.searchParams.set("types", input.types.join(","));
    if (input.kind === "forward") {
      url.searchParams.set("q", input.query);
      url.searchParams.set("autocomplete", "false");
      if (input.proximity) {
        url.searchParams.set(
          "proximity",
          `${input.proximity.longitude},${input.proximity.latitude}`,
        );
      }
    } else {
      url.searchParams.set("longitude", String(input.coordinates.longitude));
      url.searchParams.set("latitude", String(input.coordinates.latitude));
    }

    let response: Response;
    try {
      response = await this.fetch(url, {
        headers: { accept: "application/geo+json" },
        signal: context.signal,
      });
    } catch (error) {
      if (context.signal.aborted) throw error;
      return {
        error: {
          code: "unavailable",
          message: "Map provider network request failed.",
          retryable: true,
        },
        operation: this.operation,
        provider,
        reason: "provider_unavailable",
        status: "unavailable",
      };
    }
    const now = this.clock();
    if (!response.ok) return httpFailure(response, this.operation, now);
    const body = await jsonBody(response);
    const value = normalizeGeocodeBody(body, input, this.storage);
    if (!value) return invalidResponse(this.operation);
    const retrievedAt = now.toISOString();
    const firstId = value.matches[0]?.id;
    const expiresAt =
      this.storage === "temporary"
        ? new Date(now.getTime() + 60 * 60_000).toISOString()
        : undefined;
    return {
      operation: this.operation,
      provider,
      sources: [source(geocodingDocsUrl, retrievedAt, { expiresAt, providerRecordId: firstId })],
      status: "success",
      usage: usage(response.headers),
      value,
      warnings:
        value.resolution === "ambiguous"
          ? [
              "Geocoding returned multiple or low-confidence matches; user confirmation is required.",
            ]
          : undefined,
    };
  }
}

export class MapboxRoutingAdapter
  extends MapboxHttpAdapter
  implements TravelDataAdapter<RouteInput, RouteValue>
{
  readonly dataClass = "route" as const;
  readonly operation = "maps.route";

  async execute(
    input: RouteInput,
    context: ProviderRequestContext,
  ): Promise<ProviderAdapterResult<RouteValue>> {
    if (!isValidRouteInput(input)) return invalidRequest(this.operation);
    const coordinates = input.waypoints
      .map((point) => `${point.longitude},${point.latitude}`)
      .join(";");
    const url = this.authorize(
      new URL(`/directions/v5/mapbox/${routeProfile(input)}/${coordinates}`, this.baseUrl),
    );
    url.searchParams.set("alternatives", "false");
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("overview", "simplified");
    url.searchParams.set("steps", "false");

    let response: Response;
    try {
      response = await this.fetch(url, {
        headers: { accept: "application/json" },
        signal: context.signal,
      });
    } catch (error) {
      if (context.signal.aborted) throw error;
      return {
        error: {
          code: "unavailable",
          message: "Route provider network request failed.",
          retryable: true,
        },
        operation: this.operation,
        provider,
        reason: "provider_unavailable",
        status: "unavailable",
      };
    }
    const now = this.clock();
    if (!response.ok) return httpFailure(response, this.operation, now);
    const body = await jsonBody(response);
    if (!isRecord(body) || typeof body.code !== "string") return invalidResponse(this.operation);
    if (body.code === "NoRoute" || body.code === "NoSegment") {
      return {
        error: {
          code: body.code === "NoRoute" ? "not_found" : "unsupported_coverage",
          message:
            body.code === "NoRoute"
              ? "No route is available for the requested waypoints."
              : "One or more waypoints cannot be matched to the route network.",
          providerCode: body.code,
          retryable: false,
        },
        operation: this.operation,
        provider,
        reason: "unsupported_coverage",
        status: "unavailable",
      };
    }
    if (body.code !== "Ok") return invalidResponse(this.operation);
    const retrievedAt = now.toISOString();
    const value = normalizeRouteBody(body, input, retrievedAt);
    if (!value) return invalidResponse(this.operation);
    return {
      operation: this.operation,
      provider,
      sources: [
        source(directionsDocsUrl, retrievedAt, {
          expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
        }),
      ],
      status: "success",
      usage: usage(response.headers),
      value,
    };
  }
}

export function readLaunchMapsConfig(environment: LaunchMapsEnvironment): LaunchMapsConfig {
  const selected = environment.MAPS_PROVIDER?.trim().toLowerCase();
  if (selected !== "mapbox") {
    throw new Error("MAPS_PROVIDER must be set to the approved launch provider: mapbox.");
  }
  return {
    accessToken: requiredToken(environment.MAPS_API_KEY ?? ""),
    provider: "mapbox",
  };
}

export function createLaunchMapsProviderBundle(
  config: LaunchMapsConfig,
  options: Omit<MapboxAdapterOptions, "accessToken"> = {},
): LaunchMapsProviderBundle {
  if (config.provider !== "mapbox") throw new Error("Unsupported launch maps provider.");
  const shared = { ...options, accessToken: config.accessToken };
  return {
    map: new MapboxMapAdapter(shared),
    permanentGeocoding: new MapboxGeocodingAdapter({ ...shared, storage: "permanent" }),
    routing: new MapboxRoutingAdapter(shared),
    temporaryGeocoding: new MapboxGeocodingAdapter({ ...shared, storage: "temporary" }),
  };
}
