import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderBlueprint, validateReleaseConfig } from "./render-blueprint.mjs";

function approval(name) {
  return {
    approvedAt: "2026-08-09T00:00:00.000Z",
    approvedBy: `${name} owner`,
    decisionUrl: `https://linear.app/wwonderland/issue/WDL-55/${name}`,
  };
}

function validConfig() {
  return {
    alertDestinations: [{ channel: "email", label: "release-ops", owner: "platform" }],
    approvals: {
      budget: approval("budget"),
      dataResidency: approval("data-residency"),
      recovery: approval("recovery"),
      supabaseResidency: approval("supabase-residency"),
      telemetry: approval("telemetry"),
    },
    databaseDiskSizeGB: 5,
    databasePlan: "basic-256mb",
    domains: { api: "api.roavia.dev", web: "app.roavia.dev" },
    highAvailability: false,
    monthlyBudgetUsd: 40,
    pricing: {
      checkedAt: new Date().toISOString(),
      estimatedMonthlyUsd: 28.5,
      source: "https://render.com/pricing",
    },
    recovery: { rpoMinutes: 60, rtoMinutes: 240 },
    region: "singapore",
    retention: { aggregatedDays: 395, rawDays: 30 },
    servicePlan: "starter",
    supabaseRegion: "Southeast Asia (Singapore)",
    workspacePlan: "hobby",
  };
}

describe("Render production Blueprint", () => {
  it("fails closed while owner approvals are placeholders", () => {
    assert.throws(
      () => validateReleaseConfig({ ...validConfig(), region: "APPROVAL_REQUIRED" }),
      /placeholder/,
    );
  });

  it("requires the dated estimate to fit inside the approved budget", () => {
    assert.throws(
      () => validateReleaseConfig({ ...validConfig(), monthlyBudgetUsd: 20 }),
      /must cover/,
    );
  });

  it("rejects reserved custom domains", () => {
    assert.throws(
      () =>
        validateReleaseConfig({
          ...validConfig(),
          domains: { api: "api.roavia.test", web: "app.roavia.test" },
        }),
      /owned production hostname/,
    );
  });

  it("keeps secrets out of the generated Blueprint and scopes runtime credentials", () => {
    const blueprint = renderBlueprint(validConfig(), { phase: "application" });

    assert.match(blueprint, /region: singapore/);
    assert.match(blueprint, /autoDeployTrigger: off/g);
    assert.match(blueprint, /healthCheckPath: \/ready/);
    assert.match(blueprint, /key: AUTH_PROVIDER\n\s+value: "supabase"/);
    assert.match(blueprint, /fromDatabase:\n\s+name: roavia-db/);
    assert.match(blueprint, /key: SUPABASE_SERVICE_ROLE_KEY\n\s+sync: false/);
    assert.match(blueprint, /key: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\n\s+sync: false/);
    assert.doesNotMatch(blueprint, /APPROVAL_REQUIRED|secret-value|service-role-value/);
  });

  it("provisions the database before application secrets are required", () => {
    const foundation = renderBlueprint(validConfig(), { phase: "foundation" });

    assert.match(foundation, /name: roavia-db/);
    assert.match(foundation, /user: roavia_migration/);
    assert.doesNotMatch(foundation, /services:|DATABASE_URL|sync: false/);
  });

  it("rejects HA when the workspace and database plans cannot provide it", () => {
    assert.throws(
      () => validateReleaseConfig({ ...validConfig(), highAvailability: true }),
      /high availability requires/,
    );
  });
});
