import { profileResponseSchema, profileUpdateInputSchema } from "@roavia/contracts";
import type { ProfileRepository } from "@roavia/db";
import type { Hono } from "hono";

import { type ApiEnvironment, errorResponse } from "./http.js";

async function requestBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export function registerProfileRoutes(
  app: Hono<ApiEnvironment>,
  profileRepository: ProfileRepository | undefined,
) {
  app.get("/me", async (context) => {
    if (!profileRepository) {
      return errorResponse(
        context,
        503,
        "profile_service_unavailable",
        "Profile preferences are temporarily unavailable.",
      );
    }
    const { identity } = context.get("authSession");
    const data = await profileRepository.getProfile({
      authUserId: identity.userId,
      email: identity.email,
    });
    return context.json(
      profileResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
    );
  });

  app.patch("/me/preferences", async (context) => {
    if (!profileRepository) {
      return errorResponse(
        context,
        503,
        "profile_service_unavailable",
        "Profile preferences are temporarily unavailable.",
      );
    }
    const input = profileUpdateInputSchema.safeParse(await requestBody(context.req.raw));
    if (!input.success) {
      return errorResponse(context, 400, "bad_request", "Profile preferences are invalid.");
    }
    const { identity } = context.get("authSession");
    const data = await profileRepository.updateProfile(
      { authUserId: identity.userId, email: identity.email },
      input.data,
    );
    return context.json(
      profileResponseSchema.parse({ data, meta: { requestId: context.get("requestId") } }),
    );
  });
}
