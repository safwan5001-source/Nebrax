# AWJ AI-ACTIONS-06B — Repair Workflow (second of two linked PRs)

Stacked on **06A (product images, PR #1584)**: its base is the 06A branch, so the diff shows only the repair work. Merge 06A first.

## Design in one paragraph
A repair is a **new AI action that holds only the rows an execution could not apply**. The original action, approval, preview, execution and
every per-row / per-image result stay exactly as they were (audit), and a row that succeeded is never part of a repair, so it cannot be
created or updated twice. The repair then goes through the **ordinary** review → preview → approval → execution path, so every guard applies
again to the corrected data: fresh RBAC, tenant/branch, matching and conflict detection, cost authority, approval expiry, idempotency and the
execution lease. Nothing new can write to a product that the normal path could not.

## What is implemented (and verified)
| Requirement | Implementation |
|---|---|
| Show failed rows and why | `GET /api/ai-actions/{action}/executions/{execution}/repair` (what a repair would contain, with each row's failure code/message and the fields it may edit); the execution results already show every failed row/image and its reason. |
| «إصلاح وإعادة المحاولة» + explicit confirmation | Button under a failed execution → confirmation dialog (what is created, that successes are not re-run, that a new preview + approval are required) → `POST …/repairs` (idempotent) → opens the repair in `/products/ai-import?action=…`. |
| Edit only the affected fields, keep value provenance | Each repair row carries `affected_fields` (failure code → fields, plus any field the approved preview flagged on the row). The server rejects any other field (`repair_field_locked` 422); the UI disables them. An edited value becomes `origin: user`; every untouched value keeps its original source. A failure that is not about data (transient/DB) opens **no** field. A domain rule that names no field opens the row's own fields (never the identifier) and says so. Decision changes and the existing-product-images decision stay available. |
| Re-validate data, conflicts, permissions | Nothing is bypassed: the repair is previewed like any import (identifier matching, duplicates, SKU/barcode conflicts, required fields, references resolved to ids, cost visibility). A user without `products.view_cost` cannot start a repair whose rows carry purchase prices (403 `cost_permission_required`, no half-built action). Starting needs `ai.actions.repair`. |
| New preview + approval | Always: the repair is a new action; it cannot execute before its own approval (asserted). |
| Re-run failed rows only; never repeat successes | The repair contains only failed rows (and, separately, products that lost an image). Successful products are untouched: same `updated_at`, one `created` activity (asserted). Rows fixed by an earlier repair are not offered again. |
| Keep previous results and audit | The original execution/rows/images/events are not modified; `repair_started` / `repair_created` events link the two; `GET …/repair` shows the origin; `ai_action_repairs` is immutable. |
| No duplicates / unsafe concurrency | The origin action is locked while a repair starts; **one open repair per execution** (a repeat returns it); same Idempotency-Key replays; a failed attempt rolls back and removes any copied objects. Retry and repair are **disjoint by construction**: repair is offered only for failures a retry cannot fix (non-retryable, or approval no longer active), so the two paths never touch the same row. |
| Images | A product saved but missing an image becomes an **update** row aimed at that exact product carrying only the image sources; the product record is not rewritten and the "add images to the existing product" decision starts **off**. The staged bytes are copied into the repair (re-verified against their recorded hash; a corrupted object is not copied and the reviewer re-uploads the ZIP). |
| A repair can fail too | Chained repairs work (repair of a repair); every link keeps its own results. |

## Files
Backend: `database/migrations/2026_11_19_010000_create_ai_action_repairs_table.php`, `app/Models/AiActionRepair.php`,
`app/Services/AiActionProductRepairService.php` (new); `AiActionProductReviewService.php` (field lock; no-source-file repairs),
`AiActionProductImageStager.php` (`copyBetween`), `AiActionController.php`, `routes/api.php`.
Web: `modules/ai-actions/product-repair.ts`, `product-repair-ui.tsx` (new), `product-execution-panel.tsx`, `app/(app)/products/ai-import/page.tsx`.
Tests: `AiActionProductRepairTest` (11), `product-repair-ui.test.tsx` (7), page + execution-panel tests.

## API additions
* `GET  /api/ai-actions/{action}/executions/{execution}/repair` — candidates (`ai.actions.use`)
* `POST /api/ai-actions/{action}/executions/{execution}/repairs` — start / return the open repair (`ai.actions.repair`, idempotent)
* `GET  /api/ai-actions/{action}/repair` — repair info for a repair action

## Not changed
Accounting, stock, prices/tax, the traditional import, `AI_ACTIONS_EXECUTION_ENABLED` (off by default), remote image fetching (off by default),
Anthropic, Railway. No journal entry is produced by a repair beyond what the product services already do (none for this import).

## Tests

| Check | Result |
|---|---|
| `AiActionProductRepairTest` (new, 11): repair holds only failed rows and leaves the original untouched; one open repair per execution; field lock + value provenance; own preview/approval and no repeat of successes; transient failure → retry first, repair after approval expiry; domain-rule rejection scope; permission / tenant / branch / not-finished; cost visibility; immutability; chained repair; image repair (append-only, product not rewritten) | **11 passed on SQLite and PostgreSQL** |
| `AiAction*` + `ProductImport*` + `ProductMedia*` + `ProductReferenceClassificationGuard` + `BranchIsolationGuard` | **102 passed on PostgreSQL**, 87 `AiAction*` on SQLite |
| Full PHP suite, SQLite (local, 8,083 tests) | 7,912 passed, 145 skipped, **26 failed — all `Fuel*`** (`bcmul()` undefined: `bcmath` missing locally, CI installs it) |
| Web `vitest` AI Actions + ai-import (+ the store-experience-builder test that CI flagged) | **69 passed** (new: 7 repair-UI tests — proposes repair only for non-retryable failures, explicit confirmation, idempotency key, no creation on cancel, double-click guard, open repair is resumed, retry-first hint, English; page test — opens a repair from the link, shows the reason, unlocks only the affected fields, no bulk field edit) |
| `npm run build` | passes |

CI note (inherited from 06A): the shared single-process vitest run was leaking a stubbed `crypto.randomUUID` from the AI panel tests into a later,
unrelated test; the AI test files now unstub globals after each test (fixed in 06A `a814ae0`, merged here).

## Risks and what remains
1. A repair is a new import, so it needs its own approval (by design). If a reviewer prefers re-approving the *same* preview after a transient failure,
   that is what **Retry** already does while the approval is valid; repair deliberately takes over only when it cannot.
2. Failure → field mapping covers the known row failure codes (`conflict_existing_product`, `target_*`, `reference_*`, `rule_rejected`, images);
   a new failure code must be added to `AiActionProductRepairService::CODE_FIELDS` or it opens no field (fail-closed).
3. Starting a repair copies up to the failed rows' staged images (bounded by the 200-image archive cap).
4. The repair does not carry the original **file**; its rows come from the approved proposal, which is what was actually applied.
5. Local environment lacks `bcmath` (Fuel tests) — CI is authoritative.

## Git / CI

__GIT__

## Next step
After 06A and 06B merge: retention job for staged images and repair copies (deleted with the draft), and an operator runbook for enabling
`PRODUCT_IMPORT_REMOTE_IMAGES_ENABLED` behind egress controls.
