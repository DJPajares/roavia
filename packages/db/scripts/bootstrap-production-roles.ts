import { Client } from "pg";
import { pathToFileURL } from "node:url";

const runtimeRoles = ["roavia_api", "roavia_worker"] as const;

function requireSecret(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value || value.length < 32 || /\s/.test(value)) {
    throw new Error(`${name} must contain at least 32 non-whitespace characters.`);
  }
  return value;
}

export function readProductionRoleConfig(environment: NodeJS.ProcessEnv = process.env) {
  const connectionString = environment.MIGRATION_DATABASE_URL?.trim();
  if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
  const url = new URL(connectionString);
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error("MIGRATION_DATABASE_URL must use PostgreSQL.");
  }
  if (decodeURIComponent(url.username) !== "roavia_migration") {
    throw new Error("MIGRATION_DATABASE_URL must authenticate as roavia_migration.");
  }
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!databaseName || databaseName.includes("/")) {
    throw new Error("MIGRATION_DATABASE_URL must name exactly one PostgreSQL database.");
  }
  const migrationPassword = decodeURIComponent(url.password);
  const apiPassword = requireSecret(environment, "ROAVIA_API_DATABASE_PASSWORD");
  const workerPassword = requireSecret(environment, "ROAVIA_WORKER_DATABASE_PASSWORD");
  if (
    apiPassword === workerPassword ||
    apiPassword === migrationPassword ||
    workerPassword === migrationPassword
  ) {
    throw new Error("Migration, API, and worker database credentials must be independent.");
  }
  return {
    connectionString,
    databaseName,
    passwords: {
      roavia_api: apiPassword,
      roavia_worker: workerPassword,
    },
  };
}

async function grantDatabaseConnect(
  client: Client,
  databaseName: string,
  role: (typeof runtimeRoles)[number],
): Promise<void> {
  const result = await client.query<{ statement: string }>(
    `select format('grant connect on database %I to %I', $1::text, $2::text) as statement`,
    [databaseName, role],
  );
  const statement = result.rows[0]?.statement;
  if (!statement) throw new Error(`Could not prepare database access for ${role}.`);
  await client.query(statement);
}

async function setPassword(client: Client, role: (typeof runtimeRoles)[number], password: string) {
  const result = await client.query<{ statement: string }>(
    `select format('alter role %I with login password %L', $1::text, $2::text) as statement`,
    [role, password],
  );
  const statement = result.rows[0]?.statement;
  if (!statement) throw new Error(`Could not prepare credential rotation for ${role}.`);
  await client.query(statement);
}

async function assertSafeRuntimeRole(
  client: Client,
  role: (typeof runtimeRoles)[number],
): Promise<void> {
  const result = await client.query<{
    rolbypassrls: boolean;
    rolcanlogin: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
    rolreplication: boolean;
    rolsuper: boolean;
  }>(
    `select rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole, rolreplication, rolsuper
       from pg_roles
      where rolname = $1::text`,
    [role],
  );
  const attributes = result.rows[0];
  if (
    !attributes?.rolcanlogin ||
    attributes.rolsuper ||
    attributes.rolcreatedb ||
    attributes.rolcreaterole ||
    attributes.rolreplication ||
    attributes.rolbypassrls
  ) {
    throw new Error(`${role} has unsafe PostgreSQL role attributes.`);
  }
}

export async function bootstrapProductionRoles(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = readProductionRoleConfig(environment);
  const client = new Client({ connectionString: config.connectionString });
  await client.connect();

  try {
    const identity = await client.query<{ current_user: string; rolcreaterole: boolean }>(
      `select current_user, rolcreaterole
         from pg_roles
        where rolname = current_user`,
    );
    if (identity.rows[0]?.current_user !== "roavia_migration") {
      throw new Error("Production role bootstrap requires the roavia_migration database owner.");
    }
    if (!identity.rows[0].rolcreaterole) {
      throw new Error(
        "roavia_migration must be the provider-managed database owner with CREATEROLE.",
      );
    }

    await client.query("begin");
    try {
      for (const role of runtimeRoles) {
        await client.query(
          `do $$ begin
             if not exists (select 1 from pg_roles where rolname = '${role}') then
               create role ${role} login;
             end if;
           end $$`,
        );
        await setPassword(client, role, config.passwords[role]);
        await assertSafeRuntimeRole(client, role);
        await grantDatabaseConnect(client, config.databaseName, role);
        await client.query(`grant usage on schema public, jobs to ${role}`);
        await client.query(
          `grant select, insert, update, delete on all tables in schema public, jobs to ${role}`,
        );
        await client.query(
          `grant usage, select on all sequences in schema public, jobs to ${role}`,
        );
        await client.query(
          `alter default privileges for role roavia_migration in schema public, jobs
             grant select, insert, update, delete on tables to ${role}`,
        );
        await client.query(
          `alter default privileges for role roavia_migration in schema public, jobs
             grant usage, select on sequences to ${role}`,
        );
      }
      await client.query("alter role roavia_api set statement_timeout = '30s'");
      await client.query("alter role roavia_worker set statement_timeout = '5min'");
      await client.query("revoke create on schema public from public");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await bootstrapProductionRoles();
  console.log(
    "Production API and worker database roles are configured without exposing credentials.",
  );
}
