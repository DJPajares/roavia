import { describe, expect, test } from "vitest";

import { readProductionRoleConfig } from "../scripts/bootstrap-production-roles.js";

const strongApiPassword = "api-password-with-at-least-thirty-two-characters";
const strongWorkerPassword = "worker-password-with-at-least-thirty-two-characters";

describe("production database role configuration", () => {
  test("requires the dedicated migration owner and independent runtime credentials", () => {
    const config = readProductionRoleConfig({
      MIGRATION_DATABASE_URL:
        "postgresql://roavia_migration:owner-secret@database.internal:5432/roavia",
      ROAVIA_API_DATABASE_PASSWORD: strongApiPassword,
      ROAVIA_WORKER_DATABASE_PASSWORD: strongWorkerPassword,
    });

    expect(config.passwords).toEqual({
      roavia_api: strongApiPassword,
      roavia_worker: strongWorkerPassword,
    });
  });

  test("rejects owner URLs and weak shared runtime credentials", () => {
    expect(() =>
      readProductionRoleConfig({
        MIGRATION_DATABASE_URL: "postgresql://postgres:secret@database.internal:5432/roavia",
        ROAVIA_API_DATABASE_PASSWORD: strongApiPassword,
        ROAVIA_WORKER_DATABASE_PASSWORD: strongWorkerPassword,
      }),
    ).toThrow(/roavia_migration/);

    expect(() =>
      readProductionRoleConfig({
        MIGRATION_DATABASE_URL:
          "postgresql://roavia_migration:owner-secret@database.internal:5432/roavia",
        ROAVIA_API_DATABASE_PASSWORD: "short",
        ROAVIA_WORKER_DATABASE_PASSWORD: strongWorkerPassword,
      }),
    ).toThrow(/32 non-whitespace/);

    expect(() =>
      readProductionRoleConfig({
        MIGRATION_DATABASE_URL:
          "postgresql://roavia_migration:owner-secret-with-at-least-thirty-two-characters@database.internal:5432/roavia",
        ROAVIA_API_DATABASE_PASSWORD: strongApiPassword,
        ROAVIA_WORKER_DATABASE_PASSWORD: strongApiPassword,
      }),
    ).toThrow(/must be independent/);

    expect(() =>
      readProductionRoleConfig({
        MIGRATION_DATABASE_URL: `postgresql://roavia_migration:${strongApiPassword}@database.internal:5432/roavia`,
        ROAVIA_API_DATABASE_PASSWORD: strongApiPassword,
        ROAVIA_WORKER_DATABASE_PASSWORD: strongWorkerPassword,
      }),
    ).toThrow(/must be independent/);
  });
});
