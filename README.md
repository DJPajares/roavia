# Roavia

**Plan intelligently. Travel confidently.**

Roavia is an AI-assisted travel planner and destination intelligence platform. The MVP is a responsive PWA that turns structured preferences or natural-language requests into editable, source-aware itineraries with destination research, seasonal guidance, sharing, and offline access.

## Tech Stack

- pnpm workspace and Turborepo
- Next.js PWA with TypeScript
- Tailwind CSS and Roavia-owned accessible components
- Hono API
- PostgreSQL and Drizzle ORM
- Managed authentication such as Supabase Auth
- TanStack Query or equivalent typed server-state layer
- IndexedDB and a service worker for offline packages
- Provider-neutral AI, map, route, weather, holiday/event, advisory, and currency adapters
- Vitest, browser E2E tests, Prettier, lint-staged

## Proposed Project Structure

```text
apps/
  web/
  api/
packages/
  ai/
  api-client/
  config/
  contracts/
  db/
  offline/
  travel-data/
  ui/
```

## Requirements

- A currently supported Node.js LTS release
- pnpm
- PostgreSQL
- Credentials for the selected auth, AI, map, weather, and destination-data providers
- Linear access for task execution

## Environment Variables

Exact names are finalized by the relevant Linear setup issues. Expected groups include:

```text
DATABASE_URL
AUTH_* or SUPABASE_*
AI_PROVIDER
AI_API_KEY
MAPS_PROVIDER
MAPS_API_KEY
WEATHER_PROVIDER
WEATHER_API_KEY
TRAVEL_DATA_*
APP_BASE_URL
API_BASE_URL
```

Never expose secret values through client-prefixed environment variables.

## Local Setup

The scaffold issue will establish final commands. Expected flow:

```bash
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## Common Commands

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Package-filtered commands should be preferred during implementation.

## Development Notes

### Web

- The web application is the MVP client and must support installation and offline trip access.
- Use the Roavia UI package and `SKILL.md` design constraints.
- Do not hard-code concrete external-provider logic in UI components.

### API

- All external-provider and AI credentials remain server-side.
- Validate every request and structured AI result.
- Enforce trip ownership and share-link permissions.

### Data

- External data is normalized through provider adapters.
- Every time-sensitive insight requires source and freshness metadata.
- Ingestion and refresh jobs must be idempotent and observable.

### AI

- Generation is separated into retrieval, generation, validation, repair, and persistence stages.
- Unsafe or unsupported claims are rejected or surfaced with uncertainty and official sources.

## Testing

Use Vitest for domain, package, API, and integration tests where appropriate. Add browser-level tests for the primary user journey and separate AI evaluation fixtures for itinerary quality and grounding.

## Build and Deployment

Deployment selection is intentionally deferred to a Linear research/architecture issue. The chosen platform must support:

- Next.js web hosting
- Hono API hosting
- PostgreSQL
- scheduled/background jobs
- secrets
- logs, metrics, and alerting
- safe database migrations and rollback

## Linear Workflow

- Project: https://linear.app/wwonderland/project/roavia-abc76648eb5b
- Select a ready, unblocked issue.
- The agent moves it to `In Progress` before modifying code and verifies the status update.
- Dependencies use Linear blocker relationships.
- Verification evidence is posted in an issue completion comment.
- PR work moves to `In Review`; merge automation moves it to `Done`.
- Do not create `.devtool/features`, `TASKS.md`, or local task mirrors.

## Notes and Limitations

- The MVP assumes a responsive PWA rather than native mobile apps.
- Launch destination coverage will be limited and curated.
- Booking and public community features are deferred.

## Codex Cloud

- GitHub repository: `https://github.com/DJPajares/roavia`
- Codex Cloud environment: `roavia`
- Linear project: https://linear.app/wwonderland/project/roavia-abc76648eb5b
- First ready issue: [WDL-19 — Scaffold the Roavia monorepo](https://linear.app/wwonderland/issue/WDL-19/scaffold-the-roavia-monorepo)

### Cloud-first workflow

```text
Linear ready issue
  -> delegate to Codex Cloud
  -> In Progress
  -> implementation and verification
  -> pull request
  -> In Review
  -> merge
  -> Done
```

The project can be started and operated without a local clone. Local VS Code and Codex CLI remain optional and use the same repository, documents, Linear issues, and pull requests.

### Mobile workflow

Use ChatGPT mobile with the connected Linear and GitHub apps to:

- review ready and blocked Roavia issues
- delegate a selected issue to Codex Cloud
- monitor Codex comments and linked pull requests
- review CI and decide whether to merge
- select the next ready issue

Codex remains the implementation agent; ChatGPT mobile is the coordination and approval surface.
