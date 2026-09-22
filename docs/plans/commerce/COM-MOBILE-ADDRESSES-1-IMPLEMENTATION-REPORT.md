# COM-MOBILE-ADDRESSES-1 — Implementation Report

## Outcome

A dedicated customer address book on `/commerce/v1`, resolving the Decision Escalation Gate recorded in `TASK-QUEUE.md` via the owner decision (`COM-MOBILE-CUSTOMER-1-ADDRESS-SCHEMA`), recorded durably in `docs/plans/store/ADR-08-COMMERCE-CUSTOMER-ADDRESS-SCHEMA.md`. Full CRUD over `CommerceCustomerAddress` (owned by `CustomerIdentity`, independent of `Partner`, no `Partner` refactor), country-aware Saudi National Address validation, DB-enforced default-shipping/default-billing exclusivity, and — the feature this task was originally sequenced to defer — selecting a saved address at checkout, which copies its field values into the checkout's own `delivery_*` columns rather than storing a reference (the Order Snapshot Rule already applied to `CommerceOrderSnapshot`, extended here).

Also closes a pre-existing gap discovered during the escalation's evidence pass: `building_no`/`additional_number` (Saudi National Address components) were never collectible at checkout at all, even though `CommerceOrderSnapshot` already had a `shipping_building_no` column no code path ever populated.

## Repository evidence / root cause

ADR-08's own evidence pass established: `Partner` addresses are shared with the ERP/POS/invoicing address shape and were never going to cleanly host mobile-commerce-specific fields (Saudi National Address components, delivery notes, default-shipping/billing flags) without a materially larger `Partner` refactor out of scope here. `CustomerIdentity` already has the exact ownership precedent needed (`CommerceOrder.customer_identity_id`, `CommerceCart.customer_identity_id` from `COM-MOBILE-CART-IDENTITY-1`). `CommerceCheckout`/`CommerceOrderSnapshot` already carry `delivery_country`/`shipping_country` etc. as plain columns, no foreign key to any address entity — matching the immutability precedent this task extends rather than a new pattern.

"Select a saved address at checkout" was deliberately deferred at the WIP stage of this task: it requires knowing which customer is authenticated while editing checkout, which needs `EstablishCommerceCustomerContextIfPresent` (an *optional* customer-context resolver on checkout's read/write routes) — a middleware that only existed on `COM-MOBILE-CART-IDENTITY-1`'s branch at the time, not yet on `main`. This task's own WIP commit explicitly recorded this as "still pending... needs the optional customer-context middleware landing via COM-MOBILE-CART-IDENTITY-1 first." That task merged (PR #924) before this one resumed, so the middleware is now on `main` and the deferred feature is implemented here.

## Approach chosen

1. **Schema** — `commerce_customer_addresses` (new table): `tenant_id`, `customer_identity_id` (FK to `customer_identities`, `cascadeOnDelete()` — an address is meaningless without its owning identity, unlike a cart which is ephemeral), `label`, `recipient_name`, `phone`, `country`, `region`, `city`, `district`, `street`, `building_no`, `additional_number`, `postal_code`, `short_address`, `latitude`/`longitude`, `delivery_notes`, `is_default_shipping`/`is_default_billing` (each backed by its own partial unique index scoped to `customer_identity_id`, mirroring `commerce_carts_one_active_per_customer`'s established pattern).
2. **`CommerceCustomerAddressService`** — every query scoped by `customer_identity_id` from the trusted `CustomerContext`, on top of `BaseModel`'s automatic tenant scope. Default-shipping/billing exclusivity enforced at the service layer (clear the previous default under a row lock, then set the new one) and again at the database level by the partial unique indexes — the index is the guarantee under races, the service is the ergonomic path.
3. **`CommerceCustomerAddressController`** — reached only through the existing `X-Customer-Token` required-auth route group (`AuthenticateCommerceCustomer` + `EstablishCustomerContext`, unmodified — no new auth mechanism). Country-aware validation: Saudi National Address components required only when `country === 'SA'`, enforced on `store()` only (a brand-new address always has a definite country); `update()` stays a plain partial merge, same shape as `CommerceCheckoutController::updateAddress()`.
4. **Checkout National Address fields** — `commerce_checkouts.delivery_building_no`/`delivery_additional_number` and `commerce_order_snapshots.shipping_additional_number`/`billing_additional_number` (additive columns); `CommerceCheckoutController::updateAddress()`'s manual-field allow-list extended; `CommerceOrderService::createFromCheckout()` propagates them into the snapshot alongside the existing fields.
5. **Select a saved address at checkout** — `CommerceCheckoutController::updateAddress()` now also accepts `address_id` as a mutually-exclusive alternative to the manual address fields. When present: requires an established `CustomerContext` (guests have no address book — fails closed, not silently ignored); looks up the address via `CommerceCustomerAddressService::find()` (already scoped to that same customer, so a foreign or nonexistent id is indistinguishable from "not found"); copies its address fields (`country`/`region`/`city`/`district`/`street`/`building_no`/`additional_number`/`postal_code`/`delivery_notes`) into the checkout's `delivery_*` columns via the existing `updateAddress()` service call — no new write path, no schema change for this specific feature. Deliberately does **not** touch `contact_name`/`contact_phone` (the address's own `recipient_name`/`phone`) — that stays `updateContact()`'s separate concern, matching checkout's existing field separation.

## Why this approach fits AWJ

- **Order Snapshot Rule, extended not reinvented**: copying the address's field values into the checkout at selection time (not a foreign key) means editing or deleting a saved address never silently changes an in-progress checkout — the same immutability guarantee `CommerceOrderSnapshot` already provides for a *confirmed* order, applied one step earlier for a checkout still being prepared.
- Zero changes to checkout's existing manual-address-entry path — `address_id` is purely additive to `updateAddress()`'s contract; a guest (no address book) or a customer who prefers typing an address manually are both unaffected.
- Reuses `CommerceCustomerAddressService::find()` verbatim for the ownership check — no new authorization logic, the same scoping the address CRUD endpoints already rely on and that is already tested (cross-customer address test).
- `EstablishCommerceCustomerContextIfPresent` (COM-MOBILE-CART-IDENTITY-1, unmodified) is reused exactly as designed: an optional customer-context resolver on checkout routes that fails closed on an invalid token and is a complete no-op when absent.

## Changed files

- `database/migrations/2026_10_08_010000_create_commerce_customer_addresses_table.php` (new)
- `database/migrations/2026_10_08_020000_add_building_no_to_commerce_checkouts.php` (new)
- `database/migrations/2026_10_08_030000_add_additional_number_to_commerce_order_snapshots.php` (new)
- `app/Models/CommerceCustomerAddress.php` (new)
- `app/Models/CommerceCheckout.php` — `delivery_building_no`/`delivery_additional_number` fillable
- `app/Models/CommerceOrderSnapshot.php` — `shipping_additional_number`/`billing_additional_number` fillable
- `app/Services/Commerce/CommerceCustomerAddressService.php` (new)
- `app/Services/Commerce/CommerceCheckoutService.php` — `serialize()`'s address array extended with `building_no`/`additional_number`
- `app/Services/Commerce/CommerceOrderService.php` — `createFromCheckout()` propagates the two new fields into the snapshot
- `app/Http/Controllers/Api/CommerceCustomerAddressController.php` (new)
- `app/Http/Controllers/Api/CommerceCheckoutController.php` — `updateAddress()`'s manual-field allow-list extended; `address_id` selection path added (this session)
- `app/Http/Resources/CommerceCustomerAddressResource.php` (new)
- `routes/api_commerce.php` — `commerce/v1/addresses` (GET/POST) and `commerce/v1/addresses/{id}` (PATCH/DELETE) added to the existing required-auth group
- `tests/Feature/CommerceCustomerAddressApiTest.php` (new, 16 tests — 11 CRUD/isolation/validation + 5 checkout-address-selection, this session)
- `tests/Feature/CommerceCheckoutApiTest.php` (+3 tests, National Address fields at checkout)
- `tests/Feature/CommerceModuleBoundaryTest.php` — `commerce/v1/addresses`/`{id}` added to `ALLOWED_COMMERCE_API_ROUTES`

## Tests and exact results

### `tests/Feature/CommerceCustomerAddressApiTest.php` (16 tests / 78 assertions)

CRUD happy path (create/list/update/delete); auth required; per-customer isolation (a foreign customer's address is invisible and cannot be updated/deleted, 422 not 404 — consistent with the rest of this API's "ownership failure looks like absence" convention); per-tenant isolation even for the same phone number; default-shipping exclusivity (setting a new default clears the previous one) with a DB-level backstop test; default-shipping/billing independence; country-aware Saudi validation (required fields enforced only for `country=SA`, universal fields always required, `short_address` always optional). **This session's additions**: selecting a saved address copies its fields into the checkout's delivery address; selecting `address_id` alongside manual fields is rejected (422); selecting a different customer's address is rejected; selecting an address as a guest checkout (no `X-Customer-Token`) is rejected; editing a saved address after selecting it at checkout does not retroactively change the already-copied checkout address (Order Snapshot Rule verification).

### `tests/Feature/CommerceCheckoutApiTest.php` (+3 tests)

Checkout address accepts `building_no`/`additional_number`; completion propagates both into the order snapshot; completion without either leaves them null (guest backward compatibility).

### Regression

- Full `Commerce|Customer|Storefront` filter: **934 passed / 25 skipped on SQLite, 0 failed** (final run, this session, after the CART-IDENTITY-1 rebase and the address-selection feature).
- `BranchIsolationGuardTest`: green — `CommerceCustomerAddress` classified `CompanyWide` (an address book entry belongs to the customer's account, not a branch).
- `CommerceModuleBoundaryTest`: green — new routes added to the allowlist explicitly, no other boundary change.

## Self-review

### Implementer

Reused every available authority: `CustomerContext` (COM-MOBILE-AUTH-1, unmodified), the partial-unique-index-plus-service-layer-lock pattern already established for cart uniqueness (COM-MOBILE-CART-IDENTITY-1), `CommerceCheckoutService::updateAddress()`'s existing write path (unmodified — `address_id` selection resolves to the exact same field array a manual entry would produce, then calls the same method). The only genuinely new logic is the address CRUD service/controller and the `address_id` → field-copy resolution in the checkout controller.

### Reviewer

Verified the ownership check for `address_id` selection cannot leak: `CommerceCustomerAddressService::find()` scopes by `customer_identity_id` from `CustomerContext`, identical to every other address endpoint, and is exercised by the existing cross-customer address test plus a new checkout-specific one. Verified the guest-checkout-with-`address_id` case fails closed (422, not a silent no-op or a 500) since `CustomerContext::isEstablished()` is checked explicitly before any address lookup. Verified copy-not-reference: the test that edits a saved address after selecting it at checkout, then re-reads the checkout, asserts the pre-edit value survives.

### AWJ Guardian

- **Double-entry / money**: none — no financial write path in this task.
- **Tenant isolation**: every address query scoped by `customer_identity_id` (server-verified `CustomerContext`) on top of `BaseModel`'s automatic `TenantScope`; tested directly (cross-tenant-same-phone test).
- **Immutability**: address selection at checkout copies values in, never stores a reference — a later edit or delete of the saved address cannot retroactively alter an in-progress or completed checkout/order, tested directly.
- **Configurable policy vs. hardcoded**: the address schema itself was the material decision (ADR-08, owner-approved); no further business-policy fork exists inside this implementation.

### Researcher/Architect

Confirmed this task's completion, combined with `COM-MOBILE-CART-IDENTITY-1`'s merge, closes the last item on the original two-decision escalation from 2026-09-21 (ADR-07 cart-merge policy, ADR-08 address schema) — both are now `done`, not just `ready`.

## Accounting impact

None. No journal entry, invoice, payment, or inventory movement is created, read, or affected by any code path in this task.

## Tenant / branch isolation impact

- `CommerceCustomerAddress` is `CompanyWide` — owned by the customer's account, not tied to any branch.
- Every query is tenant-scoped by the existing `TenantScope` global scope plus explicit `customer_identity_id` filtering from `CustomerContext`.

## Security / authorization impact

- `customer_identity_id` on an address is never client-suppliable — sourced exclusively from the server-verified `CustomerContext`, identical to `CommerceCart`'s precedent.
- An address belonging to one customer cannot be read, updated, deleted, or selected at checkout by a different customer, even one in the same tenant (tested explicitly, both for the address CRUD endpoints and for checkout's `address_id` selection).
- Selecting a saved address at checkout requires authentication — a guest presenting `address_id` fails closed (422), never silently ignored or treated as if the field were absent.

## Backward compatibility

- Checkout's existing manual-address-entry path is completely unaffected — `address_id` is purely additive to `updateAddress()`'s contract.
- `building_no`/`additional_number` remain optional free text at checkout for guests, exactly as before this task's checkout-field additions.
- No existing route, model, or service method's prior behavior changed for any caller that doesn't opt into the new `address_id` parameter.

## API / DB / migration impact

- New `commerce_customer_addresses` table; two new nullable columns on `commerce_checkouts` and two on `commerce_order_snapshots`. New routes: `GET/POST commerce/v1/addresses`, `PATCH/DELETE commerce/v1/addresses/{id}` (required-auth group). `PATCH commerce/v1/checkout/address` additively accepts `address_id` alongside its existing manual fields.

## External research used

None beyond what ADR-08 already recorded — Saudi National Address field requirements are a published standard (SPL/short address format), not something requiring new research for this implementation.

## Automated review findings

Not yet opened for review — will be recorded here once PR review completes, per the standing merge policy.

## Risks / remaining work

- None identified beyond what ADR-08 itself already scoped out (this task does not touch `Partner` addresses or attempt to unify the two address concepts — an explicit non-goal).

## Discovered backlog

- None beyond what `COM-MOBILE-CART-IDENTITY-1`'s own report already recorded (the `createFromCheckout()` → `CustomerContext` wiring gap, `COM-MOBILE-ORDER-HISTORY-1`'s job, not this task's).

## Git state

Branch: `claude/com-mobile-addresses-1`, rebased onto `main` post-`COM-MOBILE-CART-IDENTITY-1` merge (PR #924, Merge SHA `dffe6c86017e88019a82fceb2b0214d8a895b332`). PR/commit/final-SHA details recorded once opened and merged.

## Recommended next dependency-ready task

`COM-MOBILE-ORDER-HISTORY-1` — the last remaining task from the original three (`COM-MOBILE-CART-IDENTITY-1`, `COM-MOBILE-ORDER-HISTORY-1`, `COM-MOBILE-ADDRESSES-1`) split from the former `COM-MOBILE-CUSTOMER-1`. Requires fixing `CommerceOrderService::createFromCheckout()`'s `CustomerContext`-sourcing gap first (a confirmed order still has `customer_identity_id = null` today, regardless of cart ownership) before `CommerceOrderService::ownedOrders()` has any real data to expose.
