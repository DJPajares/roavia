# ADR 0002: PostgreSQL-backed background jobs

- Status: Accepted for MVP
- Date: 2026-07-27
- Decision owner: Platform owner
- Reversibility: High; product code depends on an internal job contract, not `pg-boss`

## Context

Roavia needs asynchronous itinerary generation, provider ingestion and refresh, seasonal computation, weather and closure reconciliation, alerts, and offline package generation. The PRD requires idempotency keys, retries with backoff, dead-letter handling, and operator-visible failure context.

The MVP should avoid a second datastore unless job throughput or isolation proves it is needed. Jobs also need to be created atomically with product state so a committed trip or refresh request cannot lose its corresponding work item.

## Decision

Run a dedicated Node background worker on Render and use `pg-boss` with the same paid PostgreSQL cluster as the application. `pg-boss` supports PostgreSQL-backed queues, transactional creation including a Drizzle adapter, schedules, retries, dead-letter queues, and redrive.

Only an internal job interface may depend on `pg-boss`. HTTP handlers, domain services, provider adapters, and UI packages must not import it directly. WDL-58 will implement the contract and runtime.

Keep queue objects in the job runtime's dedicated PostgreSQL schema. Version its schema through the same single migration gate as application migrations. The API role may submit and inspect permitted job state; the worker role may lease and transition jobs; neither runtime role receives unrestricted schema ownership.

## Job contract

Every submitted job includes this transport-safe envelope:

| Field            | Rule                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `jobId`          | Opaque unique identifier returned to callers and logs                                                             |
| `type`           | Versioned allowlisted job type such as `itinerary.generate.v1`                                                    |
| `idempotencyKey` | Deterministic key derived from operation, aggregate identifier, and input revision—not raw sensitive payload text |
| `subjectId`      | Internal trip, place, offline package, or refresh identifier                                                      |
| `requestedBy`    | User, system schedule, or operator identifier where auditable                                                     |
| `correlationId`  | Propagated request or parent-job identifier                                                                       |
| `payloadVersion` | Schema version validated before enqueue and before execution                                                      |
| `notBefore`      | Optional UTC timestamp for deferred work                                                                          |
| `traceContext`   | Non-sensitive distributed trace linkage when enabled                                                              |

Payloads contain identifiers and immutable input revisions whenever possible. Workers load current authorized data from PostgreSQL. Do not copy full assistant prompts, precise itineraries, access tokens, or provider responses into the queue when an internal record reference is sufficient.

## Submission and idempotency

1. Validate authorization and the versioned payload at the API or scheduler boundary.
2. In one Drizzle transaction, persist the domain state change, reserve a unique application job record by `idempotencyKey`, and submit the `pg-boss` job through its Drizzle transaction adapter.
3. If the key already exists, return the existing job state instead of creating duplicate work.
4. At handler start, read the application job record. Return the prior terminal result when the same input revision already completed.
5. Make each side effect idempotent independently. Use provider idempotency tokens when offered; otherwise persist a durable effect key before or with the local state transition.
6. Persist normalized output and the terminal job transition atomically where possible. If an external side effect has an unknown outcome, reconcile it before retrying.

Queue delivery semantics do not make arbitrary external side effects exactly once. Handlers must remain safe under duplicate delivery, worker loss, timeout, and operator redrive.

## Scheduling

- Register recurring schedules idempotently from version-controlled worker startup code using UTC.
- Scheduled triggers enqueue ordinary versioned jobs; they do not contain separate business logic.
- Derive each scheduled idempotency key from job type and schedule window, for example `destination.refresh.v1:<placeId>:<2026-07-27T00>`.
- Record expected schedule time separately from actual enqueue and start times so delay is observable.
- Use a Render cron job only as a platform-level watchdog or recovery trigger if the worker scheduler cannot meet an accepted SLO; do not maintain two independent primary schedules.

## Failure policy

Each job type declares a reviewed policy in code:

| Failure class                                                                                             | Handling                                                                                                         |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Transient network, timeout, or provider 5xx                                                               | Bounded exponential backoff with jitter                                                                          |
| Provider rate limit                                                                                       | Honor a valid retry-after signal, apply quota-aware backoff, then retry within the job limit                     |
| Invalid payload, unsupported operation, revoked permission, or provider 4xx that cannot succeed unchanged | Fail without retry and dead-letter with a normalized reason                                                      |
| Process crash or expired lease                                                                            | Allow the queue to reclaim the job; the handler's idempotency rules protect side effects                         |
| Unknown external side-effect outcome                                                                      | Move to reconciliation before another side-effect attempt                                                        |
| Product cancellation                                                                                      | Stop at a safe checkpoint, preserve user-authored state, and record cancellation as terminal rather than failure |

Retry limits, timeout, concurrency, and retention are configured per job type. Infinite retries are forbidden. CPU-heavy work uses isolated processors or bounded phases so it cannot starve lease maintenance.

## Dead letters and operator recovery

- Configure a dead-letter queue per operational domain, such as AI generation, travel-data refresh, and offline packaging.
- Preserve source queue, source job ID, job type and version, subject ID, idempotency key, attempts, timestamps, normalized error code, redacted error summary, release SHA, and provider operation.
- Store sensitive diagnostics in access-controlled application records with explicit retention; the dead-letter payload holds only their identifier.
- Alert on the first high-severity dead letter and on count or age thresholds for all queues.
- Redrive is an authenticated operator action. Before redrive, validate the current payload schema, authorization, input revision, provider state, and whether the side effect may already have occurred.
- Record the operator, reason, source dead-letter ID, new job ID, and outcome in the audit trail.
- Never mutate an itinerary merely because a reconciliation or recommendation job succeeded. Persist a proposal and require the product confirmation path.

## Observability requirements

Track queue depth and oldest age, scheduled-versus-enqueued delay, enqueue-to-start latency, run duration, attempts, completion and failure counts, dead-letter count and age, cancellation, provider latency and quotas, and redrive outcomes.

Every structured event includes `jobId`, `type`, `subjectId`, `correlationId`, `attempt`, `releaseSha`, and normalized outcome. Logs exclude raw prompts, coordinates, dates, free text, credentials, and full provider payloads.

The application job record is the user- and operator-facing source for progress. `pg-boss` tables are runtime state and must not be exposed directly through public APIs.

## Shutdown and deployment

- On termination, stop accepting new work and allow bounded in-flight handlers to finish or release safely.
- New handler versions must read the previous payload version for at least one deployment window or provide an explicit migration before deployment.
- Pause affected queues before incompatible migrations, database recovery, or provider credential rotation that cannot overlap safely.
- Worker health requires successful database connectivity, scheduler registration, and queue polling. Readiness must fail when the worker cannot accept work.

## Local development and tests

- Use the same `pg-boss` library against local PostgreSQL; do not substitute an in-memory queue for integration tests.
- Unit tests use an internal fake job port to verify domain behavior without timing.
- Integration tests cover atomic enqueue, duplicate submission, crash/reclaim, retries and backoff, permanent failure, dead-letter metadata, redrive, cancellation, schedule registration, schema-version rejection, and sensitive-log redaction.
- Resilience tests simulate provider timeout, rate limit, invalid response, worker termination, and database reconnect.

## Scaling and extraction trigger

Scale worker instances or concurrency only after measuring provider quotas and database impact. Move the internal job adapter to a dedicated queue datastore or managed durable workflow engine when any of these persist after query, retention, and worker tuning:

- queue polling or job storage materially degrades transactional database SLOs;
- workloads require independent data-plane isolation or a different recovery boundary;
- job-start latency cannot meet the accepted SLO;
- multi-day, human-in-the-loop orchestration requires durable workflow semantics rather than bounded jobs.

Because callers use an internal port and versioned envelopes, that migration does not change domain or transport contracts.

## Alternatives considered

### BullMQ plus Render Key Value

BullMQ is a mature Node queue with retries, backoff, deduplication, and stalled-job recovery, and Render recommends it for Node workers. It adds a second paid persistent datastore and makes atomic domain-write plus enqueue require an outbox. Prefer it when queue throughput or isolation justifies that cost.

### Managed workflow products

Render Workflows and Vercel Workflow DevKit offer durable orchestration but are beta. Inngest, Trigger.dev, and similar products reduce worker operations but add another vendor, execution model, data processor, and cost surface. Reconsider for workflow semantics the portable job layer cannot express safely.

### PostgreSQL outbox with a custom poller

A custom outbox would preserve transactional enqueue but would require Roavia to implement leasing, retries, schedules, dead letters, maintenance, and operational tooling. `pg-boss` provides those primitives behind the same database boundary.

## Sources

- [`pg-boss` project and capabilities](https://github.com/timgit/pg-boss)
- [`pg-boss` jobs and dead-letter metadata](https://timgit.github.io/pg-boss/api/jobs)
- [`pg-boss` workers](https://timgit.github.io/pg-boss/api/workers)
- [Render background workers](https://render.com/docs/background-workers)
- [Render cron jobs](https://render.com/docs/cronjobs)
- [Render one-off jobs](https://render.com/docs/one-off-jobs)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
