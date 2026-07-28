# MVP launch destination catalog and content standards

- Linear issue: [WDL-57](https://linear.app/wwonderland/issue/WDL-57/define-the-mvp-launch-destination-catalog-and-content-standards)
- Decision date: 2026-07-28
- Status: Approved MVP catalog and content standard; not an ingestion, provider,
  procurement, or public-launch approval
- Accountable owner: Darwin Jason Pajares
- Editorial owner: Darwin Jason Pajares until a dedicated destination-content
  owner is named
- Review trigger: provider-coverage failure, a material licensing change, a
  safety or accessibility correction, or a proposed catalog expansion

## Decision

Roavia's English-language MVP catalog is a curated set of seven city
destinations across seven countries. It deliberately covers contrasting
weather, seasonality, budget, accessibility, hierarchy, localization, and
route-planning conditions without claiming worldwide coverage.

| Country       | Supported destination | Canonical hierarchy                                            | Why it belongs in the MVP                                                                                        | Release scenario                                                                 |
| ------------- | --------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Singapore     | Singapore             | Country → city-state → district → place                        | Tropical weather, city-state hierarchy, regional holidays, and a compact urban itinerary.                        | Tropical forecast, official authority links, walking/driving estimates.          |
| Japan         | Tokyo                 | Country → prefecture/metropolis → city → ward/district → place | Non-Latin names, dense POIs, long cultural-content review paths, and high route complexity.                      | English UI with preserved Japanese names; district and dense-place search.       |
| France        | Paris                 | Country → region → city → arrondissement/district → place      | Historic pedestrian routes, multilingual names, cultural media, and seasonal crowd tradeoffs.                    | Walking-first route estimate, source attribution, and weather/crowd explanation. |
| United States | New York City         | Country → state → city → borough/district → place              | Large North American hierarchy, high POI volume, accessibility variation, and driving-versus-walking comparison. | Borough hierarchy, alternate route modes, and high-volume search fixture.        |
| Australia     | Sydney                | Country → state → city → district → place                      | Southern Hemisphere seasons, coastal conditions, and a long-haul planning context.                               | Reverse-season calendar, coastal weather, and trip-duration context.             |
| Iceland       | Reykjavík             | Country → capital region → city → place                        | Sparse and weather-sensitive routing, pronounced seasonality, and a high-cost planning case.                     | Weather disruption/stale-data state and sparse-result handling.                  |
| Thailand      | Bangkok               | Country → province → city → district → place                   | Southeast Asian budget variation, tropical monsoon conditions, and a second non-Latin place-name path.           | Budget-range comparison, Thai name preservation, and monsoon-season explanation. |

`Country`, `region`, `city`, `district`, and `place` are supported hierarchy
levels. Region and district records exist only where they make a city easier to
browse or route; they are not a promise of comprehensive statewide, provincial,
or neighborhood coverage. A `place` is a reviewed itinerary candidate, venue,
landmark, transport node, or practical-service location—not every provider POI.

The initial release does not claim transit routing, real-time availability,
booking, a complete city guide, translated editorial copy, or visa eligibility.
The product language is English; canonical and alternate local-language names
must be retained and displayed where supplied.

## Catalog boundaries and release gates

The launch cohort is a decision, not a substitute for source and content
review. A destination can be displayed only when it passes every applicable
gate below.

| Gate                     | Required evidence                                                                                                                                             | Default when the gate fails                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Hierarchy                | Stable country, region where applicable, city, district where shown, and place IDs; coordinates, time zone, locale, provenance, and a visible canonical name. | Hide the unresolved record; do not infer a parent or coordinates.                    |
| Editorial                | Reviewed overview, practical basics, transport orientation, accessibility note or explicit `unknown`, source citations, and a last-reviewed date.             | Publish no editorial summary; show only licensed base metadata if useful.            |
| Seasonal                 | Current-condition path, climate/seasonality path, source/freshness fields, and a human-readable tradeoff explanation.                                         | Mark seasonal content unavailable rather than presenting a generic "best" period.    |
| Routes/maps              | Licensed map display and forward/reverse geocoding plus walking and driving estimates for the city.                                                           | Preserve the address and coordinates; do not claim a route or show unlicensed tiles. |
| Holidays/events          | National holidays plus applicable local-holiday coverage and one official destination, venue, municipal, or tourism calendar.                                 | Link the authority/calendar; do not synthesize an event schedule.                    |
| Safety, entry, emergency | Official advisory, police, fire, ambulance, consular, and visa/entry source links with retrieval or review dates.                                             | Show the official link and an unavailable/stale state; do not replace it with prose. |
| Currency                 | Dated planning-rate path for SGD, JPY, EUR, USD, AUD, ISK, and THB, or an explicit unavailable state.                                                         | Do not calculate a conversion.                                                       |
| Media and offline        | Asset-level creator, source, license, attribution, modification, and offline-rights metadata.                                                                 | Use an owned/approved fallback or no image; exclude it from offline packages.        |

The [provider matrix](./travel-data-provider-matrix.md) identifies plausible
licensed paths for every cohort member: FSQ OS Places with GeoNames hierarchy;
curated official/municipal editorial; a licensed managed-map or approved
self-hosted route path; paid Open-Meteo pending privacy approval; official
holiday/event calendars; official high-stakes links; ECB rates for the listed
currencies; and reviewed first-party or Wikimedia Commons media. These are
coverage hypotheses for WDL-59 and WDL-61 to validate with fixtures. They do
not approve a provider contract, a production key, or offline map delivery.

## Required and optional content

Every stored field carries source URL, provider/source ID where available,
retrieved/published/valid/expiry timestamps, license/attribution, locale,
quality state, and offline permission as required by
[ADR 0003](../architecture/decisions/0003-provider-integration-boundaries.md).
Unknown is a valid value; content must never fill a missing fact with an
assumption.

| Place type            | Required before display                                                                                                                                                                                                                                                     | Optional only when sourced and reviewed                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Country               | Canonical and local name; ISO country code; hierarchy position; default currency and languages; official travel/entry and advisory links; emergency-link directory; country-level holiday source; source/freshness metadata.                                                | Customs summary, practical money guidance, roaming/transport orientation, country media, featured seasons.                       |
| Region                | Canonical/local name; parent country; stable ID; geometry or approved reference; time zone where different; source/freshness metadata.                                                                                                                                      | Overview, regional accessibility notes, seasonality, local holiday/event links, media, featured collections.                     |
| City/destination      | Canonical/local name; parent hierarchy; coordinates/time zone; reviewed overview; practical transport orientation; currency/language context; climate/seasonality summary; official safety, entry, and emergency links; licensed route/map path; source/freshness metadata. | Customs, neighborhood guidance, accessibility detail, budget ranges, weather alerts, events, media gallery, itinerary themes.    |
| District/neighborhood | Canonical/local name; parent city; stable ID or approved boundary reference; representative coordinates; source/freshness metadata.                                                                                                                                         | Editorial orientation, accessibility caveats, local transport, events, media, route hints.                                       |
| Place/POI             | Canonical/local name; type/category; parent city and district where known; stable source ID; coordinates; address; time zone; operational status when supplied; official URL when supplied; source/freshness and license metadata.                                          | Hours, phone, pricing, accessibility details, booking requirement, media, editorial note, seasonal relevance, route constraints. |

Each city needs a minimum reviewed set of 25 itinerary-ready places across
culture, food, outdoors, practical services, and transport/arrival context
before it can be called launch-ready. That threshold is a quality floor, not a
promise that each category has equal representation or that every place is
open, accessible, or suitable for every traveler.

## Editorial, source, and trust standard

Roavia content must distinguish researched editorial guidance from time-sensitive
facts and from AI suggestions. A citation is required for every factual,
time-sensitive, safety, visa, emergency, price, opening-hours, event, weather,
or accessibility claim.

| Trust tier                              | Permitted sources and use                                                                                                                             | Restrictions                                                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — official authority                  | Government, embassy/consulate, emergency service, municipal agency, public transport authority, meteorological authority, and statutory tourism body. | Required for entry, safety, emergency, closure, and official alert links. Never paraphrase a high-stakes rule without its source and freshness. |
| 2 — official operator                   | Venue, museum, park, airport, railway, event organizer, or accommodation operator.                                                                    | May support practical facts such as hours, access, events, and route endpoints; retain the official URL and review date.                        |
| 3 — licensed structured source          | Approved provider adapters and open-data releases with recorded terms, attribution, and freshness.                                                    | Validate into normalized contracts. Do not treat provider data as an authority for visa, safety, or emergency matters.                          |
| 4 — reviewed editorial/community source | Licensed first-party editorial, academic/nonprofit reference, or legally approved share-alike source.                                                 | Use for context only. Preserve attribution and derivative-work obligations; never use it as the sole high-stakes source.                        |
| Not eligible                            | Unattributed summaries, unsourced social posts, user reviews, scraped copy, or provider data with unknown reuse rights.                               | Do not ingest into the curated catalog or send as grounded fact to the assistant.                                                               |

Wikivoyage text remains link-only until legal and editorial approval defines an
attribution and share-alike design. Third-party images remain unpublished until
per-asset rights and offline permissions are verified. Provider-specific facts
do not appear in client code; the normalized source/freshness contract remains
the boundary.

## Freshness, review, and offline standard

The provider matrix's cache policy sets the maximum technical freshness. This
catalog adds the human review cadence and presentation rule.

| Content class                             | Editorial review cadence                                                                                         | Triggered review                                                                            | Offline rule                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Hierarchy and place base                  | Quarterly for launch records; monthly source delta ingestion once implemented.                                   | Merge, closure, source-ID change, or quality dispute.                                       | Include only records whose source chain permits redistribution; show last verified time.                  |
| Destination editorial and accessibility   | At least every 12 months.                                                                                        | Correction, policy change, community/official correction, or material accessibility update. | Include reviewed, static guidance and citations; mark time-sensitive details separately.                  |
| Seasonality and climate                   | Before each relevant season and at least every 12 months.                                                        | Model/source revision or material climate/event change.                                     | Include static explanation only; live forecast is unavailable or stale offline.                           |
| Hours, routes, closures, events, holidays | Follow the matrix's provider/authority cache windows; manually re-check a saved event 72 hours before it occurs. | Official change, cancellation, or a planned-visit context.                                  | Do not include restricted/live payloads by default. Show source, as-of date, and stale/unavailable state. |
| Advisory, visa, and emergency links       | Monthly link check; official feed checks follow the matrix's hourly maximum once integrated.                     | Authority alert or broken/changed official source.                                          | Include only lawful snapshots and the official links; high-stakes summaries become stale after six hours. |
| Currency                                  | Daily after provider publication.                                                                                | Provider correction or a two-business-day stale threshold.                                  | Include dated planning estimates only, with attribution and an informational-use warning.                 |
| Media                                     | At ingestion and before every publication.                                                                       | Takedown, license, attribution, or rights change.                                           | Include only assets with explicit offline rights and a frozen attribution manifest.                       |

An offline package contains approved static destination guidance, contacts,
addresses, coordinates, citations, and licensed media only. It never implies
that weather, routes, availability, prices, visa rules, alerts, or events are
current while disconnected.

## Scenario coverage

The cohort is intentionally a product and evaluation set, not a marketing
ranking. Before a city is released, its fixture and review set must demonstrate
the corresponding scenario without relying on unexplained scores or color-only
signals.

| Scenario                                  | Destinations                                                       | Evidence expected                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Tropical and monsoon seasonality          | Singapore, Bangkok                                                 | Forecast/climate distinction, rain/heat tradeoff copy, official severe-weather link, and stale/offline states.                        |
| Northern and Southern Hemisphere contrast | Tokyo, Paris, New York City, Reykjavík, Sydney                     | Month/date explanations that respect local time zone and season rather than one global "best time" label.                             |
| Dense hierarchy and localization          | Tokyo, New York City, Bangkok                                      | Local-name preservation, a text alternative to map exploration, district hierarchy, and high-result search behavior.                  |
| Pedestrian, driving, and sparse routes    | Paris, New York City, Reykjavík                                    | Walking/driving comparison, duration/confidence labels, unavailable transit state, and no unlicensed offline map assets.              |
| Accessibility and practical planning      | Singapore, Paris, New York City, Reykjavík                         | Explicitly sourced accessibility detail or `unknown`, keyboard/map alternatives, and no unsupported accessibility promise.            |
| Budget range and currency                 | Singapore, Tokyo, Paris, New York City, Sydney, Reykjavík, Bangkok | Dated indicative rates and clearly sourced planning ranges; no transaction-rate claim or invented price.                              |
| Source, licensing, and offline            | All seven                                                          | Provenance visible in fixtures, asset attribution, official-link distinction, and an offline package that omits live/restricted data. |

## Ownership and change process

Darwin Jason Pajares is accountable for the launch catalog until the project
names a separate product owner and editorial owner. The same owner is
responsible for assigning a reviewer who can validate the relevant source tier;
high-stakes links require a reviewer with the appropriate authority/source
knowledge.

1. Propose an addition, correction, merge, or removal in a Linear issue linked
   to the affected destination and source evidence.
2. Record hierarchy, purpose, required fields, source tier, licensing and
   offline rights, locale, freshness policy, accessibility state, and release
   scenario.
3. Review the change against this document, the provider matrix, and ADR 0003;
   legal/editorial approval is required for share-alike text or third-party
   media.
4. Add or update fixtures and source-attribution evidence. A reviewer approves
   publication; a safety, emergency, or visa correction can hide content
   immediately while review continues.
5. Reassess the catalog quarterly. Expansion must preserve the bounded MVP
   rationale and cannot silently turn into worldwide provider coverage.

## Open launch decisions

The seven destination cohort is approved for the MVP catalog standard. These
adjacent decisions remain unresolved and therefore constrain release behavior.

| Decision                                                                          | Accountable owner                                  | Deadline                                              | Default until recorded                                                                                                   |
| --------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Launch jurisdictions, privacy notices, and permitted data regions for public beta | Darwin Jason Pajares                               | 2026-08-14                                            | Use non-production fixtures; do not launch a region or collect precise trip data there.                                  |
| Supported traveler nationalities/residencies for entry guidance                   | Darwin Jason Pajares                               | 2026-08-14                                            | Provide official source links only; do not make personalized visa/entry eligibility claims.                              |
| Production map/geocoding, weather, holiday, and currency contracts and budget cap | Darwin Jason Pajares with platform owner           | Before WDL-59 or WDL-61 enables a production provider | Keep provider fakes or evaluation-only data; do not enable metered keys.                                                 |
| PWA offline map/media rights and attribution presentation                         | Darwin Jason Pajares with legal/editorial reviewer | Before WDL-49 offline-package release                 | Ship addresses, coordinates, and approved static guidance only; exclude map tiles, route payloads, and unapproved media. |
| Japanese and Thai customer-facing localization beyond retained place names        | Darwin Jason Pajares                               | 2026-08-14                                            | English UI and editorial; retain canonical and alternate local names in data.                                            |

## Verification against the PRD and WDL-28

| Requirement                     | Evidence in this decision                                                                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Limited curated destination MVP | Seven named city destinations, explicit hierarchy bounds, a 25-place quality floor, and no worldwide coverage claim.                                                  |
| Destination encyclopedia        | Required country/city/district/place fields cover practical facts, source/freshness metadata, official links, accessibility state, media, and itinerary-ready places. |
| Seasonality and grounding       | Each city maps to a weather, season, budget, accessibility, or route scenario; explanations need sources and cannot present a universal "best" time.                  |
| Offline and trust               | Offline excludes live/restricted data; high-stakes information uses official links and visible stale/unavailable states.                                              |
| Accessibility                   | Accessibility detail must be sourced or marked unknown; all map-dependent scenarios require text and keyboard alternatives.                                           |
| Provider/licensing plausibility | The WDL-28 candidate paths cover every category and selected currency, while production contracts and offline rights remain explicit gates.                           |
| Ongoing curation                | Named accountable/editorial ownership, source tiers, review cadence, correction process, and quarterly catalog review are defined.                                    |
