# Database migration, backup, and recovery runbook

This runbook separates code rollback from data recovery. Service rollback reuses
a prior Render build artifact; it never runs a down migration. Schema defects are
repaired forward unless a reviewed recovery plan explicitly restores a separate
database.

## Normal forward migration

1. Generate and review checked-in Drizzle SQL and metadata. Use expand/contract:
   add compatible structures, deploy readers/writers, backfill with a bounded job,
   and remove old structures only in a later release.
2. Run the migrations from a clean disposable PostgreSQL 17 database, then run
   database integration tests and the full release gates.
3. For destructive or long-running SQL, attach the query plan, lock/runtime
   estimate, logical-export ID, restore-test evidence, and human approval to the
   release decision.
4. The API Render pre-deploy command sets `DATABASE_URL` from the private
   migration-owner URL and runs `pnpm db:migrate`. The migration runner enforces
   PostgreSQL 17, a session advisory lock, and Drizzle migration history.
5. If migration or role rotation fails, Render fails the API deploy and keeps the
   last successful service live. Do not deploy worker or web.
6. After success, `/ready` must prove both database access and queue-schema access
   through the API runtime role before the worker or web deploys.

## Backup before destructive work

Paid Render PostgreSQL provides point-in-time recovery. The current recovery
window is three days on Hobby and seven days on Pro or higher. PITR is the primary
data-loss mechanism, but destructive work also requires a portable logical
export.

1. In Render's database Recovery page, create an on-demand logical export and
   record its ID, timestamp, and expiry. Render retains exports for seven days.
2. Download the archive into approved encrypted operations storage; never commit
   it or copy it into CI artifacts.
3. Restore the archive into a disposable PostgreSQL 17 database with no important
   schemas. Never use `pg_restore --clean` against the live database.
4. Apply the smoke queries below and record the result. A backup is not accepted
   until this restore succeeds.

```sql
select current_setting('server_version_num')::integer >= 170000 as supported;
select to_regclass('public.trips') is not null as product_schema_present;
select to_regclass('public.application_jobs') is not null as job_records_present;
select exists (
  select 1 from information_schema.schemata where schema_name = 'jobs'
) as queue_schema_present;
```

Do not print row contents or counts tied to a person or trip in release evidence.

## Code rollback

Use code rollback only when the prior API/worker/web artifacts are compatible
with the current expanded schema.

1. Stop the release sequence and classify the affected service and release SHA.
2. Roll back web first to remove new browser behavior, then worker to stop new
   background writes, then API. Wait for each Render artifact to become live.
3. Run `pnpm release:smoke` against the rolled-back stack.
4. Keep Render autodeploy disabled. The Render rollback API does not disable it
   automatically.
5. Fix forward, deploy API → worker → web, run smoke, and deliberately re-enable
   normal release operations only after the incident owner approves.

## Point-in-time recovery

PITR creates a separate Render database; it does not overwrite the source.

1. Declare an incident, freeze deployments, and suspend the worker so it stops
   acquiring jobs. If safe, place public services in maintenance mode.
2. Choose a recovery timestamp outside Render's most recent ten-minute exclusion
   and inside the approved RPO window. Create the recovery database in the same
   approved region and protected environment.
3. Validate migrations, runtime roles, product schema, queue schema, retention
   metadata, and non-sensitive invariants on the isolated recovery database.
4. Rotate API and worker runtime credentials for the recovery database. Update
   each service's environment-scoped `DATABASE_URL`; do not expose the migration
   owner to either runtime.
5. Deploy API and wait for `/ready`, then deploy worker and web. Run the full
   production smoke before ending maintenance mode.
6. Reconcile job states. Redrive only idempotent, schema-valid jobs with an
   operator, reason, and audit record; discard unsafe dead letters explicitly.
7. Keep the original database suspended and access-restricted until the incident
   owner closes validation. Delete it only under the approved retention and
   recovery decision.

## Failed restore or recovery

- Do not switch service URLs when validation fails.
- Preserve both the source and failed recovery instance for the bounded incident
  window; restrict operator access and do not copy user data to issue comments.
- Retry from a different valid PITR timestamp or a verified logical export.
- Escalate when neither artifact meets the approved RPO/RTO. Record the exact
  missing recovery evidence and keep the release blocked.

See [Render's current recovery documentation](https://render.com/docs/postgresql-backups)
for platform steps and retention windows.
