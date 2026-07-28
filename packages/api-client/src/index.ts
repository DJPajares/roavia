import {
  apiErrorResponseSchema,
  healthResponseSchema,
  type ApiErrorCode,
  type HealthResponse,
} from "@roavia/contracts";

export type { HealthResponse } from "@roavia/contracts";

export interface ApiClientOptions {
  baseUrl: string;
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
}

export function createRoaviaApiClient(options: ApiClientOptions): RoaviaApiClient {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const createRequestId = options.requestId ?? (() => crypto.randomUUID());

  return {
    async health(): Promise<HealthResponse> {
      const requestId = createRequestId();
      const response = await fetchImplementation(`${baseUrl}/health`, {
        headers: {
          accept: "application/json",
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

      return healthResponseSchema.parse(body);
    },
  };
}
