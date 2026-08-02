# Roavia MVP threat model

Status: reviewed for WDL-51 on 2026-08-02. Re-review when a new provider,
deployment boundary, data class, public write endpoint, upload format, or
third-party browser script is introduced.

## Scope and security objectives

This review covers the Next.js PWA, Hono API, PostgreSQL/Drizzle repositories,
pg-boss workers, Supabase Auth, Vercel AI Gateway, launch travel-data adapters,
public share links, and account export/deletion. The objectives are:

- only an authenticated owner can read or mutate saved private data;
- a share token grants read-only access to one explicitly shared trip and can
  be expired or revoked;
- dates, precise locations, prompts, credentials, tokens, and provider payloads
  do not enter logs or queue payloads without an approved retained record;
- imported/provider text and traveler text cannot become application or model
  instructions;
- server credentials can reach only their intended provider boundary;
- expensive AI and export operations have bounded inputs, rates, retries, and
  retention;
- export and deletion follow the lifecycle registry and leave only the approved
  deletion evidence.

## Assets, actors, and trust boundaries

| Area             | Sensitive assets                                                 | Boundary                                                              |
| ---------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| Browser          | access token, offline trip package, dates and itinerary          | untrusted browser to allowlisted API origin                           |
| API              | authenticated owner identity, share grants, provider credentials | bearer verification before owner-scoped repositories                  |
| Database         | trips, profiles, actions, lifecycle records, audit events        | parameterized repository methods with explicit owner ID               |
| Jobs             | job IDs, subject IDs, immutable revisions                        | minimal pg-boss payload to worker-side authorized reload              |
| AI               | traveler constraints and bounded grounded evidence               | schema-validated gateway output; no credentials or share tokens       |
| Travel providers | API keys and outbound requests                                   | server-only adapter plus fixed HTTPS provider host                    |
| Public sharing   | 256-bit share token and read-only trip snapshot                  | hashed token lookup with expiry, revocation, and no-store response    |
| Lifecycle        | encrypted export artifact and deletion receipt                   | recent-auth grant, owner check, expiry, pruning, and tombstone policy |

Threat actors include an unauthenticated internet caller, an authenticated user
attempting cross-account access, a holder of a leaked or expired share link, a
malicious imported content source, a prompt-injection author, a compromised or
misbehaving provider response, and an accidental deployment misconfiguration.
Administrator/workstation compromise and a malicious dependency maintainer are
partially addressed by CI gates and credential isolation but remain outside the
application authorization boundary.

## Threat analysis and controls

| Threat                                                                   | Rating | Control and verification evidence                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IDOR or cross-account mutation                                           | High   | Every private route derives the owner from the verified bearer token; repositories require `authUserId`; authorization integration tests cover mismatched owners.                                                                                                                                                                                                                                      |
| Share-link guessing, replay, or post-revocation access                   | High   | Random 256-bit tokens are stored only as hashes, grant view-only access, require `visibility=link`, expire, revoke, return generic 404s, and use `private, no-store`. Sharing tests cover invalid, expired, revoked, and owner-mismatch paths.                                                                                                                                                         |
| Prompt/content injection from imported records or traveler text          | High   | Grounding accepts only approved, schema-bounded records; prompt records are JSON-serialized, control/bidirectional characters are removed, and system messages classify evidence and traveler text as untrusted data. Model outputs are schema-validated and all IDs/sources are checked against authorized context. Adversarial grounding, assistant, intent, and itinerary tests cover the boundary. |
| SSRF or credential exfiltration through provider configuration/redirects | High   | Concrete provider adapters accept only their fixed HTTPS hostname or loopback test fixtures, reject URL credentials/query/hash, and disable redirects. Hosted Supabase credentials accept only a project `*.supabase.co` origin or explicit loopback development. Security tests cover link-local, private-name, credential-bearing, non-HTTPS, and redirect configuration.                            |
| Stored/reflected script execution through rich content or source links   | High   | No raw-HTML rendering exists; imported content is rendered through React text nodes; outbound sources are HTTPS-only; CSP blocks objects and framing. The encyclopedia adversarial test confirms markup remains inert text.                                                                                                                                                                            |
| AI, export, or search resource exhaustion                                | High   | API bodies are capped at 64 KiB. Assistant, intent extraction, itinerary generation, export, and public search use bounded fixed windows keyed by authenticated owner or a validated client address. The limiter caps tracked identities and prunes/evicts entries. Tests cover workload limits, spoofed forwarding headers, and oversized bodies.                                                     |
| Forwarded-address spoofing                                               | High   | `X-Forwarded-For` is ignored unless `TRUSTED_PROXY_HOPS` is explicitly configured; selection occurs from the trusted right-hand proxy depth and accepts only IP literals.                                                                                                                                                                                                                              |
| Credential exposure to browser or telemetry                              | High   | Concrete AI/travel adapters are server-only exports; only Supabase publishable configuration is client-prefixed. Structured telemetry excludes raw prompts, itinerary text, coordinates, dates, tokens, credentials, and provider payloads. CI secret/config scanning fails on high or critical findings.                                                                                              |
| Queue replay, poison payload, or infinite retry                          | Medium | Job payloads are versioned and schema-validated, contain identifiers/revisions instead of full prompts, use bounded attempts/backoff/leases, and reload authoritative data in the worker. Job contract and integration tests cover malformed payloads and retry exhaustion.                                                                                                                            |
| Stale or fabricated travel claims                                        | Medium | Provider responses and AI output are normalized through strict schemas; grounding retains provenance/freshness; high-stakes answers require an official source; itinerary validation rejects unknown sources and places.                                                                                                                                                                               |
| Retention, export, or deletion policy drift                              | High   | `ops/privacy/retention-registry.json` is validated in tests. Export grants and artifacts expire and are pruned; deletion revokes shares/exports, deletes owner data and auth identity, and retains only the approved opaque evidence described in the account lifecycle runbook and ADR 0005.                                                                                                          |
| Vulnerable dependency, leaked secret, or insecure repository config      | High   | The Security workflow runs full-repository Trivy dependency/secret/misconfiguration scanning with a high/critical failure threshold, blocks high-risk dependency changes in pull requests, and runs CodeQL `security-extended`. Actions are commit-SHA pinned.                                                                                                                                         |

## Findings resolved by WDL-51

1. Public search trusted the first caller-supplied forwarding value. It now uses
   the socket address unless a bounded proxy depth is configured.
2. AI-backed planner and itinerary generation routes had no workload-specific
   rate limit. Both now have authenticated per-owner limits.
3. API payload size and baseline security headers were implicit. A global 64 KiB
   body limit and explicit API/browser header policies now fail closed.
4. Provider base URLs allowed arbitrary HTTPS hosts and fetch followed redirects.
   Provider and Supabase hosts are now allowlisted and credential-bearing
   requests reject redirects.
5. Grounded evidence was delimited plain text. It is now control-sanitized JSON
   data under explicit untrusted-data system instructions.
6. CI had no release-blocking security workflow. Dependency, secret,
   misconfiguration, and SAST gates now fail at the documented thresholds.

No unresolved high-risk finding remains in the reviewed MVP scope.

## Residual risks and operating constraints

- Fixed-window limits are process-local. Keep one public API process for MVP or
  replace the limiter with a shared atomic store before horizontal scaling.
- The Next.js CSP permits inline script/style needed by the current framework
  output. No imported HTML or third-party script is allowed; adopt nonce-based
  CSP before introducing either.
- Host allowlisting prevents user/config-selected SSRF and redirect pivots but
  still trusts DNS and TLS for the approved providers. Provider DNS compromise is
  handled as a provider incident and should disable that adapter.
- Share links remain bearer capabilities until expiry/revocation. Users must use
  short expiries for sensitive trips and revoke links that may have leaked.
- Backup deletion follows the bounded backup expiry in ADR 0005; immediate
  account deletion cannot selectively erase immutable historical backup blocks.

## Manual release review

For a security-sensitive release, reviewers must confirm:

1. protected routes return 401 without a bearer and generic 404 for another
   owner's identifiers;
2. revoked/expired shares cannot be opened and shared responses are not cached;
3. injected HTML remains text and injected evidence cannot create prompt records
   outside the JSON envelope;
4. an unapproved or link-local provider URL fails during adapter construction and
   provider calls use `redirect: error`;
5. oversized bodies and repeated assistant/planner/generation requests return
   413/429 with safe envelopes;
6. logs, traces, queue payloads, and audit rows contain identifiers/outcomes but
   no raw dates, coordinates, prompts, credentials, access tokens, or share
   tokens;
7. dependency audit, repository security scan, CodeQL, affected package checks,
   and the AI evaluation suite pass before release.
