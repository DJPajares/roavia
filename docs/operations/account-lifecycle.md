# Account export and deletion operations

The account privacy controls implement the lifecycle in
[ADR 0005](../architecture/decisions/0005-sensitive-data-lifecycle.md). The
machine-readable inventory is
[`ops/privacy/retention-registry.json`](../../ops/privacy/retention-registry.json).

## Required configuration

- `ACCOUNT_LIFECYCLE_SECRET` is a stable server-only secret of at least 32
  non-whitespace characters. It derives separate keys for export encryption and
  opaque deletion-subject hashes. Rotating it invalidates outstanding export
  grants and prevents matching existing tombstones, so use a reviewed migration
  procedure before rotation.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only and is used solely to hard-delete
  the authenticated identity after local data removal. Never expose it through a
  `NEXT_PUBLIC_*` variable.
- Configure Supabase access-token expiry to 15 minutes or less. The API also
  requires an authentication time no older than five minutes for export and
  deletion confirmation.

If any required server dependency is absent, the account endpoints return
`account_service_unavailable` and do not accept lifecycle work.

## Export flow

1. `GET /me/deletion-preview` reports the owned records and policy deadlines.
2. `POST /me/exports` accepts a recently issued bearer token and is limited to
   three requests per account per day.
3. The API takes a repeatable-read snapshot, builds versioned JSON and CSV files
   plus a SHA-256 manifest, creates a ZIP, and encrypts it with AES-256-GCM.
4. The response returns a random single-purpose grant. The download request must
   send that value in `X-Roavia-Export-Grant`; it never belongs in a URL or log.
5. `GET /me/exports/:exportId/download` requires both the owning account bearer
   token and grant, returns `Cache-Control: private, no-store`, and never exposes
   another account's artifact.

Artifacts and grants expire after 23 hours. The worker prunes expired ciphertext
every 15 minutes, keeping physical retention below 24 hours. Confirmation of
account deletion removes every outstanding export immediately.

## Deletion and retry flow

`POST /me/deletion` requires recent authentication and the exact JSON body
`{"confirmation":"DELETE"}`. Before external side effects, the API creates a
random content-free receipt and an HMAC subject tombstone. The tombstone blocks
ordinary authenticated endpoints while still permitting `GET /me/deletion` and
repeat `POST /me/deletion` calls.

The idempotent checklist runs in this order:

1. revoke Supabase refresh sessions;
2. cancel active work and scrub application and pg-boss job records;
3. delete account-owned live data after revoking shares and export grants;
4. hard-delete the Supabase identity.

A partial response is HTTP 202 with status `failed` and normalized failure codes.
Retry the same confirmation with the same authenticated subject; completed steps
are skipped. HTTP 200 means every step is satisfied. Hard identity deletion also
satisfies session revocation because no refresh session can remain usable.

Operator triage uses only receipt ID, request/correlation ID, step status, and
failure codes. Never copy auth subject IDs, email, trip content, tokens, or exact
travel dates into logs or incident channels. A user whose live data has already
been purged must retry before the access token expires when identity deletion was
the failing step. Escalate provider-side deletion failures within the 24-hour
live-data deadline.

## Retention and backup disclosure

- Live application data is deleted within 24 hours of confirmation.
- Encrypted backup copies age out within 31 days and are not restored as live
  accounts. On disaster restore, preserve tombstones and rerun lifecycle cleanup
  before opening restored data to traffic.
- Opaque tombstones expire after 31 days.
- Content-free receipts and account lifecycle audit evidence expire after 12
  calendar months.
- The confirming browser clears Roavia IndexedDB records and Cache Storage. A
  different offline device may retain bytes until the browser evicts them or the
  user clears local storage, but authorization and share access are denied when
  it reconnects.

The worker emits only aggregate prune counts. Investigate a stalled `failed`
receipt before its live deletion deadline; successful retries remain safe.
