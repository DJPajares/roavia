# `@roavia/travel-data`

Provider-neutral travel-data ports and server orchestration contracts.

The package owns normalized success, stale, unavailable, quota, and error
results; source and license metadata; cache/freshness policy; timeouts; bounded
retries; circuit breakers; explicit fallback; and privacy-safe telemetry. It
does not select a concrete provider.

## Boundaries

- Construct concrete adapters with credentials only in API or worker server
  composition roots. Credentials and raw provider errors are absent from the
  adapter request context and telemetry types.
- Validate provider payloads inside each adapter, then return a normalized
  result. The coordinator validates that result again and converts malformed
  output to `invalid_response`.
- Configure fallback explicitly. The acceptance callback must confirm semantic,
  coverage, license, and freshness equivalence; no provider is treated as an
  automatic substitute.
- Cache keys are SHA-256 hashes of provider, operation, selected normalized
  input, locale, and policy version. Raw coordinates, travel dates, and free
  text do not appear in keys or telemetry.
- `evaluationCachePolicies` are conservative WDL-28 fixture defaults, not
  production approvals. Concrete launch integrations must replace them when
  provider terms, coverage, freshness, and budgets are approved.

Import `FixtureTravelDataAdapter` from `@roavia/travel-data/testing` to exercise
success, invalid output, timeout, quota, outage, retry, stale-cache, circuit,
and fallback behavior without live credentials or provider quota.
