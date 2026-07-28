# Roavia PRD

## 1. Product Summary

**Roavia** is an AI-assisted travel planning and destination intelligence platform with the tagline **“Plan intelligently. Travel confidently.”**

It helps travelers move from a vague trip idea to a practical, editable itinerary by combining structured destination knowledge, seasonal travel guidance, AI itinerary generation, maps, live-condition awareness, collaboration, and offline access to essential trip information.

The MVP is a responsive progressive web application. Native mobile applications may follow after the core planning, offline, and data-quality architecture is validated.

## 2. Problem Statement

Travel planning is fragmented across search engines, maps, booking sites, blogs, weather tools, visa pages, social posts, and personal notes. Travelers must manually reconcile information that changes over time, varies by source, and often lacks context about budget, pace, season, mobility, or personal interests.

Roavia should reduce that fragmentation by turning trustworthy travel information into a coherent plan while making assumptions, sources, freshness, and editable decisions visible to the user.

## 3. Project Shapes

```text
full-stack-product + web-ui + ai-system + data-pipeline + automation-integration
```

## 4. Goals

- Generate useful draft itineraries from structured inputs or natural-language requests.
- Let travelers edit, reorder, replace, remove, and add itinerary items without fighting the AI.
- Provide destination encyclopedia content with source and freshness metadata.
- Explain the best time to visit using weather, seasonality, crowd, pricing, festival, and closure signals.
- Offer travel-assistant answers grounded in Roavia data and approved external sources.
- Support saved trips and selected destination essentials offline.
- Make sharing a trip easy without requiring community features in the MVP.
- Create an architecture that can add booking, native mobile, and community features later.

## 5. Non-Goals

- Booking flights, hotels, tours, or restaurants directly in the MVP.
- Guaranteeing visa eligibility, legal entry, medical safety, or emergency outcomes.
- Replacing official government, airline, accommodation, or emergency sources.
- Building public forums, public reviews, or a social feed in the MVP.
- Supporting every destination and language at launch.
- Fully autonomous real-time replanning without user confirmation.
- Native iOS and Android applications in the initial MVP.

## 6. Users and Jobs To Be Done

### Independent Planner

Wants a fast but customizable itinerary without manually combining dozens of sources.

### Family or Group Organizer

Needs plans that account for traveler count, age ranges, pace, accessibility, interests, and shared decisions.

### Flexible Explorer

Wants alternatives when weather, closures, timing, or energy levels change.

### Destination Researcher

Wants concise, practical, source-aware information before committing to a destination or date.

## 7. Core Use Cases

1. Describe a desired trip in natural language and receive a structured itinerary draft.
2. Create a trip through guided fields such as dates, budget, travelers, interests, pace, and preferred destinations.
3. Review assumptions and warnings before accepting an AI-generated plan.
4. Edit the itinerary by day, time block, place, route, and estimated cost.
5. Replace an activity with a relevant alternative.
6. Browse countries, cities, regions, and points of interest.
7. Compare recommended travel periods and understand the tradeoffs.
8. Ask destination or logistics questions and see sourced answers with freshness indicators.
9. Save a trip for offline access.
10. Share a read-only trip link with friends or family.
11. Receive safe suggestions when weather or known closures affect a saved itinerary.

## 8. MVP Scope

### Included

- Account creation and sign-in.
- User travel profile and preferences.
- Guided trip creation.
- Natural-language itinerary generation.
- Structured, editable itinerary days and items.
- Destination search and detail pages.
- Curated destination knowledge for a limited launch catalog.
- Best-time-to-go calendar and explanations.
- Source attribution and freshness indicators.
- Weather-aware recommendations for saved trips.
- Read-only trip sharing.
- Offline download of itinerary and selected destination essentials.
- Basic cost estimates and currency display.
- Admin/data-maintenance workflow through scripts or protected internal tools.

### Deferred

- Public reviews and ratings.
- Forums and traveler communities.
- Multi-user real-time collaborative editing.
- Direct booking and payment.
- Native mobile applications.
- Continuous autonomous replanning.
- User-generated destination encyclopedia content.

## 9. UX and Interface Requirements

### Primary Navigation

- **Explore** — destination discovery and seasonal inspiration.
- **Trips** — saved, upcoming, shared, and completed trips.
- **Plan** — guided or natural-language trip creation.
- **Assistant** — contextual destination and trip questions.
- **Profile** — preferences, offline downloads, privacy, and account settings.

### Core Screens

#### Home / Explore

- Intent-led entry points rather than a generic search-only page.
- Seasonal destination collections with reasons, not promotional filler.
- Continue-planning and upcoming-trip surfaces for returning users.
- Transparent freshness and source indicators where recommendations depend on time-sensitive data.

#### Trip Creation

- Guided mode and natural-language mode.
- Inputs for dates or flexibility, origin, traveler count, age ranges, budget, pace, interests, mobility/accessibility needs, dietary needs, and must-do/must-avoid preferences.
- A review step showing inferred assumptions before generation.
- Generation progress with meaningful stages and cancellation/retry behavior.

#### Itinerary Workspace

- Day-based timeline with map context.
- Drag/reorder where accessible, with equivalent button controls.
- Add, edit, replace, duplicate, and remove itinerary items.
- Travel-time and distance awareness between consecutive items.
- Cost, duration, booking requirement, opening-hours confidence, and source freshness where available.
- Clear conflicts and warnings without blocking harmless edits.

#### Destination Encyclopedia

- Country, region, city, and place hierarchy.
- Practical information, customs, language, currency, transport, safety, visa-source links, emergency contacts, weather patterns, and accessibility notes.
- High-quality media with licensing metadata.
- Related places, seasonal guidance, and itinerary-ready actions.

#### Best Time Calendar

- Month and date-range views.
- Weather, rainfall, temperature, crowd, price, festival, holiday, and closure signals.
- Concise explanations of tradeoffs.
- No single “best” claim when the answer depends on user priorities.

#### Assistant

- Context-aware questions for a destination or saved trip.
- Sources, freshness, uncertainty, and safety boundaries shown clearly.
- Suggested follow-up actions such as replace activity, save note, or add place.
- No itinerary mutation without explicit user confirmation.

#### Offline

- Download status, last update, estimated size, refresh, and remove controls.
- Offline-safe presentation of itinerary, addresses, notes, emergency information, and selected destination essentials.
- Clear distinction between cached and live information.

### Required States

Every primary flow must define loading, generation, partial, empty, error, stale-data, offline, permission, success, and retry states where applicable.

### Accessibility

- WCAG 2.2 AA target for the web application.
- Keyboard alternatives for drag-and-drop and map-dependent actions.
- Labels above fields and clear validation summaries.
- Sufficient contrast for map overlays, calendar signals, and status indicators.
- Reduced-motion support.
- Text equivalents for visual seasonality and route information.

## 10. Design Read and Direction

```text
Reading this as: a premium consumer travel-planning product for independent and group travelers, with an optimistic editorial and map-led language, leaning toward Tailwind CSS, semantic design tokens, and custom accessible components rather than a generic SaaS component kit.

DESIGN_VARIANCE: 7
MOTION_INTENSITY: 6
VISUAL_DENSITY: 5
```

### Visual Direction

- Warm, confident, exploratory, and practical rather than luxury-only or backpacker-only.
- Strong destination imagery balanced by legible planning tools.
- Editorial destination pages; denser but calm itinerary workspaces.
- Map, timeline, calendar, and source/freshness patterns should feel like one product system.
- Avoid generic gradient-heavy AI branding and repetitive card grids.

## 11. Recommended Technical Direction

### Monorepo

Use a pnpm and Turborepo workspace:

```text
apps/
  web/                 # Next.js responsive PWA
  api/                 # Hono API
packages/
  db/                  # Drizzle schema, migrations, seeds
  contracts/           # schemas and shared API types
  api-client/          # typed client
  ai/                  # provider-neutral orchestration and evaluations
  travel-data/         # provider adapters and normalization
  offline/             # manifests, serialization, cache contracts
  ui/                  # Roavia-owned web components and tokens
  config/              # shared TypeScript/lint/test configuration
```

### Frontend

- Next.js with TypeScript.
- Tailwind CSS as the styling foundation.
- Roavia-owned components built on accessible primitives only where justified.
- TanStack Query or equivalent for server state.
- Schema-driven forms and shared contracts.
- PWA service worker and IndexedDB-backed offline storage.
- Map provider behind an adapter so provider changes do not leak through feature code.

### Backend

- Hono API with typed validation.
- PostgreSQL with Drizzle ORM.
- Supabase Auth or an equivalent managed identity provider.
- Background jobs for ingestion, refresh, itinerary generation, and alerts.
- Queue/job abstraction appropriate to the deployment platform.

### AI

- Provider-neutral AI gateway.
- Structured itinerary output validated against shared schemas.
- Retrieval over curated destination content and approved live sources.
- Separate generation, validation, repair, and evaluation stages.
- Prompt, model, latency, token, cost, safety, and quality telemetry without storing unnecessary sensitive content.

## 12. High-Level Architecture

```text
Next.js PWA
    |
Typed API Client
    |
Hono API
    |-- Auth and user profile
    |-- Trip and itinerary services
    |-- Destination catalog/search
    |-- Best-time insights
    |-- Assistant orchestration
    |-- Sharing and offline manifests
    |
PostgreSQL
    |
Background Jobs
    |-- Destination ingestion/refresh
    |-- Seasonal insight computation
    |-- Itinerary generation/repair
    |-- Weather/closure reconciliation
    |
External Provider Adapters
    |-- geocoding/maps/routes
    |-- weather/climate
    |-- holidays/events
    |-- currency
    |-- official travel advisories
    |-- destination/place content
    |-- AI providers
```

## 13. Data Model

### Core Entities

#### users

- id
- auth_user_id
- display_name
- home_country
- preferred_currency
- locale
- timezone
- created_at
- updated_at

#### travel_profiles

- id
- user_id
- default_budget_style
- default_pace
- interests_json
- dietary_needs_json
- accessibility_needs_json
- travel_preferences_json
- created_at
- updated_at

#### trips

- id
- owner_user_id
- title
- slug
- origin_place_id
- start_date
- end_date
- date_flexibility_json
- traveler_summary_json
- budget_json
- status
- visibility
- generation_state
- created_at
- updated_at

#### trip_destinations

- id
- trip_id
- place_id
- arrival_at
- departure_at
- order_index

#### itinerary_days

- id
- trip_id
- local_date
- timezone
- title
- notes
- order_index

#### itinerary_items

- id
- itinerary_day_id
- place_id
- item_type
- start_time
- end_time
- duration_minutes
- estimated_cost_json
- transport_json
- booking_json
- source_snapshot_json
- confidence
- notes
- order_index

#### places

- id
- parent_place_id
- place_type
- canonical_name
- localized_names_json
- coordinates
- timezone
- country_code
- provider_ids_json
- summary
- status
- created_at
- updated_at

#### destination_content

- id
- place_id
- content_type
- locale
- content_json
- source_ids_json
- valid_from
- valid_until
- reviewed_at
- quality_state

#### sources

- id
- provider
- source_url
- license
- retrieved_at
- published_at
- trust_tier
- metadata_json

#### seasonal_insights

- id
- place_id
- period_key
- weather_summary_json
- crowd_level
- price_level
- events_json
- closures_json
- recommendation_scores_json
- explanation
- source_ids_json
- refreshed_at

#### assistant_sessions and assistant_messages

Store minimal conversation context, source references, safety metadata, and user-approved actions.

#### offline_packages

- id
- user_id
- trip_id
- version
- manifest_json
- generated_at
- expires_at
- size_bytes

#### share_links

- id
- trip_id
- token_hash
- permission
- expires_at
- revoked_at

## 14. API Areas

```text
GET    /health

POST   /auth/profile
GET    /me
PATCH  /me/preferences

GET    /destinations/search
GET    /destinations/:placeId
GET    /destinations/:placeId/best-time
GET    /destinations/:placeId/events

GET    /trips
POST   /trips
GET    /trips/:tripId
PATCH  /trips/:tripId
DELETE /trips/:tripId

POST   /trips/:tripId/generate
GET    /trips/:tripId/generation
POST   /trips/:tripId/regenerate

POST   /trips/:tripId/days
PATCH  /trips/:tripId/days/:dayId
POST   /trips/:tripId/items
PATCH  /trips/:tripId/items/:itemId
DELETE /trips/:tripId/items/:itemId
POST   /trips/:tripId/items/:itemId/alternatives

POST   /assistant/query
POST   /assistant/actions/:actionId/confirm

POST   /trips/:tripId/share-links
DELETE /trips/:tripId/share-links/:shareLinkId

POST   /trips/:tripId/offline-package
GET    /trips/:tripId/offline-package
```

## 15. Travel Data and Provider Strategy

Provider selection requires a dedicated research issue before implementation. The system should not assume one vendor can supply all destination, map, event, climate, advisory, and place data.

Requirements:

- Adapter per provider.
- Normalized internal contracts.
- Source attribution and licensing records.
- Rate-limit and quota handling.
- Caching with explicit freshness policy.
- Provider health and fallback behavior.
- Manual review path for curated launch destinations.
- Region and language coverage documented.

## 16. AI System Requirements

### Itinerary Generation Pipeline

1. Normalize user request and preferences.
2. Resolve destinations and travel dates.
3. Retrieve destination, route, opening, weather, and seasonal context.
4. Generate structured itinerary candidates.
5. Validate schema and business constraints.
6. Detect impossible timing, duplicate places, long transfers, and known closures.
7. Repair or flag conflicts.
8. Present assumptions and confidence to the user.
9. Persist only after successful validation.

### Assistant Grounding

- Prefer curated Roavia content and approved live sources.
- Include source links and freshness.
- State uncertainty explicitly.
- Do not fabricate visa, safety, emergency, opening-hours, or closure information.
- Route high-stakes matters to official sources.
- Require confirmation before editing a trip.

### Evaluation

Maintain an evaluation set covering:

- itinerary feasibility
- destination relevance
- source attribution
- hallucination and unsupported claims
- budget alignment
- family/accessibility constraints
- seasonal accuracy
- repair quality
- latency and cost

## 17. Real-Time Recommendation Boundaries

MVP real-time recommendations may use weather changes and known closures for saved trips. They must:

- be advisory rather than silently mutating plans
- show why the recommendation changed
- show source and update time
- support dismiss, replace, and keep-original actions
- avoid notifications for low-confidence changes
- degrade safely when providers are unavailable

## 18. Offline Requirements

Offline packages include:

- itinerary days and items
- addresses and coordinates
- user notes
- essential destination guidance selected for the trip
- emergency contacts and official-source links
- cached map metadata or approved offline map representation where licensing permits
- package version and last-updated timestamp

Live weather, closures, prices, booking availability, and assistant responses must be marked unavailable or stale offline.

## 19. Security and Privacy

- Enforce ownership on all trip and preference endpoints.
- Hash share tokens and support revocation and expiry.
- Store precise travel dates and locations as sensitive personal data.
- Minimize assistant prompt retention.
- Keep provider and AI credentials server-side.
- Sanitize imported rich content.
- Rate-limit generation and assistant endpoints.
- Maintain audit events for share-link, destructive, and AI-applied actions.
- Provide account deletion and data export pathways.
- Apply the explicit retention, export, deletion, backup, audit, and minimization lifecycle in [ADR 0005](./docs/architecture/decisions/0005-sensitive-data-lifecycle.md).

## 20. Reliability and Observability

Track:

- API latency and errors
- provider availability and quota exhaustion
- data freshness and failed refreshes
- generation latency, failure, repair, and abandonment
- AI token and cost usage
- offline package generation and sync failures
- alert recommendation delivery and acceptance

All background jobs require idempotency keys, retries with backoff, dead-letter handling, and operator-visible failure context.

## 21. Testing Strategy

- Unit tests for domain logic, scoring, normalization, and validation.
- Contract tests for provider adapters.
- API integration tests with isolated database state.
- AI structured-output and evaluation tests.
- Component and interaction tests for critical UI.
- Browser tests for sign-in, trip creation, generation, editing, sharing, and offline access.
- Accessibility checks for primary flows.
- Resilience tests for provider failure, stale data, AI invalid output, and interrupted offline downloads.

## 22. Assumptions

- MVP launches as a responsive PWA rather than native applications.
- Initial destination coverage is curated and intentionally limited.
- Users create accounts before saving or downloading trips.
- Roavia provides estimates, not guaranteed prices or availability.
- Public community functionality is deferred.
- English is the initial product language, while the data model supports localization.
- The Linear team `wonderland` owns the project.

## 23. Open Questions

- Which launch destinations and regions should receive curated coverage first?
- Which deployment provider should host web, API, jobs, and PostgreSQL?
- Which travel-data providers meet licensing, cost, and coverage requirements?
- Should shared links support comments before full collaboration is implemented?
- Which launch jurisdictions and data regions must the accepted privacy lifecycle satisfy before public launch?

## 24. Definition of Done

- A user can sign in, create a trip, generate a grounded itinerary, understand assumptions, edit all itinerary items, and save the trip.
- Destination details and best-time insights include sources and freshness.
- A saved trip can be shared read-only and downloaded for offline use.
- Weather/closure changes can produce explainable alternatives without silently changing the plan.
- Primary flows pass functional, accessibility, security, and resilience verification.
- Operational dashboards expose data freshness, provider health, generation quality, and cost.
