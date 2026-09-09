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

**New (all additive):**
- `app/Services/Commerce/CommerceOrderReservationService.php`
- `tests/Feature/CommerceOrderReservationServiceTest.php` (26 tests)
- `tests/Feature/CommerceOrderReservationPostgresConcurrencyTest.php` (1 test)
- `docs/plans/store/PR-COM-5B-IMPLEMENTATION-REPORT.md` (this file)

**Modified:** none.

No changes to `setup.sh`/`.github/workflows/ci.yml`/`deploy/assemble.sh` —
`app/Services/Commerce` already registered since PR-COM-1A.

## 34. SQLite tests/results

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

Not yet run — CI triggers on PR push. Local full-suite results (§34/§35/§38)
mirror exactly what CI's `db: [sqlite, pgsql]` matrix runs.

## 40. Risks

- None identified affecting merge safety. The new service is a pure
  consumer of two already-proven authorities; no existing file's behavior
  changed.
- The nested-transaction (savepoint) atomicity pattern (§15) is standard
  Laravel behavior across SQLite/PostgreSQL and was directly verified by a
  real rollback test on both engines, not merely assumed.

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

- **Branch:** `claude/pr-com-5b-order-reservation-orchestration`
- **Base SHA:** `b191c52a2c7856da4998cb5a6ffae148e824d8cb`
- **PR:** [#737](https://github.com/safwan5001-source/Nebrax/pull/737) —
  opened against `main`, not merged
- **Head SHA:** `d8d5e45` (commit before this report-link update)

## 44. Recommended next step

**PR-COM-5B is clean.** Owner review, then — only once explicitly approved
and merged — the next PR in the roadmap (per Master Plan §16's critical
path, PR-COM-7A) can begin. Per instructions, no further PR was started in
this session.
