import { and, asc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import type { DestinationPlaceType, DestinationSearchQuery } from "@roavia/contracts";

import type { Database } from "./client.js";
import { destinationContent, destinationContentSources, places, sources } from "./schema.js";

export type DestinationContentState = "fresh" | "stale" | "expired" | "manually_reviewed";
export type DestinationContentFreshnessState = Exclude<
  DestinationContentState,
  "manually_reviewed"
>;

type SearchablePlace = {
  id: string;
  parentPlaceId: string | null;
  placeType: DestinationPlaceType;
  canonicalName: string;
  localizedNames: Record<string, string>;
  countryCode: string | null;
};

export interface DestinationSearchPage {
  query: string;
  results: Array<{
    id: string;
    canonicalName: string;
    localizedNames: Record<string, string>;
    placeType: DestinationPlaceType;
    countryCode: string | null;
    hierarchy: Array<{ id: string; name: string; type: DestinationPlaceType }>;
  }>;
  pagination: { page: number; limit: number; total: number; nextPage: number | null };
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function localizedNameMap(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "",
    ),
  );
}

function hierarchyFor(place: SearchablePlace, allPlaces: Map<string, SearchablePlace>) {
  const hierarchy: Array<{ id: string; name: string; type: DestinationPlaceType }> = [];
  const visited = new Set<string>([place.id]);
  let parentId = place.parentPlaceId;

  while (parentId) {
    const parent = allPlaces.get(parentId);
    if (!parent || visited.has(parent.id)) {
      break;
    }
    hierarchy.unshift({ id: parent.id, name: parent.canonicalName, type: parent.placeType });
    visited.add(parent.id);
    parentId = parent.parentPlaceId;
  }

  return hierarchy;
}

function matchRank(place: SearchablePlace, query: string): number | null {
  const canonical = normalized(place.canonicalName);
  const localNames = Object.values(place.localizedNames).map(normalized);

  if (canonical === query) return 0;
  if (localNames.includes(query)) return 1;
  if (canonical.startsWith(query)) return 2;
  if (localNames.some((name) => name.startsWith(query))) return 3;
  if (canonical.includes(query)) return 4;
  if (localNames.some((name) => name.includes(query))) return 5;
  return null;
}

export async function searchDestinations(
  db: Database,
  query: DestinationSearchQuery,
): Promise<DestinationSearchPage> {
  const records = await db
    .select({
      id: places.id,
      parentPlaceId: places.parentPlaceId,
      placeType: places.placeType,
      canonicalName: places.canonicalName,
      localizedNames: places.localizedNames,
      countryCode: places.countryCode,
    })
    .from(places)
    .where(eq(places.status, "active"))
    .orderBy(asc(places.canonicalName), asc(places.id));

  const allPlaces = new Map<string, SearchablePlace>(
    records.map((record) => [
      record.id,
      {
        ...record,
        placeType: record.placeType as DestinationPlaceType,
        localizedNames: localizedNameMap(record.localizedNames),
      },
    ]),
  );
  const normalizedQuery = normalized(query.query);

  const ranked = [...allPlaces.values()]
    .flatMap((place) => {
      const rank = matchRank(place, normalizedQuery);
      const hierarchy = hierarchyFor(place, allPlaces);
      const matchesRegion = !query.regionId || hierarchy.some((item) => item.id === query.regionId);
      const matchesType = query.types.length === 0 || query.types.includes(place.placeType);
      const matchesCountry = !query.country || place.countryCode === query.country;

      return rank === null || !matchesRegion || !matchesType || !matchesCountry
        ? []
        : [{ place, rank, hierarchy }];
    })
    .toSorted(
      (left, right) =>
        left.rank - right.rank ||
        left.place.canonicalName.localeCompare(right.place.canonicalName) ||
        left.place.id.localeCompare(right.place.id),
    );
  const start = (query.page - 1) * query.limit;
  const pageResults = ranked.slice(start, start + query.limit);

  return {
    query: query.query,
    results: pageResults.map(({ place, hierarchy }) => ({
      id: place.id,
      canonicalName: place.canonicalName,
      localizedNames: place.localizedNames,
      placeType: place.placeType,
      countryCode: place.countryCode,
      hierarchy,
    })),
    pagination: {
      page: query.page,
      limit: query.limit,
      total: ranked.length,
      nextPage: start + query.limit < ranked.length ? query.page + 1 : null,
    },
  };
}

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
