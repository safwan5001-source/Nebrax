# COM-MOBILE-ORDER-HISTORY-1 — Implementation Report

## Outcome

Authenticated customer order history on `/commerce/v1`: `GET /commerce/v1/me/orders` (paginated list, lightweight summary rows) and `GET /commerce/v1/me/orders/{id}` (full detail — contact, delivery, line items). Ownership is `CustomerContext::customerIdentityId()` alone, via the pre-existing `CommerceOrderService::ownedOrders()`/`findOwnedOrder()`. This is the last of the three tasks split from the former `COM-MOBILE-CUSTOMER-1` (`COM-MOBILE-CART-IDENTITY-1`, `COM-MOBILE-ADDRESSES-1`, this one) to reach `done`.

Also closes the pre-existing wiring gap both prior tasks' reports flagged: `CommerceOrderService::createFromCheckout()` hardcoded `customer_identity_id` to `null` unconditionally, regardless of whether the completing bearer was an authenticated customer — meaning `ownedOrders()` had no real data to expose until this was fixed.

## Repository evidence / root cause

`CommerceOrder`'s own docblock (PR-COM-6B) always documented `customer_identity_id` as sourced from `CustomerContext::customerIdentityId()` "when established, and `null` always for guest/staff" — but `createFromCheckout()`'s actual implementation never read `CustomerContext` at all; it wrote a literal `null`. `EstablishCommerceCustomerContextIfPresent` (COM-MOBILE-CART-IDENTITY-1) already establishes `CustomerContext` on checkout's write routes, including `checkout/complete`, for any request presenting a valid `X-Customer-Token` — so the data needed to close this gap was already available at the exact call site, just never read. This is a wiring gap discovered during evidence-gathering for both `COM-MOBILE-CART-IDENTITY-1` and `COM-MOBILE-ADDRESSES-1` (each recorded it in their own report's discovered backlog), not a new policy decision.

`ownedOrders()`/`findOwnedOrder()` (also PR-COM-6B) already existed, already filtered by this exact column, and were already unused by any endpoint — confirming this task's dependency really was "fix the wiring gap first," not a schema or design question.

## Approach chosen

1. **`CommerceOrderService::createFromCheckout()`** — reads `CustomerContext` directly (`app(CustomerContext::class)`) at the top of the method, exactly mirroring how the same method already sources `TenantContext`; `customer_identity_id` is `$customerContext->customerIdentityId()` when established, `null` otherwise. No change to the method's public signature — `$header` still carries only checkout-derived fields, `CustomerContext` is read independently since it's a request-scoped singleton already guaranteed established (or not) by upstream middleware before this service ever runs.
2. **`CommerceCustomerOrderController`** (new) — `index()` builds a lightweight summary array from `ownedOrders()`, paginated via the existing `PublicApiController::perPage()`/`applySort()` helpers (same pattern as `CommerceProductController::index()`); `show()` calls `findOwnedOrder()` and reuses `CommerceOrderSerializer::serialize()` for the full contract. Both reached only through the existing `X-Customer-Token` required-auth group (`AuthenticateCommerceCustomer` + `EstablishCustomerContext`, unmodified).
3. **Routes** — `GET commerce/v1/me/orders` and `GET commerce/v1/me/orders/{id}` (`whereUuid('id')`, closing the same UUID-shape class of bug `COM-MOBILE-ADDRESSES-1` fixed at the validation layer, here fixed at the routing layer instead — a malformed id 404s before reaching the controller on either database engine). Deliberately not `orders/{id}` — that path is already the guest signed-reference `CommerceOrderController::show()` route in a different, optional-auth middleware group; reusing it would mean branching one controller on which of two entirely different ownership proofs happened to be presented, instead of two controllers each honest about their own trust boundary.
4. **`CommerceOrderSerializer`** — extended `delivery` with `region`/`building_no`/`additional_number` (the `CommerceOrderSnapshot` columns already existed since `COM-MOBILE-ADDRESSES-1`, but no serializer exposed them — order-history detail is the first consumer that actually needs the customer's full delivery address back).
5. **Deduplication fix** — extending the serializer surfaced that `CommerceCheckoutController::complete()` had its own literal, already-drifted copy of the exact same shape (see Discovered backlog). Replaced it with a direct call to `CommerceOrderSerializer::serialize()`.

## Why this approach fits AWJ

- **One ownership source, already trusted**: no new authorization concept — `customer_identity_id` is the same column `CommerceCart`/`CommerceCustomerAddress` already use, filtered the same way `ownedOrders()` already did before this task ever touched it.
- **List/detail asymmetry matches the codebase's own precedent**: `CommerceProductController::index()`/`show()` already draw this same line (list = lightweight, detail = full read authority) — order history follows it rather than inventing a new shape.
- **Two trust boundaries, two controllers**: mirrors the existing split between `CommerceCustomerAddressController` (customer-owned) and the guest-facing controllers elsewhere in `/commerce/v1` — never branches one endpoint's authorization logic on which of two different proofs a caller happened to send.
- **Closing a drift, not adding one**: the `CommerceOrderSerializer`/`CommerceCheckoutController::serializeOrder()` duplication was pre-existing (the class's own docblock had claimed a refactor that never actually happened); this task's own regression suite caught it immediately, and the fix removes the second copy rather than patching it in parallel.

## Changed files

- `app/Services/Commerce/CommerceOrderService.php` — `createFromCheckout()` sources `customer_identity_id` from `CustomerContext`.
- `app/Http/Controllers/Api/CommerceCustomerOrderController.php` (new) — `index()`/`show()`.
- `app/Support/CommerceOrderSerializer.php` — `delivery` extended with `region`/`building_no`/`additional_number`.
- `app/Http/Controllers/Api/CommerceCheckoutController.php` — `serializeOrder()` (a literal duplicate) removed; its one call site now calls `CommerceOrderSerializer::serialize()` directly; unused `Tenant`/`CommerceOrder` imports removed.
- `routes/api_commerce.php` — `commerce/v1/me/orders` (GET) and `commerce/v1/me/orders/{id}` (GET) added to the existing required-auth group.
- `tests/Feature/CommerceCustomerOrderApiTest.php` (new, 10 tests).
- `tests/Feature/CommerceModuleBoundaryTest.php` — the two new routes added to `ALLOWED_COMMERCE_API_ROUTES`.

No migration — this task adds no column and no table; `CommerceOrderSnapshot.shipping_region`/`shipping_building_no`/`shipping_additional_number` all already existed from `COM-MOBILE-ADDRESSES-1`.

## Tests and exact results

### `tests/Feature/CommerceCustomerOrderApiTest.php` (10 tests / ~70 assertions)

List: happy path (summary shape, one order); newest-first default sort (two orders, `$this->travel(2)->seconds()` between completions to guarantee a real timestamp gap rather than relying on tie-break); per-customer isolation; a guest-completed order (`customer_identity_id` null) never appears in any customer's list; no `X-Customer-Token` → 401.

Detail: full contract (contact/delivery incl. `region`/`building_no`/`additional_number`/line items); a foreign customer's order → non-revealing 404; a syntactically-valid but nonexistent order id → the same 404; no `X-Customer-Token` → 401 (blocked at the route/middleware level before the controller runs, so this exercises the required-auth group, not the controller's own logic).

Both: no sensitive internal field (`tenant_id`/`sales_channel_id`/`customer_identity_id`/`partner_id`/`cost`/`ledger`/`api_client`) leaks into either response, mirroring `CommerceOrderStatusApiTest`'s own leak check.

### Regression

- Targeted set (`CommerceCustomerOrderApiTest|CommerceOrderStatusApiTest|CommerceCheckoutApiTest|CommerceModuleBoundaryTest|BranchIsolationGuardTest`, 54 tests): **passed on both SQLite and PostgreSQL.**
- Full `Commerce|Customer|Storefront` regression: **946 passed on SQLite, 971 passed on PostgreSQL, 0 failed** (both up 10 from `COM-MOBILE-ADDRESSES-1`'s last count, matching this task's one new test file).
- `BranchIsolationGuardTest`: green, unaffected — no new model introduced.
- `CommerceModuleBoundaryTest`: green — the two new routes added to the allowlist explicitly, no other boundary change.
- A full unfiltered `php artisan test` run in the local sandbox shows 27 unrelated failures, all in `Fuel*`/`FuelSupplyReceiving*` (missing `ext-bcmath` in this sandbox specifically, confirmed via `php -m`) and one `DocumentCenterSecureIntakeTest` (a PDF-fixture-validation issue) — both pre-existing environmental gaps in files this diff never touches. CI's properly-provisioned environment is the authoritative check for those modules.

## Self-review

### Implementer

Reused every available authority: `CustomerContext` (unmodified), `ownedOrders()`/`findOwnedOrder()` (unmodified — this task's entire job was making them finally have real data to return), `CommerceOrderSerializer` (extended, not replaced), `PublicApiController::perPage()`/`applySort()` (unmodified). The only genuinely new logic is the controller's two thin actions and the one-line `CustomerContext` read in `createFromCheckout()`.

### Reviewer

Verified the ownership boundary directly: a foreign customer's order id, a guest order's id, and a syntactically-valid-but-nonexistent id all produce the identical 404 shape from `show()` — no enumeration oracle. Verified `whereUuid('id')` on the new detail route closes the same PostgreSQL-vs-SQLite UUID-literal asymmetry `COM-MOBILE-ADDRESSES-1`'s round-1 review found in a different endpoint, this time at the routing layer. Verified the list/detail split doesn't leak line items or the delivery/contact snapshot into list rows (a deliberate, tested lightweight shape). Verified the `createFromCheckout()` change doesn't regress any existing test's assumption — grepped every `customer_identity_id` assertion in the existing suite before writing the fix; all were about `CommerceCart`, none asserted an order's value was `null`.

### AWJ Guardian

- **Double-entry / money**: none — no financial write path in this task; `CommerceOrder`/`CommerceOrderSnapshot` are non-accounting records per ADR-01 (`CommerceOrder != Invoice`), unaffected by this task's read-only additions plus one ownership-column fix.
- **Tenant isolation**: `ownedOrders()` already asserted `CustomerContext::tenantId() === TenantContext::id()` before this task; unchanged.
- **Immutability**: no write to any `CommerceOrder`/`CommerceOrderSnapshot` row — this task is entirely read plus one create-time field on a brand-new order (never a mutation of an existing confirmed order).
- **Configurable policy vs. hardcoded**: no business-policy fork in this task — ownership is the one existing, already-documented mechanism.

### Researcher/Architect

Confirms this closes the full three-way split from `COM-MOBILE-CUSTOMER-1` (`COM-MOBILE-CART-IDENTITY-1`, `COM-MOBILE-ADDRESSES-1`, `COM-MOBILE-ORDER-HISTORY-1`) — all three now `done`.

## Accounting impact

None. No journal entry, invoice, payment, or inventory movement is created, read, or affected by any code path in this task.

## Tenant / branch isolation impact

- No new model. `CommerceOrder`/`CommerceOrderSnapshot` remain `CompanyWide` (unchanged classification from earlier tasks).
- Every query is tenant-scoped by the existing `TenantScope` global scope plus `ownedOrders()`'s explicit `CustomerContext`/`TenantContext` match check (unmodified).

## Security / authorization impact

- `customer_identity_id` remains never client-suppliable — sourced exclusively from the server-verified `CustomerContext`, identical to every other consumer of this column.
- An order belonging to one customer cannot be listed or read by a different customer, even one in the same tenant (tested explicitly).
- A guest-completed order (no authenticated bearer at completion time) is permanently unreachable via this endpoint for any customer, including the one who later authenticates with the same phone/email a guest checkout happened to use — ownership is decided once, at order-creation time, never inferred retroactively.

## Backward compatibility

- `createFromCheckout()`'s signature is unchanged; every existing caller (guest completion) still gets `customer_identity_id = null`, exactly as before.
- The existing guest `GET /commerce/v1/orders/{id}` endpoint, its signed-reference mechanism, and its own tests are completely untouched.
- `CommerceOrderSerializer`'s new `delivery` fields are additive; every existing consumer of its output (the guest order-status endpoint, checkout completion) gains the same three fields, not a breaking shape change — no key removed or renamed.

## API / DB / migration impact

- No migration. New routes: `GET commerce/v1/me/orders`, `GET commerce/v1/me/orders/{id}` (required-auth group). `CommerceOrderSerializer`'s public shape gains three additive `delivery` keys (`region`/`building_no`/`additional_number`), consumed by both the guest order-status endpoint and checkout completion's own response.

## External research used

None — this task is a wiring-gap fix plus two thin read endpoints over already-designed, already-approved data (ADR-08's schema, PR-COM-6B's ownership column).

## Automated review findings

Not yet opened for review — will be recorded here once PR review completes, per the standing merge policy.

## Risks / remaining work

- None identified. This task's scope was fully bounded by the two prior tasks' own discovered backlog.

## Discovered backlog

- `CommerceCheckoutController::serializeOrder()`/`CommerceOrderSerializer` duplication (found and fixed within this same task, not deferred — see Approach §5).
- `StorefrontCheckoutController::serializeOrder()` (`/store/v1`) still keeps its own independent copy of the same shape, now three-ways forked in intent (guest mobile, customer mobile, web) though only two are actually unified. Out of scope for a `/commerce/v1`-only task — no test asserts parity between `/store/v1` and `/commerce/v1` shapes, and reconciling them would mean touching an already-shipped, independently-tested web contract with no immediate driver.

## Git state

Branch: `claude/com-mobile-order-history-1`, branched fresh off `main` post-`COM-MOBILE-ADDRESSES-1` merge (PR #929, Merge SHA `482c33053a07cad8bdcf79790e6125e31d4db895`). PR/commit/final-SHA details recorded once opened and merged.

## Recommended next dependency-ready task

None of the originally-scoped Commerce Mobile API readiness horizon's remaining rows (`COM-MOBILE-PAYMENTS-1`, `COM-MOBILE-SHIPPING-1`, `COM-MOBILE-PROMO-1`, `COM-MOBILE-I18N-1`, `COM-MOBILE-VERTICAL-TEST-1`) are currently `ready` — each is still gated on its own undecided product/vendor/scope question per `TASK-QUEUE.md`'s existing entries, not evidence Claude can close by reading more repository state. This task closes the last of the three `COM-MOBILE-CUSTOMER-1` split tasks; the next genuinely ready task (if any) would need a fresh promotion-checklist evaluation against current-`main` evidence, or a new owner decision resolving one of the above gates.
