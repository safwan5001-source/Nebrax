# Intelligent Document Center — Implementation Plan

## Non-negotiable decisions

The center is an optional commercial application in the Nebrax modular monolith. Its capability is `document_center.core`; commercial Add-on, Trial, and Legacy grants use the existing entitlement platform. Operational records are tenant- and branch-scoped. Future provider defaults, rules, and dictionaries are company-wide with an optional explicit branch override.

Processing will become asynchronous, but no queue or worker is introduced before its architecture gate. Every state change belongs to `DocumentWorkflowService`. The center can only produce transaction **drafts**: it never calls `post()`, approves, posts, creates journal entries, or moves inventory. It never creates Partner, Product, or Unit master data automatically.

`TransactionDraftBuilder` will be the only boundary to existing sales, purchase, and expense domain services. It will call those services rather than write transaction tables. The MVP expense remains one financial amount; extracted lines remain review evidence. Creating one sales invoice from multiple delivery notes requires a reusable delivery-note domain outside this module first.

## Delivery sequence

### PR-1 — Foundation

Register the commercial capability and product, initial RBAC permissions, `DocumentBatch`, the append-only workflow event ledger, explicit statuses and transition service. Add architecture records, tenant/branch isolation, entitlement, workflow, migration, and regression tests. There are no production endpoints or UI.

### PR-2 — Secure file intake

**Gate before implementation:** select object storage, residency, encryption, signed-access, retention, deletion, checksum, size/MIME controls, and quarantine contract. Add `document_files` and authenticated intake only after the gate. No extraction.

**Implemented decision:** platform-managed Cloudflare R2 through an S3-compatible storage
service; local private disk only for development/tests. This phase adds authenticated manual
batch/file intake, immutable evidence metadata, streaming storage, SHA-256, magic-byte MIME
checks, image/PDF safety limits, branch-scoped duplicate protection, pending/clean/infected/
failed scan states, fail-closed quarantine, and short-lived signed downloads. Default
retention is 365 days and remains configurable. No OCR, queue, worker, automatic scanner,
public object URL, provider-secret API, purge endpoint, or transaction creation belongs here.

### PR-3 — Processing orchestration and platform integrations

**Accepted implementation:** establish Laravel Redis queue contracts for a future persistent private Render Key Value service with the `noeviction` policy and a dedicated worker on the `documents` queue. PR-3 does not provision those paid services and leaves processing disabled by default. Processing runs are branch-scoped and idempotent per file/stage, jobs rebuild trusted tenant and branch contexts and clear them in `finally`, retries are bounded, failures are stored only as safe codes/messages, and worker heartbeat plus run counts are visible to platform administrators after activation.

The platform administration console owns encrypted operational settings for private document storage, ClamAV TCP scanning, processing policy, and a deferred AI credential profile. Secret values are masked after save and configuration changes require the current platform administrator password. Bootstrap secrets such as `APP_KEY`, database credentials, and `REDIS_URL` remain deployment-managed. After the operator activates both processing and scanning and provides a real asynchronous queue, this phase queues malware scanning after intake; while inactive it creates no processing run. It adds no OCR, AI extraction, matching, transaction creation, posting, journal, or inventory behavior.

### PR-4 — Extraction provider

**Status: implemented — foundation only.** The platform console now holds encrypted, masked, server-side-only profiles for OpenAI, Anthropic Claude, and Google Gemini. The extraction engine and every provider are disabled by default. In addition, PR-4 fixes a code-level external-provider network gate to `false`: saved profiles, connection-test requests, queue workers, and adapters cannot send a document or make a real provider call in any deployment until a later, separately approved activation phase deliberately changes that code. Primary and ordered fallback providers are configurable; all adapter output normalizes to the versioned `document-schema-v1` evidence contract; and append-only attempts and usage events remain isolated from financial data. Raw provider payloads, credentials, and raw provider error text are never stored in user-safe fields. Provider selection, processing region, data-protection terms, retention policy, credentials, and failover remain explicit operator-owned configuration decisions; no vendor, region, retention posture, paid Render resource, durable storage migration, or worker activation is imposed automatically.

### PR-5 — Matching and issues

**Status: implemented — evidence foundation only.** PR-5 reads `document-schema-v1` encrypted extraction evidence and produces deterministic branch-scoped match results, ranked candidates, and open review issues. Counterparty matching is role-filtered and prefers normalized VAT ID; products prefer visible barcode then SKU then normalized description; units reuse `UnitConversion`; and financial validation uses integer minor units with explicit inclusive/exclusive tax logic and bounded rounding differences. Strong logical duplicates become blocking review issues, while weaker total/date matches remain warnings. No candidate is confirmed automatically, missing Partner/Product/Unit never creates master data, the batch remains in `needs_review`, and PR-5 creates no review API, review UI, transaction draft, posting, journal, or inventory effect. PR-6 owns human confirmation and review workspace behavior.

### PR-6 — Review workspace API

Add real read/review endpoints with authentication, tenant context, branch context, independent RBAC, and commercial access middleware. Mutations delegate to the workflow service.

### PR-7 — Review workspace UI

Build the RTL-first review UI with Nebrax design tokens and accessible states. Add navigation only when the page is usable. No direct status mutation or automatic approval.

### PR-8 — TransactionDraftBuilder

Add the sole transaction boundary. Map reviewed data and call the existing invoice, purchase, or expense domain service to create a draft. Do not call `post()`, write transaction/journal tables, or move inventory. Store transaction links here, with idempotency and audit evidence.

### PR-9 — General delivery-note domain

Design and implement a reusable delivery-note domain outside the center before allowing several delivery notes to produce one sales-invoice draft. If that domain is not approved, this flow remains out of scope.

### PR-10 — Channels and integrations

Add approved external channel identities and vendor-neutral intake adapters. Apply replay protection and the same file/intake policies; do not embed channel credentials in operational rows.

### PR-11 — Operations, usage, and governance

Complete dashboards, safe retry tools, usage/cost reporting, retention jobs, redaction, audit export, support diagnostics, and tenant-visible processing status without exposing secrets or provider payloads.

### PR-12 — Hardening and rollout

Run security, isolation, recovery, performance, accessibility, and migration rehearsals. Roll out behind commercial assignment and application state, monitor fail-closed behavior, and document rollback/incident procedures.

## Global acceptance constraints

No phase may bypass tenant/branch scopes, the entitlement platform, RBAC, or workflow ownership. No future table is added before its owning PR. Any endpoint classifies read/write/export explicitly. The application remains independently assignable and does not acquire technical dependencies on sales, purchases, expenses, or Fuel Stations.
