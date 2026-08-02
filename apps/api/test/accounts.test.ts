import type { AccountDeletionReceipt } from "@roavia/contracts";
import { AccountExportUnavailableError } from "@roavia/db";
import { describe, expect, test, vi } from "vitest";

import { createApp } from "../src/app.js";
import type { AccountLifecycleService } from "../src/account-lifecycle.js";

const userId = "11111111-1111-4111-8111-111111111111";
const exportId = "22222222-2222-4222-8222-222222222222";
const receiptId = "33333333-3333-4333-8333-333333333333";
const now = new Date();
const grantToken = "g".repeat(43);

const completedReceipt: AccountDeletionReceipt = {
  backupDeletionBy: new Date(now.getTime() + 31 * 86_400_000).toISOString(),
  completedAt: now.toISOString(),
  confirmedAt: now.toISOString(),
  failureCodes: [],
  liveDeletionBy: new Date(now.getTime() + 86_400_000).toISOString(),
  policyVersion: "2026-07-28.v1",
  receiptId,
  status: "completed",
  steps: {
    authIdentityDeletion: "succeeded",
    jobCancellation: "succeeded",
    liveDataDeletion: "succeeded",
    sessionRevocation: "succeeded",
  },
};

function serviceWith(overrides: Partial<AccountLifecycleService> = {}): AccountLifecycleService {
  return {
    confirmDeletion: vi
      .fn<AccountLifecycleService["confirmDeletion"]>()
      .mockResolvedValue(completedReceipt),
    createExport: vi.fn<AccountLifecycleService["createExport"]>().mockResolvedValue({
      createdAt: now,
      expiresAt: new Date(now.getTime() + 23 * 3_600_000),
      exportId,
      grantToken,
      sizeBytes: 42,
    }),
    downloadExport: vi.fn<AccountLifecycleService["downloadExport"]>().mockResolvedValue({
      bytes: Buffer.from("zip"),
      createdAt: now,
      downloadedAt: now,
      expiresAt: new Date(now.getTime() + 23 * 3_600_000),
      exportId,
      filename: "roavia-account-export.zip",
    }),
    findDeletion: vi.fn<AccountLifecycleService["findDeletion"]>().mockResolvedValue(null),
    previewDeletion: vi.fn<AccountLifecycleService["previewDeletion"]>().mockResolvedValue({
      assistantRecords: 1,
      backupDeletionBy: new Date(now.getTime() + 31 * 86_400_000).toISOString(),
      exportArtifacts: 0,
      immediateEffects: ["Sessions are revoked."],
      liveDeletionBy: new Date(now.getTime() + 86_400_000).toISOString(),
      offlinePackages: 1,
      pendingJobs: 1,
      retainedEvidence: ["A content-free receipt is retained."],
      shareLinks: 1,
      trips: 1,
    }),
    ...overrides,
  };
}

function authenticatedApp(service: AccountLifecycleService, issuedAt?: string) {
  return createApp({
    accountLifecycleService: service,
    verifyAccessToken: async () => ({
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
      identity: { email: "traveler@roavia.test", userId },
      issuedAt,
    }),
  });
}

const authenticatedHeaders = {
  authorization: "Bearer access-token",
  "content-type": "application/json",
};

describe("account lifecycle routes", () => {
  test("requires recent authentication for export and deletion confirmation", async () => {
    const service = serviceWith();
    const app = authenticatedApp(service);

    const exportResponse = await app.request("/me/exports", {
      headers: authenticatedHeaders,
      method: "POST",
    });
    const deletionResponse = await app.request("/me/deletion", {
      body: JSON.stringify({ confirmation: "DELETE" }),
      headers: authenticatedHeaders,
      method: "POST",
    });

    expect(exportResponse.status).toBe(401);
    expect(deletionResponse.status).toBe(401);
    expect(service.createExport).not.toHaveBeenCalled();
    expect(service.confirmDeletion).not.toHaveBeenCalled();
  });

  test("creates and downloads an owner-scoped no-store export grant", async () => {
    const service = serviceWith();
    const app = authenticatedApp(service, now.toISOString());

    const created = await app.request("/me/exports", {
      headers: authenticatedHeaders,
      method: "POST",
    });
    const downloaded = await app.request(`/me/exports/${exportId}/download`, {
      headers: {
        authorization: "Bearer access-token",
        "x-roavia-export-grant": grantToken,
      },
    });
    const missingGrant = await app.request(`/me/exports/${exportId}/download`, {
      headers: { authorization: "Bearer access-token" },
    });

    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      data: { exportId, grantToken },
    });
    expect(service.createExport).toHaveBeenCalledWith(
      expect.objectContaining({ authUserId: userId, email: "traveler@roavia.test" }),
    );
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("cache-control")).toBe("private, no-store");
    expect(downloaded.headers.get("content-disposition")).toContain("attachment;");
    await expect(downloaded.text()).resolves.toBe("zip");
    expect(service.downloadExport).toHaveBeenCalledWith(
      expect.objectContaining({ authUserId: userId, exportId, grantToken }),
    );
    expect(missingGrant.status).toBe(404);
  });

  test("maps unavailable grants to the same response and rate-limits export creation", async () => {
    const service = serviceWith({
      downloadExport: vi
        .fn<AccountLifecycleService["downloadExport"]>()
        .mockRejectedValue(new AccountExportUnavailableError()),
    });
    const app = authenticatedApp(service, now.toISOString());

    const unavailable = await app.request(`/me/exports/${exportId}/download`, {
      headers: {
        authorization: "Bearer access-token",
        "x-roavia-export-grant": "wrong-grant-that-is-still-long-enough",
      },
    });
    const requests = await Promise.all(
      Array.from({ length: 4 }, () =>
        app.request("/me/exports", { headers: authenticatedHeaders, method: "POST" }),
      ),
    );

    expect(unavailable.status).toBe(404);
    expect(requests.map((response) => response.status)).toEqual([201, 201, 201, 429]);
  });

  test("requires explicit confirmation and returns the content-free receipt", async () => {
    const service = serviceWith();
    const app = authenticatedApp(service, now.toISOString());
    const invalid = await app.request("/me/deletion", {
      body: JSON.stringify({ confirmation: "delete" }),
      headers: authenticatedHeaders,
      method: "POST",
    });
    const confirmed = await app.request("/me/deletion", {
      body: JSON.stringify({ confirmation: "DELETE" }),
      headers: authenticatedHeaders,
      method: "POST",
    });

    expect(invalid.status).toBe(400);
    expect(confirmed.status).toBe(200);
    await expect(confirmed.json()).resolves.toMatchObject({
      data: { receiptId, status: "completed" },
    });
    expect(service.confirmDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: "access-token", authUserId: userId }),
    );
  });

  test("blocks ordinary routes after tombstoning while allowing deletion retry", async () => {
    const findDeletion = vi
      .fn<AccountLifecycleService["findDeletion"]>()
      .mockResolvedValue(completedReceipt);
    const service = serviceWith({ findDeletion });
    const app = authenticatedApp(service, now.toISOString());

    const profile = await app.request("/me", { headers: authenticatedHeaders });
    const receipt = await app.request("/me/deletion", { headers: authenticatedHeaders });

    expect(profile.status).toBe(401);
    await expect(profile.json()).resolves.toMatchObject({ error: { code: "account_deleted" } });
    expect(receipt.status).toBe(200);
    await expect(receipt.json()).resolves.toMatchObject({ data: { receiptId } });
  });
});
