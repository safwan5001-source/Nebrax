# PR-COM-5B — Order Reservation Orchestration — Implementation Report

## 1. Executive Summary

PR-COM-5B connects a **confirmed** `CommerceOrder` to real inventory
reservation, purely by composing two already-merged authorities: warehouse
resolution via `FulfillmentPolicyService::resolveWarehouseFor()` (PR-COM-2B)
and atomic reservation acquisition via
`InventoryReservationService::acquire()` (PR-COM-1B). One new class,
`App\Services\Commerce\CommerceOrderReservationService`, is added — **zero**
new models, **zero** new migrations, **zero** modified existing files. A
draft order cannot reserve; a confirmed order can, atomically across all its
lines, idempotently on retry, and without ever duplicating COM-1B's ATS/
concurrency/idempotency logic.

26 new functional tests (`CommerceOrderReservationServiceTest`) + 1 new
real-OS-process PostgreSQL concurrency test
(`CommerceOrderReservationPostgresConcurrencyTest`), all green on first run
on both SQLite and PostgreSQL. Zero new full-suite failures on either
engine, and COM-1B's own PostgreSQL concurrency proof re-verified green.

## 2. Base SHA / Head SHA

- **Base:** `origin/main` at `b191c52a2c7856da4998cb5a6ffae148e824d8cb`
  (PR-COM-5A, PR #735) — verified via `git fetch origin main` immediately
  before branching; matched `origin/main` HEAD exactly, so the task
  prompt's stated SHA needed no correction.
- **Branch:** `claude/pr-com-5b-order-reservation-orchestration`, created
  directly from `origin/main` (not from the COM-5A branch).

## 3. Binding sources read

- `docs/plans/store/AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md` — PHASE 5
  full text (PR-COM-5A **and** 5B), §1–4, §15, §16–20.
- `docs/plans/store/ADR-01-COMMERCE-ORDER-ACCOUNTING-BOUNDARY.md` — full
  text, especially §3 (Reservation != Stock Movement) and §6 (accounting/
  inventory responsibility table: "Commerce Order confirmed → Reservation
  according to approved policy → None [accounting effect] by itself").
- `docs/plans/store/ADR-02-INVENTORY-RESERVATION-AVAILABLE-TO-SELL.md` —
  full text, especially §5 ("Reservation timing is policy-driven and
  remains partially undecided... ADR-02 does not approve a universal
  default yet") and §6 (atomic acquisition mandatory).
- `docs/plans/store/ADR-03-CHANNEL-WAREHOUSE-FULFILLMENT-SOURCE.md` — V1
  fixed-location fulfillment.
- `docs/plans/store/PR-COM-1B-IMPLEMENTATION-REPORT.md`,
  `PR-COM-2A-IMPLEMENTATION-REPORT.md`, `PR-COM-2B-IMPLEMENTATION-REPORT.md`,
  `PR-COM-5A-IMPLEMENTATION-REPORT.md`.
- `App\Support\CommerceBoundary` (re-read; unchanged — no new forbidden
  target is touched by this PR).
- Direct code inspection (not prior reports) for every integration
  decision below: `App\Services\Commerce\InventoryReservationService`
  (full `acquire()`/`transition()`/idempotency implementation),
  `App\Services\Commerce\FulfillmentPolicyService` (`resolveWarehouseFor()`),
  `App\Models\InventoryReservation` (`source_type`/`source_id` columns and
  their own doc comment anticipating `CommerceOrder` linkage),
  `App\Models\CommerceOrder`/`CommerceOrderLine`/`App\Services\Commerce\CommerceOrderService`
  (exact fillable fields, `isConfirmed()`, `baseQuantity()`), and the
  AWJ-wide `source_type`/`source_id` convention in
  `App\Services\Accounting\InvoiceService`/`InventoryService`
  (`journal_entries`/`stock_movements` always reference the **header**
  document, never the line, even for multi-line documents).

## 4. Verified current architecture

- `InventoryReservationService::acquire()` is the **sole** atomic
  reservation-authority: opens its own `DB::transaction()`, locks the
  `(product_id, warehouse_id)` row on `product_warehouse_stock`, computes
  `available = onHand - activeReserved` inside that lock, and enforces the
  `(tenant_id, idempotency_key)` unique constraint with `hash_equals()`
  checksum verification on replay. Nothing in this PR reimplements any
  part of that.
- `FulfillmentPolicyService::resolveWarehouseFor(salesChannelId): Warehouse`
  fails explicitly (never falls back) on: channel not found, channel
  inactive, no policy configured, policy warehouse missing/inactive.
- `InventoryReservation.source_type`/`source_id` are free-text generic
  reference columns with **no** existing Eloquent relation method anywhere
  in the codebase (confirmed by inspecting `JournalEntry`, `StockMovement`,
  `InventoryReservation` models directly) — always queried directly, never
  modeled as a `morphTo`/`hasMany`. The COM-1B migration's own comment
  explicitly anticipates linking `CommerceOrder` here later ("مرجعٌ عام
  يسمح بربط `CommerceOrder` لاحقاً حين يُبنى، بلا FK مبكر إليه").
- `CommerceOrder implements CompanyWide` — no `branch_id` column exists on
  the table at all (confirmed via `getAttributes()` in
  `there_is_no_branch_to_warehouse_assumption`).
- `CommerceOrderLine::baseQuantity()` = `quantity × max(1, unit_factor)` —
  the exact snapshot values fixed at order-creation time in PR-COM-5A,
  never re-derived from live `Product`/`UnitConversion` state.

## 5. Orchestration contract

```
CommerceOrderReservationService::reserve(CommerceOrder $order): Collection<InventoryReservation>
CommerceOrderReservationService::reservationsFor(CommerceOrder $order): Collection<InventoryReservation>
```

`reserve()`: re-loads the order under the trusted tenant context (never
trusts the caller-passed object's state), verifies `confirmed`, resolves
one warehouse for the whole order via `FulfillmentPolicyService`, then
calls `InventoryReservationService::acquire()` once per line inside one
enclosing `DB::transaction()`.

## 6. Reservation trigger

**Independent, explicitly-invoked service — not auto-wired into
`CommerceOrderService::confirm()`.** ADR-02 §5 states plainly: *"ADR-02
does not approve a universal default yet"* between `ON_ORDER_CONFIRMATION`
and `ON_PAYMENT_CONFIRMED`, and the Master Plan repeats: *"No universal
tenant default is assumed by this plan. The first launch slice must choose
its policy explicitly."* Building automatic on-confirm reservation now
would silently pick `ON_ORDER_CONFIRMATION` as *the* policy — exactly the
kind of undecided default the task instructs not to guess. What this PR
**does** decide (the one point ADR-02/Master Plan leave no ambiguity on):
a **draft** order can never be reservation-eligible under *any* candidate
policy, so `confirmed` is enforced as the minimum eligibility gate common
to both `ON_ORDER_CONFIRMATION` and `ON_PAYMENT_CONFIRMED` (payment itself
doesn't exist yet, so it cannot gate anything today). No event/listener/
queue was introduced, per explicit instruction.

## 7. Order eligibility

- `draft` → `RuntimeException` ("لا يمكن حجز طلبٍ غير مؤكَّد.").
- `confirmed` → eligible.
- Order not found under the current `TenantContext` → `RuntimeException`
  ("الطلب غير موجود.") — the order is **re-fetched** via
  `CommerceOrder::query()->lockForUpdate()->find($order->id)` rather than
  trusting the passed-in Eloquent instance, so a stale/foreign-tenant
  object can never bypass tenant scoping.

## 8. Warehouse resolution

`CommerceOrder.sales_channel_id → FulfillmentPolicyService::resolveWarehouseFor()`
exclusively. No `Branch` read, no client/customer default warehouse, no
arbitrary request-supplied warehouse, no fallback to any default/first
warehouse, no auto-split. Every COM-2B failure mode (channel not found,
channel inactive, no policy, inactive policy warehouse) propagates
unchanged — verified directly (`no_configured_policy_fails_explicitly`,
`a_disabled_channel_fails_explicitly_even_with_a_configured_policy`,
`an_inactive_policy_warehouse_fails_explicitly`).

## 9. SalesChannel relationship

Read-only: the order's own `sales_channel_id` (set at COM-5A creation time)
is passed to `resolveWarehouseFor()` unchanged. No new SalesChannel logic.

## 10. FulfillmentPolicy reuse

100% reused, zero reimplementation. `CommerceOrderReservationService` does
not read `fulfillment_policies` directly — it only calls the existing
service method.

## 11. InventoryReservationService reuse

100% reused. `acquire()`'s signature, atomicity, checksum/idempotency
logic, and `InsufficientAvailabilityException`/
`InventoryReservationIdempotencyConflictException` are consumed exactly as
COM-1B built them — this PR adds no new locking, no new ATS computation
(`AvailableToSellService` is only used for read-side test assertions, never
called for authorization), no new checksum algorithm.

## 12. Reservation source identity

`source_type = CommerceOrder::class`, `source_id = $order->id` — the
**header**, not the line, matching the AWJ-wide convention confirmed by
direct inspection of `InvoiceService`/`InventoryService`
(`journal_entries.source_id`/`stock_movements.source_id` are always the
owning `Invoice`/`Purchase`, even when multiple lines each produce their
own `StockMovement` row). No new migration/FK — the existing generic
`source_type`/`source_id` columns are sufficient (§27 stop-condition
avoided: no schema change needed).

## 13. Quantity/base quantity contract

`InventoryReservationService::acquire(baseQuantity: $line->baseQuantity())`
— the exact immutable COM-5A snapshot method, never a fresh read of
`Product`/`UnitConversion`. Verified directly for both base-unit lines and
an alternate-UOM line (`quantity=3` × `factor=24` → `base_quantity=72`).

## 14. UOM snapshot use

No new UOM logic. `unit_factor` is read from the already-resolved
`CommerceOrderLine` row exactly as PR-COM-5A wrote it at order creation.

## 15. Atomicity

`reserve()` wraps the order re-fetch, eligibility check, warehouse
resolution, and every line's `acquire()` call inside **one** enclosing
`DB::transaction()`. Each `acquire()` call opens its own internal
transaction, which Laravel/PostgreSQL/SQLite implement as a nested
**savepoint** under the enclosing transaction — so a later line's
`InsufficientAvailabilityException` rolls back only that savepoint, then
propagates and rolls back the entire outer transaction, undoing any
earlier lines' reservations from the same attempt. Verified directly:
`an_insufficient_later_line_rolls_back_all_newly_acquired_reservations`
asserts `InventoryReservation::count() === 0` after a 2-line order where
line 1 had sufficient stock and line 2 did not.

## 16. Concurrency

No pre-check-then-reserve pattern anywhere — `acquire()` is called
directly as the sole authorization+acquisition operation, exactly as
ADR-02 §6 requires. Real PostgreSQL concurrency proven with genuine OS
processes (`pcntl_fork()`, same technique as COM-1B's own proof): two
fully-confirmed `CommerceOrder`s (7 units each, On Hand = 10) both call
`CommerceOrderReservationService::reserve()` concurrently — exactly one
succeeds, the other receives `InsufficientAvailabilityException`, final
state is `Active Reserved = 7`, `ATS = 3`, `On Hand = 10` unchanged.

## 17. Idempotency

Deterministic key per line: `"commerce-order-reservation:{order->id}:{line->id}"`
— both ids are immutable once a line exists (COM-5A never edits lines
after creation), so retrying the same order always derives the same keys.
No new idempotency table/framework — this is pure key derivation feeding
directly into COM-1B's existing `(tenant_id, idempotency_key)` mechanism.

## 18. Retry behavior

- Same order retried after full success → every `acquire()` call hits its
  existing row, verifies the identical checksum, and returns the same
  `InventoryReservation` — `retrying_the_same_order_does_not_duplicate_reservations`
  asserts identical reservation IDs and `InventoryReservation::count() === 1`.
- Same order retried after the *resolved warehouse changed* between
  attempts (FulfillmentPolicy reconfigured) → the second `acquire()` call's
  checksum differs (different `warehouseId` input) →
  `InventoryReservationIdempotencyConflictException` — verified directly
  (`a_changed_warehouse_between_retries_conflicts_instead_of_silently_reserving_twice`).
- Same order retried after full failure (nothing committed, per §15) →
  behaves as a fresh first attempt.

## 19. Order state boundary

No new state added. `CommerceOrder` keeps exactly `draft`/`confirmed`
(from PR-COM-5A) — no `reserved`/`partially_reserved`/`allocated`. Whether
an order has been reserved is derived by querying
`CommerceOrderReservationService::reservationsFor($order)`, never stored
as an order column.

## 20. Reservation lifecycle boundary

This PR implements **acquisition only**. No automatic `consume()` on
fulfillment, no automatic `release()` on cancellation, no expiry
scheduler, no payment-timeout release — none of these are triggered from
`CommerceOrderReservationService`. `InventoryReservationService::release()`/
`consume()`/`expire()` remain fully available (and re-verified green in
regression, §37) for a future PR to call explicitly once their triggering
policy is decided.

## 21. On Hand / Reserved / ATS evidence

Directly asserted (`reservation_never_changes_on_hand_and_active_reserved_increases`,
`ats_decreases_correctly_after_reservation`, and the PostgreSQL
concurrency test): after reserving 7 of an On-Hand-10 product,
`ProductWarehouseStock.quantity` stays `10`, `activeReservedQuantity()`
becomes `7`, and `AvailableToSellService::forWarehouse()` reports
`onHand=10, activeReserved=7, availableToSell=3`.

## 22. StockMovement boundary

**Absolute — zero.** `StockMovement::query()->count() === 0` verified
after every reservation test in this PR.

## 23. Pricing snapshot boundary

**Absolute — zero.** `CommercePriceResolver` is never called, never
imported, never referenced by `CommerceOrderReservationService`.
`reservation_never_mutates_the_order_price_snapshot_or_total` asserts
`unit_price`/`total` are byte-identical before and after `reserve()`.

## 24. Tenant isolation

- The order itself is re-fetched under `CommerceOrder::query()` (auto
  `TenantScope`), never trusted from the passed-in object — a cross-tenant
  order id resolves to "not found," verified directly
  (`a_cross_tenant_order_is_rejected`).
- `acquire()`'s own `Product::query()->withoutGlobalScope(BranchScope::class)`
  check (COM-1B, unchanged) still applies `TenantScope`, so even a
  hand-crafted `CommerceOrderLine` referencing a foreign-tenant product
  (bypassing COM-5A's own creation-time check) is rejected —
  verified directly (`a_cross_tenant_product_reference_cannot_be_reserved`).
- `resolveWarehouseFor()`'s own `TenantScope`-scoped `SalesChannel`/
  `Warehouse` lookups (COM-2B, unchanged) mean a foreign-tenant warehouse
  can never be selected.
- Reservations and their `source_type`/`source_id` never leak across
  tenants — `InventoryReservation` is `BaseModel`-scoped, so both
  `a_reservation_cannot_be_replayed_across_tenants` and
  `source_identity_never_leaks_across_tenants` show zero visibility from a
  foreign tenant context.
- **No `withoutGlobalScope(TenantScope::class)` anywhere** in the new
  file — verified by direct code inspection.

## 25. Branch vs Warehouse

Re-asserted directly (`there_is_no_branch_to_warehouse_assumption`):
`CommerceOrder` carries no `branch_id` attribute at all; the warehouse
comes exclusively from `FulfillmentPolicyService`, never from any active
branch context.

## 26. Accounting boundary

**Absolute.** No `InvoiceService`, `PaymentService`, `LedgerService`,
`ZatcaService`, `CreditNote` call anywhere in
`CommerceOrderReservationService`.

## 27. Journal Entries Generated: NONE

Per CLAUDE.md's mandatory pre-PR disclosure: **zero journal entries are
generated by order reservation orchestration.** `JournalEntry::count() === 0`
is asserted directly after every reservation test
(`reservation_creates_no_accounting_or_zatca_artifact`).

## 28. Payment boundary

**Absolute.** No `Payment`/`PaymentIntent` reference anywhere.
`Payment::query()->count() === 0` verified.

## 29. ZATCA boundary

**Absolute.** No ZATCA field, no ZATCA service call. Since no `Invoice` is
ever created (`Invoice::count() === 0` verified), there is trivially no
ZATCA artifact — ZATCA fields exist exclusively on `Invoice`.

## 30. Fulfillment boundary

`FulfillmentPolicy` is consumed **read-only**, exactly as COM-2B built it,
solely to resolve a warehouse. No `Fulfillment`/`Shipment` aggregate is
created — none exists in the codebase yet to accidentally touch.

## 31. Schema/migration status

**No migration in this PR.** `InventoryReservation.source_type`/
`source_id` (added in PR-COM-1B) are sufficient to link a reservation back
to its owning `CommerceOrder` — confirmed directly against the AWJ-wide
header-reference convention (§12 above). No stop condition triggered.

## 32. Backward compatibility

Zero existing files modified. `InventoryReservationService`,
`FulfillmentPolicyService`, `AvailableToSellService`, `CommerceOrder`,
`CommerceOrderLine`, `CommerceOrderService` — none touched. Legacy
Invoice/POS/inventory-posting behavior is unaffected; Commerce reservation
remains fully additive and is never forced onto any existing flow.

## 33. Changed files

*As originally merged-reviewed at `ea8234d` — see §45 for the post-review
P1 hardening changes on top of this.*

**New (all additive):**
- `app/Services/Commerce/CommerceOrderReservationService.php`
- `tests/Feature/CommerceOrderReservationServiceTest.php` (26 tests)
- `tests/Feature/CommerceOrderReservationPostgresConcurrencyTest.php` (1 test)
- `docs/plans/store/PR-COM-5B-IMPLEMENTATION-REPORT.md` (this file)

**Modified:** none.

No changes to `setup.sh`/`.github/workflows/ci.yml`/`deploy/assemble.sh` —
`app/Services/Commerce` already registered since PR-COM-1A.

## 34. SQLite tests/results

*Pre-hardening numbers — see §45.7 for the post-fix full-suite results.*

- Targeted: `CommerceOrderReservationServiceTest` — **26/26 passed**
  (46 assertions), first run.
- `CommerceOrderReservationPostgresConcurrencyTest` — self-skips on SQLite
  by design (1 skipped, matches the identical pattern already established
  by `InventoryReservationPostgresConcurrencyTest`).
- Regression bundle (9 Commerce test classes together): **173/173 passed**
  (320 assertions).
- Guard suite (`BranchIsolationGuardTest|ProductReferenceRegistryTest|
  NumberingSettingsTest|CommerceModuleBoundaryTest`): **50/50 passed**
  (359 assertions) — unaffected, since no model/migration was added.
- Full suite: **3084 passed, 27 failed, 12 skipped** (20,025 assertions).

## 35. PostgreSQL tests/results

*Pre-hardening numbers — see §45.7 for the post-fix full-suite results.*

- Regression + guard bundle (14 test classes, including both COM-1B and
  COM-5B concurrency proofs): **224/224 passed** (689 assertions).
- Full suite: **3096 passed, 27 failed** (20,072 assertions).

## 36. Concurrency results

- `CommerceOrderReservationPostgresConcurrencyTest::competing_confirmed_orders_cannot_collectively_oversell`:
  **passed** — On Hand=10, two confirmed orders (7 each) reserved
  concurrently via real forked OS processes; exactly one succeeded, the
  other received `InsufficientAvailabilityException`; final state
  `Active Reserved=7 ≤ On Hand=10`, `ATS=3 ≥ 0`.
- `InventoryReservationPostgresConcurrencyTest` (COM-1B, re-run unchanged):
  **3/3 passed** — the underlying primitive's concurrency guarantee is
  provably intact after this PR's orchestration layer was added on top.

## 37. Regression results

Run in the order specified by the task, all green: new COM-5B tests →
COM-5A (`CommerceOrderServiceTest`) → COM-1B reservation tests
(`InventoryReservationServiceTest`) → COM-1A ATS
(`AvailableToSellServiceTest`) → COM-2B (`FulfillmentPolicyServiceTest`)
→ COM-2A (`SalesChannelTest`) → COM-4A (`CommercePriceResolverTest`) →
COM-3 (`CommerceListingServiceTest`) → boundary
(`CommerceModuleBoundaryTest`) → guards (`BranchIsolationGuardTest`,
`ProductReferenceRegistryTest`, `NumberingSettingsTest`) → COM-1B
PostgreSQL concurrency → full SQLite → full PostgreSQL. Zero regressions
in any.

## 38. Full-suite reconciliation

*Pre-hardening numbers — see §45.7 for the post-fix full-suite results,
which are the current truth for this PR's Head SHA.*

| Engine | Passed | Failed | Skipped |
|---|---|---|---|
| SQLite | 3084 | 27 | 12 |
| PostgreSQL | 3096 | 27 | 0 |

Both engines' 27 failing test names are byte-for-byte identical to each
other **and** to PR-COM-5A's own documented baseline (§42 of that report):
`Fuel*Test` (missing `bcmath` extension in this sandbox) and
`DocumentCenterSecureIntakeTest` (PDF-fixture gap). Skipped count rose by
1 on SQLite (12 vs. PR-COM-5A's 11) — exactly this PR's own
`CommerceOrderReservationPostgresConcurrencyTest`, which self-skips on
SQLite by design (same pattern as `InventoryReservationPostgresConcurrencyTest`).
Zero new failures, zero new failure categories, on either engine.

## 39. CI status

*Superseded — see §45.9 for the CI run at the post-hardening Head SHA.*
Original CI at `ea8234d`: Run #4362 — SUCCESS.

## 40. Risks

*Original pre-review risk assessment — see §45.10 for the post-hardening
reassessment.*

- None identified affecting merge safety. The new service is a pure
  consumer of two already-proven authorities; no existing file's behavior
  changed.
- The nested-transaction (savepoint) atomicity pattern (§15) is standard
  Laravel behavior across SQLite/PostgreSQL and was directly verified by a
  real rollback test on both engines, not merely assumed.

(In fact three P1-severity gaps were found by review and are now fixed —
see §45. The lesson: "pure composition of proven authorities" does not by
itself guarantee correctness of *how* those authorities are composed —
skip conditions, lock ordering, and read-path tenant guards all had to be
verified independently, not assumed from the authorities' own correctness.)

## 41. Open Questions

Per Master Plan §19/ADR-02 §5 — consciously **not decided** here, flagged
per the task's explicit stop-condition instructions rather than guessed:

1. **Reservation timing policy** (`ON_ORDER_CONFIRMATION` vs.
   `ON_PAYMENT_CONFIRMED`, and whether/when `reserve()` is invoked
   automatically): ADR-02 §5 explicitly states no universal default is
   approved yet. This PR builds the mechanism (confirmed-only eligibility)
   without deciding *when* it fires — that remains for the checkout/
   payment integration (COM-7A/Phase 8) to wire explicitly.
2. **Reservation lifecycle triggers** (consume-on-fulfillment,
   release-on-cancellation, expiry scheduling, payment-timeout release):
   none exist yet — `InventoryReservationService::release()`/`consume()`/
   `expire()` remain available but unused by any Commerce trigger until
   Fulfillment/Payment/Cancellation policies are each decided in their own
   future PRs.
3. **Short-lived checkout hold** (ADR-02 §5's "same reservation capability
   with an explicit purpose/type"): not built — no checkout exists yet
   (COM-7A).

## 42. Remaining work

- **Wiring the reservation trigger** into an actual checkout/confirmation
  flow (COM-7A) once the timing policy is chosen.
- **Lifecycle triggers** (§41.2) — each is its own future decision, not a
  gap in this PR's own scope.
- Everything else in the canonical lifecycle (Payment, Fulfillment,
  Invoice trigger) remains out of scope until its own designated PR.

## 43. Branch / PR / Base SHA / Head SHA

*Original PR-open state — see §45.11 for the post-hardening Head SHA.*

- **Branch:** `claude/pr-com-5b-order-reservation-orchestration`
- **Base SHA:** `b191c52a2c7856da4998cb5a6ffae148e824d8cb`
- **PR:** [#737](https://github.com/safwan5001-source/Nebrax/pull/737) —
  opened against `main`, not merged
- **Head SHA:** `d8d5e45` (commit before this report-link update)

## 44. Recommended next step

*Superseded — see §45.12.*

---

## 45. Post-Review P1 Hardening

PR #737 review (at Head `ea8234d83b4707a456c121a5e8653ebe742dca27`, CI
Run #4362 — SUCCESS) surfaced 3 P1-severity findings, all confirmed
correct against the actual code (none was a false positive) and fixed on
this same branch/PR without expanding scope.

### 45.1 P1-1 — Non-inventory lines

**Root cause.** `reserve()` called `InventoryReservationService::acquire()`
unconditionally for every `CommerceOrderLine`, with no check of the
referenced `Product.track_inventory`. A service/non-stock product
(`track_inventory === false`, confirmed as `Product`'s actual default)
normally has no `product_warehouse_stock` row, so `acquire()` computes
`available = 0` and throws `InsufficientAvailabilityException` — an
all-service order could never complete reservation, and a mixed order
would roll back its valid tracked-product reservations too (§15's own
atomicity guarantee, applied to the wrong case).

**Verified authoritative behavior.** `ADR-02 §9 — "Non-inventory items do
not reserve stock"` states plainly: *"Services and products that do not
track inventory do not require physical inventory reservation. The
implementation must use the authoritative Product/Inventory configuration
rather than infer this from channel presentation metadata."* Direct code
inspection confirmed `Product.track_inventory` defaults to `false` and is
the exact field every existing inventory-affecting service already gates
on — `InventoryService::recordSaleCogs()`'s per-line loop
(`if (! $product || ! $product->track_inventory || $line->quantity <= 0) { continue; }`)
is the literal AWJ-wide precedent for "skip, don't fake, don't zero."

**Fix (scoped entirely to `CommerceOrderReservationService::reserve()`).**
Before calling `acquire()` for a line, the line's `Product` is loaded
(`Product::query()->withoutGlobalScope(BranchScope::class)->find(...)`,
the same tenant-scoped/branch-bypass pattern already used throughout
Commerce) and, if it exists and `! track_inventory`, the line is skipped
with a plain `continue` — mirroring `InventoryService`'s own pattern
exactly. No fake reservation, no `quantity = 0` workaround, no change to
`CommerceOrderLine`, and **zero changes to
`InventoryReservationService::acquire()`** — COM-1B's contract is
untouched. An all-service confirmed order now returns an **empty**
`Collection` from `reserve()` and succeeds — this is documented explicitly
as the contract (not a special case): reservation eligibility is per-line,
not per-order.

**Tests** (`CommerceOrderReservationServiceTest`, all passing):
- `an_order_of_only_non_inventory_products_reserves_nothing_and_succeeds`
- `a_mixed_order_reserves_only_the_tracked_line`
- `a_non_tracked_line_never_affects_on_hand_ats_or_stock_movement`
  (covers On Hand, `activeReserved`/ATS, and `StockMovement::count()`
  together)
- `a_non_tracked_line_creates_no_accounting_or_zatca_effect`
- `retrying_a_mixed_order_remains_idempotent`

**Result:** fixed. All 5 required test scenarios pass; COM-1B's
`acquire()` contract is byte-for-byte unchanged (confirmed by re-running
`InventoryReservationServiceTest`/`InventoryReservationPostgresConcurrencyTest`
green, §45.6/§45.8).

### 45.2 P1-2 — Multi-product lock ordering

**Deadlock analysis.** `reserve()` wraps every line's `acquire()` call in
one outer `DB::transaction()` (§15's atomicity design). Each `acquire()`
call locks the `product_warehouse_stock(product_id, warehouse_id)` row via
`lockForUpdate()` inside its own nested transaction/savepoint — but a row
lock acquired inside a PostgreSQL savepoint is **not released** when that
savepoint releases; it is held until the *enclosing* transaction commits
or rolls back. So for `Order 1` with lines `[A, B]` and `Order 2` with
lines `[B, A]`, running concurrently:
`Tx1: lock(A) → wait lock(B)` while `Tx2: lock(B) → wait lock(A)` — a
textbook circular wait. PostgreSQL's deadlock detector would abort one
transaction with a `40P01` error (a `QueryException`, not
`InsufficientAvailabilityException`) even when both products have
sufficient stock for both orders. The single-product concurrency test
added in the original PR could not expose this — it never had two
distinct lock resources in play.

**Actual PostgreSQL locking behavior confirmed** by direct inspection of
`InventoryReservationService::acquire()` (unchanged): the
`lockForUpdate()` call and its surrounding `DB::transaction()` are exactly
as analyzed above — reproducible, not theoretical (reproduced directly by
the new test in §45.2's Tests below, which failed with a Postgres
deadlock error before the fix and passes after).

**Deterministic ordering chosen.** `$order->lines` is sorted by
`product_id` (`SORT_STRING`, i.e. plain string/UUID comparison — never
product *name*, per instruction) immediately after loading, **before**
the per-line loop that calls `acquire()`. Since ADR-03 fixes exactly one
warehouse per order in V1, `product_id` alone is identical to sorting by
the true lock-resource identity `(warehouse_id, product_id)` today; the
doc comment flags explicitly that a future multi-warehouse-per-order
capability would need to extend the sort key to the full tuple. No new
locking framework, no change to `InventoryReservationService::acquire()`
— it remains the sole reservation authority; this is purely an
ordering decision made before calling it.

**Concurrency test — PostgreSQL, real `pcntl_fork()` OS processes** (same
pattern as COM-1B's own proof, no new synchronization primitive):
- `competing_orders_with_reversed_line_order_do_not_deadlock_when_stock_is_sufficient`
  — On Hand A=10, B=10; Order 1 lines `[A:5, B:5]`, Order 2 lines
  `[B:5, A:5]`, run concurrently. **Both succeed**, no deadlock error;
  final `activeReserved(A)=10`, `activeReserved(B)=10`, `ATS(A)=ATS(B)=0`,
  On Hand unchanged for both.
- `competing_orders_with_reversed_line_order_and_insufficient_stock_reject_the_loser_completely`
  (the "competing quantities" scenario) — same reversed-order setup but
  On Hand A=10, B=10 with both orders wanting 7 of each (14 > 10 total
  demand per product). Exactly one order succeeds in full, the other is
  rejected with `InsufficientAvailabilityException` — never a deadlock,
  never a partial reservation for the loser (`activeReserved(A)=activeReserved(B)=7`
  exactly, matching only the winner's full order, not `14`, not a mix).
- Both tests run 4 times in a row during verification with zero flakiness
  (no `sleep`-only synchronization — the existing `runConcurrently()`
  barrier-file pattern, unchanged from COM-1B's own proof, is reused
  verbatim).

**Result:** fixed. No deadlock under sufficient stock; oversell/atomicity
guarantees unchanged under insufficient stock.

### 45.3 P1-3 — Tenant-safe reservation lookup

**TenantScope behavior verified** by direct inspection of
`App\Tenancy\TenantScope::apply()`: the global scope adds
`WHERE tenant_id = ?` **only if** `TenantContext::has()` is true; with no
active context, it adds **no predicate at all** — confirmed exactly as
the review described, not a false positive.

**Risk.** `reservationsFor()` neither checked for an active tenant context
nor re-verified the passed `CommerceOrder` under it (unlike `reserve()`,
which already did both). A caller reaching this method with no trusted
`TenantContext` (e.g. a hypothetically misconfigured queue/console
context) combined with any `CommerceOrder` object (stale, or belonging to
another tenant) would run a completely unscoped query against
`inventory_reservations`, returning that order's reservations regardless
of tenant ownership.

**Fail-closed fix.** `reservationsFor()` now performs exactly the two
checks `reserve()` already does: (1) `app(TenantContext::class)->id()`
must be non-null, else `RuntimeException`; (2)
`CommerceOrder::query()->find($order->id)` (tenant-scoped via `BaseModel`)
must resolve, else `RuntimeException` — a stale/cross-tenant object's id
simply won't be found under the current context. Only then is the
(already tenant-scoped) `InventoryReservation` query run. **No**
`withoutGlobalScope(TenantScope::class)`, **no** caller-supplied
`tenant_id`, **no** fallback tenant — verified both by the fix's own code
and by a dedicated regression test (below) that great-scans the file's
source for the literal bypass string.

**Tests** (`CommerceOrderReservationServiceTest`, all passing):
- `reservationsFor_fails_closed_without_an_active_tenant_context` (no
  context → `RuntimeException`)
- `reservationsFor_returns_only_the_current_tenants_own_reservations`
  (already existed as `reservationsFor_returns_the_reservations_linked_to_the_order`)
- `source_identity_never_leaks_across_tenants` (updated from its original
  "returns empty" assertion to `expectException(RuntimeException::class)`
  — the original test encoded the *vulnerable* behavior as expected;
  fixing the vulnerability necessarily changed this test's assertion, not
  just added new ones)
- `switching_tenant_context_cannot_reuse_a_stale_order_object_to_read_another_tenants_reservations`
  (holds a real tenant-A order object across a switch to a real,
  independently-reserved tenant-B context and back — proves no
  cross-contamination in either direction with two genuine tenants, not
  just a "no tenant" edge case)
- `no_tenant_scope_bypass_was_introduced_to_fix_reservationsFor` (static
  source-content assertion — locks in "no `withoutGlobalScope` was ever
  added" as a permanent regression guard)

**Result:** fixed, fail-closed on both missing-context and cross-tenant
paths, with no scope bypass introduced.

### 45.4 Preserved COM-5B decisions

Re-verified unchanged after the fix: confirmed-only eligibility; no
automatic reservation-timing policy; one fixed warehouse via
`FulfillmentPolicyService`; `InventoryReservationService::acquire()` still
the sole reservation authority (zero lines changed in that file); the same
deterministic per-line idempotency-key scheme; multi-line atomic rollback;
generic `source_type`/`source_id`; no migration; no new model; no API/UI;
no `StockMovement`; no On Hand/`avg_cost` mutation; no accounting/Payment/
Invoice/ZATCA/Fulfillment effect.

### 45.5 Changed files (this hardening commit)

**Modified only — no new files, no migration, no new model:**
- `app/Services/Commerce/CommerceOrderReservationService.php` (P1-1
  non-tracked-line skip, P1-2 deterministic sort, P1-3 fail-closed
  `reservationsFor()`)
- `tests/Feature/CommerceOrderReservationServiceTest.php` (+13 tests: 5 for
  P1-1, 4 new + 1 updated-in-place for P1-3)
- `tests/Feature/CommerceOrderReservationPostgresConcurrencyTest.php`
  (+2 tests for P1-2)
- `docs/plans/store/PR-COM-5B-IMPLEMENTATION-REPORT.md` (this section)

### 45.6 Targeted results — SQLite

`CommerceOrderReservationServiceTest`: **35/35 passed** (67 assertions) —
26 original + 9 net new (5 P1-1 + 4 P1-3; the pre-existing
`source_identity_never_leaks_across_tenants` was updated in place, not
counted as new). First run after the fix, no further adjustment needed.

### 45.7 Targeted results — PostgreSQL

Same 14-class regression + guard bundle as the original PR run:
**235/235 passed** (727 assertions) — 224 original + 11 net new (9
functional + 2 concurrency). `CommerceOrderReservationPostgresConcurrencyTest`
alone: **3/3 passed** (27 assertions), re-run 4 times consecutively with
zero flakiness.

### 45.8 Multi-product concurrency result

Both new deadlock/oversell scenarios (§45.2) passed on real PostgreSQL via
`pcntl_fork()`, reproducible across 4 consecutive runs. COM-1B's own
`InventoryReservationPostgresConcurrencyTest` re-run unchanged: **3/3
passed** — the underlying primitive's guarantee remains intact after both
the original orchestration layer and this hardening pass.

### 45.9 Full-suite reconciliation (post-hardening)

| Engine | Passed | Failed | Skipped | Δ vs. pre-hardening |
|---|---|---|---|---|
| SQLite | 3093 | 27 | 12 | +9 passed, same failed/skipped |
| PostgreSQL | 3107 | 27 | 0 | +11 passed, same failed |

Both engines' 27 failing test names remain byte-for-byte identical to the
pre-hardening run (§38) and to PR-COM-5A's own baseline — `Fuel*Test`
(missing `bcmath` extension) and `DocumentCenterSecureIntakeTest`
(PDF-fixture gap). The pass-count deltas exactly match this hardening's
own new/net-new test counts (§45.6/§45.7). Zero new failures, zero new
failure categories, on either engine.

### 45.10 Risk reassessment

- All three P1 findings were **real**, confirmed against actual code
  behavior (`TenantScope::apply()`'s conditional predicate;
  `acquire()`'s savepoint-scoped-but-transaction-held row lock; `Product`'s
  `track_inventory` default and AWJ's own `InventoryService` precedent for
  skipping non-tracked lines) — none was dismissed as a false positive.
- No new risk introduced: the fix is entirely internal to
  `CommerceOrderReservationService` (sort-before-loop, skip-before-acquire,
  fail-closed-before-query); `InventoryReservationService::acquire()` and
  `FulfillmentPolicyService::resolveWarehouseFor()` remain byte-for-byte
  unchanged, re-verified by full regression.
- The deterministic sort's correctness depends on `product_id` being a
  stable, comparable identity (UUID string) — true today and for the
  entire lifetime of a `CommerceOrderLine` (immutable per COM-5A).

### 45.11 Branch / PR / Base SHA / Head SHA (post-hardening)

- **Branch:** `claude/pr-com-5b-order-reservation-orchestration` (same —
  no new PR was created, per instructions)
- **Base SHA:** `b191c52a2c7856da4998cb5a6ffae148e824d8cb` (unchanged)
- **Old reviewed Head SHA:** `ea8234d83b4707a456c121a5e8653ebe742dca27`
  (CI Run #4362 — SUCCESS)
- **PR:** [#737](https://github.com/safwan5001-source/Nebrax/pull/737) —
  still open against `main`, not merged
- **New Head SHA:** `b5ab530334e19e9df309902fba3133b3f5325f4a` — CI green
  (both `php artisan test (L11, sqlite)` and `php artisan test (L11,
  pgsql)` jobs, `conclusion: success`, across both workflow triggers)

### 45.12 Recommended next step (post-hardening)

**All 3 P1 findings fixed, tested, regression-clean, and CI-green on this
same PR/branch.** Ready for re-review. Per instructions: no new PR
created, no merge, no deploy, no COM-6/COM-7 work started.
