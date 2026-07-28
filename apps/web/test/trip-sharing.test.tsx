// @vitest-environment jsdom

import axe from "axe-core";
import type { SharedTrip } from "@roavia/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  createShareLink: vi.fn<(tripId: string, input: unknown) => Promise<any>>(),
  getSharedTrip: vi.fn<(token: string) => Promise<any>>(),
  listShareLinks: vi.fn<(tripId: string) => Promise<any>>(),
  revokeShareLink: vi.fn<(tripId: string, linkId: string) => Promise<any>>(),
}));

vi.mock("@roavia/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@roavia/api-client")>()),
  createRoaviaApiClient: () => api,
}));

vi.mock("../lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

import { SharedItinerary } from "../components/shared-itinerary";
import { TripShareControls } from "../components/trip-share-controls";

const requestId = "11111111-1111-4111-8111-111111111111";
const tripId = "22222222-2222-4222-8222-222222222222";
const linkId = "33333333-3333-4333-8333-333333333333";
const token = "A".repeat(43);
const createdAt = "2026-07-28T10:00:00.000Z";
const expiresAt = "2099-08-27T10:00:00.000Z";
const link = {
  id: linkId,
  permission: "view" as const,
  status: "active" as const,
  createdAt,
  expiresAt,
  revokedAt: null,
};
const sharedTrip: SharedTrip = {
  title: "Kyoto slow days",
  startDate: "2099-08-01",
  endDate: "2099-08-02",
  updatedAt: createdAt,
  expiresAt,
  days: [
    {
      localDate: "2099-08-01",
      timezone: "Asia/Tokyo",
      title: "Arrival rhythm",
      notes: "A gentle first day.",
      orderIndex: 0,
      items: [
        {
          itemType: "activity",
          startTime: "09:00",
          endTime: "10:00",
          durationMinutes: 60,
          estimatedCost: null,
          sourceSnapshot: {
            place: { address: "Nakagyo Ward, Kyoto", name: "Morning walk" },
            source: {
              freshness: "stale",
              label: "Saved place details",
              retrievedAt: createdAt,
            },
          },
          route: null,
          confidence: 0.8,
          notes: "Meet by the gate.",
          orderIndex: 0,
        },
      ],
    },
  ],
};

describe("trip sharing UI", () => {
  afterEach(cleanup);

  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset();
    api.listShareLinks.mockResolvedValue({ data: { links: [] }, meta: { requestId } });
    api.createShareLink.mockResolvedValue({ data: { link, token }, meta: { requestId } });
    api.revokeShareLink.mockResolvedValue({
      data: { id: linkId, revokedAt: createdAt },
      meta: { requestId },
    });
    api.getSharedTrip.mockResolvedValue({ data: sharedTrip, meta: { requestId } });
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined) },
    });
  });

  test("creates, copies, previews, and revokes a finite read-only link", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(createElement(TripShareControls, { tripId }));
    await screen.findByText("No share links have been created for this trip.");
    await user.selectOptions(screen.getByLabelText("Expires after"), "90");
    await user.click(screen.getByRole("button", { name: "Create link" }));

    const expectedUrl = `${window.location.origin}/shared/${token}`;
    expect(api.createShareLink).toHaveBeenCalledWith(tripId, { expiresInDays: 90 });
    expect(screen.getByDisplayValue(expectedUrl)).toBeDefined();
    expect(screen.getByRole("link", { name: "Open preview" }).getAttribute("href")).toBe(
      expectedUrl,
    );
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(expectedUrl);
    await user.click(screen.getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText("revoked link")).toBeDefined();
  });

  test("renders stale shared itinerary context without owner-private fields", async () => {
    const { container } = render(createElement(SharedItinerary, { token }));
    expect(await screen.findByRole("heading", { name: "Kyoto slow days" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Arrival rhythm" })).toBeDefined();
    expect(screen.getByText("Morning walk")).toBeDefined();
    expect(screen.getByText(/Some saved place or route context is stale/)).toBeDefined();
    expect(screen.queryByText(/PRIVATE-42|private@example.com/i)).toBeNull();
    const result = await axe.run(container, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toHaveLength(0);
  });

  test("uses one generic unavailable state for missing, expired, or revoked links", async () => {
    api.getSharedTrip.mockRejectedValue(new Error("not found"));
    render(createElement(SharedItinerary, { token }));
    expect(await screen.findByRole("heading", { name: "Shared trip unavailable" })).toBeDefined();
    expect(screen.getByText(/could not be loaded/)).toBeDefined();
  });
});
