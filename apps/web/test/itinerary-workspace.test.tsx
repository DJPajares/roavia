// @vitest-environment jsdom

import axe from "axe-core";
import type { TripDetail } from "@roavia/contracts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  createTripItem: vi.fn<(tripId: string, input: any) => Promise<any>>(),
  deleteTripItem: vi.fn<(tripId: string, itemId: string, input: any) => Promise<any>>(),
  getTrip: vi.fn<(tripId: string) => Promise<unknown>>(),
  listShareLinks: vi.fn<(tripId: string) => Promise<unknown>>(),
  updateTripItem: vi.fn<(tripId: string, itemId: string, input: any) => Promise<any>>(),
}));

vi.mock("@roavia/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@roavia/api-client")>()),
  createRoaviaApiClient: () => api,
}));

vi.mock("../lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

import { ApiClientError } from "@roavia/api-client";

import { ItineraryWorkspace } from "../components/itinerary-workspace";

const requestId = "b3bb5b6d-5e99-410a-9e99-d297dd387263";
const tripId = "11111111-1111-4111-8111-111111111111";
const dayOneId = "22222222-2222-4222-8222-222222222222";
const dayTwoId = "33333333-3333-4333-8333-333333333333";

const route = {
  availability: "available" as const,
  confidence: {
    explanation: "Estimated from a normalized walking route.",
    level: "provider_estimate" as const,
  },
  distanceMeters: 1_800,
  durationSeconds: 1_800,
  freshness: "fresh" as const,
  geometry: {
    coordinates: [
      { latitude: 35.0116, longitude: 135.7681 },
      { latitude: 35.0394, longitude: 135.7292 },
    ],
    type: "LineString" as const,
  },
  mode: "walking" as const,
  retrievedAt: "2026-07-28T10:00:00.000Z",
  trafficBasis: "none" as const,
  waypoints: [
    { latitude: 35.0116, longitude: 135.7681 },
    { latitude: 35.0394, longitude: 135.7292 },
  ],
};

const baseItem = {
  booking: {},
  confidence: 0.86,
  estimatedCost: null,
  itineraryDayId: dayOneId,
  notes: null,
  placeId: null,
};

const trip: TripDetail = {
  budget: { amountMinor: 300_000, currency: "SGD", style: "midrange" as const },
  createdAt: "2026-07-28T10:00:00.000Z",
  dateFlexibility: { daysAfter: 0, daysBefore: 0 },
  days: [
    {
      id: dayTwoId,
      items: [
        {
          ...baseItem,
          durationMinutes: 90,
          endTime: "11:30",
          estimatedCost: { amountMinor: 4_500, currency: "SGD" },
          id: "77777777-7777-4777-8777-777777777777",
          itineraryDayId: dayTwoId,
          itemType: "food" as const,
          orderIndex: 0,
          sourceSnapshot: {
            place: {
              coordinates: { latitude: 35.0037, longitude: 135.7788 },
              name: "Nishiki Market",
            },
            source: {
              freshness: "stale",
              label: "Saved place details",
              retrievedAt: "2026-07-20T08:00:00.000Z",
            },
          },
          startTime: "10:00",
          transport: {},
        },
      ],
      localDate: "2099-08-02",
      notes: null,
      orderIndex: 1,
      timezone: "Asia/Tokyo",
      title: "Markets and makers",
      tripId,
    },
    {
      id: dayOneId,
      items: [
        {
          ...baseItem,
          durationMinutes: 30,
          endTime: "10:40",
          id: "66666666-6666-4666-8666-666666666666",
          itemType: "transport" as const,
          orderIndex: 1,
          sourceSnapshot: {
            place: {
              address: "1 Kinkakujicho, Kita Ward",
              coordinates: { latitude: 35.0394, longitude: 135.7292 },
              name: "Kinkaku-ji",
            },
            source: {
              freshness: "fresh",
              label: "Saved place details",
              retrievedAt: "2026-07-28T10:00:00.000Z",
              url: "https://example.com/kinkakuji",
            },
          },
          startTime: "10:10",
          transport: { route },
        },
        {
          ...baseItem,
          durationMinutes: 60,
          endTime: "10:00",
          estimatedCost: { amountMinor: 2_000, currency: "SGD" },
          id: "55555555-5555-4555-8555-555555555555",
          itemType: "activity" as const,
          orderIndex: 0,
          sourceSnapshot: {
            place: {
              address: "Nakagyo Ward, Kyoto",
              coordinates: { latitude: 35.0116, longitude: 135.7681 },
              name: "Morning walk",
            },
            source: {
              freshness: "fresh",
              label: "Saved place details",
              retrievedAt: "2026-07-28T10:00:00.000Z",
            },
          },
          startTime: "09:00",
          transport: {},
        },
      ],
      localDate: "2099-08-01",
      notes: "A gentle first day.",
      orderIndex: 0,
      timezone: "Asia/Tokyo",
      title: "Arrival rhythm",
      tripId,
    },
  ],
  destinations: [],
  endDate: "2099-08-02",
  generationState: "ready" as const,
  id: tripId,
  originPlaceId: null,
  revision: 4,
  slug: "kyoto-slow-days",
  startDate: "2099-08-01",
  status: "active" as const,
  title: "Kyoto slow days",
  travelerSummary: { adults: 2, children: 0, infants: 0 },
  updatedAt: "2026-07-28T10:00:00.000Z",
  visibility: "private" as const,
};

describe("ItineraryWorkspace", () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.createTripItem.mockReset();
    api.deleteTripItem.mockReset();
    api.getTrip.mockReset();
    api.listShareLinks.mockReset();
    api.updateTripItem.mockReset();
    api.getTrip.mockResolvedValue({ data: trip, meta: { requestId } });
    api.listShareLinks.mockResolvedValue({ data: { links: [] }, meta: { requestId } });
    api.createTripItem.mockImplementation(async (_requestedTripId, input) => ({
      data: {
        item: {
          ...input,
          id: "88888888-8888-4888-8888-888888888888",
          orderIndex: input.orderIndex ?? 2,
        },
        tripRevision: 5,
      },
      meta: { requestId },
    }));
    api.updateTripItem.mockImplementation(async (_requestedTripId, itemId, input) => {
      const current = trip.days.flatMap(({ items }) => items).find(({ id }) => id === itemId)!;
      return {
        data: { item: { ...current, ...input }, tripRevision: 5 },
        meta: { requestId },
      };
    });
    api.deleteTripItem.mockResolvedValue({
      data: { deletedId: "55555555-5555-4555-8555-555555555555", tripRevision: 5 },
      meta: { requestId },
    });
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
  });

  test("coordinates ordered itinerary details with equivalent map and text controls", async () => {
    const user = userEvent.setup();
    render(createElement(ItineraryWorkspace, { email: "traveler@roavia.test", tripId }));

    expect(await screen.findByRole("heading", { name: "Kyoto slow days" })).toBeDefined();
    const itemHeadings = screen.getAllByRole("heading", { level: 3 });
    expect(itemHeadings[0]?.textContent).toBe("Morning walk");
    expect(itemHeadings[1]?.textContent).toBe("Kinkaku-ji");
    expect(screen.getAllByText("SGD 20.00")).toHaveLength(2);
    expect(screen.getAllByText("86%")).toHaveLength(2);
    expect(screen.getByText(/walking · 1.8 km · 30 min/i)).toBeDefined();
    expect(screen.getByText(/Travel-time conflict/)).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Select Kinkaku-ji in the itinerary" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Kinkaku-ji" })).toBeDefined();

    screen.getByRole("tab", { name: /Day 1/ }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("heading", { name: "Markets and makers" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Nishiki Market" })).toBeDefined();
    expect(screen.getByText(/Some route or place details are stale/)).toBeDefined();
  });

  test("keeps loaded details usable during offline and provider-unavailable states", async () => {
    const unavailableTrip = structuredClone(trip);
    unavailableTrip.days[0]!.items[0]!.transport = {
      availability: "provider_unavailable",
      reason: "The live routing service did not respond.",
    };
    api.getTrip.mockResolvedValue({ data: unavailableTrip, meta: { requestId } });
    const user = userEvent.setup();
    render(createElement(ItineraryWorkspace, { email: undefined, tripId }));

    await screen.findByRole("heading", { name: "Kyoto slow days" });
    await user.click(screen.getByRole("tab", { name: /Day 2/ }));
    expect(screen.getByText("Route provider unavailable")).toBeDefined();
    expect(screen.getByText(/Saved places and itinerary details remain usable/)).toBeDefined();

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    window.dispatchEvent(new Event("offline"));
    expect(await screen.findByText(/Offline: showing the itinerary already loaded/)).toBeDefined();
    expect(screen.getByRole("heading", { name: "Nishiki Market" })).toBeDefined();
  });

  test("shows permission recovery without exposing itinerary details", async () => {
    api.getTrip.mockRejectedValue(
      new ApiClientError({
        code: "invalid_session",
        message: "Session expired",
        requestId,
        status: 401,
      }),
    );
    render(createElement(ItineraryWorkspace, { email: undefined, tripId }));

    expect(await screen.findByRole("heading", { name: "Itinerary access needed" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Sign in again" })).toBeDefined();
    expect(screen.queryByText("Kyoto slow days")).toBeNull();
  });

  test("has no detectable accessibility violations", async () => {
    const { container } = render(
      createElement(ItineraryWorkspace, { email: "traveler@roavia.test", tripId }),
    );
    await screen.findByRole("heading", { name: "Kyoto slow days" });

    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toHaveLength(0);
  });

  test("preserves the loaded itinerary after a refresh failure", async () => {
    const user = userEvent.setup();
    render(createElement(ItineraryWorkspace, { email: undefined, tripId }));
    await screen.findByRole("heading", { name: "Kyoto slow days" });
    api.getTrip.mockRejectedValueOnce(new Error("The route service timed out."));

    await user.click(screen.getByRole("button", { name: "Refresh itinerary" }));

    await waitFor(() => {
      expect(screen.getByText(/Refresh failed: The route service timed out/)).toBeDefined();
    });
    expect(screen.getByRole("heading", { name: "Arrival rhythm" })).toBeDefined();
  });

  test("adds and validates complete itinerary item metadata", async () => {
    const user = userEvent.setup();
    render(createElement(ItineraryWorkspace, { email: undefined, tripId }));
    await screen.findByRole("heading", { name: "Kyoto slow days" });

    await user.click(screen.getByRole("button", { name: "+ Add item" }));
    const dialog = screen.getByRole("dialog", { name: "Add itinerary item" });
    await user.selectOptions(within(dialog).getByLabelText("Item type"), "food");
    await user.type(within(dialog).getByLabelText("Place or item name"), "Tea ceremony");
    await user.type(within(dialog).getByLabelText("Start time"), "12:00");
    await user.type(within(dialog).getByLabelText("End time"), "13:30");
    await user.type(within(dialog).getByLabelText("Duration (minutes)"), "90");
    await user.type(within(dialog).getByLabelText("Cost estimate"), "45.50");
    await user.clear(within(dialog).getByLabelText("Currency"));
    await user.type(within(dialog).getByLabelText("Currency"), "JPY");
    await user.type(within(dialog).getByLabelText("Transport mode"), "train");
    await user.type(within(dialog).getByLabelText("Transport details"), "Karasuma Line");
    await user.type(within(dialog).getByLabelText("Booking reference"), "TEA-42");
    await user.type(
      within(dialog).getByLabelText("Booking URL"),
      "https://bookings.example/tea-42",
    );
    await user.type(within(dialog).getByLabelText("Notes"), "Arrive ten minutes early.");
    await user.click(within(dialog).getByRole("button", { name: "Add item" }));

    await waitFor(() => expect(api.createTripItem).toHaveBeenCalledTimes(1));
    expect(api.createTripItem).toHaveBeenCalledWith(
      tripId,
      expect.objectContaining({
        booking: { reference: "TEA-42", url: "https://bookings.example/tea-42" },
        durationMinutes: 90,
        estimatedCost: { amountMinor: 4_550, currency: "JPY" },
        expectedTripRevision: 4,
        itemType: "food",
        sourceSnapshot: { place: { name: "Tea ceremony" } },
        transport: { details: "Karasuma Line", mode: "train" },
      }),
    );
    expect(await screen.findByRole("heading", { name: "Tea ceremony" })).toBeDefined();
    expect(screen.getByText("Karasuma Line")).toBeDefined();
    expect(screen.getByText("TEA-42")).toBeDefined();
    expect(screen.getByText("Item added and saved.")).toBeDefined();
  });

  test("edits, replaces, and duplicates items without discarding saved metadata", async () => {
    const user = userEvent.setup();
    render(createElement(ItineraryWorkspace, { email: undefined, tripId }));
    const heading = await screen.findByRole("heading", { name: "Morning walk" });
    const card = heading.closest("article")!;

    await user.click(within(card).getByRole("button", { name: "Edit" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit itinerary item" });
    await user.type(within(editDialog).getByLabelText("Notes"), "Bring water.");
    await user.click(within(editDialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateTripItem).toHaveBeenCalledTimes(1));
    expect(api.updateTripItem).toHaveBeenLastCalledWith(
      tripId,
      "55555555-5555-4555-8555-555555555555",
      expect.objectContaining({
        expectedTripRevision: 4,
        notes: "Bring water.",
        sourceSnapshot: expect.objectContaining({
          source: expect.objectContaining({ label: "Saved place details" }),
        }),
      }),
    );

    await user.click(within(card).getByRole("button", { name: "Replace" }));
    const replaceDialog = screen.getByRole("dialog", { name: "Replace itinerary item" });
    await user.clear(within(replaceDialog).getByLabelText("Place or item name"));
    await user.type(within(replaceDialog).getByLabelText("Place or item name"), "Temple garden");
    await user.click(within(replaceDialog).getByRole("button", { name: "Replace item" }));
    await waitFor(() => expect(api.updateTripItem).toHaveBeenCalledTimes(2));
    expect(api.updateTripItem).toHaveBeenLastCalledWith(
      tripId,
      "55555555-5555-4555-8555-555555555555",
      expect.objectContaining({
        sourceSnapshot: expect.objectContaining({
          source: expect.objectContaining({ freshness: "stale" }),
        }),
      }),
    );

    const replacedCard = screen.getByRole("heading", { name: "Temple garden" }).closest("article")!;
    await user.click(within(replacedCard).getByRole("button", { name: "Duplicate" }));
    const duplicateDialog = screen.getByRole("dialog", { name: "Duplicate itinerary item" });
    await user.click(within(duplicateDialog).getByRole("button", { name: "Create duplicate" }));
    await waitFor(() => expect(api.createTripItem).toHaveBeenCalledTimes(1));
    expect(api.createTripItem).toHaveBeenCalledWith(
      tripId,
      expect.objectContaining({ expectedTripRevision: 5, orderIndex: 1 }),
    );
    expect(screen.getAllByText(/Possible duplicate/)).toHaveLength(2);
  });

  test("reorders and removes items with button alternatives and optimistic reconciliation", async () => {
    const user = userEvent.setup();
    render(createElement(ItineraryWorkspace, { email: undefined, tripId }));
    const morning = await screen.findByRole("heading", { name: "Morning walk" });
    const morningCard = morning.closest("article")!;

    await user.click(within(morningCard).getByRole("button", { name: /Move Morning walk later/ }));
    await waitFor(() => expect(api.updateTripItem).toHaveBeenCalledTimes(1));
    expect(api.updateTripItem).toHaveBeenCalledWith(
      tripId,
      "55555555-5555-4555-8555-555555555555",
      { expectedTripRevision: 4, orderIndex: 1 },
    );
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings[0]?.textContent).toBe("Kinkaku-ji");
    expect(headings[1]?.textContent).toBe("Morning walk");

    await user.click(within(morningCard).getByRole("button", { name: "Remove" }));
    const removeDialog = screen.getByRole("alertdialog", { name: "Remove this itinerary item?" });
    await user.click(within(removeDialog).getByRole("button", { name: "Remove item" }));
    await waitFor(() => expect(api.deleteTripItem).toHaveBeenCalledTimes(1));
    expect(api.deleteTripItem).toHaveBeenCalledWith(
      tripId,
      "55555555-5555-4555-8555-555555555555",
      { expectedTripRevision: 5 },
    );
    expect(screen.queryByRole("heading", { name: "Morning walk" })).toBeNull();
  });

  test("reorders items with pointer drag and drop", async () => {
    render(createElement(ItineraryWorkspace, { email: undefined, tripId }));
    const source = await screen.findByRole("button", {
      name: "Drag Morning walk to reorder; current position 1",
    });
    const target = screen.getByRole("button", {
      name: "Drag Kinkaku-ji to reorder; current position 2",
    });

    fireEvent.pointerDown(source);
    fireEvent.pointerUp(target);

    await waitFor(() => expect(api.updateTripItem).toHaveBeenCalledTimes(1));
    expect(api.updateTripItem).toHaveBeenCalledWith(
      tripId,
      "55555555-5555-4555-8555-555555555555",
      { expectedTripRevision: 4, orderIndex: 1 },
    );
  });

  test("restores failed optimistic edits, retains the draft, and reloads concurrent changes", async () => {
    const user = userEvent.setup();
    api.updateTripItem.mockRejectedValueOnce(new Error("Network unavailable."));
    render(createElement(ItineraryWorkspace, { email: undefined, tripId }));
    const card = (await screen.findByRole("heading", { name: "Morning walk" })).closest("article")!;
    await user.click(within(card).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit itinerary item" });
    await user.type(within(dialog).getByLabelText("Notes"), "Unsaved draft");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/previous itinerary was restored/)).toBeDefined();
    expect(screen.getByRole("dialog", { name: "Edit itinerary item" })).toBeDefined();
    expect(within(dialog).getByLabelText("Notes")).toHaveProperty("value", "Unsaved draft");
    expect(within(card).queryByText("Unsaved draft")).toBeNull();

    api.updateTripItem.mockRejectedValueOnce(
      new ApiClientError({ code: "conflict", message: "Stale revision", requestId, status: 409 }),
    );
    const latestTrip = structuredClone(trip);
    latestTrip.revision = 6;
    latestTrip.days[1]!.items[0]!.notes = "Saved in another session.";
    api.getTrip.mockResolvedValueOnce({ data: latestTrip, meta: { requestId } });
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/changed in another session/)).toBeDefined();
    expect(screen.getByText("Saved in another session.")).toBeDefined();
  });

  test("explains validation errors before sending a mutation", async () => {
    const user = userEvent.setup();
    render(createElement(ItineraryWorkspace, { email: undefined, tripId }));
    await screen.findByRole("heading", { name: "Kyoto slow days" });
    await user.click(screen.getByRole("button", { name: "+ Add item" }));
    const dialog = screen.getByRole("dialog", { name: "Add itinerary item" });
    await user.type(within(dialog).getByLabelText("Place or item name"), "Incomplete stop");
    await user.type(within(dialog).getByLabelText("Start time"), "14:00");
    await user.click(within(dialog).getByRole("button", { name: "Add item" }));

    expect(screen.getByRole("alert").textContent).toContain("Provide both a start and end time");
    expect(api.createTripItem).not.toHaveBeenCalled();
  });
});
