import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const databaseResources = [
  "account_deletion_receipts",
  "account_deletion_tombstones",
  "account_exports",
  "ai_evaluation_case_results",
  "ai_evaluation_runs",
  "ai_telemetry_events",
  "application_jobs",
  "assistant_actions",
  "audit_events",
  "destination_content",
  "destination_content_sources",
  "destination_ingestion_quarantine",
  "disruption_recommendations",
  "freshness_policies",
  "itinerary_days",
  "itinerary_generation_attempts",
  "itinerary_generation_runs",
  "itinerary_items",
  "job_operator_actions",
  "live_condition_impacts",
  "offline_packages",
  "place_provider_ids",
  "places",
  "seasonal_insights",
  "share_links",
  "sources",
  "travel_profiles",
  "trip_destinations",
  "trips",
  "users",
] as const;

describe("privacy retention registry", () => {
  test("assigns every database table an owner and lifecycle", async () => {
    const registry = JSON.parse(
      await readFile(
        new URL("../../../ops/privacy/retention-registry.json", import.meta.url),
        "utf8",
      ),
    ) as {
      registryVersion: string;
      stores: {
        activeRetention: string;
        backupDeletion: string;
        deletion: string;
        resources: string[];
        systemOwner: string;
      }[];
    };
    const resources = registry.stores.flatMap((store) => store.resources);

    expect(registry.registryVersion).toBe("2026-07-28.v1");
    expect(new Set(resources).size).toBe(resources.length);
    expect(databaseResources.every((resource) => resources.includes(resource))).toBe(true);
    expect(
      registry.stores.every(
        (store) =>
          store.activeRetention.length > 0 &&
          store.backupDeletion.length > 0 &&
          store.deletion.length > 0 &&
          store.systemOwner.length > 0,
      ),
    ).toBe(true);
  });
});
