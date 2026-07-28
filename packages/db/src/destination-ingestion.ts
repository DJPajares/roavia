import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "./client.js";
import {
  destinationContent,
  destinationContentSources,
  destinationIngestionQuarantine,
  freshnessPolicies,
  placeProviderIds,
  places,
  sources,
} from "./schema.js";

const recordKeySchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,199}$/);
const timestampSchema = z.iso.datetime({ offset: true });
const jsonObjectSchema = z.record(z.string(), z.unknown());
const httpUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "http:" || protocol === "https:";
}, "Only HTTP and HTTPS URLs are supported.");

const freshnessPolicyRecordSchema = z
  .object({
    description: z.string().min(1).max(500),
    expireAfterSeconds: z.number().int().positive(),
    freshForSeconds: z.number().int().positive(),
    key: recordKeySchema,
    kind: z.literal("freshness_policy"),
    manualReviewAfterSeconds: z.number().int().positive().optional(),
    version: z.number().int().positive(),
  })
  .refine((record) => record.expireAfterSeconds > record.freshForSeconds, {
    message: "expireAfterSeconds must be greater than freshForSeconds.",
    path: ["expireAfterSeconds"],
  });

const sourceRecordSchema = z
  .object({
    attributionText: z.string().min(1).max(500).optional(),
    key: recordKeySchema,
    kind: z.literal("source"),
    license: z.string().min(1).max(300).optional(),
    licenseUrl: httpUrlSchema.optional(),
    metadata: jsonObjectSchema.default({}),
    offlineUseAllowed: z.boolean(),
    provider: z.string().min(1).max(100),
    publishedAt: timestampSchema.optional(),
    redistributionAllowed: z.boolean(),
    retrievedAt: timestampSchema,
    sourceKind: z.enum([
      "official_authority",
      "official_operator",
      "licensed_provider",
      "reviewed_editorial",
    ]),
    sourceUrl: httpUrlSchema,
    title: z.string().min(1).max(300).optional(),
    trustTier: z.enum(["tier_1", "tier_2", "tier_3", "tier_4"]),
    validFrom: timestampSchema.optional(),
    validUntil: timestampSchema.optional(),
  })
  .refine(
    (record) =>
      !record.validFrom ||
      !record.validUntil ||
      Date.parse(record.validUntil) > Date.parse(record.validFrom),
    { message: "validUntil must be later than validFrom.", path: ["validUntil"] },
  );

const providerIdentitySchema = z.object({
  metadata: jsonObjectSchema.default({}),
  provider: z.string().min(1).max(100),
  providerPlaceId: z.string().min(1).max(500),
  retrievedAt: timestampSchema,
});

const destinationContentRecordSchema = z
  .object({
    content: jsonObjectSchema,
    contentType: recordKeySchema,
    freshnessPolicyKey: recordKeySchema,
    freshnessPolicyVersion: z.number().int().positive(),
    locale: z.string().min(2).max(35).default("en"),
    qualityState: z.enum(["draft", "in_review", "rejected"]).default("in_review"),
    refreshedAt: timestampSchema,
    sourceKeys: z.array(recordKeySchema).min(1),
  })
  .refine((record) => new Set(record.sourceKeys).size === record.sourceKeys.length, {
    message: "sourceKeys cannot contain duplicates.",
    path: ["sourceKeys"],
  });

const placeRecordSchema = z
  .object({
    canonicalName: z.string().min(1).max(200),
    content: z.array(destinationContentRecordSchema).default([]),
    coordinates: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .optional(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    key: recordKeySchema,
    kind: z.literal("place"),
    localizedNames: z.record(z.string(), z.string()).default({}),
    parentKey: recordKeySchema.optional(),
    placeType: z.enum(["country", "region", "city", "district", "poi", "transit_hub"]),
    providerIds: z.array(providerIdentitySchema).default([]),
    status: z.enum(["active", "deprecated"]).default("active"),
    summary: z.string().min(1).max(2_000).optional(),
    timezone: z.string().min(1).max(100).optional(),
  })
  .refine((record) => record.placeType !== "country" || record.parentKey === undefined, {
    message: "Country records cannot have a parent.",
    path: ["parentKey"],
  });

const catalogRecordSchema = z.discriminatedUnion("kind", [
  freshnessPolicyRecordSchema,
  sourceRecordSchema,
  placeRecordSchema,
]);

const destinationCatalogEnvelopeSchema = z.object({
  catalogKey: recordKeySchema,
  provider: z.string().min(1).max(100),
  records: z.array(z.unknown()).min(1),
  revision: z.number().int().positive(),
});

export type DestinationCatalog = z.infer<typeof destinationCatalogEnvelopeSchema>;
export type DestinationCatalogRecord = z.infer<typeof catalogRecordSchema>;

export interface DestinationIngestionSummary {
  catalogKey: string;
  contentCreated: number;
  contentUpdated: number;
  mode: "refresh" | "seed";
  placesCreated: number;
  placesUpdated: number;
  policiesUpserted: number;
  quarantineResolved: number;
  recordsQuarantined: number;
  recordsReceived: number;
  reviewedContentPreserved: number;
  revision: number;
  sourcesUpserted: number;
}

export interface DestinationIngestionOptions {
  mode?: DestinationIngestionSummary["mode"];
  now?: Date;
}

interface ValidationError {
  code: string;
  message: string;
  path: string;
}

function recordIdentifier(record: unknown, index: number): string {
  if (typeof record === "object" && record !== null && !Array.isArray(record)) {
    const candidate = record as Record<string, unknown>;
    const key = typeof candidate.key === "string" ? candidate.key : `record-${index}`;
    const kind = typeof candidate.kind === "string" ? candidate.kind : "unknown";
    return `${kind}:${key}`.slice(0, 500);
  }
  return `unknown:record-${index}`;
}

function quarantinePayload(record: unknown): Record<string, unknown> {
  return typeof record === "object" && record !== null && !Array.isArray(record)
    ? (record as Record<string, unknown>)
    : { value: record };
}

function validationErrors(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.join("."),
  }));
}

function referenceError(code: string, message: string, path: string): ValidationError[] {
  return [{ code, message, path }];
}

function policyMapKey(key: string, version: number): string {
  return `${key}:v${version}`;
}

export async function ingestDestinationCatalog(
  db: Database,
  input: unknown,
  options: DestinationIngestionOptions = {},
): Promise<DestinationIngestionSummary> {
  const catalog = destinationCatalogEnvelopeSchema.parse(input);
  const now = options.now ?? new Date();
  const mode = options.mode ?? "seed";
  const summary: DestinationIngestionSummary = {
    catalogKey: catalog.catalogKey,
    contentCreated: 0,
    contentUpdated: 0,
    mode,
    placesCreated: 0,
    placesUpdated: 0,
    policiesUpserted: 0,
    quarantineResolved: 0,
    recordsQuarantined: 0,
    recordsReceived: catalog.records.length,
    reviewedContentPreserved: 0,
    revision: catalog.revision,
    sourcesUpserted: 0,
  };

  await db.transaction(async (tx) => {
    const validRecords: DestinationCatalogRecord[] = [];

    const quarantine = async (
      providerRecordId: string,
      payload: Record<string, unknown>,
      errors: ValidationError[],
    ) => {
      await tx
        .insert(destinationIngestionQuarantine)
        .values({
          errors,
          lastSeenAt: now,
          payload,
          provider: catalog.provider,
          providerRecordId,
        })
        .onConflictDoUpdate({
          target: [
            destinationIngestionQuarantine.provider,
            destinationIngestionQuarantine.providerRecordId,
          ],
          set: {
            errors,
            lastSeenAt: now,
            occurrenceCount: sql`${destinationIngestionQuarantine.occurrenceCount} + 1`,
            payload,
            resolvedAt: null,
            status: "pending",
            updatedAt: now,
          },
        });
      summary.recordsQuarantined += 1;
    };

    const resolveQuarantine = async (providerRecordId: string) => {
      const rows = await tx
        .update(destinationIngestionQuarantine)
        .set({ resolvedAt: now, status: "resolved", updatedAt: now })
        .where(
          and(
            eq(destinationIngestionQuarantine.provider, catalog.provider),
            eq(destinationIngestionQuarantine.providerRecordId, providerRecordId),
            eq(destinationIngestionQuarantine.status, "pending"),
          ),
        )
        .returning({ id: destinationIngestionQuarantine.id });
      summary.quarantineResolved += rows.length;
    };

    const providerRecordIds = catalog.records.map(recordIdentifier);
    const recordCounts = new Map<string, number>();
    for (const providerRecordId of providerRecordIds) {
      recordCounts.set(providerRecordId, (recordCounts.get(providerRecordId) ?? 0) + 1);
    }

    for (const [index, rawRecord] of catalog.records.entries()) {
      const providerRecordId = providerRecordIds[index]!;
      if ((recordCounts.get(providerRecordId) ?? 0) > 1) {
        await quarantine(
          providerRecordId,
          quarantinePayload(rawRecord),
          referenceError("duplicate_record", "Catalog record identifiers must be unique.", "key"),
        );
        continue;
      }
      const parsed = catalogRecordSchema.safeParse(rawRecord);
      if (!parsed.success) {
        await quarantine(
          providerRecordId,
          quarantinePayload(rawRecord),
          validationErrors(parsed.error),
        );
        continue;
      }
      validRecords.push(parsed.data);
    }

    const policyIds = new Map<
      string,
      { expireAfterSeconds: number; freshForSeconds: number; id: string }
    >();
    for (const record of validRecords) {
      if (record.kind !== "freshness_policy") continue;
      const [policy] = await tx
        .insert(freshnessPolicies)
        .values({
          description: record.description,
          expireAfterSeconds: record.expireAfterSeconds,
          freshForSeconds: record.freshForSeconds,
          manualReviewAfterSeconds: record.manualReviewAfterSeconds,
          policyKey: record.key,
          version: record.version,
        })
        .onConflictDoUpdate({
          target: [freshnessPolicies.policyKey, freshnessPolicies.version],
          set: {
            description: record.description,
            expireAfterSeconds: record.expireAfterSeconds,
            freshForSeconds: record.freshForSeconds,
            manualReviewAfterSeconds: record.manualReviewAfterSeconds,
            updatedAt: now,
          },
        })
        .returning({ id: freshnessPolicies.id });
      policyIds.set(policyMapKey(record.key, record.version), {
        expireAfterSeconds: record.expireAfterSeconds,
        freshForSeconds: record.freshForSeconds,
        id: policy!.id,
      });
      summary.policiesUpserted += 1;
      await resolveQuarantine(`freshness_policy:${record.key}`);
    }

    const sourceIds = new Map<string, string>();
    for (const record of validRecords) {
      if (record.kind !== "source") continue;
      const [source] = await tx
        .insert(sources)
        .values({
          attributionText: record.attributionText,
          license: record.license,
          licenseUrl: record.licenseUrl,
          metadata: record.metadata,
          offlineUseAllowed: record.offlineUseAllowed,
          provider: record.provider,
          publishedAt: record.publishedAt ? new Date(record.publishedAt) : undefined,
          redistributionAllowed: record.redistributionAllowed,
          retrievedAt: new Date(record.retrievedAt),
          sourceKind: record.sourceKind,
          sourceUrl: record.sourceUrl,
          title: record.title,
          trustTier: record.trustTier,
          validFrom: record.validFrom ? new Date(record.validFrom) : undefined,
          validUntil: record.validUntil ? new Date(record.validUntil) : undefined,
        })
        .onConflictDoUpdate({
          target: [sources.provider, sources.sourceUrl],
          set: {
            attributionText: record.attributionText ?? null,
            license: record.license ?? null,
            licenseUrl: record.licenseUrl ?? null,
            metadata: record.metadata,
            offlineUseAllowed: record.offlineUseAllowed,
            publishedAt: record.publishedAt ? new Date(record.publishedAt) : null,
            redistributionAllowed: record.redistributionAllowed,
            retrievedAt: new Date(record.retrievedAt),
            sourceKind: record.sourceKind,
            title: record.title ?? null,
            trustTier: record.trustTier,
            updatedAt: now,
            validFrom: record.validFrom ? new Date(record.validFrom) : null,
            validUntil: record.validUntil ? new Date(record.validUntil) : null,
          },
        })
        .returning({ id: sources.id });
      sourceIds.set(record.key, source!.id);
      summary.sourcesUpserted += 1;
      await resolveQuarantine(`source:${record.key}`);
    }

    const pendingPlaces = validRecords.filter((record) => record.kind === "place");
    const placeIds = new Map<string, string>();
    let madeProgress = true;

    while (pendingPlaces.length > 0 && madeProgress) {
      madeProgress = false;
      for (let index = pendingPlaces.length - 1; index >= 0; index -= 1) {
        const record = pendingPlaces[index]!;
        if (record.parentKey && !placeIds.has(record.parentKey)) continue;

        const missingPolicy = record.content.find(
          (content) =>
            !policyIds.has(
              policyMapKey(content.freshnessPolicyKey, content.freshnessPolicyVersion),
            ),
        );
        const missingSource = record.content
          .flatMap((content) => content.sourceKeys)
          .find((sourceKey) => !sourceIds.has(sourceKey));
        if (missingPolicy || missingSource) {
          await quarantine(
            `place:${record.key}`,
            record,
            missingPolicy
              ? referenceError(
                  "missing_freshness_policy",
                  `Freshness policy ${missingPolicy.freshnessPolicyKey} v${missingPolicy.freshnessPolicyVersion} was not found.`,
                  "content.freshnessPolicyKey",
                )
              : referenceError(
                  "missing_source",
                  `Source ${missingSource} was not found.`,
                  "content.sourceKeys",
                ),
          );
          pendingPlaces.splice(index, 1);
          madeProgress = true;
          continue;
        }

        const existingIdentity = await tx
          .select({ placeId: placeProviderIds.placeId })
          .from(placeProviderIds)
          .where(
            and(
              eq(placeProviderIds.provider, catalog.provider),
              eq(placeProviderIds.providerPlaceId, record.key),
            ),
          )
          .limit(1);
        const placeValues = {
          canonicalName: record.canonicalName,
          countryCode: record.countryCode ?? null,
          latitude: record.coordinates?.latitude ?? null,
          localizedNames: record.localizedNames,
          longitude: record.coordinates?.longitude ?? null,
          parentPlaceId: record.parentKey ? placeIds.get(record.parentKey) : null,
          placeType: record.placeType,
          status: record.status,
          summary: record.summary ?? null,
          timezone: record.timezone ?? null,
          updatedAt: now,
        };

        let placeId = existingIdentity[0]?.placeId;
        if (placeId) {
          await tx.update(places).set(placeValues).where(eq(places.id, placeId));
          summary.placesUpdated += 1;
        } else {
          const [place] = await tx.insert(places).values(placeValues).returning({ id: places.id });
          placeId = place!.id;
          summary.placesCreated += 1;
        }
        placeIds.set(record.key, placeId);

        await tx
          .insert(placeProviderIds)
          .values({
            metadata: { catalogKey: catalog.catalogKey, catalogRevision: catalog.revision },
            placeId,
            provider: catalog.provider,
            providerPlaceId: record.key,
            retrievedAt: now,
          })
          .onConflictDoUpdate({
            target: [placeProviderIds.provider, placeProviderIds.providerPlaceId],
            set: {
              metadata: { catalogKey: catalog.catalogKey, catalogRevision: catalog.revision },
              placeId,
              retrievedAt: now,
              updatedAt: now,
            },
          });

        for (const identity of record.providerIds) {
          await tx
            .insert(placeProviderIds)
            .values({
              metadata: identity.metadata,
              placeId,
              provider: identity.provider,
              providerPlaceId: identity.providerPlaceId,
              retrievedAt: new Date(identity.retrievedAt),
            })
            .onConflictDoUpdate({
              target: [placeProviderIds.provider, placeProviderIds.providerPlaceId],
              set: {
                metadata: identity.metadata,
                placeId,
                retrievedAt: new Date(identity.retrievedAt),
                updatedAt: now,
              },
            });
        }

        for (const content of record.content) {
          const existingContent = await tx
            .select({ id: destinationContent.id, reviewedAt: destinationContent.reviewedAt })
            .from(destinationContent)
            .where(
              and(
                eq(destinationContent.placeId, placeId),
                eq(destinationContent.contentType, content.contentType),
                eq(destinationContent.locale, content.locale),
              ),
            )
            .limit(1);
          if (existingContent[0]?.reviewedAt) {
            summary.reviewedContentPreserved += 1;
            continue;
          }

          const policy = policyIds.get(
            policyMapKey(content.freshnessPolicyKey, content.freshnessPolicyVersion),
          )!;
          const refreshedAt = new Date(content.refreshedAt);
          const [contentRow] = await tx
            .insert(destinationContent)
            .values({
              content: content.content,
              contentType: content.contentType,
              expiresAt: new Date(refreshedAt.getTime() + policy.expireAfterSeconds * 1_000),
              freshnessPolicyId: policy.id,
              locale: content.locale,
              placeId,
              qualityState: content.qualityState,
              refreshedAt,
              staleAt: new Date(refreshedAt.getTime() + policy.freshForSeconds * 1_000),
            })
            .onConflictDoUpdate({
              target: [
                destinationContent.placeId,
                destinationContent.contentType,
                destinationContent.locale,
              ],
              set: {
                content: content.content,
                expiresAt: new Date(refreshedAt.getTime() + policy.expireAfterSeconds * 1_000),
                freshnessPolicyId: policy.id,
                qualityState: content.qualityState,
                refreshedAt,
                staleAt: new Date(refreshedAt.getTime() + policy.freshForSeconds * 1_000),
                updatedAt: now,
              },
            })
            .returning({ id: destinationContent.id });

          if (existingContent.length > 0) summary.contentUpdated += 1;
          else summary.contentCreated += 1;

          await tx
            .delete(destinationContentSources)
            .where(eq(destinationContentSources.destinationContentId, contentRow!.id));
          await tx.insert(destinationContentSources).values(
            content.sourceKeys.map((sourceKey, sourceIndex) => ({
              destinationContentId: contentRow!.id,
              retrievedAt: refreshedAt,
              sourceId: sourceIds.get(sourceKey)!,
              sourceRole: sourceIndex === 0 ? ("primary" as const) : ("supporting" as const),
            })),
          );
        }

        await resolveQuarantine(`place:${record.key}`);
        pendingPlaces.splice(index, 1);
        madeProgress = true;
      }
    }

    for (const record of pendingPlaces) {
      await quarantine(
        `place:${record.key}`,
        record,
        referenceError(
          "unresolved_parent",
          `Parent ${record.parentKey ?? "unknown"} was not found in this catalog.`,
          "parentKey",
        ),
      );
    }
  });

  return summary;
}
