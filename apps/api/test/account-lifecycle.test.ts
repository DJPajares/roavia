import type { AccountDeletionReceipt } from "@roavia/contracts";
import type { AccountLifecycleRepository } from "@roavia/db";
import { describe, expect, test, vi } from "vitest";

import { createAccountLifecycleService } from "../src/account-lifecycle.js";

const authUserId = "auth-user-1";
const receiptId = "33333333-3333-4333-8333-333333333333";
const confirmedAt = "2026-08-02T00:00:00.000Z";

function pendingReceipt(): AccountDeletionReceipt {
  return {
    backupDeletionBy: "2026-09-02T00:00:00.000Z",
    completedAt: null,
    confirmedAt,
    failureCodes: [],
    liveDeletionBy: "2026-08-03T00:00:00.000Z",
    policyVersion: "2026-07-28.v1",
    receiptId,
    status: "pending",
    steps: {
      authIdentityDeletion: "pending",
      jobCancellation: "pending",
      liveDataDeletion: "pending",
      sessionRevocation: "pending",
    },
  };
}

describe("account deletion orchestration", () => {
  test("resumes after interruption without repeating completed destructive steps", async () => {
    let current = pendingReceipt();
    const markDeletionStep = vi.fn<AccountLifecycleRepository["markDeletionStep"]>(
      async (_receiptId, step, state, context) => {
        const steps = { ...current.steps, [step]: state };
        const completed = Object.values(steps).every((value) => value === "succeeded");
        current = {
          ...current,
          completedAt: completed ? confirmedAt : null,
          failureCodes: context?.failureCode
            ? [...new Set([...current.failureCodes, context.failureCode])]
            : current.failureCodes,
          status: completed ? "completed" : state === "failed" ? "failed" : "pending",
          steps,
        };
        return current;
      },
    );
    const repository: AccountLifecycleRepository = {
      beginDeletion: vi.fn<AccountLifecycleRepository["beginDeletion"]>(async () => current),
      createExport: vi.fn<AccountLifecycleRepository["createExport"]>(() =>
        Promise.reject(new Error("Unexpected export.")),
      ),
      downloadExport: vi.fn<AccountLifecycleRepository["downloadExport"]>(() =>
        Promise.reject(new Error("Unexpected download.")),
      ),
      findDeletion: vi.fn<AccountLifecycleRepository["findDeletion"]>(async () => current),
      markDeletionStep,
      previewDeletion: vi.fn<AccountLifecycleRepository["previewDeletion"]>(() =>
        Promise.reject(new Error("Unexpected preview.")),
      ),
      pruneExpired: vi.fn<AccountLifecycleRepository["pruneExpired"]>(async () => ({
        audits: 0,
        exports: 0,
        receipts: 0,
        tombstones: 0,
      })),
      purgeAccount: vi.fn<AccountLifecycleRepository["purgeAccount"]>(async () => undefined),
    };
    const revokeSessions = vi.fn<(accessToken: string) => Promise<void>>(async () => undefined);
    const cancelByRequester = vi.fn<
      (requesterId: string, replacementSubjectId: string) => Promise<number>
    >(async () => 1);
    const deleteIdentity = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(Object.assign(new Error("provider unavailable"), { code: "timeout" }))
      .mockResolvedValueOnce();
    const service = createAccountLifecycleService({
      identityAdmin: { deleteIdentity, revokeSessions },
      jobs: { cancelByRequester },
      repository,
      secret: "a".repeat(32),
    });

    const first = await service.confirmDeletion({
      accessToken: "access-token",
      authUserId,
      correlationId: "44444444-4444-4444-8444-444444444444",
    });
    const retried = await service.confirmDeletion({
      accessToken: "new-access-token",
      authUserId,
      correlationId: "55555555-5555-4555-8555-555555555555",
    });

    expect(first).toMatchObject({ failureCodes: ["timeout"], status: "failed" });
    expect(retried.status).toBe("completed");
    expect(revokeSessions).toHaveBeenCalledTimes(1);
    expect(cancelByRequester).toHaveBeenCalledTimes(1);
    expect(repository.purgeAccount).toHaveBeenCalledTimes(1);
    expect(deleteIdentity).toHaveBeenCalledTimes(2);
  });

  test("accepts hard identity deletion as stronger evidence than refresh revocation", async () => {
    let current = pendingReceipt();
    const repository: AccountLifecycleRepository = {
      beginDeletion: vi.fn<AccountLifecycleRepository["beginDeletion"]>(async () => current),
      createExport: vi.fn<AccountLifecycleRepository["createExport"]>(() =>
        Promise.reject(new Error("Unexpected export.")),
      ),
      downloadExport: vi.fn<AccountLifecycleRepository["downloadExport"]>(() =>
        Promise.reject(new Error("Unexpected download.")),
      ),
      findDeletion: vi.fn<AccountLifecycleRepository["findDeletion"]>(async () => current),
      markDeletionStep: vi.fn<AccountLifecycleRepository["markDeletionStep"]>(
        async (_receiptId, step, state) => {
          const steps = { ...current.steps, [step]: state };
          const completed = Object.values(steps).every((value) => value === "succeeded");
          current = {
            ...current,
            completedAt: completed ? confirmedAt : null,
            status: completed ? "completed" : state === "failed" ? "failed" : "pending",
            steps,
          };
          return current;
        },
      ),
      previewDeletion: vi.fn<AccountLifecycleRepository["previewDeletion"]>(() =>
        Promise.reject(new Error("Unexpected preview.")),
      ),
      pruneExpired: vi.fn<AccountLifecycleRepository["pruneExpired"]>(async () => ({
        audits: 0,
        exports: 0,
        receipts: 0,
        tombstones: 0,
      })),
      purgeAccount: vi.fn<AccountLifecycleRepository["purgeAccount"]>(async () => undefined),
    };
    const service = createAccountLifecycleService({
      identityAdmin: {
        deleteIdentity: vi.fn<(authUserId: string) => Promise<void>>(async () => undefined),
        revokeSessions: vi.fn<(accessToken: string) => Promise<void>>(() =>
          Promise.reject(new Error("auth service timeout")),
        ),
      },
      jobs: {
        cancelByRequester: vi.fn<
          (requesterId: string, replacementSubjectId: string) => Promise<number>
        >(async () => 0),
      },
      repository,
      secret: "a".repeat(32),
    });

    await expect(
      service.confirmDeletion({
        accessToken: "access-token",
        authUserId,
        correlationId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toMatchObject({
      status: "completed",
      steps: { authIdentityDeletion: "succeeded", sessionRevocation: "succeeded" },
    });
  });
});
