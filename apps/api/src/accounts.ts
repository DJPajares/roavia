import {
  accountDeletionConfirmInputSchema,
  accountDeletionPreviewResponseSchema,
  accountDeletionResponseSchema,
  accountExportResponseSchema,
  type AuthSession,
} from "@roavia/contracts";
import { AccountExportUnavailableError } from "@roavia/db";
import type { Hono } from "hono";

import type { AccountLifecycleService } from "./account-lifecycle.js";
import { type ApiEnvironment, errorResponse } from "./http.js";
import type { RateLimiter } from "./rate-limit.js";

const REAUTHENTICATION_WINDOW_MS = 5 * 60 * 1_000;

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function recentlyAuthenticated(session: AuthSession, now = new Date()) {
  if (!session.issuedAt) return false;
  const issuedAt = new Date(session.issuedAt).getTime();
  const age = now.getTime() - issuedAt;
  return Number.isFinite(issuedAt) && age >= 0 && age <= REAUTHENTICATION_WINDOW_MS;
}

function requireRecentAuthentication(context: Parameters<typeof errorResponse>[0]) {
  if (recentlyAuthenticated(context.get("authSession"))) return null;
  return errorResponse(
    context,
    401,
    "reauthentication_required",
    "Sign in again before exporting or deleting account data.",
  );
}

export function registerAccountRoutes(
  app: Hono<ApiEnvironment>,
  service: AccountLifecycleService | undefined,
  exportRateLimiter: RateLimiter,
) {
  app.get("/me/deletion-preview", async (context) => {
    if (!service) {
      return errorResponse(
        context,
        503,
        "account_service_unavailable",
        "Account privacy controls are temporarily unavailable.",
      );
    }
    const preview = await service.previewDeletion(context.get("authSession").identity.userId);
    return context.json(
      accountDeletionPreviewResponseSchema.parse({
        data: preview,
        meta: { requestId: context.get("requestId") },
      }),
    );
  });

  app.post("/me/exports", async (context) => {
    if (!service) {
      return errorResponse(
        context,
        503,
        "account_service_unavailable",
        "Account exports are temporarily unavailable.",
      );
    }
    const reauthenticationError = requireRecentAuthentication(context);
    if (reauthenticationError) return reauthenticationError;
    const session = context.get("authSession");
    const limit = exportRateLimiter.consume(session.identity.userId);
    context.header("x-ratelimit-limit", String(limit.limit));
    context.header("x-ratelimit-remaining", String(limit.remaining));
    context.header("x-ratelimit-reset", limit.resetAt.toISOString());
    if (!limit.allowed) {
      context.header(
        "retry-after",
        String(Math.max(1, Math.ceil((limit.resetAt.getTime() - Date.now()) / 1_000))),
      );
      return errorResponse(
        context,
        429,
        "rate_limited",
        "Account exports are limited to three requests per day.",
      );
    }
    const created = await service.createExport({
      authUserId: session.identity.userId,
      correlationId: context.get("requestId"),
      email: session.identity.email,
    });
    return context.json(
      accountExportResponseSchema.parse({
        data: {
          createdAt: created.createdAt.toISOString(),
          expiresAt: created.expiresAt.toISOString(),
          exportId: created.exportId,
          grantToken: created.grantToken,
          sizeBytes: created.sizeBytes,
        },
        meta: { requestId: context.get("requestId") },
      }),
      201,
    );
  });

  app.get("/me/exports/:exportId/download", async (context) => {
    if (!service) {
      return errorResponse(
        context,
        503,
        "account_service_unavailable",
        "Account exports are temporarily unavailable.",
      );
    }
    const grantToken = context.req.header("x-roavia-export-grant");
    if (!grantToken) return errorResponse(context, 404, "not_found", "Account export not found.");
    try {
      const artifact = await service.downloadExport({
        authUserId: context.get("authSession").identity.userId,
        correlationId: context.get("requestId"),
        exportId: context.req.param("exportId"),
        grantToken,
      });
      return context.body(new Uint8Array(artifact.bytes), 200, {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${artifact.filename}"`,
        "content-type": "application/zip",
      });
    } catch (error) {
      if (error instanceof AccountExportUnavailableError) {
        return errorResponse(context, 404, "not_found", "Account export not found.");
      }
      throw error;
    }
  });

  app.get("/me/deletion", async (context) => {
    if (!service) {
      return errorResponse(
        context,
        503,
        "account_service_unavailable",
        "Account deletion is temporarily unavailable.",
      );
    }
    const deletion = await service.findDeletion(context.get("authSession").identity.userId);
    if (!deletion) return errorResponse(context, 404, "not_found", "Deletion receipt not found.");
    return context.json(
      accountDeletionResponseSchema.parse({
        data: deletion,
        meta: { requestId: context.get("requestId") },
      }),
    );
  });

  app.post("/me/deletion", async (context) => {
    if (!service) {
      return errorResponse(
        context,
        503,
        "account_service_unavailable",
        "Account deletion is temporarily unavailable.",
      );
    }
    const reauthenticationError = requireRecentAuthentication(context);
    if (reauthenticationError) return reauthenticationError;
    const input = accountDeletionConfirmInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Type DELETE to confirm account deletion.");
    }
    const accessToken = context.get("accessToken");
    const deletion = await service.confirmDeletion({
      accessToken,
      authUserId: context.get("authSession").identity.userId,
      correlationId: context.get("requestId"),
    });
    return context.json(
      accountDeletionResponseSchema.parse({
        data: deletion,
        meta: { requestId: context.get("requestId") },
      }),
      deletion.status === "completed" ? 200 : 202,
    );
  });
}
