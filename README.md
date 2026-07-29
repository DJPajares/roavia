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
  worker/
packages/
  ai/
  api-client/
  config/
  contracts/
  db/
  offline/
  travel-data/
  ui/
  jobs/
```

### Workspace Responsibilities

| Workspace              | Responsibility                                                        |
| ---------------------- | --------------------------------------------------------------------- |
| `apps/web`             | Next.js responsive web application and future PWA client              |
| `apps/api`             | Hono API runtime and server-only integration boundary                 |
| `apps/worker`          | Dedicated background worker composition root                          |
| `packages/ai`          | Provider-neutral AI orchestration, validation, repair, and evaluation |
| `packages/api-client`  | Typed client boundary for the Roavia API                              |
| `packages/config`      | Shared TypeScript and future repository-tool configuration            |
| `packages/contracts`   | Shared validation schemas and transport-safe contracts                |
| `packages/db`          | PostgreSQL schema, migrations, seeds, and repositories                |
| `packages/offline`     | Offline manifests, serialization, caching, and sync contracts         |
| `packages/travel-data` | Normalized destination and live travel-data provider boundaries       |
| `packages/ui`          | Roavia-owned accessible components, patterns, and design tokens       |
| `packages/jobs`        | Versioned job contracts, reliability controls, and queue adapter      |

## Requirements

- Node.js 24 LTS
- pnpm 11 (the exact version is pinned in `package.json`)
- PostgreSQL
- Credentials for the selected auth, AI, map, weather, and destination-data providers
- Linear access for task execution

## Environment Variables

The root `.env.example` documents the expected groups without containing secret values. Provider-specific names and validation are finalized by their relevant Linear issues. Authentication uses Supabase Auth as recorded in [ADR 0004](./docs/architecture/decisions/0004-supabase-auth.md).

```text
DATABASE_URL
AUTH_PROVIDER
SUPABASE_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
AI_PROVIDER
AI_API_KEY
AI_MODEL
MAPS_PROVIDER
MAPS_API_KEY
WEATHER_PROVIDER
WEATHER_API_KEY
TRAVEL_DATA_*
APP_BASE_URL
API_BASE_URL
NEXT_PUBLIC_API_BASE_URL
CORS_ORIGINS
```

Never expose secret values through client-prefixed environment variables.

Natural-language planning and itinerary generation use Vercel AI Gateway when
`AI_PROVIDER=vercel-gateway`; set `AI_MODEL` to a Gateway model ID and keep
`AI_API_KEY` server-only. Without all three values, the API reports the planner
and generator as unavailable instead of accepting work it cannot process.

The launch map integration accepts `MAPS_PROVIDER=mapbox` and a server-only
`MAPS_API_KEY`. Temporary geocodes are never cached; only calls made through the
permanent-geocoding adapter may be persisted. Map tiles and route payloads are
excluded from offline packages until separate rights are approved.

For authentication, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is intentionally public project configuration. Never place a Supabase secret key, service-role key, or shared JWT secret in a `NEXT_PUBLIC_*` variable. The Hono API verifies asymmetric access tokens with `SUPABASE_URL` and the provider's public JWKS; it does not need an auth-admin secret.

## Local Setup

```bash
pnpm install
pnpm dev
```

The combined development command starts the web application at `http://localhost:3000` and the API at `http://localhost:8787`. Neither app requires credentials for the scaffold startup path.

To exercise authentication without a live Supabase project, run the test-only fixture and web app in separate terminals:

```bash
pnpm --filter @roavia/web dev:auth-fixture
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_roavia_browser_smoke \
pnpm --filter @roavia/web dev
```

The fixture stores disposable users only in memory. Use `http://localhost:3000` for the browser flow.

## Common Commands

```bash
pnpm dev              # Start web and API together
pnpm dev:web          # Start only the Next.js application
pnpm dev:api          # Start only the Hono API
pnpm dev:worker       # Start the PostgreSQL-backed background worker
pnpm db:migrate       # Apply reviewed PostgreSQL migrations
pnpm db:seed:destinations # Idempotently import the curated destination fixture
pnpm format:check     # Verify repository formatting
pnpm lint             # Lint all workspaces
pnpm typecheck        # Type-check all workspaces
pnpm test             # Test all workspaces
pnpm build            # Build all workspaces
pnpm check:affected   # Check changed workspaces and their dependents
```

Use the `:affected` variants of lint, typecheck, test, and build while iterating on a branch. Pre-commit checks run formatting and lint fixes only against staged files.

GitHub Actions runs formatting, lint, typecheck, test, and build checks with the package-manager version locked by the root `package.json`.

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

The MVP deployment and integration choices are recorded in [the architecture decision register](./docs/architecture/README.md). The selected baseline uses separate Render services for Next.js, Hono, and background work; paid Render PostgreSQL stores product and `pg-boss` job state.

The architecture supports:

- Next.js web hosting
- Hono API hosting
- PostgreSQL
- scheduled/background jobs
- secrets
- logs, metrics, and alerting
- safe database migrations and rollback

Production provisioning remains scoped to its dedicated Linear issue.

The worker uses the versioned internal contracts in `@roavia/jobs` and the `pg-boss` adapter only at its composition root. Run `pnpm db:migrate` before `pnpm dev:worker`; local execution needs PostgreSQL but no production queue or provider credentials.

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
