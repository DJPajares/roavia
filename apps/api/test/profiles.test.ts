import type { Profile } from "@roavia/contracts";
import type { ProfileRepository } from "@roavia/db";
import { describe, expect, test, vi } from "vitest";

import { createApp } from "../src/app.js";

const requestId = "33333333-3333-4333-8333-333333333333";
const userId = "11111111-1111-4111-8111-111111111111";
const profile: Profile = {
  accessibilityNeeds: ["Low walking"],
  defaultBudgetStyle: "midrange",
  defaultPace: "balanced",
  dietaryNeeds: ["Vegetarian"],
  email: "traveler@roavia.test",
  homeCountry: "SG",
  interests: ["Food"],
  locale: "en-SG",
  preferredCurrency: "SGD",
  timezone: "Asia/Singapore",
  travelPreferences: { mustAvoid: [], mustDo: ["Hawker food"] },
  updatedAt: "2026-07-28T10:00:00.000Z",
};

function testApp(profileRepository?: ProfileRepository) {
  return createApp({
    profileRepository,
    verifyAccessToken: async () => ({
      expiresAt: "2026-07-28T11:00:00.000Z",
      identity: { email: profile.email ?? undefined, userId },
    }),
  });
}

function repositoryWith(overrides: Partial<ProfileRepository>): ProfileRepository {
  return {
    getProfile: () => Promise.reject(new Error("Unexpected repository call.")),
    updateProfile: () => Promise.reject(new Error("Unexpected repository call.")),
    ...overrides,
  };
}

describe("profile API routes", () => {
  test("authenticates before reporting service availability", async () => {
    const app = testApp();
    const unauthenticated = await app.request("/me");
    const unavailable = await app.request("/me", {
      headers: { authorization: "Bearer test-token" },
    });

    expect(unauthenticated.status).toBe(401);
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      error: { code: "profile_service_unavailable" },
    });
  });

  test("returns the authenticated user's profile and validates updates", async () => {
    const getProfile = vi.fn<ProfileRepository["getProfile"]>().mockResolvedValue(profile);
    const updateProfile = vi.fn<ProfileRepository["updateProfile"]>().mockResolvedValue({
      ...profile,
      defaultPace: "slow",
    });
    const app = testApp(repositoryWith({ getProfile, updateProfile }));

    const current = await app.request("/me", {
      headers: { authorization: "Bearer test-token", "x-request-id": requestId },
    });
    const invalid = await app.request("/me/preferences", {
      body: JSON.stringify({ timezone: "Not/A_Timezone" }),
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      method: "PATCH",
    });
    const updated = await app.request("/me/preferences", {
      body: JSON.stringify({ defaultPace: "slow" }),
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      method: "PATCH",
    });

    expect(getProfile).toHaveBeenCalledWith({ authUserId: userId, email: profile.email });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      data: { email: profile.email, homeCountry: "SG" },
      meta: { requestId },
    });
    expect(invalid.status).toBe(400);
    expect(updateProfile).toHaveBeenCalledWith(
      { authUserId: userId, email: profile.email },
      { defaultPace: "slow" },
    );
    expect(updated.status).toBe(200);
  });
});
