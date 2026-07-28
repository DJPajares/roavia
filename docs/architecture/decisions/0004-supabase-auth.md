# ADR 0004: Supabase authentication and session handling

- Status: Accepted for MVP
- Date: 2026-07-28
- Decision owner: Roavia product owner
- Technical owner: Platform owner
- Reversibility: Medium; application identity contracts are provider-neutral, while session cookies and account migration require coordinated provider work

## Context

Roavia needs managed email/password account creation, sign-in, sign-out, session refresh, protected Next.js routes, and authenticated Hono requests. The web and API run as separate Render services, and neither may receive a credential capable of minting arbitrary user sessions. Local development and CI must remain deterministic without production accounts or copied user data.

The PRD names Supabase Auth as the default managed provider. Supabase supports cookie-backed Next.js SSR, short-lived access tokens, refresh-token rotation, and asymmetric signing keys exposed through a public JWKS endpoint.

## Decision

Use Supabase Auth for the MVP identity provider, with these boundaries:

- The browser and Next.js service use only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. A publishable key identifies the project but cannot perform administrative auth operations.
- Next.js Server Actions perform email/password sign-up, sign-in, and local sign-out through request-scoped `@supabase/ssr` clients.
- Next.js `proxy.ts` calls `getClaims()` on requests, refreshes near-expiry sessions, writes rotated cookies to both the request and response, and propagates the SDK's private/no-store response headers.
- `/trips`, `/plan`, `/assistant`, and `/profile` are protected web route prefixes. Missing or invalid sessions redirect to `/auth/sign-in` with a local return path.
- The browser or web service forwards the Supabase access token to Hono as `Authorization: Bearer <token>` through `@roavia/api-client`.
- Hono verifies access tokens against the project's asymmetric JWKS with `jose`. It validates the signature, issuer, `authenticated` audience and role, expiry, and UUID subject before exposing a provider-neutral identity.
- Shared contracts normalize identity to `userId` and optional `email`, and normalize failures to `authentication_required`, `invalid_session`, or `session_expired`.
- Do not configure, request, or expose Supabase secret, service-role, or legacy shared JWT-secret values for ordinary web/API authentication.

Production must use asymmetric Supabase signing keys. The Supabase project region must be approved for account-data residency before production provisioning; this ADR does not provision an external project.

## Session behavior

The web refreshes a valid session when its access token enters the provider SDK's refresh window. If refresh or claim validation fails, the request is treated as unauthenticated. Hono does not refresh browser sessions; it validates the bearer token presented for that request and returns a typed 401 response when the token is missing, malformed, invalid, or expired.

Local sign-out asks Supabase to end the local session and removes the browser's session cookies. Like any signed access-token system, a copied access token can remain cryptographically valid until its short expiry; domain authorization must therefore continue to enforce ownership independently.

## Verification and local development

Default tests generate isolated asymmetric keys and never call a live provider. The web browser smoke flow uses a test-only Supabase-compatible fixture that keeps users and refresh tokens in process memory, logs no passwords or tokens, and is never selected by production configuration.

Run the fixture and web app in separate terminals:

```bash
pnpm --filter @roavia/web dev:auth-fixture
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_roavia_browser_smoke \
pnpm --filter @roavia/web dev
```

Then smoke-test sign-up, profile access, sign-out, protected-route redirection, sign-in, refresh, and final sign-out at `http://localhost:3000`.

## Consequences

- Web and API share one normalized identity and expiry contract without sharing a session-minting secret.
- Protected SSR responses cannot be publicly cached when cookies rotate.
- API verification normally depends only on Supabase's edge-cached public JWKS, so auth-server latency is not added to every API request.
- Signing-key rotation must respect Supabase JWKS cache timing and be verified before retiring the prior key.
- A future provider migration replaces the web adapter and API verifier but preserves route, error, identity, and typed-client contracts.

## Sources

- [Supabase server-side auth client guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase server-side auth advanced guide](https://supabase.com/docs/guides/auth/server-side/advanced-guide)
- [Supabase JWT verification guidance](https://supabase.com/docs/guides/auth/jwts)
- [Supabase signing keys](https://supabase.com/docs/guides/auth/signing-keys)
- [Next.js Proxy file convention](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
