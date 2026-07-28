// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  getProfile: vi.fn<() => Promise<unknown>>(),
  updateProfile: vi.fn<(input: unknown) => Promise<unknown>>(),
}));

vi.mock("@roavia/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@roavia/api-client")>()),
  createRoaviaApiClient: () => api,
}));

vi.mock("../lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

import { ProfilePreferences } from "../components/profile-preferences";

const profile = {
  accessibilityNeeds: ["Low walking"],
  defaultBudgetStyle: "midrange" as const,
  defaultPace: "balanced" as const,
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

describe("ProfilePreferences", () => {
  beforeEach(() => {
    api.getProfile.mockResolvedValue({ data: profile });
    api.updateProfile.mockReset();
  });

  test("renders labeled controls and preserves edits after a save error", async () => {
    api.updateProfile.mockRejectedValue(new Error("Preferences could not be saved."));
    const user = userEvent.setup();
    render(createElement(ProfilePreferences, { email: profile.email }));

    const locale = await screen.findByLabelText("Locale");
    expect((screen.getByLabelText("Home country") as HTMLInputElement).value).toBe("SG");
    expect(
      screen.getByRole("heading", { name: "A profile that stays in your control." }),
    ).toBeDefined();

    await user.tab();
    expect(document.activeElement).toBe(locale);
    await user.clear(locale);
    await user.type(locale, "en-AU");
    await user.click(screen.getByRole("button", { name: "Save preferences" }));

    expect(await screen.findByText("Preferences could not be saved.")).toBeDefined();
    expect((locale as HTMLInputElement).value).toBe("en-AU");
    expect(api.updateProfile).toHaveBeenCalledWith(expect.objectContaining({ locale: "en-AU" }));
  });
});
