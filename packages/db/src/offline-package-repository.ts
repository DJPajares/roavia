import {
  offlinePackageManifestSchema,
  offlinePackageRecordSchema,
  type OfflinePackageRecord,
  type OfflinePackagePlace,
} from "@roavia/contracts";
import { buildOfflinePackage, type OfflineGuidanceInput } from "@roavia/offline/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import { AuthorizedResourceNotFoundError } from "./authorization.js";
import type { Database } from "./client.js";
import { listGroundingContent } from "./destination-repository.js";
import { offlinePackages, places, trips, users } from "./schema.js";
import { createTripRepository } from "./trip-repository.js";

export interface OfflinePackageGenerationContext {
  now?: Date;
}

export interface OfflinePackageRepository {
  generate(
    authUserId: string,
    tripId: string,
    context?: OfflinePackageGenerationContext,
  ): Promise<{ package: OfflinePackageRecord; reused: boolean }>;
  getLatest(authUserId: string, tripId: string): Promise<OfflinePackageRecord | null>;
}

function serializeRecord(row: typeof offlinePackages.$inferSelect): OfflinePackageRecord {
  return offlinePackageRecordSchema.parse({
    id: row.id,
    tripId: row.tripId,
    version: row.version,
    generatedAt: row.generatedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    sizeBytes: row.sizeBytes,
    manifest: row.manifest,
  });
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

export function createOfflinePackageRepository(db: Database): OfflinePackageRepository {
  const tripRepository = createTripRepository(db);

  return {
    async generate(authUserId, tripId, context = {}) {
      const now = context.now ?? new Date();

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const trip = await tripRepository.getTrip(authUserId, tripId);
        const placeIds = [
          ...new Set([
            ...trip.destinations.map((destination) => destination.placeId),
            ...trip.days.flatMap((day) =>
              day.items.flatMap((item) => (item.placeId ? [item.placeId] : [])),
            ),
          ]),
        ];
        const placeRows =
          placeIds.length === 0
            ? []
            : await db
                .select({
                  id: places.id,
                  name: places.canonicalName,
                  latitude: places.latitude,
                  longitude: places.longitude,
                  timezone: places.timezone,
                  type: places.placeType,
                })
                .from(places)
                .where(and(inArray(places.id, placeIds), eq(places.status, "active")));
        const packagePlaces: OfflinePackagePlace[] = placeRows.map((place) => ({
          address: null,
          coordinates:
            place.latitude === null || place.longitude === null
              ? null
              : { latitude: place.latitude, longitude: place.longitude },
          id: place.id,
          name: place.name,
          timezone: place.timezone,
          type: place.type,
        }));
        if (packagePlaces.length !== placeIds.length) {
          throw new Error("Offline packages require every itinerary place to remain active.");
        }
        const groundingBatches = await Promise.all(
          chunks(placeIds, 25).map((batch) =>
            listGroundingContent(db, {
              maxDepth: 0,
              maxPlaces: batch.length,
              maxRecords: 100,
              now,
              placeIds: batch,
            }),
          ),
        );
        const guidance: OfflineGuidanceInput[] = groundingBatches.flat().flatMap((record) =>
          record.freshnessState === "expired"
            ? []
            : [
                {
                  contentType: record.contentType,
                  data: record.content,
                  freshness: record.freshnessState,
                  placeId: record.place.id,
                  refreshedAt: record.refreshedAt.toISOString(),
                  sources: record.sources.map((source) => ({
                    attribution: source.attributionText,
                    license: source.license,
                    licenseUrl: source.licenseUrl,
                    offlineUseAllowed: source.offlineUseAllowed,
                    redistributionAllowed: source.redistributionAllowed,
                    retrievedAt: source.retrievedAt.toISOString(),
                    title: source.title,
                    trustTier: source.trustTier,
                    url: source.url,
                  })),
                },
              ],
        );

        const result = await db.transaction(async (transaction) => {
          const [ownedTrip] = await transaction
            .select({ actorUserId: users.id, revision: trips.revision })
            .from(trips)
            .innerJoin(users, eq(trips.ownerUserId, users.id))
            .where(and(eq(trips.id, tripId), eq(users.authUserId, authUserId)))
            .limit(1)
            .for("update");
          if (!ownedTrip) throw new AuthorizedResourceNotFoundError();
          if (ownedTrip.revision !== trip.revision) return null;

          const [latest] = await transaction
            .select()
            .from(offlinePackages)
            .where(
              and(
                eq(offlinePackages.tripId, tripId),
                eq(offlinePackages.userId, ownedTrip.actorUserId),
              ),
            )
            .orderBy(desc(offlinePackages.version))
            .limit(1);
          const initialVersion = latest?.version ?? 1;
          const initialManifest = buildOfflinePackage({
            generatedAt: now,
            guidance,
            packageVersion: initialVersion,
            places: packagePlaces,
            trip,
          });
          const latestManifest = latest
            ? offlinePackageManifestSchema.safeParse(latest.manifest)
            : undefined;
          if (
            latest &&
            latestManifest?.success &&
            latestManifest.data.contentHash === initialManifest.contentHash
          ) {
            return { package: serializeRecord(latest), reused: true };
          }

          const version = latest ? latest.version + 1 : 1;
          const manifest =
            version === initialVersion
              ? initialManifest
              : buildOfflinePackage({
                  generatedAt: now,
                  guidance,
                  packageVersion: version,
                  places: packagePlaces,
                  trip,
                });
          const [created] = await transaction
            .insert(offlinePackages)
            .values({
              generatedAt: now,
              manifest: manifest as unknown as (typeof offlinePackages.$inferInsert)["manifest"],
              sizeBytes: manifest.sizeBytes,
              tripId,
              userId: ownedTrip.actorUserId,
              version,
            })
            .returning();
          return { package: serializeRecord(created!), reused: false };
        });
        if (result) return result;
      }
      throw new Error("Trip changed repeatedly while generating its offline package.");
    },

    async getLatest(authUserId, tripId) {
      const [row] = await db
        .select({ package: offlinePackages })
        .from(offlinePackages)
        .innerJoin(trips, eq(offlinePackages.tripId, trips.id))
        .innerJoin(users, eq(trips.ownerUserId, users.id))
        .where(and(eq(offlinePackages.tripId, tripId), eq(users.authUserId, authUserId)))
        .orderBy(desc(offlinePackages.version))
        .limit(1);
      return row ? serializeRecord(row.package) : null;
    },
  };
}
