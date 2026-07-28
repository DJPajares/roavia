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

## Operator recovery

`listJobs()` provides a bounded, status-filtered view of queued, running, retrying, and dead-lettered application records without exposing queue tables. `listDeadLetters()` returns terminal failure metadata. `redrive()` revalidates the current payload schema and creates a new job ID/idempotency key. `discard()` marks the application record terminal. Both recovery operations require an operator ID and reason and append an immutable `job_operator_actions` audit record.

Structured telemetry contains job, type, subject, correlation, attempt, release, outcome, and timing fields. It excludes payloads, prompts, coordinates, travel dates, credentials, provider responses, and free text.
