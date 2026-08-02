import type {
  AccountDeletionPreview,
  AccountDeletionReceipt,
  AccountDeletionStep,
} from "@roavia/contracts";
import type {
  AccountExportArtifact,
  AccountExportGrantRecord,
  AccountLifecycleRepository,
} from "@roavia/db";
import type { JobRuntime } from "@roavia/jobs";

import type { AccountIdentityAdmin } from "./account-identity.js";

export interface AccountLifecycleService {
  confirmDeletion(input: {
    accessToken: string;
    authUserId: string;
    correlationId: string;
    now?: Date;
  }): Promise<AccountDeletionReceipt>;
  createExport(input: {
    authUserId: string;
    correlationId: string;
    email?: string;
    now?: Date;
  }): Promise<AccountExportGrantRecord>;
  downloadExport(input: {
    authUserId: string;
    correlationId: string;
    exportId: string;
    grantToken: string;
    now?: Date;
  }): Promise<AccountExportArtifact>;
  findDeletion(authUserId: string): Promise<AccountDeletionReceipt | null>;
  previewDeletion(authUserId: string, now?: Date): Promise<AccountDeletionPreview>;
}

interface CreateAccountLifecycleServiceOptions {
  identityAdmin: AccountIdentityAdmin;
  jobs: Pick<JobRuntime, "cancelByRequester">;
  repository: AccountLifecycleRepository;
  secret: string;
}

function failureCode(error: unknown, fallback: string) {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : fallback;
}

export function createAccountLifecycleService(
  options: CreateAccountLifecycleServiceOptions,
): AccountLifecycleService {
  async function step(
    current: AccountDeletionReceipt,
    name: AccountDeletionStep,
    operation: () => Promise<void>,
    fallbackCode: string,
  ) {
    if (current.steps[name] === "succeeded") return current;
    try {
      await operation();
      return options.repository.markDeletionStep(current.receiptId, name, "succeeded");
    } catch (error) {
      return options.repository.markDeletionStep(current.receiptId, name, "failed", {
        failureCode: failureCode(error, fallbackCode),
      });
    }
  }

  return {
    createExport(input) {
      return options.repository.createExport(
        { authUserId: input.authUserId, email: input.email },
        options.secret,
        { correlationId: input.correlationId, now: input.now },
      );
    },

    downloadExport(input) {
      return options.repository.downloadExport(
        input.authUserId,
        input.exportId,
        input.grantToken,
        options.secret,
        { correlationId: input.correlationId, now: input.now },
      );
    },

    findDeletion(authUserId) {
      return options.repository.findDeletion(authUserId, options.secret);
    },

    previewDeletion(authUserId, now) {
      return options.repository.previewDeletion(authUserId, now);
    },

    async confirmDeletion(input) {
      let current = await options.repository.beginDeletion(input.authUserId, options.secret, {
        correlationId: input.correlationId,
        now: input.now,
      });
      if (current.status === "completed") return current;

      current = await step(
        current,
        "sessionRevocation",
        () => options.identityAdmin.revokeSessions(input.accessToken),
        "session_revocation_failed",
      );
      current = await step(
        current,
        "jobCancellation",
        async () => {
          await options.jobs.cancelByRequester(input.authUserId, current.receiptId);
        },
        "job_cancellation_failed",
      );
      if (current.steps.jobCancellation !== "succeeded") return current;

      current = await step(
        current,
        "liveDataDeletion",
        () => options.repository.purgeAccount(input.authUserId, current.receiptId, input.now),
        "live_data_deletion_failed",
      );
      if (current.steps.liveDataDeletion !== "succeeded") return current;

      current = await step(
        current,
        "authIdentityDeletion",
        () => options.identityAdmin.deleteIdentity(input.authUserId),
        "auth_identity_deletion_failed",
      );
      if (
        current.steps.authIdentityDeletion === "succeeded" &&
        current.steps.sessionRevocation !== "succeeded"
      ) {
        current = await options.repository.markDeletionStep(
          current.receiptId,
          "sessionRevocation",
          "succeeded",
        );
      }
      return current;
    },
  };
}
