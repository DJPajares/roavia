// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  createTrip: vi.fn<(input: unknown) => Promise<unknown>>(),
  getProfile: vi.fn<() => Promise<unknown>>(),
  getTrip: vi.fn<(id: string) => Promise<unknown>>(),
  updateTrip: vi.fn<(id: string, input: unknown) => Promise<unknown>>(),
}));

vi.mock("@roavia/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@roavia/api-client")>()),
  createRoaviaApiClient: () => api,
}));

vi.mock("../lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

import { GuidedTripPlanner } from "../components/guided-trip-planner";

const profile = {
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
  travelPreferences: { mustAvoid: ["Overnight buses"], mustDo: ["Hawker food"] },
  updatedAt: "2026-07-28T10:00:00.000Z",
};

describe("GuidedTripPlanner", () => {
  beforeEach(() => {
    api.getProfile.mockResolvedValue({ data: profile });
    api.getTrip.mockReset();
    api.createTrip.mockReset();
    api.updateTrip.mockReset();
  });

  test("prefills visible preferences and preserves a draft after a save error", async () => {
    api.createTrip.mockRejectedValue(new Error("Draft could not be saved."));
    const user = userEvent.setup();
    render(createElement(GuidedTripPlanner));

    const title = await screen.findByLabelText("Trip name");
    expect((screen.getByLabelText("Currency") as HTMLInputElement).value).toBe("SGD");
    expect(screen.getByText(/Hawker food/)).toBeDefined();
    await user.type(title, "Kyoto food week");
    await user.type(screen.getByLabelText("Start date"), "2030-05-01");
    await user.type(screen.getByLabelText("End date"), "2030-05-06");
    await user.click(screen.getByRole("button", { name: "Review assumptions" }));
    expect(
      await screen.findByRole("heading", { name: "Your draft is still yours." }),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Draft could not be saved.")).toBeDefined();
    expect(api.createTrip).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft", title: "Kyoto food week" }),
    );
  });
});
