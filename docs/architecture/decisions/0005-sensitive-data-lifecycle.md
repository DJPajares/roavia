# ADR 0005: Sensitive-data retention and privacy lifecycle

- Status: Accepted for MVP implementation; public-launch legal review required
- Date: 2026-07-28
- Decision owner: Darwin Jason Pajares (Roavia product owner)
- Privacy implementation owner: Darwin Jason Pajares until a privacy lead is appointed
- Technical owner: Platform owner
- Reversibility: Medium; shorter retention is normally safe, while longer retention or a new use requires a new privacy review

## Context

Roavia stores account details, travel preferences, exact trip dates and locations,
itinerary notes, sharing metadata, offline manifests, assistant interactions, job
records, and operational signals. Exact travel history, accessibility and dietary
preferences, free text, and assistant context can reveal sensitive facts even when
they are not labelled as sensitive by a particular law.

This decision defines the implementation baseline for those records. It is a product
and engineering policy, not a conclusion that one policy satisfies every launch
jurisdiction. Launch audience, residency, transfer, notice, consent, age, and
statutory-retention requirements remain release gates listed below.

The policy follows four rules:

1. Collect and disclose only data needed for an explicit product or security purpose.
2. Let the user control the lifetime of saved product data, while expiring temporary
   copies automatically.
3. Remove identifying content from operational and audit records whenever identifiers
   are not required.
4. A backup may delay physical disappearance, but it never restores deleted data to
   active use or extend the approved retention period.

## Classification

| Class                  | Meaning                                                                     | Examples                                                                                            | Handling baseline                                                                         |
| ---------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `R0 Public`            | Non-personal catalog data intended for broad display                        | Place names, official advisories, source URLs, licensing metadata                                   | Integrity, freshness, and licensing controls; no account linkage                          |
| `R1 Personal`          | Data that identifies or is linked to an account                             | Auth identity, display name, locale, internal user ID                                               | Authenticated access, ownership enforcement, encrypted transport and storage              |
| `R2 Sensitive travel`  | Data that can reveal movements, companions, needs, or private plans         | Exact dates, coordinates, origin, lodging, notes, age ranges, accessibility and dietary preferences | Least privilege, no default logging, no analytics dimensions, minimum provider disclosure |
| `R3 Sensitive content` | User-authored or generated content that may contain arbitrary personal data | Assistant messages, prompts, itinerary notes, booking details, imported text                        | Content isolation, sanitization, no training use, short explicit retention                |
| `R4 Secret`            | A value that grants access or authority                                     | Passwords, access/refresh tokens, share tokens, provider credentials, signing keys                  | Never export or log; store only in the designated credential system; hash share tokens    |
| `R5 Operational`       | Pseudonymous events needed to operate and secure the service                | Correlation IDs, job state, latency, normalized error code, deletion receipt                        | Exclude content and precise travel fields; expire or irreversibly aggregate               |

Pseudonymized data remains protected data. It becomes anonymous only when Roavia and
its processors have no reasonable means to reconnect it to a person.

### Data-model coverage

The schedule applies to current tables and to the PRD's planned tables and stores:

| Data class  | Current or planned records                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| Account     | Supabase `auth.users`/identities and application `users`                                                      |
| Profile     | `travel_profiles`                                                                                             |
| Trip        | `trips`, `trip_destinations`                                                                                  |
| Itinerary   | `itinerary_days`, `itinerary_items`, including booking, transport, notes, and source snapshots                |
| Share       | `share_links`                                                                                                 |
| Offline     | `offline_packages`, object storage, service-worker cache, and IndexedDB                                       |
| Assistant   | Planned `assistant_sessions`, `assistant_messages`, proposed actions, and confirmed-action references         |
| Source      | `places`, `sources`, and planned destination content/seasonal insight records                                 |
| Audit       | `job_operator_actions` and planned share, export, deletion, destructive-change, and AI-applied `audit_events` |
| Telemetry   | Application/service logs, traces, metrics, AI quality/cost events, and provider health events                 |
| Job runtime | `application_jobs`, `pg-boss` queue records, dead letters, and temporary retry objects                        |

## Retention schedule

Unless a shorter row-specific deadline applies, a confirmed account deletion makes
data inaccessible immediately and removes it from live systems within 24 hours. The
30-day backup window starts when the live copy is deleted. Retention jobs must be
idempotent, observable without recording deleted content, and run at least daily.

| Data class                                                                     | Purpose and examples                                                                                                                                     | Active retention                                                                                                                                                           | Deletion or anonymization                                                                                                                                                                                                         | Backup treatment                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account (`R1`, with `R4` credentials)                                          | Supabase identity, email, display name, locale, currency, timezone, authentication and account recovery                                                  | While the user keeps an account; this continuing saved-account purpose is reviewed annually                                                                                | Global session revocation and account lock at confirmed deletion; application and auth identity removed within 24 hours; access-token lifetime must be at most 15 minutes; passwords and tokens are never copied to Roavia tables | Provider and database copies age out within 30 days of live deletion; a restore must reapply deletion tombstones before serving traffic                                                        |
| Profile (`R1`/`R2`)                                                            | Budget, pace, interests, dietary, accessibility, and preference defaults                                                                                 | While the account exists or until the user clears an individual value                                                                                                      | Clear immediately on user edit; delete within 24 hours of account deletion; never retain a derived marketing profile                                                                                                              | Ages out within 30 days; restored data remains subject to the account tombstone                                                                                                                |
| Trip (`R2`)                                                                    | Trip title, origin, destinations, exact dates, travelers, budget, state, and user notes                                                                  | While the user keeps the trip; archived does not mean anonymously retained                                                                                                 | Trip deletion makes it inaccessible immediately and purges the trip and dependent records within 24 hours; account deletion purges all owned trips                                                                                | Ages out within 30 days; no long-term trip-history backup export is permitted                                                                                                                  |
| Itinerary (`R2`/`R3`)                                                          | Days, times, places, transport, booking fields, costs, notes, assumptions, and source snapshots                                                          | Same lifetime as the owning trip                                                                                                                                           | Cascade-delete with the trip within 24 hours; normalized catalog places and sources are not deleted when they have no user linkage                                                                                                | Ages out within 30 days; restore follows the trip tombstone                                                                                                                                    |
| Share (`R1`/`R2`, token is `R4`)                                               | Read-only link permission, trip reference, hashed token, creation, expiry, and revocation                                                                | Default 30 days, user-selectable up to 180 days; no non-expiring link                                                                                                      | Revoke immediately on user action, trip/account deletion, or permission loss; purge hash and row within 24 hours of revoke/expiry; retain only a content-free audit event                                                         | Revoked/expired copies age out within 30 days and remain denied by tombstones after restore; raw tokens never enter backups because they are never stored                                      |
| Offline (`R2`/`R3`)                                                            | Server manifest and licensed trip subset cached on an authenticated device                                                                               | At most 30 days per package; refresh produces a new version and retires the prior version                                                                                  | Server object and manifest purge within 24 hours of expiry, trip/account deletion, or access loss; a local package refuses to open after its signed expiry and is erased on the next app start/sync                               | Server copies age out within 30 days; device copies are outside server backup and the UI must disclose that remote physical erasure requires the device to reconnect or app data to be cleared |
| Assistant (`R2`/`R3`)                                                          | User-visible session messages, grounded answers, proposed actions, citations, and validation state                                                       | User-visible session content expires 30 days after last activity, or sooner on session, trip, or account deletion; confirmed itinerary changes follow itinerary retention  | Raw prompt/response data is not kept in logs or general job payloads; delete retained session content within 24 hours of expiry/deletion; keep only content-free action audit evidence                                            | Retained user-visible messages age out within 30 days of live deletion; raw provider exchanges are not included in Roavia backups                                                              |
| Source (`R0`; snapshots can be `R2`)                                           | Shared place/catalog/source metadata, URL, publisher, freshness, license, and itinerary source snapshot                                                  | Shared catalog records follow source freshness and license rules; a personal snapshot follows its itinerary                                                                | Delete personal snapshots with itinerary; retain shared catalog records only while licensed and useful; remove account linkage before reusing aggregate quality signals                                                           | Catalog backup follows the normal 30-day maximum recovery window; personal snapshots age out within 30 days with the itinerary                                                                 |
| Audit (`R5`)                                                                   | Share create/revoke, export, deletion, destructive change, AI-applied action, privileged access, and job redrive/discard outcomes                        | 12 months from event, unless a documented legal hold applies                                                                                                               | Never store prompts, itinerary content, raw tokens, coordinates, dates, or free text; on account deletion replace subject linkage with a random deletion receipt ID, then delete the event at 12 months                           | May exist in the normal 30-day backup window, which does not extend the 12-month live retention deadline                                                                                       |
| Telemetry (`R5`)                                                               | Request/job correlation, route class, provider operation, release, latency, token/cost counts, status, normalized errors, and coarse device/runtime data | Raw logs and traces: 30 days; pseudonymous AI quality/cost events: 90 days; irreversibly aggregated metrics: 13 months                                                     | Exclude account email/name, exact dates/coordinates, free text, prompts/responses, credentials, and provider payloads; delete raw records at deadline and aggregate only when re-identification is not reasonably possible        | External sinks must apply the same or shorter window and must not create unmanaged archives                                                                                                    |
| Job runtime (`R5`; payload may become `R2`/`R3` if a contract violates policy) | Idempotent work, retry/dead-letter state, subject ID, requester, result, normalized failure, and operator actions                                        | Payload/result/error records: at most 7 days after terminal state; unfinished jobs remain only while retry policy allows; operator actions follow 12-month audit retention | Payloads use identifiers and immutable revisions, not prompts or itineraries; cancel account-related jobs immediately and scrub payload/result/error within 24 hours of account deletion                                          | Ages out within 30 days; restore must not redrive cancelled/deleted-account work                                                                                                               |

The platform owner must configure every store and processor to these limits or a
shorter limit. “Keep indefinitely,” an undocumented provider default, and manual
backup downloads without an owner and deletion date are prohibited.

## Assistant and precise-travel minimization

### Assistant requests

- Build each request from the smallest selected destination, date window, preference
  subset, and recent context required for that answer. Do not send account identity,
  email, share tokens, unrelated trips, or the full assistant history.
- Prefer internal IDs in durable jobs. Raw prompts and responses exist in process
  memory only for successful synchronous work. If a retry truly requires content,
  store an encrypted, access-controlled temporary object for at most 24 hours and
  delete it on success or terminal failure.
- Persist only user-visible messages and structured, schema-validated actions needed
  for the 30-day session history. A confirmed action becomes itinerary data; an
  unconfirmed proposal expires with the assistant session.
- AI and travel providers must contractually prohibit training on Roavia data. Prefer
  zero provider retention. An unavoidable provider abuse-monitoring copy must be
  documented, access-restricted, and no longer than 30 days.
- Model, token, latency, cost, safety category, validation result, and source IDs may
  be retained as telemetry. Prompt text, response text, exact dates, coordinates,
  booking details, and user notes may not.

### Precise travel history

- Collect exact dates and locations only when the user creates or imports a trip or
  when a selected feature needs them. Roavia does not collect continuous device
  location in the MVP.
- Do not infer that a planned itinerary was actually visited. Do not build movement
  histories, advertising audiences, or analytics dimensions from trip details.
- A provider receives only the location and date granularity its operation requires.
  Use a city or date range instead of coordinates or timestamps when sufficient.
- Product analytics use coarse, non-identifying categories. Exact destinations,
  routes, dates, traveler composition, accessibility, dietary needs, and notes are
  excluded.

## Export contract

An authenticated user can request a snapshot of data associated with the account.
The export implementation must re-authenticate the requester, rate-limit requests,
enforce ownership at every query, and record a content-free audit event.

The artifact is a ZIP containing UTF-8, versioned JSON as the canonical format and
CSV convenience files for tabular records:

| File or directory            | Contents                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`              | Export schema version, account ID, generated-at time, snapshot boundary, file list, record counts, and SHA-256 checksums            |
| `account.json`               | Exportable auth identity fields, display name, locale, currency, timezone, account timestamps, and profile preferences              |
| `trips.json` and `trips.csv` | Owned trips and destinations, including exact dates and traveler/budget structures                                                  |
| `itinerary/`                 | Days and items, notes, booking/transport/cost structures, assumptions, confidence, and source references grouped by trip            |
| `assistant.json`             | Messages and proposed/confirmed actions still inside the 30-day retention window, with citations and timestamps                     |
| `shares.csv`                 | Link IDs, trip IDs, permission, creation, expiry, and revocation timestamps; never raw tokens or token hashes                       |
| `offline.csv`                | Package ID, trip ID, version, generated/expiry time, size, and manifest metadata; not licensed binary/map assets                    |
| `sources.json`               | Sources referenced by exported itinerary/assistant records: title, publisher, URL, retrieval/freshness, and license metadata        |
| `audit.json`                 | User-facing events about the account that remain within retention, excluding internal detection logic and third-party personal data |

JSON uses stable field names, RFC 3339 timestamps, ISO 8601 dates, explicit `null`
values, and documented schema versions. CSV uses UTF-8, a header row, RFC 4180
quoting, and IDs that join back to JSON records. The export excludes password hashes,
access/refresh/share tokens, token hashes, provider credentials, internal security
detections that would weaken controls, other users' data, and provider content Roavia
is not licensed to redistribute.

The artifact is encrypted at rest, available through a single-purpose download grant
for at most 24 hours, and deleted within 24 hours of creation whether downloaded or
not. Export contents never enter logs, traces, support tools, or analytics.

## Deletion and expiry lifecycle

### Account deletion

1. Re-authenticate the user and show a preview distinguishing immediate revocation,
   live deletion, backup expiry, and retained audit evidence.
2. On final confirmation, create a random deletion receipt ID and an account
   tombstone. Immediately block sign-in/refresh, revoke all sessions and shares,
   invalidate export grants, deny offline refresh, and cancel pending jobs.
3. Access tokens have a maximum 15-minute lifetime. Ownership and tombstone checks
   deny requests even if an already-issued token has not yet expired.
4. Within 24 hours, delete the Supabase auth identity, application account/profile,
   trips and itineraries, assistant content, offline server objects, job content,
   exports, caches, search indexes, and processor-held copies. The operation is
   idempotent and retries without recreating data.
5. Normal encrypted backups are not edited in place. A maximum 30-day recovery window
   makes the last deleted copy unavailable no later than 31 days after confirmation.
   Any restore occurs in quarantine and reapplies account/trip/share tombstones before
   it can receive traffic.
6. Retain only the receipt ID, policy version, event times, outcome, affected-system
   checklist, and failure codes for 12 months. It contains no user ID, auth ID, email,
   trip/content fields, or tokens. Separately retain opaque deletion tombstones only
   through the 30-day backup window plus one day, then remove them. Delete the receipt
   automatically at 12 months.

The user receives the receipt ID and expected live/backup deadlines. Operators can
see failed system steps by receipt ID without seeing deleted content.

### Revoked shares and expired offline packages

- Share revocation changes authorization synchronously. Deletion of the hash/row may
  lag by at most 24 hours; the row is never treated as active during that interval.
- Package expiry is checked before serving or opening content. The server deletes the
  object/manifest within 24 hours. A connected client removes it on the next launch
  or sync; a disconnected client cannot open it after signed expiry.
- Trip or account deletion triggers both paths even when the normal expiry date is in
  the future.

### Legal hold exception

There is no default legal or business exception that retains trip or assistant
content after deletion. A hold requires a written scope, authority, start/review/end
date, and approval by Darwin Jason Pajares after qualified legal advice. Only the
minimum named records move to a separately access-controlled hold store; they cannot
be used for product, analytics, or AI. Release of the hold starts the normal 24-hour
deletion and 30-day backup-expiry clocks.

## Required implementation controls

- Maintain a machine-readable retention registry for every production table, object
  bucket, cache, search index, queue, log/trace sink, analytics store, and processor.
- New data fields and providers require a purpose, classification, owner, retention,
  export decision, deletion path, and backup behavior before production use.
- Deletion tombstones must outlive the longest backup by at least one day and be
  available to quarantine restores. Tombstones contain opaque internal scope and
  expiry only, not deleted content.
- Audit access is least-privilege and itself audited. Support tooling never bypasses
  retention or exposes raw assistant/trip data by default.
- Retention/deletion failures alert operators and block release when a store cannot
  meet this policy.
- WDL-63 implements export and deletion; WDL-51 verifies the resulting behavior
  adversarially. This ADR does not implement APIs, UI, or deletion jobs.

## PRD Section 19 review

| Security and privacy requirement           | Policy result                                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Enforce ownership                          | Export queries, saved records, offline refresh, and deletion are account-scoped; revocation changes authorization synchronously      |
| Hash, revoke, and expire shares            | Store only a token hash; default 30-day and maximum 180-day expiry; deny immediately and purge the row/hash within 24 hours          |
| Treat exact travel as sensitive            | Classify dates, locations, companions, needs, and notes as `R2`; exclude them from logs, analytics dimensions, and unnecessary calls |
| Minimize assistant prompt retention        | Use minimum selected context; no raw logging/general job payloads; 30-day visible sessions; provider retention capped at 30 days     |
| Keep credentials server-side               | Classify credentials as `R4`; never log/export them or place them in browser-visible configuration                                   |
| Sanitize imported rich content             | Classify imported text as `R3`; isolate and sanitize it before display or downstream use                                             |
| Rate-limit generation and assistant        | Preserve the PRD rate limit; export is also re-authenticated and rate-limited                                                        |
| Audit sharing, destruction, and AI actions | Keep content-free audit outcomes for 12 months and remove subject linkage on account deletion                                        |
| Provide export and deletion                | Define the machine-readable ZIP contract, immediate revocation, 24-hour live purge, 31-day backup expiry, and 12-month receipt       |

## Lifecycle verification trace

Use this fixture in WDL-63 integration and browser verification:

| Time        | Action and expected evidence                                                                                                                                                                                                                                                              |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `T0`        | Create an account and profile, then create a trip with exact dates/locations, itinerary notes, an assistant session, a share link, an offline package, and a pending job. Each record is owned by the fixture account; logs contain IDs/outcomes only.                                    |
| `T1`        | Request an export after re-authentication. The ZIP contains all retained account/profile/trip/itinerary/share/offline/assistant/source and user-facing audit data in the formats above, passes checksums, and contains no token, credential, other-user data, or raw operational payload. |
| `T1 + 24h`  | The export grant and artifact are unavailable and physically removed; the audit event remains content-free.                                                                                                                                                                               |
| `T2`        | Confirm deletion. Sessions/shares/export grants/offline refresh are denied and jobs cancelled synchronously. Repeating the request returns the same safe terminal state and receipt, not recreated data.                                                                                  |
| `T2 + 15m`  | No issued Roavia access token can remain valid. Tombstone/ownership checks already denied it before expiry.                                                                                                                                                                               |
| `T2 + 24h`  | Auth, account, profile, trip, itinerary, share row/hash, offline server package, assistant content, job payload/result/error, caches, search data, and processor live copies are absent. Shared non-personal catalog data remains without account linkage.                                |
| `T2 + 31d`  | The oldest permitted backup containing the account has expired. A quarantine restore demonstrates that tombstones prevent resurrection before expiry.                                                                                                                                     |
| `T2 + 12mo` | The content-free deletion receipt and associated audit evidence are deleted; only anonymous aggregate metrics may remain.                                                                                                                                                                 |

## Approval register

These approvals are owned by a named person so they cannot become implicit defaults:

| Approval                                                                                                                          | Accountable owner    | Deadline and required evidence                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch countries, applicable privacy regimes, age rules, controller identity, lawful bases, notice text, and statutory exceptions | Darwin Jason Pajares | Before public beta; record qualified legal review and approved notices in Linear                                                            |
| Production regions, cross-border transfers, subprocessors, DPAs, and backup windows no longer than this policy                    | Darwin Jason Pajares | Before provisioning production identity, database, storage, telemetry, or AI providers; record provider terms and region approval in Linear |
| AI/travel-provider no-training terms, deletion support, and any unavoidable provider retention of at most 30 days                 | Darwin Jason Pajares | Before any provider receives production user data; attach contract/DPA evidence in Linear                                                   |
| Any longer retention, new purpose, legal hold, or new sensitive analytics dimension                                               | Darwin Jason Pajares | Before collection or configuration; require a documented privacy impact and qualified legal review                                          |

If an approval is missing, Roavia uses fixtures or non-production data and does not
launch the affected processing. No engineer may infer an approval from this ADR.

## Consequences

- Saved trips can remain available while the account exists, but temporary sharing,
  offline, assistant, job, export, log, and backup copies have fixed limits.
- WDL-38 must reject non-expiring share links and enforce the 180-day maximum even
  though the initial database column permits `NULL`.
- WDL-43 must implement a 30-day assistant-session expiry and content-free telemetry.
- WDL-49 must enforce signed package expiry locally and disclose disconnected-device
  erasure limits.
- WDL-53 must configure raw observability retention to 30 days or less and aggregation
  so individuals cannot reasonably be reconstructed.
- WDL-63 has an exact export manifest, deletion sequence, deadlines, tombstone rule,
  and retained receipt contract.

## Sources

- [EU GDPR, Articles 5, 17, 20, and 25](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [Singapore PDPC data-protection obligations](https://www.pdpc.gov.sg/overview-of-pdpa/the-legislation/personal-data-protection-act/data-protection-obligations)
- [Singapore PDPC advisory guidelines on the Retention Limitation Obligation](https://www.pdpc.gov.sg/-/media/Files/PDPC/PDF-Files/Advisory-Guidelines/AG-on-Key-Concepts/Advisory-Guidelines-on-Key-Concepts-in-the-PDPA-17-May-2022.pdf)
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
- [Render PostgreSQL recovery and backup windows](https://render.com/docs/postgresql-backups)
- [Supabase database backup windows](https://supabase.com/docs/guides/platform/backups)
- [Supabase user deletion behavior](https://supabase.com/docs/guides/auth/managing-user-data#deleting-users)
