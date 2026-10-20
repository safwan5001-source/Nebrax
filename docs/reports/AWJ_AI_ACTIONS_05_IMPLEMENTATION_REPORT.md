# AWJ AI-ACTIONS-05 — Safe Product Import Execution

**Branch:** `ai-actions-05-safe-product-import-execution` · **Base:** `main` @ `a2a740f9aea6bf73a9b3a707394387c2feb3381c` (after PR #1580)
**Scope:** apply an *approved* product-import preview to the catalogue. No accounting, stock, tax/price-rule or schema change beyond the two new tables. No Anthropic call, no Railway change, no merge/deploy.

## 1. What was implemented

| Requirement | Delivery |
|---|---|
| Execute through existing services | Creates go through `ProductService::create` (the canonical creator used by the product screen and Public API), updates through `ProductLifecycleService::update` (inventory-identity guard + `ProductActivity` audit). One minimal change to a shared service: `ProductService::create(..., bool $generateSku = true)` — the default is unchanged; AI execution passes `false` so an identifier is never invented. |
| Only approved decisions | The executor never reads the editable proposal. Every value comes from the **immutable stored preview** the user approved, re-proven against the approval hash. Rows: Create / Update / Skip (a *skip* row is recorded `skipped`, nothing written). |
| No write without a valid approval | `POST /ai-actions/{id}/executions` requires status `approved`, a non-revoked, unexpired approval for the current version, the approver = executor, an unmodified preview, and a **live recomputation** of the preview equal to the approved hash (any product/draft drift ⇒ `409 approval_stale`, approval revoked, **zero writes**). Approving never executes. |
| No silent defaults | Values are the explicit approved ones (an explicit `0` stays `0`; barcode-only rows get **no** generated SKU). Category/brand resolve to a managed id when the name matches exactly one record, otherwise free text (the traditional importer's default policy); unit templates are **deferred**. |
| Re-check at execution | Fresh actor/tenant/flag, role permissions (`ai.actions.approve` + `products.manage`), branch context, and `products.view_cost` whenever the approved preview holds purchase prices; per-row live checks (target product version unchanged, SKU/barcode still free). |
| Another user's / tenant's / action's approval | `403 approval_owner_mismatch` (approver ≠ executor); other tenant ⇒ 404; each approval is bound to its own action, version and preview hash. |
| Idempotency & races | `UNIQUE(tenant, approval)` on `ai_action_executions` ⇒ an approval can be executed once; the action row is locked while the execution + its row ledger are created; a replay (same or different `Idempotency-Key`) returns the recorded execution; a **lease** (`locked_until`, one atomic `UPDATE`) forbids two concurrent runs (`409 execution_in_progress`) and is recovered after expiry; each row runs in its **own transaction** with `lockForUpdate` on its result row; a finished row is final (model guard + status check). |
| Per-row results | `ai_action_execution_rows`: `success / failed / skipped / pending`, `product_id`, `error_code`, safe `error_message`, `retryable`, `attempts`, `changed_fields` (names only — never cost values), `deferred`. |
| Retry policy | `POST …/executions/{id}/retry` re-runs only **failed rows marked retryable** (`database_conflict`, `internal_error`), under a still-valid approval of the same user, never touching successful rows. Data failures (`target_changed`, `conflict_existing_product`, `rule_rejected`) are non-retryable: they need a new import. |
| Audit trail | Events `execution_started`, `execution_batch_processed`, `execution_completed|partially_failed|failed`, `execution_retry_requested`, `execution_blocked_stale` (ids/counts/hashes only) + `ProductActivity` `created`/`updated` attributed to the executing user. |
| Images | **Deferred, stated everywhere.** Nothing is fetched, attached or replaced. The preview now marks image sources `status: deferred` + warning `media_deferred`; each executed row lists `deferred: ['images']`; the UI says so and never counts images as imported. Reason: the existing safe media path (archive/URL ingestion) is dark by default and needs its own egress review. |
| Unit templates | Also deferred (`unit_template_deferred` warning): a template overrides the base unit and multiplies incoming stock quantities, so applying it would silently change the unit. |
| UI | After a valid approval the preview screen shows **«تنفيذ الاستيراد» / “Run import”** (explicit button + confirmation; approval never runs it). Progress bar and counts, per-row results (status, product link, applied fields, deferred fields, repairable errors), status filter, retry button only when retryable rows exist, double-click guard, polling when another request holds the run. Arabic/English (from `<html lang>`), RTL logical layout, mobile cards, AWJ tokens/components. Editing/new preview is locked once execution starts. |
| Feature flag | `AI_ACTIONS_EXECUTION_ENABLED` (default **off**), independent of `AI_ACTIONS_ENABLED`; off ⇒ `403 execution_disabled`. Batch size `AI_ACTIONS_EXECUTION_BATCH_ROWS` (200), lease `AI_ACTIONS_EXECUTION_LEASE_SECONDS` (120). |
| Traditional import | Untouched (`ProductImportService`, routes, UI). `ProductService::create` default behaviour unchanged (covered by a test). |

Preview adjustments needed for an honest execution: category/brand "before" now reads the managed reference name (no phantom change); `unit_template` is no longer listed as a change; images flagged deferred.

## 2. API

| Route | Permission | Notes |
|---|---|---|
| `POST /ai-actions/{id}/executions` | `ai.actions.approve` | `Idempotency-Key`, `expected_version`. Starts, or **continues**, the single execution (one batch of up to `execution_batch_rows` rows per call; the UI loops until finished). 201 new / 200 recorded (`AI-Action-Execution-Replayed`). |
| `GET /ai-actions/{id}/executions/{id\|latest}` | `ai.actions.use` | Progress, counts, paged rows (`status` filter). No cost values. |
| `POST /ai-actions/{id}/executions/{id}/retry` | `ai.actions.approve` | Retryable failed rows only. |

Errors: `execution_disabled`, `permission_denied`, `cost_permission_required`, `approval_owner_mismatch` (403) · `state_conflict`, `version_conflict`, `approval_unavailable`, `approval_expired`, `approval_stale`, `execution_in_progress`, `retry_not_available`, `nothing_to_retry`, `branch_context_conflict` (409) · `execution_not_found` (404).

State machine: `approved → executing → executed | partially_failed | failed`; `partially_failed|failed → executing` (retry). Edit/cancel/new preview are refused once execution has started.

## 3. Files changed

**Backend (new):** `database/migrations/2026_11_17_010000_create_ai_action_execution_tables.php` · `app/Models/AiActionExecution.php` · `app/Models/AiActionExecutionRow.php` · `app/Services/AiActionProductExecutionService.php` · `app/Services/AiActionRowFailure.php` · `app/Http/Requests/StoreAiActionExecutionRequest.php` · `app/Http/Requests/RetryAiActionExecutionRequest.php`
**Backend (modified):** `AiAction` (statuses/relation) · `AiActionController` · `AiActionProductApprovalService` (`compute` made public) · `AiActionProductPreviewBuilder` · `ProductService` (`$generateSku`) · `routes/api.php` · `config/ai_actions.php`
**Web:** `web/src/modules/ai-actions/product-execution.ts` · `product-execution-panel.tsx` (new) · `product-preview-panel.tsx` · `product-preview.ts` · `web/src/app/(app)/products/ai-import/page.tsx` (modified)
**Tests:** `tests/Feature/AiActionProductExecutionTest.php` · `tests/Feature/InteractsWithAiProductActions.php` · `tests/Feature/AiActionProductPreviewApprovalTest.php` (updated for deferred images) · `web/src/modules/ai-actions/product-execution-panel.test.tsx` · `product-preview-panel.test.tsx` (updated)

## 4. Tests and results

RESULTS_PLACEHOLDER

## 5. Risks and what remains

1. **Long runs are request-bound.** Each request applies one batch (default 200 rows, each row its own transaction) and the UI drives the loop; there is still no queue worker in production (`QUEUE_CONNECTION=sync`). A closed browser leaves the run `running` with pending rows; reopening/continuing resumes it (lease expiry is recovered). A background job is the natural follow-up.
2. **True multi-process concurrency** is guaranteed by the database (one atomic lease `UPDATE`, `UNIQUE(approval)`, row locks) and verified by simulating a held lease and a dead lease; a multi-process stress test was not run.
3. **Retry only inside the approval window** (default 60 min). After expiry a failed row needs a new import — deliberate, so stale authority is never reused.
4. **Category/brand resolution happens at execution time**, not in the approved hash: a category created between approval and execution is used if it matches exactly one record; otherwise free text.
5. **Deferred by design:** product images (no fetch/attach/replace), unit templates, alternate barcodes, opening stock/costs. Each is reported per row, never claimed.
6. Approver needs `products.view_cost` to approve/execute previews with purchase prices (kept from AI-04); with the mandatory purchase price on creates, an approver without cost visibility cannot approve create previews.
7. Product rows created through this path carry the usual `ProductActivity` entries but no back-reference to the AI action; the link is the execution row's `product_id`.
8. Local verification environment lacks `bcmath`/`APP_KEY` (see §4); CI is authoritative.

## 6. Next step

AI-ACTIONS-06: controlled product-image import (reuse the dark, egress-reviewed media archive/URL path with explicit approval per product and no replacement of existing media), then the repair flow (compensating changes with their own preview/approval) and an optional background-job runner.

## 7. Git / CI

GIT_PLACEHOLDER
