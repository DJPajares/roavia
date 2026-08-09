// @vitest-environment jsdom

import axe from "axe-core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const router = vi.hoisted(() => ({
  push: vi.fn<(path: string) => void>(),
  replace: vi.fn<(path: string) => void>(),
}));
const api = vi.hoisted(() => ({
  createTrip: vi.fn<(input: unknown) => Promise<any>>(),
  createTripDay: vi.fn<(tripId: string, input: any) => Promise<any>>(),
  createTripDestination: vi.fn<(tripId: string, input: any) => Promise<any>>(),
  deleteTripDestination: vi.fn<(tripId: string, id: string, input: any) => Promise<any>>(),
  extractTripIntent: vi.fn<() => void>(),
  generateTrip: vi.fn<() => void>(),
  getDestination: vi.fn<(id: string) => Promise<any>>(),
  getProfile: vi.fn<() => Promise<any>>(),
  getTrip: vi.fn<(id: string) => Promise<any>>(),
  searchDestinations: vi.fn<(input: unknown) => Promise<any>>(),
  updateTrip: vi.fn<(id: string, input: unknown) => Promise<any>>(),
  updateTripDestination: vi.fn<(tripId: string, id: string, input: any) => Promise<any>>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@roavia/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@roavia/api-client")>()),
  createRoaviaApiClient: () => api,
}));

vi.mock("../lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

import { GuidedTripPlanner } from "../components/guided-trip-planner";

const tripId = "10000000-0000-4000-8000-000000000001";
const kyotoId = "20000000-0000-4000-8000-000000000002";
const osakaId = "30000000-0000-4000-8000-000000000003";

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

const places = [
  {
    canonicalName: "Kyoto",
    countryCode: "JP",
    hierarchy: [{ id: crypto.randomUUID(), name: "Kansai", type: "region" as const }],
    id: kyotoId,
    localizedNames: { ja: "京都" },
    placeType: "city" as const,
  },
  {
    canonicalName: "Osaka",
    countryCode: "JP",
    hierarchy: [{ id: crypto.randomUUID(), name: "Kansai", type: "region" as const }],
    id: osakaId,
    localizedNames: { ja: "大阪" },
    placeType: "city" as const,
  },
];

function tripData(revision = 1) {
  return {
    budget: { amountMinor: null, currency: "SGD", style: "midrange" },
    createdAt: "2026-08-09T00:00:00.000Z",
    dateFlexibility: { daysAfter: 0, daysBefore: 0 },
    days: [],
    destinations: [],
    endDate: "2030-05-02",
    generation: null,
    generationState: "idle",
    id: tripId,
    originPlaceId: null,
    planningPreferences: null,
    revision,
    slug: "kyoto-food-week",
    startDate: "2030-05-01",
    status: "draft",
    title: "Kyoto food week",
    travelerSummary: { adults: 1, children: 0, infants: 0 },
    updatedAt: "2026-08-09T00:00:00.000Z",
    visibility: "private",
  };
}

describe("GuidedTripPlanner", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.replace.mockReset();
    for (const mock of Object.values(api)) mock.mockReset();
    api.getProfile.mockResolvedValue({ data: profile });
    api.searchDestinations.mockResolvedValue({
      data: {
        pagination: { limit: 8, nextPage: null, page: 1, total: 2 },
        query: "Japan",
        results: places,
      },
    });
    api.getDestination.mockImplementation(async (id) => ({
      data: {
        content: [],
        place: {
          ...places.find((place) => place.id === id)!,
          summary: null,
          timezone: "Asia/Tokyo",
        },
      },
    }));
    api.createTrip.mockResolvedValue({ data: tripData() });
    api.createTripDestination.mockImplementation(async (_requestedTripId, input) => ({
      data: {
        destination: {
          arrivalAt: null,
          departureAt: null,
          id: crypto.randomUUID(),
          orderIndex: input.orderIndex,
          placeId: input.placeId,
          tripId,
        },
        tripRevision: input.expectedTripRevision + 1,
      },
    }));
    api.createTripDay.mockImplementation(async (_requestedTripId, input) => ({
      data: {
        day: { ...input, id: crypto.randomUUID(), items: [], tripId },
        tripRevision: input.expectedTripRevision + 1,
      },
    }));
  });

  test("creates ordered destinations and blank days without invoking AI", async () => {
    const user = userEvent.setup();
    const rendered = render(createElement(GuidedTripPlanner));

    await screen.findByRole("heading", { name: "Choose the places. Shape every day." });
    expect((screen.getByLabelText("Currency") as HTMLInputElement).value).toBe("SGD");
    expect(screen.getByText(/Hawker food/)).toBeDefined();

    await user.type(screen.getByLabelText("Trip name"), "Kyoto food week");
    await user.type(screen.getByLabelText("Start date"), "2030-05-01");
    await user.type(screen.getByLabelText("End date"), "2030-05-02");
    await user.type(screen.getByLabelText("Search destinations"), "Japan");
    await user.click(screen.getByRole("button", { name: "Search catalogue" }));
    await user.click(await screen.findByRole("button", { name: "Add Kyoto" }));
    await user.click(screen.getByRole("button", { name: "Add Osaka" }));
    await user.click(screen.getByRole("button", { name: "Move Osaka earlier" }));

    expect(
      (
        await axe.run(rendered.container, {
          rules: { "color-contrast": { enabled: false } },
        })
      ).violations,
    ).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Review manual trip" }));
    expect(
      await screen.findByRole("heading", { name: "A blank itinerary, ready for your plans." }),
    ).toBeDefined();
    expect(screen.getByText("Osaka → Kyoto")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Create blank trip" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/trips/${tripId}`));
    expect(api.createTrip).toHaveBeenCalledWith(
      expect.objectContaining({
        planningPreferences: null,
        status: "draft",
        title: "Kyoto food week",
      }),
    );
    expect(api.createTripDestination).toHaveBeenNthCalledWith(
      1,
      tripId,
      expect.objectContaining({ expectedTripRevision: 1, orderIndex: 0, placeId: osakaId }),
    );
    expect(api.createTripDestination).toHaveBeenNthCalledWith(
      2,
      tripId,
      expect.objectContaining({ expectedTripRevision: 2, orderIndex: 1, placeId: kyotoId }),
    );
    expect(api.createTripDay).toHaveBeenNthCalledWith(
      1,
      tripId,
      expect.objectContaining({
        expectedTripRevision: 3,
        localDate: "2030-05-01",
        timezone: "Asia/Tokyo",
      }),
    );
    expect(api.createTripDay).toHaveBeenNthCalledWith(
      2,
      tripId,
      expect.objectContaining({
        expectedTripRevision: 4,
        localDate: "2030-05-02",
        timezone: "Asia/Tokyo",
      }),
    );
    expect(api.extractTripIntent).not.toHaveBeenCalled();
    expect(api.generateTrip).not.toHaveBeenCalled();
  });

  test("preserves manual input when destination search is unavailable", async () => {
    api.searchDestinations.mockRejectedValue(new Error("Provider unavailable"));
    const user = userEvent.setup();
    render(createElement(GuidedTripPlanner));

    await user.type(await screen.findByLabelText("Trip name"), "Unfinished Japan trip");
    await user.type(screen.getByLabelText("Search destinations"), "Kyoto station area");
    await user.click(screen.getByRole("button", { name: "Search catalogue" }));

    expect(
      await screen.findByRole("heading", { name: "We could not search destinations" }),
    ).toBeDefined();
    expect((screen.getByLabelText("Trip name") as HTMLInputElement).value).toBe(
      "Unfinished Japan trip",
    );
    expect((screen.getByLabelText("Search destinations") as HTMLInputElement).value).toBe(
      "Kyoto station area",
    );
    expect(api.createTrip).not.toHaveBeenCalled();
  });
});
