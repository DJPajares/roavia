import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { bootstrapProductionRoles } from "../scripts/bootstrap-production-roles.js";
import { assertSafeTestDatabaseUrl, migrateDatabase } from "../src/migrations.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const databaseName = "roavia_roles_test";
const migrationPassword = "migration-password-for-role-integration-test";
const apiPassword = "api-password-for-role-integration-test-0001";
const workerPassword = "worker-password-for-role-integration-test-0001";

function connectionUrl(username: string, password: string, database = databaseName): string {
  const url = new URL(testDatabaseUrl!);
  url.username = username;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

describeDatabase("production database roles", () => {
  const adminUrl = new URL(testDatabaseUrl!);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(testDatabaseUrl!);
    await admin.connect();
    await admin.query(`drop database if exists ${databaseName} with (force)`);
    await admin.query("drop role if exists roavia_api, roavia_worker, roavia_migration");
    await admin.query(
      `create role roavia_migration login createrole password '${migrationPassword}'`,
    );
    await admin.query(`create database ${databaseName} owner roavia_migration`);

    const migrationUrl = connectionUrl("roavia_migration", migrationPassword);
    await migrateDatabase(migrationUrl);
    await bootstrapProductionRoles({
      MIGRATION_DATABASE_URL: migrationUrl,
      ROAVIA_API_DATABASE_PASSWORD: apiPassword,
      ROAVIA_WORKER_DATABASE_PASSWORD: workerPassword,
    });
  }, 30_000);

  afterAll(async () => {
    await admin.query(`drop database if exists ${databaseName} with (force)`);
    await admin.query("drop role if exists roavia_api, roavia_worker, roavia_migration");
    await admin.end();
  });

  test("gives the API a safe runtime login without schema ownership", async () => {
    const client = new Client({ connectionString: connectionUrl("roavia_api", apiPassword) });
    await client.connect();
    try {
      const result = await client.query<{
        jobs_usage: boolean;
        public_create: boolean;
        rolbypassrls: boolean;
        rolcreatedb: boolean;
        rolcreaterole: boolean;
        rolreplication: boolean;
        rolsuper: boolean;
        statement_timeout: string;
        trips_read: boolean;
      }>(`select
          has_schema_privilege(current_user, 'jobs', 'usage') as jobs_usage,
          has_schema_privilege(current_user, 'public', 'create') as public_create,
          has_table_privilege(current_user, 'public.trips', 'select') as trips_read,
          rolbypassrls,
          rolcreatedb,
          rolcreaterole,
          rolreplication,
          rolsuper,
          current_setting('statement_timeout') as statement_timeout
        from pg_roles
        where rolname = current_user`);

      expect(result.rows[0]).toEqual({
        jobs_usage: true,
        public_create: false,
        rolbypassrls: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolsuper: false,
        statement_timeout: "30s",
        trips_read: true,
      });
    } finally {
      await client.end();
    }
  });

  test("lets the worker use the migrated pg-boss schema", async () => {
    const client = new Client({ connectionString: connectionUrl("roavia_worker", workerPassword) });
    await client.connect();
    try {
      await client.query(
        `select jobs.create_queue(
          'wdl-55.integration.v1',
          '{"policy":"standard","retryLimit":0}'::jsonb
        )`,
      );
      const queue = await client.query<{ name: string }>(
        "select name from jobs.queue where name = 'wdl-55.integration.v1'",
      );
      expect(queue.rows).toEqual([{ name: "wdl-55.integration.v1" }]);
      expect((await client.query("show statement_timeout")).rows[0]).toEqual({
        statement_timeout: "5min",
      });
    } finally {
      await client.end();
    }
  });
});
