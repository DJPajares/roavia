import {
  API_CONTRACT_VERSION,
  apiErrorResponseSchema,
  healthResponseSchema,
  requestIdSchema,
  type ApiErrorCode,
} from "@roavia/contracts";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";

type ApiVariables = {
  requestId: string;
};

type ApiEnvironment = {
  Variables: ApiVariables;
};

function createRequestId(candidate: string | undefined): string {
  return requestIdSchema.safeParse(candidate).success ? candidate! : crypto.randomUUID();
}

export const app = new Hono<ApiEnvironment>();

app.use("*", async (context, next) => {
  const requestId = createRequestId(context.req.header("x-request-id"));
  context.set("requestId", requestId);
  context.header("x-request-id", requestId);
  await next();
});

function errorResponse(
  context: Context<ApiEnvironment>,
  status: 400 | 404 | 500,
  code: ApiErrorCode,
  message: string,
) {
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

app.get("/health", (context) =>
  context.json(
    healthResponseSchema.parse({
      data: {
        service: "api",
        status: "ok",
        version: API_CONTRACT_VERSION,
      },
      meta: {
        requestId: context.get("requestId"),
      },
    }),
  ),
);

app.notFound((context) => errorResponse(context, 404, "not_found", "Route not found."));

app.onError((error, context) => {
  if (error instanceof HTTPException && error.status < 500) {
    return errorResponse(context, 400, "bad_request", "Request could not be processed.");
  }

  return errorResponse(context, 500, "internal_error", "An unexpected error occurred.");
});
