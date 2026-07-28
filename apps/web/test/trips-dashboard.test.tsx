// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  deleteTrip: vi.fn<(tripId: string, input: unknown) => Promise<unknown>>(),
  getProfile: vi.fn<() => Promise<unknown>>(),
  listTrips: vi.fn<(query: unknown) => Promise<unknown>>(),
}));

vi.mock("@roavia/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@roavia/api-client")>()),
  createRoaviaApiClient: () => api,
}));

vi.mock("../lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

import { TripsDashboard } from "../components/trips-dashboard";

const requestId = "b3bb5b6d-5e99-410a-9e99-d297dd387263";
const baseTrip = {
  budget: { amountMinor: 250_000, currency: "SGD", style: "midrange" as const },
  createdAt: "2026-07-28T10:00:00.000Z",
  dateFlexibility: { daysAfter: 0, daysBefore: 0 },
  generationState: "ready" as const,
  originPlaceId: null,
  revision: 3,
  travelerSummary: { adults: 2, children: 0, infants: 0 },
  updatedAt: "2026-07-28T10:00:00.000Z",
};

const trips = [
  {
    ...baseTrip,
    endDate: "2099-08-06",
    id: "11111111-1111-4111-8111-111111111111",
    slug: "kyoto-draft",
    startDate: "2099-08-01",
    status: "draft" as const,
    title: "Kyoto draft",
    visibility: "private" as const,
  },
  {
    ...baseTrip,
    endDate: "2099-09-06",
    id: "22222222-2222-4222-8222-222222222222",
    slug: "osaka-upcoming",
    startDate: "2099-09-01",
    status: "active" as const,
    title: "Osaka upcoming",
    visibility: "private" as const,
  },
  {
    ...baseTrip,
    endDate: "2099-10-06",
    id: "33333333-3333-4333-8333-333333333333",
    slug: "seoul-shared",
    startDate: "2099-10-01",
    status: "active" as const,
    title: "Seoul shared",
    visibility: "link" as const,
  },
  {
    ...baseTrip,
    endDate: "2020-02-06",
    id: "44444444-4444-4444-8444-444444444444",
    slug: "taipei-completed",
    startDate: "2020-02-01",
    status: "archived" as const,
    title: "Taipei completed",
    visibility: "private" as const,
  },
];

describe("TripsDashboard", () => {
  beforeEach(() => {
    api.deleteTrip.mockReset();
    api.getProfile.mockResolvedValue({
      data: { locale: "en-SG", timezone: "Asia/Singapore" },
      meta: { requestId },
    });
    api.listTrips.mockResolvedValue({
      data: { pagination: { limit: 20, nextCursor: null }, trips },
      meta: { requestId },
    });
  });

  test("groups trips by lifecycle and keeps the list after a failed removal", async () => {
    api.deleteTrip.mockRejectedValue(new Error("The trip could not be removed."));
    const user = userEvent.setup();
    render(createElement(TripsDashboard, { email: "traveler@roavia.test" }));

    expect(await screen.findByRole("heading", { name: "Drafts" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Upcoming" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Shared" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Completed" })).toBeDefined();

    await user.click(screen.getByRole("tab", { name: /Drafts 1/ }));
    expect(screen.getByRole("button", { name: "Open Kyoto draft" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Open Osaka upcoming" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open Kyoto draft" }));
    expect(screen.getByRole("dialog", { name: "Kyoto draft" })).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Remove trip" }));

    expect((await screen.findByRole("alert")).textContent).toBe("The trip could not be removed.");
    expect(screen.getByRole("button", { name: "Open Kyoto draft" })).toBeDefined();
    expect(api.deleteTrip).toHaveBeenCalledWith(trips[0].id, { expectedRevision: 3 });
  });
});
