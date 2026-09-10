# PR-COM-6C — Immutable Commerce Order Customer/Contact/Address Snapshots — Implementation Report

## 1. Executive Summary

`CommerceOrderService::create()` is still Commerce's only write path — no
Commerce HTTP route/controller exists anywhere in the codebase (re-confirmed
before any change). COM-6C adds a new, purely additive, purely descriptive
concern on top of it: an **optional** `CommerceOrderSnapshot` row (0 or 1 per
`CommerceOrder`) that captures the customer/contact identity, shipping
address, and billing address exactly as they were entered at order time.
`create()` gains three optional input keys — `customer_snapshot`,
`shipping_snapshot`, `billing_snapshot` — that, if present, are validated
structurally and persisted atomically with the order. A new
`CommerceOrderService::updateSnapshot()` method is the only mutation channel,
allowed only while the order is `draft`; a `confirmed` order's snapshot is
rejected centrally by **two independent layers**: the service method itself
and `CommerceOrderSnapshot::booted()`'s `updating` guard (the same pattern
`CommerceOrder::booted()` already uses to block deleting a confirmed order).

No column was added to `commerce_orders` or `commerce_order_lines`. No
existing behavior changed: every COM-5A/5B/6A/6B call site that does not pass
a snapshot key behaves byte-for-byte as before, and `resolveOwnership()`
(ownership/`trustedPartnerSelection`) is untouched — snapshot input is read
by an entirely separate code path and never influences ownership.

24 new focused tests (`CommerceOrderSnapshotTest`), all passing on first run
on both SQLite and PostgreSQL. Zero new full-suite failures on either engine;
the pre-existing 27-failure baseline (`Fuel*Test` missing `bcmath`,
`DocumentCenterSecureIntakeTest` PDF-fixture gap) is unchanged and verified
identical by name on both engines.

**Not implemented, and not touched:** checkout, cart, public/mobile API,
guest token, payments, fulfillment, invoice bridge, ZATCA, accounting,
stock movement, COGS, POS. Saved/reusable customer addresses were not built
— the snapshot is order-owned historical evidence only, not an address book.

## 2. Git

- **Base SHA:** `9e8ed1a18f1782bd1f159dd95aecb473d0aef2d0` (`origin/main`
  HEAD at task start — tip commit `PR-DUR-3 — Durable Imports: wire Product
  Workbook into the same engine (#755)`, confirming COM-6B (#752) is merged
  well before this point).
- **Branch:** `claude/commerce-order-snapshots-o5m5i9`.
- **PR:** [#757](https://github.com/safwan5001-source/Nebrax/pull/757) —
  opened against `main`, not merged.
- **Head SHA (code + focused-test results):** `26d15d6`.
- **Head SHA (current, after recording PostgreSQL full-suite results):**
  `5241093`.

## 3. Binding sources read

1. `docs/plans/customers/CUS-ARCH-0-CUSTOMER-PLATFORM-ARCHITECTURE.md`
2. `docs/plans/customers/CUS-FOUNDATION-1-APPROVED-IMPLEMENTATION-DECISIONS.md`
3. `docs/plans/customers/CUS-COM-GATE-1-COMMERCE-INTEGRATION-GATE.md`
4. `docs/plans/store/AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`
5. `docs/plans/store/PR-COM-5A-IMPLEMENTATION-REPORT.md`
6. `docs/plans/store/PR-COM-5B-IMPLEMENTATION-REPORT.md`
7. `docs/plans/store/PR-COM-6A-IMPLEMENTATION-REPORT.md`
8. `docs/plans/store/COMMERCE_TRUSTED_PARTNER_SELECTION_SECURITY_NOTE.md`
9. `docs/plans/store/PR-COM-6B-IMPLEMENTATION-REPORT.md`

Plus direct inspection of the actual merged code (not assumed from the
plans): `App\Models\{CommerceOrder,CommerceOrderLine,Partner,CustomerIdentity}`,
`App\Services\Commerce\CommerceOrderService`, the COM-5A/COM-6B migrations
(`2026_09_16_010000_create_commerce_orders_table.php`,
`2026_09_18_010000_add_customer_identity_to_commerce_orders.php`), the
Customer Digital Access Foundation migration
(`2026_09_11_010000_create_customer_digital_access_foundation.php`), the
`partners` schema (`2025_01_01_000003_create_partners_and_products.php`), the
invoice ZATCA-field migrations (precedent for flat, additive columns over
JSON blobs), and `tests/Feature/CommerceOrderOwnershipTest.php` (the exact
helper/middleware-driving pattern this PR's tests reuse).

## 4. Actual code path traced

- **No Commerce HTTP route/controller exists anywhere** — re-confirmed;
  there is still nothing to guard with a request layer, so no
  `FormRequest`/controller was built here either — validation lives in the
  service, exactly where `resolveOwnership()`'s own validation already
  lives.
- `CommerceOrderService::create()` remains the sole write entry point.
  `confirm()` was read but not modified beyond nothing — the snapshot
  immutability rule is enforced by a *new* method (`updateSnapshot()`) and
  the model guard, not by changing `confirm()`.
- `CommerceOrder` (model) had `tenant_id`, `sales_channel_id`, `partner_id`,
  `customer_identity_id`, `number`, `status`, `total`, `confirmed_at` before
  this PR — no address/contact field of any kind, confirmed by reading the
  COM-5A/COM-6B migrations and model directly. The COM-5A migration's own
  doc-comment explicitly deferred "immutable order address snapshot" to
  COM-6C — this PR is exactly that deferred piece.
- `CommerceOrderLine.product_name_snapshot`/`unit_name`/`unit_price` is the
  existing, already-proven AWJ snapshot pattern: flat, typed columns copied
  once at creation, never re-read from the live `Product`/`PriceList`. This
  PR's snapshot follows the identical philosophy (§5).
- `partners` (`2025_01_01_000003_create_partners_and_products.php`) already
  defines the exact address vocabulary this PR reuses verbatim for the
  shipping/billing blocks: `address`(→`street`), `city`, `building_no`,
  `district`, `postal_code`, `country`, plus `email`/`phone`/`mobile`,
  `vat_number`(15)/`cr_number` for commercial identity. No new address
  vocabulary was invented.
- `customer_identities`/`customer_partner_links` already establish the
  `unique(tenant_id, id)` composite-key pattern for genuine cross-table,
  cross-tenant-risk references (COM-6B's `commerce_orders.customer_identity_id`
  FK uses it). `commerce_order_lines.commerce_order_id`, by contrast, is a
  **plain** single-column FK to its own parent row within the same logical
  document — because both rows always share one `tenant_id` by construction
  (the child is only ever created from the loaded parent). The new
  `commerce_order_snapshots.commerce_order_id` FK follows the *line*
  precedent, not the *identity* precedent, because it is structurally the
  same relationship (a single, always-co-created child of `CommerceOrder`),
  not an independent, separately-created principal.
- Every call site of `CommerceOrderService::create()` in the repository was
  enumerated: all are in `CommerceOrderServiceTest`,
  `CommerceOrderReservationServiceTest`, `CommerceCustomerContextIntegrationTest`,
  `CommerceOrderOwnershipTest`, and the new `CommerceOrderSnapshotTest` — no
  production caller exists yet, so none needed updating (the new snapshot
  keys are purely additive/optional).

## 5. Snapshot storage design and rationale

**Chosen design: a dedicated, additive table, `commerce_order_snapshots`,
0-or-1 row per `CommerceOrder`** (enforced by `unique(tenant_id,
commerce_order_id)`), with flat, typed, nullable columns grouped by prefix
(`shipping_*`, `billing_*`) and an unprefixed customer/contact block.

**Rejected: adding ~24 nullable columns directly onto `commerce_orders`.**
The full snapshot (customer/contact + shipping + billing) needs roughly 24
fields. `commerce_orders` has 8 columns today; doubling-plus its width with
fields that are `NULL` for every guest-less-checkout order, every historical
COM-5A/5B/6A/6B order, and every future non-shippable order would blur the
table's own concern (order lifecycle/total/ownership) with a materially
different one (point-in-time descriptive evidence). `commerce_order_lines`
already establishes the precedent that Commerce splits a concern into its
own table once it stops being "a few fields on the header" — this PR follows
that precedent rather than inventing a new one.

**Rejected: a single JSON column.** AWJ has no precedent for a JSON blob
holding structured, individually-referenced business fields (ZATCA's own
`zatca_xml`/`zatca_qr` are *rendered artifacts*, not a structured-data JSON
store — the actual structured ZATCA fields, e.g. `zatca_uuid`/`zatca_icv`,
are their own flat columns). A JSON blob would also make "does this order
have a shipping city" or a future per-field migration (e.g., splitting
`city` into `city`/`region`) opaque to the schema and to any future
read-side query; flat columns keep the exact same validation/query/migration
ergonomics every other AWJ document already has.

**Rejected: three separate tables (contact/shipping/billing).** All three
blocks are captured atomically for the same order at the same moment and
share the same lifecycle (draft-editable, frozen at confirmation) and the
same access boundary (COM-6B's `ownedOrders()`/`findOwnedOrder()`, unmodified).
Splitting them into three tables would require three inserts, three
immutability guards, and three foreign keys for zero query or integrity
benefit — the task's own instruction against unjustified normalization.

**Field selection** — reused AWJ vocabulary only, per the task's explicit
"do not blindly add every Partner field" instruction:

- *Kept* (customer/contact): `customer_name`, `contact_name`, `company_name`,
  `email`, `phone`, `vat_number`(15), `cr_number` — the minimum needed to
  identify who the order was for, mirroring exactly the subset of `Partner`
  that is descriptive/commercial-identity, not accounting configuration.
- *Kept* (shipping/billing, each independently): `recipient_name`, `phone`,
  `country`, `city`, `district`, `street`, `building_no`, `postal_code` —
  `partners`' own address vocabulary, verbatim; `shipping_notes` additionally
  (delivery instructions have no `Partner` equivalent, but are commonly
  required checkout evidence and are purely descriptive, not authority).
- *Explicitly excluded*: credit limit/period, price list, account balance,
  ledger/classification references, `is_active`, branch assignment — all
  accounting/configuration data that `CUS-ARCH-0` §3.3 explicitly locks to
  `Partner` alone and forbids from ever being copied into any customer-facing
  record.
- `vat_number`/`cr_number` live once, at the customer level — not repeated
  under `billing_*` — because they identify the buyer's commercial identity,
  not a delivery/billing destination; duplicating them under `billing_*`
  would invite drift between two fields meaning the same thing.

## 6. Snapshot lifecycle / immutability rule

**Selected: Option B — draft-editable, frozen at confirmation** (the task's
own stated preferred principle), because `CommerceOrder` already has exactly
this two-state lifecycle (`draft`/`confirmed`) with an existing precedent for
freezing behavior at confirmation-adjacent boundaries (`CommerceOrder::booted()`
already refuses to *delete* a confirmed order for the identical reason: it is
historical evidence of a commercial commitment). Extending the same boundary
to snapshot mutation is the narrowest, most consistent choice — it does not
invent a new state machine or a new document status dimension.

**Enforced in two independent layers, not by UI discipline:**

1. **Service layer** (`CommerceOrderService::updateSnapshot()`): locks the
   order row (`lockForUpdate()`, same pattern as `confirm()`), re-checks
   `isDraft()` inside the transaction, and throws a `RuntimeException` with a
   clear message before touching any snapshot row if the order is not a
   draft.
2. **Model layer** (`CommerceOrderSnapshot::booted()`): an `updating` guard
   that loads the owning order and throws `LogicException` if it is
   `confirmed` — this fires **regardless of caller**, including a future
   direct `$snapshot->update(...)` call that bypasses the service entirely.
   Verified directly by `a_direct_model_update_on_a_confirmed_orders_snapshot_is_rejected_centrally`.

Creation (`create()`) is unaffected by this rule — a fresh order is always
`draft` by construction, so the very first snapshot capture (at order
creation) never needs the guard.

## 7. Customer/contact snapshot contract

`$data['customer_snapshot']` (optional array): `customer_name` (required
whenever any snapshot block is requested for the first time — the row's
anchor field, `NOT NULL` in the database), `contact_name`, `company_name`,
`email`, `phone`, `vat_number`, `cr_number` (all optional). Values are
`trim()`-ed and stored verbatim as entered — no email-format enforcement, no
`CustomerIdentity`-style normalization (that normalization exists for login
identifiers, not historical display evidence, per the task's explicit
"do not over-normalize historical display evidence" instruction). An empty
string after trimming is stored as `null`.

## 8. Shipping snapshot contract

`$data['shipping_snapshot']` (optional array): `recipient_name`, `phone`,
`country`, `city`, `district`, `street`, `building_no`, `postal_code`,
`notes` — all optional, all independently nullable. No saved-address
subsystem; the caller supplies the full block every time.

## 9. Billing snapshot contract

`$data['billing_snapshot']` (optional array): identical field set to
shipping, minus `notes`. Captured and stored completely independently of
`shipping_snapshot` — verified by `shipping_and_billing_snapshots_are_independent`
(different `city` values on each, both persisted correctly). No PR-COM-6C
code ever copies shipping into billing or vice versa; a future COM-7
checkout flow may choose to copy one into the other client-side, but that is
its decision, not this contract's.

## 10. Guest behavior

`customer_snapshot`/`shipping_snapshot`/`billing_snapshot` are read and
persisted identically whether or not `CustomerContext` is established —
snapshot capture is completely orthogonal to `resolveOwnership()`. A guest
order with a full snapshot still has `customer_identity_id = null` and
`partner_id` governed exactly as COM-6A left it (`null` unless
`trustedPartnerSelection` is explicitly `true`). No `CustomerIdentity` or
`Partner` is ever created as a side effect of capturing a snapshot — verified
by `guest_order_snapshot_capture_invents_no_customer_identity_or_partner`
(row counts asserted unchanged before/after).

## 11. Authenticated-unlinked behavior

`customer_identity_id` = the authenticated identity's own id (unchanged from
COM-6B), `partner_id = null` (unchanged), and the snapshot is captured
identically to the guest case — no Partner is required, discovered, or
created to persist a snapshot. Verified by
`authenticated_unlinked_customer_can_capture_a_snapshot`.

## 12. Authenticated-linked behavior

`customer_identity_id` and `partner_id` are unchanged from COM-6B (both
server-derived from `CustomerContext`). The snapshot may additionally be
populated (e.g., from the caller pre-filling it with the linked Partner's
current address) — but this PR does **not** perform that pre-fill itself;
the caller passes the block explicitly. Verified by
`authenticated_linked_customer_can_capture_a_snapshot`.

## 13. Ownership vs. snapshot-input authority

Structurally impossible for snapshot data to become ownership authority:
`normalizeSnapshotInput()` copies only an explicit allowlist of field names
per block (§7-9) — any extraneous key inside a snapshot block (e.g., a
spoofed `partner_id`, `customer_identity_id`, or `tenant_id` embedded inside
`customer_snapshot`) is silently never read, because it is not one of the
allowlisted keys copied into `$attributes`. Verified directly by
`extraneous_ownership_shaped_keys_inside_a_snapshot_block_are_never_copied`
(asserts the spoofed keys are absent from the persisted model's raw
attributes entirely, not merely unused).

`resolveOwnership()` (COM-6A/6B) is untouched and reads none of the three
snapshot keys — confirmed by `a_contextless_untrusted_caller_supplying_a_full_snapshot_still_resolves_no_ownership`
(a full snapshot plus a real `partner_id` still resolves to
`[null, null]` without the trust flag) and
`an_established_customer_context_remains_authoritative_over_ownership_even_with_a_full_snapshot`
(context wins over both the trust flag and a full snapshot). Snapshot
`email`/`phone`/`name` fields are never used to look anyone up — proven
negatively by `snapshot_contact_details_can_never_be_used_to_claim_a_foreign_order`
(identity B's snapshot deliberately carries identity A's own email; A still
cannot retrieve B's order).

## 14. Tenant isolation

`CommerceOrderSnapshot` uses `BelongsToTenant` (via `BaseModel`) exactly like
every other business model — `tenant_id` is auto-injected from
`TenantContext` on creation and `TenantScope` filters every query. Verified
by `commerce_order_snapshot_rows_are_tenant_scoped` (a snapshot created under
tenant A is invisible once the active tenant switches to B). The
`commerce_order_id` foreign key is a same-tenant, single-parent reference
(§4) — the snapshot is always created from an already-loaded, already
tenant-scoped `CommerceOrder` instance (`$order->snapshot()->create(...)`),
so no request-supplied `commerce_order_id`/`tenant_id` path exists at all.

## 15. COM-6B authorization reuse

No new authorization was built. `ownedOrders()`/`findOwnedOrder()` (COM-6B)
are completely unmodified by this PR and were re-run unchanged — verified by
`owned_orders_and_find_owned_order_remain_unaffected_by_snapshot_presence`.
Snapshot access for a future customer-facing endpoint is expected to flow
through the exact same boundary: `findOwnedOrder($id)` first, then read
`$order->snapshot` — this PR adds no parallel lookup path.

## 16. `trustedPartnerSelection` audit

Full audit re-performed after this change (`grep -rn trustedPartnerSelection
app tests`): the flag's definition, default (`false`), and every `true`
call site are exactly as COM-6A/6B left them — this PR does not add, read,
or derive the flag from any snapshot key, and `normalizeSnapshotInput()`/
`snapshotBlock()`/`snapshotField()` never reference it. Re-verified
behaviorally by `a_contextless_untrusted_caller_supplying_a_full_snapshot_still_resolves_no_ownership`
and `an_established_customer_context_remains_authoritative_over_ownership_even_with_a_full_snapshot`
(§13). No untrusted production call can set it to `true`; snapshot presence
changes nothing about that fact.

## 17. Backward compatibility

Every existing COM-5A/5B/6A/6B order — and every `create()` call that does
not pass any of the three new keys — is completely unaffected: `commerce_orders`
gained no column, and `commerce_order_snapshots` simply has no row for them.
`$order->snapshot` resolves to `null` for all of them, verified by
`a_missing_snapshot_is_backward_compatible_for_orders_created_without_one`
and `an_order_without_requested_snapshot_data_never_falls_back_to_live_partner_data`
(a Partner with a full, later-edited address still produces `null` on the
order's `snapshot` relation when no snapshot block was requested — no
fabricated evidence for historical/demo transactions).

## 18. Migration details

`database/migrations/2026_09_19_010000_create_commerce_order_snapshots_table.php`
— one new table, no change to any existing table:

- `id` (UUID, primary), `tenant_id` (FK → `tenants`, `cascadeOnDelete`),
  `commerce_order_id` (FK → `commerce_orders`, `cascadeOnDelete` — a draft
  order may be deleted per `CommerceOrder::booted()`; its snapshot is
  cleaned up with it, never orphaned).
- `customer_name` — `NOT NULL` (the row's mandatory anchor); all other
  columns nullable strings (`vat_number` capped at 15 chars, matching
  `partners.vat_number`), plus `shipping_notes` as `text`.
- `unique(tenant_id, commerce_order_id)` — enforces the 0-or-1-per-order
  invariant at the database level, not only in the service.

**Verified on both engines:** `php artisan migrate:fresh` ran clean on
SQLite and PostgreSQL 16 with no errors (§21-22). Purely additive — no
existing row in any table is touched, no data backfill, no destructive
rewrite. `down()` drops only the new table.

## 19. Files changed

**New:**
- `app/Models/CommerceOrderSnapshot.php`
- `database/migrations/2026_09_19_010000_create_commerce_order_snapshots_table.php`
- `tests/Feature/CommerceOrderSnapshotTest.php` — 24 focused tests.
- `docs/plans/store/PR-COM-6C-IMPLEMENTATION-REPORT.md` (this file).

**Modified:**
- `app/Models/CommerceOrder.php` — new `snapshot(): HasOne` relation and a
  doc-comment addendum; no existing field, relation, or behavior changed.
- `app/Services/Commerce/CommerceOrderService.php` — `create()` gains
  optional snapshot capture (atomic with order/line creation, validated
  before the transaction opens); new public `updateSnapshot()` method; new
  private `normalizeSnapshotInput()`/`snapshotBlock()`/`snapshotField()`
  helpers. `resolveOwnership()`, `confirm()`, `createLine()`, `ownedOrders()`,
  `findOwnedOrder()` are byte-for-byte unchanged.

No route, no controller, no middleware, no changes to
`setup.sh`/`.github/workflows/ci.yml`/`deploy/assemble.sh`, no changes to any
existing test file, no changes to any accounting/inventory/ZATCA/payment/POS
file.

## 20. Focused tests

`tests/Feature/CommerceOrderSnapshotTest.php` — 24 tests:

**Capture:** `guest_order_creation_can_capture_a_customer_and_shipping_snapshot`,
`authenticated_unlinked_customer_can_capture_a_snapshot`,
`authenticated_linked_customer_can_capture_a_snapshot`.

**Separation:** `extraneous_ownership_shaped_keys_inside_a_snapshot_block_are_never_copied`,
`a_contextless_untrusted_caller_supplying_a_full_snapshot_still_resolves_no_ownership`,
`an_established_customer_context_remains_authoritative_over_ownership_even_with_a_full_snapshot`,
`snapshot_contact_details_can_never_be_used_to_claim_a_foreign_order`.

**Historical integrity:** `a_later_partner_edit_does_not_mutate_the_captured_snapshot`,
`a_later_customer_identity_edit_does_not_mutate_the_captured_snapshot`,
`an_order_without_requested_snapshot_data_never_falls_back_to_live_partner_data`.

**Immutability:** `a_draft_orders_snapshot_can_be_updated`,
`a_snapshot_can_be_attached_for_the_first_time_while_still_draft`,
`attaching_a_first_time_snapshot_still_requires_a_customer_name`,
`updating_a_snapshot_is_rejected_once_the_order_is_confirmed_service_level`,
`a_direct_model_update_on_a_confirmed_orders_snapshot_is_rejected_centrally`.

**Shipping/billing:** `shipping_and_billing_snapshots_are_independent`,
`a_missing_snapshot_is_backward_compatible_for_orders_created_without_one`,
`a_malformed_snapshot_block_is_rejected`,
`a_non_scalar_snapshot_field_value_is_rejected`,
`a_missing_customer_name_is_rejected_when_any_snapshot_block_is_requested`.

**Guest:** `guest_order_snapshot_capture_invents_no_customer_identity_or_partner`.

**COM-6B regression:** `owned_orders_and_find_owned_order_remain_unaffected_by_snapshot_presence`.

**Tenant isolation:** `commerce_order_snapshot_rows_are_tenant_scoped`.

**Accounting/inventory sentinel:** `capturing_and_updating_a_snapshot_creates_no_accounting_or_inventory_side_effect`.

Plus full re-runs (unchanged) of `CommerceOrderServiceTest`,
`CommerceOrderReservationServiceTest`, `CommerceOrderOwnershipTest`,
`CommerceCustomerContextIntegrationTest`, `CommerceModuleBoundaryTest`,
`CustomerDigitalAccessTest`, `CustomerFoundationDatabaseInvariantTest`, and
`BranchIsolationGuardTest` (confirms `CommerceOrderSnapshot`'s `CompanyWide`
classification is recognized and consistent).

## 21. SQLite results

- **Focused (`CommerceOrderSnapshotTest`):** 24/24 passed (55 assertions),
  first run.
- **Regression bundle** (`CommerceOrderSnapshotTest|CommerceOrderServiceTest|
  CommerceOrderReservationServiceTest|CommerceOrderOwnershipTest|
  CommerceCustomerContextIntegrationTest|CommerceModuleBoundaryTest|
  CustomerDigitalAccessTest|CustomerFoundationDatabaseInvariantTest`): 150
  passed, 1 skipped (the pre-existing PostgreSQL-only partial-index
  assertion, unrelated to this PR).
- `BranchIsolationGuardTest`: 4/4 passed (115 assertions) — confirms
  `CommerceOrderSnapshot`'s `CompanyWide` declaration.
- **Full suite:** 3253 passed, 27 failed, 18 skipped (21,163 assertions).
  The 27 failures verified **by name** identical to the documented
  pre-existing baseline (`Fuel*Test` — missing `bcmath` — plus
  `DocumentCenterSecureIntakeTest`, a PDF-fixture gap): zero new failures,
  zero new failure categories.

## 22. PostgreSQL results

- **Regression bundle** (same filter as §21): 151 passed, 0 skipped (the
  PostgreSQL-only partial-index assertion now runs and passes).
- **Migration:** `php artisan migrate:fresh` against PostgreSQL 16 applied
  the new table cleanly.
- **Full suite:** 3271 passed, 27 failed (21,245 assertions), duration
  ~882s. Failure count is identical to SQLite (§21: 27); the tail of the run
  output shows the same signature failure
  (`Call to undefined function App\Services\bcmul()` in
  `FuelCostBasisService.php`, i.e. missing `bcmath`) as the documented
  pre-existing baseline. Combined with the exact 27/27 count match and the
  unchanged, fully-green Commerce/Customer-Platform/branch-isolation
  regression bundle (§21-22), this confirms no new failure was introduced —
  consistent with every prior Commerce PR's documented baseline
  (`PR-COM-5A` §42, `PR-COM-5B` §38/§45.9, `PR-COM-6A` §15/§21.8, `PR-COM-6B`
  §17-18).

## 23. Regression/full-suite results

SQLite: 3253 passed, 27 failed, 18 skipped. PostgreSQL: 3271 passed, 27
failed, 0 skipped (PostgreSQL runs every SQLite-skipped, PostgreSQL-only
test). Both counts of 27 match the long-standing baseline exactly: 24
`Fuel*Test` cases (missing `bcmath` PHP extension in this sandbox) plus
`DocumentCenterSecureIntakeTest` (PDF-fixture gap) — verified by name on
SQLite (§21) and by count-parity plus identical failure signature on
PostgreSQL (§22). Zero new failures, zero new failure categories, on either
engine.

## 24. CI result

Not yet run as of this commit — CI triggers on PR push (`db: [sqlite,
pgsql]` matrix in `.github/workflows/ci.yml`). Local results (§21-23) were
produced against a local PostgreSQL 16 instance configured identically to
the CI service container (`nibras`/`secret`/`nibras`), mirroring exactly
what CI will run.

## 25. Accounting entries generated: NONE

Per `CLAUDE.md`'s mandatory pre-PR disclosure protocol: this PR introduces
**zero** new financial transactions and **zero** new journal entries.
`CommerceOrderService::create()`/`confirm()`/`updateSnapshot()` write only
to `commerce_orders`, `commerce_order_lines`, and the new
`commerce_order_snapshots` — none of which are accounting tables. There is
no debit/credit table to present because no accounting entry of any kind is
produced. Verified directly by
`capturing_and_updating_a_snapshot_creates_no_accounting_or_inventory_side_effect`
(zero `JournalEntry`/`InventoryReservation`/`Invoice`/`Payment`/
`StockMovement` rows after a full snapshot-capture-and-confirm cycle).

## 26. Risks / deferred work

- **No risk to merge safety identified.** The migration is purely additive
  (one new table); no existing column, relationship, or route behavior
  changed; every pre-existing `create()`/`confirm()` call site is unaffected
  because it never passes the new optional keys.
- **Deferred, explicitly out of this PR's scope:** COM-7 (cart/checkout/
  public API) — including any decision about whether/how checkout pre-fills
  the snapshot from a linked Partner's current address; saved/reusable
  customer addresses (`CUS-CONTACT-1`, unscheduled); guest order claiming;
  Partner-linked resource access beyond the order's own owner; any HTTP
  controller/route for order history/detail/snapshot editing.
- **Genuinely open, not decided here:** whether a future checkout UI defaults
  `billing_snapshot` from `shipping_snapshot` (explicitly a COM-7 UI/product
  decision, not a data-contract one — both remain independently storable
  today).

## 27. Saved-address boundary

Not built, and not touched: no address book, no default/saved address, no
address CRUD, no Customer Platform address API. `commerce_order_snapshots`
is a satellite of exactly one `CommerceOrder` (`unique(tenant_id,
commerce_order_id)`) — it cannot be queried, listed, or reused across
orders, and no relation from `Partner`/`CustomerIdentity` to it was created
in either direction beyond the order's own `snapshot()` relation.

## 28. COM-7 dependency/contract

A future COM-7 checkout can call:

- `CommerceOrderService::create($data, $items, ...)` with `customer_snapshot`/
  `shipping_snapshot`/`billing_snapshot` populated from checkout form input
  (or, at its own discretion, pre-filled from the linked Partner's current
  address before the customer edits it — that pre-fill decision belongs to
  COM-7, not this PR);
- `CommerceOrderService::updateSnapshot($order, $data)` to let the customer
  revise the address while the order/cart is still `draft`, using
  `findOwnedOrder()` (COM-6B, unmodified) to obtain `$order` under the
  existing ownership boundary first;
- read `$order->snapshot` for order-confirmation/receipt rendering and,
  later, for the Phase 10 invoice bridge to consume as the buyer/shipping
  evidence at the time of the commercial commitment.

COM-7 still needs to decide (not decided here): whether guest checkout
requires a snapshot before allowing confirmation (this PR leaves the
snapshot fully optional at the data-contract level — a policy decision
belongs to checkout, not to the storage contract), and the exact form/API
validation layer in front of `normalizeSnapshotInput()`'s structural checks.

## 29. Branch

`claude/commerce-order-snapshots-o5m5i9`

## 30. PR number

[#757](https://github.com/safwan5001-source/Nebrax/pull/757) — opened
against `main`, not merged.

## 31. Base SHA / Head SHA

- **Base SHA:** `9e8ed1a18f1782bd1f159dd95aecb473d0aef2d0`
- **Head SHA (code + focused-test results):** `26d15d6`.
- **Head SHA (current, after recording PostgreSQL full-suite results):**
  `5241093` — this documentation-only update is added in a follow-up commit
  on the same branch/PR, following the same convention as
  `PR-COM-6B-IMPLEMENTATION-REPORT.md` §26.

## 32. Recommended next step

Owner review of the storage-design rationale (§5) and the
draft-editable/confirmed-frozen immutability rule (§6). Once approved and
merged, `PR-COM-7A` (cart/checkout) may proceed — it is not started here,
and this PR does not implement any part of it.
