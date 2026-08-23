# ADR-002: Secure File Intake and Private Object Storage

- **Status:** Accepted
- **Date:** 2026-08-24
- **Scope:** PR-2

## Decision

Use a platform-managed private Cloudflare R2 bucket through Laravel's S3-compatible
Flysystem adapter. `DocumentStorageService` is the application boundary. Production uses
server environment credentials; local development and tests use a private local disk.
Operational rows store a non-secret storage profile plus an opaque object key, never access
keys, endpoints, or public URLs.

Manual intake is authenticated and protected by tenant context, branch context, active
subscription, `document_center.core` commercial access, and independent RBAC. Uploaded
tenant/branch identifiers are never accepted. Object keys are server-generated UUID paths.

## Threat model and controls

| Threat | Control |
|---|---|
| Cross-tenant or cross-branch access | Global tenant/branch scopes plus route-model binding and middleware |
| Spoofed extension or MIME | Fileinfo magic-byte MIME and extension agreement after upload |
| Oversized or hostile media | Byte, image dimension/pixel, PDF structure/page, and parser timeout limits |
| Duplicate/replayed content | Scoped SHA-256 plus byte-length unique constraint |
| Malware or scanner outage | Pending is not downloadable; infected and failed quarantine fail-closed |
| Leaked storage location | No object key/disk in resources; no public bucket URL |
| Stale shared download | Signed five-minute application URL with full authorization re-check |
| Evidence rewriting/deletion | Immutable evidence fields and no physical-delete endpoint |

## Lifecycle

HTTP completes only safe inspection, private storage, and evidence registration. Files start
`pending`. PR-3 will run the scanner asynchronously and call the internal scan-decision
service. Only `clean` files may be streamed. Intake may move a batch from `draft` to
`receiving` and then `received`; a bad or failed scan moves it to `quarantined` through the
central workflow service.

## Retention and rollback

The default retention hold is 365 days. PR-2 has no physical purge endpoint; the governance
phase will add retention holds and audited purge jobs. Rolling back the migration removes
database metadata only after the application is rolled back. Stored R2 objects must be
retained or removed through an explicit operator runbook; schema rollback must never assume
that deleting evidence bytes is safe.

## Deferred

The scanner implementation and worker topology belong to PR-3. Platform-admin storage UI,
encrypted named profiles, tenant BYOS, retention jobs, usage reporting, and support tooling
remain deferred. OCR, extraction, matching, and transaction creation are not part of PR-2.
