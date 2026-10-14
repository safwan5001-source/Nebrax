# REM-03 / SEC-01 — Implementation Report: Active-Branch-Only authorization for sales documents

STATUS: **PASS (pending CI on the final head and owner review)** — Draft PR, **NOT MERGED, NOT DEPLOYED**
DATE: 2026-10-13
HORIZON: TAX-ZATCA (origin: TAX-HZ-00, PR #1398)
ZONE: C — security / authorization / financial operations

## Executive summary

| | |
|---|---|
| Verdict | **PASS** — implementation, local evidence on SQLite and PostgreSQL, and CI on the code head are green (see *Full suite / CI*); CI on the final docs-only head is recorded in the PR. Not closed until independent owner review and an owner-approved merge. |
| Scope completed | Invoice (`update`, `updateClassification`, `destroy`, `post`), Return (`show`, `post`), Quote (`show`, `update`, `destroy`, `issue`, `revise`, `convert`) and Document-revision (`feed`, `index`) are **Active-Branch-Only**. One reusable primitive, 5 controllers, 21 new tests, 2 docs updated. |
| What changed for callers | Another branch's document — even one in the user's allowed set, and even for an unrestricted owner — now returns **404** unless that branch is the active branch (`X-Branch-Id`). `?branch=all` never widens these operations. |
| What did *not* change | `allowedBranchIds()`/`canAccessBranch()`, `SetBranch`, RBAC, TenantScope, `scopeToActiveBranch()` (lists/reads/reports), `BelongsToBranch` (no global scope), accounting, VAT, ICV/PIH, QR/XML, ZATCA, migrations, API schema, CI. |
| Remaining blockers | **None for this PR.** Out-of-scope by-id endpoints with the same class of gap are listed under *Newly discovered / not changed* and need an owner decision. |
| STOP conditions | None triggered (see *STOP-condition check*). |

## Baseline

| Field | Value |
|---|---|
| Repository | `safwan5001-source/Nebrax` |
| Base SHA | `0c90419874594169d422515e881425e5b3b3fa70` (`origin/main` at start; includes TAX-HZ-00 PR #1398) |
| Branch | `fix/security-rem03-active-branch-only` |
| PR | #1403 — https://github.com/safwan5001-source/Nebrax/pull/1403 (Draft) |
| Final Head SHA | recorded in the PR description / hand-back message (a file cannot contain its own commit hash). Code + tests head: `6bc971b3394a74aff62f53f7cd5125acc5ed13a3`; the report commit follows it (docs only). |

## Confirmed root cause

Verified against current `main` (line numbers re-read, not assumed):

* `InvoiceController` `update`, `updateClassification`, `destroy`, `post` loaded with bare `Invoice::findOrFail($id)` — tenant-scoped only. Reads used `visibleInvoice()` (`scopeToActiveBranch`).
* `ReturnController::show/post` and `QuoteController` (all six operations) used bare `findOrFail`.
* `DocumentRevisionController::feed` returned the tenant's revisions unfiltered; `index` checked tenant only.
* Models are `BelongsToBranch` — **no global branch scope by design** — so knowing a document UUID was enough to reach any branch of the same tenant. `post` was partly softened by `assertWarehouseAllowed()` (returns **422**, and only for warehouse scope), which neither concealed existence nor covered the other three invoice mutations.

## Active Branch Only contract

Narrower than allowed-branch scope, by owner decision:

```
Tenant Isolation ∩ Existing Permission ∩ ACTIVE BRANCH MATCH ∩ Workflow/State/Accounting Invariants
record.branch_id == BranchContext::id()   (or branch_id IS NULL — legacy)
```

Why general Access Control V2 is unchanged: the rule is an *additional* intersection applied to a closed list of by-id operations through a new explicit predicate. It does not read or modify `allowedBranchIds()`, does not touch `scopeToActiveBranch()` (still widened by `?branch=all` for lists/reads — and a test asserts that), and adds no global scope.

**Trust boundary (verified, not modified).** `BranchContext::id()` is trusted because `SetBranch` runs inside `auth:sanctum → EnsureUserPrincipal → SetTenant → SetBranch` (`routes/api.php:359`, covering the invoices/returns/quotes/revisions routes), accepts `X-Branch-Id` only if it is a UUID, resolves under `TenantScope`, **and** `User::canAccessBranch()` holds, and otherwise falls back to the main branch (if allowed) or the user's first allowed branch. `$request->user()` can never be null on these routes, so the `! $user` branch in `SetBranch` is unreachable. No HTTP path re-sets the context afterwards. Independent reviewer confirmed the same.

## Files changed

| File | Change |
|---|---|
| `app/Http/Controllers/Api/ApiController.php` | + `scopeToCurrentBranchOnly(Builder)` (43 lines incl. contract docblock) |
| `app/Http/Controllers/Api/InvoiceController.php` | + private `targetInvoice()`; 4 mutations use it (guard runs first) |
| `app/Http/Controllers/Api/ReturnController.php` | `show`, `post` use the primitive |
| `app/Http/Controllers/Api/QuoteController.php` | + private `targetQuote()`; 5 sites; `show` uses the primitive |
| `app/Http/Controllers/Api/DocumentRevisionController.php` | `index` + `feed` (+ private `whereDocumentInCurrentBranch()`) |
| `tests/Feature/Rem03ActiveBranchOnlyTest.php` | new — 21 tests |
| `docs/audits/horizon/TAX-HZ-00-REMEDIATION-BACKLOG.md` | owner decision + REM-03 status (not marked closed) |
| `docs/plans/access-control/AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md` | new §42 security-remediation note |
| `docs/audits/horizon/REM-03-SEC-01-IMPLEMENTATION-REPORT.md` | this report |

No services, models, middleware, routes, migrations, requests, resources or workflows were modified.

### The primitive

```php
protected function scopeToCurrentBranchOnly(Builder $query): Builder
{
    $table = $query->getModel()->getTable();
    $branchId = app(BranchContext::class)->id();
    return $query->where(function (Builder $q) use ($table, $branchId) {
        if ($branchId !== null) { $q->where("$table.branch_id", $branchId); }
        $q->orWhereNull("$table.branch_id");
    });
}
```

Query-based (not an `abort()` after load) so a miss is an ordinary `findOrFail` miss: **same 404 as a nonexistent id** (asserted: same status, exception class and message). It does not use `$request`, `?branch`, or `allowedBranchIds()`. With no active branch it matches only branchless rows. Renders as `tenant_id = ? AND (t.branch_id = ? OR t.branch_id IS NULL) AND id = ?`.

## Invoice coverage

`update`, `updateClassification`, `destroy`, `post` — the guard is the **first statement**: before `Partner::findOrFail`, `assertWarehouseAllowed`, the service call, and therefore before field changes, deletion, status change, journal posting, stock movements, ICV consumption, QR/XML generation and ZATCA fields. (The FormRequest validators run earlier but read neither the route id nor the record, so a 422 is identical for nonexistent / other-branch / other-tenant ids — not an oracle.)

## Return coverage

`show`, `post` — guard first; `post` guards before `assertWarehouseAllowed` and `ReturnService::post` (no journal/stock effect on denial).

## Quote coverage

`show`, `update`, `destroy`, `issue`, `revise`, `convert` — via `targetQuote()`; denied `convert` creates no invoice, denied `revise` creates no quote, denied `destroy` leaves the row, denied `issue`/`update` leave the row byte-identical (asserted by full-row + counter snapshots).

## Document revision coverage

* `index` — the underlying document is resolved through the primitive (`TenantScope ∩ active branch`) before any revision is read → 404 otherwise.
* `feed` — filter in SQL **before** `limit`: `document_type = X AND document_id IN (SELECT id FROM <X table> WHERE <active-branch predicate>)` for every type in `DocumentRevision::TYPES` (invoice, purchase, quote, procurement, stocktake, stock_permit — all `BelongsToBranch`, all have `branch_id`). Subqueries carry `TenantScope`. Excluded rows leak nothing: not as ids/types/diffs/users/timestamps, not as counts (`assertCount`), not through `limit` (a hidden newer row cannot displace or shorten the page).
* Two documented consequences: (a) revisions of a **deleted** document are hidden (its branch cannot be proven ⇒ fail closed); (b) the same rule now also gates purchase/procurement/stocktake/stock-permit revisions (all of `TYPES`, as instructed).

## Tenant isolation evidence

`a_foreign_tenant_invoice_is_404_and_a_forged_cross_tenant_branch_header_selects_nothing`, `return_denial_covers_foreign_tenants_and_unrestricted_owners`, `a_foreign_tenant_quote_is_404`, `revision_feed_*` / `revision_index_*` (foreign-tenant revisions never appear; foreign document → 404), `set_branch_trust_boundary_holds_*`. Assertions: foreign document → 404 on every operation; the foreign row is **byte-identical afterward** (no writes in the foreign tenant); the other tenant's branch id in `X-Branch-Id` does not become the active branch (operation on the caller's own document still resolves to their default branch). No cross-tenant unscoped lookup exists in production code.

## Multi-allowed-branch evidence (central policy test)

`multi_branch_user_gets_404_on_an_allowed_but_inactive_branch_with_no_side_effects`: an `admin` assigned to branches A and B, active = A:

1. general V2 access intact — `GET /invoices/{B}` with header B = 200 and `GET /invoices/{B}?branch=all` with active A = 200 (existing read contract unchanged);
2. every targeted operation on an A document = success;
3. every targeted operation on a B document = **404**, with a full-row + ledger/stock/payment/ICV/revision footprint **unchanged**;
4. after switching the header to B the same four operations on B documents succeed.

Same shape for quotes (all six operations) and returns. Unrestricted owner: `an_unrestricted_owner_must_switch_the_active_branch_too` — B document 404 under A, 200 under B; list/report surfaces untouched.

## `?branch=all` non-widening evidence

`branch_all_never_widens_a_targeted_invoice_mutation` (4 invoice operations + owner `post`), the quote loop (`…?branch=all` on all six), return `show`/`post`, revisions `feed` (`&branch=all`) and `index`. All 404. The primitive-level test sets `request()->query['branch']='all'` and proves identical results.

## Branchless legacy compatibility

`branch_id IS NULL` rows stay reachable (`a_branchless_legacy_invoice_stays_reachable`, quote, return, revision feed/index). Nothing in this PR removes branchless behaviour. With **no** active branch (a tenant without branches; unreachable through the API because every tenant gets a main branch) only branchless rows match — asserted directly on the primitive.

## Permission / 404 semantics

Route middleware (`EnsurePermission`) runs first: a user lacking the action permission gets **403** on both an in-branch and an other-branch document and nothing changes (`a_user_without_the_action_permission_still_gets_403…`); a user *with* the permission but the wrong active branch gets **404**. No permission was added or changed. 404 is indistinguishable from nonexistent (`a_nonexistent_id_and_a_foreign_branch_id_return_the_identical_404_body`).

## Accounting / ZATCA atomicity evidence

`a_denied_invoice_post_leaves_no_ledger_stock_icv_payment_or_zatca_footprint`: for a denied `post`, the full invoices row (incl. `status`, `zatca_icv`, `zatca_qr`, `zatca_xml`, `zatca_hash`), `journal_entries`, `journal_lines`, `stock_movements`, `payments`, invoice/quote/return counts, `max(zatca_icv)` and `document_revisions` are identical before/after; `zatca_icv` stays NULL. The positive control (post in the right branch) consumes ICV = 1. Every other denied mutation test asserts the same footprint. No accounting formula, rounding, VAT, ICV/PIH, QR, XML, numbering or ZATCA transmission code was touched (diff is guards only).

## Negative control (tests are not vacuous)

The test class (20 tests at that point; the 21st, the primitive-level test, targets the new helper and has no pre-fix equivalent) was run against the **unmodified** controllers (`origin/main` copies): **14 of 20 failed**, 6 passed (positive/compat/foreign-tenant cases that must pass before and after) — proving the central assertions detect the vulnerability.

## SQLite results

| Run | Result |
|---|---|
| `php artisan test --filter=Rem03ActiveBranchOnlyTest` (in-memory SQLite) | **21 passed** |
| Full `php artisan test` (SQLite, deps matched to CI: `league/flysystem-aws-s3-v3`, `predis`) | **6537 passed, 73 skipped, 38 failed** (48,832 assertions, 515 s) |

The 38 failures are **environmental and pre-existing**: classes `Fuel*` (31; `Call to undefined function bcmul()` — the local PHP lacks `bcmath`, which CI installs), `AuthRecovery`/`UserInvitation`/`ResendMailTransport` (7; mail/queue configuration of the local shell). The identical set of nine classes was re-run on the **unmodified base controllers**: **the same 38 fail** ⇒ zero regressions attributable to this change. (An earlier full run showed 2,225 failures; root cause was a missing local `aws/aws-sdk-php` leaking an open transaction into later tests — fixed by installing the CI package set, not by changing any test.)

## PostgreSQL results

| Run | Result |
|---|---|
| `php artisan test --filter=Rem03ActiveBranchOnlyTest` (PostgreSQL 16.15) | **20 passed** (448 assertions) before the 21st test was added; the 21st passes inside the full PG run below |
| Full local `php artisan test` (PostgreSQL 16.15) | **6607 passed, 2 skipped, 39 failed** (49,290 assertions, 998 s). `Rem03ActiveBranchOnlyTest` PASS; the PostgreSQL concurrency/lock-order classes (`CreditNote*Postgres*`, return/credit-note) PASS. |

The 39 local PostgreSQL failures = the **same 38 environmental failures** as SQLite (`Fuel*` need `bcmath`; mail/queue shell config) **plus one** `StorefrontMediaApiTest` case (`PDOException: Invalid parameter number` in the media library query — a local PHP/PDO-pgsql quirk in a module this PR does not touch). That case fails identically on the **unmodified base** (re-run with `origin/main` controllers: `1 failed, 40 passed`, same as with the change), and it passes in CI. Not a regression.

## Full suite / CI

* Local: as above (SQLite + PostgreSQL, 21 focused tests on each).
* **CI on the code+tests head `6bc971b3394a74aff62f53f7cd5125acc5ed13a3` — all green:** `php artisan test (L11, sqlite)` ✅ (`22:43–22:57Z`), `php artisan test (L11, pgsql)` ✅ (`22:43–23:12Z`), `CI Gate` ✅ (`23:13Z`) — https://github.com/safwan5001-source/Nebrax/actions/runs/38479655924 and /38479655941. These are the authoritative, CI-environment full-suite results and show none of the local environmental failures.
* **CI on the final head** (this report's docs-only commit): recorded in the PR description and the hand-back message after it completes.
* Existing regression suites relevant to the checklist, all PASS locally on **both** databases (and in CI): Access Control V2 / RBAC (`ApiRbacTest`, `ApiTenantIsolationTest`, `BranchIsolationGuardTest`, `Branch*IsolationTest`, `BranchSharingTest`, `BranchTest`, `DocumentBranchScopeTest`, `PosInvoiceBranchAccessTest`); invoices/returns/quotes/revisions (`ApiInvoiceTest`, `InvoiceTest`, `QuoteTest`, `DocumentRevisionTest`, `ReturnTest`, `ReturnFromSourceTest`, `ReturnSourceVatAccuracyTest`, `Pos*Return*Test`, `CreditNote*`); posting / ICV / accounting safety (`LedgerTest`, `Zatca*` classes incl. `ZatcaTest`, `ZatcaPhase2Test`, `ZatcaSubmission*`).

## STOP-condition check

1. Active branch trusted to be user-allowed — **yes** (verified).
2. `allowedBranchIds()` change needed — **no**.
3. Targeted operation intentionally cross-branch by accounting design — **no** (none found among the listed operations).
4. Branchless records with a stronger contract — **no conflict found**; compatibility kept.
5. Revisions not filterable without schema/API change — **filterable** (polymorphic subquery; no schema change).
6. Accounting/ZATCA rule change — **none**.
7. ACL V2 contract conflict — **none**; the rule is additive and scoped.
8. Shared RBAC/TenantScope/branch middleware/global list change — **none**.
9. Weakens another boundary — **no** (strictly narrower).
10. Unrelated vulnerability found — **yes, reported not fixed** (below).

## Newly discovered / not changed (reported separately, per instruction)

Same defect class — by-id invoice/credit-note operations that still resolve through `scopeToActiveBranch()` (`?branch=all` widens them to the user's allowed branches) or `assertRecordAccessible()` (allowed-set only, not the active branch):

| Endpoint | Evidence | Nature |
|---|---|---|
| `InvoiceController::duplicate` | `InvoiceController.php:318-320` (`visibleInvoice`) | **mutating** — creates a draft in the active branch from another branch's invoice |
| `InvoiceController::storeNote` | `:229-231` | **mutating** — adds a note |
| `ZatcaSubmissionController` `store` / `dispatch` | `:36`, `:83` (`visibleInvoice` → `scopeToActiveBranch`, `:102-104`) | **mutating, ZATCA** — creates/dispatches a submission attempt for another allowed branch's invoice |
| `CreditNoteController` `show` / `post` | `:76-77`, `:84-90` (`assertRecordAccessible`) | **financial** — posting checks the allowed set, not the active branch |
| `ReturnableController` | source-document lookup (`assertRecordAccessible`) | read |
| `AppointmentController` | `:53`, `:66` (`scopeToActiveBranch`) | invoice lookup |
| Reads: `payments`, `accounting`, `inventory`, `notes`, note-attachment download, `zatca`, `show` | `InvoiceController` `visibleInvoice` | by Access Control V2 design (`?branch=all`) |

Recommendation: a follow-up `REM-03b` applying `scopeToCurrentBranchOnly` to `duplicate`, `storeNote`, the ZATCA submission `store`/`dispatch` and credit-note `show`/`post` (one-line swaps each) — **requires an owner decision** on whether the Active-Branch-Only rule extends there. Not done here.

## Code review findings

| Review | Result |
|---|---|
| Implementer self-review | Verified: guard-first ordering in all 14 targeted operations (4 invoice + 2 return + 6 quote + 2 revision); no `?branch`/`allowedBranchIds` read; table-qualified column; OR grouped inside a closure so `TenantScope`/`id` ANDs are preserved; no N+1 in the feed (single query, batched morph/user eager loads). |
| Independent security reviewer (separate read-only agent, given the diff and the checklist, not my conclusions) | **No blocker / high.** Low: feed uses six `IN (subselect)` branches — correct, a performance note only (`whereExists` or a `branch_id` on revisions if it ever matters). Info: behaviour now also gates purchase/procurement/stocktake/stock-permit revisions (stated above and in the PR). Info: the primitive-level test's `actingAs`/`request()->query` inputs are inert by construction (kept to document non-dependence). Also reported the out-of-scope items above. |
| AWJ Guardian | No separate Guardian reviewer exists in this environment. I performed the contract check myself against `CLAUDE.md`/Access Control V2: tenant isolation outermost ✔; `BelongsToBranch` gains no global scope ✔; branch classification unchanged ✔; money/ledger/ZATCA untouched ✔; `allowedBranchIds()` semantics untouched ✔; policy not silently forked (explicit helper, documented) ✔. **Treat as implementer-performed, not independent.** |
| Unresolved | None in this PR. |

## Documentation updated

* `docs/audits/horizon/TAX-HZ-00-REMEDIATION-BACKLOG.md` — owner decision recorded; REM-03 *in review*, not closed; links this report.
* `docs/plans/access-control/AWJ_USERS_ROLES_PERMISSIONS_DAFTRA_REFERENCE.md` §42 — security-remediation note (no new master document).

## Risks / remaining

1. **Behaviour change for clients** that relied on addressing another branch's quote/return by id without the matching `X-Branch-Id` (the web client should already send the active branch; not verified here — `web/` untouched).
2. Revisions of deleted documents disappear from the feed (documented, fail-closed).
3. Out-of-scope endpoints above keep the old (`?branch=all`/allowed-set) behaviour until the owner decides.
4. Local full-suite includes 38 environmental failures (identical on base); CI is the authoritative full-suite result.
5. SQLite-only test-DB quirk (unique `(tenant_id, number)` without the branch predicate) required explicit number overrides in the multi-branch fixtures; production PostgreSQL is unaffected.

## Production code changes

Controllers only (5 files, +100/−15 lines); no services, models, migrations, routes, requests or config.

## Merge / Deploy status

**NOT MERGED. NOT DEPLOYED.** Draft PR #1403 awaiting owner review. No production action, migration, ZATCA transmission, OTP or credential operation was performed.

## Recommended next step

Owner review of PR #1403 → decide on the follow-up scope (`REM-03b`: `duplicate`, `storeNote`, ZATCA `store`/`dispatch`, credit-note `show`/`post`) → then `REM-08`.

## Follow-up: REM-03b (added 2026-10-14; original conclusions above are unchanged)

REM-03 was merged as PR #1403 (merge `c589ced1dcbad88ef023d8be6ead34bc58f489f0`). The out-of-scope table above is addressed, for six of its operations only, by the separate follow-up **REM-03b** (Draft PR; report: `REM-03b-SEC-01-IMPLEMENTATION-REPORT.md`): `InvoiceController::duplicate` and `storeNote`, `ZatcaSubmissionController::store` and `dispatch`, `CreditNoteController::show` and `post`. `ReturnableController`, `AppointmentController` and the credit-note `original_invoice_id` reference policy were deliberately left unchanged. The remaining rows of the table are not part of REM-03b.
