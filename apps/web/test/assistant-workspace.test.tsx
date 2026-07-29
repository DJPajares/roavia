// @vitest-environment jsdom

import type { RoaviaApiClient } from "@roavia/api-client";
import type { AssistantActionPreview, Trip } from "@roavia/contracts";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  askAssistant: vi.fn<RoaviaApiClient["askAssistant"]>(),
  cancelAssistantAction: vi.fn<RoaviaApiClient["cancelAssistantAction"]>(),
  confirmAssistantAction: vi.fn<RoaviaApiClient["confirmAssistantAction"]>(),
  listTrips: vi.fn<RoaviaApiClient["listTrips"]>(),
}));

vi.mock("@roavia/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@roavia/api-client")>()),
  createRoaviaApiClient: () => api,
}));

vi.mock("../lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

import { AssistantWorkspace } from "../components/assistant-workspace";

const requestId = "10000000-0000-4000-8000-000000000001";
const tripId = "20000000-0000-4000-8000-000000000002";
const confirmActionId = "30000000-0000-4000-8000-000000000003";
const cancelActionId = "40000000-0000-4000-8000-000000000004";

const trip: Trip = {
  budget: { amountMinor: null, currency: "SGD", style: "midrange" },
  createdAt: "2026-07-29T00:00:00.000Z",
  dateFlexibility: { daysAfter: 0, daysBefore: 0 },
  endDate: "2026-08-04",
  generationState: "ready",
  id: tripId,
  originPlaceId: null,
  planningPreferences: null,
  revision: 4,
  slug: "singapore-trip",
  startDate: "2026-08-01",
  status: "active",
  title: "Singapore trip",
  travelerSummary: { adults: 1, children: 0, infants: 0 },
  updatedAt: "2026-07-29T00:00:00.000Z",
  visibility: "private",
};

const actionBase: Pick<
  AssistantActionPreview,
  "expectedTripRevision" | "expiresAt" | "status" | "tripId"
> = {
  expectedTripRevision: 4,
  expiresAt: "2026-07-29T00:15:00.000Z",
  status: "pending",
  tripId,
};

describe("AssistantWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listTrips.mockResolvedValue({
      data: { pagination: { limit: 50, nextCursor: null }, trips: [trip] },
      meta: { requestId },
    });
    api.askAssistant.mockResolvedValue({
      data: {
        actions: [
          {
            ...actionBase,
            actionId: confirmActionId,
            payload: {
              itemId: "50000000-0000-4000-8000-000000000005",
              kind: "save_note",
              note: "Check opening hours.",
              sourceIds: ["source-official"],
              summary: "Save an opening-hours reminder",
            },
          },
          {
            ...actionBase,
            actionId: cancelActionId,
            payload: {
              itemId: "60000000-0000-4000-8000-000000000006",
              kind: "remove_item",
              sourceIds: ["source-official"],
              summary: "Remove the closed attraction",
            },
          },
        ],
        answer: "The official guide recommends checking current opening hours.",
        claims: [
          {
            claimId: "claim-1",
            confidence: { explanation: "Official and current.", level: "high" },
            sourceIds: ["source-official"],
            text: "Opening hours should be checked.",
          },
        ],
        evidence: { gaps: [], status: "complete" },
        safety: {
          classification: "general",
          disclaimer: null,
          explanation: "General travel guidance.",
          officialSourceRequired: false,
        },
        sources: [
          {
            freshness: "fresh",
            official: true,
            retrievedAt: "2026-07-29T00:00:00.000Z",
            sourceId: "source-official",
            title: "Official destination guide",
            url: "https://example.gov.test/guide",
            validUntil: null,
          },
        ],
        status: "answered",
        uncertainty: { explanation: "Opening hours can change.", level: "medium" },
      },
      meta: { requestId },
    });
    api.confirmAssistantAction.mockResolvedValue({
      data: { actionId: confirmActionId, status: "applied", tripId, tripRevision: 5 },
      meta: { requestId },
    });
    api.cancelAssistantAction.mockResolvedValue({
      data: { actionId: cancelActionId, status: "cancelled", tripId, tripRevision: null },
      meta: { requestId },
    });
  });

  test("supports asking, source review, confirmation, and cancellation", async () => {
    const user = userEvent.setup();
    render(createElement(AssistantWorkspace, { email: "traveler@roavia.test" }));

    expect(await screen.findByRole("option", { name: "Singapore trip" })).toBeDefined();
    await user.type(
      screen.getByLabelText("Your question"),
      "What should I check before this trip?",
    );
    await user.click(screen.getByRole("button", { name: "Ask Roavia" }));

    expect(await screen.findByRole("heading", { name: "Roavia’s answer" })).toBeDefined();
    expect(screen.getByText(/official guide recommends/)).toBeDefined();
    const source = screen.getByRole("link", { name: "Official destination guide" });
    expect(source.getAttribute("href")).toBe("https://example.gov.test/guide");
    expect(screen.getByText("Official source")).toBeDefined();

    await user.click(
      screen.getByRole("button", { name: "Confirm: Save an opening-hours reminder" }),
    );
    expect(await screen.findByText("applied")).toBeDefined();
    expect(api.confirmAssistantAction).toHaveBeenCalledWith(confirmActionId);

    await user.click(screen.getByRole("button", { name: "Cancel: Remove the closed attraction" }));
    expect(await screen.findByText("cancelled")).toBeDefined();
    expect(api.cancelAssistantAction).toHaveBeenCalledWith(cancelActionId);
    expect(api.askAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        context: { tripId, type: "trip" },
        question: "What should I check before this trip?",
      }),
    );
  });
});
