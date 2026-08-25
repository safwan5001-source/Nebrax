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

### PR-6 — Human review workspace

Add authenticated read and review endpoints with tenant/branch context, independent RBAC, and commercial access middleware, together with the RTL-first review workspace and gated navigation. Original extraction evidence remains immutable; human edits are append-only overlays projected deterministically for review. Confirmation, rejection, issue state, and completion use locked domain services with an optimistic batch version; no direct status mutation or automatic approval is allowed. `ready_for_draft` means review completeness only and is reached through `DocumentWorkflowService`; it does not create a transaction draft.

### PR-7 — TransactionDraftBuilder

**Status: implemented — purchase-invoice draft only.** `PurchaseDocumentDraftBuilder` is the sole purchase transaction boundary. From a locked, reviewed `purchase_invoice` in `ready_for_draft`, it resolves server-trusted confirmed supplier/product/unit matches and calls `PurchaseService::create()` to create exactly one `draft` Purchase. It explicitly sets `received_status = pending` and `paid_on_post = 0`; it never calls `post()`, writes transaction/journal tables directly, moves inventory, pays, approves, or creates master data.

The builder uses an outer database transaction and `DocumentWorkflowService` transitions (`ready_for_draft → creating_draft → draft_created`). `document_transaction_links` is immutable and unique per tenant/branch/batch/type; a valid existing link yields the original draft as an idempotent replay. Amounts are integer minor units, currencies are SAR-only until a separately approved conversion policy exists, and quantities must be positive integers no greater than 1,000,000. Invalid data, stale versions, missing readiness, inaccessible/invalid master data, or a financial-total mismatch roll back without a Purchase, link, or completed workflow transition.

The protected create endpoint requires both the write entitlement for `document_center.core` and `documents.center.build_draft`. The review UI presents the CTA only when that capability, document type, workflow state, and no-existing-link conditions all hold. It presents a safe purchase number/link after completion. The ordinary Purchase create form links reviewers to ready document batches; it does not import browser-controlled financial data. See [ADR-007](ADR-007-PURCHASE-DRAFT-BUILDER.md).

### PR-8 — General delivery-note domain

Design and implement a reusable delivery-note domain outside the center before allowing several delivery notes to produce one sales-invoice draft. If that domain is not approved, this flow remains out of scope.

### PR-9 — Channels and integrations

Add approved external channel identities and vendor-neutral intake adapters. Apply replay protection and the same file/intake policies; do not embed channel credentials in operational rows.

### PR-10 — Operations, usage, and governance

Complete dashboards, safe retry tools, usage/cost reporting, retention jobs, redaction, audit export, support diagnostics, and tenant-visible processing status without exposing secrets or provider payloads.

### PR-11 — Hardening and rollout

Run security, isolation, recovery, performance, accessibility, and migration rehearsals. Roll out behind commercial assignment and application state, monitor fail-closed behavior, and document rollback/incident procedures.

## Global acceptance constraints

No phase may bypass tenant/branch scopes, the entitlement platform, RBAC, or workflow ownership. No future table is added before its owning PR. Any endpoint classifies read/write/export explicitly. The application remains independently assignable and does not acquire technical dependencies on sales, purchases, expenses, or Fuel Stations.
