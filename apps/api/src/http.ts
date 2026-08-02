import { apiErrorResponseSchema, type ApiErrorCode, type AuthSession } from "@roavia/contracts";
import type { Context } from "hono";

type ApiVariables = {
  accessToken: string;
  authSession: AuthSession;
  observabilityErrorCode: string | undefined;
  observabilityRecorded: boolean;
  observabilityStartedAt: number;
  requestId: string;
  traceId: string;
};

export type ApiEnvironment = {
  Variables: ApiVariables;
};

export function errorResponse(
  context: Context<ApiEnvironment>,
  status: 400 | 401 | 404 | 409 | 429 | 500 | 503,
  code: ApiErrorCode,
  message: string,
) {
  context.set("observabilityErrorCode", code);
  return context.json(
    apiErrorResponseSchema.parse({
      error: {
        code,
        message,
        requestId: context.get("requestId"),
      },
    }),
    status,
  );
}
