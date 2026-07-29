# `@roavia/travel-data`

Provider-neutral travel-data ports and server orchestration contracts.

The package owns normalized success, stale, unavailable, quota, and error
results; source and license metadata; cache/freshness policy; timeouts; bounded
retries; circuit breakers; explicit fallback; and privacy-safe telemetry.
Provider-neutral contracts remain at the root export. Server composition roots
select concrete launch adapters through `@roavia/travel-data/server`.

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

## Launch maps, geocoding, and routes

WDL-59 implements Mapbox as the managed online launch candidate selected by the
provider matrix. Construct it only in an API or worker composition root:

```ts
import { createLaunchMapsProviderBundle, readLaunchMapsConfig } from "@roavia/travel-data/server";

const providers = createLaunchMapsProviderBundle(readLaunchMapsConfig(process.env));
```

- `providers.temporaryGeocoding` sends `permanent=false` and uses a no-cache
  operation.
- `providers.permanentGeocoding` sends `permanent=true` and uses the reviewed
  durable cache policy for Roavia-owned records.
- `providers.routing` normalizes walking, cycling, driving, and traffic-aware
  driving summaries. Route values include distance, duration, mode, retrieval
  time, confidence explanation, availability, source, and attribution.
- `providers.map` returns provider-neutral online map context and required
  attribution. It does not expose the access token or grant offline map rights.
- Public OpenStreetMap tiles and public Nominatim are not production fallbacks.
  A self-hosted fallback must be explicitly deployed, reviewed, and accepted by
  the operation fallback policy.

`MAPS_PROVIDER=mapbox` and `MAPS_API_KEY` are server-only. Recorded fixtures
cover launch-city success, ambiguity, unavailable routes, timeout, quota,
stale-cache revalidation, and explicit fallback without live API usage.

## Launch weather, calendar, advisory, closure, and currency data

WDL-61 adds concrete, server-only launch adapters without enabling a metered
provider by default:

```ts
import {
  createLaunchPracticalDataProviderBundle,
  readLaunchPracticalDataConfig,
} from "@roavia/travel-data/server";

const providers = createLaunchPracticalDataProviderBundle(
  readLaunchPracticalDataConfig(process.env),
);
```

- Open-Meteo forecast and climate adapters request explicit metric units,
  preserve model series independently, and carry CC BY attribution. Paid
  customer keys remain gated on the WDL-28 contract, retention, and budget
  approvals.
- Calendarific holidays are marked provisional, online-only, and use a no-cache
  operation until written storage and redistribution rights exist. Nager.Date
  is not selected automatically as a production fallback.
- GOV.UK Content API advice is official, source-only guidance for GB travelers.
  Other traveler nationalities return `unsupported_coverage` rather than
  inheriting UK-specific advice.
- The reviewed official-source registry supplies event, holiday, closure,
  weather-alert, visa, and emergency links for all seven launch destinations.
  It does not synthesize missing facts.
- ECB daily reference rates cover the seven launch currencies, retain one
  common as-of date, use deterministic decimal cross-rates and half-up minor
  unit conversion, and become unavailable to caching after two business days.

See [the integration runbook](../../docs/integrations/launch-practical-data.md)
for freshness, licensing, configuration, and limitations.

Import `FixtureTravelDataAdapter` from `@roavia/travel-data/testing` to exercise
success, invalid output, timeout, quota, outage, retry, stale-cache, circuit,
and fallback behavior without live credentials or provider quota.
