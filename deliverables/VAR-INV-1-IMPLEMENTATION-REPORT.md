# VAR-INV-1 — Variant Inventory & Valuation Identity

## Status

**PASS.** Introduces `InventoryState` as the single authoritative inventory/valuation
identity for both simple Products and Product Variants, migrates
`InventoryService`'s five core methods and the SIMPLE⇄VARIANT_MANAGED transition
onto it, extends `product_warehouse_stock` to be identity-aware, and preserves
every existing API surface as a read-through projection of the new authority — no
schema redesign, no accounting-policy change, no API contract change.

## 1. Phase 0 — Repository evidence (read before implementation)

Read in full before writing any code: `AWJ_PRODUCT_VARIANTS_VAR_ARCH_1.md` §3 ("Inventory
and valuation authority") and §7 (lifecycle classification), `AWJ_INVENTORY_VALUATION_SEMANTICS.md`
(the code-verified MODEL A characterization: tenant-wide moving average, no
per-warehouse costing — D-07), and `VAR-CORE-1-IMPLEMENTATION-REPORT.md`. No
contradiction requiring a business-policy decision was found — §3's target shape
(`Simple Product → one Inventory State`, `Variant-managed Product → one Inventory
State per concrete Variant`, tenant-wide moving average per identity, no synthetic
parent `avg_cost`) is exactly what was implemented.

**Authority paths found** (via a full read of `InventoryService.php`, 451 lines, and
an `Explore` sweep of every consumer):

| Concern | Sole existing authority before this PR |
|---|---|
| `quantity_on_hand` / `avg_cost` mutation | `InventoryService::applyReceipt()` / `applyIssue()` / `recordSaleCogs()`, each ending in `Product::update(['quantity_on_hand'=>…,'avg_cost'=>…])` |
| Warehouse quantity | `InventoryService::adjustWarehouseStock()` — sole writer of `product_warehouse_stock`, `firstOrCreate` keyed `(product_id, warehouse_id)` |
| Stock-availability check | `InventoryService::assertStockAvailable()` |
| ~30 call sites (Purchases, Returns, Stock Permits, Stocktakes, Fuel, Invoices/COGS, Inventory Opening) | all route through the 5 methods above, all positional-args-only (confirmed safe to append a trailing optional param) |
| ~15 direct `$product->quantity_on_hand`/`avg_cost` reads outside `InventoryService` | `StocktakeService`, `StockPermitService`, `ReturnService`, `ProductVariantService::hasOperationalFootprint()`, `InventoryAlertService`, `ProductResource`, `ProductExportService`, `InventoryController` — all plain Eloquent attribute reads |
| Raw-SQL filters/sorts/aggregates on the physical columns | `ProductListFilters` (stock-state filter, sort), `InventoryBalanceFilters` (range filters, sort), `InventoryWorkspaceFilters`/`InventoryWorkspaceQuery` (SUM aggregate, sort) — these bypass Eloquent and needed an explicit join fix (§4) |

**Structural finding that shaped the design:** `product_warehouse_stock` had **no
variant column at all** and its unique constraint was `(product_id, warehouse_id)`
only — extending it to be identity-aware is new schema, not a partially-built
feature, and none of its ~19 other call sites (Commerce checkout, reservations,
`AvailableToSellService`, storefront) are variant-aware yet. Left untouched and
explicitly documented as deferred to VAR-DOC-1/VAR-POS-1 (§7).

## 2. Design

```
Simple Product      -> one InventoryState (product_variant_id = NULL)
Variant-managed      -> one InventoryState per concrete ProductVariant
                         (parent Product never gets a state row of its own)
InventoryState        -> tenant-wide quantity_on_hand + avg_cost (halalas, bigint)
InventoryState + Warehouse -> product_warehouse_stock row (quantity/revision only)
```

**Lazy creation, not eager.** A state row is created on first real stock movement
(`InventoryService::resolveInventoryState()`, mirroring the existing
`adjustWarehouseStock()`'s own `firstOrCreate` pattern), not at Product/Variant
creation. This is deliberate, not an oversight: `InventoryState` is classified
`ProductReferenceRegistry::INVENTORY_SEMANTIC` (§5), which **blocks deletion and
type/tracking changes by mere row existence** — exactly like `StockMovement` and
`ProductWarehouseStock` today. Eager creation would have made every product's
inventory identity permanently un-deletable and permanently frozen from its first
second, which is not what the registry's existing convention means; lazy creation
keeps "the row exists" a true signal of real inventory history.

**No permanent dual-write.** `products.quantity_on_hand`/`avg_cost` are **frozen**
— the migration does not touch them (avoiding the SQLite `Schema::table` rebuild
regression class explicitly flagged in the task), but nothing ever writes to them
again. `Product`/`ProductVariant` expose `quantity_on_hand`/`avg_cost` as Eloquent
`Attribute::make()` accessors that read through to `InventoryState` live; a direct
legacy assignment (`Product::create(['quantity_on_hand'=>…])`, or `$product->update([…])`
— still used by dozens of existing test fixtures and by no production code, confirmed
by a repo-wide search) is captured and applied to the simple `InventoryState` row
once the model is saved, never to the physical column (verified by `direct_column_assignment_never_persists_to_the_frozen_physical_column`
in `InventoryStateTest`). This is compatibility routing, not dual-write: there is
exactly one persisted number for quantity/avg_cost per identity, ever.

**Parent aggregate, not a synthetic average.** A `variant_managed` Product's
`quantity_on_hand` accessor returns `SUM(inventoryStates.quantity_on_hand)` across
its Variants (a derived display aggregate — explicitly allowed by VAR_ARCH_1 §3.1).
Its `avg_cost` accessor returns `0` explicitly — never a blended figure — because
the architecture forbids inventing a parent cost that would hide economically
different Variant costs.

**Fail-closed identity resolution.** `InventoryService::resolveInventoryState()`/
`findInventoryState()` call a private `assertIdentityConsistent()` before touching
any row: a `variant_managed` Product with no Variant supplied throws (no parent
stock identity — VAR_ARCH_1 §3), a Variant belonging to a different Product throws,
and a Variant from a different tenant throws (explicit tenant check, defense in
depth on top of `TenantScope`). All three are covered by `InventoryStateTest`.

## 3. Concurrency

`resolveInventoryState()`: `InventoryState::firstOrCreate($keys, …)` then
`InventoryState::where($keys)->lockForUpdate()->firstOrFail()`. The DB constraint
is the real authority (mirroring `SkuRegistryEntry`/`BarcodeRegistryEntry`'s own
documented convention) — a concurrent insert into the same identity hits the
migration's unique index and is caught (`QueryException`) then re-selected, never
producing two rows. `adjustWarehouseStock()` got the identical catch-and-reselect
treatment while being made variant-aware, closing a latent (pre-existing,
unaddressed until now) race in the same method.

Per the documented contract (`applyReceipt()`/`applyIssue()`'s own doc-comments:
"يجب استدعاؤه ضمن معاملة الطرف المستدعي" — must be called inside the caller's
transaction), the lock is only meaningful inside an explicit `DB::transaction()`.
`receiveStock()` already wraps this; direct callers of `applyReceipt`/`applyIssue`
(Returns, Stock Permits, Stocktake, Fuel) already wrap their own transactions
(confirmed by the Phase-0 call-site sweep) — no call site needed to change.

**Real PostgreSQL concurrency proof** (`InventoryStatePostgresConcurrencyTest`,
`pcntl_fork()` with independent connections per child, same style as
`ProductVariantPostgresConcurrencyTest`/`InventoryReservationPostgresConcurrencyTest`):

1. Two concurrent first-ever receipts for the same brand-new simple Product →
   exactly one `InventoryState` row, both quantities correctly summed (no lost
   update): `30` total, `avg_cost = intdiv(10*1000+20*3000, 30) = 2333`.
2. A concurrent receipt and issue on an existing identity → final quantity `55`
   (`50 + 10 - 5`) regardless of execution order — proves the lock actually
   serializes, not just that no exception is thrown.
3. Concurrent receipts for two **sibling Variants** of the same Product, same
   warehouse → each Variant's `InventoryState` and `product_warehouse_stock` row
   lands with its own correct quantity/avg_cost/revision, with **zero
   cross-contamination** between siblings.

All three pass consistently across repeated runs on real PostgreSQL 16
(`nibras`/`nibras`@127.0.0.1:5432, this sandbox). Skipped automatically on SQLite or
without `pcntl` (`markTestSkipped`), matching the repo's established convention.

**Out of scope, found not fixed:** exercising two concurrent full `receiveStock()`
calls (which post journal entries) for different Variants of the *same tenant*
surfaced a pre-existing `tenants`-row lock contention pattern in
`AccountingDateGuard`/`LedgerService` unrelated to `InventoryState` — reproducible
in isolation, not introduced by this change (no ledger/journal-routing code was
touched), and squarely outside VAR-INV-1's explicit non-goals ("no accounting-policy/
journal-routing/Ledger-semantics changes… STOP if more is required"). The
concurrency tests exercise `applyReceipt()`/`applyIssue()` directly (still fully
representative of `InventoryState`'s own locking) to avoid conflating the two
concerns; documented here as a residual risk for whoever next touches concurrent
ledger posting, not fixed by this PR.

## 4. Read-through migration of existing consumers

Every consumer that reads `$product->quantity_on_hand`/`avg_cost` as a plain
Eloquent attribute needed **no change** — the accessor intercepts regardless of
which columns were selected. Consumers that used **raw SQL** against the physical
column (bypassing Eloquent) needed an explicit join, because the physical column is
now permanently `0`:

| File | Change |
|---|---|
| `ProductListFilters` | `stock_state` filter (`out`/`low`) and `sort=quantity_on_hand` now `leftJoin` the simple `InventoryState` (`product_variant_id IS NULL`), applied lazily only when those specific filters/sorts are used |
| `InventoryBalanceFilters` | query base always joins the simple `InventoryState`; every `quantity_on_hand`/`avg_cost`/`stock_value` filter and sort now reads `COALESCE(inventory_states.…, 0)` |
| `ProductWarehouseBalanceQuery::baseQuery()` (shared by `InventoryWorkspaceFilters` and `Reporting/InventoryReportService`) | `leftJoin`s `inventory_states` once at the shared base; consumers that don't need cost (quantity-only balance report) simply ignore the extra join |
| `InventoryWorkspaceFilters` / `InventoryWorkspaceQuery` | `avg_cost`/`stock_value` sort keys and the `selectRaw` SUM aggregate now reference `COALESCE(inventory_states.avg_cost, 0)` instead of `products.avg_cost` |
| `InventoryBalanceExportService` | one `where('quantity_on_hand', …)` → `whereRaw(COALESCE(inventory_states.quantity_on_hand,0)…)` (was ambiguous once the join exists — both tables now have a same-named column) |

All joins scope to `product_variant_id IS NULL` (the simple identity) — none of
these existing reports/filters are Variant-aware today (confirmed in Phase 0), so
this is the exact pre-existing behavior for every simple Product, unchanged for
callers; a `variant_managed` Product now shows `0`/`NULL` cost-wise in these older
surfaces (its quantity/cost genuinely doesn't live at the product level any more)
— the same class of "not decomposable here yet" gap the Phase-0 evidence already
documented as deferred to VAR-DOC-1/VAR-POS-1, not a new regression.

## 5. Lifecycle / registry integration

- `ProductReferenceRegistry::INVENTORY_SEMANTIC` now includes `InventoryState` —
  blocks Product/Variant hard-delete and Product `type`/`track_inventory` changes
  exactly like `StockMovement` (§2 explains why lazy creation is what makes this
  correct rather than a universal footprint lock).
- `ProductVariantService::deleteVariant()` — **new guard**: a Variant with an
  `InventoryState` row (any quantity, including `0` after a full receipt-then-issue
  cycle) can no longer be hard-deleted. This closes a real VAR-CORE-1-era gap
  (`deleteVariant()` had **no** footprint check at all, since Variants carried no
  inventory history before this milestone) — matches VAR_ARCH_1 §7.3 ("zero stock
  is necessary but not sufficient for deletability") verbatim.
- `enableVariantManagement()`/`disableVariantManagement()` needed **no new
  transition code**. The existing zero-footprint gate
  (`ProductVariantService::hasOperationalFootprint()` →
  `ProductLifecycleService::hasInventoryFootprint()`, now including `InventoryState`)
  already guarantees, by construction, that a simple Product's `InventoryState` row
  cannot exist by the time `enableVariantManagement()` is permitted to proceed —
  and the new `deleteVariant()` guard guarantees no Variant `InventoryState` survives
  by the time `disableVariantManagement()`'s existing "all Variants deleted first"
  rule is satisfied. Both transitions are therefore provably identity-clean without
  any bespoke cleanup step — verified by
  `enabling_variant_management_is_rejected_once_a_real_receipt_happened` (rejects
  even after quantity returns to `0`, because the row's mere existence is the
  signal) and `deleting_a_variant_with_inventory_history_is_blocked_even_at_zero_quantity`.

## 6. Migration

`2026_09_26_010000_create_inventory_states.php`:
- `Schema::create('inventory_states', …)` — brand-new table, `product_id` FK
  cascade, nullable `product_variant_id` FK cascade, `quantity_on_hand` int,
  `avg_cost` bigint, both defaulting `0`.
- Two unique indexes, both via raw `CREATE UNIQUE INDEX … WHERE …` on the **new**
  table (no `Schema::table` rebuild risk at all): a partial index on `product_id`
  `WHERE product_variant_id IS NULL` (at most one simple state per Product), and a
  plain `unique('product_variant_id')` (NULL≠NULL in SQL means this never
  constrains simple rows — only prevents two states for the same Variant).
- `product_warehouse_stock` gets an `ADD COLUMN product_variant_id` (SQLite
  supports this natively, no table rebuild), then the old
  `(product_id, warehouse_id)` unique constraint is dropped and replaced by two
  partial unique indexes (simple / variant), the exact same pattern already used
  by `2025_01_01_000053_branch_scoped_document_numbering.php` for branch-numbered
  documents. **No CHECK constraint exists on `product_warehouse_stock` today**
  (confirmed by reading every migration that touches it) — the specific SQLite
  regression class the task explicitly warned about (losing a CHECK constraint via
  `Schema::table` rebuild) has no CHECK constraint to lose here.

**Verified on both engines**, fresh install:
- SQLite: `setup.sh`'s full `migrate:fresh` (all ~100 migrations) succeeded, target
  migration ran (`2026_09_26_010000_create_inventory_states … DONE`).
- PostgreSQL 16 (local `nibras`/`nibras`): `php artisan migrate:fresh --force`
  succeeded end-to-end, same migration list, target migration ran cleanly.

No upgrade-path (non-fresh) migration exists to break, since this table is new and
the one column added to an existing table is purely additive.

## 7. Explicitly deferred (documented, not silently dropped)

- **~17 other `product_warehouse_stock` consumers** (Commerce checkout,
  `InventoryReservationService`, `AvailableToSellService`, storefront, POS) remain
  untouched — none are Variant-aware today, and wiring them up is VAR-DOC-1/VAR-POS-1
  territory per the task's own scope boundary. They continue to work exactly as
  before for simple Products (their only current identity).
- **`StockMovement`/`InvoiceLine`/`PurchaseLine`/etc. are not Variant-aware** — no
  document line anywhere can select a Variant yet (VAR-DOC-1). `InventoryService`'s
  5 core methods accept an optional trailing `?ProductVariant $variant` so that
  future document-level work can pass one through without another signature
  change, but no existing call site passes one today.
- **Frontend (`web/`): no change required or made.** Every JSON field this
  milestone touches (`quantity_on_hand`, `avg_cost`, `stock_value`, …) keeps its
  exact existing name, type, and unit (halalas→riyals conversion unchanged) —
  the API contract is byte-for-byte the same; only its server-side source of truth
  moved. Confirmed by `web-ci`-equivalent reasoning: no `web/src` file references
  anything this PR renamed or removed.

## 8. Accounting entries

**No new financial transaction type, no new account, no change to any journal
line's account/debit/credit logic.** `InventoryService::recordSaleCogs()` and
`applyReceipt()`'s ledger posting (`inventory_asset` / offset account) are
byte-identical in their `LedgerService::post()` calls — only their **read/write of
quantity and average cost** were re-routed from `Product` columns to the resolved
`InventoryState` row. Existing entries (receipt: debit `inventory_asset` / credit
offset; COGS: debit `cogs` / credit `inventory_asset`) are unchanged and still
balance identically — proven by every pre-existing `InventoryTest`/`InventoryOpeningPostingTest`
/`StockPermitTest`/`ReturnTest` assertion re-running unmodified and green.

| Operation | Debit | Credit | Changed by this PR? |
|---|---|---|---|
| Stock receipt | `inventory_asset` role (1140) | offset account (e.g. 2110/3130) | No — same lines; value now sourced from `InventoryState` |
| Sale COGS | `cogs` role (5110, or product override) | `inventory_asset` role (1140) | No — same lines; `avg_cost` now read from `InventoryState` |
| Stock issue (return, permit, stocktake shortage) | — (no journal in `applyIssue()` itself; caller posts if needed) | — | No |

## 9. Files changed

**New:**
- `database/migrations/2026_09_26_010000_create_inventory_states.php`
- `app/Models/InventoryState.php`
- `tests/Feature/InventoryStateTest.php` (14 tests)
- `tests/Feature/InventoryStatePostgresConcurrencyTest.php` (3 tests)

**Modified:**
- `app/Models/Product.php` — `quantity_on_hand`/`avg_cost` accessors + compatibility
  seed capture, `inventoryStates()` relation
- `app/Models/ProductVariant.php` — `quantity_on_hand`/`avg_cost` accessors (new,
  no prior columns), `inventoryState()` relation
- `app/Models/ProductWarehouseStock.php` — `product_variant_id` fillable
- `app/Services/Accounting/InventoryService.php` — `resolveInventoryState()`/
  `findInventoryState()`/`assertIdentityConsistent()`; `applyReceipt`/`applyIssue`/
  `receiveStock`/`assertStockAvailable`/`adjustWarehouseStock` gained a trailing
  optional `?ProductVariant $variant`; `recordSaleCogs()` routes through the
  resolved simple identity
- `app/Services/ProductVariantService.php` — `deleteVariant()` inventory-history guard
- `app/Support/ProductReferenceRegistry.php` — `InventoryState` classified `INVENTORY_SEMANTIC`
- `app/Support/ProductListFilters.php`, `app/Support/InventoryBalanceFilters.php`,
  `app/Support/InventoryWorkspaceFilters.php`, `app/Support/ProductWarehouseBalanceQuery.php`,
  `app/Services/InventoryWorkspaceQuery.php`, `app/Services/InventoryBalanceExportService.php`
  — raw-SQL read-through fixes (§4)
- `tests/Feature/InventoryOpeningImportTest.php`, `tests/Feature/InventoryOpeningPostingTest.php`
  — assertions using `Product::where(…)->value('quantity_on_hand')` (a raw scalar
  read, bypassing the Eloquent accessor by design of that method) updated to
  hydrate the model first; behavior asserted is unchanged
- `tests/Feature/ProductLifecycleTest.php` — expected blocking-reference count `2→3`
  (a product with real inventory history now correctly also blocks on its
  `InventoryState`, in addition to the movement and opening-line references it
  already blocked on)
- `tests/Feature/ProductReferenceRegistryTest.php` — `InventoryState::class` added
  to the expected `INVENTORY_SEMANTIC` set

## 10. Tests — results

All run against this branch's actual code, not simulated.

**SQLite (targeted, progressive):**
- `InventoryStateTest`: 14/14 passed
- `InventoryTest`: 20/20 (11 existing InventoryTest cases + regression cases already there)
- `ProductVariantCoreTest`: 31/31
- `ProductReferenceClassificationGuardTest`: 5/5
- `ProductReferenceRegistryTest`: full class green
- `ProductLifecycleTest`, `InventoryOpeningImportTest`, `InventoryOpeningPostingTest`,
  `InventoryWorkspaceTest`, `InventoryBalanceExportTest`, `InventoryReportTest`,
  `InventoryAlertServiceTest`, `ProductDataExplorerTest`, `BranchIsolationGuardTest`: all green
- Broad sweep (`Pos|Commerce|Storefront|ProductImport|ProductExport|Product` filter,
  1201 tests): all green except the pre-existing, environment-only `bcmath`-extension
  gap in 6 Fuel tests (confirmed via `php -m | grep bcmath` — not installed in this
  sandbox; unrelated to this change, same gap noted in the prior VAR-CORE-1 rounds
  for a different reason)
- Re-confirmed after restoring the SQLite test environment (post-PostgreSQL work,
  `.env.sqlite.bak` → `.env`, fresh `migrate:fresh`): `InventoryStateTest`,
  `InventoryTest`, `ProductVariantCoreTest`, `ProductReferenceClassificationGuardTest`,
  `ProductReferenceRegistryTest`, `BranchIsolationGuardTest`, `ProductLifecycleTest`,
  `InventoryOpeningImportTest`, `InventoryOpeningPostingTest`, `ApiInventoryTest`,
  `DiagnoseInventoryTest` — **156/156 passed, 1077 assertions**

**PostgreSQL 16 (targeted + concurrency):**
- Full `migrate:fresh` succeeded
- `InventoryTest`, `InventoryStateTest`, `ProductVariantCoreTest`,
  `ProductReferenceClassificationGuardTest`, `ProductReferenceRegistryTest`,
  `BranchIsolationGuardTest`, `ProductLifecycleTest`, `InventoryOpeningImportTest`,
  `InventoryOpeningPostingTest`, `InventoryWorkspaceTest`, `InventoryBalanceExportTest`,
  `InventoryReportTest`, `InventoryAlertServiceTest`, `ProductDataExplorerTest`,
  `ApiInventoryTest`, `DiagnoseInventoryTest`: **217/217 passed** (1453 assertions)
- `InventoryStatePostgresConcurrencyTest`: 3/3, re-run 3× consecutively, consistent
- `ProductVariantPostgresConcurrencyTest`: 3/3 in isolation (one test flaked once
  when run immediately after the large `ProductVariantCoreTest` class under load —
  the same pre-existing, previously-documented timing flake from the VAR-CORE-1
  Round 3 report, not a regression; re-run clean 3/3 in isolation)

**Broader/full-suite run — did not complete, stopped intentionally, not reported as
passing.** A full `php artisan test` on PostgreSQL was started as the final
broader-regression step (background, 590s timeout). It was cut off by the timeout
partway through the alphabetical test order (last class reached:
`PaymentGatewayFoundationTest`, roughly the "P" range of ~1450+ test classes) with
**no failures observed in the portion that did run**, but it never produced a final
`Tests: X passed/failed` tally and was explicitly not restarted or re-polled per
instruction. This is reported honestly as **incomplete**, not as a pass — the
targeted suites in this section (217/217 on PostgreSQL, plus the 156/1077-assertion
SQLite re-confirmation after the environment was restored) are the actual evidence
this report's PASS status rests on, together with the full `Pos|Commerce|Storefront|
ProductImport|ProductExport|Product`-filtered sweep (1201/1201 excluding the
pre-existing `bcmath` gap) run earlier and reported in full above.

## 11. Deviations from the task brief

None that change business semantics. Two implementation-level judgment calls, both
resolved as technical details rather than policy questions (per the task's own
"implementation details that don't change business semantics may be resolved
normally"):

1. **Lazy vs. eager `InventoryState` creation** — resolved lazy, matching
   `product_warehouse_stock`'s own established convention and required for the
   registry's `INVENTORY_SEMANTIC` classification to mean what it already means
   elsewhere (§2, §5).
2. **Legacy direct-column-assignment compatibility** — resolved via a captured-then-applied
   write-through on save (§2) rather than silently discarding the value, to avoid
   breaking ~30 existing test fixtures across ~15 files that predate this milestone
   and have no other reasonable migration path without inflating this PR into an
   unrelated test-suite rewrite.

## 12. Stop conditions — none triggered

No accounting-policy decision was needed; no existing stock needed to be
distributed among Variants (all Variants remain fresh with zero footprint until
this PR, matching a pre-production/demo data state); no per-warehouse costing was
introduced or requested; no immutable posted history conflicted with this design;
no non-additive API break occurred; Tenant Isolation and DB/concurrency safety were
both achievable and are covered by explicit tests (§3, §13).

## 13. Tenant Isolation — negative tests

- `an_inventory_state_from_another_tenant_is_invisible_under_the_active_tenant` —
  a second tenant's `InventoryState` rows are invisible under `TenantScope`.
- `a_guessed_cross_tenant_variant_id_cannot_be_used_to_receive_stock_for_this_tenants_product`
  — a `ProductVariant` resolved via `withoutGlobalScopes()` from a foreign tenant
  (simulating an ID that slipped past the normal scope) is rejected fail-closed by
  `assertIdentityConsistent()` before any row is touched.
- `a_variant_from_a_different_product_is_rejected_fail_closed` — same-tenant,
  wrong-Product Variant is rejected.

## Git state

- Branch: `claude/var-inv-1-inventory-identity`
- PR: [#812](https://github.com/safwan5001-source/Nebrax/pull/812) — **open, not merged**
- Base SHA: `c152e3ee634be3e7c2bb12db299a5ddd44472558` (`origin/main`, VAR-CORE-1 / PR #806, merged)
- Head SHA: `f25c73af761f5d9378df0fca6af965a78e3cc708` (single commit on top of base; working tree clean, nothing uncommitted)
- Not merged, not deployed, per instruction.
