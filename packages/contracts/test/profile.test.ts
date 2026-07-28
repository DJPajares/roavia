import { profileSchema, profileUpdateInputSchema } from "@roavia/contracts";
import { describe, expect, test } from "vitest";

const profile = {
  accessibilityNeeds: ["Low walking"],
  defaultBudgetStyle: "midrange",
  defaultPace: "balanced",
  dietaryNeeds: ["Vegetarian"],
  email: "traveler@roavia.test",
  homeCountry: "sg",
  interests: ["Food", "History"],
  locale: "en-SG",
  preferredCurrency: "sgd",
  timezone: "Asia/Singapore",
  travelPreferences: { mustAvoid: ["Crowds"], mustDo: ["Hawker food"] },
  updatedAt: "2026-07-28T10:00:00.000Z",
};

describe("traveler profile contracts", () => {
  test("normalizes a valid profile and accepts partial updates", () => {
    expect(profileSchema.parse(profile)).toMatchObject({
      homeCountry: "SG",
      preferredCurrency: "SGD",
      travelPreferences: profile.travelPreferences,
    });
    expect(profileUpdateInputSchema.parse({ defaultPace: "slow" })).toEqual({
      defaultPace: "slow",
    });
  });

  test.each([
    [{}, "empty update"],
    [{ timezone: "Not/A_Timezone" }, "invalid time zone"],
    [{ homeCountry: "Singapore" }, "invalid country"],
    [{ preferredCurrency: "US" }, "invalid currency"],
    [{ interests: ["Food", "food"] }, "duplicate preferences"],
  ])("rejects %s", (candidate, _description) => {
    expect(profileUpdateInputSchema.safeParse(candidate).success).toBe(false);
  });
});
