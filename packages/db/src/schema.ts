import type { Buffer } from "node:buffer";

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

type JsonObject = Record<string, unknown>;
type JsonArray = unknown[];

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const uuidPrimaryKey = () => uuid("id").primaryKey().notNull().defaultRandom();

const createdAt = () =>
  timestamp("created_at", { mode: "date", precision: 3, withTimezone: true })
    .notNull()
    .defaultNow();

const updatedAt = () =>
  timestamp("updated_at", { mode: "date", precision: 3, withTimezone: true })
    .notNull()
    .defaultNow();

export const users = pgTable(
  "users",
  {
    id: uuidPrimaryKey(),
    authUserId: text("auth_user_id").notNull(),
    displayName: text("display_name").notNull(),
    homeCountry: text("home_country"),
    preferredCurrency: text("preferred_currency").notNull().default("USD"),
    locale: text("locale").notNull().default("en"),
    timezone: text("timezone").notNull().default("UTC"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("users_auth_user_id_uidx").on(table.authUserId),
    check(
      "users_display_name_length_chk",
      sql`char_length(${table.displayName}) between 1 and 100`,
    ),
    check(
      "users_home_country_format_chk",
      sql`${table.homeCountry} is null or ${table.homeCountry} ~ '^[A-Z]{2}$'`,
    ),
    check("users_preferred_currency_format_chk", sql`${table.preferredCurrency} ~ '^[A-Z]{3}$'`),
    check("users_locale_length_chk", sql`char_length(${table.locale}) between 2 and 35`),
    check("users_timezone_length_chk", sql`char_length(${table.timezone}) between 1 and 100`),
  ],
);

export const travelProfiles = pgTable(
  "travel_profiles",
  {
    id: uuidPrimaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    defaultBudgetStyle: text("default_budget_style", {
      enum: ["budget", "midrange", "premium", "luxury"],
    })
      .notNull()
      .default("midrange"),
    defaultPace: text("default_pace", { enum: ["slow", "balanced", "fast"] })
      .notNull()
      .default("balanced"),
    interests: jsonb("interests_json")
      .$type<JsonArray>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    dietaryNeeds: jsonb("dietary_needs_json")
      .$type<JsonArray>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    accessibilityNeeds: jsonb("accessibility_needs_json")
      .$type<JsonArray>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    travelPreferences: jsonb("travel_preferences_json")
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("travel_profiles_user_id_uidx").on(table.userId),
    check(
      "travel_profiles_budget_style_chk",
      sql`${table.defaultBudgetStyle} in ('budget', 'midrange', 'premium', 'luxury')`,
    ),
    check("travel_profiles_pace_chk", sql`${table.defaultPace} in ('slow', 'balanced', 'fast')`),
    check("travel_profiles_interests_array_chk", sql`jsonb_typeof(${table.interests}) = 'array'`),
    check(
      "travel_profiles_dietary_needs_array_chk",
      sql`jsonb_typeof(${table.dietaryNeeds}) = 'array'`,
    ),
    check(
      "travel_profiles_accessibility_needs_array_chk",
      sql`jsonb_typeof(${table.accessibilityNeeds}) = 'array'`,
    ),
    check(
      "travel_profiles_preferences_object_chk",
      sql`jsonb_typeof(${table.travelPreferences}) = 'object'`,
    ),
  ],
);

export const places = pgTable(
  "places",
  {
    id: uuidPrimaryKey(),
    parentPlaceId: uuid("parent_place_id").references((): AnyPgColumn => places.id, {
      onDelete: "set null",
    }),
    placeType: text("place_type", {
      enum: ["country", "region", "city", "district", "poi", "transit_hub"],
    }).notNull(),
    canonicalName: text("canonical_name").notNull(),
    localizedNames: jsonb("localized_names_json")
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    latitude: numeric("latitude", { mode: "number", precision: 9, scale: 6 }),
    longitude: numeric("longitude", { mode: "number", precision: 10, scale: 6 }),
    timezone: text("timezone"),
    countryCode: text("country_code"),
    summary: text("summary"),
    status: text("status", { enum: ["active", "deprecated"] })
      .notNull()
      .default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("places_parent_place_id_idx").on(table.parentPlaceId),
    index("places_country_type_name_idx").on(
      table.countryCode,
      table.placeType,
      table.canonicalName,
    ),
    index("places_parent_type_name_idx").on(
      table.parentPlaceId,
      table.placeType,
      table.canonicalName,
    ),
    index("places_active_updated_idx")
      .on(table.updatedAt)
      .where(sql`${table.status} = 'active'`),
    check(
      "places_type_chk",
      sql`${table.placeType} in ('country', 'region', 'city', 'district', 'poi', 'transit_hub')`,
    ),
    check("places_name_length_chk", sql`char_length(${table.canonicalName}) between 1 and 200`),
    check(
      "places_localized_names_object_chk",
      sql`jsonb_typeof(${table.localizedNames}) = 'object'`,
    ),
    check(
      "places_parent_not_self_chk",
      sql`${table.parentPlaceId} is null or ${table.parentPlaceId} <> ${table.id}`,
    ),
    check(
      "places_coordinate_pair_chk",
      sql`(${table.latitude} is null) = (${table.longitude} is null)`,
    ),
    check(
      "places_latitude_range_chk",
      sql`${table.latitude} is null or ${table.latitude} between -90 and 90`,
    ),
    check(
      "places_longitude_range_chk",
      sql`${table.longitude} is null or ${table.longitude} between -180 and 180`,
    ),
    check(
      "places_country_code_format_chk",
      sql`${table.countryCode} is null or ${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
    check("places_status_chk", sql`${table.status} in ('active', 'deprecated')`),
  ],
);

export const placeProviderIds = pgTable(
  "place_provider_ids",
  {
    id: uuidPrimaryKey(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerPlaceId: text("provider_place_id").notNull(),
    retrievedAt: timestamp("retrieved_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    metadata: jsonb("metadata_json")
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("place_provider_ids_provider_record_unique").on(table.provider, table.providerPlaceId),
    index("place_provider_ids_place_provider_idx").on(table.placeId, table.provider),
    check(
      "place_provider_ids_provider_length_chk",
      sql`char_length(${table.provider}) between 1 and 100`,
    ),
    check(
      "place_provider_ids_record_length_chk",
      sql`char_length(${table.providerPlaceId}) between 1 and 500`,
    ),
    check(
      "place_provider_ids_metadata_object_chk",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
  ],
);

export const sources = pgTable(
  "sources",
  {
    id: uuidPrimaryKey(),
    provider: text("provider").notNull(),
    sourceUrl: text("source_url").notNull(),
    title: text("title"),
    sourceKind: text("source_kind", {
      enum: ["official_authority", "official_operator", "licensed_provider", "reviewed_editorial"],
    })
      .notNull()
      .default("licensed_provider"),
    license: text("license"),
    licenseUrl: text("license_url"),
    attributionText: text("attribution_text"),
    offlineUseAllowed: boolean("offline_use_allowed").notNull().default(false),
    redistributionAllowed: boolean("redistribution_allowed").notNull().default(false),
    retrievedAt: timestamp("retrieved_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    publishedAt: timestamp("published_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }),
    validFrom: timestamp("valid_from", { mode: "date", precision: 3, withTimezone: true }),
    validUntil: timestamp("valid_until", { mode: "date", precision: 3, withTimezone: true }),
    trustTier: text("trust_tier", { enum: ["tier_1", "tier_2", "tier_3", "tier_4"] })
      .notNull()
      .default("tier_3"),
    metadata: jsonb("metadata_json")
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("sources_provider_url_unique").on(table.provider, table.sourceUrl),
    index("sources_provider_retrieved_at_idx").on(table.provider, table.retrievedAt.desc()),
    index("sources_kind_valid_until_idx").on(table.sourceKind, table.validUntil),
    check("sources_provider_length_chk", sql`char_length(${table.provider}) between 1 and 100`),
    check("sources_url_length_chk", sql`char_length(${table.sourceUrl}) between 1 and 2048`),
    check(
      "sources_title_length_chk",
      sql`${table.title} is null or char_length(${table.title}) between 1 and 300`,
    ),
    check(
      "sources_kind_chk",
      sql`${table.sourceKind} in ('official_authority', 'official_operator', 'licensed_provider', 'reviewed_editorial')`,
    ),
    check(
      "sources_license_url_length_chk",
      sql`${table.licenseUrl} is null or char_length(${table.licenseUrl}) between 1 and 2048`,
    ),
    check(
      "sources_validity_order_chk",
      sql`${table.validFrom} is null or ${table.validUntil} is null or ${table.validUntil} > ${table.validFrom}`,
    ),
    check(
      "sources_trust_tier_chk",
      sql`${table.trustTier} in ('tier_1', 'tier_2', 'tier_3', 'tier_4')`,
    ),
    check("sources_metadata_object_chk", sql`jsonb_typeof(${table.metadata}) = 'object'`),
  ],
);

export const freshnessPolicies = pgTable(
  "freshness_policies",
  {
    id: uuidPrimaryKey(),
    policyKey: text("policy_key").notNull(),
    version: integer("version").notNull(),
    freshForSeconds: integer("fresh_for_seconds").notNull(),
    expireAfterSeconds: integer("expire_after_seconds").notNull(),
    manualReviewAfterSeconds: integer("manual_review_after_seconds"),
    description: text("description").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("freshness_policies_key_version_unique").on(table.policyKey, table.version),
    check(
      "freshness_policies_key_format_chk",
      sql`${table.policyKey} ~ '^[a-z][a-z0-9_.-]+$' and char_length(${table.policyKey}) <= 100`,
    ),
    check("freshness_policies_version_positive_chk", sql`${table.version} > 0`),
    check("freshness_policies_fresh_positive_chk", sql`${table.freshForSeconds} > 0`),
    check(
      "freshness_policies_expiry_after_fresh_chk",
      sql`${table.expireAfterSeconds} > ${table.freshForSeconds}`,
    ),
    check(
      "freshness_policies_review_positive_chk",
      sql`${table.manualReviewAfterSeconds} is null or ${table.manualReviewAfterSeconds} > 0`,
    ),
    check(
      "freshness_policies_description_length_chk",
      sql`char_length(${table.description}) between 1 and 500`,
    ),
  ],
);

export const destinationContent = pgTable(
  "destination_content",
  {
    id: uuidPrimaryKey(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    freshnessPolicyId: uuid("freshness_policy_id")
      .notNull()
      .references(() => freshnessPolicies.id, { onDelete: "restrict" }),
    contentType: text("content_type").notNull(),
    locale: text("locale").notNull().default("en"),
    content: jsonb("content_json").$type<JsonObject>().notNull(),
    qualityState: text("quality_state", {
      enum: ["draft", "in_review", "approved", "rejected"],
    })
      .notNull()
      .default("draft"),
    refreshedAt: timestamp("refreshed_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    staleAt: timestamp("stale_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }).notNull(),
    reviewedAt: timestamp("reviewed_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }),
    reviewedBy: text("reviewed_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("destination_content_place_type_locale_unique").on(
      table.placeId,
      table.contentType,
      table.locale,
    ),
    index("destination_content_policy_id_idx").on(table.freshnessPolicyId),
    index("destination_content_quality_stale_idx").on(table.qualityState, table.staleAt),
    index("destination_content_expires_at_idx").on(table.expiresAt),
    index("destination_content_manually_reviewed_idx")
      .on(table.reviewedAt)
      .where(sql`${table.qualityState} = 'approved' and ${table.reviewedAt} is not null`),
    check(
      "destination_content_type_format_chk",
      sql`${table.contentType} ~ '^[a-z][a-z0-9_.-]+$' and char_length(${table.contentType}) <= 100`,
    ),
    check(
      "destination_content_locale_length_chk",
      sql`char_length(${table.locale}) between 2 and 35`,
    ),
    check("destination_content_json_object_chk", sql`jsonb_typeof(${table.content}) = 'object'`),
    check(
      "destination_content_quality_state_chk",
      sql`${table.qualityState} in ('draft', 'in_review', 'approved', 'rejected')`,
    ),
    check(
      "destination_content_stale_after_refresh_chk",
      sql`${table.staleAt} > ${table.refreshedAt}`,
    ),
    check("destination_content_expiry_after_stale_chk", sql`${table.expiresAt} > ${table.staleAt}`),
    check(
      "destination_content_review_metadata_chk",
      sql`(${table.reviewedAt} is null and ${table.reviewedBy} is null) or (${table.reviewedAt} is not null and ${table.reviewedBy} is not null)`,
    ),
  ],
);

export const destinationContentSources = pgTable(
  "destination_content_sources",
  {
    id: uuidPrimaryKey(),
    destinationContentId: uuid("destination_content_id")
      .notNull()
      .references(() => destinationContent.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    sourceRole: text("source_role", { enum: ["primary", "supporting"] })
      .notNull()
      .default("supporting"),
    retrievedAt: timestamp("retrieved_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    unique("destination_content_sources_content_source_unique").on(
      table.destinationContentId,
      table.sourceId,
    ),
    index("destination_content_sources_source_id_idx").on(table.sourceId),
    index("destination_content_sources_content_retrieved_idx").on(
      table.destinationContentId,
      table.retrievedAt.desc(),
    ),
    check(
      "destination_content_sources_role_chk",
      sql`${table.sourceRole} in ('primary', 'supporting')`,
    ),
  ],
);

export const trips = pgTable(
  "trips",
  {
    id: uuidPrimaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    originPlaceId: uuid("origin_place_id").references(() => places.id, { onDelete: "set null" }),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    dateFlexibility: jsonb("date_flexibility_json")
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    travelerSummary: jsonb("traveler_summary_json")
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    budget: jsonb("budget_json")
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text("status", { enum: ["draft", "active", "archived"] })
      .notNull()
      .default("draft"),
    visibility: text("visibility", { enum: ["private", "link"] })
      .notNull()
      .default("private"),
    generationState: text("generation_state", {
      enum: ["idle", "queued", "generating", "ready", "failed"],
    })
      .notNull()
      .default("idle"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("trips_owner_slug_unique").on(table.ownerUserId, table.slug),
    unique("trips_id_owner_unique").on(table.id, table.ownerUserId),
    index("trips_owner_updated_id_idx").on(
      table.ownerUserId,
      table.updatedAt.desc(),
      table.id.desc(),
    ),
    index("trips_origin_place_id_idx").on(table.originPlaceId),
    index("trips_owner_status_idx").on(table.ownerUserId, table.status),
    check("trips_title_length_chk", sql`char_length(${table.title}) between 1 and 200`),
    check(
      "trips_slug_format_chk",
      sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(${table.slug}) <= 120`,
    ),
    check("trips_date_order_chk", sql`${table.endDate} >= ${table.startDate}`),
    check(
      "trips_date_flexibility_object_chk",
      sql`jsonb_typeof(${table.dateFlexibility}) = 'object'`,
    ),
    check(
      "trips_traveler_summary_object_chk",
      sql`jsonb_typeof(${table.travelerSummary}) = 'object'`,
    ),
    check("trips_budget_object_chk", sql`jsonb_typeof(${table.budget}) = 'object'`),
    check("trips_status_chk", sql`${table.status} in ('draft', 'active', 'archived')`),
    check("trips_visibility_chk", sql`${table.visibility} in ('private', 'link')`),
    check(
      "trips_generation_state_chk",
      sql`${table.generationState} in ('idle', 'queued', 'generating', 'ready', 'failed')`,
    ),
  ],
);

export const tripDestinations = pgTable(
  "trip_destinations",
  {
    id: uuidPrimaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "restrict" }),
    arrivalAt: timestamp("arrival_at", { mode: "date", precision: 3, withTimezone: true }),
    departureAt: timestamp("departure_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    }),
    orderIndex: integer("order_index").notNull(),
  },
  (table) => [
    unique("trip_destinations_trip_order_unique").on(table.tripId, table.orderIndex),
    unique("trip_destinations_trip_place_unique").on(table.tripId, table.placeId),
    index("trip_destinations_place_id_idx").on(table.placeId),
    check("trip_destinations_order_nonnegative_chk", sql`${table.orderIndex} >= 0`),
    check(
      "trip_destinations_time_order_chk",
      sql`${table.arrivalAt} is null or ${table.departureAt} is null or ${table.departureAt} > ${table.arrivalAt}`,
    ),
  ],
);

export const itineraryDays = pgTable(
  "itinerary_days",
  {
    id: uuidPrimaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    localDate: date("local_date", { mode: "string" }).notNull(),
    timezone: text("timezone").notNull(),
    title: text("title"),
    notes: text("notes"),
    orderIndex: integer("order_index").notNull(),
  },
  (table) => [
    unique("itinerary_days_trip_order_unique").on(table.tripId, table.orderIndex),
    unique("itinerary_days_trip_date_unique").on(table.tripId, table.localDate),
    check("itinerary_days_order_nonnegative_chk", sql`${table.orderIndex} >= 0`),
    check(
      "itinerary_days_timezone_length_chk",
      sql`char_length(${table.timezone}) between 1 and 100`,
    ),
    check(
      "itinerary_days_title_length_chk",
      sql`${table.title} is null or char_length(${table.title}) between 1 and 200`,
    ),
  ],
);

export const itineraryItems = pgTable(
  "itinerary_items",
  {
    id: uuidPrimaryKey(),
    itineraryDayId: uuid("itinerary_day_id")
      .notNull()
      .references(() => itineraryDays.id, { onDelete: "cascade" }),
    placeId: uuid("place_id").references(() => places.id, { onDelete: "set null" }),
    itemType: text("item_type", {
      enum: ["activity", "food", "lodging", "transport", "note"],
    }).notNull(),
    startTime: time("start_time", { precision: 0 }),
    endTime: time("end_time", { precision: 0 }),
    durationMinutes: integer("duration_minutes"),
    estimatedCost: jsonb("estimated_cost_json")
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    transport: jsonb("transport_json")
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    booking: jsonb("booking_json")
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    sourceSnapshot: jsonb("source_snapshot_json")
      .$type<JsonObject>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    confidence: numeric("confidence", { mode: "number", precision: 4, scale: 3 }),
    notes: text("notes"),
    orderIndex: integer("order_index").notNull(),
  },
  (table) => [
    unique("itinerary_items_day_order_unique").on(table.itineraryDayId, table.orderIndex),
    index("itinerary_items_place_id_idx").on(table.placeId),
    check(
      "itinerary_items_type_chk",
      sql`${table.itemType} in ('activity', 'food', 'lodging', 'transport', 'note')`,
    ),
    check("itinerary_items_order_nonnegative_chk", sql`${table.orderIndex} >= 0`),
    check(
      "itinerary_items_time_pair_chk",
      sql`(${table.startTime} is null) = (${table.endTime} is null)`,
    ),
    check(
      "itinerary_items_time_order_chk",
      sql`${table.startTime} is null or ${table.endTime} > ${table.startTime}`,
    ),
    check(
      "itinerary_items_duration_positive_chk",
      sql`${table.durationMinutes} is null or ${table.durationMinutes} > 0`,
    ),
    check(
      "itinerary_items_estimated_cost_object_chk",
      sql`jsonb_typeof(${table.estimatedCost}) = 'object'`,
    ),
    check("itinerary_items_transport_object_chk", sql`jsonb_typeof(${table.transport}) = 'object'`),
    check("itinerary_items_booking_object_chk", sql`jsonb_typeof(${table.booking}) = 'object'`),
    check(
      "itinerary_items_source_snapshot_object_chk",
      sql`jsonb_typeof(${table.sourceSnapshot}) = 'object'`,
    ),
    check(
      "itinerary_items_confidence_range_chk",
      sql`${table.confidence} is null or ${table.confidence} between 0 and 1`,
    ),
  ],
);

export const shareLinks = pgTable(
  "share_links",
  {
    id: uuidPrimaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    tokenHash: bytea("token_hash").notNull(),
    permission: text("permission", { enum: ["view"] })
      .notNull()
      .default("view"),
    expiresAt: timestamp("expires_at", { mode: "date", precision: 3, withTimezone: true }),
    revokedAt: timestamp("revoked_at", { mode: "date", precision: 3, withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("share_links_token_hash_uidx").on(table.tokenHash),
    index("share_links_trip_id_idx").on(table.tripId),
    index("share_links_active_trip_idx")
      .on(table.tripId, table.expiresAt)
      .where(sql`${table.revokedAt} is null`),
    check("share_links_token_hash_length_chk", sql`octet_length(${table.tokenHash}) = 32`),
    check("share_links_permission_chk", sql`${table.permission} in ('view')`),
    check(
      "share_links_expiry_order_chk",
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "share_links_revocation_order_chk",
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const offlinePackages = pgTable(
  "offline_packages",
  {
    id: uuidPrimaryKey(),
    userId: uuid("user_id").notNull(),
    tripId: uuid("trip_id").notNull(),
    version: integer("version").notNull(),
    manifest: jsonb("manifest_json").$type<JsonObject>().notNull(),
    generatedAt: timestamp("generated_at", {
      mode: "date",
      precision: 3,
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { mode: "date", precision: 3, withTimezone: true }),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "offline_packages_trip_owner_fk",
      columns: [table.tripId, table.userId],
      foreignColumns: [trips.id, trips.ownerUserId],
    }).onDelete("cascade"),
    unique("offline_packages_user_trip_version_unique").on(
      table.userId,
      table.tripId,
      table.version,
    ),
    index("offline_packages_trip_id_idx").on(table.tripId),
    index("offline_packages_user_generated_idx").on(table.userId, table.generatedAt.desc()),
    check("offline_packages_version_positive_chk", sql`${table.version} > 0`),
    check("offline_packages_manifest_object_chk", sql`jsonb_typeof(${table.manifest}) = 'object'`),
    check("offline_packages_size_nonnegative_chk", sql`${table.sizeBytes} >= 0`),
    check(
      "offline_packages_expiry_order_chk",
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.generatedAt}`,
    ),
  ],
);

export const applicationJobs = pgTable(
  "application_jobs",
  {
    id: uuidPrimaryKey(),
    type: text("type").notNull(),
    payloadVersion: integer("payload_version").notNull(),
    subjectId: text("subject_id").notNull(),
    requestedByKind: text("requested_by_kind", {
      enum: ["user", "system", "operator"],
    }).notNull(),
    requestedById: text("requested_by_id").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status", {
      enum: [
        "queued",
        "running",
        "retrying",
        "succeeded",
        "cancelled",
        "dead_lettered",
        "discarded",
      ],
    })
      .notNull()
      .default("queued"),
    payload: jsonb("payload_json").$type<JsonObject>().notNull(),
    result: jsonb("result_json").$type<JsonObject>(),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    notBefore: timestamp("not_before", { mode: "date", precision: 3, withTimezone: true }),
    startedAt: timestamp("started_at", { mode: "date", precision: 3, withTimezone: true }),
    completedAt: timestamp("completed_at", { mode: "date", precision: 3, withTimezone: true }),
    errorCode: text("error_code"),
    errorSummary: text("error_summary"),
    releaseSha: text("release_sha"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("application_jobs_idempotency_key_uidx").on(table.idempotencyKey),
    index("application_jobs_status_updated_idx").on(table.status, table.updatedAt.desc()),
    index("application_jobs_subject_created_idx").on(table.subjectId, table.createdAt.desc()),
    index("application_jobs_type_status_idx").on(table.type, table.status),
    check(
      "application_jobs_type_version_chk",
      sql`${table.type} ~ '^[a-z][a-z0-9_.-]+\\.v[1-9][0-9]*$'`,
    ),
    check("application_jobs_payload_version_positive_chk", sql`${table.payloadVersion} > 0`),
    check("application_jobs_payload_object_chk", sql`jsonb_typeof(${table.payload}) = 'object'`),
    check(
      "application_jobs_result_object_chk",
      sql`${table.result} is null or jsonb_typeof(${table.result}) = 'object'`,
    ),
    check("application_jobs_attempt_nonnegative_chk", sql`${table.attempt} >= 0`),
    check("application_jobs_max_attempts_positive_chk", sql`${table.maxAttempts} > 0`),
    check("application_jobs_attempt_limit_chk", sql`${table.attempt} <= ${table.maxAttempts}`),
    check(
      "application_jobs_requested_by_kind_chk",
      sql`${table.requestedByKind} in ('user', 'system', 'operator')`,
    ),
    check(
      "application_jobs_status_chk",
      sql`${table.status} in ('queued', 'running', 'retrying', 'succeeded', 'cancelled', 'dead_lettered', 'discarded')`,
    ),
  ],
);

export const jobOperatorActions = pgTable(
  "job_operator_actions",
  {
    id: uuidPrimaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => applicationJobs.id, { onDelete: "restrict" }),
    replacementJobId: uuid("replacement_job_id").references(() => applicationJobs.id, {
      onDelete: "set null",
    }),
    operatorId: text("operator_id").notNull(),
    action: text("action", { enum: ["redrive", "discard"] }).notNull(),
    reason: text("reason").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("job_operator_actions_job_created_idx").on(table.jobId, table.createdAt.desc()),
    check("job_operator_actions_action_chk", sql`${table.action} in ('redrive', 'discard')`),
    check(
      "job_operator_actions_reason_length_chk",
      sql`char_length(${table.reason}) between 1 and 500`,
    ),
  ],
);

export const coreTables = {
  applicationJobs,
  destinationContent,
  destinationContentSources,
  freshnessPolicies,
  itineraryDays,
  itineraryItems,
  jobOperatorActions,
  offlinePackages,
  placeProviderIds,
  places,
  shareLinks,
  sources,
  travelProfiles,
  tripDestinations,
  trips,
  users,
} as const;
