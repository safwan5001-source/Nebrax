# PR-COM-1A — Available-to-Sell Read Model — Implementation Report

## Summary

Implements the smallest correct backend read model for Commerce's
Available-to-Sell (ATS) question, per ADR-02's baseline contract with
`Active Reserved` hard-coded to `0` (no reservation storage exists yet —
that is `PR-COM-1B`). Two files:

- `app/Services/Commerce/AvailableToSellService.php` — one public method,
  `forWarehouse(string $productId, string $warehouseId): AvailableToSellSnapshot`.
  Reads `On Hand` from the existing `product_warehouse_stock.quantity`
  column (the same table `InventoryService::assertStockAvailable()`
  already reads to gate sales/returns), returns `Active Reserved = 0`, and
  computes `Available To Sell = max(0, On Hand - Active Reserved)`. No
  write of any kind — no `StockMovement`, no journal entry, no product
  mutation.
- `app/Services/Commerce/AvailableToSellSnapshot.php` — a `final readonly`
  value object (`onHand`, `activeReserved`, `availableToSell`), same shape
  as the existing `App\Support\ApplicationAccessResult` precedent.

Plus `tests/Feature/AvailableToSellServiceTest.php` (11 tests covering all
9 required cases, two extra defensive cases), and mechanical updates to
`setup.sh`, `.github/workflows/ci.yml`, and `deploy/assemble.sh` to
register the new `app/Services/Commerce/` directory in the core-repo's
existing copy-list convention (see "Files changed").

No migration, no API route, no UI, no accounting/inventory/ZATCA behavior
change, no `Reservation`/`CommerceOrder`/`SalesChannel` anything.

## Base / references

- **Base SHA:** `f44f0fcf6d48f80cea4f4b6bbacf84a609993a54` (`origin/main`,
  which is PR-COM-0's merge commit — confirmed via
  `git log --oneline -5 origin/main` before branching).
- Branch created fresh from `origin/main`:
  `git checkout -B claude/pr-com-1a-ats-read-model origin/main`.
- Read: `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md` (PR-COM-1A section),
  `ADR-02-INVENTORY-RESERVATION-AVAILABLE-TO-SELL.md` (ATS contract,
  §"Product, warehouse, source order... must be validated as belonging to
  the same tenant"), `PR-COM-0-COMMERCE-MODULE-BOUNDARY-TEST-HARNESS.md` +
  its implementation report, and the merged `app/Support/CommerceBoundary.php`
  / `tests/Feature/CommerceModuleBoundaryTest.php`. Did not re-read
  `AWJ_COMMERCE_EXISTING_ARCHITECTURE_AUDIT.md` in full — went straight to
  the current `app/Models/Product.php`, `StockMovement.php`,
  `ProductWarehouseStock.php`, `Warehouse.php`, and
  `InventoryService.php` as the ground truth, per the task's own
  instruction to verify from current code, not re-audit.
- ADR-03 (Channel/Warehouse/Fulfillment Source) skimmed for the
  `SalesChannel != Branch != Warehouse != PickupLocation` boundary
  statement only — its channel-routing content is out of scope for a pure
  On-Hand read and is explicitly deferred by ADR-02 itself
  ("Selection/routing of which warehouse should fulfill an order is
  explicitly deferred to the follow-up Channel↔Warehouse ADR").

## Existing inventory truth verified

- **`app/Models/Product.php`**: `quantity_on_hand` (int) and `avg_cost`
  (int) are columns directly on `Product` — a **global, all-warehouses
  running balance** used for moving-average valuation. Not per-location.
- **`app/Models/ProductWarehouseStock.php`** (table
  `product_warehouse_stock`, columns `tenant_id, product_id, warehouse_id,
  quantity, revision`): the **per-warehouse quantity breakdown** of
  `products.quantity_on_hand` — "بلا قيمة" (no valuation on this table;
  valuation stays global on `Product`). `CompanyWide`-classified (isolation
  is via the warehouse/branch reference, not a `BranchScoped` trait on this
  model itself).
- **`app/Models/StockMovement.php`**: permanent per-transaction ledger of
  quantity changes. Carries `warehouse_id`, but per its own doc-comment the
  warehouse tag is a **reference/label only** ("يوضح مكان الصرف من دون
  تغيير الرصيد") — it does not itself hold a running per-warehouse balance;
  that is exactly what `ProductWarehouseStock` is for.
- **`app/Services/Accounting/InventoryService.php`** is the sole writer of
  both `products.quantity_on_hand`/`avg_cost` (via `applyReceipt()` /
  `applyIssue()` / `recordSaleCogs()`) and `product_warehouse_stock`
  (via the private `adjustWarehouseStock()`, called from the same three
  methods). Its own `assertStockAvailable(Product $product, int $quantity,
  ?string $warehouseId)` is the **exact existing precedent** for the ATS
  read:
  ```php
  $available = $warehouseId === null
      ? (int) $product->quantity_on_hand
      : (int) (ProductWarehouseStock::where('product_id', $product->id)
          ->where('warehouse_id', $warehouseId)
          ->value('quantity') ?? 0);
  ```
  `AvailableToSellService::forWarehouse()` reads the same
  `ProductWarehouseStock` row the same way (warehouse always required, per
  ADR-02 — see "Inventory location semantics" below).
- **`app/Services/Reporting/InventoryReportService.php`** (existing,
  read-only, already-shipped inventory reports) has a `warehouseBalances()`
  method that queries `ProductWarehouseStock` joined to `products`/
  `warehouses` for the "أرصدة المخازن الكمية" report — confirms
  `ProductWarehouseStock` is already the established, single source of
  truth for warehouse-level quantity reporting, and its `trackedProducts()`
  helper is the precedent for the one non-default scope decision this PR
  makes (see "Tenant / Branch Isolation").
- **`app/Services/Accounting/UnitConversion.php`** + evidence from
  `tests/Feature/StockPermitUomValuationTest.php`
  (`a_receipt_with_an_alternate_uom_converts_to_base_quantity_and_normalizes_the_cost`):
  quantities are converted to base-unit **before** they ever reach
  `InventoryService`/`ProductWarehouseStock`. `quantity_on_hand` and
  `product_warehouse_stock.quantity` are always base-quantity already.
  Reconfirmed live in this PR's own
  `ats_reflects_the_already_converted_base_quantity_not_a_second_uom_conversion`
  test (2 cartons × 24 → `onHand === 48`, not `2` and not a
  double-converted value).

## ATS contract implemented

```text
On Hand           = product_warehouse_stock.quantity for (product_id, warehouse_id)
Active Reserved   = 0                                  (hard-coded; PR-COM-1B fills this)
Available To Sell = max(0, On Hand - Active Reserved)
```

`On Hand` is exposed **unclamped** (can be negative, reflecting a known
legacy deficit — see Existing Architecture Audit's negative-stock finding);
only `Available To Sell` is floored at zero. Neither `On Hand` nor
`avg_cost`/valuation is written or altered by this service — it is
read-only end to end.

## Inventory location semantics

**The location key is the existing `warehouse_id`** (`App\Models\Warehouse`
+ `App\Models\ProductWarehouseStock.warehouse_id`) — no new `Warehouse`
aggregate, no Commerce-specific location concept. `warehouse_id` is
**required** (not nullable) in `AvailableToSellService::forWarehouse()`,
per ADR-02's explicit requirement that ATS be warehouse-scoped; the
legacy "no warehouse ⇒ company total" branch that
`assertStockAvailable()` keeps for pre-warehouse documents is a
backward-compatibility path for historical documents, not part of the new
Commerce-facing contract, so it was deliberately not carried over. A
non-existent `warehouse_id` throws rather than silently answering `0`
(see "Files changed" / test list).

## UOM semantics

No conversion logic added. Quantities are already stored at base-unit
resolution by the time they reach `product_warehouse_stock` (see "Existing
inventory truth verified" above) — `AvailableToSellService` reads the
column as-is. Converting again inside ATS would risk double-applying a
unit factor on an already-converted value.

## Tenant / Branch Isolation

- `Product`, `Warehouse`, and `ProductWarehouseStock` all extend
  `BaseModel`, so `TenantScope` filters every query automatically — no
  `tenant_id` parameter is accepted anywhere in the new service's public
  API, and no `withoutGlobalScope(TenantScope::class)` /
  `withoutGlobalScopes()` appears anywhere in the diff.
- The **one** scope decision made: `Product::query()->withoutGlobalScope(BranchScope::class)`
  on the product-existence check inside `forWarehouse()`. This is **not**
  a tenant-scope bypass — `BranchScope` only ever filters by the caller's
  *ambient active branch*, a concept ATS deliberately ignores because it
  is answering for an **explicitly named warehouse**, not "whatever branch
  happens to be active in this request." This exact bypass, for exactly
  this reason, is the established pattern in
  `InventoryReportService::trackedProducts()` (`Product::query()->withoutGlobalScope(BranchScope::class)`),
  so no new pattern was invented.
- Verified negative cross-tenant access directly:
  `tenant_a_inventory_never_leaks_into_tenant_bs_ats` creates a
  product/warehouse/stock row under Tenant A, switches
  `TenantContext` to Tenant B, and asserts `forWarehouse()` throws
  (`RuntimeException`) rather than returning Tenant A's quantity or `0`
  silently — because `Product`/`Warehouse` simply cannot be found under
  Tenant B's `TenantScope`, the existence check fails closed automatically,
  with no bespoke tenant-matching code needed.
- `BranchIsolationGuardTest`: **PASS** (4/4, 106 assertions) — unchanged;
  neither new PHP class extends `BaseModel`, so neither is a "business
  model" the guard's `businessModels()` glob would even see.
- `ApiTenantIsolationTest` (separate tenant-isolation guard, found in
  PR-COM-0's inspection): **PASS** (5/5, 28 assertions) — unchanged.
- `CommerceModuleBoundaryTest` (from PR-COM-0): **PASS** (4/4) — confirms
  this PR still introduces no Commerce model, route, or migration.

## Files changed

```
A  app/Services/Commerce/AvailableToSellService.php    (68 lines)
A  app/Services/Commerce/AvailableToSellSnapshot.php    (24 lines)
A  tests/Feature/AvailableToSellServiceTest.php        (185 lines)
M  setup.sh                                     (+2/-1: register app/Services/Commerce)
M  .github/workflows/ci.yml                     (+2/-1: same, in the copy-list guard + assembly step)
M  deploy/assemble.sh                           (+2/-1: same)
```

The three script edits are **mechanical and required**, not scope creep:
this core repo copies itself into a generated Laravel project via
explicit, manually-maintained directory lists in all three scripts (see
`setup.sh`'s own comment: "أي مجلد يحمل ملفات PHP وليس في القائمة يُفشل
الـCI"). `app/Services/Commerce/` is a genuinely new subdirectory (unlike
PR-COM-0, which stayed inside already-listed `app/Support/`), so
registering it follows the exact same one-line pattern used for every
other `Services/<Domain>` subdirectory (`Accounting`, `Pos`,
`DocumentCenter`, `Reporting`, `PrintTemplates`). Confirmed the CI
copy-list guard step (`.github/workflows/ci.yml` lines 58–74) would fail
loudly without this change, and passes with it.

## Database / schema

**NONE.** No migration added. `no_commerce_migration_is_introduced_yet`
(from PR-COM-0's `CommerceModuleBoundaryTest`, re-run in this PR) still
passes.

## API changes

**NONE.** No route file touched, no controller added.
`no_commerce_api_route_is_registered_yet` still passes.

## Accounting impact

**NONE.** `AvailableToSellService` calls no `LedgerService` method,
touches no `Account`/`JournalEntry`/`JournalLine`, and posts nothing. No
new financial operation exists in this PR — there is no journal entry to
table for review.

## Inventory mutation impact

**NONE.** `AvailableToSellService` performs read-only queries
(`->exists()`, `->value('quantity')`) against `Product`, `Warehouse`, and
`ProductWarehouseStock`. It never calls `InventoryService`, never creates
a `StockMovement`, never updates `quantity_on_hand`/`avg_cost`/
`product_warehouse_stock.quantity`. Verified explicitly by
`an_ats_lookup_creates_no_stock_movement_or_financial_record`, which calls
`forWarehouse()` twice and asserts `StockMovement::count() === 0`,
`JournalEntry::count() === 0`, and the stock row's quantity is unchanged.

## ZATCA impact

**NONE.** No ZATCA class, route, or table touched.

## Tests

All run against the generated Laravel app (`../nibras-app`, assembled from
this core at commit `26dae60`) via `php artisan test --filter=...` /
`php artisan test`, once on SQLite and once on a real local PostgreSQL 16
instance (see "PostgreSQL / CI" below).

### Tier 1 — new ATS tests (SQLite, then re-run identically on PostgreSQL)

`php artisan test --filter=AvailableToSellServiceTest`

| Test | SQLite | PostgreSQL |
|---|---|---|
| positive on-hand is fully available (10/0/10) | PASS | PASS |
| zero on-hand is zero available (0/0/0) | PASS | PASS |
| negative legacy on-hand floors ATS without hiding the deficit (-5/0→0) | PASS | PASS |
| tenant A inventory never leaks into tenant B's ATS | PASS | PASS |
| ATS for one warehouse never mixes stock from another | PASS | PASS |
| product A stock never leaks into product B's ATS | PASS | PASS |
| Active Reserved is exactly zero until PR-COM-1B | PASS | PASS |
| an ATS lookup creates no stock movement or financial record | PASS | PASS |
| ATS reflects the already-converted base quantity (UOM, 2 cartons×24=48) | PASS | PASS |
| an unknown product is rejected rather than silently reported as zero | PASS | PASS |
| an unknown warehouse is rejected rather than silently reported as zero | PASS | PASS |

11 passed, 21 assertions (both engines).

### Tier 2 — isolation guards

| Command | SQLite | PostgreSQL |
|---|---|---|
| `--filter=BranchIsolationGuardTest` | PASS 4/4 (106 assertions) | PASS 4/4 |
| `--filter=ApiTenantIsolationTest` | PASS 5/5 (28 assertions) | PASS 5/5 |
| `--filter=CommerceModuleBoundaryTest` (PR-COM-0's guard) | PASS 4/4 (15 assertions) | PASS 4/4 |

### Tier 3 — representative regression (inventory / invoice / POS / purchase / return)

`php artisan test --filter='InventoryTest|WarehouseTest|WarehouseAwareDocumentsTest|StockPermitTest|StockPermitUomValuationTest|PurchaseTest|ReturnTest|InvoiceInventoryApiTest|PosCheckoutTest'`
(SQLite): **122 passed, 892 assertions.**

`php artisan test --filter='InventoryTest|InvoiceInventoryApiTest'` (SQLite,
run separately to confirm both matched): **21 passed, 97 assertions**
(includes `ApiInventoryTest`, `DiagnoseInventoryTest` picked up by the
filter — all green).

### Tier 4 — full backend suite

| Run | Result |
|---|---|
| SQLite, `php artisan test` | **2897 passed**, 25 failed, 8 skipped (19620 assertions), 280.66s |
| PostgreSQL 16 (local), `php artisan test` | **2905 passed**, 25 failed (19646 assertions), 651.97s |

(2905 = 2897 + 8: the 8 tests skipped on SQLite ran and passed on
PostgreSQL — expected, driver-conditional tests, not a regression.)

Baseline for comparison (PR-COM-0's own report, same environment, before
this PR's changes): SQLite full suite was 2886 passed / 25 failed / 8
skipped. This PR adds exactly 11 new passing tests (2897 - 2886 = 11,
matching `AvailableToSellServiceTest`'s 11 cases) and changes nothing
else — same 25 failures, byte-for-byte identical failing test names on
both runs.

### Tier 4 failure triage — identical to PR-COM-0, still pre-existing

Diffed the full `FAILED` test-name list from this PR's SQLite run against
PR-COM-0's report: **identical set, 25 entries, both runs.** All are:

- **24 failures** — `Fuel*Test` classes, root cause
  `Call to undefined function App\Services\bcmul()` at
  `FuelCostBasisService.php:380` — the `bcmath` PHP extension is not
  installed in this sandbox (`php -m | grep -i bcmath` → no output).
- **1 failure** — `DocumentCenterSecureIntakeTest > a valid pdf is
  counted...` — a synthetic test-fixture PDF rejected by the document
  intake's PDF validator in this sandbox.

Same 25 names, same root causes, on **both** SQLite and PostgreSQL —
confirms these are PHP-extension/environment gaps, not
database-engine-dependent, and nothing in this PR's diff (Commerce read
model + three copy-list script edits) touches Fuel Stations or Document
Center code.

## PostgreSQL / CI

Unlike PR-COM-0 (where no local Postgres server was available), this
session found PostgreSQL 16 already installed in the sandbox
(`postgresql-16`, `postgresql-client-16` packages present, previously not
running). Started it directly (`pg_ctlcluster 16 main start`, no
`systemd` needed) and created a database matching CI's own service
definition exactly (`nibras`/`nibras`/`secret`, port 5432, same as
`.github/workflows/ci.yml`'s `services.postgres` block), then pointed the
generated app's `.env` at it the same way CI's own "تهيئة قاعدة البيانات"
step does (`DB_CONNECTION=pgsql`, same host/port/db/user/pass), ran
`migrate:fresh --force`, and ran the full suite. **This closes PR-COM-0's
one open item** — PostgreSQL is no longer unverified for this Commerce
foundation work. `.env` was restored to `sqlite` afterward so the sandbox
is left as found.

## Performance observations

No N+1 introduced: `forWarehouse()` issues exactly two `EXISTS` queries
(product, warehouse) and one `SELECT ... LIMIT 1` (the stock quantity) —
three total queries per call, no loops, no eager-loading needed since no
relation is traversed. No cache and no materialized/denormalized balance
was added, per instruction — `product_warehouse_stock` is already the
denormalized-for-reads table (that is its entire purpose per its own
doc-comment: "تفصيل لـ products.quantity_on_hand بلا قيمة"), so this PR
introduces no new performance primitive, just a new reader of an existing
one. No performance blocker was found for this PR's scope; a real
storefront/cart hot-path load profile is out of scope until an actual
Commerce API consumer exists (COM-7B).

## Diff scope validation

`git status --porcelain` after commit, diffed against `origin/main`,
shows exactly:

```
A  app/Services/Commerce/AvailableToSellService.php
A  app/Services/Commerce/AvailableToSellSnapshot.php
A  tests/Feature/AvailableToSellServiceTest.php
M  setup.sh
M  .github/workflows/ci.yml
M  deploy/assemble.sh
```

No lockfile, no generated file, no formatting sweep, no unrelated doc, no
migration, no route/API file, no change to `Invoice`/`Ledger`/
`InventoryService`/`PaymentService`/ZATCA behavior. The three script
diffs are each exactly 2 added / 1 changed line, in the same shape as
every prior `Services/<Domain>` onboarding in those files.

## Risks / Open findings

- None blocking. The one open item carried over from PR-COM-0 (PostgreSQL
  leg unverified) is now closed — see "PostgreSQL / CI" above.
- **OPEN / REQUIRES VERIFICATION (deferred, not a defect in this PR):**
  whether ATS should special-case `type === 'service'` or
  `track_inventory === false` products. Not required by ADR-02's baseline
  contract and not in the required test list; such a product simply has no
  `product_warehouse_stock` row and correctly reads as `On Hand = 0,
  ATS = 0` today. Flagging so PR-COM-1B or a Commerce-API PR makes a
  conscious decision rather than inheriting this silently.
- **OPEN / REQUIRES VERIFICATION (deferred):** whether a caller ever needs
  ATS for the pre-warehouse "company total" case (`warehouseId === null`,
  the branch `assertStockAvailable()` keeps for historical documents).
  Not implemented here since ADR-02 requires ATS to be warehouse-scoped;
  flagging in case a legacy-data migration path surfaces a real need
  later.

## Remaining work

Per the master plan, strictly next in sequence (not started, per explicit
instruction not to begin it in this task):

- `PR-COM-1B` — Inventory Reservation (real `Active Reserved`, reservation
  storage, atomic acquisition/concurrency).
- Everything else on the Commerce roadmap in
  `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`, including the
  Channel↔Warehouse/Fulfillment-Source ADR-03 follow-up work and the
  eventual Commerce API surface (COM-7B) that will expose this read model.

## Git

- **Branch:** `claude/pr-com-1a-ats-read-model`
- **PR:** [#726](https://github.com/safwan5001-source/Nebrax/pull/726) — opened against `main`, not merged
- **Base SHA:** `f44f0fcf6d48f80cea4f4b6bbacf84a609993a54`
- **Head SHA:** `26dae60cc502848a0e4d2ef59fc090f799ce3292` (before adding this report)

## Recommended next step

**PR-COM-1A is clean**: no schema/API/accounting/inventory/ZATCA/legacy
behavior change; all 9 required test cases (plus 2 extra defensive ones)
pass on both SQLite and a real local PostgreSQL 16; both isolation guards
and PR-COM-0's own boundary guard remain green; the representative
inventory/invoice/POS/purchase/return regression set (122+21 tests) is
green; the full suite's only failures are the same 25 pre-existing,
environment-caused failures already triaged in PR-COM-0's report,
reproduced identically on both database engines; the diff is exactly
three new files plus three mechanical, minimal script edits required by
the repo's own copy-list convention.

Recommended next step: **`PR-COM-1B` — Inventory Reservation**, once this
PR is reviewed and merged by its owner (not by this session — per
instructions, this session does not merge or deploy).
