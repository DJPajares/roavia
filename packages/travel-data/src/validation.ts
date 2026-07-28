import type {
  ProviderAdapterResult,
  ProviderError,
  ProviderFailure,
  ProviderQuota,
  ProviderSource,
  ProviderSuccess,
  ProviderUnavailable,
} from "./contracts.js";
import { providerError } from "./contracts.js";

const providerCodePattern = /^[a-zA-Z0-9._-]{1,100}$/;
const providerErrorCodes = new Set([
  "cancelled",
  "internal",
  "invalid_request",
  "invalid_response",
  "license_restricted",
  "not_found",
  "quota_exhausted",
  "rate_limited",
  "timeout",
  "unauthorized",
  "unavailable",
  "unsupported_coverage",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isOptionalTimestamp(value: unknown): value is string | undefined {
  return value === undefined || isTimestamp(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isSource(value: unknown): value is ProviderSource {
  if (!isRecord(value)) return false;
  if (
    typeof value.provider !== "string" ||
    value.provider.length === 0 ||
    !isHttpUrl(value.sourceUrl) ||
    !isTimestamp(value.retrievedAt) ||
    !isOptionalTimestamp(value.publishedAt) ||
    !isOptionalTimestamp(value.validFrom) ||
    !isOptionalTimestamp(value.validUntil) ||
    !isOptionalTimestamp(value.expiresAt) ||
    typeof value.offlineUseAllowed !== "boolean" ||
    typeof value.redistributionAllowed !== "boolean" ||
    (value.sourceKind !== undefined &&
      ![
        "licensed_provider",
        "official_authority",
        "official_operator",
        "reviewed_editorial",
      ].includes(value.sourceKind as string)) ||
    (value.trustTier !== undefined &&
      !["tier_1", "tier_2", "tier_3", "tier_4"].includes(value.trustTier as string)) ||
    (value.title !== undefined && typeof value.title !== "string")
  ) {
    return false;
  }
  if (
    (value.validFrom !== undefined &&
      value.validUntil !== undefined &&
      Date.parse(value.validUntil as string) <= Date.parse(value.validFrom as string)) ||
    (value.expiresAt !== undefined &&
      Date.parse(value.expiresAt as string) <= Date.parse(value.retrievedAt as string))
  ) {
    return false;
  }
  if (
    value.quality !== undefined &&
    (!isRecord(value.quality) ||
      (value.quality.confidence !== undefined &&
        (typeof value.quality.confidence !== "number" ||
          value.quality.confidence < 0 ||
          value.quality.confidence > 1)) ||
      (value.quality.warnings !== undefined &&
        (!Array.isArray(value.quality.warnings) ||
          !value.quality.warnings.every((warning) => typeof warning === "string"))))
  ) {
    return false;
  }
  return true;
}

function isProviderError(value: unknown): value is ProviderError {
  if (!isRecord(value)) return false;
  return (
    typeof value.code === "string" &&
    providerErrorCodes.has(value.code) &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    value.message.length <= 500 &&
    typeof value.retryable === "boolean" &&
    (value.providerCode === undefined ||
      (typeof value.providerCode === "string" && providerCodePattern.test(value.providerCode))) &&
    (value.retryAfterMs === undefined ||
      (Number.isInteger(value.retryAfterMs) && (value.retryAfterMs as number) >= 0))
  );
}

function isOptionalNonNegativeNumber(value: unknown) {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function isUsage(value: unknown) {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return (
    isOptionalNonNegativeNumber(value.costUnits) &&
    isOptionalNonNegativeNumber(value.quotaLimit) &&
    isOptionalNonNegativeNumber(value.quotaRemaining) &&
    isOptionalNonNegativeNumber(value.requests) &&
    isOptionalTimestamp(value.quotaResetAt) &&
    (value.costUnitName === undefined || typeof value.costUnitName === "string")
  );
}

function invalidResponse<TValue>(
  provider: string,
  operation: string,
): ProviderAdapterResult<TValue> {
  return providerError(
    provider,
    operation,
    "invalid_response",
    "Provider response did not satisfy the normalized contract.",
    true,
  );
}

export function validateAdapterResult<TValue>(
  value: unknown,
  expected: { operation: string; provider: string; validateValue(value: unknown): value is TValue },
): ProviderAdapterResult<TValue> {
  if (
    !isRecord(value) ||
    value.provider !== expected.provider ||
    value.operation !== expected.operation
  ) {
    return invalidResponse(expected.provider, expected.operation);
  }

  if (value.status === "success") {
    const result = value as unknown as ProviderSuccess<unknown>;
    if (
      !expected.validateValue(result.value) ||
      !Array.isArray(result.sources) ||
      result.sources.length === 0 ||
      !result.sources.every(isSource) ||
      !isUsage(result.usage) ||
      (result.warnings !== undefined &&
        (!Array.isArray(result.warnings) ||
          !result.warnings.every((warning) => typeof warning === "string")))
    ) {
      return invalidResponse(expected.provider, expected.operation);
    }
    return result as ProviderSuccess<TValue>;
  }

  if (value.status === "error") {
    const result = value as unknown as ProviderFailure;
    return isProviderError(result.error)
      ? result
      : invalidResponse(expected.provider, expected.operation);
  }

  if (value.status === "quota") {
    const result = value as unknown as ProviderQuota;
    if (
      (result.reason !== "quota_exhausted" && result.reason !== "rate_limited") ||
      (result.error !== undefined && !isProviderError(result.error)) ||
      !isOptionalNonNegativeNumber(result.limit) ||
      !isOptionalNonNegativeNumber(result.remaining) ||
      !isOptionalTimestamp(result.resetAt) ||
      (result.retryAfterMs !== undefined &&
        (!Number.isInteger(result.retryAfterMs) || result.retryAfterMs < 0))
    ) {
      return invalidResponse(expected.provider, expected.operation);
    }
    return result;
  }

  if (value.status === "unavailable") {
    const result = value as unknown as ProviderUnavailable;
    if (
      ![
        "circuit_open",
        "no_safe_fallback",
        "provider_unavailable",
        "unsupported_coverage",
      ].includes(result.reason) ||
      (result.error !== undefined && !isProviderError(result.error)) ||
      (result.retryAfterMs !== undefined &&
        (!Number.isInteger(result.retryAfterMs) || result.retryAfterMs < 0))
    ) {
      return invalidResponse(expected.provider, expected.operation);
    }
    return result;
  }

  return invalidResponse(expected.provider, expected.operation);
}
