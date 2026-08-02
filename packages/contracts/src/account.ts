import { z } from "zod";

const apiMetaSchema = z.object({ requestId: z.string().uuid() });
const timestampSchema = z.string().datetime({ offset: true });

export const accountDeletionStepSchema = z.enum([
  "sessionRevocation",
  "jobCancellation",
  "liveDataDeletion",
  "authIdentityDeletion",
]);

export const accountDeletionStepStateSchema = z.enum(["pending", "succeeded", "failed"]);

export const accountDeletionPreviewSchema = z
  .object({
    assistantRecords: z.number().int().nonnegative(),
    backupDeletionBy: timestampSchema,
    exportArtifacts: z.number().int().nonnegative(),
    immediateEffects: z.array(z.string().min(1)).min(1),
    liveDeletionBy: timestampSchema,
    offlinePackages: z.number().int().nonnegative(),
    pendingJobs: z.number().int().nonnegative(),
    retainedEvidence: z.array(z.string().min(1)).min(1),
    shareLinks: z.number().int().nonnegative(),
    trips: z.number().int().nonnegative(),
  })
  .strict();

export const accountDeletionPreviewResponseSchema = z.object({
  data: accountDeletionPreviewSchema,
  meta: apiMetaSchema,
});

export const accountExportGrantSchema = z
  .object({
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    exportId: z.string().uuid(),
    grantToken: z.string().min(32).max(128),
    sizeBytes: z.number().int().positive(),
  })
  .strict();

export const accountExportResponseSchema = z.object({
  data: accountExportGrantSchema,
  meta: apiMetaSchema,
});

export const accountDeletionConfirmInputSchema = z
  .object({ confirmation: z.literal("DELETE") })
  .strict();

export const accountDeletionReceiptSchema = z
  .object({
    backupDeletionBy: timestampSchema,
    completedAt: timestampSchema.nullable(),
    confirmedAt: timestampSchema,
    failureCodes: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,79}$/)),
    liveDeletionBy: timestampSchema,
    policyVersion: z.literal("2026-07-28.v1"),
    receiptId: z.string().uuid(),
    status: z.enum(["pending", "completed", "failed"]),
    steps: z.record(accountDeletionStepSchema, accountDeletionStepStateSchema),
  })
  .strict();

export const accountDeletionResponseSchema = z.object({
  data: accountDeletionReceiptSchema,
  meta: apiMetaSchema,
});

export type AccountDeletionConfirmInput = z.infer<typeof accountDeletionConfirmInputSchema>;
export type AccountDeletionPreview = z.infer<typeof accountDeletionPreviewSchema>;
export type AccountDeletionPreviewResponse = z.infer<typeof accountDeletionPreviewResponseSchema>;
export type AccountDeletionReceipt = z.infer<typeof accountDeletionReceiptSchema>;
export type AccountDeletionResponse = z.infer<typeof accountDeletionResponseSchema>;
export type AccountDeletionStep = z.infer<typeof accountDeletionStepSchema>;
export type AccountDeletionStepState = z.infer<typeof accountDeletionStepStateSchema>;
export type AccountExportGrant = z.infer<typeof accountExportGrantSchema>;
export type AccountExportResponse = z.infer<typeof accountExportResponseSchema>;
