// @vitest-environment jsdom

import type { OfflinePackageRecord } from "@roavia/contracts";
import { OfflineStorageError, type StoredOfflinePackage } from "@roavia/offline/browser";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  createOfflinePackage:
    vi.fn<(tripId: string, options?: { signal?: AbortSignal }) => Promise<unknown>>(),
}));

const storage = vi.hoisted(() => ({
  assertStorageCapacity: vi.fn<(estimate: unknown, requiredBytes: number) => void>(),
  estimateOfflineStorage: vi.fn<() => Promise<unknown>>(),
  getOfflinePackage: vi.fn<(ownerId: string, tripId: string) => Promise<unknown>>(),
  removeOfflinePackage: vi.fn<(ownerId: string, tripId: string) => Promise<void>>(),
  saveOfflinePackage:
    vi.fn<
      (ownerId: string, record: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>
    >(),
}));

vi.mock("@roavia/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@roavia/api-client")>()),
  createRoaviaApiClient: () => api,
}));

vi.mock("@roavia/offline/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@roavia/offline/browser")>()),
  ...storage,
}));

vi.mock("../lib/supabase/client", () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }),
}));

import { OfflineItinerary } from "../components/offline-itinerary";
import { OfflinePackageControls } from "../components/offline-package-controls";

const ownerId = "11111111-1111-4111-8111-111111111111";
const tripId = "22222222-2222-4222-8222-222222222222";
const placeId = "33333333-3333-4333-8333-333333333333";
const dayId = "44444444-4444-4444-8444-444444444444";

const record: OfflinePackageRecord = {
  expiresAt: null,
  generatedAt: "2026-07-29T12:00:00.000Z",
  id: "55555555-5555-4555-8555-555555555555",
  manifest: {
    contentHash: "a".repeat(64),
    generatedAt: "2026-07-29T12:00:00.000Z",
    guidance: [
      {
        contentType: "emergency_contacts",
        data: { ambulance: "119", police: "110" },
        freshness: "fresh",
        placeId,
        refreshedAt: "2026-07-28T12:00:00.000Z",
        sources: [
          {
            attribution: "Official city guidance",
            license: "open-data",
            licenseUrl: null,
            retrievedAt: "2026-07-28T12:00:00.000Z",
            title: "Tokyo emergency contacts",
            trustTier: "tier_1",
            url: "https://example.com/emergency",
          },
        ],
      },
    ],
    licensing: { excludedContent: [] },
    liveData: {
      assistantResponses: "unavailable_offline",
      bookingAvailability: "unavailable_offline",
      closures: "unavailable_offline",
      prices: "unavailable_offline",
      weather: "unavailable_offline",
    },
    packageVersion: 1,
    schemaVersion: 1,
    sizeBytes: 2_048,
    trip: {
      days: [
        {
          id: dayId,
          items: [
            {
              booking: { availability: "unavailable_offline", snapshot: null },
              durationMinutes: 60,
              endTime: "10:00",
              estimatedCost: null,
              id: "66666666-6666-4666-8666-666666666666",
              itemType: "activity",
              notes: "Use the east entrance.",
              orderIndex: 0,
              place: {
                address: "1 Offline Street",
                coordinates: { latitude: 35.6762, longitude: 139.6503 },
                id: placeId,
                name: "Morning market",
                timezone: "Asia/Tokyo",
                type: "poi",
              },
              startTime: "09:00",
              transport: null,
            },
          ],
          localDate: "2026-10-02",
          notes: "Keep the emergency card in the day bag.",
          orderIndex: 0,
          timezone: "Asia/Tokyo",
          title: "Arrival",
        },
      ],
      destinations: [],
      endDate: "2026-10-03",
      id: tripId,
      revision: 3,
      startDate: "2026-10-01",
      title: "Tokyo offline",
    },
  },
  sizeBytes: 2_048,
  tripId,
  version: 1,
};

const savedPackage: StoredOfflinePackage = {
  downloadedAt: "2026-07-29T12:01:00.000Z",
  key: `${ownerId}:${tripId}`,
  ownerId,
  record,
  tripId,
};

describe("offline package experience", () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.createOfflinePackage.mockReset();
    storage.assertStorageCapacity.mockReset();
    storage.estimateOfflineStorage.mockReset();
    storage.getOfflinePackage.mockReset();
    storage.removeOfflinePackage.mockReset();
    storage.saveOfflinePackage.mockReset();
    storage.getOfflinePackage.mockResolvedValue(null);
    storage.estimateOfflineStorage.mockResolvedValue({
      availableBytes: 10_000,
      quotaBytes: 20_000,
      usageBytes: 10_000,
    });
    storage.saveOfflinePackage.mockResolvedValue(savedPackage);
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    });
  });

  test("downloads a package and announces version, size, and live-data boundaries", async () => {
    api.createOfflinePackage.mockResolvedValue({
      data: { package: record, reused: false },
      meta: { requestId: "77777777-7777-4777-8777-777777777777" },
    });
    const user = userEvent.setup();
    render(createElement(OfflinePackageControls, { ownerId, tripId, tripRevision: 3 }));

    await user.click(screen.getByRole("button", { name: "Download for offline" }));

    expect(await screen.findByText("Saved on this device")).toBeDefined();
    expect(screen.getByText("Current package")).toBeDefined();
    expect(screen.getByText("2.0 KB")).toBeDefined();
    expect(screen.getByText(/Weather, closures, live prices/)).toBeDefined();
    expect(storage.saveOfflinePackage).toHaveBeenCalledWith(
      ownerId,
      record,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  test("cancels an interrupted refresh without replacing the previous package", async () => {
    storage.getOfflinePackage.mockResolvedValue(savedPackage);
    api.createOfflinePackage.mockImplementation(
      (_tripId: string, options?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const user = userEvent.setup();
    render(createElement(OfflinePackageControls, { ownerId, tripId, tripRevision: 3 }));

    expect(await screen.findByText("Saved on this device")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Refresh package" }));
    await user.click(screen.getByRole("button", { name: "Cancel download" }));

    expect(await screen.findByText(/previous offline package is still available/)).toBeDefined();
    expect(storage.saveOfflinePackage).not.toHaveBeenCalled();
    expect(screen.getByText("Current package")).toBeDefined();
  });

  test("keeps the previous package when storage quota is insufficient", async () => {
    storage.getOfflinePackage.mockResolvedValue(savedPackage);
    storage.assertStorageCapacity.mockImplementation(() => {
      throw new OfflineStorageError("quota_exceeded", "Not enough storage");
    });
    api.createOfflinePackage.mockResolvedValue({
      data: { package: { ...record, sizeBytes: 4_096 }, reused: false },
      meta: { requestId: "77777777-7777-4777-8777-777777777777" },
    });
    const user = userEvent.setup();
    render(createElement(OfflinePackageControls, { ownerId, tripId, tripRevision: 4 }));

    await screen.findByText("Refresh available");
    await user.click(screen.getByRole("button", { name: "Refresh package" }));

    expect(await screen.findByText(/previous offline package is still available/)).toBeDefined();
    expect(storage.saveOfflinePackage).not.toHaveBeenCalled();
  });

  test("renders saved itinerary, address, notes, coordinates, and emergency guidance offline", () => {
    render(createElement(OfflineItinerary, { initialPackage: savedPackage, ownerId }));

    expect(screen.getByRole("heading", { name: "Tokyo offline" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "Morning market" })).toBeDefined();
    expect(screen.getByText("1 Offline Street")).toBeDefined();
    expect(screen.getByText(/35.6762, 139.6503/)).toBeDefined();
    expect(screen.getByText("Keep the emergency card in the day bag.")).toBeDefined();
    expect(screen.getByText("119")).toBeDefined();
    expect(screen.getByRole("link", { name: "Tokyo emergency contacts" })).toBeDefined();
  });

  test("removes a package only after destructive confirmation", async () => {
    const user = userEvent.setup();
    render(
      createElement(OfflinePackageControls, {
        initialPackage: savedPackage,
        ownerId,
        tripId,
        tripRevision: 3,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Remove download" }));
    const dialog = screen.getByRole("alertdialog", { name: "Remove this offline package?" });
    await user.click(within(dialog).getByRole("button", { name: "Remove from device" }));

    await waitFor(() => expect(storage.removeOfflinePackage).toHaveBeenCalledWith(ownerId, tripId));
    expect(await screen.findByText(/removed from this device/)).toBeDefined();
  });
});
