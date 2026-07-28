import {
  apiErrorResponseSchema,
  authSessionResponseSchema,
  healthResponseSchema,
  type ApiErrorCode,
  type AuthSessionResponse,
  type HealthResponse,
} from "@roavia/contracts";

export type { AuthSessionResponse, HealthResponse } from "@roavia/contracts";

export interface ApiClientOptions {
  baseUrl: string;
  accessToken?: () => Promise<string | null> | string | null;
  fetch?: typeof fetch;
  requestId?: () => string;
}

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly requestId: string;
  readonly status: number;

  constructor(options: { code: ApiErrorCode; message: string; requestId: string; status: number }) {
    super(options.message);
    this.name = "ApiClientError";
    this.code = options.code;
    this.requestId = options.requestId;
    this.status = options.status;
  }
}

export interface RoaviaApiClient {
  health(): Promise<HealthResponse>;
  session(): Promise<AuthSessionResponse>;
}

export function createRoaviaApiClient(options: ApiClientOptions): RoaviaApiClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const createRequestId = options.requestId ?? (() => crypto.randomUUID());

  async function request<T>(
    path: string,
    schema: { parse(value: unknown): T },
    authenticated = false,
  ): Promise<T> {
    const requestId = createRequestId();
    const accessToken = authenticated ? await options.accessToken?.() : null;
    const response = await fetchImplementation(`${baseUrl}${path}`, {
      headers: {
        accept: "application/json",
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        "x-request-id": requestId,
      },
      method: "GET",
    });
    const body: unknown = await response.json();

    if (!response.ok) {
      const parsedError = apiErrorResponseSchema.safeParse(body);
      if (parsedError.success) {
        throw new ApiClientError({
          code: parsedError.data.error.code,
          message: parsedError.data.error.message,
          requestId: parsedError.data.error.requestId,
          status: response.status,
        });
      }

      throw new ApiClientError({
        code: "internal_error",
        message: "The API returned an invalid error response.",
        requestId,
        status: response.status,
      });
    }

    return schema.parse(body);
  }

  return {
    async health(): Promise<HealthResponse> {
      return request("/health", healthResponseSchema);
    },
    async session(): Promise<AuthSessionResponse> {
      return request("/auth/session", authSessionResponseSchema, true);
    },
  };
}
