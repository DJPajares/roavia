// @vitest-environment jsdom

import axe from "axe-core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn<(path: string) => void>() }));
const api = vi.hoisted(() => ({
  cancelTripGeneration: vi.fn<(tripId: string, input: unknown) => Promise<unknown>>(),
  createTrip: vi.fn<(input: unknown) => Promise<any>>(),
  createTripDestination: vi.fn<(tripId: string, input: unknown) => Promise<any>>(),
  extractTripIntent: vi.fn<(input: unknown) => Promise<any>>(),
  generateTrip: vi.fn<(tripId: string, input: unknown) => Promise<any>>(),
  getTripGeneration: vi.fn<(tripId: string) => Promise<any>>(),
  regenerateTrip: vi.fn<(tripId: string, input: unknown) => Promise<any>>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@roavia/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@roavia/api-client")>()),
  createRoaviaApiClient: () => api,
}));
vi.mock("../lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));
vi.mock("../components/guided-trip-planner", () => ({
  GuidedTripPlanner: () => "Manual planner loaded",
}));

import { NaturalLanguageTripPlanner, TripPlanner } from "../components/trip-planner";

const tripId = "10000000-0000-4000-8000-000000000001";
const placeId = "20000000-0000-4000-8000-000000000001";
const secondPlaceId = "30000000-0000-4000-8000-000000000001";
const generationRunId = "40000000-0000-4000-8000-000000000001";
const jobId = "50000000-0000-4000-8000-000000000001";

const candidate = {
  canonicalName: "Tokyo",
  countryCode: "JP",
  hierarchy: [],
  id: placeId,
  localizedNames: {},
  placeType: "city" as const,
};

const extraction = {
  assumptions: [{ field: "pace", summary: "A balanced pace was inferred." }],
  intent: {
    budget: { amountMinor: 500_000, currency: "USD", style: "midrange" as const },
    constraints: {
      accessibility: ["step-free routes"],
      dietary: ["vegetarian"],
      mustAvoid: ["overnight buses"],
      mustDo: ["teamLab"],
    },
    dateFlexibility: { daysAfter: 1, daysBefore: 1 },
    destinations: [{ candidates: [candidate], query: "Tokyo", selectedPlaceId: placeId }],
    endDate: "2030-10-15",
    interests: ["food", "museums"],
    pace: "balanced" as const,
    startDate: "2030-10-10",
    title: "Tokyo family trip",
    travelers: { adults: 2, children: 1, infants: 0 },
  },
  issues: [],
  status: "needs_review" as const,
};

const queued = {
  data: { generationRunId, jobId, status: "queued", tripRevision: 3 },
};

const generationSummary = {
  assumptions: [],
  completedAt: null,
  createdAt: "2026-07-29T00:00:00.000Z",
  failureCode: null,
  groundingStatus: null,
  id: generationRunId,
  maxRepairAttempts: 2,
  overallConfidence: null,
  repairAttempts: 0,
  sources: [],
  status: "succeeded" as const,
  tripRevision: 3,
  warnings: [],
};

describe("TripPlanner", () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset();
  });

  afterEach(() => cleanup());

  test("starts with an accessible manual-or-AI choice and does not initialize AI planning", async () => {
    const user = userEvent.setup();
    const rendered = render(createElement(TripPlanner));

    expect(screen.getByRole("heading", { name: "Create a trip your way." })).toBeDefined();
    expect(screen.getByRole("button", { name: "Plan manually" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Plan with AI" })).toBeDefined();
    expect(screen.queryByLabelText("Trip request")).toBeNull();
    expect(api.extractTripIntent).not.toHaveBeenCalled();
    expect(
      (
        await axe.run(rendered.container, {
          rules: { "color-contrast": { enabled: false } },
        })
      ).violations,
    ).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Plan manually" }));
    expect(screen.getByText("Manual planner loaded")).toBeDefined();
    expect(api.extractTripIntent).not.toHaveBeenCalled();
  });

  test("only exposes the AI prompt after the traveler chooses AI planning", async () => {
    const user = userEvent.setup();
    render(createElement(TripPlanner));

    await user.click(screen.getByRole("button", { name: "Plan with AI" }));

    expect(
      screen.getByRole("heading", { name: "Tell us the trip you have in mind." }),
    ).toBeDefined();
    expect(screen.getByLabelText("Trip request")).toBeDefined();
    expect(api.extractTripIntent).not.toHaveBeenCalled();
  });
});

describe("NaturalLanguageTripPlanner", () => {
  beforeEach(() => {
    router.push.mockReset();
    for (const mock of Object.values(api)) mock.mockReset();
    api.extractTripIntent.mockResolvedValue({ data: extraction });
    api.createTrip.mockResolvedValue({ data: { id: tripId, revision: 1 } });
    api.createTripDestination.mockResolvedValue({ data: { tripRevision: 2 } });
    api.generateTrip.mockResolvedValue(queued);
    api.regenerateTrip.mockResolvedValue({
      data: {
        ...queued.data,
        generationRunId: crypto.randomUUID(),
        jobId: crypto.randomUUID(),
        tripRevision: 4,
      },
    });
    api.cancelTripGeneration.mockResolvedValue({
      data: { generationRunId, jobId, status: "cancelled" },
    });
    api.getTripGeneration.mockResolvedValue({ data: generationSummary });
  });

  afterEach(() => cleanup());

  test("reviews editable intent and hands a standard trip to the workspace", async () => {
    const user = userEvent.setup();
    const rendered = render(createElement(NaturalLanguageTripPlanner));

    await user.type(
      screen.getByLabelText("Trip request"),
      "Plan a balanced family trip to Tokyo in October with vegetarian food and step-free routes.",
    );
    await user.click(screen.getByRole("button", { name: "Review trip details" }));
    expect(
      await screen.findByRole("heading", { name: "Correct what Roavia understood." }),
    ).toBeDefined();
    expect(screen.getByText("A balanced pace was inferred.")).toBeDefined();
    expect(
      (
        await axe.run(rendered.container, {
          rules: { "color-contrast": { enabled: false } },
        })
      ).violations,
    ).toEqual([]);

    const title = screen.getByLabelText("Trip name");
    await user.clear(title);
    await user.type(title, "Tokyo together");
    await user.click(screen.getByRole("button", { name: "Generate itinerary" }));

    expect(api.createTrip).toHaveBeenCalledWith(
      expect.objectContaining({
        planningPreferences: expect.objectContaining({
          accessibilityNeeds: ["step-free routes"],
          dietaryNeeds: ["vegetarian"],
          pace: "balanced",
        }),
        title: "Tokyo together",
      }),
    );
    expect(api.createTripDestination).toHaveBeenCalledWith(
      tripId,
      expect.objectContaining({ expectedTripRevision: 1, placeId }),
    );
    expect(api.generateTrip).toHaveBeenCalledWith(tripId, { expectedTripRevision: 2 });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/trips/${tripId}`));
  });

  test("keeps ambiguous, contradictory, and unsupported details visible for correction", async () => {
    api.extractTripIntent.mockResolvedValue({
      data: {
        ...extraction,
        intent: {
          ...extraction.intent,
          destinations: [
            {
              candidates: [
                { ...candidate, canonicalName: "Paris, France", countryCode: "FR" },
                {
                  ...candidate,
                  canonicalName: "Paris, Texas",
                  countryCode: "US",
                  id: secondPlaceId,
                },
              ],
              query: "Paris",
              selectedPlaceId: null,
            },
          ],
          endDate: "2030-10-10",
          startDate: "2030-10-15",
        },
        issues: [
          {
            code: "destination_ambiguous",
            field: "destinations",
            message: "Choose which Paris you meant before generation.",
            severity: "blocking",
          },
          {
            code: "date_order_invalid",
            field: "endDate",
            message: "The end date is before the start date.",
            severity: "blocking",
          },
          {
            code: "unsupported_request",
            field: "prompt",
            message: "Automatic flight purchasing is not supported.",
            severity: "blocking",
          },
        ],
        status: "unsupported",
      },
    });
    const user = userEvent.setup();
    render(createElement(NaturalLanguageTripPlanner));
    await user.type(
      screen.getByLabelText("Trip request"),
      "Plan a Paris trip and automatically buy every flight for me next October.",
    );
    await user.click(screen.getByRole("button", { name: "Review trip details" }));

    expect(
      await screen.findByText("Choose which Paris you meant before generation."),
    ).toBeDefined();
    expect(screen.getByText("The end date is before the start date.")).toBeDefined();
    expect(screen.getByText("Automatic flight purchasing is not supported.")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Generate itinerary" }));
    expect(api.createTrip).not.toHaveBeenCalled();
  });

  test("supports cancellation and retry while preserving the saved trip", async () => {
    api.getTripGeneration.mockResolvedValue({
      data: { ...generationSummary, status: "generating" },
    });
    const user = userEvent.setup();
    render(createElement(NaturalLanguageTripPlanner));
    await user.type(
      screen.getByLabelText("Trip request"),
      "Plan a complete family trip to Tokyo with dates and a midrange budget.",
    );
    await user.click(screen.getByRole("button", { name: "Review trip details" }));
    await user.click(await screen.findByRole("button", { name: "Generate itinerary" }));
    await user.click(await screen.findByRole("button", { name: "Cancel generation" }));

    expect(api.cancelTripGeneration).toHaveBeenCalledWith(tripId, { generationRunId, jobId });
    expect(
      await screen.findByText("Generation was cancelled. Your reviewed trip is still saved."),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Retry generation" }));
    expect(api.regenerateTrip).toHaveBeenCalledWith(tripId, { expectedTripRevision: 3 });
  });
});
