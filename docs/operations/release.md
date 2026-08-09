# Production release runbook

Roavia releases one reviewed commit through a protected GitHub `production`
environment into one protected, network-isolated Render environment. The API
deploy owns the migration gate, then the worker and web deploy in that order.
Automatic Render deploys remain disabled because independent service deploys
cannot enforce this sequence.

## Provisioning gate

Do not create a production database, Supabase project, or data-bearing Render
service until each approval below links to a recorded Linear decision:

| Decision                                            | Required owner       | Why it blocks provisioning                                                            |
| --------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| Launch audience and Render region                   | Product and privacy  | Render regions are immutable, and trip dates and locations are sensitive.             |
| Supabase project region                             | Product and privacy  | A Supabase project cannot be moved between regions; migration requires a new project. |
| Monthly ceiling and Render workspace/instance plans | Product              | The topology has three always-on compute services plus paid PostgreSQL.               |
| RPO, RTO, and launch-time PostgreSQL HA             | Product and platform | HA changes the eligible workspace/database plan and cost.                             |
| Raw/aggregate telemetry retention and destinations  | Privacy and platform | Operational exports must retain only approved redacted data.                          |

Copy `ops/release/production.example.json` to an untracked working file, replace
every placeholder, and add the five decision links. The generator rejects
placeholder regions, example domains, stale pricing, budgets below the estimate,
ineligible HA plans, missing alert ownership, and missing Linear approvals.

```bash
pnpm release:blueprint -- \
  --phase foundation \
  --config /secure/path/production.json \
  --output output/render.foundation.yaml
render blueprints validate output/render.foundation.yaml

pnpm release:blueprint -- \
  --phase application \
  --config /secure/path/production.json \
  --output output/render.application.yaml
render blueprints validate output/render.application.yaml
```

Both generated files are mode `0600` and contain no secret values. First review
and sync the foundation artifact; it creates only the protected environment and
private database. After the database is available, copy its internal hostname,
port, and database name from Render and construct the API/worker runtime URLs
with `roavia_api`/`roavia_worker` and the independently generated passwords.
Then sync the application artifact and enter those URLs and matching passwords
when Render prompts for `sync: false` values. Its API pre-deploy command creates
the runtime roles before either process starts. This two-phase flow avoids
placing the migration owner in a running service and avoids guessing a private
hostname before the database exists. Never sync the example file or omit the
region: Render defaults an omitted region to Oregon.

### Dated minimum estimate

As checked on 2026-08-09, the smallest non-free starting topology is estimated
at **USD 28.50/month** before bandwidth, excess pipeline minutes, extra domains,
workspace fees, Supabase, AI, maps, weather, holiday data, or other providers:

- three Starter services at USD 7 each: USD 21.00;
- Basic-256mb PostgreSQL compute: USD 6.00;
- 5 GB PostgreSQL storage at USD 0.30/GB: USD 1.50.

Refresh the estimate against [Render pricing](https://render.com/pricing) within
30 days of generating the Blueprint. Render notes that paid compute is prorated
and PostgreSQL storage is separate; the estimate is a budget floor, not approval.

## Topology and platform settings

The generated Blueprint creates these resources in one explicitly approved
region:

| Resource        | Exposure             | Health/recovery behavior                                                                                              |
| --------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `roavia-api`    | Public custom domain | `/ready` proves PostgreSQL and `pg-boss` access; pre-deploy runs locked Drizzle migrations and runtime-role rotation. |
| `roavia-worker` | No inbound endpoint  | Five-minute graceful shutdown allows bounded handlers to finish or release work safely.                               |
| `roavia-web`    | Public custom domain | `/health` is independent of Supabase and API availability.                                                            |
| `roavia-db`     | Private network only | PostgreSQL 17, paid PITR, storage autoscaling, no public IP allowlist.                                                |

The Render environment must remain protected and network-isolated. Configure the
workspace overlapping-deploy policy to **Wait**. Add and validate the web/API
custom domains and TLS before changing the Render subdomain policy. Set API CORS
to the exact web origin and keep `TRUSTED_PROXY_HOPS=1` for Render's edge proxy.

`pg-boss` schedules run inside the continuously running worker. Do not add a
second Render cron schedule for the same jobs. A cron service is permitted only
as a documented watchdog after a measured scheduler failure.

## Database roles and migrations

The Render database owner is `roavia_migration`. The API pre-deploy command uses
its private connection only to apply reviewed Drizzle SQL and run
`pnpm db:bootstrap:production-roles`. That bootstrap creates or rotates separate
`roavia_api` and `roavia_worker` login roles, grants bounded DML/schema access,
and removes public schema creation.

Render's provider-created database user must retain `CREATEROLE`; the bootstrap
checks this before changing anything. The two runtime roles are created directly
with PostgreSQL, so Render does not list or rotate them in its managed Credentials
panel. This intentionally keeps `roavia_migration` as the Blueprint's default
user and prevents a later Blueprint sync from replacing the migration URL with a
runtime credential.

Set these values together during the first Blueprint creation:

- `MIGRATION_DATABASE_URL` is generated from `roavia-db` and never passed to the
  running Node process.
- `ROAVIA_API_DATABASE_PASSWORD` must match the password embedded in the API's
  runtime `DATABASE_URL`.
- `ROAVIA_WORKER_DATABASE_PASSWORD` must match the worker's runtime
  `DATABASE_URL`.

All three secrets are server-only. Rotate one runtime password and its matching
URL together, deploy API first so the pre-deploy command applies the rotation,
then deploy the affected runtime. Never use `drizzle-kit push` in production.

## Secret and configuration matrix

| Scope                         | Values                                                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Web only                      | `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                                       |
| API only                      | API-role `DATABASE_URL`, migration inputs, Supabase service role, account lifecycle secret, metrics token, synchronous provider keys |
| Worker only                   | Worker-role `DATABASE_URL`, background AI/weather/travel provider keys                                                               |
| GitHub production environment | Render API key/service IDs, public smoke URLs, same metrics smoke token                                                              |

The Supabase publishable key and URL are intentionally browser configuration.
Never use a secret/service-role key in `NEXT_PUBLIC_*`. Configure asymmetric
signing keys and an access-token expiry of 15 minutes. Current Supabase guidance
recommends JWTs remain at least five minutes to avoid refresh and clock-skew
failures; Roavia's shorter-than-default value balances revocation exposure with
that floor. Verify signup redirect origins and both custom domains before launch.

## Alerts and monitoring

Configure Render deploy/service/database failure notifications to every approved
destination recorded in the production config. Map the metrics endpoint into the
dashboard and thresholds in:

- `ops/observability/dashboard.json`
- `ops/observability/alerts.json`
- `docs/operations/observability.md`

Before release, send one test notification to each destination and record the
timestamp and owner in the Linear release evidence. Confirm alerts for unhealthy
services, migration failure, API 5xx, queue age, dead letters, provider failure,
database saturation, unpriced AI usage, and backup/restore failure.

## Release checklist

1. Confirm all five provisioning decisions are current and the dated estimate is
   within the approved ceiling.
2. Confirm provider contracts, budgets, source/freshness rules, and secrets are
   approved; disabled providers must fail closed rather than use production data
   through fixtures.
3. Confirm GitHub's protected `production` environment requires a human reviewer
   and only the release workflow can read its secrets.
4. Confirm the target full SHA is reachable from `main` and these GitHub checks
   passed: formatting/lint/typecheck, tests and AI evaluation, browser resilience,
   production build, repository scan, and CodeQL.
5. Confirm accessibility, resilience, data-freshness, and performance evidence is
   included in those checks. A canceled or waived gate requires an explicit
   release decision; it is never silently treated as evidence.
6. Confirm the latest logical export or PITR window, restore-test timestamp, disk
   headroom, connection saturation, queue age, and dead-letter count.
7. Run the `Release` workflow with the full SHA and `RELEASE` confirmation.
8. The workflow deploys API/migrations, worker, then web and runs authenticated
   web/API/readiness/metrics/PWA smoke checks.
9. For a rollback rehearsal, supply the three prior successful deploy IDs. The
   workflow rolls back web → worker → API, smokes, restores API → worker → web,
   and smokes again. It never runs a down migration.
10. Inspect Render logs for the release SHA and normalized errors without copying
    trip data, prompts, tokens, dates, coordinates, or provider payloads.

## Release evidence

Record the commit, Blueprint validation, migration result, service deploy IDs,
custom domains, alert test timestamps, smoke result, rollback rehearsal result,
PITR/logical-restore evidence, and any waived gate in one Linear completion
comment. If any required stage fails, stop the sequence, keep the previous live
artifact, and follow [database recovery](./database-recovery.md) or the relevant
observability runbook.

Current platform references:
[Blueprint specification](https://render.com/docs/blueprint-spec),
[deploy sequencing](https://render.com/docs/deploys),
[rollbacks](https://render.com/docs/rollbacks), and
[PostgreSQL recovery](https://render.com/docs/postgresql-backups).
