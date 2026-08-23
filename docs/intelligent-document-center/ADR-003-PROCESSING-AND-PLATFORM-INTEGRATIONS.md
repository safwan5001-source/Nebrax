# ADR-003: Processing Orchestration and Platform Integration Settings

- **Status:** Accepted
- **Date:** 2026-08-24
- **Scope:** PR-3

## Decision

Run document safety work asynchronously through Laravel's Redis queue on a dedicated Render
background worker. Render Key Value (Valkey) is the queue broker, is private-network only,
uses `noeviction`, and must use a persistent paid plan before production traffic. HTTP intake
never performs malware scanning synchronously.

Platform-level integration settings live in the separate platform console, not in tenant
settings. Storage, malware-scanner, processing-policy, and future AI profiles are encrypted
at rest with Laravel's application key. API responses return only non-secret fields and masked
secret indicators. `APP_KEY`, database connectivity, and the Redis broker URL remain bootstrap
secrets in Render because the application and worker require them before database-backed
settings can be decrypted.

## Processing contract

`document_processing_runs` is branch-scoped and idempotent per file and stage. The queue job
carries only trusted server-generated tenant, branch, run, file, and job UUID values. Every
job clears any previous `TenantContext` and `BranchContext`, sets its own trusted context, and
clears both again in `finally`.

Safety scanning uses `DocumentSafetyScanner`. The first adapter speaks the ClamAV `INSTREAM`
protocol over a private TCP connection. Scanner outages retry with bounded backoff and then
fail closed: the file becomes `failed` and the batch becomes `quarantined`. Provider responses,
hosts, credentials, and raw exceptions are never written to user-safe error columns.

Safety scanning does not consume the batch's extraction workflow states. A clean file leaves
the batch at `received`; PR-4 will own the transition to extraction `queued`/`processing`.

## Platform console

Only independently authenticated `PlatformAdministrator` accounts may read settings, and only
tokens with `platform:manage` may change or test them. Every change appends an audit event with
changed field names only—never values. Connection tests use a temporary empty health object for
storage and `PING` for ClamAV. AI credentials may be stored ahead of PR-4, but no provider is
called until the extraction contract and data-region gate are accepted.

## Deployment and activation gate

PR-3 installs the queue contracts, Predis client, jobs, worker heartbeat, scanner adapter, and
administrative settings, but deliberately leaves the production Blueprint unchanged. It does
not provision a Render Key Value service, background worker, or ClamAV service and therefore
introduces no paid Render resource when merged. Processing and scanner settings default to
disabled; completing intake creates no processing run while they are disabled or the queue is
still synchronous.

Activation is a later operational action: approve the plans, add a persistent private Render
Key Value service with `noeviction`, add a dedicated worker for the `documents` queue, provide
a private ClamAV endpoint, wire the shared `APP_KEY`/database/Redis settings, then enable the
integration from the platform console. The activation change must preserve graceful worker
shutdown and bounded retries.

## Explicitly deferred

OCR/extraction, matching, transaction creation, provider-cost metering, tenant BYOS, automatic
retention purge, dead-letter administration, and general retry tooling remain in their owning
PRs. This phase creates no invoice, journal entry, inventory movement, Partner, Product, or Unit.
