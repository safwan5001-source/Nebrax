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

**Status: implemented — purchase-invoice draft only.** `TransactionDraftBuilder` exposes the neutral `DraftBuildContext` and `CreatedDraftReference` contract; `PurchaseDraftBuildOptions` keeps warehouse/cost-center choices inside the purchase adapter. `PurchaseDocumentDraftBuilder` is the sole purchase transaction boundary. From a locked, reviewed `purchase_invoice` in `ready_for_draft`, it resolves server-trusted confirmed supplier/product/unit matches and calls `PurchaseService::create()` to create exactly one `draft` Purchase. It explicitly sets `received_status = pending` and `paid_on_post = 0`; it never calls `post()`, writes transaction/journal tables directly, moves inventory, pays, approves, or creates master data.

The builder uses an outer database transaction and `DocumentWorkflowService` transitions (`ready_for_draft → creating_draft → draft_created`). It resolves supplier/product/unit matches only from the locked current extraction result. `document_transaction_links` is immutable and unique per tenant/branch/batch/type; it remains visible as `linked_purchase` after a normal draft, posted, or cancelled purchase status, and a valid existing link yields the original transaction as an idempotent replay. `PurchaseService::deleteDraft()` rejects a linked draft before deleting lines, so the document audit chain cannot be torn by a foreign-key error or a UI race. Amounts are integer minor units, currencies are SAR-only until a separately approved conversion policy exists, and quantities must be positive integers no greater than 1,000,000. Invalid data, stale versions, missing readiness, inaccessible/invalid master data, or a financial-total mismatch roll back without a Purchase, link, or completed workflow transition.

The protected create endpoint requires both the write entitlement for `document_center.core` and `documents.center.build_draft`. The review UI presents the CTA only when that capability, document type, workflow state, and no-existing-link conditions all hold. It presents the safe linked purchase number, URL, and current status after completion or posting, and hides review-completion controls outside the actual review state. The ordinary Purchase create form links reviewers to ready document batches; it does not import browser-controlled financial data. See [ADR-007](ADR-007-PURCHASE-DRAFT-BUILDER.md).

### PR-8 — Expense draft builder

**Status: implemented — one draft Expense header only.** `ExpenseDocumentDraftBuilder` implements the neutral `TransactionDraftBuilder` contract and is the sole document-center boundary for reviewed `expense` evidence. From a locked current result in `ready_for_draft`, it accepts only the trusted review choices `account_id`, optional `category_id`/`cost_center_id`, and `payment_method`; it then calls `ExpenseService::create()` exactly once. The created Expense remains `draft`. It never calls `post()`, writes expense or journal tables directly, creates a payment, moves stock, or creates a Partner or other master record.

The Expense amount is the explicit reviewed base minor-unit amount. SAR is the only accepted currency, all monetary values and tax rates are validated as bounded integers, and the derived amount/tax/total must reconcile with the reviewed evidence within the existing one-minor-unit tolerance. For a tax-inclusive document, `subtotal_minor` must already be an explicit reviewed base; the builder never reverses tax from a total or uses floating-point arithmetic. Extracted receipt lines remain evidence only and never become expense lines or products. Credit requires one current, confirmed, active visible supplier match; cash and bank create neither payment nor accounting effect.

The new logical `transaction_type + transaction_id` link supports Purchase and Expense through a new migration that removes the purchase-only foreign key while preserving existing purchase links. Links and review audit records are immutable. The Expense link remains visible after normal posting or cancellation, replays idempotently, and protects a linked Expense draft from deletion. The protected endpoint requires both `document_center.core` write entitlement and `documents.center.build_draft`; the RTL-first review workspace uses the general `linked_transaction` projection and asks only for non-financial options. See [ADR-008](ADR-008-EXPENSE-DRAFT-BUILDER.md).

### PR-9 — General Delivery Note Domain

**Status: implemented — operational evidence only.** PR-9 introduces the branch-scoped `DeliveryNote`, `DeliveryNoteLine`, `DeliveryNoteEvent`, and `DeliveryNoteService` outside Document Center, Fuel, and Procurement. It owns draft/update/confirm/cancel with append-only events, central branch-safe document numbering, exact quantity/unit preservation, independent RBAC, and `sales.invoicing` commercial access. It creates no Invoice or InvoiceLine, no allocation, no StockMovement, no journal, no payment, and no master data. The present Invoice posting lifecycle remains the stock owner to avoid a double deduction. See [ADR-009](ADR-009-GENERAL-DELIVERY-NOTE-DOMAIN.md).

### PR-10 — Multiple Delivery Notes → Sales Invoice Draft

**Status: implemented; PR #488 open and current SQLite/PostgreSQL/Web/Vercel CI green; independent human review pending.** PR-10 owns the full-note allocation and anti-reuse contract for several confirmed delivery notes that share one customer and warehouse. `DeliveryNoteSalesInvoiceDraftBuilder` locks deterministic source rows, resolves explicit or active customer-default price lists, and invokes `InvoiceService::create()` exactly once to produce one sales-invoice **draft**. It records immutable build, header-allocation, and source-line links with idempotency checksum semantics and append-only source events. Linked drafts and their lines cannot be updated, deleted, duplicated, or rebuilt through the general invoice path; the linked delivery note cannot be cancelled.

No partial allocation, remaining quantity, unlink/rebuild correction, source return, new inventory timing, posting, journal, payment, or stock effect belongs to this phase. `InvoiceService::post()` remains the exclusive owner of ledger and inventory effects, so draft creation writes **no journal entry**. The protected preview/build APIs use `delivery_notes.invoice` plus read/write `sales.invoicing` access, and build uses the same invoice plan limit as normal invoice creation. The shared bilingual RTL/LTR wizard is reachable from Delivery Notes selection/detail and an explicitly labelled invoice-form shortcut; its local fixture is labelled presentation-only. See [ADR-010](ADR-010-DELIVERY-NOTES-TO-SALES-INVOICE-DRAFT.md).

### PR-11 — Channels and Integrations

Add approved external channel identities and vendor-neutral intake adapters. Apply replay protection and the same file/intake policies; do not embed channel credentials in operational rows.

### PR-12 — Operations, Usage, Retention, and Governance

Complete dashboards, safe retry tools, usage/cost reporting, retention jobs, redaction, audit export, support diagnostics, and tenant-visible processing status without exposing secrets or provider payloads.

### PR-13 — Hardening and Gradual Rollout

Run security, isolation, recovery, performance, accessibility, and migration rehearsals. Roll out behind commercial assignment and application state, monitor fail-closed behavior, and document rollback/incident procedures.

## Global acceptance constraints

No phase may bypass tenant/branch scopes, the entitlement platform, RBAC, or workflow ownership. No future table is added before its owning PR. Any endpoint classifies read/write/export explicitly. The application remains independently assignable and does not acquire technical dependencies on sales, purchases, expenses, or Fuel Stations.
