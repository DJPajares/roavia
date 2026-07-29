# AI evaluation and cost telemetry

Roavia treats prompt and model changes as release changes. A model response is not
approved for release only because it is schema-valid or receives a high automated
score. The deterministic suite and operational telemetry provide repeatable
evidence for human review; they do not replace product, safety, accessibility, or
destination-domain judgment.

## Deterministic release gate

Run the versioned fixture suite with:

```bash
pnpm ai:evaluate
```

The `roavia-ai-quality` `v1` suite exercises real validation, grounding,
assistant, and repair code without provider calls or quota use. Its cases cover:

- itinerary feasibility, destination relevance, and source grounding
- budget conflicts and family/accessibility constraints
- seasonality evidence selection
- unsupported place/source claims and high-stakes fail-closed behavior
- bounded repair quality
- sourced assistant answers

Every case has a stable case ID and case version. A report has a unique run ID,
suite version, prompt version, provider, model, case scores, latency, estimated
cost, and the thresholds applied to that run. `assertAiEvaluationThresholds`
fails the command and CI when a required score, case count, pricing coverage,
latency budget, or cost budget regresses.

The default gate requires every dimension to score at least `0.8`, an overall
score of `0.85`, no failed or unpriced cases, p95 latency at or below 30 seconds,
and total estimated fixture cost at or below 100,000 micro-USD. A threshold
change is itself a reviewed code change and remains embedded in each report.

## Immutable comparisons

`PostgresAiEvaluationHistoryStore.save()` inserts one report and its case results
in a transaction. It never updates or upserts; reusing a run ID fails. Comparisons
load two retained reports from the same suite version and show score, p95 latency,
and estimated-cost deltas while preserving both prompt and model identities.

Use deterministic fixtures for CI. Provider-backed evaluation runs may use the
same report and history contracts in a controlled environment, but must use
curated non-personal inputs and current model pricing. Do not copy production
prompts, trip details, assistant answers, or provider payloads into evaluation
fixtures or history.

## Production telemetry boundary

The provider-neutral gateway assigns a generation UUID before every model call.
The internal PostgreSQL telemetry sink records only:

- generation UUID and request correlation ID
- operation, provider, model, and prompt version
- outcome, normalized error and safety category
- latency, input/output/total tokens, and estimated micro-USD cost
- normalized itinerary validation issue counts and repair counts
- aggregate assistant action offers, confirmations, cancellations, and failures

The runtime-validated input schemas are strict. Prompts, responses, reasoning,
user or trip IDs, destinations, coordinates, travel dates, profile attributes,
notes, credentials, and provider payloads are not accepted telemetry fields.
Telemetry errors never change a user-facing AI result.

Raw AI telemetry expires after 90 days and is indexed by expiry for an idempotent
prune. Aggregation groups by coarse AI operation and returns request success/error,
latency, token, cost, validation, repair, and assistant acceptance totals. Only
irreversibly aggregated metrics may outlive the raw retention window under
[ADR 0005](../architecture/decisions/0005-sensitive-data-lifecycle.md).

The telemetry and evaluation tables are internal service tables. Row-level
security is enabled, and `PUBLIC`, `anon`, and `authenticated` receive no direct
table privileges or policies.

## Cost configuration

Set both server-only values to the selected model's current public rates:

```text
AI_INPUT_COST_PER_MILLION_USD
AI_OUTPUT_COST_PER_MILLION_USD
```

The calculator converts each token count and USD-per-million rate directly to
micro-USD. Missing pricing does not block product generation, but it increments
the unpriced-generation signal and should be treated as release risk. Update the
values when the model or provider price changes; do not hard-code volatile vendor
prices into prompts or client code.

## Known limitations and required human review

- Deterministic fixtures catch known regressions; they cannot represent every
  destination, culture, accessibility need, family context, or adversarial input.
- Rule-based scores can confirm expected signals, not whether prose is genuinely
  helpful, respectful, or appropriately calibrated for a traveler.
- Provider-backed scores vary with model releases and infrastructure conditions.
  Compare repeated runs and inspect cases rather than approving from one average.
- Estimated cost excludes provider credits, cached-token discounts, taxes, and
  unreported usage. Unpriced calls must remain visible instead of being counted as
  zero-cost calls.
- Assistant confirmation is a coarse acceptance signal. It does not prove that an
  answer was correct, and cancellation does not prove that it was wrong.
- Visa, safety, emergency, and medical cases always require current official-source
  and qualified human review before release.

Before changing a prompt, model, validator, repair rule, or threshold, reviewers
must run the deterministic gate, compare a new immutable report with the accepted
baseline, inspect every failed/regressed case, review cost and latency changes, and
record any accepted limitation or release blocker in Linear.
