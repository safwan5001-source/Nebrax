# AWJ AI Actions architecture

**Work item:** AI-ACTIONS-00

**Status:** Proposed; documentation only

**Repository baseline:** `main` at `9a0fcc2a8f9a9f183724e690990656ddaa3e1eda`

**First use case:** Product import from CSV or XLSX

## 1. Decision summary

AWJ AI Actions will be a server-controlled workflow for proposing and executing ERP changes. It extends the AWJ Intelligence experience, but it does not turn the current Anthropic provider into a database writer. The provider may extract untrusted content and suggest typed edits; deterministic AWJ code owns validation, authorization, preview generation, approval, execution, and repair.

The canonical workflow is:

```text
Upload -> Extract -> Validate -> Edit -> Preview -> Approve -> Execute -> Repair
             |          |         |          |          |
        untrusted    ERP rules   new      immutable   existing business
          input       + RBAC    version   hash        services only
```

The following decisions are normative:

1. Add a separate `AiActionGateway` and closed `AiActionRegistry`. Keep `AiAssistantGateway` read-only.
2. Store every proposal as immutable, versioned typed data. Edits create a new version and invalidate prior previews and approvals.
3. Bind an approval to the tenant, actor, action, version, canonical preview hash, expiry, and current authorization context.
4. Reauthorize and revalidate against live ERP state immediately before execution. Approval is necessary, but never sufficient by itself.
5. Execute through existing ERP services and adapters. Claude never writes SQL, invokes models directly, or receives credentials.
6. Treat repair as a new proposed action with its own preview and approval. Repair is compensating work, not rollback by an AI model.
7. Preserve the traditional product importer. Both “Import via AWJ Assistant” entry points create the same `product_import` action workflow.

## 2. Existing foundations

The design deliberately reuses these current mechanisms:

- `AiAssistantPolicy`, `AiAssistantScopeGuard`, `AiRequestLedger`, `AiBudgetService`, and `AiAuditRecorder` for the patterns of fresh authorization, trusted tenant/branch scope, HMAC idempotency fingerprints, reservation/finalization, and allowlisted audit metadata.
- `ProductImportService`, `ProductImportFields`, `ProductLifecycleService`, and the durable `ImportJobService` for deterministic spreadsheet parsing, product rules, lifecycle audit, private file storage, and chunk execution.
- `DocumentFileInspector`, `DocumentFileIntakeService`, and scan admission for MIME detection, content hashes, quarantining, and clean-file admission. Spreadsheet intake needs an action-specific adapter because Document Center presently accepts PDF/images.
- `DocumentWorkflowService` and `DocumentReviewService` for explicit transitions, row locking, expected-version checks, and append-only review history.
- `PurchaseService`, `ExpenseService`, `PurchaseDocumentDraftBuilder`, and `ExpenseDocumentDraftBuilder` as future adapters for draft-only financial documents.
- Existing Sheet, DataTable, MobileRecord, form controls, and semantic AWJ tokens for responsive RTL/LTR interaction.

The current importer cannot be used unchanged for an AI proposal. Its create path supplies `purchase_price = 0` and generates a SKU when omitted. AI Actions must reject or mark these values `needs_review`; it must never pass unresolved rows into those defaulting paths.

## 3. Trust boundaries

| Boundary | Trusted responsibilities | Untrusted or non-authoritative input |
|---|---|---|
| Browser | Displays server state; sends user intent and idempotency keys | Uploaded bytes, cell edits, natural-language commands |
| AWJ API | Identity, tenant, branch, RBAC, schema validation, state transitions | Client-supplied scope, action status, hashes, computed totals |
| Deterministic extractors | File structure parsing within resource limits | Cell text, formulas, hidden rows, workbook metadata |
| Anthropic | Optional extraction/mapping/correction suggestions | All model output; tool requests; claims about permissions or ERP state |
| ERP adapters | Live matching, validation, preview, service calls | Stale proposal snapshots and externally suggested identifiers |
| Database/private storage | Canonical workflow and audit records | Nothing may be written by Claude or generated SQL |

Uploaded file content is data, never instructions. Model prompts must delimit file content and state that instructions embedded in documents are to be ignored. Tool availability is supplied only from the server registry.

## 4. Server components

### 4.1 AI Action Gateway

`AiActionGateway` is the single mutation-orchestration entry point. It:

- resolves identity from authenticated middleware and tenant/branch from trusted contexts;
- loads the action with tenant-scoped queries;
- checks action permission plus the underlying ERP permission on every request;
- performs compare-and-swap state/version transitions;
- invokes only handlers registered by `AiActionRegistry`;
- records safe audit events before and after sensitive transitions;
- enforces consent, provider network gates, data minimization, and budget before optional model calls;
- never accepts a model-selected class, route, SQL fragment, tenant ID, or service method.

The existing `AiAssistantGateway` continues to serve read-only conversation tools. Conversation messages can request creation or opening of an action, but all subsequent mutations pass through `AiActionGateway`.

### 4.2 Closed action registry

Each registry entry is code-defined and includes:

```text
action type and schema version
create/use/approve/repair permissions
allowed tenant and branch scope mode
consent data categories
input, proposal, preview, and result schemas
extractor and deterministic validator
preview builder and immutable hash profile
executor adapter and repair planner
retention/redaction policy
```

The initial entry is `product_import.v1`. Future entries are `customer_import.v1`, `supplier_import.v1`, `purchase_invoice_draft.v1`, and `expense_draft.v1`. Registration alone does not expose an action: the platform flag, tenant entitlement, actor permissions, and network/consent settings must all allow it.

### 4.3 Workflow and version service

The workflow service owns transitions under a database transaction and row lock. It requires `expected_version` for all edits and returns HTTP 409 with the current version when stale. Proposal rows are immutable within a version. A correction creates a complete new version or an immutable patch whose resolved canonical document is persisted.

### 4.4 Domain handlers

A handler is an anti-corruption layer between generic actions and an ERP domain. `ProductImportActionHandler` will reuse product field metadata, parsing, matching, validations, cost policy, and lifecycle operations, while adding the stricter AI contract. It must not fork a second spreadsheet import engine.

Handlers return typed violations and operations; they do not return free-form execution instructions.

## 5. Persistence proposed for future implementation

No migration belongs to AI-ACTIONS-00. Future implementation should add approximately these tenant-owned records:

| Record | Purpose and important fields |
|---|---|
| `ai_actions` | UUID, tenant, type/schema, state, creator, trusted branch context, current version, file reference, timestamps, expiry |
| `ai_action_versions` | Action/version unique key, canonical proposal JSON, validation summary, source lineage, creator, proposal hash |
| `ai_action_previews` | Version, canonical operations JSON, live preconditions, totals, preview hash, generated/expiry timestamps |
| `ai_action_approvals` | Preview hash, approver, permission snapshot/digest, explicit acknowledgement, expiry, revoked/consumed timestamps |
| `ai_action_operations` | Stable operation key, row/source reference, kind, target, payload hash, status, attempts, result/error, before/after versions |
| `ai_action_events` | Append-only workflow/audit event, actor, safe metadata, correlation and request IDs |
| `ai_action_files` | Private storage locator, original/safe name, MIME, size, SHA-256, scan state, uploader, retention timestamp |

Every table carries `tenant_id`; unique keys begin with tenant/action identity. Foreign keys must prevent cross-tenant association. The stored file record must pin the storage driver/profile used at upload rather than treating it as informational.

Raw prompts, provider replies, entire spreadsheets, tax IDs, and financial values do not belong in generic audit metadata. Action versions and results use separately authorized storage and retention rules.

## 6. Typed proposal contract

All schemas are strict: unknown properties are rejected, enums are closed, strings and row counts are bounded, and schema versions are explicit. Money is represented as currency plus integer minor units; quantities and rates use bounded decimal strings, never binary floating point.

A product row contains:

```json
{
  "row_id": "stable-source-row-id",
  "source_row": 17,
  "match": {
    "kind": "sku",
    "value": "SKU-100",
    "target_product_id": "uuid-or-null",
    "target_version": "updated-at-or-version-or-null"
  },
  "decision": "create|update|skip|needs_review",
  "fields": {
    "name": {"value": "...", "origin": "extracted", "confidence": null},
    "purchase_price": {"value": null, "origin": "missing", "confidence": null}
  },
  "violations": [
    {"code": "purchase_price_required", "field": "purchase_price", "severity": "error"}
  ]
}
```

Allowed origins are `extracted`, `user`, `ai_suggested`, `erp_existing`, and `missing`. An AI suggestion remains visibly identified until a user accepts or changes it. Confidence never converts a suggestion into approval.

Product matching is limited to trusted identifiers in priority order: AWJ/Nebrax UUID, then exact normalized SKU, then exact normalized barcode where domain rules permit. Name, description, telephone, or fuzzy similarity may suggest a candidate for human review but may never select an update target.

The product contract requires explicit resolution of:

- name, type, tracking, unit, SKU/barcode policy, sales and purchase prices, and applicable tax fields;
- duplicate identifiers within the file and against live tenant data;
- cost visibility/edit permission before exposing purchase price;
- update-locked type/tracking rules and existing inventory footprint;
- a deliberate Create, Update, Skip, or Needs Review decision for every row.

No action may silently change stock quantity, average cost, opening stock, journals, product type, or tracking behavior.

## 7. Canonical preview and approval

Preview generation reruns deterministic validation against live ERP data and materializes every proposed operation. A preview includes row counts, exact create/update field diffs, skips with reasons, unresolved rows, cost/tax/unit effects, and live preconditions.

Canonical JSON uses one documented serialization profile: schema-versioned field order, UTF-8, normalized line endings, explicit nulls, stable row/operation ordering, and decimal strings. The server computes:

```text
preview_hash = HMAC-SHA256(server_key,
  tenant_id | action_id | action_type | version | canonical_preview)
```

The approval record binds that hash to the approver and expiry. Approval is invalid when any of these occurs:

- proposal or preview version changes;
- target product version/identifier changes;
- file hash or schema changes;
- tenant or trusted branch context changes;
- approval expires or is revoked;
- approver loses action or underlying product permission;
- validation results differ materially at execution.

The UI must show a final, explicit approval control adjacent to the immutable preview identity. A chat utterance such as “looks good” is not sufficient unless the user is responding to a server-issued confirmation control and the API receives its opaque confirmation nonce.

## 8. State machine

| State | Allowed transition | Guard |
|---|---|---|
| `created` | `uploading`, `cancelled` | Creator can use action type |
| `uploading` | `scanning`, `failed` | File closed, hash and metadata persisted |
| `scanning` | `extracting`, `rejected`, `failed` | Clean scan admission only |
| `extracting` | `editing`, `failed` | Bounded deterministic extraction; optional model call governed |
| `editing` | `editing`, `previewing`, `cancelled` | Expected version; every edit creates a version |
| `previewing` | `ready_for_approval`, `editing`, `failed` | Live deterministic validation; zero blocking errors |
| `ready_for_approval` | `approved`, `editing`, `expired` | Explicit approval of current preview hash |
| `approved` | `executing`, `editing`, `expired` | Reauthorization and live precondition check |
| `executing` | `completed`, `partially_failed`, `failed` | Idempotent operation claims and durable results |
| `completed` / `partially_failed` | `repair_drafting` | Separate repair permission; immutable result basis |
| `repair_drafting` | `repair_ready`, `cancelled` | New proposal and live conflict validation |
| `repair_ready` | `repair_approved`, `repair_drafting`, `expired` | Separate preview/hash/approval |
| `repair_approved` | `repair_executing` | Fresh permission and precondition checks |
| `repair_executing` | `repaired`, `repair_partially_failed`, `repair_failed` | Compensating idempotent operations |

Terminal/error states never transition by client-supplied status. A retry is a server event that either resumes unclaimed operations or returns the existing result.

## 9. Execution, retries, and partial failure

The execution request requires an `Idempotency-Key`. The server stores only an HMAC of the key and a fingerprint of action/version/preview/actor intent. Reuse with a different fingerprint is rejected; concurrent use returns in-progress or the original result.

Each preview operation has a deterministic key such as `action/version/row/operation`. An operation is claimed in a short transaction, executed through the domain adapter, and finalized with a durable result. The executor must:

1. reload the action, approval, actor, tenant, and permissions;
2. compare preview hash and all live target preconditions;
3. revalidate identifier uniqueness, tax/unit existence, and update locks;
4. call the existing product lifecycle/import service in bounded batches;
5. save per-row status and references without losing earlier successful results;
6. return created, updated, skipped, conflicted, and failed counts.

Atomicity is per safe domain unit, not a promise that a 20,000-row job is one transaction. A failed row or batch remains failed with a sanitized code; successful committed operations are not replayed. Retry processes only retryable, uncommitted operations after renewed live validation. Unknown commit outcomes require reconciliation by operation key before retry.

## 10. Product import experience

### Entry points

- Products page: keep the existing traditional “Import Products” action and add **استيراد عبر مساعد أَوْج** (“Import via AWJ Assistant”).
- General AWJ Intelligence conversation: an import intent opens or creates the same `product_import.v1` action.

Both routes navigate to the same action ID and workflow APIs. The assistant may retain conversational context, but it does not own a separate parser, validator, or executor.

### Editing

Desktop presents a filterable editable table with frozen identity/status columns, row selection, bulk field/decision edits, and an invalid-row filter. Mobile presents summary cards and one-row-at-a-time editing in a full-width logical-end Sheet or dedicated action workspace; it does not compress a spreadsheet grid into the chat column.

Direct field edits and conversational corrections both submit typed patches against `expected_version`. For example, “set purchase price to 12.50 for SKU-100” is resolved server-side to a proposed patch, shown to the user when ambiguous, then applied as a new version. The table and conversation read the same resulting server version, so neither maintains an independent draft.

All affected rows are revalidated. Missing prices, tax choices, units, or identifiers remain visibly missing; Claude may not invent them. Bulk changes show their scope before application and are reversible by creating a later version. Extracted, user-entered, AI-suggested, and existing ERP values have distinct labels/icons that do not rely on color alone.

The final preview lists every operation and changed field. Existing products default to `Needs Review` when a trusted identifier matches; there is no implicit Update decision and no silent overwrite.

### Design system and directionality

Use existing AWJ semantic surface, interaction, editing, status, and focus tokens; Sheet’s logical side behavior; DataTable/MobileRecord responsive patterns; and existing Input, Select, Badge, Button, Card, Stepper, and FormActions primitives. Text and numbers that require stable direction use `bdi`/`dir="auto"`. Logical spacing and start/end alignment are mandatory for RTL/LTR parity. Interactive targets retain the established mobile touch size and keyboard focus treatment.

## 11. Repair model

Repair starts from immutable execution results and records the current live resource versions. The user chooses affected operations or describes the intended correction; the server creates a repair proposal containing compensating updates and exact before/current/after diffs.

Repair never assumes it can delete a created product, reverse stock, or restore an old row blindly. If a product was subsequently edited, referenced, transacted, or acquired inventory footprint, the precondition fails and the row becomes `needs_review`. Destructive reversals, posting, journal changes, payments, and stock adjustments remain separate domain operations outside product-import repair.

Repair uses the same validate/preview/approve/execute controls and distinct permissions. Its audit links the original operation, repair version, approval, compensating result, and any unresolved conflict.

## 12. Future action contracts

- **Customer and supplier imports:** reuse the unified `Partner` model, branch-sharing rules, and `PartnerService`. Match only trusted codes, VAT identifiers, or stable IDs. Opening balances are excluded because creation can post accounting entries; they require a separate financial action. A shared update service should be introduced before action execution rather than copying controller/model updates.
- **Draft purchase invoices:** create drafts through `PurchaseService` or a generic adapter extracted from `PurchaseDocumentDraftBuilder`. Supplier, branch, currency, line prices, tax codes/rates, and totals must be explicit. Posting and payment are separate approvals and action types.
- **Draft expenses:** create drafts through `ExpenseService` or a generic adapter extracted from `ExpenseDocumentDraftBuilder`. Account, branch, currency, amount, payment method, and tax must be explicit rather than inheriting silent defaults. Posting/payment remain separate.

These action types share workflow, version, preview, approval, idempotency, audit, and UI contracts. They do not share domain validation or permission adapters.

## 13. Anthropic consent, minimization, and budgets

Deterministic CSV/XLSX parsing and ERP validation do not require Anthropic. A model call is made only when it adds value to mapping or a natural-language correction and all of these are true:

- platform and tenant network gates are enabled;
- the user has acknowledged the exact action data category (for example `product_catalog_content`);
- the request can be minimized to necessary column names/cells or a bounded correction context;
- tenant/global budget reservation succeeds;
- the audit pre-event succeeds.

Strip workbook metadata and unrelated columns, redact values not needed by the request, and never send tenant secrets, internal authorization data, attachments wholesale, existing catalog dumps, or cost fields the actor cannot view. Cache/reuse deterministic mappings where safe. Finalize budget reservations with actual usage, sanitize provider errors, and provide a fully manual/deterministic fallback when the provider is unavailable.

## 14. Threat model and controls

| Threat | Required control |
|---|---|
| Malicious or oversized workbook/zip bomb | Actual MIME check, extension agreement, size/row/cell/archive limits, quarantine and malware scan, `LIBXML_NONET`, time/memory limits, private storage |
| Spreadsheet formula/CSV injection | Treat formulas as text or reject them; never evaluate; escape dangerous leading characters on any later export |
| Prompt injection in cells | Delimit as untrusted data, ignore embedded instructions, closed tool/action registry, validate all model output against strict schema |
| Cross-tenant or branch access | Trusted middleware contexts, tenant global scope plus explicit foreign-key checks, domain-specific branch guard, adversarial tests |
| Stale approval/concurrent edit | Expected-version writes, immutable preview hash, target version preconditions, approval invalidation and live revalidation |
| Replayed/double-clicked execution | HMAC idempotency ledger, request fingerprint, unique operation keys, durable result replay |
| Privilege revoked after approval | Fresh actor/action/domain permission checks immediately before every execution or repair batch |
| Silent overwrite/fuzzy match | Trusted identifiers only; explicit Update choice; full diffs; conflicting rows return to review |
| Provider exfiltration or excessive spend | Explicit consent category, minimized payload, network gate, global/tenant budgets, no browser API keys |
| Partial or unknown commit | Per-operation ledger, bounded transactions, reconcile by stable operation key, retry only safe unresolved work |
| Tampered client preview | Server-generated canonical preview and keyed hash; client never supplies authoritative operations/hash |
| Accounting side effects | Product import excludes stock/journals; partner opening balances and financial posting/payment are separate action types |

## 15. Compatibility and operational requirements

- Existing product import/export routes, contracts, and UI remain backward compatible.
- New routes are feature-flagged and default off until the workflow and security suites pass.
- Metrics contain action type/state/counts/latency and safe error codes, never raw row content.
- Retention jobs expire uploads, provider context, unapproved drafts, and approvals according to tenant policy while retaining the minimal immutable audit trail.
- Administrators can disable provider assistance without disabling deterministic editing/execution.
- No execution proceeds when the audit store, action store, authorization source, or relevant domain service is unavailable.

## 16. Acceptance invariants

An implementation conforms to this architecture only if:

1. no model or browser can write ERP state except through a registered, server-authorized executor;
2. every committed mutation maps to an explicit approval of the exact immutable preview;
3. tenant, branch, action, and domain permissions are checked from live trusted context;
4. duplicate requests return the original result and cannot duplicate a row operation;
5. unresolved or fabricated price, tax, unit, or identifier data cannot reach execution;
6. product imports cannot modify stock quantity, average cost, journals, type, or tracking silently;
7. partial results and repair history remain durable and reviewable;
8. the Products page and Intelligence conversation use one workflow and executor;
9. traditional import behavior remains available and unchanged; and
10. provider consent, minimization, network gates, budgets, and safe audit rules apply to every external call.
