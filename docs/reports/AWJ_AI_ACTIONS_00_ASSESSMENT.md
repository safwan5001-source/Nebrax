# AWJ AI Actions — AI-ACTIONS-00 assessment

**Assessment date:** 2026-10-18

**Base:** latest `origin/main`, `9a0fcc2a8f9a9f183724e690990656ddaa3e1eda`

**Scope:** architecture and planning only; no application code, migrations, provider calls, or deployment changes

## Executive assessment

Nebrax already has most of the safety primitives needed for AI Actions, but they currently live in three separate systems:

- AWJ Intelligence provides a read-only, consent-gated Anthropic gateway with fresh authorization, scope enforcement, budgets, idempotency, and safe audit metadata.
- Product import provides deterministic CSV/XLSX parsing, matching, validation, durable jobs, and product lifecycle integration.
- Document Center provides quarantined files, explicit versioned workflow transitions, conflict detection, and idempotent draft builders.

The correct implementation is to compose and generalize these patterns behind a new typed action gateway, not to give the current assistant tools mutation access and not to build a second product importer.

Two material gaps block safe execution today. First, the traditional product importer deliberately defaults a missing purchase price to zero and generates a missing SKU; the AI workflow is required to leave those values unresolved. Second, the durable import job records chunk progress but is not a per-operation approval/result ledger and therefore cannot prove that each executed row was part of the immutable approved preview.

## Inspection method and scope

The review followed routes from authenticated API entry points through controllers, services, models, migrations, policies, and the React UI. It inspected only the requested domains: Intelligence/Anthropic, products/import/export, partners, purchases/expenses, Document Center, tenant/RBAC/branch controls, audit/transactions/idempotency, and reusable UI/design tokens.

The worktree was created directly from the fetched latest `origin/main`. Open GitHub pull requests were also checked to identify overlapping AI work. No paid provider call was made.

## Repository evidence

### AWJ Intelligence and Anthropic

| Evidence | Finding | Reuse decision |
|---|---|---|
| `routes/api.php:373-423` | Intelligence routes sit behind Sanctum, user principal, tenant, branch, active-subscription middleware, specific `ai.assistant.use` permission, and throttles. | Reuse middleware; add separate action permissions and action-specific throttles. |
| `app/Services/AiAssistantGateway.php:24-39`, `:92-160`, `:222-240`, `:480-525` | Current gateway sequences authorization, scope, consent, budget reservation, required audit, provider invocation, and fresh tool authorization. | Reuse its control-flow pattern, not its read-only class as a mutation gateway. |
| `app/Services/AiAssistantToolRegistry.php:9-30` | Tool registry is closed and currently exposes only deterministic read tools. | Preserve read-only registry. Add a separately typed `AiActionRegistry`. |
| `app/Services/AiAssistantPolicy.php:13-88` | Effective access is platform ∩ tenant ∩ actor ∩ tool permission and the actor is freshly loaded. | Generalize to action/use/approve/repair plus domain permission checks. |
| `app/Services/AiAssistantScopeGuard.php:10-79` | Invalid branch/warehouse scope is explicitly rejected and queries are tenant scoped. | Reuse semantics; add domain-specific action scope adapters. |
| `app/Services/AiRequestLedger.php:10-120` | Idempotency keys are HMACed; fingerprint mismatches and in-progress requests are rejected. | Reuse pattern for commands, plus an operation-level durable ledger. |
| `app/Services/AiBudgetService.php:18-180` | Reservations use fixed global-then-tenant locking order and are finalized against actual usage. | Reuse for optional extraction/correction calls. Deterministic processing consumes no AI budget. |
| `app/Services/AiAuditRecorder.php:10-133` | Required events fail closed; metadata is allowlisted and excludes prompt/reply/raw financial or document content. | Reuse recorder for safe envelope events; store authorized action detail separately. |
| `app/Services/AnthropicAssistantProvider.php:17-25`, `:53-169`, `:177-247` | Provider is server-only, network-gated, two-phase, receives minimized/redacted content, rejects document instructions, and is explicitly framed as read-only. | Keep it read-only. Add schema-bound action assistance behind the new gateway. |
| `app/Services/AssistantNetworkGate.php:7-17` | External network access defaults off. | Preserve as a mandatory provider gate. |
| `web/src/modules/intelligence/api.ts:12-15` and `web/src/modules/intelligence/store.tsx:17-24` | Browser calls AWJ APIs only; state is memory-only, identity-reset, and stale-request aware. | Keep provider credentials and authoritative drafts off the client. Persist action drafts server-side. |
| `web/src/modules/intelligence/contract.ts:1-59` | Current contract has only three finance read tools and narrow data categories. | Version the new action contract and add explicit product-catalog consent classification. |

Conclusion: the existing assistant is correctly designed as a read-only financial conversation layer. Mutation should be an adjacent workflow with deliberate hand-off, not an expansion of a tool definition from “read” to “write.”

### Product catalog and imports

| Evidence | Finding | Reuse decision / gap |
|---|---|---|
| `routes/api.php:496-519` and `app/Http/Controllers/Api/ProductController.php:139-188` | Traditional inspect/preview/apply and durable workbook import already exist; cost authorization is checked server-side. | Preserve APIs and UI. New action handler calls the same lower-level rules. |
| `app/Services/ProductImportService.php:21-35` | Import explicitly uses inspect → preview → apply, and apply revalidates. It excludes stock quantity, average cost, journals, type/tracking mutation. | Strong base for deterministic action parsing and execution. |
| `app/Services/ProductImportService.php:70-125` | Interactive and durable row limits are 2,000 and 20,000; batches are 100. | Adopt bounded limits initially; make action execution resumable per operation/batch. |
| `app/Services/ProductImportService.php:140-261` | Column inspection, field contract, preview rows, counts, warnings, and errors already exist. | Extract/reuse typed components rather than reproduce mapping rules. |
| `app/Services/ProductImportService.php:447-564`, `:1033-1069` | Parser detects file duplicates and matches existing products first by stable UUID then SKU; name is not an identifier. | Preserve trusted matching and extend explicit barcode handling only under domain uniqueness rules. |
| `app/Services/ProductImportService.php:1404-1417` | Type/tracking updates are locked. | Preserve; live-check inventory footprint at execution. |
| `app/Services/ProductImportService.php:1437-1453` | Create currently defaults missing purchase price to `0` and generates a document-number SKU. | Blocking gap: add strict planning/execution mode so AI Actions never default or invent these values. |
| `app/Services/ProductImportService.php:1499-1583` | Live SKU/barcode conflicts are checked immediately around apply. | Reuse and also capture preview preconditions for stale approval detection. |
| `app/Services/ProductImportService.php:1610-1623` and `app/Support/SpreadsheetReader.php:10-52` | CSV and XLSX are parsed internally without formula execution. | Reuse reader after clean-file admission. |
| `app/Support/SpreadsheetReader.php:256-273`, `:327`, `:361` | XLSX archive entries are bounded and XML uses `LIBXML_NONET`. | Good parser hardening; still add scan/quarantine, cell/string/time limits, and formula policy. |
| `app/Http/Requests/ImportProductsRequest.php:24-77` | Current upload accepts CSV/TXT/XLSX up to 5 MB and has durable options. | Reuse validation bounds; MIME must be content-verified by secure intake. |
| `app/Support/ProductImportFields.php:7-120` | Import/export share field metadata including required, clearable, locked, and writable flags. | Make this the field-contract source for action schemas and UI labels. |
| `app/Services/ProductLifecycleService.php:24-29`, `:74-107`, `:231-254` | Lifecycle service intentionally excludes quantity/cost/journal effects, guards type/tracking changes, and records product activity. | All action mutations must route through this layer or a refactored product domain adapter. |

`ProductImportService::apply` uses `ProductLifecycleService` for updates but creates new products directly before lifecycle activity handling. A future refactor should expose one domain-level create/update batch adapter and make both import modes call it. This should be behavior-preserving for the traditional importer.

### Durable import jobs

| Evidence | Finding | Reuse decision / gap |
|---|---|---|
| `app/Services/ImportJobService.php:53-118` | `(tenant, idempotency key)` plus file/domain fingerprint handles duplicate job creation and races. | Reuse the HMAC/fingerprint approach. |
| `app/Services/ImportJobService.php:278-414` | Chunk apply is row-locked, options are frozen, completed jobs replay safely, and product chunks call `ProductImportService`. | Reuse chunking mechanics or adapt them behind action operations. |
| `app/Models/ImportJob.php:8-24` and `database/migrations/2026_09_17_010000_create_import_jobs_table.php:26-67` | Job stores tenant, file metadata, SHA, actor/timestamps, cursor, and latest apply result. | Insufficient as the immutable proposal/approval/per-row result ledger. Do not overload it with AI state. |
| `app/Services/ImportJobFileStorage.php:10-127` | Private local/S3 storage is abstracted and tenant/job paths are isolated. Reads use current configured driver while stored disk is mostly audit data. | Reuse storage abstraction, but action file records must pin the actual storage profile for later reads. |

### Partners and future imports

| Evidence | Finding | Future constraint |
|---|---|---|
| `app/Models/Partner.php:15-35`, `:84-106` | Customer and supplier are classifications of one tenant model with branch-aware sharing. | Use one partner import adapter with classification-specific schema and scope rules. |
| `app/Services/Accounting/PartnerService.php:30-50` | Create can also post an opening-balance journal in one transaction. | Exclude opening balance from initial AI imports; handle it as a separate explicit financial action. |
| `app/Http/Requests/StorePartnerRequest.php:14-43` and `app/Http/Requests/UpdatePartnerRequest.php:5-19` | Opening balance is accepted only on create and treated as an accounting operation. | Never hide it in a customer/supplier import default. |
| `app/Http/Controllers/Api/PartnerController.php:68-91` | Create uses the service while update currently writes the model after validation. | Introduce/reuse a shared update service before AI execution; do not copy controller behavior. |

Names and phone numbers are unsuitable automatic match keys. Future matching must use stable IDs, explicit partner codes, or validated VAT identifiers; fuzzy matches remain suggestions requiring review.

### Purchases, expenses, and Document Center

| Evidence | Finding | Reuse decision / gap |
|---|---|---|
| `app/Services/Accounting/PurchaseService.php:18-43`, `:60-225`, `:250-387` | Service separates draft creation/update from posting and calculates line/tax totals. | Future action may create draft only through this service. Posting remains a separate operation. |
| `app/Services/Accounting/ExpenseService.php:11-26`, `:48-186` | Draft and post are separate, but create supplies a default 15% tax when absent. | AI schema must require explicit tax confirmation and not inherit the default silently. |
| `app/Services/DocumentCenter/PurchaseDocumentDraftBuilder.php` and `app/Services/DocumentCenter/ExpenseDocumentDraftBuilder.php` | Builders lock extraction batches, validate actor branch access, call domain services, create transaction links, and replay existing results. | Extract generic typed adapters/patterns; builders are coupled to document batches and should not be called with fabricated extraction records. |
| `app/Services/DocumentCenter/DocumentFileIntakeService.php:25-114` | Intake verifies files, detects duplicate hash, persists private files, starts pending scan, and cleans up failed writes. | Reuse storage/scan primitives through an action-specific spreadsheet intake adapter. |
| `app/Services/DocumentCenter/DocumentFileInspector.php:19-66` | Actual MIME, extension agreement, safe name, size, and SHA-256 are checked, but allowed types are documents/images. | Extend policy for CSV/XLSX in a focused PR; do not weaken Document Center’s allowlist. |
| `app/Services/DocumentCenter/DocumentReviewService.php:29-54`, `:243-250` | Review fields are allowlisted and edits use expected version under a lock. | Direct model for action edits and conflict responses. |
| `app/Services/DocumentCenter/DocumentWorkflowService.php:14-84` | State transitions are enumerated and applied transactionally with workflow events. | Direct model for the action state machine. |

Financial draft actions must require explicit supplier/account/branch/currency/price/tax/payment inputs. Posting, payments, irreversible ledger work, opening balances, and stock adjustments remain separately authorized actions outside the first product-import scope.

### Tenant, RBAC, branch, audit, and transactions

| Evidence | Finding | Required action behavior |
|---|---|---|
| `app/Tenancy/BelongsToTenant.php:9-23` and `app/Tenancy/TenantScope.php:9-20` | Tenant-owned models receive tenant ID and a global tenant query scope. | Every action table is tenant-owned; still validate tenant on all related IDs and unique constraints. |
| `app/Models/BaseModel.php:10-38` | Route binding has a tenant fallback guard. | Use scoped action route binding and return not found across tenants. |
| `app/Tenancy/BelongsToBranch.php:9-23`, `app/Tenancy/BranchScope.php:10-49` | Branch is primarily a write tag; operational/accounting read rules differ and are not one universal global scope. | Registry handler declares its scope semantics. Never treat a client branch header as authorization. |
| `app/Tenancy/BranchContext.php:5-11` and `app/Models/User.php:39-88` | Active branch comes from trusted middleware and actor assignments determine access; no assignment can mean all. | Capture trusted context for audit, then re-check branch access during preview, approval, and execution. |
| `app/Support/Rbac.php:19-221` | Roles and permissions include `ai.assistant.use`, `products.manage`, and separate `products.view_cost`. | Add `ai.actions.use`, `ai.actions.approve`, and `ai.actions.repair`; always intersect with domain and cost permissions. |

Product catalog data is currently company-wide rather than branch-owned. The active branch should still be captured for actor context/audit, but the product handler must not pretend that catalog rows are branch-scoped. Later purchase/expense/partner actions use their real branch semantics.

### UI and design system

| Evidence | Finding | Reuse decision |
|---|---|---|
| `web/src/app/(app)/products/page.tsx:297-302` | Products header already links to traditional import and workbook flows. | Keep them and add **استيراد عبر مساعد أَوْج** as a distinct action. |
| `web/src/app/(app)/products/import/page.tsx:49-201` | Traditional UI already has setup, preview, apply, result steps and durable upload/apply loops. | Do not replace it. Share lower-level contracts where suitable. |
| `web/src/components/intelligence/assistant-panel.tsx:107-342` | Assistant uses a responsive logical-side Sheet and becomes full-screen on mobile. | Use it for intent, summaries, corrections, and row cards; large desktop review can open an action workspace. |
| `web/src/components/intelligence/assistant-trigger.tsx:37-55` | Assistant is available on desktop and through the mobile account menu. | General conversational entry point already exists. |
| `web/src/components/data-table.tsx:43-100`, `:304-454` | DataTable supports selection, sticky UI, bulk actions, and a separate mobile record rendering. | Reuse patterns/tokens, but implement typed editable cells and server paging as a focused component. |
| `web/src/components/nebrax/mobile-record.tsx:6-90` | Mobile records encode priority and safe bidirectional text. | Reuse for review summaries and row navigation. |
| `web/src/components/ui/sheet.tsx:25-46` | Sheet uses logical end and RTL-correct transforms. | Reuse for mobile row editor and confirmation panels. |
| `design-system/tokens/awj.tokens.json:1-93`, `:159-250` and `web/tailwind.config.ts:24-57` | Semantic surface/status/interaction/edit/focus tokens exist for light and dark themes. | No new hard-coded product colors; provenance also needs text/icon labels. |

## AI-08 conflict assessment

AI-08 financial conversation fixes are **not present** in the assessed main SHA. Draft PR `#1562`, `[AI-08] Financial conversation accuracy and mobile UX`, is open with base `4d8b02fd` and head `973e9709` (checked 2026-10-18). It changes the Anthropic provider, answer guard, assistant panel, and related tests to address current-month grounding, negative expense signs, markdown/overflow, and coarse-pointer keyboard hints.

AI-ACTIONS-00 adds only new documentation, so it does not conflict. The first implementation PR should rebase after AI-08 or avoid editing its touched provider/panel files until it lands. The action design must not assume those fixes are already deployed.

Other open AI architecture PRs were reviewed at a high level. Their draft status is not treated as a main-branch contract; implementation should refresh the open-PR inventory immediately before coding.

## Reuse disposition

### Reuse directly

- authenticated tenant/branch middleware and existing domain permissions;
- spreadsheet reader limits and deterministic product field contract;
- product lifecycle rules and live SKU/barcode conflict checks;
- private file storage abstraction and scan-admission pattern;
- budget, network gate, safe audit, and request-ledger patterns;
- expected-version workflow and transition patterns;
- AWJ semantic tokens and responsive layout primitives.

### Adapt behind new contracts

- product importer parsing/validation into strict proposal versus traditional modes;
- durable chunk runner into per-operation execution/results;
- Document Center intake/scanning for spreadsheet MIME types;
- document draft builders into generic purchase/expense draft adapters;
- assistant conversation into a hand-off to a persisted action workspace.

### Do not reuse as-is

- traditional create defaults for missing purchase price/SKU;
- Document Center batch models as fake containers for spreadsheet actions;
- current read-only tool registry as a mutation registry;
- free-form model text as a proposal, approval, operation, identifier match, or repair instruction;
- controller-level partner update or direct model writes as action executors.

## Known risks and open design checks

1. Product create/update paths need one shared domain adapter before two import modes can guarantee identical business rules.
2. Barcode normalization and uniqueness rules should be documented and tested across all barcode storage paths before automatic matching is enabled.
3. The current import-job storage driver behavior should be corrected or isolated for long-lived action files.
4. Malware-scanner behavior, timeout, and operator recovery must be verified in each deployment before spreadsheet actions are enabled.
5. Large imports require durable queue workers and reconciliation; a synchronous request loop is not a reliable execution boundary.
6. Approval retention, file retention, and provider data retention require product/legal policy decisions.
7. Permission design must decide whether approval/repair are assignable separately by tenant administrators and whether high-value financial actions require two people. Product import v1 needs at least explicit single-user approval plus domain permission.
8. Cost fields must be completely omitted or redacted for users lacking `products.view_cost`, including prompts, errors, exports, and audit.
9. Repair cannot promise full reversal after downstream inventory or accounting use; the UI must communicate compensating/conflicted outcomes.

## Assessment conclusion

Proceed with a product-import-only foundation. The recommended next PR should add inert, feature-flagged action contracts, persistence, registry entry, and state/version tests without ERP mutation or Anthropic integration. This establishes the approval and tenant boundary before file processing or UI work begins. Detailed sequencing and acceptance gates are in `docs/plans/AWJ_AI_ACTIONS_IMPLEMENTATION_PLAN.md`.
