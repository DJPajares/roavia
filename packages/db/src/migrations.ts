import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const MIGRATION_LOCK_KEY = 221_019;
const MINIMUM_POSTGRES_VERSION = 170_000;

export const defaultMigrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

async function assertSupportedPostgres(client: Client): Promise<void> {
  const result = await client.query<{ server_version_num: string }>("show server_version_num");
  const version = Number(result.rows[0]?.server_version_num);

  if (!Number.isInteger(version) || version < MINIMUM_POSTGRES_VERSION) {
    throw new Error("Roavia migrations require PostgreSQL 17 or newer.");
  }
}

async function runMigrations(client: Client, migrationsFolder: string): Promise<void> {
  await assertSupportedPostgres(client);
  await migrate(drizzle({ client }), { migrationsFolder });
}

async function withMigrationLock(
  connectionString: string,
  operation: (client: Client) => Promise<void>,
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await operation(client);
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
}

export async function migrateDatabase(
  connectionString: string,
  migrationsFolder = defaultMigrationsFolder,
): Promise<void> {
  await withMigrationLock(connectionString, (client) => runMigrations(client, migrationsFolder));
}

export function assertSafeTestDatabaseUrl(connectionString: string): URL {
  const url = new URL(connectionString);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  const localHosts = new Set(["127.0.0.1", "::1", "localhost"]);

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("TEST_DATABASE_URL must use the postgres or postgresql protocol.");
  }

  if (!localHosts.has(url.hostname)) {
    throw new Error("Test database reset is restricted to localhost.");
  }

  if (!databaseName.endsWith("_test")) {
    throw new Error("Test database reset requires a database name ending in _test.");
  }

  return url;
}

export async function resetAndMigrateTestDatabase(
  connectionString: string,
  migrationsFolder = defaultMigrationsFolder,
): Promise<void> {
  const expectedDatabase = decodeURIComponent(
    assertSafeTestDatabaseUrl(connectionString).pathname.slice(1),
  );

  await withMigrationLock(connectionString, async (client) => {
    const result = await client.query<{ current_database: string }>("select current_database()");
    if (result.rows[0]?.current_database !== expectedDatabase) {
      throw new Error("Connected database does not match TEST_DATABASE_URL.");
    }

    await client.query("begin");
    try {
      await client.query("drop schema if exists jobs cascade");
      await client.query("drop schema if exists drizzle cascade");
      await client.query("drop schema if exists public cascade");
      await client.query("create schema public");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    await runMigrations(client, migrationsFolder);
  });
}
