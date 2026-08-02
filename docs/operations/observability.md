# Observability and first response

Roavia emits newline-delimited, content-free structured logs and portable
OpenMetrics signals from the API and worker composition roots. The canonical
dashboard is `ops/observability/dashboard.json`; alert thresholds and ownership
are in `ops/observability/alerts.json`.

## Privacy and retention boundary

- Raw application logs and traces retain at most 30 days. Set
  `OBSERVABILITY_RAW_RETENTION_DAYS` to a value from 1 to 30 and configure the
  external log processor to the same or shorter window.
- Aggregated metrics retain at most 395 days by default. They use coarse route,
  operation, provider, job type, status, and normalized error labels only.
- Logs and metric labels exclude account identity, emails, exact travel dates,
  coordinates, prompts, responses, notes, credentials, tokens, provider
  payloads, and full request paths. Unknown logger fields are discarded and
  secret/date/email patterns are redacted.
- `OBSERVABILITY_METRICS_TOKEN` is server-only, contains at least 32 characters,
  and protects the API's `/internal/metrics` endpoint. Never use a
  `NEXT_PUBLIC_*` variable for it.

The selected deployment baseline is Render, not Vercel. Configure Render service
logs, health checks, and failure notifications first. A metrics collector may
scrape `/internal/metrics`, while worker metrics can be derived from the same
structured lifecycle events or exported through an approved OpenTelemetry-
compatible collector. Production provisioning and notification destinations
remain part of WDL-55.

## Correlation workflow

1. Start with the request ID shown to the user or returned in `x-request-id`.
2. Search structured logs by `correlationId`; API entries also include a W3C
   `traceId`, coarse route, release SHA, status, duration, and normalized error.
3. Follow the same correlation ID into `application_jobs` and worker lifecycle
   events. Use `jobId` and job `type` to inspect retries or dead letters.
4. For provider or AI failures, filter the same correlation ID by `provider`,
   `operation`, `outcome`, and `errorCode`. Never copy trip content into an
   incident channel.

## API server errors

Check affected coarse routes, release SHA, normalized error codes, and database
health. Roll back a newly introduced release when errors correlate with it. If
only a dependency path fails, keep unaffected routes available and use the
documented safe unavailable response.

## Job retry storm

Group retries by job type and error code, verify dependency health, and pause the
affected queue if retries amplify an outage. Do not redrive until the failure is
classified and the current payload schema, authorization, and side effects have
been revalidated.

## Job dead letter

Inspect the content-free dead-letter record, normalized error, attempts, release,
and correlation chain. Fix or confirm the dependency first. Redrive or discard
only through the authenticated operator path with a recorded reason.

## Job queue age

Verify worker readiness, database connectivity, scheduler registration, and
queue polling. Compare queue depth with processing duration. Restart a failed
worker only after determining whether in-flight work will be reclaimed safely.

## Provider unavailable

Identify provider and operation, then check timeout, circuit, fallback, and
credential state. Preserve stale data only within the approved freshness policy;
otherwise return explicit unavailability rather than unsupported guidance.

## Provider quota

Check remaining quota, reset time, request rate, and whether an approved fallback
exists. Do not bypass licensing or semantic-equivalence gates. Reduce noncritical
refresh traffic or request a reviewed quota increase.

## Stale data growth

Group stale events by data class and operation. Check source update cadence,
cache revalidation failures, and worker scheduling. High-stakes stale data must
remain visibly stale or unavailable and must not be refreshed by AI inference.

## AI generation errors

Check provider health, normalized error, model, prompt version, latency, and cost
coverage. Keep raw prompts and responses out of logs. Use deterministic fixtures
to reproduce schema, safety, or grounding failures.

## AI validation failures

Compare prompt/model release changes, validation issue counts, and repair
outcomes. Run `pnpm ai:evaluate` before accepting a changed model, prompt,
validator, or repair policy.

## AI unpriced generation

Set both current server-side model rates,
`AI_INPUT_COST_PER_MILLION_USD` and
`AI_OUTPUT_COST_PER_MILLION_USD`. Treat missing price coverage as release risk;
never record unknown cost as zero.

## AI cost budget

Group cost by operation and provider, confirm pricing configuration and traffic
volume, then review model/routing changes. Do not reduce safety, validation, or
grounding merely to satisfy a cost threshold.

## Offline generation errors

Correlate the API request with package generation duration and normalized error.
Check trip revision churn, source licensing, active-place requirements, database
health, and package size. The existing saved itinerary must remain available and
the UI must offer an actionable retry after the underlying condition clears.

## Verification

Run the observability fixtures and affected checks:

```bash
pnpm --filter @roavia/observability test
pnpm check:affected
```

The fixtures inject API, provider, job, AI, stale-data, and offline failures,
then verify content-free logs, metric increments, alert matches, authenticated
metrics export, and request-to-job correlation.
