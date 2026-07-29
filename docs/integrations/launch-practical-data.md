# Launch practical-data integrations

- Linear issue: [WDL-61](https://linear.app/wwonderland/issue/WDL-61/integrate-launch-weather-calendar-advisory-and-currency-providers)
- Provider decision: [WDL-28 matrix](../research/travel-data-provider-matrix.md)
- Launch catalog: [WDL-57 catalog](../research/mvp-launch-destination-catalog.md)
- Boundary: [ADR 0003](../architecture/decisions/0003-provider-integration-boundaries.md)

## Implemented launch paths

| Data                                                              | Concrete adapter                         | Availability and rights boundary                                                                                                                                                                             |
| ----------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Forecast and climate                                              | Paid Open-Meteo customer APIs            | Concrete and fixture-verified, but production remains opt-in until commercial pricing, provider retention, and budget approval are recorded. Data retains Open-Meteo and CMIP6 attribution where applicable. |
| National/subdivision holidays                                     | Calendarific v2                          | Concrete and fixture-verified. Results are provisional, online-only, and not cached because written caching and redistribution rights remain unapproved.                                                     |
| Travel advice                                                     | GOV.UK Content API                       | Official source for travelers using GB guidance only. The adapter preserves official links and update time; it does not generalize the advice to another nationality or residency.                           |
| Event, closure, holiday, weather-alert, visa, and emergency links | Reviewed Roavia official-source registry | Link-only records for all seven launch destinations. Missing records return explicit `unsupported_coverage`; no prose or schedule is synthesized.                                                            |
| Currency                                                          | ECB daily euro reference rates           | No-key official source for AUD, EUR, ISK, JPY, SGD, THB, and USD. Cross-rates are deterministic planning estimates and are never transaction quotes.                                                         |

The provider constructors are available only from
`@roavia/travel-data/server`. Root exports contain normalized contracts and
operations but no provider classes or credentials.

## Server configuration

```text
WEATHER_PROVIDER=open-meteo
WEATHER_API_KEY=<paid customer key after approval>
HOLIDAY_PROVIDER=calendarific
HOLIDAY_API_KEY=<commercial key after approval>
ADVISORY_PROVIDER=govuk
CURRENCY_PROVIDER=ecb
```

`readLaunchPracticalDataConfig` rejects missing, unsupported, or malformed
provider selections. Nothing calls this configuration reader during ordinary
credential-free startup, so the adapters are not silently enabled. Provider
keys must never use a `NEXT_PUBLIC_*` name or be passed to the web workspace.

## Normalization and freshness

| Data              | Normalization                                                                                                  | Technical freshness and stale behavior                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forecast          | Celsius, millimeters, percent, kilometers/hour, WMO code, UV index, destination time zone                      | Fresh 30 minutes, stale-while-revalidate for 90 minutes, hard-limited by the source expiry. Null variables produce `partial`.                                    |
| Climate           | Separate CMIP6 model series in Celsius and millimeters; model disagreement is preserved                        | Durable 30-day cache with 60-day stale-while-revalidate. The historical/model applicability period is separate from retrieval freshness.                         |
| Holidays          | ISO country/subdivision, local date, normalized holiday types                                                  | No technical cache until rights are approved. Dates remain `provisional` and require official-authority verification.                                            |
| Advice            | Authority, official URL, public update time, and topic links                                                   | Fresh one hour and stale for at most five additional hours. Withdrawn content remains explicit.                                                                  |
| Official registry | Authority, reviewed date, locale, category, and official URL                                                   | Weather links expire after one hour; other high-stakes links after six hours; holiday links after 30 days. Refresh still requires checking the linked authority. |
| Currency          | One common ECB as-of date, exact decimal cross-rate, ISO currency, deterministic half-up minor-unit conversion | Daily cache; value is `stale` after two business days and stale values are not cached.                                                                           |

Every success carries provider/source identity, retrieval and applicable-period
metadata, attribution or reuse terms, offline/redistribution flags, trust tier,
availability, warnings, and normalized cost units. Provider errors are reduced
to the shared taxonomy; response bodies, keys, coordinates, exact dates, and
free text are excluded from telemetry.

## Quota, timeout, and fallback behavior

- HTTP 429 becomes a typed `quota` result. Server and malformed responses become
  normalized unavailable or invalid-response results without exposing payloads.
- Provider execution uses bounded timeout, retry, circuit-breaker, cache, and
  stale-while-revalidate behavior from `TravelDataCoordinator`.
- No non-official source may replace visa, safety, emergency, closure, or alert
  guidance.
- Calendarific has no production fallback. Nager.Date remains evaluation-only
  until commercial data, caching, redistribution, and SLA rights are approved;
  quota exhaustion therefore resolves to `no_safe_fallback` when no approved
  source is configured.
- Currency mixing is rejected unless all requested ECB series share the same
  observation date.

## Verification

```bash
pnpm --filter @roavia/travel-data typecheck
pnpm --filter @roavia/travel-data lint
pnpm --filter @roavia/travel-data test
pnpm --filter @roavia/travel-data build
```

Recorded fixtures cover Singapore forecast units, conflicting Sydney climate
models, Tokyo national/local holidays, Thailand GOV.UK advice, all official
registry categories for all seven launch destinations, and ECB rates for every
launch currency. Tests additionally cover stale cache revalidation, timeout,
quota, invalid payload, unsupported nationality, missing rates, source tracing,
credential redaction, and the server-only export boundary. Default tests make
no live calls and consume no provider quota.

## Limitations and human review

- Open-Meteo model output is not an official severe-weather instruction.
- Climate data is model output, not an observation or universal best-time
  recommendation; downstream scoring must compare models and expose uncertainty.
- Calendarific dates must be checked against the named national or subdivision
  authority, especially near travel dates or after a change notice.
- GOV.UK advice applies to GB travelers. Other nationality/residency paths stay
  unavailable until an approved official source is added.
- Official links and emergency contacts require scheduled human link review;
  their presence is not a legal, safety, entry, availability, or response-time
  guarantee.
- ECB rates are informational planning estimates. Never use them for payment,
  settlement, card, merchant, cash-exchange, or guaranteed-price claims.
