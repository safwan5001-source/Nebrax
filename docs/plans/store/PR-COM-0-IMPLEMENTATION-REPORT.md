# PR-COM-0 Implementation Report

## Summary

Established the minimum real Commerce backend boundary + test harness needed
before `PR-COM-1A`, with **zero business behavior**. Two files were added:

- `app/Support/CommerceBoundary.php` — a final, non-instantiable contract
  class documenting (a) the forbidden direct-write targets for future
  Commerce orchestration (journal/ledger, stock movements/valuation/COGS,
  ZATCA artifacts, financial settlement outside approved Payment authority),
  (b) the one approved authority service per forbidden target
  (`LedgerService`, `InventoryService`, `ZatcaService`, `PaymentService`),
  and (c) the six binding identity-separation statements from the PR-COM-0
  spec (`CommerceOrder != Invoice`, etc.), for humans and future reviewers.
- `tests/Feature/CommerceModuleBoundaryTest.php` — a structural guard (no
  source-code grep) that: confirms the contract autoloads and is internally
  consistent; confirms none of the named future Commerce models
  (`CommerceOrder`, `Reservation`, `PaymentIntent`, `SalesChannel`,
  `CommerceListing`) exist yet; confirms no registered route contains
  `commerce`; confirms no migration filename contains `commerce`.

No `app/Commerce/` (or any new top-level namespace) was created — see
"Architecture/module structure chosen" below for why.

## Repository conventions verified

Targeted inspection only, per the task's instruction not to re-audit the
whole repository:

- **Repo is core-only.** `app/`, `tests/`, `routes/`, `database/migrations/`
  here are a *source-of-truth core* copied into a generated Laravel project
  (`../nibras-app`) by `setup.sh` and independently by
  `.github/workflows/ci.yml` and `deploy/assemble.sh`, each using an
  **explicit, manually-maintained list of directories** to `mkdir -p`/`cp`.
  `ci.yml` additionally runs a "حارس قائمة النسخ" (copy-list guard) step that
  fails CI with a clear error if any `app/**/*.php` file sits in a directory
  not in that allow-list — this is exactly the kind of "existing
  architecture/safety test convention" the task asked to look for and reuse
  rather than invent a new one. `app/Support/*.php` and `tests/Feature/*.php`
  are both already flat entries in that allow-list, in all three assembly
  scripts, so adding files there needed **no changes** to `setup.sh`,
  `ci.yml`, or `deploy/assemble.sh`.
- **Service domain organization is `app/Services/<Domain>/*.php`, flat
  inside each domain** (e.g. `app/Services/Accounting/` holds
  `LedgerService`, `InvoiceService`, `InventoryService`, `PaymentService`,
  `ZatcaService` and ~50 other flat files; `app/Services/Pos/`,
  `DocumentCenter/`, `Reporting/`, `PrintTemplates/` follow the same shape).
  There is **no precedent for a top-level `app/<Domain>/` module** — every
  domain lives under `app/Services/`. `app/Contracts/` is flat across
  domains (DocumentCenter's contracts sit directly in `app/Contracts/`, not
  `app/Contracts/DocumentCenter/`).
- **`app/Support/` hosts cross-cutting, non-model, non-service "contract"
  classes** (`ApplicationCatalog`, `Rbac`, `Plans`, `PlanGate`, `Money`,
  `ProductImportFields`, …) — final classes with typed consts/arrays as the
  source of truth, each usually paired with a guarding
  `tests/Feature/*Test.php`. `ApplicationCatalog` + `ApplicationCatalogTest`
  and `ApplicationCatalog`/`EnsureApplicationActive` +
  `ApplicationAccessGateGuardTest` are the closest precedents to what
  PR-COM-0 needs: a small data/contract class in `Support`, guarded by a
  structural (not string-grep) Feature test.
- **A `README.md` module-boundary-in-code convention exists**
  (`app/Services/PrintTemplates/README.md`), but in every existing case it
  sits **alongside a real service file it documents** — there is no
  precedent for a README-only, code-free module directory. Since PR-COM-0 is
  explicitly forbidden from adding any Commerce service implementation, a
  standalone `app/Services/Commerce/README.md` would have been exactly the
  kind of speculative, code-free placeholder structure the task says not to
  create.
- **Tests are 100% flat under `tests/Feature/`** — 325 existing test files,
  zero subdirectories, no `tests/Unit/` directory at all. Naming convention
  for safety/architecture tests is `<Subject><Guard|Isolation|Test>Test.php`
  (`BranchIsolationGuardTest`, `ApiTenantIsolationTest`,
  `ApplicationAccessGateGuardTest`, `ApplicationCatalogTest`).
- **`BaseModel`** (`app/Models/BaseModel.php`) is `abstract`, uses
  `HasUuids` + `BelongsToTenant`, non-incrementing UUID PK. Tenant scoping is
  automatic via `TenantScope`/`BelongsToTenant`
  (`app/Tenancy/TenantContext.php`, `TenantScope.php`, `BelongsToTenant.php`).
- **Branch isolation classification** is mandatory per model, one of
  `BranchScoped`, `BelongsToBranch`, or `CompanyWide`
  (`app/Tenancy/{BranchScoped,BelongsToBranch,CompanyWide}.php`), enforced by
  `tests/Feature/BranchIsolationGuardTest.php`, which reflects every
  non-abstract subclass of `BaseModel` found by `glob(app_path('Models/*.php'))`
  and fails the build if any is unclassified. `PENDING_ISOLATION` is
  currently `[]` (debt fully paid down) and the test asserts it can only stay
  at `[]`, never grow — confirming the doc's claim in `CLAUDE.md`.
- **`InvoiceService`, `InventoryService`, `LedgerService`, `PaymentService`,
  `ZatcaService`** all live in `app/Services/Accounting/`, one class per
  file, confirmed to exist and be the sole services named in the boundary
  contract.
- **Composer/PSR-4**: standard Laravel `"App\\": "app/"` and
  `"Tests\\": "tests/"` mappings (verified in the generated app's
  `composer.json`, since the core repo carries no `composer.json` of its
  own). Both new files map correctly with **zero autoload configuration
  changes**.
- **Route inspection convention**: `Route::getRoutes()` is already used
  structurally (not string-grep) in `ApplicationAccessGateGuardTest.php` and
  two Public API tests to assert facts about the live route table — reused
  here for the "no Commerce route registered" assertion.

## Architecture/module structure chosen

**Chosen:** one new file in `app/Support/` (`CommerceBoundary.php`) + one new
file in `tests/Feature/` (`CommerceModuleBoundaryTest.php`). No new
directory, no new namespace, no `app/Commerce/`.

**Why, given repository reality:**

1. The task doc's suggested `app/Commerce/{Contracts,Services}/` path is
   **not how this repo organizes domains** — domains live under
   `app/Services/<Domain>/`, not as siblings of `app/Services` — and the doc
   itself says this path is "not prescribed if it conflicts with existing
   repository conventions." It conflicts, so it was not used.
2. Creating even `app/Services/Commerce/` now would be a directory with
   **no `.php` service file in it** (PR-COM-0 forbids implementing any
   Commerce service), which the copy-list guard in `ci.yml` would not fail
   on today (empty dirs aren't `find`-matched) but would immediately require
   editing `setup.sh` + `ci.yml` + `deploy/assemble.sh` the moment the first
   real file lands in PR-COM-1A anyway — better to defer that three-file
   edit to the PR that actually adds code there, per "do not add empty
   folders merely to mirror a future architecture."
3. `app/Support/` is the established home for exactly this shape of
   artifact: a final class of typed constants that is a contract, not a
   model or a service, guarded by a dedicated Feature test
   (`ApplicationCatalog` is the direct precedent). `CommerceBoundary` fits
   this precedent exactly and needed no new directory, so no changes to any
   of the three assembly scripts were required — eliminating the exact
   failure mode (`ci.yml`'s own comment: "حدث هذا مرّتين... فمجلدٌ جديد يبقى
   في المستودع ولا يصل إلى الخادم") that a new subdirectory risks.
4. `tests/Feature/` (flat) matches the actual, 100%-consistent convention
   over the task doc's suggested `tests/Feature/Commerce/` — there is
   exactly one Commerce test today, which does not warrant a new
   subdirectory convention that no other module (not even Accounting, POS,
   or ZATCA, each with dozens of tests) uses. Per the task's own guidance
   ("لا تخترع structure... اتبع conventions الفعلية وسجّل السبب"), this
   deviation from the doc's suggested layout is intentional and is recorded
   here.

## Files changed

```
A  app/Support/CommerceBoundary.php          (67 lines)
A  tests/Feature/CommerceModuleBoundaryTest.php (98 lines)
```

No other file was modified, added, or deleted.

## Database / schema

**NONE.** No migration added, no table/column/index touched.
`no_commerce_migration_is_introduced_yet` asserts no `database/migrations/*.php`
filename contains "commerce".

## API changes

**NONE.** No route file touched, no controller added.
`no_commerce_api_route_is_registered_yet` asserts no live registered route
URI contains "commerce".

## Accounting impact

**NONE.** `CommerceBoundary` is a documentation/contract class with no
methods and no runtime behavior; it is not invoked by any code path. No
existing accounting service (`LedgerService`, `InvoiceService`,
`AccountingPeriodLockService`, etc.) was touched. No journal entry is
possible from this PR's code because no code in it executes.

## Inventory impact

**NONE.** `InventoryService`/`InventoryOpeningService`/stock movement code
untouched. `CommerceBoundary` only *names* `InventoryService::class` as a
future authority; it does not call it.

## ZATCA impact

**NONE.** No ZATCA service, migration, or route touched.

## Tenant / Branch Isolation

- `CommerceBoundary` is **not** a model — it does not extend `BaseModel` and
  is not scanned by `BranchIsolationGuardTest`'s `businessModels()` glob (it
  is a plain final class of constants). No tenant/branch classification
  decision was needed or made.
- `BranchIsolationGuardTest`: **PASS**, 4/4 assertions groups, unchanged
  behavior (see Tests below).
- `ApiTenantIsolationTest` (the separate tenant-isolation guard found during
  inspection, distinct from the branch guard): **PASS**, 5/5.
- No exclusion, bypass, or weakening was added anywhere.

## Tests

All run against the generated Laravel app (`../nibras-app`, assembled by
`setup.sh` from this core at commit `2d746b1`), SQLite, via
`php artisan test --filter=...` / `php artisan test`.

| Tier | Command | Result |
|---|---|---|
| 1 — new boundary tests | `php artisan test --filter=CommerceModuleBoundaryTest` | **PASS** — 4 passed (15 assertions) |
| 2 — branch guard | `php artisan test --filter=BranchIsolationGuardTest` | **PASS** — 4 passed (106 assertions) |
| 2 — tenant guard | `php artisan test --filter=ApiTenantIsolationTest` | **PASS** — 5 passed (28 assertions) |
| 3 — accounting regression | `php artisan test --filter=LedgerTest` | **PASS** — 5 passed (10 assertions) |
| 3 — invoice regression | `php artisan test --filter=InvoiceTest` | **PASS** — 56 passed (303 assertions; filter also matched `RecurringInvoiceTest`, all green) |
| 3 — POS regression | `php artisan test --filter=PosCheckoutTest` | **PASS** — 27 passed (330 assertions) |
| 4 — full suite | `php artisan test` | **2886 passed, 25 failed, 8 skipped** (19599 assertions), 284.93s |

### Tier 4 failure triage (all pre-existing, none touched by this PR)

Re-ran the full suite twice; identical 25 failures both times (deterministic,
not flaky). All 25 fall into two pre-existing environment gaps, neither of
which this PR's diff comes near:

- **24 failures** — `Fuel*Test` classes (`FuelAviRfidServiceTest`,
  `FuelReconciliationTest`, `FuelSaleApiTest`, `FuelSaleServiceTest`,
  `FuelSupplyReceivingTest`, `FuelSupplyReceivingApiTest`). Root cause:
  `Call to undefined function App\Services\bcmul()` at
  `app/Services/FuelCostBasisService.php:380` — the PHP `bcmath` extension is
  **not installed** in this sandbox (`php -m | grep -i bcmath` → no output).
  This is an environment/PHP-build gap unrelated to fuel-station business
  logic and entirely unrelated to Commerce, Support, or tests changed here.
- **1 failure** — `DocumentCenterSecureIntakeTest > a valid pdf is
  counted...`: expects HTTP 201, gets 422 with "ملف PDF تالف أو غير مدعوم"
  (PDF corrupt/unsupported) — a synthetic test-fixture PDF is rejected by the
  document intake's PDF validator in this sandbox, unrelated to Commerce.

None of the 25 failures are in Invoice, Ledger, Inventory, Payment, ZATCA,
POS, Product, Partner, or any isolation/guard test — i.e., none are in any
boundary this PR promises not to alter. Given the diff adds only a
`Support` contract class and a `Feature` test, and touches zero files these
failures depend on, they are pre-existing and environment-caused, not
caused by PR-COM-0.

### PostgreSQL leg

CI runs a `pgsql` matrix leg in addition to `sqlite`. This sandbox has the
`psql`/`pg_isready` client binaries but **no running PostgreSQL server**
(no `systemd`, no local instance), so the `pgsql` leg was not run locally.
This PR adds no migration, no query, and no DB-engine-specific code — the
two new files are a plain PHP constants class and a Feature test that only
calls `class_exists()`, `Route::getRoutes()`, and `glob()` — so there is no
plausible SQLite/PostgreSQL divergence. Flagged here per the "open finding"
requirement rather than asserted as verified.

## Build / CI

Not pushed through GitHub Actions in this task (per instructions: do not
merge, do not deploy). Local assembly via `setup.sh`-equivalent steps
(files copied by hand into the already-assembled `../nibras-app`, matching
what `setup.sh`/`ci.yml`/`deploy/assemble.sh` do for `app/Support` and
`tests/Feature`) was used to run the tests above. The `ci.yml` copy-list
guard step was inspected, not executed standalone; both new files are in
already-allow-listed directories (`app/Support`, `tests/Feature`) so it is
expected to pass unchanged.

## Diff scope validation

`git status --porcelain` before commit showed exactly:

```
?? app/Support/CommerceBoundary.php
?? tests/Feature/CommerceModuleBoundaryTest.php
```

Nothing else — no lockfile, no generated file, no formatting sweep, no
unrelated doc, no migration, no API/route file. One incidental
`web/package-lock.json` change produced by the session's own startup
hook (an `npm install`-added `"dev": true` flag on `fsevents`) was found
*before* any Commerce work began and was reverted with
`git checkout -- web/package-lock.json` prior to starting, so it is not
part of this PR.

## Risks / Open findings

- **OPEN / REQUIRES VERIFICATION** — PostgreSQL CI leg not run locally (no
  server available in this sandbox); reasoned above to be low-risk given the
  diff's shape (no DB access in either new file), but not directly observed
  green.
- The 25 Tier-4 failures (bcmath extension absent; one PDF-fixture
  validation gate) are pre-existing sandbox/environment issues, unrelated to
  this PR, and out of PR-COM-0's scope to fix — flagged for whoever owns
  Fuel Stations / Document Center, not for this task to touch.
- `CommerceBoundary::APPROVED_AUTHORITIES` names four services by FQCN
  string (not `::class` import, to preserve the existing `Support` → no
  dependency on `Services` direction). The new test verifies each string
  resolves to a real class via `class_exists()`, so a rename of any of
  those four services will fail this guard loudly rather than silently
  drift.

## Remaining work

Per the master plan, next in sequence (not started, per explicit
instruction not to begin it in this task):

- `PR-COM-1A` — Available-to-Sell (ATS) read model (ADR-02).
- `PR-COM-1B` — Inventory Reservation.
- Everything else on the Commerce roadmap in
  `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`.

## Git

- **Branch:** `claude/pr-com-0-commerce-boundary-nutcqd`
- **PR:** [#724](https://github.com/safwan5001-source/Nebrax/pull/724) — opened against `main`, not merged
- **Base SHA:** `244e2de645476e695276959030832589c55e1c76`
- **Head SHA:** `2d746b1a0cfd7ce59e18fb9cca80053528bd711f`

## Recommended next step

**PR-COM-0 is clean**: no schema/API/accounting/inventory/ZATCA/legacy
behavior change; the required new tests, both isolation guards, and the
representative Invoice/Ledger/POS regression set are all green; the only
Tier-4 failures are pre-existing and environment-caused, fully triaged and
unrelated to this diff; the diff itself is exactly two new files in
already-allow-listed directories. The one open item (PostgreSQL leg not
locally verified) is a sandbox limitation, not a defect introduced here.

Recommended next step: **`PR-COM-1A` — Available-to-Sell read model**, once
this PR is reviewed and merged by its owner (not by this session — per
instructions, this session does not merge or deploy).
