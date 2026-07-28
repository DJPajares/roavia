import {
  API_CONTRACT_VERSION,
  apiErrorResponseSchema,
  authSessionResponseSchema,
  healthResponseSchema,
  requestIdSchema,
  type ApiErrorCode,
  type AuthSession,
} from "@roavia/contracts";
import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { AuthVerificationError, type AccessTokenVerifier } from "./auth.js";

type ApiVariables = {
  authSession: AuthSession;
  requestId: string;
};

type ApiEnvironment = {
  Variables: ApiVariables;
};

function createRequestId(candidate: string | undefined): string {
  return requestIdSchema.safeParse(candidate).success ? candidate! : crypto.randomUUID();
}

export interface CreateAppOptions {
  verifyAccessToken?: AccessTokenVerifier;
}

const unavailableVerifier: AccessTokenVerifier = () =>
  Promise.reject(new Error("Authentication is not configured."));

function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) {
    return undefined;
  }

  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1];
}

function errorResponse(
  context: Context<ApiEnvironment>,
  status: 400 | 401 | 404 | 500,
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

export function createApp(options: CreateAppOptions = {}) {
  const verifyAccessToken = options.verifyAccessToken ?? unavailableVerifier;
  const app = new Hono<ApiEnvironment>();

  app.use("*", async (context, next) => {
    const requestId = createRequestId(context.req.header("x-request-id"));
    context.set("requestId", requestId);
    context.header("x-request-id", requestId);
    await next();
  });

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

  app.use("/auth/*", async (context, next) => {
    const authorization = context.req.header("authorization");
    const accessToken = bearerToken(authorization);

    if (!authorization) {
      return errorResponse(context, 401, "authentication_required", "Authentication is required.");
    }

    if (!accessToken) {
      return errorResponse(context, 401, "invalid_session", "The session is invalid.");
    }

    try {
      context.set("authSession", await verifyAccessToken(accessToken));
    } catch (error) {
      if (error instanceof AuthVerificationError) {
        return errorResponse(context, 401, error.code, error.message);
      }

      throw error;
    }

    await next();
  });

  app.get("/auth/session", (context) =>
    context.json(
      authSessionResponseSchema.parse({
        data: context.get("authSession"),
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

  return app;
}

export const app = createApp();
