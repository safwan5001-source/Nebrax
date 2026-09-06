# AWJ Implementation Report — PR-SEC-INV-1

**Date:** 2026-09-06
**Status:** DONE — PR opened, no merge/deploy
**Branch:** `claude/phase-1-pr-sec-inv-1-8pzra4`
**PR:** https://github.com/safwan5001-source/Nebrax/pull/666
**Base SHA:** `eed979d2b4925da253b4540276cad95d6944c35c`
**Head SHA:** `f246deb`

## 1. Summary

Implements `docs/plans/products-inventory/phase-1-hardening/PR-SEC-INV-1.md` only — the first Phase 1 hardening gate of the Products & Inventory program. No other task from the program was started.

Stocktake and Stock Permit are tenant-isolated (`TenantScope`) and use explicit branch tagging (`BelongsToBranch`, no global scope — intentional, for cross-branch transfer semantics). List/create paths already reasserted the caller's branch/warehouse access (`scopeToActiveBranch`, `assertWarehouseAllowed`), but direct record actions (`show`, `count`, `post`, `destroy`) did not. A user restricted to specific branches/warehouses could read or mutate/post a same-tenant document tagged to a branch or warehouse they don't own, simply by knowing its UUID (guessed, leaked, or from an old link).

## 2. Scope implemented

- One authoritative record-access check, centralized in `ApiController`:
  - `assertRecordAccessible(?string $branchId, array $warehouseIds)` — reasserts the caller's branch access and *every* operational warehouse the record references (source + target for transfers). Called immediately after `findOrFail()`, before any data is returned or any state-changing domain call runs. Denies with `404`, matching the project's established not-found convention for other explicit-scope documents (e.g. `InvoiceController::show`) — "exists but forbidden" is never distinguishable from "doesn't exist" in the response body.
  - `scopeToAccessibleWarehouses(Builder $query, array $warehouseColumns)` — keeps `index()` consistent with the new record-level rule: a restricted user no longer sees a document in the list that a direct `show`/`post` on it would reject. All non-null warehouse columns on a row must be within the user's allowed set (so a transfer is hidden from the list if either side is out of scope), mirroring the direct-access rule exactly.
- Applied to `StocktakeController`: `index`, `show`, `count`, `post`, `destroy`.
- Applied to `StockPermitController`: `index`, `show`, `post`, `destroy` (with both `warehouse_id` and `target_warehouse_id` checked for every action, since a permit is always potentially a transfer).
- No accounting, UOM, posting, or numbering behavior changed. No `BranchScoped` conversion. No permission taxonomy change.

## 3. Files changed

| File | Change | Why |
|---|---|---|
| `app/Http/Controllers/Api/ApiController.php` | Added `assertRecordAccessible()` and `scopeToAccessibleWarehouses()` | One centralized, reusable record-access check/query policy per the contract, instead of controller-specific ad hoc checks that would drift over time |
| `app/Http/Controllers/Api/StocktakeController.php` | Call `assertRecordAccessible()` right after `findOrFail` in `show`/`count`/`post`/`destroy`; filter `index()` with `scopeToAccessibleWarehouses($query, ['warehouse_id'])` | Close the direct-UUID authorization gap; keep list and direct-action behavior consistent |
| `app/Http/Controllers/Api/StockPermitController.php` | Same pattern, with `['warehouse_id', 'target_warehouse_id']` | Transfer permits must have both source and target authorized before any read or mutation |
| `tests/Feature/StocktakeStockPermitRecordAccessTest.php` (new) | 15 tests covering the full contract test matrix | Regression coverage for allowed/denied same-tenant users, transfer source/target combinations, `branch=all`, cross-tenant isolation, and no-mutation-on-denial |

## 4. Schema / migrations / API contract

None. No migration. No new endpoint. No request/response shape change. The only externally visible change is that a direct record request (`GET`/`POST`/`DELETE` by ID) that used to be unreachable-but-untested for a restricted user now explicitly returns `404` instead of leaking the record or its state — matching the convention already used elsewhere in the API (e.g. `PosInvoiceBranchAccessTest`).

## 5. Security / Tenant / Branch / Warehouse evidence

All claims below are backed by passing tests in `tests/Feature/StocktakeStockPermitRecordAccessTest.php` (run output in §9):

- **TenantScope unchanged.** Cross-tenant UUIDs remain `404` via the existing `BaseModel`/`TenantScope` behavior — untouched by this PR.
  - `a_different_tenant_cannot_reach_the_stocktake_at_all`
  - `a_different_tenant_cannot_reach_the_permit_at_all`
- **Same tenant, same allowed branch/warehouse → allowed.**
  - `a_restricted_user_can_open_count_and_post_a_stocktake_in_their_own_branch`
  - `a_restricted_user_can_view_and_post_a_permit_in_their_own_branch`
- **Same tenant, different disallowed branch → denied (404).**
  - `a_restricted_user_cannot_read_a_stocktake_from_a_disallowed_branch_by_id_alone`
  - `a_restricted_user_cannot_reach_a_permit_from_a_disallowed_branch_by_id_alone`
- **Branch allowed but warehouse restricted → denied where warehouse restriction applies.** Constructed a user with no branch restriction (sees both branches) but restricted to only the *other* branch's warehouse — denied on the main-branch stocktake, allowed on the other.
  - `a_branch_allowed_user_restricted_to_another_warehouse_is_still_denied`
- **Transfer source allowed / target denied → denied.**
  - `a_transfer_permit_is_denied_when_the_target_warehouse_is_outside_the_scope`
- **Transfer target allowed / source denied → denied.**
  - `a_transfer_permit_is_denied_when_the_source_warehouse_is_outside_the_scope`
- **Both transfer warehouses allowed → allowed** (no regression to legitimate cross-branch transfer).
  - `a_transfer_permit_is_allowed_when_both_warehouses_are_in_scope`
- **`branch=all` with limited owned branches → cannot escape the owned set.**
  - `branch_all_for_a_restricted_user_still_excludes_stocktakes_outside_their_assignment`
- **List/direct-action consistency** (scope item 5 of the contract): a user restricted to a warehouse no longer sees the other branch's stocktake in the list either, matching what direct `show` rejects.
  - `the_stocktake_list_hides_documents_the_direct_show_would_reject`
- **Denied post/count/destroy produce no mutation, stock movement, or journal entry.** Asserts `status` stays `draft`, `journal_entry_id` stays `null`, and `StockMovement::count()` / `JournalEntry::count()` are unchanged after the denied calls.
  - `denied_count_post_and_destroy_on_a_disallowed_branch_stocktake_produce_no_mutation`
  - `denied_post_and_destroy_on_a_disallowed_permit_produce_no_stock_or_gl_effect`
- **Existing posting lock / double-post tests remain green** (unmodified, rerun as part of the wider suite in §9): `a_posted_stocktake_cannot_be_posted_or_counted_again`, `a_posted_permit_cannot_be_posted_again`.
- **Unrestricted user (no branch/warehouse assignment) is unaffected** — matches existing `allowedBranchIds()/allowedWarehouseIds() === null` semantics (empty assignment = unrestricted, per `User::allowedBranchIds()` doc comment), so no existing tenant is silently locked out by this change.
  - `an_unrestricted_user_retains_cross_branch_access_within_the_same_tenant`

## 6. Accounting / Inventory reconciliation

Not applicable. This PR is authorization-only — no new financial operation, journal entry, GL account, or valuation logic is introduced or touched. Existing posting behavior and its 1140-reconciliation invariants (`StocktakeTest`, `StockPermitTest`) are unchanged and pass unmodified (see §9).

## 7. UOM / historical semantics

N/A — no UOM, quantity, or historical snapshot logic touched.

## 8. Concurrency / idempotency

N/A — no new locking or transaction logic was introduced. The authorization check is a plain read-then-compare before any domain call; it does not participate in the posting transaction. Existing posting-lock/double-post behavior (`Stocktake`/`StockPermit` `post()` idempotency) is untouched and its tests remain green.

## 9. Tests

| Command / suite | Result | Notes |
|---|---|---|
| `php artisan test --filter=StocktakeStockPermitRecordAccessTest` | **15 passed** (266 assertions) | New PR-SEC-INV-1 test matrix (§5) |
| `php artisan test --filter="StocktakeTest\|StockPermitTest\|UserAccessScopeTest\|PosInvoiceBranchAccessTest"` | **42 passed** (250 assertions) | Existing inventory/security/branch-access regression suites, including posting-lock/double-post tests, unmodified and green |
| `php artisan test` (full suite, SQLite) | **2378 passed, 1 skipped, 25 failed** | All 25 failures are pre-existing and unrelated to this PR (see below). Verified via a clean re-run of the full suite with no concurrent processes. |

**Pre-existing failures (not caused by this PR):**
- 24 failures across `FuelAviRfidServiceTest`, `FuelReconciliationTest`, `FuelSaleApiTest`, `FuelSaleServiceTest`, `FuelSupplyReceivingTest`, `FuelSupplyReceivingApiTest` — all trace to `Call to undefined function App\Services\bcmul()` in `FuelCostBasisService`. Confirmed the `bcmath` PHP extension is not installed in this sandbox (`php -m | grep bcmath` → empty). Unrelated module (fuel logistics costing), no code in this PR touches it.
- 1 failure in `DocumentCenterSecureIntakeTest > a valid pdf is counted...` — a PDF-fixture/library issue (`422 "ملف PDF تالف أو غير مدعوم"` instead of expected `201`), unrelated to inventory/security.

An earlier full run in this session initially reported 801 failures; root-caused to a leftover background `php artisan test` process from this same session racing the foreground run on the shared SQLite test database (`PDOException: database is locked`). Verified no stray process was running, then reran cleanly — the clean run reproduced the same 25 pre-existing failures as the very first baseline run, confirming this PR introduces zero regressions.

## 10. Build / Lint / Typecheck

No `web/` (Next.js) files changed — frontend build not applicable to this PR.

`vendor/bin/pint --test` reports pre-existing style deviations (`unary_operator_spaces`, `braces_position`, etc.) on the touched files. Verified via `git stash` that these identical deviations exist on the pre-edit versions of the same files — this PR does not introduce new style violations. This repository's CI (`ci.yml`) does not gate on Pint.

## 11. CI

Not polled from this session (no CI run yet against the pushed branch at report time). `ci.yml` runs `php artisan test` on a SQLite + PostgreSQL matrix; this report's local validation covers SQLite. The new authorization checks use only portable Eloquent query methods (`whereIn`, `whereNull`, `orWhereIn`) with no DB-specific SQL, so no PostgreSQL-specific behavior is expected, but the matrix run itself was not observed before this report.

## 12. Deviations from approved plan

None. Scope matches the contract (`PR-SEC-INV-1.md`) exactly:
- One centralized `ApiController` check reused across both controllers (not controller-specific policy drift).
- No conversion of `Stocktake`/`StockPermit` to `BranchScoped`.
- No accounting/UOM/posting/numbering behavior change.
- `DeliveryNote` and `InventoryOpening` untouched (explicitly out of scope per the contract).
- No permission taxonomy redesign.

## 13. Risks / remaining work

- The PostgreSQL leg of CI was not run locally in this session; only SQLite was validated directly. Given the change uses only portable query builder methods, no divergence is expected, but this should be confirmed once CI runs on the PR.
- The pre-existing `bcmath`-dependent Fuel test failures and the PDF-fixture failure are environment/dependency gaps unrelated to this PR. They are surfaced here for visibility per the Universal Definition of Done ("Financial/security/Tenant Isolation changes must not reduce test coverage") but are explicitly out of scope for this task and were not fixed.

## 14. Merge / deploy status

Neither merge nor deploy was performed. The PR (`#666`) is open for review; no auto-merge is configured. Awaiting review per the program's transition gate (`README.md` §بوابة الانتقال) before any further Phase 1 task (`PR-INV-1`) proceeds.

## 15. Next step

ChatGPT / Safwan review of this report and the PR diff (#666). On approval, proceed to `PR-INV-1` — central sensitive-cost authorization/redaction — per `docs/plans/products-inventory/prompts/PHASE1_IMPLEMENTATION_PROMPTS.md`. Do not start `PR-INV-1` before this review, per program governance.
