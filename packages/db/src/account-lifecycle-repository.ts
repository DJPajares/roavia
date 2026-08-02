import { Buffer } from "node:buffer";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import {
  accountDeletionReceiptSchema,
  type AccountDeletionPreview,
  type AccountDeletionReceipt,
  type AccountDeletionStep,
  type AccountDeletionStepState,
} from "@roavia/contracts";
import { and, asc, eq, gt, inArray, lte, or } from "drizzle-orm";
import { strToU8, zipSync, type Zippable } from "fflate";

import { AuthorizedResourceNotFoundError } from "./authorization.js";
import type { Database } from "./client.js";
import {
  accountDeletionReceipts,
  accountDeletionTombstones,
  accountExports,
  applicationJobs,
  assistantActions,
  auditEvents,
  itineraryDays,
  itineraryGenerationRuns,
  itineraryItems,
  offlinePackages,
  shareLinks,
  sources,
  travelProfiles,
  tripDestinations,
  trips,
  users,
} from "./schema.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const EXPORT_LIFETIME_MS = 23 * 60 * 60 * 1_000;
const POLICY_VERSION = "2026-07-28.v1" as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const activeJobStatuses = ["queued", "running", "retrying"] as const;

type Checklist = Record<AccountDeletionStep, AccountDeletionStepState>;
type Principal = { authUserId: string; email?: string };

export interface AccountExportArtifact {
  bytes: Buffer;
  createdAt: Date;
  downloadedAt: Date | null;
  expiresAt: Date;
  exportId: string;
  filename: string;
}

export interface AccountExportGrantRecord {
  createdAt: Date;
  expiresAt: Date;
  exportId: string;
  grantToken: string;
  sizeBytes: number;
}

export interface AccountLifecycleRepository {
  beginDeletion(
    authUserId: string,
    secret: string,
    context?: { correlationId?: string; now?: Date },
  ): Promise<AccountDeletionReceipt>;
  createExport(
    principal: Principal,
    secret: string,
    context?: { correlationId?: string; now?: Date },
  ): Promise<AccountExportGrantRecord>;
  downloadExport(
    authUserId: string,
    exportId: string,
    grantToken: string,
    secret: string,
    context?: { correlationId?: string; now?: Date },
  ): Promise<AccountExportArtifact>;
  findDeletion(authUserId: string, secret: string): Promise<AccountDeletionReceipt | null>;
  markDeletionStep(
    receiptId: string,
    step: AccountDeletionStep,
    state: AccountDeletionStepState,
    context?: { failureCode?: string; now?: Date },
  ): Promise<AccountDeletionReceipt>;
  previewDeletion(authUserId: string, now?: Date): Promise<AccountDeletionPreview>;
  pruneExpired(
    now?: Date,
  ): Promise<{ audits: number; exports: number; receipts: number; tombstones: number }>;
  purgeAccount(authUserId: string, receiptId: string, now?: Date): Promise<void>;
}

export class AccountExportUnavailableError extends Error {
  readonly code = "not_found" as const;

  constructor() {
    super("Account export not found.");
    this.name = "AccountExportUnavailableError";
  }
}

function lifecycleSecret(secret: string) {
  const normalized = secret.trim();
  if (normalized.length < 32 || /\s/.test(normalized)) {
    throw new Error("ACCOUNT_LIFECYCLE_SECRET must contain at least 32 non-whitespace characters.");
  }
  return normalized;
}

function displayNameFromEmail(email: string | undefined) {
  const candidate = email
    ?.split("@", 1)[0]
    ?.replace(/[._-]+/g, " ")
    .trim();
  return candidate ? candidate.slice(0, 100) : "Traveler";
}

function addCalendarYear(value: Date) {
  const result = new Date(value);
  const month = result.getUTCMonth();
  result.setUTCFullYear(result.getUTCFullYear() + 1);
  if (result.getUTCMonth() !== month) result.setUTCDate(0);
  return result;
}

export function hashAccountSubject(authUserId: string, secret: string) {
  return createHmac("sha256", lifecycleSecret(secret))
    .update("account-tombstone.v1\0", "utf8")
    .update(authUserId, "utf8")
    .digest();
}

function encryptionKey(secret: string) {
  return createHmac("sha256", lifecycleSecret(secret))
    .update("account-export-encryption.v1", "utf8")
    .digest();
}

function grantHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest();
}

function deletionChecklist(): Checklist {
  return {
    authIdentityDeletion: "pending",
    jobCancellation: "pending",
    liveDataDeletion: "pending",
    sessionRevocation: "pending",
  };
}

function receipt(row: typeof accountDeletionReceipts.$inferSelect): AccountDeletionReceipt {
  return accountDeletionReceiptSchema.parse({
    backupDeletionBy: row.backupDeleteBy.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    confirmedAt: row.confirmedAt.toISOString(),
    failureCodes: row.failureCodes,
    liveDeletionBy: row.liveDeleteBy.toISOString(),
    policyVersion: row.policyVersion,
    receiptId: row.id,
    status: row.status,
    steps: row.checklist,
  });
}

function json(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  const protectedValue = /^[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

function csv(headers: readonly string[], rows: readonly Record<string, unknown>[]) {
  return `${[
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\r\n")}\r\n`;
}

function sourceIdsFromActionPayload(payload: Record<string, unknown>) {
  return Array.isArray(payload.sourceIds)
    ? payload.sourceIds.filter((value): value is string => typeof value === "string")
    : [];
}

function sourceUrlFromSnapshot(snapshot: Record<string, unknown>) {
  const source = snapshot.source;
  if (!source || typeof source !== "object") return undefined;
  const url = (source as Record<string, unknown>).url;
  return typeof url === "string" ? url : undefined;
}

function groupBy<T, K>(values: readonly T[], key: (value: T) => K) {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), value]);
  }
  return groups;
}

function encryptArtifact(bytes: Uint8Array, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

function decryptArtifact(ciphertext: Buffer, iv: Buffer, tag: Buffer, secret: string) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

async function exportFiles(db: Database, principal: Principal, snapshotAt: Date) {
  return db.transaction(
    async (transaction) => {
      const [account] = await transaction
        .select()
        .from(users)
        .where(eq(users.authUserId, principal.authUserId))
        .limit(1);
      if (!account) throw new AuthorizedResourceNotFoundError();

      const profile = await transaction
        .select()
        .from(travelProfiles)
        .where(eq(travelProfiles.userId, account.id))
        .limit(1);
      const tripRows = await transaction
        .select()
        .from(trips)
        .where(eq(trips.ownerUserId, account.id))
        .orderBy(asc(trips.id));
      const actionRows = await transaction
        .select()
        .from(assistantActions)
        .where(eq(assistantActions.ownerUserId, account.id))
        .orderBy(asc(assistantActions.createdAt), asc(assistantActions.id));
      const shareRows = await transaction
        .select({
          createdAt: shareLinks.createdAt,
          expiresAt: shareLinks.expiresAt,
          id: shareLinks.id,
          permission: shareLinks.permission,
          revokedAt: shareLinks.revokedAt,
          tripId: shareLinks.tripId,
        })
        .from(shareLinks)
        .innerJoin(trips, eq(shareLinks.tripId, trips.id))
        .where(eq(trips.ownerUserId, account.id))
        .orderBy(asc(shareLinks.createdAt), asc(shareLinks.id));
      const offlineRows = await transaction
        .select()
        .from(offlinePackages)
        .where(eq(offlinePackages.userId, account.id))
        .orderBy(asc(offlinePackages.generatedAt), asc(offlinePackages.id));
      const auditRows = await transaction
        .select({
          action: auditEvents.action,
          id: auditEvents.id,
          occurredAt: auditEvents.occurredAt,
          outcome: auditEvents.outcome,
          subjectId: auditEvents.subjectId,
          subjectType: auditEvents.subjectType,
        })
        .from(auditEvents)
        .where(and(eq(auditEvents.actorUserId, account.id), gt(auditEvents.expiresAt, snapshotAt)))
        .orderBy(asc(auditEvents.occurredAt), asc(auditEvents.id));

      const tripIds = tripRows.map((trip) => trip.id);
      const destinationRows =
        tripIds.length === 0
          ? []
          : await transaction
              .select()
              .from(tripDestinations)
              .where(inArray(tripDestinations.tripId, tripIds))
              .orderBy(asc(tripDestinations.tripId), asc(tripDestinations.orderIndex));
      const dayRows =
        tripIds.length === 0
          ? []
          : await transaction
              .select()
              .from(itineraryDays)
              .where(inArray(itineraryDays.tripId, tripIds))
              .orderBy(asc(itineraryDays.tripId), asc(itineraryDays.orderIndex));
      const generationRows =
        tripIds.length === 0
          ? []
          : await transaction
              .select()
              .from(itineraryGenerationRuns)
              .where(inArray(itineraryGenerationRuns.tripId, tripIds))
              .orderBy(asc(itineraryGenerationRuns.tripId), asc(itineraryGenerationRuns.createdAt));
      const dayIds = dayRows.map((day) => day.id);
      const itemRows =
        dayIds.length === 0
          ? []
          : await transaction
              .select()
              .from(itineraryItems)
              .where(inArray(itineraryItems.itineraryDayId, dayIds))
              .orderBy(asc(itineraryItems.itineraryDayId), asc(itineraryItems.orderIndex));

      const sourceIds = [
        ...new Set(
          actionRows
            .flatMap((action) => sourceIdsFromActionPayload(action.payload))
            .filter((id) => UUID_PATTERN.test(id)),
        ),
      ];
      const sourceUrls = [
        ...new Set(
          itemRows.flatMap((item) => {
            const url = sourceUrlFromSnapshot(item.sourceSnapshot);
            return url ? [url] : [];
          }),
        ),
      ];
      const sourceConditions = [
        ...(sourceIds.length > 0 ? [inArray(sources.id, sourceIds)] : []),
        ...(sourceUrls.length > 0 ? [inArray(sources.sourceUrl, sourceUrls)] : []),
      ];
      const sourceRows =
        sourceConditions.length === 0
          ? []
          : await transaction
              .select({
                attribution: sources.attributionText,
                id: sources.id,
                license: sources.license,
                licenseUrl: sources.licenseUrl,
                provider: sources.provider,
                publishedAt: sources.publishedAt,
                retrievedAt: sources.retrievedAt,
                title: sources.title,
                trustTier: sources.trustTier,
                url: sources.sourceUrl,
                validUntil: sources.validUntil,
              })
              .from(sources)
              .where(or(...sourceConditions))
              .orderBy(asc(sources.id));

      const destinationsByTrip = groupBy(destinationRows, (row) => row.tripId);
      const daysByTrip = groupBy(dayRows, (row) => row.tripId);
      const itemsByDay = groupBy(itemRows, (row) => row.itineraryDayId);
      const runsByTrip = groupBy(generationRows, (row) => row.tripId);
      const canonicalTrips = tripRows.map((trip) => ({
        ...trip,
        createdAt: trip.createdAt.toISOString(),
        destinations: (destinationsByTrip.get(trip.id) ?? []).map((destination) => ({
          ...destination,
          arrivalAt: destination.arrivalAt?.toISOString() ?? null,
          departureAt: destination.departureAt?.toISOString() ?? null,
        })),
        updatedAt: trip.updatedAt.toISOString(),
      }));

      const textFiles: Record<string, string> = {
        "account.json": json({
          schemaVersion: 1,
          account: {
            createdAt: account.createdAt.toISOString(),
            displayName: account.displayName,
            email: principal.email ?? null,
            homeCountry: account.homeCountry,
            id: account.id,
            locale: account.locale,
            preferredCurrency: account.preferredCurrency,
            timezone: account.timezone,
            updatedAt: account.updatedAt.toISOString(),
          },
          profile: profile[0]
            ? {
                ...profile[0],
                createdAt: profile[0].createdAt.toISOString(),
                updatedAt: profile[0].updatedAt.toISOString(),
              }
            : null,
        }),
        "trips.json": json({ schemaVersion: 1, trips: canonicalTrips }),
        "trips.csv": csv(
          [
            "id",
            "title",
            "slug",
            "startDate",
            "endDate",
            "status",
            "visibility",
            "revision",
            "destinations",
            "createdAt",
            "updatedAt",
          ],
          canonicalTrips,
        ),
        "assistant.json": json({
          actions: actionRows.map((action) => ({
            actionId: action.id,
            confirmedAt: action.confirmedAt?.toISOString() ?? null,
            createdAt: action.createdAt.toISOString(),
            expiresAt: action.expiresAt.toISOString(),
            payload: action.payload,
            resolvedAt: action.resolvedAt?.toISOString() ?? null,
            status: action.status,
            tripId: action.tripId,
          })),
          schemaVersion: 1,
        }),
        "shares.csv": csv(
          ["id", "tripId", "permission", "createdAt", "expiresAt", "revokedAt"],
          shareRows.map((share) => ({
            ...share,
            createdAt: share.createdAt.toISOString(),
            expiresAt: share.expiresAt.toISOString(),
            revokedAt: share.revokedAt?.toISOString() ?? null,
          })),
        ),
        "offline.csv": csv(
          [
            "id",
            "tripId",
            "version",
            "generatedAt",
            "expiresAt",
            "sizeBytes",
            "schemaVersion",
            "contentHash",
          ],
          offlineRows.map((offline) => ({
            contentHash:
              typeof offline.manifest.contentHash === "string"
                ? offline.manifest.contentHash
                : null,
            expiresAt: offline.expiresAt?.toISOString() ?? null,
            generatedAt: offline.generatedAt.toISOString(),
            id: offline.id,
            schemaVersion:
              typeof offline.manifest.schemaVersion === "number"
                ? offline.manifest.schemaVersion
                : null,
            sizeBytes: offline.sizeBytes,
            tripId: offline.tripId,
            version: offline.version,
          })),
        ),
        "sources.json": json({
          schemaVersion: 1,
          sources: sourceRows.map((source) => ({
            ...source,
            publishedAt: source.publishedAt?.toISOString() ?? null,
            retrievedAt: source.retrievedAt.toISOString(),
            validUntil: source.validUntil?.toISOString() ?? null,
          })),
        }),
        "audit.json": json({
          events: auditRows.map((event) => ({
            ...event,
            occurredAt: event.occurredAt.toISOString(),
          })),
          schemaVersion: 1,
        }),
      };
      for (const trip of tripRows) {
        textFiles[`itinerary/${trip.id}.json`] = json({
          days: (daysByTrip.get(trip.id) ?? []).map((day) => ({
            ...day,
            items: itemsByDay.get(day.id) ?? [],
          })),
          generationRuns: (runsByTrip.get(trip.id) ?? []).map((run) => ({
            ...run,
            completedAt: run.completedAt?.toISOString() ?? null,
            createdAt: run.createdAt.toISOString(),
            startedAt: run.startedAt?.toISOString() ?? null,
            updatedAt: run.updatedAt.toISOString(),
          })),
          schemaVersion: 1,
          tripId: trip.id,
        });
      }

      const fileEntries = Object.entries(textFiles)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([path, contents]) => ({
          path,
          sha256: createHash("sha256").update(contents, "utf8").digest("hex"),
          sizeBytes: Buffer.byteLength(contents, "utf8"),
        }));
      textFiles["manifest.json"] = json({
        accountId: account.id,
        files: fileEntries,
        generatedAt: snapshotAt.toISOString(),
        recordCounts: {
          assistantActions: actionRows.length,
          auditEvents: auditRows.length,
          itineraryDays: dayRows.length,
          itineraryItems: itemRows.length,
          offlinePackages: offlineRows.length,
          shareLinks: shareRows.length,
          sources: sourceRows.length,
          trips: tripRows.length,
        },
        schemaVersion: 1,
        snapshotBoundary: snapshotAt.toISOString(),
      });
      return { accountId: account.id, textFiles };
    },
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
}

function zipFiles(files: Record<string, string>) {
  const input: Zippable = Object.fromEntries(
    Object.entries(files).map(([path, contents]) => [
      path,
      [strToU8(contents), { level: 6, mtime: new Date("1980-01-01T00:00:00.000Z") }],
    ]),
  );
  return zipSync(input, { level: 6, mtime: new Date("1980-01-01T00:00:00.000Z") });
}

export function createAccountLifecycleRepository(db: Database): AccountLifecycleRepository {
  return {
    async previewDeletion(authUserId, now = new Date()) {
      const [account] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.authUserId, authUserId))
        .limit(1);
      if (!account) {
        return {
          assistantRecords: 0,
          backupDeletionBy: new Date(now.getTime() + 31 * DAY_MS).toISOString(),
          exportArtifacts: 0,
          immediateEffects: [
            "All Roavia sessions and share links are revoked.",
            "Pending account jobs and export grants are cancelled.",
            "Offline access is removed when this device reconnects or its app data is cleared.",
          ],
          liveDeletionBy: new Date(now.getTime() + DAY_MS).toISOString(),
          offlinePackages: 0,
          pendingJobs: 0,
          retainedEvidence: [
            "A content-free deletion receipt is retained for 12 months.",
            "Encrypted backups expire no later than 31 days after confirmation.",
          ],
          shareLinks: 0,
          trips: 0,
        } satisfies AccountDeletionPreview;
      }
      const tripRows = await db
        .select({ id: trips.id })
        .from(trips)
        .where(eq(trips.ownerUserId, account.id));
      const tripIds = tripRows.map((trip) => trip.id);
      const [actions, exports, jobs, offline, shares] = await Promise.all([
        db
          .select({ id: assistantActions.id })
          .from(assistantActions)
          .where(eq(assistantActions.ownerUserId, account.id)),
        db
          .select({ id: accountExports.id })
          .from(accountExports)
          .where(eq(accountExports.userId, account.id)),
        db
          .select({ id: applicationJobs.id })
          .from(applicationJobs)
          .where(
            and(
              eq(applicationJobs.requestedById, authUserId),
              eq(applicationJobs.requestedByKind, "user"),
              inArray(applicationJobs.status, activeJobStatuses),
            ),
          ),
        db
          .select({ id: offlinePackages.id })
          .from(offlinePackages)
          .where(eq(offlinePackages.userId, account.id)),
        tripIds.length === 0
          ? Promise.resolve([])
          : db
              .select({ id: shareLinks.id })
              .from(shareLinks)
              .where(inArray(shareLinks.tripId, tripIds)),
      ]);
      return {
        assistantRecords: actions.length,
        backupDeletionBy: new Date(now.getTime() + 31 * DAY_MS).toISOString(),
        exportArtifacts: exports.length,
        immediateEffects: [
          "All Roavia sessions and share links are revoked.",
          "Pending account jobs and export grants are cancelled.",
          "Offline access is removed when this device reconnects or its app data is cleared.",
        ],
        liveDeletionBy: new Date(now.getTime() + DAY_MS).toISOString(),
        offlinePackages: offline.length,
        pendingJobs: jobs.length,
        retainedEvidence: [
          "A content-free deletion receipt is retained for 12 months.",
          "Encrypted backups expire no later than 31 days after confirmation.",
        ],
        shareLinks: shares.length,
        trips: tripRows.length,
      } satisfies AccountDeletionPreview;
    },

    async createExport(principal, secret, context = {}) {
      const now = context.now ?? new Date();
      await db
        .insert(users)
        .values({
          authUserId: principal.authUserId,
          displayName: displayNameFromEmail(principal.email),
        })
        .onConflictDoNothing({ target: users.authUserId });
      const { accountId, textFiles } = await exportFiles(db, principal, now);
      const archive = zipFiles(textFiles);
      const encrypted = encryptArtifact(archive, secret);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now.getTime() + EXPORT_LIFETIME_MS);
      return db.transaction(async (transaction) => {
        await transaction.delete(accountExports).where(lte(accountExports.expiresAt, now));
        const [created] = await transaction
          .insert(accountExports)
          .values({
            artifactCiphertext: encrypted.ciphertext,
            createdAt: now,
            encryptionIv: encrypted.iv,
            encryptionTag: encrypted.tag,
            expiresAt,
            grantHash: grantHash(token),
            sizeBytes: archive.byteLength,
            userId: accountId,
          })
          .returning();
        await transaction.insert(auditEvents).values({
          action: "account_export_created",
          actorUserId: accountId,
          correlationId: context.correlationId ?? randomUUID(),
          occurredAt: now,
          outcome: "succeeded",
          subjectId: created!.id,
          subjectType: "account_export",
        });
        return {
          createdAt: created!.createdAt,
          expiresAt: created!.expiresAt,
          exportId: created!.id,
          grantToken: token,
          sizeBytes: created!.sizeBytes,
        };
      });
    },

    async downloadExport(authUserId, exportId, grantToken, secret, context = {}) {
      const now = context.now ?? new Date();
      const [row] = await db
        .select({ accountExport: accountExports })
        .from(accountExports)
        .innerJoin(users, eq(accountExports.userId, users.id))
        .where(
          and(
            eq(accountExports.id, exportId),
            eq(users.authUserId, authUserId),
            gt(accountExports.expiresAt, now),
          ),
        )
        .limit(1);
      const candidateHash = grantHash(grantToken);
      if (!row || !timingSafeEqual(row.accountExport.grantHash, candidateHash)) {
        throw new AccountExportUnavailableError();
      }
      const bytes = decryptArtifact(
        row.accountExport.artifactCiphertext,
        row.accountExport.encryptionIv,
        row.accountExport.encryptionTag,
        secret,
      );
      await db.transaction(async (transaction) => {
        await transaction
          .update(accountExports)
          .set({ downloadedAt: now })
          .where(eq(accountExports.id, exportId));
        await transaction.insert(auditEvents).values({
          action: "account_export_downloaded",
          actorUserId: row.accountExport.userId,
          correlationId: context.correlationId ?? randomUUID(),
          occurredAt: now,
          outcome: "succeeded",
          subjectId: exportId,
          subjectType: "account_export",
        });
      });
      return {
        bytes,
        createdAt: row.accountExport.createdAt,
        downloadedAt: now,
        expiresAt: row.accountExport.expiresAt,
        exportId,
        filename: `roavia-account-export-${row.accountExport.createdAt.toISOString().slice(0, 10)}.zip`,
      };
    },

    async findDeletion(authUserId, secret) {
      const [row] = await db
        .select({ receipt: accountDeletionReceipts })
        .from(accountDeletionTombstones)
        .innerJoin(
          accountDeletionReceipts,
          eq(accountDeletionTombstones.deletionReceiptId, accountDeletionReceipts.id),
        )
        .where(eq(accountDeletionTombstones.subjectHash, hashAccountSubject(authUserId, secret)))
        .limit(1);
      return row ? receipt(row.receipt) : null;
    },

    async beginDeletion(authUserId, secret, context = {}) {
      const now = context.now ?? new Date();
      const subjectHash = hashAccountSubject(authUserId, secret);
      const [existing] = await db
        .select({ receipt: accountDeletionReceipts })
        .from(accountDeletionTombstones)
        .innerJoin(
          accountDeletionReceipts,
          eq(accountDeletionTombstones.deletionReceiptId, accountDeletionReceipts.id),
        )
        .where(eq(accountDeletionTombstones.subjectHash, subjectHash))
        .limit(1);
      if (existing) return receipt(existing.receipt);
      return db.transaction(async (transaction) => {
        await transaction
          .insert(users)
          .values({ authUserId, displayName: "Traveler" })
          .onConflictDoNothing({ target: users.authUserId });
        const [account] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(eq(users.authUserId, authUserId))
          .limit(1)
          .for("update");
        if (!account) throw new Error("Account deletion provisioning failed.");
        const [concurrent] = await transaction
          .select({ receipt: accountDeletionReceipts })
          .from(accountDeletionTombstones)
          .innerJoin(
            accountDeletionReceipts,
            eq(accountDeletionTombstones.deletionReceiptId, accountDeletionReceipts.id),
          )
          .where(eq(accountDeletionTombstones.subjectHash, subjectHash))
          .limit(1);
        if (concurrent) return receipt(concurrent.receipt);
        const [created] = await transaction
          .insert(accountDeletionReceipts)
          .values({
            backupDeleteBy: new Date(now.getTime() + 31 * DAY_MS),
            checklist: deletionChecklist(),
            confirmedAt: now,
            expiresAt: addCalendarYear(now),
            failureCodes: [],
            liveDeleteBy: new Date(now.getTime() + DAY_MS),
            policyVersion: POLICY_VERSION,
          })
          .returning();
        await transaction.insert(accountDeletionTombstones).values({
          createdAt: now,
          deletionReceiptId: created!.id,
          expiresAt: new Date(now.getTime() + 31 * DAY_MS),
          subjectHash,
        });
        const ownedTrips = await transaction
          .select({ id: trips.id })
          .from(trips)
          .where(eq(trips.ownerUserId, account.id));
        if (ownedTrips.length > 0) {
          await transaction
            .update(shareLinks)
            .set({ revokedAt: now })
            .where(
              inArray(
                shareLinks.tripId,
                ownedTrips.map((trip) => trip.id),
              ),
            );
        }
        await transaction.delete(accountExports).where(eq(accountExports.userId, account.id));
        await transaction.insert(auditEvents).values({
          action: "account_deletion_requested",
          actorUserId: account.id,
          correlationId: context.correlationId ?? randomUUID(),
          occurredAt: now,
          outcome: "succeeded",
          subjectId: created!.id,
          subjectType: "deletion_receipt",
        });
        return receipt(created!);
      });
    },

    async markDeletionStep(receiptId, step, state, context = {}) {
      const now = context.now ?? new Date();
      return db.transaction(async (transaction) => {
        const [current] = await transaction
          .select()
          .from(accountDeletionReceipts)
          .where(eq(accountDeletionReceipts.id, receiptId))
          .limit(1)
          .for("update");
        if (!current) throw new AuthorizedResourceNotFoundError();
        const checklist = { ...current.checklist, [step]: state };
        const failureCodes = context.failureCode
          ? [...new Set([...current.failureCodes, context.failureCode])]
          : current.failureCodes;
        const completed = Object.values(checklist).every((value) => value === "succeeded");
        const failed = Object.values(checklist).some((value) => value === "failed");
        const [updated] = await transaction
          .update(accountDeletionReceipts)
          .set({
            checklist,
            completedAt: completed ? (current.completedAt ?? now) : null,
            failureCodes,
            status: completed ? "completed" : failed ? "failed" : "pending",
          })
          .where(eq(accountDeletionReceipts.id, receiptId))
          .returning();
        if (completed && current.status !== "completed") {
          await transaction.insert(auditEvents).values({
            action: "account_deletion_completed",
            actorUserId: null,
            correlationId: randomUUID(),
            occurredAt: now,
            outcome: "succeeded",
            subjectId: receiptId,
            subjectType: "deletion_receipt",
          });
        }
        return receipt(updated!);
      });
    },

    async purgeAccount(authUserId, receiptId, now = new Date()) {
      await db.transaction(async (transaction) => {
        const [account] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(eq(users.authUserId, authUserId))
          .limit(1)
          .for("update");
        if (!account) return;
        await transaction
          .update(auditEvents)
          .set({ actorUserId: null, subjectId: receiptId, subjectType: "deletion_receipt" })
          .where(eq(auditEvents.actorUserId, account.id));
        await transaction.delete(users).where(eq(users.id, account.id));
        await transaction
          .update(accountDeletionReceipts)
          .set({ status: "pending" })
          .where(eq(accountDeletionReceipts.id, receiptId));
        void now;
      });
    },

    async pruneExpired(now = new Date()) {
      return db.transaction(async (transaction) => {
        const exportsDeleted = await transaction
          .delete(accountExports)
          .where(lte(accountExports.expiresAt, now))
          .returning({ id: accountExports.id });
        const tombstonesDeleted = await transaction
          .delete(accountDeletionTombstones)
          .where(lte(accountDeletionTombstones.expiresAt, now))
          .returning({ receiptId: accountDeletionTombstones.deletionReceiptId });
        const receiptsDeleted = await transaction
          .delete(accountDeletionReceipts)
          .where(lte(accountDeletionReceipts.expiresAt, now))
          .returning({ id: accountDeletionReceipts.id });
        const auditsDeleted = await transaction
          .delete(auditEvents)
          .where(lte(auditEvents.expiresAt, now))
          .returning({ id: auditEvents.id });
        return {
          audits: auditsDeleted.length,
          exports: exportsDeleted.length,
          receipts: receiptsDeleted.length,
          tombstones: tombstonesDeleted.length,
        };
      });
    },
  };
}
