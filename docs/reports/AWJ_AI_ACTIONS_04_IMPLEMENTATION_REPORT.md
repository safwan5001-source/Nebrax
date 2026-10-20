# AWJ AI-ACTIONS-04 — Secure Preview & Approval

**Branch:** `ai-actions-04-secure-preview-approval` · **Base:** `origin/main` @ `e885d776ff893c37775d1242a9cab69603c291c6` (includes AI-ACTIONS-03, PR #1576)
**Scope:** preview and approval only. No product is created or updated; no price, tax, stock or accounting rule changed; no Anthropic call; no Railway/merge/deploy.

## 1. What was delivered

| Requirement | Delivery |
|---|---|
| Final preview | `POST /ai-actions/{id}/previews` builds a read-only preview per row: **create / update / skip / blocked**, field diffs (before → after), prices (integer minor units, shown in SAR by the UI), image sources, and per-row issues. `GET …/previews/{id\|latest}` pages and filters it. |
| Real matching | `AiActionProductPreviewBuilder` matches against live products by trusted identifiers only, in priority order: Nebrax ID → exact SKU → barcode (via the unified barcode registry). A name never matches. Matching uses `Product::query()`, so tenant and branch scopes apply; a barcode owned by a product outside the actor's scope is reported as "taken" without describing it. |
| Duplicates & conflicts | Duplicate SKU/barcode/ID inside the file; two rows targeting one product; identifiers pointing at different products; create-vs-existing; unknown/invalid Nebrax ID; update-locked fields (type, inventory tracking); service tracking stock; min-sale-price above sale price. |
| Approval blocked on errors | Required fields (name, type, sale price for create), invalid money/percent/integer/boolean/enum, bad image URLs, unresolved `needs_review` rows, any conflict ⇒ `approvable=false` and `POST /approvals` returns `422 preview_blocked`. Verdicts are **recomputed server-side**; client-supplied `violations`, `match` and `media` are ignored, so a forged version cannot hide errors. |
| Version + fingerprint binding | Approval stores `action_version`, `preview_hash` (HMAC-SHA256 over tenant, action, type, version and the canonical preview; domain-separated from version hashes), approver, permission digest, branch and expiry. One approval per preview (unique key). |
| Invalidation on any change | New version (any edit), cancel, a newer preview, expiry, and live-state drift all invalidate previews / revoke approvals in the same transaction (`AiActionApprovalLedger`). |
| Re-check before approving | Fresh actor, tenant, flag, role permission (`ai.actions.approve` + `products.manage`), branch scope and context, cost visibility (`products.view_cost` when the preview holds purchase prices), action state/version, preview freshness, and a **live recomputation** of the preview — a hash mismatch invalidates it (`preview_stale`) and records no approval. |
| Confirmation UI | `/products/ai-import` now has two steps: review → **Preview & approval**. Summary tiles, operation tabs (server-filtered, paged), responsive table/cards, issue summary, preview identity (version, short hash, expiry), explicit checkbox + button, approved/expired/stale/cost-hidden states, "recreate preview". Arabic/RTL, existing AWJ tokens and components only. |
| Traditional import | Untouched (`ProductImportService`, `/products/import`, `/products/workbook-import` and their tests unchanged). |

Also added: reviewers can set a **decision** (create/update/skip) per row or in bulk through the existing review endpoint (additive; field-only edits behave as before; `needs_review` is server-assigned only; an explicit update/skip survives later field edits). Review `edits` limit raised from 200 to 2000 so a bulk decision fits one version.

## 2. State machine

`created/editing → (preview, no errors) ready_for_approval → (approve) approved`; any edit ⇒ `editing`; expiry ⇒ `expired`; cancel allowed from every non-terminal state. Previews with errors leave the status unchanged. `approved` has **no executor**: it is an inert, expiring authority record (default preview TTL 30 min, approval TTL 60 min; `AI_ACTIONS_PREVIEW_TTL_MINUTES`, `AI_ACTIONS_APPROVAL_TTL_MINUTES`).

## 3. Files changed

**Backend (new):** `database/migrations/2026_11_16_010000_create_ai_action_preview_approval_tables.php` (`ai_action_previews`, `ai_action_approvals`, tenant-composite FKs, immutable models) · `app/Models/AiActionPreview.php` · `app/Models/AiActionApproval.php` · `app/Services/AiActionProductPreviewBuilder.php` · `app/Services/AiActionProductApprovalService.php` · `app/Services/AiActionApprovalLedger.php` · `app/Support/ProductImportValueNormalizer.php` · `app/Http/Requests/StoreAiActionPreviewRequest.php` · `app/Http/Requests/StoreAiActionApprovalRequest.php`
**Backend (modified):** `AiAction` (statuses) · `AiActionGateway` (invalidate on edit/cancel, expiry sweep, `authorizeFor`) · `AiActionProductReviewService` (`effective()`, decisions) · `AiActionCanonicalJson` (`previewHash`, `digest`) · `AiActionController` · `StoreAiActionReviewRequest` · `routes/api.php` · `config/ai_actions.php`
**Web:** `web/src/app/(app)/products/ai-import/page.tsx` (modified) · `web/src/modules/ai-actions/product-preview.ts` · `product-preview-panel.tsx` (new)
**Tests:** `tests/Feature/AiActionProductPreviewApprovalTest.php` · `web/src/modules/ai-actions/product-preview.test.ts` · `product-preview-panel.test.tsx` · `web/src/app/(app)/products/ai-import/page.test.tsx`

## 4. API

| Route | Permission | Notes |
|---|---|---|
| `POST /ai-actions/{id}/previews` | `ai.actions.use` | `Idempotency-Key`, `expected_version`; identical live state returns the same preview (200 + `AI-Action-Preview-Replayed`) |
| `GET /ai-actions/{id}/previews/{id\|latest}` | `ai.actions.use` | `operation`, `page`, `per_page`; purchase prices redacted without `products.view_cost` |
| `POST /ai-actions/{id}/approvals` | `ai.actions.approve` | `expected_version`, `preview_id`, `preview_hash`, `acknowledged:true`; replay by the same approver returns the original (200 + `AI-Action-Approval-Replayed`); another approver ⇒ `409 already_decided` |

Errors: `preview_blocked` 422 · `preview_hash_mismatch` / `preview_stale` / `preview_expired` / `preview_invalidated` / `version_conflict` / `state_conflict` / `already_decided` 409 · `cost_permission_required` / `permission_denied` 403 · `branch_context_conflict` 409.

## 5. Tests

| Suite | Result |
|---|---|
| `AiActionProductPreviewApprovalTest` (21 tests: classification, required/invalid values, forged proposal, duplicates/conflicts, name-never-matches, hash binding + replay, edit/cancel invalidation, live-state drift, target edited after preview, preview/approval expiry, approve permission + cost visibility, live permission re-check, tenant + branch isolation, gating/no execute route, decisions, paging, immutability, hash sensitivity, money typing) | **SQLite 21/21 · PostgreSQL 21/21** |
| Existing AI Actions suites (`AiActionsFoundationTest`, `AiActionProductFileIntakeTest`, `AiActionProductReviewTest`) — legacy approval/permission/tenant behaviour | **pass on SQLite and PostgreSQL** (31/31 incl. new) |
| Full PHP suite, SQLite (local, 7,962 tests) | 7,176 passed on first pass; 642 failures were environmental (assembled local app had no `APP_KEY` ⇒ `MissingAppKeyException`; CI sets one). The 86 affected classes were rerun with a key: **1,044 passed**, 26 failed — all in `Fuel*` tests with `Call to undefined function bcmul()` (the `bcmath` extension is not installed locally; `setup.sh` warns about it, CI installs it). No failure relates to AI Actions, products, import, branches or tenancy. |
| Branch classification guard (new models are `CompanyWide`) | pass (`BranchIsolationGuardTest` in the full run) |
| Web (`npm run test`, Vitest) | **655 files / 7,747 tests passed**, including 9 + 8 + 4 new AI-ACTIONS-04 tests and the unchanged `/products`, `/products/import`, `/products/workbook-import` suites |
| Web type check (`tsc --noEmit`) | no errors in changed files (the repository's pre-existing unrelated type errors are unchanged) |

Web component tests cover: preview rendering (create/update/skip, SAR prices from minor units, images, warnings), approval gating (explicit checkbox, errors, unsaved edits, no permission, expired/invalidated), payload sent to `/approvals` (version, preview id, full hash, `acknowledged`), stale-preview recovery, cost redaction, server-side filtering, and the page flow (decision saved as a new version *before* the preview is requested; bulk decision applies to visible rows only; no approval request is ever sent automatically).

Not run locally: `next build` (CI `Web CI` runs it) and Playwright/visual QA. CI results are linked from the PR.

## 6. Risks and decisions for the owner

1. **Single-approver policy** (maker may approve their own preview if granted `ai.actions.approve`), as the plan assumes. Maker/checker is a one-line policy change if you want it.
2. **Warnings do not block**: missing purchase price, tax rate, unit, or SKU/barcode on a *create* row, and unmanaged category/brand/unit-template names, are visible warnings. AI-ACTIONS-06 (execution) must not default them silently (the traditional importer defaults purchase price to 0 and generates a SKU).
3. **Image updates on existing products** stay unapproved (`will_apply=false`); no URL is fetched at preview time.
4. **Only extraction-backed actions** can be previewed (same basis as the review screen). An action created with an inline proposal and no file returns `404 extraction_unavailable`.
5. **Pre-existing**: the AI-03 review endpoint still returns purchase prices to any `ai.actions.use` + `products.manage` user; the new preview redacts them, the review screen was not changed.
6. File upload is still allowed only in `created/editing`; from `ready_for_approval/approved/expired` the user edits (new version) first.
7. Approval expiry is lazy (swept on read/mutation), not scheduled.
8. Local verification used an assembled app without `APP_KEY`; classes needing encryption were rerun with a key (see §5).

## 7. Next step

AI-ACTIONS-05/06: idempotent execution through `ProductLifecycleService` that re-validates the approval (hash, expiry, permissions, live state) per batch, with per-row results — still gated behind `AI_ACTIONS_ENABLED` and the tenant opt-in.

## 8. Git / CI

| Item | Value |
|---|---|
| Branch | `ai-actions-04-secure-preview-approval` |
| Draft PR | https://github.com/safwan5001-source/Nebrax/pull/1580 |
| Base | `main` @ `e885d776ff893c37775d1242a9cab69603c291c6` |
| Head (code + report at time of PR) | `a5e1c56626ebdc4cfb648863b101d15821016df5` (later commits only update this table) |
| CI on `9642bab` | **All green:** `php artisan test (L11, sqlite)` ✅ · `php artisan test (L11, pgsql)` ✅ · `web build (Next.js)` ✅ · `CI Gate` ✅ (the local `APP_KEY`/`bcmath` failures in §5 do not occur in CI). Not merged, not deployed. |
