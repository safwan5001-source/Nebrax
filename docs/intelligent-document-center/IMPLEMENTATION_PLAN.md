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

### PR-3 — Processing orchestration

**Gate before implementation:** select queue/worker technology, deployment topology, idempotency, concurrency, retries, dead-letter handling, and observability. Add processing attempts/runs and worker orchestration without provider-specific extraction data.

### PR-4 — Extraction provider

**Gate before implementation:** approve provider, processing region, contractual/data-protection terms, retention, credentials, and failover. Add the provider adapter, company-wide provider settings with explicit branch overrides, extraction results/fields/lines, and usage/cost events. Never store raw provider errors in user-safe fields.

### PR-5 — Matching and issues

Add deterministic matching results, versioned rules and dictionaries, review issues, and explicit ambiguity handling. Missing Partner/Product/Unit creates a review issue, never master data.

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
