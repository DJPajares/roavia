# Roavia database baseline

`@roavia/db` owns the PostgreSQL schema, checked-in Drizzle migrations, and database client boundary. PostgreSQL 17 is the minimum supported version.

## Local migration workflow

Copy `.env.example` to `.env` and set `DATABASE_URL` for the database you intend to migrate.

```bash
pnpm db:generate --name=<migration_name>
pnpm db:migrate
```

`db:generate` creates reviewed SQL in `packages/db/drizzle`; generated SQL and Drizzle metadata must be committed together. `db:migrate` uses a session advisory lock so only one migration runner applies migrations at a time.

Never run `drizzle-kit push` against shared or production databases. The checked-in migration history is the deployment source of truth.

## Disposable test database

```bash
pnpm db:test
pnpm db:test:down
```

The first command starts PostgreSQL 17 on port `55432`, destroys and recreates the disposable schemas, applies all migrations, and runs database integration tests. The second command removes the test container and volume.

The reset command reads only `TEST_DATABASE_URL`. It refuses remote hosts and database names that do not end in `_test`, then confirms the connected database name before dropping the `public` and `drizzle` schemas.

## Schema decisions

- All primary keys are database-generated UUIDv4 values. They are opaque at API boundaries and portable across the supported PostgreSQL baseline. Revisit time-ordered UUIDs if measured write volume makes B-tree locality material.
- Audit timestamps are `timestamptz(3)` in UTC. Trip dates are `date`; itinerary item times are local `time` values interpreted using the itinerary day's IANA timezone. `updated_at` is application-maintained so writes remain explicit.
- User ownership starts at `trips.owner_user_id`. Travel profiles belong directly to users; trip destinations, days, items, share links, and offline packages inherit ownership through their trip. Offline packages enforce `(trip_id, user_id)` against the trip owner at the database layer.
- Deleting a user cascades through their profile and trips, including trip-owned children. Catalog places and provenance sources are retained. Removing a referenced destination place is restricted; optional origin, item, and parent-place references become null.
- Every foreign-key access path is indexed. Composite indexes support owner-scoped trip lists and keyset pagination. JSONB has no blanket GIN indexes; add targeted indexes only with a demonstrated query pattern.
- JSONB columns enforce their expected top-level shape. Dates, coordinates, ordering, confidence, status values, and common identifier formats have database checks.
- Share links store only a unique 32-byte SHA-256 token hash in `bytea`. The application must generate a high-entropy raw token, compare hashes, and never log or persist the raw token. Any future algorithm change requires a reviewed migration that adds an explicit algorithm version.
- Exact trip dates and place coordinates are sensitive. The API must authorize owner access before reading them and must not include them in logs or analytics payloads.

## Access and rollback

Migrations must run through a dedicated deployment credential. Runtime services should use a separate least-privilege role with explicit DML grants and no schema-changing privileges. Row-level security is intentionally deferred until the authentication provider and request-scoped database identity are established; API authorization remains mandatory in the meantime.

Use expand/contract migrations and keep old application versions compatible during rollout. Before production migration, take or confirm a recoverable backup and inspect generated SQL for locks or table rewrites.

- If a migration has not been applied, revert its schema change and regenerate the migration.
- If it has been applied anywhere shared, do not edit or delete it. Restore service by rolling forward with a reviewed corrective migration.
- Roll back application code only when the migrated schema remains backward-compatible.
- A destructive database reversal requires a reviewed SQL plan and a verified backup restore path. The automated reset command is exclusively for disposable local/CI databases and is never a production rollback mechanism.
