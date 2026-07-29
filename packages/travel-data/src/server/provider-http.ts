import { type ProviderAdapterResult, type ProviderErrorCode, providerError } from "../contracts.js";

export type ProviderFetch = typeof fetch;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function requiredSecret(value: string, label: string) {
  if (value.trim().length < 8 || /\s/.test(value)) {
    throw new Error(`A non-empty server-side ${label} is required.`);
  }
  return value;
}

export function normalizedProviderBaseUrl(value: string, label: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`${label} endpoints must use HTTPS outside local fixtures.`);
  }
  return url.toString().replace(/\/$/, "");
}

export async function jsonBody(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function redactedProviderCode(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const normalized = String(value)
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 100);
  return normalized.length > 0 ? normalized : undefined;
}

async function responseProviderCode(response: Response) {
  const body = await jsonBody(response.clone());
  if (!isRecord(body)) return undefined;
  const meta = isRecord(body.meta) ? body.meta : undefined;
  const error = isRecord(body.error) ? body.error : undefined;
  return redactedProviderCode(
    body.code ?? body.reason ?? meta?.error_code ?? meta?.code ?? error?.code,
  );
}

function retryAfterMs(headers: Headers, now: Date) {
  const value = headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now.getTime()) : undefined;
}

export async function providerHttpFailure<TValue>(input: {
  label: string;
  now: Date;
  operation: string;
  provider: string;
  response: Response;
}): Promise<ProviderAdapterResult<TValue>> {
  const { label, now, operation, provider, response } = input;
  const providerCode = await responseProviderCode(response);
  if (response.status === 429) {
    const retryAfter = retryAfterMs(response.headers, now);
    return {
      error: {
        code: "rate_limited",
        message: `${label} request quota or rate limit was reached.`,
        providerCode,
        retryAfterMs: retryAfter,
        retryable: true,
      },
      operation,
      provider,
      reason: "rate_limited",
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
      `${label} rejected the normalized request.`,
      known.retryable,
      { providerCode },
    );
  }
  if (response.status >= 500) {
    return {
      error: {
        code: "unavailable",
        message: `${label} is temporarily unavailable.`,
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
    `${label} returned an unsupported HTTP response.`,
    false,
    { providerCode },
  );
}

export function networkUnavailable<TValue>(input: {
  label: string;
  operation: string;
  provider: string;
}): ProviderAdapterResult<TValue> {
  return {
    error: {
      code: "unavailable",
      message: `${input.label} network request failed.`,
      retryable: true,
    },
    operation: input.operation,
    provider: input.provider,
    reason: "provider_unavailable",
    status: "unavailable",
  };
}
