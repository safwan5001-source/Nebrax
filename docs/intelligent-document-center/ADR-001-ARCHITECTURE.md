# ADR-001: Intelligent Document Center Architecture

- **Status:** Accepted
- **Date:** 2026-08-23
- **Scope:** PR-1 foundation and constraints on later delivery

## Context and problem

Nebrax needs a safe path from business documents to reviewed transaction drafts. Documents may contain sensitive tenant data, cross branch boundaries if scoped incorrectly, and eventually pass through external extraction systems and asynchronous workers. A direct OCR-to-accounting pipeline would couple uncertain evidence to financial posting and master-data creation.

## Decision

Build the center as a bounded module inside the existing modular monolith. `document_center.core` is an optional, independent commercial capability. It uses the existing Application Catalog, commercial assignment, Add-on/Trial/Legacy entitlement resolution, `TenantApplicationState`, and RBAC. No parallel entitlement system is permitted.

PR-1 stores only `DocumentBatch` and append-only `DocumentWorkflowEvent`. Files, attempts, extraction, matching, provider configuration, usage, transaction links, and channel identities belong to their owning future PRs. No upload, OCR, AI, queue, worker, or transaction draft exists in the foundation.

## Module boundary

The module owns document intake lifecycle, evidence, extraction, matching, review, and its audit trail as those capabilities arrive. It does not own Partners, Products, Units, accounting, inventory, sales, purchases, expenses, or delivery notes.

A future `TransactionDraftBuilder` is the only allowed boundary to transaction domains. It calls existing domain services to create drafts and never writes transaction tables directly. Calling `post()`, approving, posting, creating journal entries, moving inventory, or creating master data automatically is forbidden. Expense extraction lines remain review evidence while the MVP expense retains one financial amount.

Several delivery notes cannot create one invoice until a reusable, general delivery-note domain exists outside this module.

## Tenant and branch policy

`DocumentBatch` and every workflow event are explicitly BranchScoped and also inherit tenant isolation. Trusted `TenantContext` and `BranchContext` provide scope identifiers at creation; caller payload identifiers are ignored. Operational rows carry both `tenant_id` and `branch_id`, with indexes that make isolation and work-queue access explicit rather than relying on a parent relationship.

Future provider defaults, matching rules, and default dictionaries are CompanyWide. A branch-specific change uses a separate explicit override record. PR-1 creates none of those tables.

## Application, entitlement, and RBAC policy

Commercial access and authorization are independent gates:

1. The catalog capability must exist and be built.
2. Existing commercial entitlement must be effective.
3. `TenantApplicationState` must permit access.
4. The actor must hold the precise RBAC permission.

Neither entitlement nor RBAC overrides the other. Future routes combine authentication, tenant and branch middleware, `EnsureCommercialApplicationAccess`, and one of the independent `documents.center.view`, `manage`, `review`, or `settings` permissions. PR-1 adds no empty route.

## Workflow ownership

`DocumentWorkflowService` owns all transitions. It uses an explicit transition matrix, a database transaction, a row lock plus version check, and writes exactly one append-only event for each successful transition. Invalid or stale transitions roll back without an event. `approved` is not a document-center state because transaction approval belongs to transaction domains.

Audit metadata is bounded, JSON-safe, and rejects secret/raw-payload keys. User-safe failure messages must never contain provider payloads or credentials.

## Rejected alternatives

- **Separate microservice now:** rejected because it adds distributed consistency and operations before the domain and load are proven.
- **Direct OCR/provider calls in controllers:** rejected because it couples transport, credentials, retries, and lifecycle.
- **Synchronous end-to-end processing:** rejected because extraction latency and transient failures require future asynchronous orchestration.
- **Direct transaction-table writes:** rejected because they bypass domain validation and accounting invariants.
- **Automatic posting/approval/master-data creation:** rejected because uncertain extraction cannot exercise financial authority.
- **Company-wide operational batches:** rejected because documents and review queues are branch operational data.
- **Pre-creating future tables:** rejected because storage, queue, provider, matching, and channel contracts are not decided.
- **Reusing Fuel Station integration tables:** rejected; their patterns are informative, but their bounded context and evidence contracts differ.

## Consequences and risks

The foundation has a small stable schema and a strong audit trail. Later providers and infrastructure remain replaceable, and commercial access uses platform semantics consistently. The cost is more explicit gates and service boundaries. Row locks and optimistic versions reduce conflicting transitions, but worker concurrency and retry semantics still require PR-3 decisions. Append-only history and retained commercial registrations require deliberate retention and privacy policies.

## Deferred decisions and gates

| Before | Decision gate |
|---|---|
| PR-2 | Object store, data residency, encryption, access URLs, retention/deletion, checksum, limits, quarantine and malware-scanning boundary |
| PR-3 | Queue and worker technology, topology, idempotency, locking, retries, dead letters, timeouts, observability and recovery |
| PR-4 | Extraction provider, processing region, DPA/contract, retention, credential management, adapter contract, fallback and usage metering |
| PR-5 | Matching confidence policy, rule/dictionary versioning, ambiguity and issue taxonomy |
| TransactionDraftBuilder PR | Mapping contract, idempotency, draft links, domain-service error handling and explicit proof that no posting occurs |
| Delivery-note PR | General delivery-note ownership, lifecycle, aggregation and invoice-draft contract |
| Integrations PR | Channel identity, authentication, replay prevention, rate limits and revocation |

A gate is complete only when its decision, threat model, rollback behavior, and tests are recorded in a follow-up ADR before implementation begins.

## PR-2 accepted storage and intake decision

Nebrax uses a private, platform-managed Cloudflare R2 bucket through the S3-compatible
Flysystem adapter. Application code depends only on `DocumentStorageService`; object keys
and credentials never appear in API resources. Runtime credentials remain server-side
environment secrets. A later platform-admin screen may manage named storage profiles, and
tenant BYOS may add profiles, without changing the intake contract.

Authenticated manual intake stores files as `pending` and never permits download until an
internal safety scanner records `clean`. `infected` and scanner `failed` decisions are
fail-closed and quarantine the batch. The scanner worker belongs to PR-3; PR-2 exposes only
the internal decision-recording boundary. Downloads use a short-lived signed application
route which re-runs authentication, tenant/branch scopes, RBAC, and commercial access.

File evidence is immutable: detected MIME, SHA-256, byte length, page count, and object key
cannot be rewritten through the model. Upload validation combines Laravel edge rules with
server-side magic-byte detection, extension agreement, image bounds, and `pdfinfo` page
limits. The initial retention period is 365 days and purge remains retention-aware work for
the governance PR; no endpoint can physically delete evidence in PR-2.
