import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, test } from "vitest";

import {
  assertStorageCapacity,
  clearOfflinePackages,
  getOfflinePackage,
  listOfflinePackages,
  OfflineStorageError,
  removeOfflinePackage,
  saveOfflinePackage,
} from "../src/browser.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherOwnerId = "22222222-2222-4222-8222-222222222222";
const tripId = "33333333-3333-4333-8333-333333333333";

function packageRecord(version: number, revision: number, title: string) {
  const generatedAt = `2026-07-${String(20 + version).padStart(2, "0")}T12:00:00.000Z`;
  return {
    expiresAt: null,
    generatedAt,
    id: `${String(version).padStart(8, "0")}-4444-4444-8444-444444444444`,
    manifest: {
      contentHash: String(version).repeat(64),
      generatedAt,
      guidance: [],
      licensing: { excludedContent: [] },
      liveData: {
        assistantResponses: "unavailable_offline" as const,
        bookingAvailability: "unavailable_offline" as const,
        closures: "unavailable_offline" as const,
        prices: "unavailable_offline" as const,
        weather: "unavailable_offline" as const,
      },
      packageVersion: version,
      schemaVersion: 1 as const,
      sizeBytes: 512 + version,
      trip: {
        days: [],
        destinations: [],
        endDate: "2026-10-03",
        id: tripId,
        revision,
        startDate: "2026-10-01",
        title,
      },
    },
    sizeBytes: 512 + version,
    tripId,
    version,
  };
}

describe("browser offline package storage", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: new IDBFactory(),
    });
  });

  test("stores, replaces, lists, and removes account-scoped packages", async () => {
    const first = await saveOfflinePackage(ownerId, packageRecord(1, 1, "First version"), {
      downloadedAt: new Date("2026-07-29T12:00:00.000Z"),
    });
    await saveOfflinePackage(otherOwnerId, packageRecord(1, 1, "Other account"));
    const replacement = await saveOfflinePackage(
      ownerId,
      packageRecord(2, 2, "Refreshed version"),
      { downloadedAt: new Date("2026-07-30T12:00:00.000Z") },
    );

    expect(first.record.version).toBe(1);
    await expect(getOfflinePackage(ownerId, tripId)).resolves.toMatchObject({
      downloadedAt: "2026-07-30T12:00:00.000Z",
      record: { version: 2, manifest: { trip: { title: "Refreshed version" } } },
    });
    await expect(listOfflinePackages(ownerId)).resolves.toEqual([replacement]);
    await expect(listOfflinePackages(otherOwnerId)).resolves.toHaveLength(1);

    await removeOfflinePackage(ownerId, tripId);
    await expect(getOfflinePackage(ownerId, tripId)).resolves.toBeNull();
    await expect(listOfflinePackages(otherOwnerId)).resolves.toHaveLength(1);
  });

  test("clears only the signed-out account's packages", async () => {
    const record = packageRecord(1, 1, "Account package");
    await saveOfflinePackage(ownerId, record);
    await saveOfflinePackage(otherOwnerId, record);

    await clearOfflinePackages(ownerId);

    expect(await getOfflinePackage(ownerId, tripId)).toBeNull();
    expect(await getOfflinePackage(otherOwnerId, tripId)).not.toBeNull();
  });

  test("keeps the previous package when a refresh is interrupted", async () => {
    await saveOfflinePackage(ownerId, packageRecord(1, 1, "Safe version"));
    const controller = new AbortController();
    const refresh = saveOfflinePackage(ownerId, packageRecord(2, 2, "Interrupted version"), {
      signal: controller.signal,
    });
    controller.abort();

    await expect(refresh).rejects.toMatchObject({ code: "cancelled" });
    await expect(getOfflinePackage(ownerId, tripId)).resolves.toMatchObject({
      record: { version: 1, manifest: { trip: { title: "Safe version" } } },
    });
  });

  test("reports quota pressure before replacing a usable package", () => {
    expect(() =>
      assertStorageCapacity({ availableBytes: 100, quotaBytes: 1_000, usageBytes: 900 }, 101),
    ).toThrowError(OfflineStorageError);
    expect(() =>
      assertStorageCapacity({ availableBytes: null, quotaBytes: null, usageBytes: null }, 10_000),
    ).not.toThrow();
  });
});
