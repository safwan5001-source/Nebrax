# PR-COM-1B — Atomic Inventory Reservation — Implementation Report

## 1. Executive Summary

Implements the first real, first-class Inventory Reservation primitive in
AWJ Commerce per ADR-02: `App\Models\InventoryReservation` +
`App\Services\Commerce\InventoryReservationService`, with lifecycle
`ACTIVE → {CONSUMED, RELEASED, EXPIRED}`, atomic acquisition under real
PostgreSQL concurrency, DB-backed idempotency, and strict tenant/warehouse
isolation. `AvailableToSellService::forWarehouse()` (PR-COM-1A) now reads a
real `activeReserved` instead of a hard-coded `0`:

```
On Hand           = product_warehouse_stock.quantity   (unchanged source)
Active Reserved   = SUM(inventory_reservations.base_quantity WHERE status='active')
Available To Sell = max(0, On Hand - Active Reserved)
```

No `CommerceOrder`, `Cart`, `Checkout`, `SalesChannel`, or any UI/API surface
is introduced. No `StockMovement`, no `JournalEntry`, no valuation/`avg_cost`
mutation, no `Invoice`/ZATCA effect — reservations are a purely operational
promise, never a physical stock movement.

## 2. Base SHA

`8eeaff24e75e29437db176b2e314ad6e3f1ab730` (`origin/main` at task start —
PR-COM-1A's merge commit, confirmed via `git fetch origin main` +
`git log --oneline -5 origin/main` before branching; matches the SHA given
in the task).

## 3. Binding references

Read (targeted, not a re-audit): `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`
(PR-COM-1B section), `ADR-02-INVENTORY-RESERVATION-AVAILABLE-TO-SELL.md`
(full — this is the primary binding contract for this PR), ADR-01 and ADR-03
(skimmed for the `CommerceOrder != Invoice` / `SalesChannel != Branch !=
Warehouse` boundary statements only), `PR-COM-0-COMMERCE-MODULE-BOUNDARY-TEST-HARNESS.md`
+ its implementation report, `PR-COM-1A-IMPLEMENTATION-REPORT.md`,
`app/Support/CommerceBoundary.php`, `app/Services/Commerce/AvailableToSellService.php`,
`app/Services/Commerce/AvailableToSellSnapshot.php`, and the COM-0/COM-1A
test files. Did not re-read `AWJ_COMMERCE_EXISTING_ARCHITECTURE_AUDIT.md` in
full or the Evidence Passes beyond what ADR-02 itself already cites —
verified current-code reality directly instead (see §4), per the task's own
instruction not to re-audit.

## 4. AWJ VERIFIED findings

- **`Product`**: `quantity_on_hand`/`avg_cost` are global (all-warehouse)
  columns, unchanged by this PR.
- **`ProductWarehouseStock`** (`product_warehouse_stock`, unique
  `(product_id, warehouse_id)`): the per-warehouse quantity breakdown —
  confirmed still the sole "On Hand" source PR-COM-1A established. Its
  unique index is exactly the natural lock target the task pointed to.
- **`InventoryService::assertStockAvailable()`** reads this same table the
  same way, without locking it — that existing read is a plain availability
  check for legacy documents, not a reservation; it is not part of this
  PR's atomic path and was not touched.
- **`InventoryService::adjustWarehouseStock()`** is the *only* writer of
  `product_warehouse_stock.quantity`, via `firstOrCreate()` + `increment()`,
  called only from `applyReceipt()`/`applyIssue()`. `InventoryReservationService`
  never calls any of these — it only reads the row (locked, for
  serialization) and never writes to it.
- **Idempotency precedents inspected**: `public_api_idempotency_keys`
  (`database/migrations/2026_09_01_050000_...php`) — HTTP-request-generic,
  fingerprint of method+path+query+body, unique
  `(tenant_id, api_client_id, key_hash)` as the concurrency gate ("بوابة
  التزامن = قيد فريد"). `pos_checkout_attempts` — a simpler, domain-level
  anchor row: `idempotency_key` + `request_checksum` columns directly on the
  mutation's own table, unique `(tenant_id, branch_id, idempotency_key)`.
  `PosService::checkout()`'s exact structure —
  `Branch::lockForUpdate()` as a serialization anchor, then
  `PosCheckoutAttempt::where('idempotency_key', ...)->lockForUpdate()->first()`,
  and critically: the `catch (QueryException $exception)` for the
  unique-violation race sits **outside** `DB::transaction()`, not inside —
  because Postgres aborts the whole transaction on the first failing
  statement, and any further query on that same (now-aborted) transaction
  would itself fail. This exact structural detail is reused verbatim in
  `InventoryReservationService::acquire()`.
- **`ProductReferenceRegistry`** — a *third* reflection-based guard
  (`ProductReferenceClassificationGuardTest`, distinct from
  `BranchIsolationGuardTest`) requires every model carrying a `product_id`
  column to declare a lifecycle classification (`BUSINESS_HISTORICAL`,
  `INVENTORY_SEMANTIC`, `COMMERCIAL_LIVE`, `OWNED_CHILD`, `AUDIT_HISTORY`).
  **This was not found during initial design** and only surfaced on the
  first full-suite run (§21) — `StockMovement`/`ProductWarehouseStock` are
  its closest precedent, both classified `INVENTORY_SEMANTIC` alone.
- **Composer/PSR-4**: no new namespace or directory — `app/Services/Commerce/`
  already exists (PR-COM-1A), `app/Models/` and `tests/Feature/` are already
  flat-copied by `setup.sh`/`ci.yml`/`deploy/assemble.sh`. Zero changes
  needed to any assembly script.
- **PostgreSQL CI**: `ci.yml` already runs a `pgsql` matrix leg
  (`postgres:16` service, `nibras`/`secret`/`nibras`). This sandbox has a
  real, installable PostgreSQL 16 server (used identically in PR-COM-1A);
  started it and pointed `.env` at the same credentials CI uses.
- **`pcntl`/`posix` extensions**: both present in this sandbox
  (`php -m | grep pcntl` → found), enabling genuine multi-process
  concurrency testing without any new dependency.

## 5. DERIVED decisions

- **Location key**: `warehouse_id`, unchanged from PR-COM-1A — no new
  aggregate.
- **Reference/ownership design** (task §5: "design ownership/reference in a
  way that allows linking CommerceOrder later without an early dependency"):
  reused the **existing** `source_type` (string) + `source_id` (uuid)
  polymorphic-reference shape already used by `journal_entries` and
  `stock_movements` (verified identical column types/nullability in their
  migrations). No FK to a `CommerceOrder` table (it does not exist), no new
  polymorphic convention invented.
- **Column naming**: `base_quantity` (not ADR-02's placeholder
  `quantity_base`) — matches the existing `stock_permit_lines.base_quantity`
  column added by `2026_09_06_020000_add_uom_to_stock_permit_lines.php`.
  ADR-02 explicitly disclaims its own schema sketch ("This is not an
  approved database schema"), so the actual repo convention wins.
- **Quantity type**: `unsignedInteger`, matching
  `product_warehouse_stock.quantity`, `products.quantity_on_hand`, and
  every other quantity column checked (`stock_movements.quantity`,
  `stock_permit_lines.base_quantity`) — all plain `integer`/`unsignedInteger`,
  never fractional, never `bigint` (bigint in this repo is reserved for
  money/halalas per `CLAUDE.md`). No fractional base-quantity support exists
  anywhere in AWJ today, so none was invented here.
- **Status representation**: DB `enum('active','consumed','released','expired')`,
  matching `stock_permits.status`'s existing `enum('draft','posted')` column
  convention (not a PHP backed-enum class — no such convention exists in
  this codebase for status columns).
- **Branch isolation classification**: `InventoryReservation implements CompanyWide`
  (not `BranchScoped`), with `ResolvesBranchReferences`/`referenceBelongsTo()`
  for its `product()` relation and a plain `belongsTo()` for `warehouse()` —
  this is `ProductWarehouseStock`'s exact classification and relation shape,
  chosen because a reservation is inherently warehouse-scoped (like
  warehouse stock itself), not branch-scoped as an independent dimension.
- **FK delete behavior**: `restrictOnDelete()` on `product_id`/`warehouse_id`
  (matching `pos_checkout_attempts`'s style for its own FKs), not
  `cascadeOnDelete()` (which `product_warehouse_stock` uses) — because
  ADR-02 §3 explicitly wants reservations to remain auditable rather than
  silently vanish; a hard product/warehouse delete should be blocked while
  reservation history exists (and now is, via §4's `ProductReferenceRegistry`
  finding), not silently cascade it away.
- **No idempotency key needed for release/consume/expire**: unlike
  `acquire()` (which creates a NEW row and would double-reserve on a naive
  retry), these operations are idempotent *by state* — retrying `release()`
  on an already-`released` row is a safe no-op because there is nothing
  quantity-like to double-apply, only a status flag to (re-)confirm. This
  is argued explicitly in §7/§12 rather than assumed.

## 6. Reservation data model

`app/Models/InventoryReservation.php` (table `inventory_reservations`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `tenant_id` | uuid, FK `tenants`, cascade | auto-filled by `BelongsToTenant` |
| `warehouse_id` | uuid, FK `warehouses`, restrict | |
| `product_id` | uuid, FK `products`, restrict | |
| `base_quantity` | unsignedInteger | > 0 always; app-validated, see §12 |
| `status` | enum | `active` (default) / `consumed` / `released` / `expired` |
| `source_type` | string, nullable | future `CommerceOrder` (or other) reference |
| `source_id` | uuid, nullable | |
| `idempotency_key` | string(128) | |
| `request_checksum` | string(64) | sha256 hex |
| `expires_at`, `released_at`, `consumed_at`, `expired_at` | timestamp, nullable | audit trail per transition |
| `created_at`, `updated_at` | timestamp | |

Constraints: `unique(tenant_id, idempotency_key)` (idempotency gate),
`index(tenant_id, product_id, warehouse_id, status)` (the ATS hot-read
shape), `index(source_type, source_id)` (matching `journal_entries`/
`stock_movements`' identical index).

## 7. Reservation lifecycle / state machine

```
              ACTIVE
              /  |  \
             /   |   \
      RELEASED CONSUMED EXPIRED
```

Only `ACTIVE → {RELEASED, CONSUMED, EXPIRED}` transitions exist; there is no
code path back to `ACTIVE` from any other state, and no lateral transition
(`RELEASED → CONSUMED`, etc.) is possible — `InventoryReservationService::transition()`
(the shared private implementation behind `release()`/`consume()`/`expire()`)
enforces: if the current status already equals the target, return the row
unchanged (idempotent no-op, retry-safe); if the current status is anything
*other* than `active` and not already the target, throw
`InvalidReservationStateTransitionException`. This single rule produces all
of: repeated `release()` is safe; `consume()` after `release()` is rejected;
`release()` after `consume()` is rejected; any operation on an `expired`
reservation other than `expire()` itself is rejected. `expire()` has no
scheduler/worker executing it — it is an explicit domain operation only, per
the task's explicit exclusion of building one in this PR.

## 8. Atomic acquisition algorithm

```
acquire(productId, warehouseId, baseQuantity, idempotencyKey, sourceType?, sourceId?):
  if baseQuantity <= 0: reject (RuntimeException) — before any DB work
  checksum = sha256(productId|warehouseId|baseQuantity|sourceType|sourceId)

  try:
    DB::transaction:
      existing = InventoryReservation.where(idempotency_key = key).first()   # tenant-scoped automatically
      if existing: assertChecksumMatches(existing, checksum); return existing

      assert product exists (tenant-scoped, BranchScope bypassed — see §11)
      assert warehouse exists (tenant-scoped)

      stockRow = ProductWarehouseStock.where(product, warehouse).lockForUpdate().first()
      onHand = stockRow?.quantity ?? 0        # absent row ⇒ 0, no lock needed (see below)

      activeReserved = SUM(base_quantity WHERE product, warehouse, status='active')
      available = max(0, onHand - activeReserved)
      if available < baseQuantity: reject (InsufficientAvailabilityException)

      insert InventoryReservation(status='active', ...)
  catch QueryException as e:
    if not unique-violation: rethrow
    existing = InventoryReservation.where(idempotency_key = key).first()   # re-read after rollback
    if not existing: rethrow
    assertChecksumMatches(existing, checksum); return existing
```

**Why the `catch` is outside `DB::transaction()`**: PostgreSQL aborts the
entire transaction on the first failing statement; catching inside the
closure and then issuing another query on the same transaction would itself
immediately fail (`25P02`). `PosService::checkout()` already solves this by
catching at the same level as the `DB::transaction()` call — Laravel's
transaction wrapper rolls back automatically before the exception reaches
that outer `catch`, so the re-read runs on a fresh, valid transaction. This
PR's `acquire()` mirrors that structure exactly.

**Why a missing `product_warehouse_stock` row needs no lock**: if the row
does not exist, On Hand is deterministically `0` (nothing has ever moved
stock for that product/warehouse). Since `baseQuantity` is always `> 0`,
`available = max(0, 0 - activeReserved) ≤ 0 < baseQuantity` holds
regardless of concurrent activity — there is nothing to race over. Locking
or creating the row in this branch would only add a needless
`firstOrCreate()` race (itself resolvable only via the same unique
constraint the row already has) for a case that can never succeed anyway.

## 9. PostgreSQL locking strategy

**Lock target**: the `product_warehouse_stock` row for
`(product_id, warehouse_id)`, via `->lockForUpdate()` inside
`DB::transaction()`. This is the exact row the task named as the natural
candidate, confirmed via its existing `unique(['product_id', 'warehouse_id'])`
constraint (verified in `2025_01_01_000033_create_warehouses.php`) — one row
per product×warehouse pair, already tenant-scoped via its own `tenant_id`
column and via the FKs it holds.

**Why this row is a valid serialization point for the reservation SUM
(a different table)**: two transactions competing for the same
product+warehouse both attempt `lockForUpdate()` on the *same* row. The
first to acquire it proceeds, reads `activeReservedQuantity()`, inserts its
reservation, and commits (releasing the lock). The second transaction was
blocked at the `lockForUpdate()` call itself — a genuine PostgreSQL
row-level block, not an application-level wait — and only proceeds after
the first commits, at which point its own `activeReservedQuantity()` read
sees the first transaction's now-committed row. This is the standard
"lock a stable anchor row to serialize a broader computed value" pattern,
identical in shape to `PosService::checkout()`'s `Branch::lockForUpdate()`
anchor.

**Isolation level**: left at the connection default (READ COMMITTED) — no
`SERIALIZABLE`/`REPEATABLE READ` override was introduced. `lockForUpdate()`
under READ COMMITTED is sufficient and is the same level every other
locking service in this codebase (`PosService`, `CashBankTransferService`,
`StocktakeService`) already relies on; no precedent anywhere in AWJ sets a
non-default isolation level.

**Idempotency race (different concern from oversell)**: resolved
independently by the `unique(tenant_id, idempotency_key)` DB constraint —
this catches a race even when two competing requests target *different*
product/warehouse pairs (which would not contend on the same
`product_warehouse_stock` lock) but reuse the same key: whichever INSERT
loses hits the unique-violation path and is replayed/conflict-checked
exactly as a sequential retry would be.

## 10. Real PostgreSQL concurrency evidence

`tests/Feature/InventoryReservationPostgresConcurrencyTest.php` — genuine OS
multi-process concurrency via `pcntl_fork()`, not a sequential simulation:

- Each of two child processes is a real, separate OS process forked from the
  already-booted test process. Each child calls `DB::purge()` immediately
  after forking (PDO connections are not fork-safe — sharing the parent's
  socket across two processes corrupts the wire protocol) so it opens its
  own independent PostgreSQL connection.
- A file-existence busy-wait barrier is used so both children start their
  `acquire()` call as close to simultaneously as the OS scheduler allows,
  rather than one finishing before the other is even forked.
- Because the test writes real, **committed** rows (not inside `RefreshDatabase`'s
  wrapping, uncommitted transaction — a forked child's fresh connection
  cannot see another connection's uncommitted work), this test class does
  its own manual setup/teardown against the real database instead of using
  `RefreshDatabase`. It self-skips (via `markTestSkipped`) when the active
  connection is not `pgsql` or when `pcntl_fork` is unavailable.

**Case A — competing reservations** (`competing_reservations_cannot_collectively_oversell`):
On Hand = 10, two forked processes each call `acquire(..., 7, ...)`
simultaneously.
Result (PostgreSQL, 5 consecutive runs, all identical): **exactly one
succeeds, exactly one fails with `InsufficientAvailabilityException`**,
`activeReservedQuantity() === 7`, `ATS.availableToSell === 3`. Never 14
(double-reserved), never 0 (both rejected).

**Case B — exact boundary** (`reserving_exactly_to_the_boundary_succeeds_for_both_requests`):
On Hand = 10, reserve 6 then reserve 4 (sequential, per the task's own
"then" phrasing for this case — Case B tests SUM-boundary correctness, not
lock contention). Result: **both succeed**, `activeReservedQuantity() === 10`,
`ATS.availableToSell === 0`.

**Case C — one extra unit** (`one_unit_beyond_a_fully_reserved_boundary_is_rejected`):
Continuing from a fully-reserved (10/10) state, a further `acquire(..., 1, ...)`
**fails** with `InsufficientAvailabilityException`.

Ran the full concurrency file **5 times in a row** against the same live
PostgreSQL 16 instance — identical pass/fail outcome every time (see §21),
confirming determinism rather than a lucky race.

## 11. ATS integration

`AvailableToSellService::forWarehouse()` (unchanged file location, same
class) now depends on `InventoryReservationService` via constructor
injection:

```php
$activeReserved = $this->reservations->activeReservedQuantity($productId, $warehouseId);
```

replacing the PR-COM-1A placeholder `$activeReserved = 0;`. `onHand`'s
source and every existing PR-COM-1A test/assertion around it are
untouched. Dependency direction is one-way
(`AvailableToSellService → InventoryReservationService`) — `acquire()`
reads `ProductWarehouseStock` directly rather than depending back on
`AvailableToSellService`, so no circular dependency was created.

## 12. Idempotency contract

- **Gate**: `unique(tenant_id, idempotency_key)` on `inventory_reservations`
  — the same "race to insert, loser hits the constraint" pattern as
  `pos_checkout_attempts`/`public_api_idempotency_keys`.
- **Conflict detection**: `request_checksum` = `sha256(productId|warehouseId|baseQuantity|sourceType|sourceId)`,
  compared via `hash_equals()` (timing-safe, matching `PosService`'s exact
  call). Same key + same checksum → the original row is returned verbatim
  (no new insert, no double reservation). Same key + different checksum →
  `InventoryReservationIdempotencyConflictException`.
- **Tenant scoping**: the idempotency lookup
  (`InventoryReservation::where('idempotency_key', $key)->first()`) is
  automatically tenant-scoped by `TenantScope` on `BaseModel` — no
  `tenant_id` parameter is accepted from the caller anywhere in this
  service, and the unique constraint itself is compound on `tenant_id`, so
  the same literal key string used by two different tenants can never
  collide (tested explicitly, §18).
- **No idempotency key for `release`/`consume`/`expire`**: argued in §5 —
  these are idempotent by state transition, not by a keyed anchor.

## 13. Tenant isolation

- Every model touched (`InventoryReservation`, `Product`, `Warehouse`,
  `ProductWarehouseStock`) extends `BaseModel`, so `TenantScope` filters
  every query automatically. **No `withoutGlobalScope(TenantScope::class)`
  or `withoutGlobalScopes()` appears anywhere in this diff** — grep-verified.
- The only scope override present is `withoutGlobalScope(BranchScope::class)`
  on the product-existence check in `acquire()` — identical in shape and
  justification to PR-COM-1A's `AvailableToSellService::forWarehouse()` (and
  ultimately to the pre-existing `InventoryReportService::trackedProducts()`):
  a reservation is answered for an explicitly named warehouse, not the
  caller's ambient active branch, so filtering existence by that unrelated
  branch would hide a real product for no reason connected to the question
  being asked. This is a **repeat** of an already-approved pattern, not a
  new one — no `TenantScope` bypass was needed or introduced, so no STOP
  condition was triggered.
- Negative tests (all passing, §18): a foreign-tenant `productId`/`warehouseId`
  passed to `acquire()` is rejected (the existence check fails under the
  caller's real `TenantContext`, since the row simply is not visible);
  `release()` on another tenant's reservation ID throws
  `ModelNotFoundException` (the tenant-scoped `findOrFail()` cannot see it —
  no bespoke tenant-matching code was written, the same `BaseModel`
  machinery that already protects every other model protects this one);
  idempotency keys never collide across tenants (verified via a raw
  `DB::table()` count, deliberately avoiding any Eloquent scope bypass in
  the test itself).

## 14. Warehouse/location semantics

Unchanged from PR-COM-1A: `warehouse_id` is the location key
(`App\Models\Warehouse`), required (not nullable) in every reservation
method — no `SalesChannel`, `FulfillmentPolicy`, or `PickupLocation` was
introduced, and `Branch` was never substituted for `Warehouse` anywhere in
this diff.

## 15. UOM / base-quantity semantics

No conversion logic was added. `base_quantity` is accepted and stored
verbatim as an integer — the caller (a future Commerce orchestration layer)
is responsible for resolving any commercial UOM to base quantity *before*
calling `acquire()`, using AWJ's existing `UnitConversion` authority, exactly
as PR-COM-1A already established for `AvailableToSellService`. No second
UOM-conversion authority exists in this PR (ADR-02 §10 explicitly forbids
one). Verified by test
(`the_reservation_quantity_is_stored_verbatim_as_base_units`): a value
passed to `acquire()` comes back unchanged on the created row.

## 16. DB migration / schema / indexes / constraints

One new migration:
`database/migrations/2026_09_12_010000_create_inventory_reservations_table.php`
— creates `inventory_reservations` only (see §6 for full column list).
**No existing table was altered.** Index reasoning:

- `unique(tenant_id, idempotency_key)` — required for the idempotency gate
  itself (§12); without it the "race to insert" pattern has nothing to
  collide against.
- `index(tenant_id, product_id, warehouse_id, status)` — the exact shape of
  `activeReservedQuantity()`'s `WHERE tenant_id = ? AND product_id = ? AND
  warehouse_id = ? AND status = 'active'` query, which `AvailableToSellService`
  now runs on every ATS lookup (the task's own "ATS must not become a
  full-table scan" requirement). No broader or narrower composite was
  added — this one index serves both the ATS read and any future
  per-warehouse reservation listing.
- `index(source_type, source_id)` — matches the identical index already
  present on `journal_entries` and `stock_movements` for the same
  polymorphic-reference shape; kept for consistency and because a future
  `CommerceOrder`-side "find all reservations for this order" query will
  need it.

## 17. Changed files

```
A  app/Models/InventoryReservation.php
A  app/Services/Commerce/InventoryReservationService.php
A  app/Services/Commerce/InsufficientAvailabilityException.php
A  app/Services/Commerce/InventoryReservationIdempotencyConflictException.php
A  app/Services/Commerce/InvalidReservationStateTransitionException.php
M  app/Services/Commerce/AvailableToSellService.php     (activeReserved wired to real data; +constructor dep)
A  database/migrations/2026_09_12_010000_create_inventory_reservations_table.php
M  app/Support/ProductReferenceRegistry.php              (InventoryReservation classified INVENTORY_SEMANTIC)
M  tests/Feature/ProductReferenceRegistryTest.php         (contract-snapshot list updated — see §21)
A  tests/Feature/InventoryReservationServiceTest.php      (26 tests, functional, both engines)
A  tests/Feature/InventoryReservationPostgresConcurrencyTest.php (3 tests, PostgreSQL-only, self-skips elsewhere)
```

No route file, no controller, no UI file, no `setup.sh`/`ci.yml`/
`deploy/assemble.sh` change (no new directory was introduced this time —
`app/Services/Commerce/` already existed from PR-COM-1A).

## 18. API impact

**NONE.** No route registered — reconfirmed by re-running PR-COM-0's own
`CommerceModuleBoundaryTest::no_commerce_api_route_is_registered_yet`
(still green; see §21).

## 19. Accounting impact

**NONE.** `InventoryReservationService` calls no `LedgerService` method and
creates no `Account`/`JournalEntry`/`JournalLine`. Verified by test
(`no_journal_entry_is_created_across_the_full_lifecycle`): `acquire()` +
`release()` leaves `JournalEntry::count() === 0`.

## 20. Inventory mutation impact

**NONE** on physical stock. `InventoryReservationService` never calls
`InventoryService`, never creates a `StockMovement`, and never writes to
`products.quantity_on_hand`/`avg_cost` or `product_warehouse_stock.quantity`
— it only *reads* the latter (locked, for serialization). Verified by three
dedicated tests: no `StockMovement` row is ever created across a full
acquire→consume lifecycle; `Product.quantity_on_hand`/`avg_cost` and the
`product_warehouse_stock` row are bit-for-bit unchanged after a full
acquire→consume cycle.

## 21. ZATCA impact

**NONE.** No ZATCA class, route, or table is referenced anywhere in this
diff. `no_invoice_or_zatca_artifact_is_created` additionally confirms zero
`Invoice` rows are created by any reservation operation.

## 22. Backward compatibility

No behavior change to `InvoiceService`, `PosService`/POS checkout,
`PurchaseService`, `ReturnService`, `StockPermitService`, `Warehouse`
transfer, or legacy negative-stock handling — none of these files were
touched. Confirmed by the full representative regression run (§24: 127
tests, PostgreSQL) covering exactly these paths, all green, identical pass
count to the PR-COM-1A baseline for the same filter.

## 23. Tests — commands and results

All commands run against the generated app (`../nibras-app`, assembled from
this core at commit `91e7843`).

### Tier 1 — new tests (functional, both engines)

| Command | SQLite | PostgreSQL |
|---|---|---|
| `--filter=InventoryReservationServiceTest` | PASS 26/26 (54 assertions) | PASS 26/26 (54 assertions) |
| `--filter=InventoryReservationPostgresConcurrencyTest` | **SKIPPED 3/3** (correct — driver guard) | PASS 3/3 (11 assertions), 5 consecutive runs identical |

### Tier 2 — COM-1A regression + isolation guards (PostgreSQL)

| Command | Result |
|---|---|
| `--filter='InventoryReservationServiceTest\|AvailableToSellServiceTest\|CommerceModuleBoundaryTest\|BranchIsolationGuardTest\|ApiTenantIsolationTest'` | PASS 50/50 (225 assertions) |

### Tier 3 — CommerceModuleBoundaryTest / BranchIsolationGuardTest / ApiTenantIsolationTest

Included in the combined run above — all green, unchanged from PR-COM-1A's
own report.

### Tier 4 — representative Inventory/Warehouse/UOM + Invoice/Purchase/Return/POS regression (PostgreSQL)

`--filter='InventoryTest|WarehouseTest|WarehouseAwareDocumentsTest|StockPermitTest|StockPermitUomValuationTest|PurchaseTest|ReturnTest|InvoiceInventoryApiTest|PosCheckoutTest|LedgerTest'`
→ **PASS 127/127 (902 assertions)**.

### Tier 5 — full backend suite, both engines

| Engine | Result |
|---|---|
| PostgreSQL 16 (real, local) | **2934 passed**, 25 failed, 0 skipped (19715 assertions), 665.99s |
| SQLite | **2923 passed**, 25 failed, 11 skipped (19678 assertions), 302.01s |

Reconciliation against PR-COM-1A's own report baseline (pgsql: 2905
passed/25 failed; sqlite: 2897 passed/25 failed/8 skipped):

- **pgsql**: 2934 − 2905 = **29** new passing tests = 26
  (`InventoryReservationServiceTest`) + 3 (the concurrency tests, which
  *run and pass* on this engine rather than skip).
- **sqlite**: 2923 − 2897 = **26** new passing tests
  (`InventoryReservationServiceTest`, identical on both engines); 11 − 8 =
  **3** new skips (the concurrency tests, which correctly self-skip on
  sqlite instead of passing).

Both reconcile exactly to "26 functional tests pass everywhere, 3
concurrency tests pass only on pgsql and skip only on sqlite" — no
unexplained count.

### Tier 4 failure triage — identical pre-existing baseline on both engines

The 25 failures are **byte-for-byte identical** to PR-COM-1A's own
already-triaged baseline, on both engines: 24 `Fuel*Test` failures
(`bcmath` PHP extension absent in this sandbox — `FuelCostBasisService::bcmul`)
and 1 `DocumentCenterSecureIntakeTest` PDF-fixture validation gap. None
touch Commerce, Inventory, Invoice, Ledger, Payment, ZATCA, POS, or any
isolation/guard test.

## 24. PostgreSQL concurrency evidence (see also §10)

Summarized: real `pcntl_fork()`-based OS multi-process test, 5 consecutive
runs of the full concurrency file, identical outcome every time — Case A/B/C
all as specified in the task. This is not simulated or skipped in CI's
`pgsql` matrix leg (the test only *skips* when the driver is not `pgsql`,
which the `pgsql` CI leg is not).

## 25. Full SQLite/PostgreSQL suite results

See §23 Tier 5 table above.

## 26. CI status

Not pushed through GitHub Actions in this task (per instructions: do not
merge, do not deploy). All commands above were run locally against a
real, separately-installed PostgreSQL 16 instance configured with the exact
same credentials `ci.yml`'s `services.postgres` block uses, and against
SQLite via the same `setup.sh`-equivalent assembly this repo's own CI uses.
The `pgsql` extension, `bcmath` (missing, pre-existing), and `pcntl` were
all verified present/absent exactly as documented in §4/§23.

## 27. Performance / query reasoning

`acquire()` issues, in the common (non-replay) path: 1 idempotency lookup, 2
`EXISTS` checks (product, warehouse), 1 locked `SELECT` on
`product_warehouse_stock`, 1 `SUM` on `inventory_reservations` (served by
the new composite index, §16), 1 `INSERT`. No loop, no N+1, no eager-loading
needed (no relation is traversed — everything is queried by explicit ID).
`activeReservedQuantity()` (the method `AvailableToSellService` now calls on
every ATS lookup) is a single indexed `SUM` — the exact query the new
`(tenant_id, product_id, warehouse_id, status)` index was added for; without
it, this would degrade to a sequential scan of the whole reservations table
as it grows, which is precisely the "ATS becomes a full-table scan" failure
mode the task warned against. No cache and no denormalized/materialized
counter was added — `SUM()` over an indexed, narrow-predicate query is cheap
enough at this stage, matching the task's explicit instruction not to
prematurely optimize.

## 28. Diff scope validation

`git status --porcelain` after commit shows exactly the 11 files listed in
§17 (8 new, 3 modified) — no lockfile, no generated file, no formatting
sweep, no unrelated doc, no route/API file, and critically **no change to
`InvoiceService`, `InventoryService`'s mutation methods, `LedgerService`,
`PaymentService`, or any ZATCA file**. The three modified files
(`AvailableToSellService.php`, `ProductReferenceRegistry.php`,
`ProductReferenceRegistryTest.php`) are each small, targeted diffs (see
§17); `git diff --stat` for them totals 25 insertions / 3 deletions.

## 29. Risks / Open findings

- **Resolved during this task, not left open**: the `ProductReferenceClassificationGuardTest`
  requirement was missed in the initial design pass and only caught by
  running the full suite (§4, §23) — it is fixed in this PR (classification
  + snapshot-test update), not deferred. Documented here transparently
  because the task requires reporting exactly this kind of finding rather
  than silently folding it in.
- **OPEN / REQUIRES VERIFICATION** — `expire()` has no automatic execution
  path (no scheduler/worker), exactly as the task requires for this PR. A
  future PR introducing time-bounded checkout holds (ADR-02 §5) will need
  to decide who calls `expire()` and on what cadence; this PR only provides
  the domain operation, not its trigger.
- **OPEN / REQUIRES VERIFICATION** — whether `acquire()` should reject
  reservations against a product where `track_inventory === false` (ADR-02
  §9: "non-inventory items do not reserve stock"). Not implemented as an
  explicit guard in this PR because no required test case exercises it and
  the natural behavior already degrades safely: an untracked product has no
  `product_warehouse_stock` row, so `onHand = 0` and any positive
  reservation request is rejected by the ordinary insufficient-availability
  path — the *outcome* ADR-02 §9 wants is already achieved, just not via an
  explicit `track_inventory` check. Flagging so a future PR makes this
  conscious rather than assuming it was deliberately designed this way from
  first principles.
- **OPEN / REQUIRES VERIFICATION** — partial fulfillment (ADR-02 §13:
  reserving 10, fulfilling 6, 4 remaining reserved) is not implemented as a
  distinct operation. `consume()` in this PR transitions an entire
  reservation row from `active` to `consumed` — there is no split/partial
  reservation primitive yet. Building one (splitting a reservation row, or
  consuming a sub-quantity) is future work, likely PR-COM-1B's direct
  follow-on when fulfillment/checkout flows are designed, not a defect in
  this PR's scope (ADR-02 itself defers the exact representation: "may
  represent this using split reservation records, quantity fields,
  immutable events, or another proven design").

## 30. Remaining work

Per the master plan, strictly next in sequence (not started, per explicit
instruction not to begin it in this task): `PR-COM-2A` and everything listed
in the task's "Absolute Out of Scope" section (`SalesChannel`,
`FulfillmentPolicy`, `CommerceListing`, `CommerceOrder`, `Cart`, `Checkout`,
customer identity/auth, public/mobile Commerce API, `PaymentIntent`,
provider integration, shipping, Invoice bridge, returns redesign, external
channels, B2B, Product Variants, promotions, UI). Also open: the three
findings in §29 (expire() trigger policy, explicit `track_inventory` guard,
partial fulfillment) — none block moving forward, all are conscious,
documented deferrals.

## 31. Git

- **Branch:** `claude/pr-com-1b-inventory-reservation`
- **PR:** opened against `main` — link recorded in a follow-up commit to
  this report (see final chat message for the URL)
- **Base SHA:** `8eeaff24e75e29437db176b2e314ad6e3f1ab730`
- **Head SHA:** `91e784351ec16af5f42455b4bd0e129962de8d76` (before adding
  this report)

## 32. Recommended next step

**PR-COM-1B is clean**: a first-class, auditable `InventoryReservation`
exists; `AvailableToSellService` consumes real active-reservation data;
atomic acquisition is proven under genuine PostgreSQL multi-process
concurrency (not simulated), deterministically, across 5 repeated runs;
idempotency is DB-constraint-backed and tenant-scoped; tenant and warehouse
isolation are both proven with negative tests using only existing
`BaseModel`/`TenantScope` machinery (no new bypass introduced); base-unit
quantity semantics are preserved with zero new UOM-conversion logic;
lifecycle transitions are safe and retry-idempotent; no `StockMovement`, no
accounting, no ZATCA, no legacy `Invoice`/POS/Purchase/Return/StockPermit/
Warehouse behavior change; SQLite and PostgreSQL full-suite regressions are
both green against the same pre-existing, environment-caused failure
baseline; the one real gap found during implementation
(`ProductReferenceClassificationGuardTest`) was fixed, not hidden. The three
§29 findings are genuine open design questions for future PRs, not defects
blocking this one.

Recommended next step: **`PR-COM-2A`**, once this PR is reviewed and merged
by its owner (not by this session — per instructions, this session does not
merge or deploy).
