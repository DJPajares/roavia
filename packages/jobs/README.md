# Roavia job runtime

`@roavia/jobs` owns Roavia's versioned job envelopes, reliability policies, operator recovery contract, deterministic contract runtime, and isolated `pg-boss` adapter. Feature packages import the root package only; only the worker composition root imports `@roavia/jobs/pg-boss`.

## Contract

Every job carries a versioned allowlisted type, opaque job ID, deterministic idempotency key, subject ID, auditable requester, correlation ID, payload version, optional defer time, and non-sensitive trace context. Payload schemas are validated when enqueued and immediately before handling.

Policies are declared per job type and bound retry count, exponential backoff, jitter, timeout, concurrency, retention, cancellation checkpoints, and dead-letter destination. Infinite retry is not supported.

## Local worker

Apply the checked-in migrations and start the worker against local PostgreSQL:

```bash
pnpm db:migrate
pnpm dev:worker
```

The worker requires `DATABASE_URL` but no Render, provider, or production queue credentials. The `jobs` PostgreSQL schema is generated from the pinned `pg-boss` version and applied through the same reviewed Drizzle migration gate as product tables. Runtime schema creation and migration are disabled.

Regenerate the SQL only when intentionally upgrading `pg-boss`, then review it as a database migration:

```bash
pnpm --filter @roavia/jobs schema:generate
```

## Idempotency and failure handling

- Reserve `application_jobs.idempotency_key` and submit the queue job in one Drizzle transaction.
- Return the existing application job when a producer repeats the same key.
- Make each handler side effect independently idempotent; queue delivery alone is not exactly once.
- Retry normalized transient failures with bounded backoff.
- Dead-letter permanent failures and exhausted retries with redacted context.
- Abort cancellation at safe handler checkpoints and preserve user-authored state.
- Recover interrupted leases through `pg-boss`; the deterministic runtime exposes `recoverInterrupted()` for contract tests.

## Destination catalog refresh

`destination.catalog-ingest.v1` accepts only the approved `mvp-launch-v1`
catalog and `seed` or `refresh` mode. The worker registers the job with
single-job concurrency and a bounded five-minute timeout. Its database handler
uses stable provider record identities and preserves reviewed editorial content,
so both queue redelivery and scheduled refresh are safe to repeat. Producers
should use an idempotency key that includes the catalog key and source revision or
refresh window, for example `destination:mvp-launch-v1:refresh:2026-07-28`.

## Itinerary generation

`itinerary.generate.v1` carries only the generation-run ID, trip ID, and immutable
trip revision. `enqueueItineraryGeneration()` first creates owner-scoped product
state, submits an idempotent job keyed by trip revision, and marks the run failed
if queue reservation fails. The worker handler delegates to the provider-neutral
generation service and returns only run/attempt counts; prompts, traveler fields,
grounding content, and generated itinerary data never enter the queue payload or
job result.

Generation stages and repair attempts live in the product database. Provider and
retrieval calls happen outside database transactions, while a validated draft is
rechecked and replaced atomically at persistence time. A concrete AI adapter must
be injected at the worker composition root; provider credentials never belong in
job definitions or API clients.

## Operator recovery

`listJobs()` provides a bounded, status-filtered view of queued, running, retrying, and dead-lettered application records without exposing queue tables. `listDeadLetters()` returns terminal failure metadata. `redrive()` revalidates the current payload schema and creates a new job ID/idempotency key. `discard()` marks the application record terminal. Both recovery operations require an operator ID and reason and append an immutable `job_operator_actions` audit record.

Structured telemetry contains job, type, subject, correlation, attempt, release, outcome, and timing fields. It excludes payloads, prompts, coordinates, travel dates, credentials, provider responses, and free text.
