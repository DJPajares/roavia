/** Provider-neutral contracts shared by travel-data adapters and their server composition roots. */

export type TravelDataClass =
  | "advisory"
  | "climate"
  | "currency"
  | "editorial"
  | "event"
  | "geocode"
  | "holiday"
  | "map"
  | "media"
  | "place_catalog"
  | "place_details"
  | "route"
  | "weather_alert"
  | "weather_forecast";

export type ProviderErrorCode =
  | "cancelled"
  | "internal"
  | "invalid_request"
  | "invalid_response"
  | "license_restricted"
  | "not_found"
  | "rate_limited"
  | "quota_exhausted"
  | "timeout"
  | "unauthorized"
  | "unavailable"
  | "unsupported_coverage";

export type ProviderUnavailableReason =
  "circuit_open" | "no_safe_fallback" | "provider_unavailable" | "unsupported_coverage";

export type ProviderQuotaReason = "quota_exhausted" | "rate_limited";

export interface ProviderQuality {
  /** Normalized confidence from zero to one when the source supplies one. */
  confidence?: number;
  /** Provider-neutral warnings. Raw provider payloads do not belong here. */
  warnings?: readonly string[];
}

export interface ProviderSource {
  attributionText?: string;
  expiresAt?: string;
  license?: string;
  licenseUrl?: string;
  locale?: string;
  offlineUseAllowed: boolean;
  provider: string;
  providerRecordId?: string;
  publishedAt?: string;
  quality?: ProviderQuality;
  redistributionAllowed: boolean;
  region?: string;
  retrievedAt: string;
  sourceKind?:
    "licensed_provider" | "official_authority" | "official_operator" | "reviewed_editorial";
  sourceUrl: string;
  title?: string;
  trustTier?: "tier_1" | "tier_2" | "tier_3" | "tier_4";
  validFrom?: string;
  validUntil?: string;
}

export interface ProviderUsage {
  costUnits?: number;
  costUnitName?: string;
  quotaLimit?: number;
  quotaRemaining?: number;
  quotaResetAt?: string;
  requests?: number;
}

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  /** A redacted, non-secret provider code. Provider exceptions never cross the port. */
  providerCode?: string;
  retryAfterMs?: number;
  retryable: boolean;
}

interface ProviderResultBase {
  operation: string;
  provider: string;
}

export interface ProviderSuccess<TValue> extends ProviderResultBase {
  sources: readonly ProviderSource[];
  status: "success";
  usage?: ProviderUsage;
  value: TValue;
  warnings?: readonly string[];
}

export interface ProviderUnavailable extends ProviderResultBase {
  error?: ProviderError;
  reason: ProviderUnavailableReason;
  retryAfterMs?: number;
  status: "unavailable";
}

export interface ProviderQuota extends ProviderResultBase {
  error?: ProviderError;
  limit?: number;
  reason: ProviderQuotaReason;
  remaining?: number;
  resetAt?: string;
  retryAfterMs?: number;
  status: "quota";
}

export interface ProviderFailure extends ProviderResultBase {
  error: ProviderError;
  status: "error";
}

export type ProviderAdapterResult<TValue> =
  ProviderFailure | ProviderQuota | ProviderSuccess<TValue> | ProviderUnavailable;

export interface ProviderRequestContext {
  /** A correlation identifier safe to include in telemetry. */
  requestId: string;
  /** Coarse coverage hints. Do not emit these values to telemetry by default. */
  locale?: string;
  region?: string;
  signal: AbortSignal;
}

/**
 * Credentials belong in a concrete adapter's server-side constructor. They are
 * intentionally absent from this interface and from ProviderRequestContext.
 */
export interface TravelDataAdapter<TInput, TValue> {
  dataClass: TravelDataClass;
  execute(input: TInput, context: ProviderRequestContext): Promise<ProviderAdapterResult<TValue>>;
  operation: string;
  provider: string;
  supports?(context: Pick<ProviderRequestContext, "locale" | "region">): boolean;
}

export interface TravelDataCachePolicy {
  dataClass: TravelDataClass;
  freshForMs: number;
  key: string;
  mode: "durable" | "ephemeral" | "none";
  staleWhileRevalidateForMs: number;
  version: number;
}

export interface ProviderRetryPolicy {
  backoffFactor: number;
  initialDelayMs: number;
  jitterRatio: number;
  maxAttempts: number;
  maxDelayMs: number;
  retryRateLimits: boolean;
}

export interface ProviderCircuitBreakerPolicy {
  failureThreshold: number;
  openForMs: number;
}

export interface ProviderExecutionPolicy {
  circuitBreaker: ProviderCircuitBreakerPolicy;
  retry: ProviderRetryPolicy;
  timeoutMs: number;
}

export type ProviderFailureTrigger =
  ProviderErrorCode | ProviderQuotaReason | ProviderUnavailableReason;

export interface ProviderFallbackPolicy<TValue> {
  /**
   * Explicitly proves that a fallback result meets the operation's semantics,
   * coverage, license, and freshness requirements. No fallback is automatic.
   */
  accepts(input: {
    candidate: ProviderSuccess<TValue>;
    primaryFailure: ProviderFailure | ProviderQuota | ProviderUnavailable;
  }): boolean;
  triggers: readonly ProviderFailureTrigger[];
}

export interface TravelDataOperation<TInput, TValue> {
  cacheKey(input: TInput, context: TravelDataRequestContext): unknown;
  cachePolicy: TravelDataCachePolicy;
  canCache?(result: ProviderSuccess<TValue>): boolean;
  dataClass: TravelDataClass;
  executionPolicy: ProviderExecutionPolicy;
  fallback?: ProviderFallbackPolicy<TValue>;
  name: string;
  validateValue(value: unknown): value is TValue;
}

export interface TravelDataRequestContext {
  locale?: string;
  region?: string;
  requestId?: string;
  signal?: AbortSignal;
}

export interface TravelDataFreshness {
  cache: "hit" | "network";
  cachedAt: string;
  expiresAt: string;
  policyKey: string;
  policyVersion: number;
  revalidating: boolean;
  staleAt: string;
  state: "fresh" | "stale";
}

interface TravelDataExecution {
  attempts: number;
  fallbackFrom?: string;
  operation: string;
  provider: string;
  requestId: string;
}

export interface TravelDataSuccess<TValue> extends TravelDataExecution {
  freshness: TravelDataFreshness;
  sources: readonly ProviderSource[];
  status: "success";
  usage?: ProviderUsage;
  value: TValue;
  warnings?: readonly string[];
}

export interface TravelDataStale<TValue> extends TravelDataExecution {
  freshness: TravelDataFreshness & { state: "stale" };
  sources: readonly ProviderSource[];
  status: "stale";
  usage?: ProviderUsage;
  value: TValue;
  warnings?: readonly string[];
}

export type TravelDataFailure =
  | (ProviderFailure & TravelDataExecution)
  | (ProviderQuota & TravelDataExecution)
  | (ProviderUnavailable & TravelDataExecution);

export type TravelDataResult<TValue> =
  TravelDataFailure | TravelDataStale<TValue> | TravelDataSuccess<TValue>;

export type TravelDataCacheOutcome = "expired" | "hit" | "miss" | "stale" | "write";

export type TravelDataTelemetryEventName =
  | "cache"
  | "circuit_opened"
  | "fallback_selected"
  | "provider_attempt"
  | "revalidation_failed"
  | "retry_scheduled";

/**
 * Deliberately excludes input payloads, coordinates, dates, locale, region,
 * provider response bodies, and arbitrary metadata.
 */
export interface TravelDataTelemetryEvent {
  attempt?: number;
  cacheOutcome?: TravelDataCacheOutcome;
  dataClass: TravelDataClass;
  durationMs?: number;
  errorCode?: ProviderErrorCode;
  event: TravelDataTelemetryEventName;
  fallbackFrom?: string;
  operation: string;
  provider: string;
  quotaRemaining?: number;
  requestId: string;
  resultStatus?: TravelDataResult<unknown>["status"];
  retryDelayMs?: number;
  timestamp: string;
  usageCostUnits?: number;
}

export type TravelDataTelemetrySink = (event: TravelDataTelemetryEvent) => Promise<void> | void;

export const defaultProviderExecutionPolicy: ProviderExecutionPolicy = {
  circuitBreaker: {
    failureThreshold: 3,
    openForMs: 30_000,
  },
  retry: {
    backoffFactor: 2,
    initialDelayMs: 250,
    jitterRatio: 0.2,
    maxAttempts: 3,
    maxDelayMs: 5_000,
    retryRateLimits: true,
  },
  timeoutMs: 5_000,
};

export function providerError(
  provider: string,
  operation: string,
  code: ProviderErrorCode,
  message: string,
  retryable: boolean,
  options: { providerCode?: string; retryAfterMs?: number } = {},
): ProviderFailure {
  return {
    error: {
      code,
      message,
      providerCode: options.providerCode,
      retryAfterMs: options.retryAfterMs,
      retryable,
    },
    operation,
    provider,
    status: "error",
  };
}

export function getProviderFailureTrigger(
  result: ProviderFailure | ProviderQuota | ProviderUnavailable,
): ProviderFailureTrigger {
  if (result.status === "error") return result.error.code;
  return result.reason;
}
