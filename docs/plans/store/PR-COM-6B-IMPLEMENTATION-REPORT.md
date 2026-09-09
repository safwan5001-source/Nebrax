# PR-COM-6B — Commerce Customer Ownership & Authorization Integration — Implementation Report

## 1. Executive Summary

`CommerceOrderService::create()` is still Commerce's only write path — no
Commerce HTTP route/controller exists anywhere in the codebase, confirmed
by direct inspection before any change. COM-6B extends it with a
server-derived, persisted ownership fact: a new nullable
`commerce_orders.customer_identity_id` column, sourced exclusively from
`App\Tenancy\CustomerContext::customerIdentityId()` when established, and
`null` for every guest/staff/internal call — with **no**
`trustedPartnerSelection` channel for it (that flag, from COM-6A, remains
scoped to `partner_id` only). On the read side, `CommerceOrderService`
gains `ownedOrders()`/`findOwnedOrder()` — an ownership-scoped query
boundary mirroring the already-proven `NotificationController::
ownNotifications()` pattern, fail-closed without an established context
or on tenant mismatch, and non-enumerating (a foreign order id and a
nonexistent one both resolve to `null`).

One additive migration (nullable column + composite `(tenant_id, id)`
foreign key to `customer_identities`, reusing the exact tenant-integrity
pattern `customer_partner_links` already established) — no data
migration needed, all existing COM-5A/5B orders and guest orders remain
valid as-is. 16 new focused tests (`CommerceOrderOwnershipTest`), all
passing on first run on both SQLite and PostgreSQL. Zero new full-suite
failures on either engine; the pre-existing 27-failure baseline is
unchanged and verified identical by name on both.

COM-6C (immutable snapshots) and COM-7 (cart/checkout/public API) are
**not** implemented. No accounting/inventory/ZATCA/payment/POS behavior
was touched.

## 2. Git

- **Base SHA:** `26d58d8fb1ca6acee9d585f09dcd039565662a97` (`origin/main`
  HEAD at task start — the tip commit is `PR-COM-6A — Commerce ↔ Shared
  Customer Platform Context Integration`, the exact squash SHA the task
  named, confirmed still current via `git fetch origin main` before
  branching).
- **Branch:** `claude/pr-com-6b-commerce-ownership-authorization`.
- **Head SHA:** `25b069f` (pushed).
- **PR:** opened against `main`, not merged (see §26 for number/link).

## 3. Binding sources read

1. `docs/plans/customers/CUS-ARCH-0-CUSTOMER-PLATFORM-ARCHITECTURE.md`
2. `docs/plans/customers/CUS-FOUNDATION-1-APPROVED-IMPLEMENTATION-DECISIONS.md`
3. `docs/plans/customers/PR-CUS-FOUNDATION-1-IMPLEMENTATION-REPORT.md`
4. `docs/plans/customers/CUS-COM-GATE-1-COMMERCE-INTEGRATION-GATE.md`
5. `docs/plans/store/AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md` (Phase 6
   — PR-COM-6B's own definition text: *"authenticated ownership (a
   `CommerceOrder`/Commerce resource query is scoped by
   `customer_identity_id` derived from context, never by a
   request-supplied ID)"*)
6. `docs/plans/store/PR-COM-5A-IMPLEMENTATION-REPORT.md`
7. `docs/plans/store/PR-COM-5B-IMPLEMENTATION-REPORT.md`
8. `docs/plans/store/PR-COM-6A-IMPLEMENTATION-REPORT.md`
9. `docs/plans/store/COMMERCE_TRUSTED_PARTNER_SELECTION_SECURITY_NOTE.md`

Plus direct inspection of the actual merged code: `App\Models\
CommerceOrder`, `App\Services\Commerce\CommerceOrderService`,
`App\Tenancy\CustomerContext`, `App\Http\Middleware\
EstablishCustomerContext`, `App\Http\Controllers\Api\
NotificationController` (the cited IDOR precedent),
`database/migrations/2026_09_11_010000_create_customer_digital_access_foundation.php`
(the `(tenant_id, id)` composite-key pattern), `routes/api.php`, and the
existing test suites (`CommerceOrderServiceTest`,
`CommerceOrderReservationServiceTest`, `CommerceModuleBoundaryTest`,
`CommerceCustomerContextIntegrationTest`, `CustomerDigitalAccessTest`,
`CustomerFoundationDatabaseInvariantTest`).

## 4. Actual code path traced

- **No Commerce HTTP route/controller exists anywhere** — re-confirmed by
  `grep -in commerce routes/api.php` (zero results) and by there being no
  `app/Http/Controllers/Api/Commerce*Controller.php` file at all. There is
  therefore no route/middleware stack to guard, and none was invented.
- `CommerceOrderService::create()` remains the sole write entry point;
  `CommerceOrderReservationService::reserve()` (COM-5B) is the only other
  Commerce write path and takes no customer/ownership input at all —
  untouched by this PR.
- `CommerceOrder` (model) had `tenant_id`, `sales_channel_id`,
  `partner_id`, `number`, `status`, `total`, `confirmed_at` before this
  PR — no `customer_identity_id`, confirmed by reading the COM-5A
  migration and model directly.
- `App\Tenancy\CustomerContext::customerIdentityId()` already existed
  (COM-6A) and was already being read by `CommerceOrderService` for the
  `partner_id` decision — this PR is the first place `customerIdentityId()`
  itself is persisted anywhere in Commerce.
- `App\Http\Controllers\Api\NotificationController::ownNotifications()`
  (`Notification::query()->where('recipient_id', $request->user()->id)`)
  is the exact IDOR precedent `CUS-ARCH-0`/the Master Plan cite for
  COM-6B — read directly before designing `ownedOrders()`, which follows
  the identical shape (query pre-filtered by a server-derived id, never a
  model loaded globally then authorized after the fact).
- `customer_identities` already carries a `unique(tenant_id, id)`
  composite key (added in the COM-6A-preceding Customer Platform
  foundation migration specifically so other tables could reference it
  tenant-safely) — `customer_partner_links` already uses it via a
  composite `foreign(['tenant_id', 'customer_identity_id'])->references(
  ['tenant_id', 'id'])`. This PR's migration reuses that exact pattern for
  `commerce_orders.customer_identity_id`, rather than inventing a new
  integrity mechanism.
- Every call site of `CommerceOrderService::create()` in the entire
  repository was enumerated (`grep -rn "orders->create("
  app tests`): all are in `CommerceOrderServiceTest`,
  `CommerceOrderReservationServiceTest`, `CommerceCustomerContextIntegrationTest`,
  and the new `CommerceOrderOwnershipTest` — no production caller exists
  yet.

## 5. Integration point chosen, and why it is the narrowest safe one

**Chosen integration point:** the same `CommerceOrderService::create()` /
`resolveOwnership()` (renamed from COM-6A's `resolveOrderPartnerId()`) —
extended to also compute and persist `customer_identity_id` — plus two new
public methods on the same class, `ownedOrders()`/`findOwnedOrder()`.

**Why not a new controller/middleware:** none exists to protect yet
(§4). Building one now for a checkout/order-history API that is
explicitly `COM-7` scope would be exactly the speculative framework code
the task instructs against.

**Why a schema change was necessary, and why it is COM-6B's — not
COM-6C's:** the Master Plan's own `PR-COM-6B` section text requires "a
`CommerceOrder`/Commerce resource query... scoped by `customer_identity_id`
derived from context" — this is not satisfiable without persisting the
identity somewhere; there is no existing column to reuse (`partner_id` is
a different, optional, non-authoritative reference). `PR-COM-6C`'s own
scope is explicitly and only "immutable order snapshots... customer/
contact/shipping/billing data" (address/contact fields) — it is not
about the ownership foreign key itself. The literal Master Plan text does
carry one ambiguous leftover bullet (written before COM-6A/6B/6C were
split into concrete sequential PRs) listing the ownership reference under
COM-6C's "not implemented by this PR" section; this report flags that as
a **pre-existing planning-document inconsistency**, not a contradiction
discovered in merged code, and resolves it in COM-6B's favor because (a)
COM-6B's own paragraph is unambiguous and specific, (b) COM-6C's own scope
statement never mentions ownership at all — only contact/address/shipping/
billing snapshot data, and (c) this task's own instructions explicitly
authorize exactly this: *"If authenticated customer ownership cannot be
securely persisted/resolved with the existing schema, determine the
minimum safe schema change required by the approved Master Plan."* No
address/contact/shipping/billing field was added — that remains entirely
COM-6C's, untouched.

**Why `ownedOrders()`/`findOwnedOrder()` on the existing service, not a
new class:** `CommerceOrderService` already owns every `CommerceOrder`
read/write concern (`create()`, `confirm()`); adding the ownership-scoped
read boundary here matches the class's existing responsibility and needs
no new abstraction, consistent with COM-6A's own precedent of not
building a wrapper without a demonstrated need.

## 6. Ownership authority

**`App\Tenancy\CustomerContext::customerIdentityId()` is the sole and
only source of `commerce_orders.customer_identity_id`.** It is set once,
inside `resolveOwnership()`, only when `CustomerContext::isEstablished()`
is `true` — exactly the same condition COM-6A already uses for
`partner_id`. Unlike `partner_id`, `customer_identity_id` has **no**
`trustedPartnerSelection` channel at all: a trusted staff/internal call
can still select an existing `Partner` (COM-5A's original capability,
preserved), but it can never assign a `CommerceOrder` to a customer
identity that did not itself authenticate the request — verified by
`an_explicitly_trusted_staff_call_cannot_assign_customer_identity_ownership`.
`$data['customer_identity_id']` is never read under any condition,
established context or not — verified by
`a_spoofed_customer_identity_id_cannot_override_the_authenticated_owner`.

## 7. `CustomerIdentity` / `Partner` / `User` separation

Unchanged and re-verified: `Partner` remains a purely descriptive
commercial relationship on the order (server-derived from
`CustomerContext::linkedPartnerId()`, exactly as COM-6A built it) — it
never grants resource access by itself; a linked Partner is not, and does
not become, an access-control mechanism (`CUS-ARCH-0` §10.2 explicitly
defers Partner-linked resource access to a separate, not-yet-built
policy — this PR does not build it, matching that deferral). `User`
(ERP staff) can never produce an established `CustomerContext` —
`EstablishCustomerContext` continues to reject any non-`CustomerIdentity`
principal, re-verified by
`a_staff_user_principal_can_never_own_or_retrieve_a_commerce_order`,
which additionally proves the ownership-specific implication: a staff
principal's contextless order creation still yields
`customer_identity_id = null`, and `ownedOrders()` fails closed for a
staff-shaped (contextless) caller.

## 8. Authenticated + linked behavior

`customer_identity_id` = the authenticated identity's own id (the
authentication boundary); `partner_id` = `CustomerContext::
linkedPartnerId()` (the commercial relationship) — both server-derived,
independently. The order is owned by the identity, not by the Partner;
a resource lookup by `ownedOrders()` filters by `customer_identity_id`
only, never by `partner_id`. Verified by
`an_authenticated_linked_customer_owns_the_order_and_partner_is_still_
server_derived`.

## 9. Authenticated + unlinked behavior

A valid, ownable order: `customer_identity_id` = the identity's id,
`partner_id` = `null`. No Partner is required, discovered, or created to
establish ownership. Verified by
`an_authenticated_customer_owns_the_order_they_create` and the pre-existing
COM-6A unlinked-customer coverage (unaffected).

## 10. Guest behavior

`customer_identity_id` = `null` always, for both the default (untrusted)
path and the explicitly trusted staff/internal path — there is no
mechanism by which a guest order can acquire an owner after the fact
short of the explicitly deferred proof-backed claim design
(`CUS-ARCH-0` §8.3), which this PR does not build. Verified by
`a_guest_order_has_no_customer_identity_owner` and
`a_guest_order_is_not_retrievable_by_any_authenticated_customer` (a guest
order is never returned by any identity's `ownedOrders()`/
`findOwnedOrder()`, since SQL equality against a `NULL` column value never
matches a non-null parameter).

If a future guest-cart/checkout ownership mechanism is ever needed (an
opaque guest token, per the task's own note), it is explicitly a **COM-7
concern** — not designed, not stubbed, here.

## 11. IDOR strategy

`CommerceOrderService::ownedOrders(): Builder` returns a query **already
filtered by `customer_identity_id = CustomerContext::customerIdentityId()`
before any caller ever sees it** — the same shape as
`NotificationController::ownNotifications()`. `findOwnedOrder($id)` is
`ownedOrders()->find($id)`. A resource that exists but is not owned by the
caller, and a resource that does not exist at all, are **indistinguishable
outcomes** — both `null` — matching `CUS-ARCH-0` §10.2's non-enumerating
convention exactly (a future controller maps `null` to `404` either way;
this PR proves the service-layer half of that contract, since no
controller exists yet to add the HTTP mapping). Verified by
`identity_a_cannot_retrieve_identity_bs_order` and
`a_nonexistent_order_id_and_a_foreign_order_id_are_indistinguishable`
(both produce `null`, asserted side by side in the same test).

## 12. Tenant isolation strategy

Three independent layers, none newly invented beyond what COM-6A already
established for `partner_id`:

1. **`TenantScope`** (via `BaseModel`) — `CommerceOrder::query()` itself
   never crosses tenants regardless of any other filter; defense in
   depth, not the primary mechanism.
2. **Fail-closed context/tenant checks** — `ownedOrders()` throws
   `RuntimeException` if `CustomerContext` is not established, or if its
   `tenantId()` does not match the active `TenantContext` — the exact
   defense-in-depth pattern `resolveOwnership()` already uses for order
   creation, applied to the read side. Verified by
   `owned_orders_fails_closed_without_an_established_context` and
   `owned_orders_fails_closed_when_context_tenant_mismatches_the_active_
   tenant`.
3. **Composite database foreign key** — `commerce_orders.customer_identity_id`
   is constrained by `foreign(['tenant_id', 'customer_identity_id'])->
   references(['tenant_id', 'id'])->on('customer_identities')`, so even a
   direct `DB::table('commerce_orders')->insert(...)` bypassing the
   service entirely cannot attach a cross-tenant identity — verified on
   both engines by `the_composite_foreign_key_rejects_a_cross_tenant_
   customer_identity` (`QueryException` on both SQLite and PostgreSQL).

Additionally, `a_customer_only_ever_owns_orders_in_their_own_tenant`
proves the full realistic scenario end to end: two tenants, two
identities, two orders, and — critically — that attempting to use
identity A's principal while the *active* tenant context is B is rejected
by `EstablishCustomerContext` itself (an `HttpException`) before the
ownership query is ever reached, which is a **stronger** guarantee than
`findOwnedOrder` merely returning `null`.

Same-email-different-tenant non-merging ownership is unaffected and
already covered by `CustomerDigitalAccessTest::
test_same_normalized_email_is_allowed_across_tenants` (unchanged, re-run
green) — `customer_identity_id` values are UUIDs per tenant-scoped
`CustomerIdentity` row, so two identities sharing a normalized email
across tenants have entirely distinct ids and never share ownership by
construction.

## 13. `trustedPartnerSelection` — mandatory audit

Full-repository audit performed (`grep -rn trustedPartnerSelection app
tests`):

1. **HTTP/request input cannot set it.** Zero occurrences of `$request->`,
   `request(`, or any HTTP input accessor within `app/Services/Commerce/`
   or anywhere near the flag's definition or call sites. No route exists
   that could even attempt to (§4).
2. **Customer/public code cannot set it.** The only production
   definition is the parameter itself, `bool $trustedPartnerSelection =
   false`, in `CommerceOrderService::create()` — the default is the
   fail-safe value, matching `COMMERCE_TRUSTED_PARTNER_SELECTION_SECURITY_
   NOTE.md`'s locked rule verbatim.
3. **Established `CustomerContext` overrides it anyway.** `resolveOwnership()`
   checks `isEstablished()` first and returns immediately if true — the
   flag is never even read in that branch. Re-verified for the ownership
   dimension specifically by
   `an_explicitly_trusted_staff_call_cannot_assign_customer_identity_
   ownership` (the flag grants `partner_id` selection but never
   `customer_identity_id`).
4. **Contextless default remains `false`.** Unchanged from COM-6A's P1
   fix; not touched by this PR.
5. **Every `true` call site is demonstrably test-only.** All eight
   `trustedPartnerSelection: true` occurrences in the repository are
   literal boolean values inside `CommerceCustomerContextIntegrationTest`,
   `CommerceOrderServiceTest`, `CommerceOrderReservationServiceTest`, and
   the new `CommerceOrderOwnershipTest` — no variable, no request-derived
   value, anywhere.

**No untrusted production call can set it to `true`.** No security
blocker found; the mechanism from COM-6A is preserved unmodified, per the
task's own instruction not to redesign it absent a concrete flaw.

## 14. Schema / migration

`database/migrations/2026_09_18_010000_add_customer_identity_to_commerce_orders.php`
— purely additive to `commerce_orders`:

- `customer_identity_id` — `uuid`, **nullable**, positioned after
  `partner_id`.
- Composite foreign key `commerce_orders_customer_identity_fk`:
  `(tenant_id, customer_identity_id) → customer_identities(tenant_id, id)`,
  `restrictOnDelete()` — matches `partner_id`'s own `restrictOnDelete()`
  treatment on this table (a `CommerceOrder` is a historical commercial
  record; a hard delete of a referenced identity must not silently
  convert an authenticated order into a guest one).
- Index `commerce_orders_tenant_customer_identity_index` on
  `(tenant_id, customer_identity_id)` for the `ownedOrders()` query.

**Verified on both engines:** `php artisan migrate:fresh` ran clean on
SQLite and PostgreSQL 16 with no errors. No existing row is affected —
all pre-existing (test-created) `CommerceOrder` rows simply gain a `NULL`
value for the new column, identical to how `partner_id` already behaves
for guest orders. No accounting/inventory table was touched.

## 15. Files changed

**Modified:**
- `app/Models/CommerceOrder.php` — `customer_identity_id` added to
  `$fillable`; new `customerIdentity(): BelongsTo` relation (plain
  `belongsTo`, not `referenceBelongsTo`, since `CustomerIdentity` is
  `CompanyWide` and has no `BranchScope` to bypass).
- `app/Services/Commerce/CommerceOrderService.php` —
  `resolveOrderPartnerId()` renamed `resolveOwnership()`, now returns
  `[customerIdentityId, partnerId]`; `create()` persists
  `customer_identity_id`; two new public methods, `ownedOrders()` and
  `findOwnedOrder()`. `confirm()` and line creation are byte-for-byte
  unchanged.

**New:**
- `database/migrations/2026_09_18_010000_add_customer_identity_to_commerce_orders.php`
- `tests/Feature/CommerceOrderOwnershipTest.php` — 16 focused tests
  (§16).
- `docs/plans/store/PR-COM-6B-IMPLEMENTATION-REPORT.md` (this file).

No route, no controller, no middleware, no changes to
`setup.sh`/`.github/workflows/ci.yml`/`deploy/assemble.sh` (no new
top-level directory), no changes to any accounting/inventory/ZATCA/
payment/POS file, no changes to `CommerceOrderServiceTest.php` or
`CommerceOrderReservationServiceTest.php` (unlike COM-6A's P1 fix, this
PR did not need to touch either — the new column is additive and no
existing test asserts on it).

## 16. Focused tests

`tests/Feature/CommerceOrderOwnershipTest.php` — 16 tests:

**Authenticated ownership:**
1. `an_authenticated_customer_owns_the_order_they_create`
2. `an_authenticated_linked_customer_owns_the_order_and_partner_is_still_server_derived`
3. `a_guest_order_has_no_customer_identity_owner`
4. `an_explicitly_trusted_staff_call_cannot_assign_customer_identity_ownership`
5. `a_spoofed_customer_identity_id_cannot_override_the_authenticated_owner`

**IDOR:**
6. `an_authenticated_customer_can_retrieve_their_own_order`
7. `identity_a_cannot_retrieve_identity_bs_order`
8. `a_nonexistent_order_id_and_a_foreign_order_id_are_indistinguishable`
9. `a_guest_order_is_not_retrievable_by_any_authenticated_customer`
10. `owned_orders_fails_closed_without_an_established_context`

**Tenant isolation:**
11. `owned_orders_fails_closed_when_context_tenant_mismatches_the_active_tenant`
12. `a_customer_only_ever_owns_orders_in_their_own_tenant`
13. `the_composite_foreign_key_rejects_a_cross_tenant_customer_identity`

**Principal separation:**
14. `a_staff_user_principal_can_never_own_or_retrieve_a_commerce_order`

**Context lifecycle:**
15. `sequential_requests_do_not_leak_ownership_between_customers`

**COM-5A/5B/6A regression sentinel:**
16. `ownership_persistence_creates_no_accounting_or_inventory_side_effect`

## 17. SQLite results

- **Focused (`CommerceOrderOwnershipTest`):** 16/16 passed (37
  assertions), first run after one test fix (§18).
- **Regression bundle** (`CommerceOrderOwnershipTest|
  CommerceCustomerContextIntegrationTest|CommerceOrderServiceTest|
  CommerceOrderReservationServiceTest|CommerceModuleBoundaryTest|
  CustomerDigitalAccessTest|CustomerFoundationDatabaseInvariantTest`):
  122 passed, 1 skipped (the pre-existing PostgreSQL-only partial-index
  assertion, unrelated to this PR).
- **Full suite:** 3183 passed, 27 failed, 15 skipped (20,697 assertions).
  The 27 failures verified **by name** identical to the documented
  pre-existing baseline (`Fuel*Test` missing `bcmath`,
  `DocumentCenterSecureIntakeTest` PDF-fixture gap) — zero new failures.

## 18. PostgreSQL results

- **Focused (`CommerceOrderOwnershipTest`):** 16/16 passed (37
  assertions), first run.
- **Regression bundle:** 123 passed, 0 skipped.
- **Full suite:** 3198 passed, 27 failed (20,766 assertions). Same 27
  failures, verified identical by name to SQLite and to the pre-existing
  baseline — zero new failures.
- **Migration:** `php artisan migrate:fresh` against PostgreSQL 16
  applied the composite foreign key cleanly.

One test (`a_customer_only_ever_owns_orders_in_their_own_tenant`) failed
on its first run with an unexpected `HttpException` instead of the
`null` the test originally expected from `findOwnedOrder()`. Root cause:
the test's final step used identity A's principal while the active
`TenantContext` was tenant B — `EstablishCustomerContext` correctly
rejects this combination outright (identity A's own `tenant_id` does not
match the active tenant), so the ownership query is never reached at all.
The test's assertion was corrected to expect that rejection
(`HttpException`) rather than a `null` return from a query that never
runs — a **stronger** proof of tenant isolation than originally written,
not a weakening. No application behavior was changed to make this pass.

## 19. CI

Not yet run as of the report-writing commit — CI triggers on PR push
(`db: [sqlite, pgsql]` matrix in `.github/workflows/ci.yml`). Local
full-suite results (§17/§18) were produced against a local PostgreSQL 16
instance configured identically to the CI service container
(`nibras`/`secret`/`nibras`).

## 20. Accounting entries generated by this PR: NONE

Per `CLAUDE.md`'s mandatory pre-PR disclosure protocol: this PR
introduces **zero** new financial transactions and **zero** new journal
entries. `CommerceOrderService::create()`/`confirm()` remain exactly as
accounting-inert as PR-COM-5A/5B/6A built them (ADR-01 §2/§6,
`App\Support\CommerceBoundary`) — this PR only adds a persisted ownership
reference and a read-side ownership query; neither writes to
`journal_entries`, `stock_movements`, invoices, or payments. Verified
directly by `ownership_persistence_creates_no_accounting_or_inventory_
side_effect` (zero `JournalEntry`/`InventoryReservation`/`Invoice`/
`Payment`/`StockMovement` rows after a full authenticated create+confirm
cycle) and by the unchanged, re-passing `CommerceOrderServiceTest`/
`CommerceOrderReservationServiceTest` suites.

## 21. Risks / deferred work

- **No risk to merge safety identified.** The migration is purely
  additive; no existing column, model relationship, or route behavior
  changed; `resolveOwnership()`'s renamed-but-behavior-preserved
  `partner_id` logic is unchanged for every existing caller (re-verified
  by the unmodified `CommerceOrderServiceTest`/
  `CommerceOrderReservationServiceTest` passing as-is).
- **Deferred, explicitly out of this PR's scope:** guest order claiming
  (proof-backed, `CUS-ARCH-0` §8.3), Partner-linked resource access
  beyond the order's own owner (`CUS-ARCH-0` §10.2's deferred policy),
  any HTTP controller/route for order history/detail (COM-7).

## 22. COM-6C boundary

**Not implemented, and not touched:** no customer/contact/shipping/
billing snapshot field, no address book, no `Contact`/`Address` model.
`CommerceOrder`/`CommerceOrderLine` carry no new field beyond
`customer_identity_id` (an ownership/authorization fact, not a
historical snapshot). COM-6C remains free to define and persist its own
immutable snapshot fields on top of this PR's ownership column without
any conflict — the two are orthogonal (ownership = who may access;
snapshot = what the order said at confirmation time).

## 23. COM-7 dependencies (for future reference)

COM-7 (cart/checkout/public API) can now build its first Commerce
controller directly on top of:

- `CommerceOrderService::ownedOrders()`/`findOwnedOrder()` for
  order-history/order-detail endpoints (map `null` → `404`, matching the
  non-enumerating convention already proven here);
- the existing customer route group (`ResolveCustomerTenant` +
  `auth:sanctum` + `EnsureCustomerPrincipal` + `EstablishCustomerContext`)
  for the middleware stack — nothing new needs to be built there;
- `CommerceOrderService::create()`'s existing, unmodified guest/
  authenticated/linked/unlinked ownership derivation for the checkout
  write path itself.

COM-7 will still need to decide (not decided here): a guest-cart/session
identity mechanism if guest order retrieval/history is ever required, and
the checkout idempotency key design the Master Plan already assigns to
`PR-COM-7A` explicitly.

## 24. Blockers / deviations

One documented, resolved deviation: the Master Plan's own text contains
an internal inconsistency between `PR-COM-6B`'s definition (which
requires `customer_identity_id` to exist for ownership-scoped queries)
and a leftover bullet under `PR-COM-6C`'s "not implemented" list
(written before the 6A/6B/6C split was finalized) that also mentions the
same column. Resolved in favor of `PR-COM-6B`'s specific, unambiguous
text — see §5 for the full reasoning. No other contradiction was found
between the approved architecture and the actual merged code.

## 25. Explicit confirmations

- **COM-6C (immutable snapshots) was NOT implemented.** No address/
  contact/shipping/billing field or model was added (§22).
- **COM-7 (cart/checkout/public API) was NOT implemented.** No route,
  controller, cart, or checkout logic exists (§23).
- **No accounting/inventory/ZATCA/payment/POS semantics were changed**
  (§20).

## 26. Branch / PR / Recommended next step

- **Branch:** `claude/pr-com-6b-commerce-ownership-authorization`
- **Base SHA:** `26d58d8fb1ca6acee9d585f09dcd039565662a97`
- **Head SHA:** `25b069f` (code) — this report is added in a follow-up
  commit on the same branch/PR.
- **PR:** number/link recorded at open time (this section is updated by
  the opening commit's companion message).

**Recommended next step:** owner review of the ownership-authority
boundary (§6–§12) and the COM-6B/6C planning-text resolution (§5/§24).
Once approved and merged, `PR-COM-6C` (immutable snapshots) or `PR-COM-7A`
(cart/checkout) may proceed — neither is started here.
