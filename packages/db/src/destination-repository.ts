import { and, asc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import { destinationContent, destinationContentSources, places, sources } from "./schema.js";

export type DestinationContentState = "fresh" | "stale" | "expired" | "manually_reviewed";
export type DestinationContentFreshnessState = Exclude<
  DestinationContentState,
  "manually_reviewed"
>;

function freshnessStateAt(now: Date) {
  return sql<DestinationContentFreshnessState>`case
    when ${destinationContent.expiresAt} <= ${now} then 'expired'
    when ${destinationContent.staleAt} <= ${now} then 'stale'
    else 'fresh'
  end`;
}

export async function getDestinationContentProvenance(
  db: Database,
  contentId: string,
  now = new Date(),
) {
  const rows = await db
    .select({
      contentId: destinationContent.id,
      placeId: destinationContent.placeId,
      placeName: places.canonicalName,
      placeType: places.placeType,
      contentType: destinationContent.contentType,
      locale: destinationContent.locale,
      content: destinationContent.content,
      qualityState: destinationContent.qualityState,
      freshnessState: freshnessStateAt(now),
      refreshedAt: destinationContent.refreshedAt,
      staleAt: destinationContent.staleAt,
      expiresAt: destinationContent.expiresAt,
      reviewedAt: destinationContent.reviewedAt,
      reviewedBy: destinationContent.reviewedBy,
      contentSourceId: destinationContentSources.id,
      sourceRole: destinationContentSources.sourceRole,
      sourceRetrievedAt: destinationContentSources.retrievedAt,
      sourceId: sources.id,
      sourceProvider: sources.provider,
      sourceUrl: sources.sourceUrl,
      sourceTitle: sources.title,
      sourceKind: sources.sourceKind,
      sourceTrustTier: sources.trustTier,
      sourceLicense: sources.license,
      sourceLicenseUrl: sources.licenseUrl,
      sourceAttributionText: sources.attributionText,
      sourceOfflineUseAllowed: sources.offlineUseAllowed,
      sourceRedistributionAllowed: sources.redistributionAllowed,
    })
    .from(destinationContent)
    .innerJoin(places, eq(destinationContent.placeId, places.id))
    .leftJoin(
      destinationContentSources,
      eq(destinationContentSources.destinationContentId, destinationContent.id),
    )
    .leftJoin(sources, eq(destinationContentSources.sourceId, sources.id))
    .where(eq(destinationContent.id, contentId))
    .orderBy(asc(destinationContentSources.sourceRole), asc(destinationContentSources.retrievedAt));

  const first = rows[0];
  if (!first) {
    return null;
  }

  return {
    id: first.contentId,
    place: {
      id: first.placeId,
      canonicalName: first.placeName,
      type: first.placeType,
    },
    contentType: first.contentType,
    locale: first.locale,
    content: first.content,
    qualityState: first.qualityState,
    freshnessState: first.freshnessState,
    refreshedAt: first.refreshedAt,
    staleAt: first.staleAt,
    expiresAt: first.expiresAt,
    reviewedAt: first.reviewedAt,
    reviewedBy: first.reviewedBy,
    sources: rows.flatMap((row) =>
      row.contentSourceId && row.sourceId && row.sourceProvider && row.sourceUrl
        ? [
            {
              id: row.sourceId,
              role: row.sourceRole!,
              retrievedAt: row.sourceRetrievedAt!,
              provider: row.sourceProvider,
              url: row.sourceUrl,
              title: row.sourceTitle,
              kind: row.sourceKind!,
              trustTier: row.sourceTrustTier!,
              license: row.sourceLicense,
              licenseUrl: row.sourceLicenseUrl,
              attributionText: row.sourceAttributionText,
              offlineUseAllowed: row.sourceOfflineUseAllowed!,
              redistributionAllowed: row.sourceRedistributionAllowed!,
            },
          ]
        : [],
    ),
  };
}

export async function listDestinationContentByState(
  db: Database,
  state: DestinationContentState,
  options: { limit?: number; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 100;

  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError("Destination content state queries require a limit between 1 and 500.");
  }

  const condition =
    state === "fresh"
      ? gt(destinationContent.staleAt, now)
      : state === "stale"
        ? and(lte(destinationContent.staleAt, now), gt(destinationContent.expiresAt, now))
        : state === "expired"
          ? lte(destinationContent.expiresAt, now)
          : and(
              eq(destinationContent.qualityState, "approved"),
              isNotNull(destinationContent.reviewedAt),
            );

  return db
    .select({
      id: destinationContent.id,
      placeId: destinationContent.placeId,
      contentType: destinationContent.contentType,
      locale: destinationContent.locale,
      qualityState: destinationContent.qualityState,
      freshnessState: freshnessStateAt(now),
      staleAt: destinationContent.staleAt,
      expiresAt: destinationContent.expiresAt,
      reviewedAt: destinationContent.reviewedAt,
    })
    .from(destinationContent)
    .where(condition)
    .orderBy(asc(destinationContent.staleAt), asc(destinationContent.id))
    .limit(limit);
}
