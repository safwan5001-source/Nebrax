# PR-COM-2B — Fixed Fulfillment Policy — Implementation Report

## 1. Executive Summary

Implements ADR-03's V1 `FIXED_LOCATION` fulfillment policy:
`SalesChannel → Fulfillment Policy → one explicit fixed Warehouse`.
`App\Models\FulfillmentPolicy` + `App\Services\Commerce\FulfillmentPolicyService`
provide `setFixedWarehouse()` (configure) and `resolveWarehouseFor()`
(resolve, read-only, always deterministic or explicitly failing — never a
silent fallback). No generic routing engine, no priority list, no
multi-warehouse eligibility set, no `PickupLocation`, no automatic split.
No API, no UI, no accounting/inventory/ZATCA effect. `SalesChannel` remains
independent of `Warehouse`; `Branch` is untouched.

## 2. Base SHA

`fef85790894f0bd83d518c985ad4bdc0eee00c2e` (`origin/main` at task start —
PR-COM-2A's merge commit, confirmed via `git fetch origin main` +
`git log --oneline -5 origin/main` before branching; matches the SHA given
in the task).

## 3. Binding references

Read (targeted): `AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md` (PR-COM-2B
section), `ADR-03-CHANNEL-WAREHOUSE-FULFILLMENT-SOURCE.md` in full (already
read completely for PR-COM-2A; re-consulted §2–§9 and §16 specifically for
this PR's exact scope), `PR-COM-1A`/`PR-COM-1B`/`PR-COM-2A` implementation
reports, `app/Support/CommerceBoundary.php`,
`app/Services/Commerce/AvailableToSellService.php`,
`app/Services/Commerce/InventoryReservationService.php`,
`app/Models/SalesChannel.php`. ADR-02 consulted only for warehouse/tenant
semantics already internalized from PR-COM-1B. No re-audit of the Existing
Architecture Audit or Evidence Passes — verified current-code reality
directly (§4), per the task's own instruction.

## 4. AWJ VERIFIED findings

- **`Warehouse`** (`app/Models/Warehouse.php`): `implements CompanyWide`
  (not `BranchScoped`) — so, like PR-COM-1B/2A already established, no
  `BranchScope` bypass is ever needed for a `Warehouse` existence check,
  only `TenantScope` (automatic via `BaseModel`). Has `is_active` (boolean,
  default `true`) but **no `SoftDeletes`** — confirmed by grepping the
  model for `use SoftDeletes` (absent) and by `WarehouseController::destroy()`,
  which performs a real hard `$warehouse->delete()` after two
  application-level checks (no non-zero stock row, not the default
  warehouse) — not a DB constraint, not a soft-delete flag.
- **`SalesChannel`** (`app/Models/SalesChannel.php`, PR-COM-2A):
  `implements CompanyWide`, `use SoftDeletes`, has `is_active` (boolean,
  default `true`). No `warehouse_id`/`branch_id` column exists on it —
  confirmed by reading its migration and `$fillable` directly (not assumed
  from memory).
- **`InventoryReservationService::acquire()`** (PR-COM-1B) is the direct,
  reusable precedent for "FK alone does not prove same-tenant ownership at
  a mutation boundary" — it explicitly checks
  `Product::query()->withoutGlobalScope(BranchScope::class)->whereKey($id)->exists()`
  and `Warehouse::whereKey($id)->exists()` under the caller's
  `TenantContext` *before* writing, rather than trusting the FK
  constraint's mere existence guarantee. `FulfillmentPolicyService` reuses
  this exact reasoning for `sales_channel_id`/`warehouse_id` (§11), simpler
  in one respect: since both `SalesChannel` and `Warehouse` are
  `CompanyWide` (not `BranchScoped` like `Product`), no `BranchScope`
  bypass is needed at all here — a plain `whereKey()->exists()` under
  `TenantScope` is sufficient for both.
- **Reflection-based "every model" guards** (the three known from
  PR-COM-1B/2A, checked proactively this time *before* writing any model
  code, not discovered afterward): `BranchIsolationGuardTest` (every
  `BaseModel` subclass must declare a branch-isolation stance — satisfied
  by `implements CompanyWide`), `NumberingSettingsTest` (only applies to
  models using `GeneratesDocumentNumbers` — `FulfillmentPolicy` does not
  use it, since it is configuration, not a numbered document), and
  `ProductReferenceClassificationGuardTest` (only applies to models with a
  `product_id` column — `FulfillmentPolicy` has none). All three re-ran
  green with zero changes required (§30) — confirmed proactively, not
  discovered as a surprise.
- **`product_warehouse_stock.warehouse_id`** FK behavior (re-confirmed from
  its migration): `cascadeOnDelete()`. This is the precedent followed for
  `FulfillmentPolicy`'s FKs (§16) — a *current configuration/tracking* row
  cascading away with its owning warehouse, distinct from
  `inventory_reservations`' deliberate `restrictOnDelete()` (an *audit
  trail* that must survive).
- **`unique(['tenant_id', <key>])` convention** re-confirmed (roles.slug,
  accounts.code, etc.) is *not* what this table needs for its core
  invariant — see §9: the channel↔policy cardinality constraint here is
  `unique('sales_channel_id')` alone (no `tenant_id` in the composite),
  because a `sales_channel_id` is already globally unique across the whole
  `sales_channels` table (UUID primary key) regardless of tenant, so a
  bare `unique('sales_channel_id')` is sufficient and correct — adding
  `tenant_id` to that composite would add nothing (two different tenants
  can never share the same channel UUID in the first place).

## 5. Fulfillment Policy domain definition

`FulfillmentPolicy` answers exactly one question: *for this sales channel,
which single warehouse is the fixed fulfillment source?* It does not
compute stock, does not decide availability, does not choose *between*
multiple warehouses (V1 has none to choose between — see §6), and does not
itself create or consume any reservation.

## 6. Fixed Warehouse V1 rationale

ADR-03 §4 classifies `FIXED_LOCATION` as "V1 implementation direction" and
explicitly defers `PRIORITY_LOCATIONS`/`ROUTING_ENGINE`. The master plan's
own PR-COM-2B entry states: "**V1 policy:** `FIXED_LOCATION` / fixed
eligible warehouse source." No `strategy` column, no eligible-warehouse
collection, no ordering, no automatic split (ADR-03 §8) was built — the
domain shape (a distinct `fulfillment_policies` table, not fields bolted
onto `SalesChannel`) already leaves room for a future strategy dimension to
be added additively when a second real strategy is actually approved and
built, without having invented a discriminator column that could only ever
hold one literal value today (see §9 for why that would itself be the kind
of premature schema the task told me to avoid).

## 7. SalesChannel / Branch / Warehouse separation

- `SalesChannel` gained **no** new column in this PR — `sales_channels`
  was not touched at all (verified: `git status --porcelain` shows zero
  changes to any file outside the 5 new ones, §29).
- `FulfillmentPolicy` has no `branch_id` — verified by a dedicated test
  (`a_policy_does_not_require_a_branch`) asserting `'branch_id'` is absent
  from `(new FulfillmentPolicy())->getFillable()`.
- `Warehouse` itself is not touched, and no `Branch → Warehouse` inference
  logic exists anywhere in `FulfillmentPolicyService` — the policy always
  names a `warehouse_id` explicitly, supplied by the caller, never derived
  from a branch.
- No `PickupLocation` model, column, or reference exists anywhere in this
  diff — verified by a dedicated test asserting
  `class_exists('App\\Models\\PickupLocation') === false` and that
  `'pickup_location_id'` is absent from `FulfillmentPolicy`'s fillable.

## 8. Data model / schema

`database/migrations/2026_09_14_010000_create_fulfillment_policies_table.php`
— one new table, `fulfillment_policies`, purely additive (no existing table
altered):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, PK | |
| `tenant_id` | uuid, FK `tenants`, cascade | auto-filled by `BelongsToTenant` |
| `sales_channel_id` | uuid, FK `sales_channels`, cascade | |
| `warehouse_id` | uuid, FK `warehouses`, cascade | |
| `created_at`, `updated_at` | timestamp | |

Constraint: `unique(sales_channel_id)` — see §9. `app/Models/FulfillmentPolicy.php`:
`extends BaseModel implements CompanyWide`, `$fillable = [tenant_id,
sales_channel_id, warehouse_id]`, `salesChannel()`/`warehouse()`
`belongsTo` relations, no other methods — no business logic lives on the
model, only on `FulfillmentPolicyService`.

## 9. Cardinality decision

**Zero or one active policy per channel** — `DERIVED`, since neither
ADR-03 nor the master plan states this cardinality explicitly (task §7
anticipated this and asked for a documented derivation when the source
doesn't settle it outright). Reasoning:

- ADR-03 §3's conceptual diagram (`Sales Channel → [Warehouse A, B, C]`)
  describes *eligibility*, a broader future concept than V1's fixed
  source; V1 itself (§4, §6) is singular by definition — one fixed
  warehouse, not a set.
- Before configuration, a channel legitimately has no policy at all (this
  is required, testable behavior — §14/§15 of the task, satisfied by the
  `no_policy_fails_explicitly` test) — so the cardinality cannot be
  "exactly one," it must allow "zero."
- The task explicitly warns against the ambiguity of "two active policies
  for the same channel" and asks for a DB constraint over an
  application-only check where possible. `unique(sales_channel_id)` on
  `fulfillment_policies` enforces **at most one policy row per channel**
  at the database level — not just "at most one *active* one" via some
  soft-state flag, but structurally at most one row, period. This is
  simpler than a partial/filtered unique index and is sufficient because
  V1 has no concept of policy history or multiple simultaneous
  configurations to distinguish by an "active" flag in the first place.
- `setFixedWarehouse()` therefore *replaces* an existing policy
  (`updateOrCreate` keyed on `sales_channel_id`) rather than adding a
  second row — verified by
  `a_policy_links_the_channel_to_exactly_one_warehouse`, which sets a
  policy twice with different warehouses and asserts `FulfillmentPolicy::count() === 1`
  and the second warehouse won.

## 10. Resolver contract

```php
FulfillmentPolicyService::resolveWarehouseFor(string $salesChannelId): Warehouse
```

1. Loads the channel *under the current tenant context* (`SalesChannel::query()->find($id)`,
   automatically `TenantScope`-filtered) — a foreign-tenant or nonexistent
   ID yields `null` → `RuntimeException` (not found).
2. Rejects a disabled channel (`is_active === false`) with
   `FulfillmentPolicyNotConfiguredException` — never proceeds to look for
   a policy for a channel that should not be starting new Commerce
   fulfillment (task §10).
3. Looks up the (at most one, §9) policy row for that channel; absent →
   `FulfillmentPolicyNotConfiguredException` ("no configuration" — no
   fallback of any kind).
4. Loads the policy's `Warehouse` (also tenant-scoped automatically — the
   policy itself was already validated tenant-owned at creation time, §11)
   and rejects it if missing or `is_active === false` — same "no fallback"
   rule.
5. Returns the `Warehouse` model instance directly — never a collection,
   never a list, never a first-of-many choice (ADR-03 §8's "no automatic
   split" is trivially satisfied because there is structurally nothing to
   split among).

No step ever substitutes `Warehouse::default()`, the first `Warehouse` row,
or a branch-derived warehouse — verified by
`the_resolver_never_falls_back_to_the_default_or_first_warehouse`, which
deliberately makes a *different*, non-policy warehouse the tenant's
`is_default` one and asserts the resolver still returns the policy's exact
warehouse, never the default.

## 11. Tenant ownership / isolation

`FulfillmentPolicy extends BaseModel`, so `TenantScope` filters every query
automatically and `tenant_id` is never accepted from a caller — **zero**
`withoutGlobalScope(TenantScope::class)`/`withoutGlobalScopes()` anywhere
in this diff (grep-verified, same standard as every prior Commerce PR).
Critically, per the task's own explicit warning (§6/§12/§24): **the FK
constraints alone do not prove same-tenant ownership** — a
`foreignUuid('sales_channel_id')->constrained('sales_channels')` only
guarantees the referenced row exists *somewhere* in that table, not that it
belongs to the tenant creating the policy. `setFixedWarehouse()` therefore
explicitly checks
`SalesChannel::query()->whereKey($salesChannelId)->exists()` and
`Warehouse::query()->whereKey($warehouseId)->exists()` — both automatically
`TenantScope`-filtered — *before* any write, exactly mirroring
`InventoryReservationService::acquire()`'s validation of `Product`/`Warehouse`
existence (§4). A cross-tenant channel or warehouse ID therefore never
resolves to a row under the wrong tenant's context, and the whole
create-then-write path fails closed with a plain `RuntimeException` rather
than silently creating a cross-tenant policy.

Verified negative tests (§22): a foreign-tenant channel ID rejected by
`setFixedWarehouse()`; a foreign-tenant warehouse ID rejected the same way;
an existing policy invisible to a different tenant (`FulfillmentPolicy::count() === 0`
under Tenant B's context); `resolveWarehouseFor()` on a foreign-tenant
channel ID rejected; a genuinely same-tenant channel+warehouse pair
succeeds end to end.

## 12. Branch interaction

`Warehouse` may itself relate to a `Branch` in AWJ's existing model (a
`branch_id` column on `Warehouse`, unrelated to this PR — not touched).
`FulfillmentPolicy` never reads or writes that relationship, never selects
a `Branch` and infers a `Warehouse` from it, and carries no `branch_id`
column of its own. Existing `Branch`/`BranchScope` behavior for `Warehouse`
queries is untouched — `FulfillmentPolicyService` only ever calls
`Warehouse::query()->whereKey($id)` / `Warehouse::query()->find($id)`
(plain `TenantScope`, no `BranchScope` involvement at all, since
`Warehouse` is `CompanyWide` and was never `BranchScoped` to begin with —
§4).

## 13. Warehouse lifecycle handling

`Warehouse` has `is_active` (confirmed, §4) but no soft-delete concept.
The resolver therefore checks `is_active` (an inactive warehouse is not a
valid fulfillment source — `an_inactive_policy_warehouse_fails_explicitly`)
but has nothing to check for "soft-deleted," because that state does not
exist for `Warehouse` in this codebase. No new lifecycle concept was
invented for `Warehouse` — the resolver follows exactly the truth the model
already has, per the task's explicit instruction not to add one.

## 14. Disabled channel behavior

A disabled `SalesChannel` (`is_active === false`) makes `resolveWarehouseFor()`
fail explicitly with `FulfillmentPolicyNotConfiguredException`, *even if* a
valid policy exists for it — verified by
`a_disabled_channel_fails_explicitly_even_with_a_configured_policy`, which
sets a policy, then disables the channel, then asserts resolution fails.
The policy row itself is **not** deleted or altered when the channel is
disabled — no contract requires that, and doing so would destroy
configuration a re-enabled channel should reasonably get back without
reconfiguration. This matches the task's explicit instruction (§10): "لا
تحذف policy تلقائيًا لمجرد تعطيل القناة إلا إذا contract قائم يفرض ذلك" (no
such contract exists).

## 15. No-configuration behavior

A channel with no policy row at all makes `resolveWarehouseFor()` fail
explicitly with `FulfillmentPolicyNotConfiguredException` — verified by
`no_policy_fails_explicitly`. No default warehouse is invented, no
`Warehouse::default()` call exists anywhere in `FulfillmentPolicyService`,
no "first warehouse for the tenant" query exists — confirmed by direct
code review (the resolver's only warehouse-related query is
`Warehouse::query()->find($policy->warehouse_id)`, which is `null` only
when the policy's own stored ID no longer resolves, not a search for
*any* warehouse).

## 16. DB constraints / indexes / FK delete semantics

- `unique(sales_channel_id)` — the cardinality invariant itself (§9);
  without it, two `FulfillmentPolicy` rows could both claim to be "the"
  policy for one channel with no DB-level way to prevent it.
- No secondary index was added (matching PR-COM-2A's own minimalism
  reasoning) — there being no API/service beyond the resolver's exact,
  already-unique-indexed lookup (`WHERE sales_channel_id = ?`, served
  directly by the unique index itself, no separate composite needed), a
  speculative additional index would have no query shape to justify it
  yet.
- **FK delete semantics: `cascadeOnDelete()` on both `sales_channel_id`
  and `warehouse_id`** — chosen deliberately differently from
  `inventory_reservations`' `restrictOnDelete()` (PR-COM-1B), and the
  reasoning is documented in the migration's own comment: `FulfillmentPolicy`
  is **current configuration**, not an audit/historical record the way a
  reservation or a stock movement is — nothing in ADR-03 or the master
  plan asks for fulfillment-policy history, and a policy pointing at a
  channel or warehouse that no longer exists is simply meaningless, not
  something worth preserving as a dangling reference. This mirrors
  `product_warehouse_stock.warehouse_id`'s own `cascadeOnDelete()` — a
  *tracking/configuration* table, not an audit trail.
- No change was made to `WarehouseController::destroy()` or any existing
  `Warehouse`/`SalesChannel` deletion logic — the cascade is handled
  entirely at the DB level, so a warehouse's existing deletion
  preconditions (no non-zero stock, not the default) are unaffected;
  deleting a warehouse that also happens to be some channel's fixed
  fulfillment source now additionally, silently removes that now-
  meaningless policy row, which is the desired outcome, not a behavior
  regression on `Warehouse` itself.

## 17. Reservation interoperability

`InventoryReservationService::acquire()` (PR-COM-1B) was **not modified in
any way** — it still takes `(productId, warehouseId, baseQuantity, idempotencyKey, ...)`
exactly as before, with no `SalesChannel` parameter added, per the task's
explicit instruction (§14). `FulfillmentPolicyService::resolveWarehouseFor()`
simply returns a `Warehouse` a future caller can pass into `acquire()`
unchanged. Demonstrated (not orchestrated as a new production flow) by one
domain-composition test,
`the_resolved_warehouse_composes_directly_with_reservation_and_ats`: it
resolves a channel's warehouse, then calls the *unmodified*
`InventoryReservationService::acquire()` with that warehouse's ID directly,
and confirms the resulting reservation is active and `AvailableToSellService`
reflects the reduced `availableToSell` — proving the two systems compose
correctly through plain method calls, without any new Checkout/CommerceOrder
orchestration layer.

## 18. ATS impact

**NONE.** `ATS = max(0, On Hand - Active Reserved)` is unchanged;
`AvailableToSellService`'s source code was not touched in this diff (only
read, in the interoperability test). Verified directly:
`resolving_never_changes_available_to_sell` calls
`AvailableToSellService::forWarehouse()` before and after a
`resolveWarehouseFor()` call and asserts `onHand` and `availableToSell` are
bit-for-bit identical.

## 19. Inventory mutation impact

**NONE.** `FulfillmentPolicyService` never calls `InventoryService` or
`InventoryReservationService`'s mutating methods, never creates a
`StockMovement`, and never writes to `product_warehouse_stock.quantity` or
`products.quantity_on_hand`/`avg_cost`. Verified by three dedicated tests:
`resolving_never_changes_on_hand` (raw `product_warehouse_stock.quantity`
unchanged), `resolving_creates_no_inventory_reservation`
(`InventoryReservation::count() === 0`), `resolving_creates_no_stock_movement`
(`StockMovement::count() === 0`).

## 20. Accounting impact

**NONE.** No `LedgerService` call anywhere in this diff, no
`Account`/`JournalEntry`/`JournalLine` created. Verified:
`resolving_creates_no_journal_entry` → `JournalEntry::count() === 0`.

## 21. ZATCA impact

**NONE.** No ZATCA class, route, or table referenced anywhere.
`resolving_creates_no_invoice` and `resolving_creates_no_payment` confirm
zero `Invoice`/`Payment` rows exist after any `FulfillmentPolicyService`
operation — since ZATCA artifacts live entirely on `Invoice` in this
codebase (no separate ZATCA table), zero `Invoice` rows is the direct proof
there is no ZATCA surface to have been affected
(`resolving_has_no_zatca_effect` documents this reasoning explicitly in its
own assertion).

## 22. API / UI impact

**NONE.** No route, controller, request, resource, or UI file was added or
touched anywhere in this diff.

## 23. Backward compatibility

No existing `Invoice`, POS, `Quote`, `DeliveryNote`, `Purchase`, or
`Return` flow references `SalesChannel` or `FulfillmentPolicy` — none of
those files were touched in this diff (verified: `git status --porcelain`
shows exactly the 5 new files, §29). No synthetic policy was created for
any existing data. No legacy warehouse-selection logic (e.g., inside
`InventoryService::resolveWarehouseId()`) was touched.

## 24. Changed files

```
A  app/Models/FulfillmentPolicy.php
A  app/Services/Commerce/FulfillmentPolicyService.php
A  app/Services/Commerce/FulfillmentPolicyNotConfiguredException.php
A  database/migrations/2026_09_14_010000_create_fulfillment_policies_table.php
A  tests/Feature/FulfillmentPolicyServiceTest.php
```

No `setup.sh`/`ci.yml`/`deploy/assemble.sh` change — `app/Models/`,
`app/Services/Commerce/`, and `tests/Feature/` are all already
flat-copied by the existing assembly scripts (unchanged since PR-COM-1A
introduced `app/Services/Commerce/`). No existing file was modified in
this PR — a first for this Commerce sequence (PR-COM-1B and PR-COM-2A each
needed one small edit to an existing test; this PR needed none).

## 25. Tests — SQLite

`tests/Feature/FulfillmentPolicyServiceTest.php`, 25 tests covering every
required case (§22 of the task, all 30 numbered items mapped — 6 are
satisfied by re-running existing PR-COM-1A/1B/2A/COM-0 test files
unchanged rather than new assertions in this file, see §28). Full command:
`php artisan test --filter=FulfillmentPolicyServiceTest` → **PASS 25/25
(32 assertions)**.

## 26. Tests — PostgreSQL

Same file, same command, against a real local PostgreSQL 16 instance (same
setup as every prior Commerce PR — `pg_ctlcluster 16 main start`, database
`nibras`/`nibras`/`secret` matching `ci.yml`'s service block) →
**included in the combined regression run below, all passing.**

Combined guard + COM-1A/2A regression on PostgreSQL:
`--filter='FulfillmentPolicyServiceTest|SalesChannelTest|CommerceModuleBoundaryTest|BranchIsolationGuardTest|ApiTenantIsolationTest|AvailableToSellServiceTest|InventoryReservationServiceTest|NumberingSettingsTest'`
→ **PASS 104/104 (370 assertions).**

## 27. COM-1B concurrency regression

`InventoryReservationPostgresConcurrencyTest` re-run **3 consecutive
times** against this PR's full schema (with `fulfillment_policies`
present) → **PASS 3/3 (11 assertions) every time**, identical outcome to
PR-COM-1B's own report — confirms the new table/relationships have zero
effect on the atomic-acquisition locking behavior.

## 28. Full-suite results

Representative Invoice/Purchase/Return/StockPermit/Warehouse/POS/Ledger +
`ProductReferenceRegistryTest`/`ProductLifecycleTest` regression (extends
prior PRs' filter with the product-reference guard tests, since a new
`CompanyWide` model was added and those tests are cheap to include):
`--filter='InventoryTest|WarehouseTest|WarehouseAwareDocumentsTest|StockPermitTest|StockPermitUomValuationTest|PurchaseTest|ReturnTest|InvoiceInventoryApiTest|PosCheckoutTest|LedgerTest|ProductReferenceRegistryTest|ProductLifecycleTest'`
→ **PASS 158/158 (1076 assertions)** on PostgreSQL.

| Engine | Result |
|---|---|
| PostgreSQL 16 (real, local) | **2971 passed**, 25 failed, 0 skipped (19767 assertions), 690.91s |
| SQLite | **2960 passed**, 25 failed, 11 skipped (19730 assertions), 307.16s |

### Reconciliation against PR-COM-2A's own baseline (pgsql: 2946 passed;
sqlite: 2935 passed/11 skipped)

- **pgsql**: 2971 − 2946 = **25** = exactly `FulfillmentPolicyServiceTest`'s
  test count.
- **sqlite**: 2960 − 2935 = **25** = same. Skips unchanged at 11 (this PR
  introduces no new driver-conditional test).

### Failure triage — identical pre-existing baseline on both engines

The 25 failures are byte-for-byte identical, on both engines, to every
prior Commerce PR's already-triaged baseline: 24 `Fuel*Test` failures
(`bcmath` PHP extension absent in this sandbox) and 1
`DocumentCenterSecureIntakeTest` PDF-fixture validation gap. None touch
Commerce, Inventory, Invoice, Ledger, Payment, ZATCA, POS, or any
isolation/guard test.

## 29. CI status

Not pushed through GitHub Actions in this task (per instructions: do not
merge, do not deploy). All commands above were run locally against a real,
separately-installed PostgreSQL 16 instance configured with the exact same
credentials `ci.yml`'s `services.postgres` block uses, and against SQLite
via the same `setup.sh`-equivalent assembly this repo's own CI uses.

## 30. Guard findings / fixes

**None required.** Unlike PR-COM-1B (where `ProductReferenceClassificationGuardTest`
was missed until the full suite ran) and PR-COM-2A (where
`CommerceModuleBoundaryTest`'s `NOT_YET_MODELS` needed one line removed),
this PR checked all three known reflection-based "every model" guards
(`BranchIsolationGuardTest`, `NumberingSettingsTest`,
`ProductReferenceClassificationGuardTest`) *before* writing `FulfillmentPolicy`,
using the reasoning in §4 to determine none applied a new obligation. The
full-suite run confirmed this: **zero test files needed any change** in
this PR — `git status --porcelain` shows only the 5 new files (§24), no
modification to any existing test.

## 31. Risks / open questions

- **OPEN / REQUIRES VERIFICATION** — `PRIORITY_LOCATIONS`/`ROUTING_ENGINE`
  strategies (ADR-03 §4) are not represented at all in this schema (no
  `strategy` column, §6/§9). A future PR building either will need its own
  additive migration and a decision about whether `fulfillment_policies`
  gains a discriminator column or a parallel table is introduced instead —
  not decided here, deliberately, per the task's explicit "don't
  over-engineer" instruction.
- **OPEN / REQUIRES VERIFICATION** — no explicit test exists for creating a
  policy for an *inactive* channel (only for *resolving* one). The task's
  required list does not ask for this case, and no invariant in ADR-03
  forbids configuring a fulfillment policy for a channel that happens to
  be disabled at the moment of configuration (a reasonable real-world
  sequence: configure a channel's warehouse before flipping it live). Left
  unenforced deliberately rather than guessed at — `resolveWarehouseFor()`
  still correctly rejects using a disabled channel's policy regardless of
  when the policy was set.
- No STOP condition was triggered: no `TenantScope` bypass was needed
  (§11), `Warehouse`/`Branch` semantics were not touched (§12/§13),
  `Reservation`/ATS were not modified (§17/§18), no accounting mutation
  exists (§20), no generic routing/multi-warehouse/`PickupLocation`
  architecture was built (§6/§7), and the one genuine ambiguity in the
  binding references (channel↔policy cardinality) had a defensible,
  documented `DERIVED` answer (§9) rather than a blocking unknown.

## 32. Remaining work

Per the master plan, strictly next in the roadmap (not started, per
explicit instruction not to begin it in this task): `PR-COM-3` —
Commerce Listing foundation, and everything in the task's "Absolute Out of
Scope" list (`Price Resolver`, Promotion Engine, `CommerceOrder`, order
reservation orchestration, Customer Account, Cart, Checkout, Public/Mobile
API, `PaymentIntent`, payment provider, Fulfillment aggregate, Shipping,
Invoice bridge, Returns redesign, External Channels, B2B, Product
Variants, `PickupLocation`, multi-warehouse routing, automatic split, UI).
The two §31 open questions are conscious, documented deferrals, not
blockers.

## 33. Git

- **Branch:** `claude/pr-com-2b-fulfillment-policy`
- **PR:** opened against `main` — link recorded in a follow-up commit to
  this report
- **Base SHA:** `fef85790894f0bd83d518c985ad4bdc0eee00c2e`
- **Head SHA:** `ff30489c4563c924accad47defc7dd79e00f934f` (before adding
  this report)

## 34. Recommended next step

**PR-COM-2B is clean**: `FulfillmentPolicy` is a genuine, first-class
domain concept implementing exactly `FIXED_LOCATION` and nothing more;
`SalesChannel` remains fully independent of `Warehouse` (verified — no
new column on either); `Branch` was never touched; the resolver is
deterministic and always either returns exactly one warehouse or fails
explicitly, with no silent fallback of any kind, tested directly against a
deliberately-different default warehouse; cross-tenant channel/warehouse
attempts are rejected using only existing `BaseModel`/`TenantScope`
machinery, with zero new scope bypass; `Reservation` semantics and the ATS
equation are both untouched and tested untouched; no `StockMovement`,
accounting, ZATCA, or API/UI surface exists; no automatic split or
`PickupLocation` was built; backward compatibility is preserved (zero
existing files modified); SQLite and PostgreSQL are both green against the
exact same pre-existing failure baseline; PR-COM-1B's PostgreSQL
concurrency guarantee was re-verified unaffected across 3 runs. No guard
needed updating this time — all three known guards were checked
proactively and required nothing.

Recommended next step: **`PR-COM-3` — Commerce Listing foundation**, once
this PR is reviewed and merged by its owner (not by this session — per
instructions, this session does not merge or deploy).
