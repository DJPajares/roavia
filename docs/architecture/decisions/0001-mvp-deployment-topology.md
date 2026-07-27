# ADR 0001: MVP deployment topology

- Status: Accepted for MVP
- Date: 2026-07-27
- Decision owner: Roavia product owner
- Technical owner: Platform owner
- Reversibility: Medium; all selected runtimes use portable Node.js and PostgreSQL interfaces, but moving providers requires infrastructure and operational migration

## Context

Roavia needs a production path for a Next.js PWA, a Hono API, PostgreSQL, scheduled and asynchronous work, provider secrets, logs, migrations, and rollback. It is an early-stage product with a monorepo, a small operating team, sensitive trip data, and an intentionally provider-neutral application architecture.

The first topology should favor operational coherence and portable contracts over edge-specific optimization. It must not make a beta orchestration product or an unvalidated multi-service runtime a foundational dependency.

## Decision

Use one Render project and one product-approved Render region with these independently deployable resources:

| Resource        | Render type            | Responsibility                                                                            | Public access                                             |
| --------------- | ---------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `roavia-web`    | Node web service       | Next.js PWA, server rendering, static assets, browser-facing application                  | Yes                                                       |
| `roavia-api`    | Node web service       | Hono HTTP API, authentication enforcement, synchronous domain operations, job submission  | Yes, authenticated and origin-restricted where applicable |
| `roavia-worker` | Background worker      | Ingestion, refresh, itinerary generation/repair, reconciliation, and offline package jobs | No inbound endpoint                                       |
| `roavia-db`     | Paid Render PostgreSQL | Product records, source metadata, job state, migration history                            | Internal connection only by default                       |

Infrastructure configuration will be represented by one Render Blueprint during WDL-55. Production resources are not provisioned by this ADR.

### Network and trust boundaries

- Run all four resources in the same approved region and use Render private networking for database traffic.
- Give the web application only public configuration. It must not receive `DATABASE_URL`, job-runtime credentials, AI keys, provider keys, or auth-admin credentials.
- The API receives database and synchronous-provider credentials. The worker receives database and background-provider credentials. A secret is shared only when both processes need it.
- Use separate database roles for migrations, API requests, and worker execution. Runtime roles receive only the schema and operation privileges they require; neither runtime role owns production schemas.
- The browser calls the API through the typed API client. Use an explicit application origin allowlist, secure cookies or bearer-token validation as selected by the auth issue, and rate limits on generation and assistant endpoints.
- Disable the default Render subdomain after custom domains are validated if the selected plan supports that control. Until then, treat every public service URL as internet reachable.

## Deploy and release flow

Production auto-deploys are gated on repository CI. WDL-55 should implement this release order with the Render CLI or API and wait for each required step:

1. Run repository checks and security gates.
2. Deploy `roavia-api`; its single pre-deploy command applies reviewed Drizzle SQL migrations.
3. Deploy `roavia-worker` after the API deploy and migration gate succeed.
4. Deploy `roavia-web` after its API compatibility checks succeed.
5. Run health, migration, queue, and primary user-journey smoke checks.

Services must remain backward compatible across one release because Render does not provide an atomic cross-service deployment. Build filters may avoid unrelated deploys, but shared package or contract changes trigger every affected service.

### Database migrations

- Generate and review versioned SQL with Drizzle; do not use schema push as the production release mechanism.
- Exactly one release step owns migration execution. Protect it with a PostgreSQL advisory lock in addition to Drizzle's migration history.
- Apply both application and job-runtime schema changes through that migration role and release gate; application startup must not acquire broad DDL privileges.
- Use expand/contract changes: add compatible structures first, deploy readers/writers, backfill through a bounded job, and remove old structures in a later release.
- A failed pre-deploy command fails the new API deploy and leaves the last successful service running. Worker and web deployment must not proceed.
- Destructive or long-running migrations require a separate runbook, query plan, backup validation, and human approval.

### Rollback and recovery

- Roll web, API, or worker code back to a recent successful Render artifact when the prior version is compatible with the current schema.
- Never automatically run down migrations during service rollback. Prefer a forward fix for schema defects.
- Use paid PostgreSQL point-in-time recovery for data loss. Recovery creates a separate database; validate it before switching environment-scoped connection settings.
- Take a logical export before approved destructive migrations and periodically test restoration. Backups are not complete until a restore has been verified.
- Pause affected job queues before a data restore, then reconcile and deliberately redrive safe jobs after the database switch.

## Secrets and configuration

- Keep secret values in Render environment settings or environment groups, never in `render.yaml`, GitHub logs, client-prefixed variables, or generated bundles.
- Scope configuration by environment and service. Prefer separate groups for non-secret shared runtime values, API-only provider secrets, and worker-only provider secrets.
- Validate required variables at process startup with redacted errors. A process must fail closed when a required secret is absent.
- Rotate provider and database credentials independently. Record ownership and last-rotation time outside the repository in the approved operations system.
- Preview environments use fake or sandbox credentials and isolated empty data stores. They never copy production trip data or production secrets.

## Observability

- Emit newline-delimited structured logs with service, environment, release SHA, request or job correlation ID, operation, duration, outcome, and normalized error code.
- Do not log precise coordinates, travel dates, full assistant prompts, access tokens, provider payloads, share tokens, or user-entered free text by default.
- Use Render's service logs, metrics, health checks, and failure notifications as the baseline. Stream logs and OpenTelemetry-compatible platform metrics to a selected provider when retention or alerting requirements exceed the workspace plan.
- API requests propagate a correlation ID into submitted jobs. Worker events expose queue, job type, attempt, duration, provider operation, and terminal state without exposing sensitive payloads.
- WDL-55 defines alerts and runbooks for unhealthy services, migration failure, queue age, dead-letter growth, database saturation, provider failure, and backup-restore failure.

## Tradeoffs

### Cost assumptions

- Production has a fixed floor of three paid compute services plus paid PostgreSQL. Free instances are excluded because production requires stable runtime behavior and database recovery.
- `pg-boss` avoids a separate paid Redis/Valkey or workflow-service bill for the MVP.
- Start with one instance per service and the smallest paid database that satisfies measured memory, connection, and recovery needs. Scale from evidence rather than forecasted traffic.
- Keep automatic preview environments off by default because each preview can duplicate billable resources. Create a staging environment only when its release value justifies the cost.
- Workspace tier, region, bandwidth, log retention, backup window, and high availability affect the bill. WDL-55 must capture a dated pricing estimate and receive human budget approval before provisioning.

### Local development

- Continue to run Next.js and Hono with the root pnpm commands.
- Add the worker command in WDL-58 and run it against local PostgreSQL; no Render emulator is required.
- Use committed environment-variable names plus uncommitted local values. Provider fakes and deterministic fixtures are the default local path.
- Run generated migrations against an isolated local database before integration tests.

### Scaling

- Scale web, API, and worker compute independently. Increase worker concurrency only after handlers are proven idempotent and provider quotas are enforced.
- Scale PostgreSQL vertically first and monitor connections, CPU, lock delays, storage, and query latency. Add pooling before increasing service fan-out materially.
- Revisit the Postgres-backed queue if queue polling and job tables sustain more than 20% of database capacity, produce material lock delay for transactional queries, or cannot meet the accepted job-start SLO after worker tuning.
- Revisit the single-region topology when product requirements demand multi-region write availability, stricter residency isolation, or a recovery objective the selected database plan cannot meet.

### Vendor lock-in

- Render-specific configuration, deploy APIs, private hostnames, and operational dashboards are the main lock-in points.
- Application processes remain ordinary Node services. PostgreSQL, Drizzle migrations, structured logs, HTTP health checks, and provider contracts remain portable.
- Do not import Render SDKs into domain packages. Infrastructure metadata is read only at composition roots.

## Alternatives considered

### Vercel web plus separate API, jobs, and database providers

Vercel is the strongest Next.js-specific host, but splitting the API, worker, database, and observability across providers adds cross-cloud latency, duplicated secret management, and more failure boundaries. Vercel Services remains beta and Node/Hono services are not yet validated by its current guidance. Vercel Workflow DevKit is also beta. Reconsider this option if Next.js platform features become more valuable than a single operational plane.

### Render Workflows or Vercel Workflow DevKit

Both reduce orchestration code, but both are beta and add workflow-runtime semantics to core product behavior. The MVP uses a portable worker and job contract first. A later ADR may adopt a durable workflow engine for multi-day, human-in-the-loop processes that cannot be expressed safely as bounded jobs.

### AWS managed services

AWS can provide stronger service breadth and fine-grained resilience, but ECS/Lambda, RDS, SQS/EventBridge, IAM, networking, and observability create substantially more provisioning and operating work for the MVP team. Reconsider when compliance, region coverage, or scale justifies that overhead.

## Human approvals still required

- Product and privacy approval of the deployment region and data residency.
- Product approval of the dated monthly cost estimate and workspace tier.
- Product and platform approval of recovery objectives and launch-time PostgreSQL HA.
- Privacy approval of log retention and any external telemetry provider.

## Sources

- [Render: deploy a Next.js app](https://render.com/docs/deploy-nextjs-app)
- [Render: web services](https://render.com/docs/web-services)
- [Render: background workers](https://render.com/docs/background-workers)
- [Render: monorepo support](https://render.com/docs/monorepo-support)
- [Render: infrastructure as code](https://render.com/docs/infrastructure-as-code)
- [Render: deploy steps and pre-deploy commands](https://render.com/docs/deploys)
- [Render: rollbacks](https://render.com/docs/rollbacks)
- [Render: PostgreSQL recovery and backups](https://render.com/docs/postgresql-backups)
- [Render: environment variables and secrets](https://render.com/docs/configure-environment-variables)
- [Render: service metrics](https://render.com/docs/service-metrics)
- [Render: logs](https://render.com/docs/logging)
- [Render: notifications](https://render.com/docs/notifications)
- [Vercel: Services](https://vercel.com/docs/services)
- [Vercel: Workflow](https://vercel.com/docs/workflow)
