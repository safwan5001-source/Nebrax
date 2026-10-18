# AWJ AI Actions implementation plan

**Work item:** AI-ACTIONS-00

**Planning baseline:** `9a0fcc2a8f9a9f183724e690990656ddaa3e1eda`

**Delivery strategy:** small, reviewable, feature-flagged PRs; product import first

## Goal and sequencing rules

Deliver one secure product-import action workflow before introducing any other action type. Every PR must preserve the traditional product importer, keep mutations off until its safety gates are complete, and include tests for its newly introduced boundary.

The sequence is intentionally layered:

```text
Contracts/state -> safe file -> strict product plan -> editor
       -> immutable preview/approval -> executor -> repair -> rollout
```

No PR should expose a UI control that can advance into an incomplete or unprotected execution path. Feature flags default off. Database migrations, application code, and deployment configuration described below belong to future implementation PRs, not AI-ACTIONS-00.

## Dependencies before implementation

1. Rebase on latest main and refresh the open-PR inventory.
2. Coordinate with draft PR #1562 (AI-08), which currently overlaps the Anthropic provider and assistant panel. Prefer merging/rebasing after it or avoid those files in early PRs.
3. Confirm the production malware-scanning service and durable queue worker expectations; do not change Railway in these PRs.
4. Decide initial action/file/approval retention periods and whether product-import approval requires one approver or maker/checker separation. This plan assumes explicit single-user approval with separately assignable approve permission.
5. Confirm canonical barcode normalization/uniqueness rules and acceptable maximum workbook/row/cell limits with product owners.
6. Confirm translations for **استيراد عبر مساعد أَوْج**, action states, provenance, validation errors, and approval warnings.

## PR 1 — AI-ACTIONS-01: product-import action foundation

**Purpose:** Establish the tenant, workflow, versioning, and authorization boundary with no file upload, model call, UI entry point, or ERP mutation.

### Scope

- Add feature flags/tenant capability for AI Actions, default off.
- Add separate permissions: `ai.actions.use`, `ai.actions.approve`, and `ai.actions.repair`. Product actions also require `products.manage`; cost data requires `products.view_cost`.
- Add `ai_actions`, `ai_action_versions`, and `ai_action_events` migrations/models with tenant-first unique/foreign keys and retention fields.
- Implement a closed `AiActionRegistry` with only an inert `product_import.v1` definition.
- Implement `AiActionGateway` create/read/cancel/edit-version orchestration and explicit state transition service.
- Add strict versioned JSON schemas for action metadata and product proposal rows; reject unknown fields.
- Require `expected_version` on writes and emit a stable 409 conflict contract.
- Record safe, allowlisted action events; no raw row content in generic audit.
- Add authenticated APIs for create/get/cancel and synthetic test-only proposal versioning. Do not expose execution.

### Reuse

Mirror the control order in `AiAssistantGateway`, fresh checks in `AiAssistantPolicy`, tenant behavior in `BelongsToTenant`, and CAS/transition patterns in Document Review/Workflow. Do not subclass the read-only assistant gateway or registry.

### Tests

- tenant A cannot enumerate, bind, edit, or infer tenant B action IDs;
- permission intersections and revoked permissions fail closed;
- user branch context is server-derived and inaccessible assignments are rejected;
- invalid/unknown schema data and illegal state transitions fail;
- two edits with the same expected version yield one success and one 409;
- audit failure prevents security-sensitive transitions;
- feature off means routes are unavailable/forbidden;
- PostgreSQL integration test verifies locking and tenant composite constraints.

### Acceptance gate

An authorized user can create and version an inert product-import action; all cross-tenant, stale, illegal, and unauthorized requests are rejected. No route or service can mutate products.

## PR 2 — AI-ACTIONS-02: secure spreadsheet intake and extraction

**Purpose:** Admit CSV/XLSX safely and produce a deterministic, immutable extracted dataset without model use.

### Scope

- Add `ai_action_files` records that pin storage driver/profile, hash, scan status, safe filename, uploader, retention, and action/tenant.
- Build an action file-intake adapter using private storage, actual MIME/extension agreement, SHA-256 deduplication, and the existing scan-admission pattern.
- Extend a dedicated scan policy to CSV/XLSX; do not broaden Document Center’s PDF/image allowlist globally.
- Deny extraction until CLEAN. Quarantine/reject infected, timed-out, unknown, or oversized files.
- Reuse `SpreadsheetReader` with explicit archive, row, column, cell, string, and processing-time bounds. Never evaluate formulas; define reject/text behavior and test it.
- Persist the file hash and deterministic extracted column/row representation as action version data.
- Add upload/scan-status/extract APIs with idempotency keys and throttles.
- Implement expiry cleanup that respects active execution/audit references.

### Tests

- disguised MIME, double extension, path characters, duplicate hash, oversized CSV/XLSX, zip bomb, external XML entity, corrupt workbook, formula, hidden/blank rows, and encoding cases;
- scan pending/infected/error cannot extract; clean file can extract once and replay result;
- upload and storage paths cannot cross tenants;
- failed database/storage operations clean up consistently;
- fuzz/property tests for bounded parser behavior and deterministic row IDs.

### Acceptance gate

A clean bounded spreadsheet can reach `editing` with stable extracted rows. No model or product service is invoked, and unsafe files never enter extraction.

## PR 3 — AI-ACTIONS-03: strict product planning and validation

**Purpose:** Produce complete Create/Update/Skip/Needs Review proposals by reusing product rules without traditional defaults.

### Scope

- Refactor `ProductImportService` into shared deterministic parsing/matching/validation plus mode-specific planning. Preserve traditional behavior and response contracts byte-for-byte where practical.
- Add strict action mode: missing price, tax, unit, SKU/barcode policy, or required identifiers stays missing/invalid. It must not default purchase price to zero or generate a SKU.
- Centralize create/update through a product domain adapter using `ProductLifecycleService`; remove action need for direct model creation.
- Match only by trusted UUID, exact normalized SKU, and explicitly approved barcode rules. Fuzzy/name candidates are non-binding suggestions.
- Populate value provenance: extracted, user, AI-suggested, ERP-existing, missing.
- Enforce `products.view_cost` before returning, editing, or validating cost values in user-visible payloads.
- Detect in-file and live duplicates, update-locked type/tracking, unit/tax validity, and product inventory restrictions.
- Default matched existing rows to Needs Review, not Update. Require a decision for every row.
- Explicitly exclude stock quantity, opening stock, average cost, journal, type/tracking mutation.

### Tests

- golden regression suite proves traditional CSV/XLSX inspect/preview/apply behavior remains compatible;
- strict mode never invents identifiers, prices, taxes, units, barcodes, or decisions;
- UUID/SKU/barcode matching priority and ambiguous/duplicate cases;
- cost fields are not disclosed through payloads, errors, suggestions, or audit without permission;
- exact validation parity for service/API paths;
- property tests for monetary decimals, Unicode identifiers, normalization, and duplicate ordering;
- live inventory footprint blocks prohibited changes.

### Acceptance gate

Every row has a deterministic proposal/violations and explicit decision. No strict proposal containing missing or invalid required data is previewable, and traditional import remains operational.

## PR 4 — AI-ACTIONS-04: shared interactive editor and both entry points

**Purpose:** Deliver one server-backed editing experience from Products and general AWJ Intelligence, initially with direct/manual corrections only.

### Scope

- Add **استيراد عبر مساعد أَوْج** beside, not in place of, traditional Product Import on the Products page.
- Add a conversation intent hand-off that creates/opens the same action ID. It must not create a second parser or client-side draft.
- Build a reusable action workspace: progress/status, errors, filter/search, editable product table, bulk selection/edits, and Create/Update/Skip/Needs Review controls.
- Desktop uses an editable table with server paging/virtualization as needed. Mobile uses invalid-row filters, summaries, and full-width row editor cards/Sheet.
- Submit typed patches with `expected_version`; refresh both table and conversation from the returned server version.
- Show provenance with icon/text labels, not color only. Support keyboard access, focus restoration, screen readers, dark mode, and RTL/LTR logical layout.
- Use existing semantic tokens and components; add only generic action editor primitives that future action types can reuse.
- Keep final approval/execution disabled because those APIs do not yet exist.

### Tests

- component tests for cell edit, bulk edit, invalid filter, decision changes, provenance, 409 resolution, loading/error/offline states;
- RTL/LTR, Arabic/English, dark/light, keyboard, focus, screen-reader labels, and touch-target checks;
- viewport tests for narrow mobile, tablet, desktop, long identifiers, and large validation messages;
- E2E: Products entry and assistant entry resolve to the same action/workspace/data;
- E2E: traditional import link and behavior remain unchanged.

### Acceptance gate

Both entry points edit the same persisted version. Manual edits revalidate affected data and stale tabs cannot overwrite newer changes. There is still no execution path.

## PR 5 — AI-ACTIONS-05: natural-language corrections, preview, and immutable approval

**Purpose:** Add optional provider assistance and an authoritative final approval boundary, still without ERP mutation.

### Scope

- Add action-specific consent category such as `product_catalog_content` and explicit acknowledgement UI.
- Add schema-bound mapping/correction assistance through server-side Anthropic integration only. Provider output is an untrusted proposed patch, never an applied edit or operation.
- Delimit cell content as data, ignore embedded instructions, minimize requested columns/rows, and omit cost fields without permission.
- Apply network gates, safe audit pre-event, tenant/global budget reserve/finalize, request ledger, throttles, timeout, and sanitized errors.
- Keep all manual/deterministic editing available when the provider is disabled/unavailable.
- Add `ai_action_previews` and `ai_action_approvals` with canonical serialization, keyed preview hash, expiry, approver, confirmation nonce, and invalidation on edits.
- Preview every create/update field diff, skip reason, unresolved/error row, target/version precondition, and totals.
- Reauthorize use/approve/domain/cost permissions and rerun live validation at preview and approval.
- Add an explicit approval control. Plain free-form affirmative text cannot approve without the server-issued preview confirmation nonce.

### Tests

- prompt injection in headers/cells cannot request tools, reveal other rows, change scope, or produce executable operations;
- malformed/unknown/oversized model output and ambiguous natural language become suggestions or errors, never edits;
- consent absent/revoked, provider gate off, budget exhausted, timeout, and audit failure all fail closed with manual fallback;
- data-minimization fixtures verify only permitted fields leave the server;
- identical canonical preview produces stable hash; ordering/value/version changes alter it;
- edit, expiry, target change, permission revocation, and tenant/branch context change invalidate approval;
- click/double-click/replayed approval remains idempotent.

### Acceptance gate

An approver can approve exactly one immutable, error-free preview. No approval survives a meaningful change. No product is mutated yet.

## PR 6 — AI-ACTIONS-06: idempotent product execution and results

**Purpose:** Execute the exact approved preview through product domain services with durable per-row outcomes.

### Scope

- Add `ai_action_operations` records with stable operation key, proposal/preview reference, target precondition, payload hash, attempt/status, safe error, and result resource/version.
- Add execute API requiring `Idempotency-Key`; store HMAC and action/version/preview/actor fingerprint.
- At execution, freshly load actor/action/approval, recheck action/domain/cost permissions, compare preview hash, and revalidate live SKU/barcode/unit/tax/type/tracking state.
- Claim operations transactionally and execute bounded batches through the shared product adapter. Never write product models/SQL from the gateway/provider.
- Persist created/updated/skipped/conflicted/failed result for each row; expose summarized and filtered result views.
- Reconcile unknown commit outcomes by stable operation key before retry. Retry only retryable, uncommitted work.
- Mark partial failure honestly; do not undo committed successful rows automatically.
- Add queue job/worker integration appropriate to existing infrastructure, progress polling, cancellation before unclaimed operations, and operator-safe recovery. No deployment-setting changes in this PR.

### Tests

- double click, concurrent requests, repeated idempotency key, different payload with same key, worker redelivery, timeout after commit, crash before/after result write;
- target edited between preview/approval/execution yields conflict and no overwrite;
- permission/branch/cost revocation after approval prevents execution;
- live duplicate inserted before execution is reported, not silently rematched;
- mixed batch produces durable created/updated/skipped/failed counts and retries only safe rows;
- product activities exist for successful mutations; no stock, average cost, journal, type, or tracking side effect;
- PostgreSQL concurrency and deadlock-retry coverage;
- tenant isolation under guessed operation/result IDs.

### Acceptance gate

Each committed product change is traceable to the approved preview and returns the same durable result on replay. Partial failures neither duplicate successful rows nor conceal conflicts.

## PR 7 — AI-ACTIONS-07: reviewed product repair

**Purpose:** Correct executed product field changes through a separate compensating workflow.

### Scope

- Add repair proposal linkage to original action/version/operation/result and separate repair states/approval records.
- Allow selection of executed rows and typed/natural-language correction drafting; model output remains suggestion only.
- Read current product state and show original before, executed after, current live, and proposed repair values.
- Require target version/conflict checks, `ai.actions.repair`, product/cost permissions, a new preview hash, and explicit approval.
- Execute only supported compensating product updates through the product domain adapter with new idempotency keys/results.
- Do not delete products or reverse inventory/accounting effects. Rows with downstream use or concurrent edits remain Needs Review and link to the appropriate manual domain workflow.

### Tests

- repair without original successful operation, permission, preview, or approval fails;
- post-import concurrent edits and inventory footprint produce conflict without overwrite;
- repair approval cannot reuse original approval/idempotency key;
- repair retry/replay is idempotent and preserves both histories;
- cost redaction and tenant/branch isolation apply to before/current/after diffs.

### Acceptance gate

A supported correction is separately previewed, approved, executed, and audited. Unsupported reversal is explicitly refused with a safe next action.

## PR 8 — AI-ACTIONS-08: hardening and controlled rollout

**Purpose:** Prove operability and enable the product-import action incrementally.

### Scope

- Load/performance tests at documented limits, queue interruption/recovery drills, retention/cleanup jobs, and scan/provider outage exercises.
- Safe metrics and alerts for stuck states, scan backlog, execution retries, conflict/failure rates, budget exhaustion, and denied cross-scope attempts.
- Admin-visible capability/permission documentation and user help for provenance, approval, partial failure, and repair limitations.
- Accessibility and bilingual UX review; responsive visual regression across supported breakpoints/themes.
- Security review of upload, prompt injection, tenant isolation, canonical hashing, replay, and authorization freshness.
- Enable for internal/test tenant, then a small allowlist. Preserve kill switches for provider assistance and all action execution independently.
- Confirm traditional import analytics/error rate remain unchanged before broader rollout.

### Acceptance gate

Security, accessibility, performance, recovery, and audit evidence is approved; no critical/high findings remain; rollback/disable procedure is exercised without impacting traditional import.

## Required data migration strategy

Future migrations should be additive and reversible at the schema level:

1. Create action/version/event tables and composite tenant foreign keys.
2. Add file records separately so storage/scanning can ship without execution.
3. Add preview/approval records before approval APIs.
4. Add operation/result records before execution.
5. Add repair linkage/state only when repair ships.

Use UUIDs consistent with current models, JSON only for versioned typed documents, and relational columns/indexes for tenant, state, type, version, actor, expiry, idempotency, and operational queries. Unique constraints must include tenant/action boundaries. Do not alter or backfill existing product import jobs in the first release.

The migration review must test MySQL/production compatibility if applicable and PostgreSQL behavior used by concurrency tests. Large JSON and retention/index costs need measured fixtures, not estimates alone.

## API and contract principles

- Namespace and version action contracts independently of the current assistant message contract.
- Require `Idempotency-Key` for create/upload/provider command/approve/execute/repair commands and `expected_version` or `If-Match` for edits.
- Return typed error codes with safe localized messages and correlation IDs; do not leak provider text, SQL, storage paths, or cross-tenant existence.
- The server returns authoritative state, proposal version, and preview identity after every command.
- Long operations return accepted/status resources and never depend on a browser tab remaining open.
- Maintain backward compatibility for all current product import/export routes and payloads.

## Cross-PR automated test matrix

| Area | Minimum required coverage |
|---|---|
| Unit/schema | Strict parsing, canonical JSON/hash, money/decimal handling, provenance, transition map, operation keys |
| Feature/API | Auth, RBAC, cost policy, tenant/branch isolation, expected version, idempotency, throttles, localized errors |
| Domain | Product validations, matching, uniqueness, units/taxes, locked fields, inventory footprint, no stock/accounting effects |
| Database | Composite tenant constraints, row locks, races, deadlocks, replay, partial results, repair conflicts on real supported database |
| File security | MIME, extension, hash, scan admission, zip/XML limits, formulas, corrupt/oversized/high-cardinality inputs |
| Provider security | Consent, minimization, injection, tool refusal, malformed output, budgets, timeouts, gate/provider outage |
| UI | Shared entry points, manual/NL synchronization, bulk edits, invalid filtering, approval identity, progress/results, stale conflicts |
| Accessibility/i18n | Keyboard, focus, screen reader, reduced motion, contrast, Arabic/English, RTL/LTR, number/bidi handling |
| E2E | Upload through repair, duplicate submission, partial failure/retry, permission revoked mid-flow, stale approval, traditional import regression |
| Operations | Worker crash/restart, unknown commit reconciliation, scan outage, retention, metrics redaction, feature/kill switches |

Security tests must use at least two tenants, users with differing branch assignments, and actors with/without cost, approve, and repair permissions. Tests that use SQLite alone are insufficient for lock/idempotency claims.

## Product import release acceptance criteria

The product-import feature may leave its allowlist only when all of the following are demonstrated:

1. CSV/XLSX bytes remain private, scanned, bounded, and tenant-isolated.
2. Every row is classified Create, Update, Skip, or Needs Review and every update match uses a trusted identifier.
3. Missing prices, taxes, units, identifiers, and decisions remain unresolved; no AI/default invents them.
4. Direct and conversational edits converge on one version and revalidate affected rows.
5. The final preview lists every operation/diff and its canonical hash is bound to explicit approval.
6. Changes after preview—including concurrent ERP edits and permission changes—prevent stale execution.
7. Double submission, worker retry, and network retry cannot duplicate an ERP operation.
8. Results durably report created, updated, skipped, conflicted, and failed rows.
9. Repair is a separate proposal/preview/approval, and unsupported reversal is not attempted.
10. No product action changes stock quantity, average cost, journals, product type, or tracking silently.
11. Both UI entry points use the same action; the traditional importer remains available and compatible.
12. Anthropic calls require explicit consent, minimized permitted data, network gate, budget, and safe audit; deterministic/manual flow works without Anthropic.
13. Required CI, security, accessibility, concurrency, and recovery suites pass on the rebased head.

## Future expansion after product import

Do not begin these until the product-import workflow has production evidence:

- **Customer import:** add partner schema/matcher and branch-sharing adapter; exclude opening balances.
- **Supplier import:** reuse partner action shell with supplier classification and the same opening-balance exclusion.
- **Draft purchase invoice:** adapt PurchaseService/Document draft patterns; create draft only, explicit tax/currency/prices, no posting/payment.
- **Draft expense:** adapt ExpenseService/Document draft patterns; create draft only and prohibit silent tax/account defaults.

Each is a separate registry entry and PR series with domain-specific threat model, permissions, schemas, preview, and tests. “Draft” must be encoded in the action type and executor, not merely described in the prompt.

## Recommended immediate next action

Open **AI-ACTIONS-01: product-import action foundation** after AI-08 coordination. Keep it deliberately inert: contracts, tenant-owned persistence, explicit state/version service, closed registry, permissions, safe audit events, and adversarial tests only. This is the smallest reviewable change that establishes the security boundary every later upload, UI, provider, approval, execution, and repair feature depends on.
