# COM-MOBILE-CART-IDENTITY-1 — Implementation Report

## Outcome

Guest → authenticated customer cart transition on `/commerce/v1`, resolving the Decision Escalation Gate recorded in `TASK-QUEUE.md` via the owner decision (`COM-MOBILE-CART-IDENTITY-1-MERGE-POLICY`), recorded durably in `docs/plans/store/ADR-07-COMMERCE-CART-MERGE-POLICY.md`.

Merge policy (not claim-replace): presenting a valid `X-Customer-Token` alongside a guest `X-Cart-Token` claims the guest cart outright when the customer has no existing cart, or folds the guest cart's lines into the customer's existing cart — using `CommerceCartService::add()`'s own, unmodified quantity-sum-on-duplicate-line semantics — when they do. The source guest cart becomes terminal (`STATUS_CONSUMED`) either way, so a replayed guest token never merges twice.

## Repository evidence / root cause

Full evidence gathered for the Decision Escalation packet (delivered before this task) established: `CommerceCart` had no `customer_identity_id` column at all (purely token-based, guest-only, on both `/commerce/v1` and `/store/v1`); price/availability are never frozen on a cart (`serialize()` re-resolves both live on every read); `add()` already defines exact quantity-sum-on-duplicate-line semantics; checkout completion's `revalidateAndPrice()` is the existing sole pricing/availability authority regardless of cart origin.

One additional piece of evidence surfaced only during implementation: `CommerceCheckoutService`'s three internal cart-lookup call sites (`current()`, `createOrResume()`, `resolveForCompletion()`) all call `CommerceCartService::findByToken()` directly. Rather than touching checkout at all (out of ADR-07's explicit "must not redefine checkout... semantics" scope), the design routes all customer-cart resolution through `CommerceCartService` alone and — when a merge/rebind occurs — **rotates the cart's own token** and hands the new one back via the existing `X-Cart-Token` response header. Because checkout shares Cart's token by design (already documented in `CommerceCheckoutController`'s own docblock — "Checkout has no token of its own, it shares Cart's"), a client that has called any cart endpoint at least once after authenticating will already be carrying a token that correctly resolves to the customer's (possibly merged) cart on every subsequent checkout call — with **zero changes to `CommerceCheckoutService`/`CommerceCheckoutController`**.

## Approach chosen

1. **Schema** — `commerce_carts.customer_identity_id`, nullable, composite tenant-scoped FK against `customer_identities`' existing `(tenant_id, id)` unique index (mirrors `commerce_orders.customer_identity_id`'s exact precedent), `nullOnDelete()` (a cart is ephemeral/non-historical, unlike a confirmed order).
2. **New middleware**: `EstablishCommerceCustomerContextIfPresent` — an *optional* counterpart to `AuthenticateCommerceCustomer` (COM-MOBILE-AUTH-1): an absent `X-Customer-Token` continues as guest unchanged; a present-but-invalid one still fails closed (401), never silently downgrading to guest. Deliberately duplicates `AuthenticateCommerceCustomer`'s token-resolution logic rather than composing with it or with `EstablishCustomerContext` (which unconditionally 403s a non-`CustomerIdentity` principal — exactly the guest case this middleware must tolerate) — same "avoid coupling across trust-boundary-adjacent concerns" reasoning already used in `COM-MOBILE-AUTH-1`.
3. **`CommerceCartService::resolveCurrent(?string $guestToken)`** — the customer-aware counterpart to `findByToken()`. No `CustomerContext` established → `findByToken()` verbatim (100% guest-path parity). Established → resolves/claims/merges per ADR-07, locking both the guest and customer cart rows in one transaction, and returns a rotated token (`rebound`) whenever the caller's current token no longer matches the cart it should now be using.
4. **`CommerceCartService::add()`** — one additive line: a brand-new cart created while `CustomerContext` is established is tagged with that identity from creation, exactly as `CommerceOrder`'s own `customer_identity_id` column already works.
5. **`CommerceCartController`** — its four actions swap `findByToken()` → `resolveCurrent()` and set the response's `X-Cart-Token` to the rotated token when one is returned.
6. **Routes** — `EstablishCommerceCustomerContextIfPresent` added to the existing "read" and cart-mutation "write" middleware groups only (no new routes, no route allowlist changes needed).

## Why this approach fits AWJ

- Zero changes to pricing/availability/checkout logic — `add()`'s existing quantity-sum semantics is reused verbatim inside the merge loop; `revalidateAndPrice()` remains the sole authority for stale-price/availability, exercised identically for merged and guest carts alike.
- The token-rotation design keeps the *entire* checkout stack (`CommerceCheckoutService`, `CommerceCheckoutController`, and — deferred to `COM-MOBILE-ORDER-HISTORY-1` — `CommerceOrderService::createFromCheckout()`) completely untouched, honoring ADR-07's explicit scope boundary ("must not redefine existing pricing, checkout, inventory, or order semantics") while still delivering a working end-to-end guest→customer cart flow.
- Fail-closed on a present-but-invalid customer token (rather than silently treating it as guest) matches `AuthenticateApiClient`'s own established philosophy elsewhere in `/commerce/v1`.

## Changed files

- `database/migrations/2026_10_07_010000_add_customer_identity_to_commerce_carts.php` (new)
- `app/Models/CommerceCart.php` — `customer_identity_id` fillable + `customerIdentity()` relation
- `app/Http/Middleware/EstablishCommerceCustomerContextIfPresent.php` (new)
- `app/Services/Commerce/CommerceCartService.php` — `resolveCurrent()`, `rebindToken()`, `add()`'s creation tagging
- `app/Http/Controllers/Api/CommerceCartController.php` — `resolveCurrent()` call-site swaps + `applyTokenOutcome()` helper
- `routes/api_commerce.php` — `EstablishCommerceCustomerContextIfPresent` added to the read/write cart groups
- `tests/Feature/CommerceCartMergeApiTest.php` (new, 12 tests)

## Tests and exact results

### New — `tests/Feature/CommerceCartMergeApiTest.php` (12 tests / 81 assertions)

Claim (no existing customer cart); merge with quantity-sum on an identical line and distinct lines kept separate; token rebinding so subsequent (including future checkout) requests keep resolving correctly; idempotent replay of the same guest token after a merge (no duplicate quantities); idempotent repeated claim; a guest line no longer purchasable is dropped during merge without blocking sign-in; multi-device (a second device with no guest cart receives the customer's existing cart unchanged, never discarded); price is resolved live post-merge, never frozen from either source cart; cross-tenant isolation (a foreign-tenant guest cart token never resolves under another tenant's context); a cart token already claimed by a *different* customer never leaks to a second customer presenting it; full guest backward compatibility (no customer token → completely unaffected, `customer_identity_id` stays null); a brand-new cart created while authenticated is tagged with that identity from creation.

### Regression

- Full `Commerce|Customer|Storefront` filter: 891 passed / 25 skipped on SQLite (0 failed); 920 passed on PostgreSQL (0 failed, no SQLite-only skips) — includes `CommerceCartApiTest`-equivalent existing guest-cart suites, `StorefrontVariantCommerceTest`, `CommerceCustomerAuthApiTest`, `CommerceCustomerContextIntegrationTest`, checkout completion tests — all green, confirming zero behavior change for every pre-existing flow.
- `BranchIsolationGuardTest`: green (no new model introduced — `CommerceCart` was already classified `CompanyWide`, unchanged).
- `CommerceModuleBoundaryTest`: green, no route allowlist changes needed (no new routes — only new middleware on existing ones).

### Full suite

SQLite: 4426 passed, 27 pre-existing sandbox-only failures (missing `bcmath` PHP extension, `Fuel*Test` — same exact count/class of gap already documented in `COM-MOBILE-MEDIA-1`/`COM-MOBILE-AUTH-1`'s reports, unrelated to this change). No `Customer`/`Commerce`/`Cart`/`Checkout`-named test failed.

## Self-review

### Implementer

Reused every available authority: `add()`'s quantity-sum semantics (unmodified, called in a loop rather than reimplemented), `scopeToContext()`/`TenantScope` for isolation (unmodified), `CommerceCart::STATUS_CONSUMED` (the pre-existing terminal state, given a second trigger rather than a new one), `CustomerContext` (COM-MOBILE-AUTH-1, unmodified). The only genuinely new logic is `resolveCurrent()`'s claim/merge/rebind orchestration, which ADR-07 explicitly authorized.

### Reviewer

Traced every `findByToken()` call site in `CommerceCheckoutService` to confirm none needed changes, given the token-rotation design — verified by the "rebinds the cart token so subsequent requests keep working" test, which re-reads the cart via the *plain guest* `X-Cart-Token` path (no customer token) after a rebind and confirms it still resolves correctly, proving checkout's own unmodified `findByToken()` calls would too. Verified the multi-device token-rotation edge case does not create a security or data-loss issue: since every authenticated request resolves primarily by `customer_identity_id` (not by the presented token) once `CustomerContext` is established, a stale token on any one device self-heals to a fresh rebind on its next request — documented as a minor efficiency tradeoff (an extra token rotation per device-switch), not a correctness gap, in Risks below.

### AWJ Guardian

- **Double-entry / money**: none — no financial write path in this task.
- **Tenant isolation**: every new query in `resolveCurrent()` runs through `scopeToContext()` (tenant/channel/storefront) and the automatic `TenantScope` global scope on `CommerceCart`; `customer_identity_id` written is always `CustomerContext::customerIdentityId()`, never client input; tested directly (foreign-tenant test, cross-customer-claim test).
- **Immutability**: no historical/confirmed document is touched by this task (`CommerceOrder`/`CommerceOrderSnapshot` untouched).
- **Configurable policy vs. hardcoded**: the merge policy itself was the material decision (ADR-07, owner-approved) — no further business-policy fork exists inside this implementation.

### Researcher/Architect

Confirmed the token-rotation design keeps `COM-MOBILE-ORDER-HISTORY-1` (next task) cleanly separable: that task still needs its own fix to `CommerceOrderService::createFromCheckout()` (which structurally never reads `CustomerContext` today, by original design — see that model's own docblock, "ضيفٌ دائماً... لا حتى قراءة CustomerContext") to make order ownership actually flow end-to-end; this task deliberately does not touch it, keeping ADR-07's cart-only scope intact.

## Accounting impact

None. No journal entry, invoice, payment, or inventory movement is created, read, or affected by any code path in this task.

## Tenant / branch isolation impact

- `CommerceCart` remains `CompanyWide` (unchanged) — a cart is tied to a sales channel, not a branch.
- New column/queries are tenant-scoped by the existing `TenantScope` global scope plus explicit `scopeToContext()` channel/storefront filtering, unchanged in shape.

## Security / authorization impact

- New optional customer-identity resolution on cart/checkout-adjacent routes; fails closed on any invalid/expired/wrong-tenant/wrong-type token, exactly like the required-auth `AuthenticateCommerceCustomer`.
- `customer_identity_id` on a cart is never client-suppliable — sourced exclusively from the server-verified `CustomerContext`.
- A cart already claimed by one customer cannot be claimed, merged into, or read by a different customer, even if that customer somehow obtains the first customer's raw cart token (tested explicitly).
- No price/availability trust boundary changes — `revalidateAndPrice()` remains authoritative at checkout completion regardless of cart origin.

## Backward compatibility

- Zero behavior change for any guest-only flow on `/commerce/v1` or `/store/v1` — `resolveCurrent()` is `findByToken()` verbatim when no `CustomerContext` is established, and `EstablishCommerceCustomerContextIfPresent` is a complete no-op when `X-Customer-Token` is absent.
- `CommerceCheckoutService`/`CommerceCheckoutController` are entirely unmodified.
- `CommerceCart`'s existing guest lifecycle (30-day rolling `expires_at`, lazy expire-on-read, single-successful-order consumption) is unchanged; merge/claim only adds two *additional* ways a cart can end up owned or consumed.

## API / DB / migration impact

- New nullable column + composite FK + index on `commerce_carts`. No new routes (existing `GET cart`, `POST/PATCH/DELETE cart/items` behave identically for guests; additively support a customer token).

## External research used

Cart-merge policy comparison (commercetools' `MergeWithExistingCustomerCart`/`UseAsNewActiveCustomerCart`, and general industry practitioner guidance on not letting a merge failure block sign-in) was gathered for the Decision Escalation packet prior to this task and is recorded in ADR-07; no new external research was needed during implementation.

## Automated review findings

Recorded once the PR is opened and reviewed, per the standing merge policy.

## Risks / remaining work

- **Minor efficiency tradeoff, not a bug**: in a genuine multi-device scenario, each device's cart request that doesn't already hold the cart's *current* token triggers a token rotation (one extra `UPDATE`). This self-heals correctly on every request (resolution is always primarily by `customer_identity_id`, never solely by token, once `CustomerContext` is established) but is not optimized to avoid unnecessary rotations when, e.g., two devices poll `GET cart` in quick succession. Acceptable for V1; not a correctness or security issue.
- **Discovered, deliberately not fixed here**: `CommerceOrderService::createFromCheckout()` still never reads `CustomerContext` (by original, documented design — predates this task). A confirmed Commerce order therefore still has `customer_identity_id = null` even after this task, regardless of cart ownership. This is `COM-MOBILE-ORDER-HISTORY-1`'s job, not this task's — ADR-07 explicitly scopes this task to cart ownership only.
- A mobile client that jumps straight to checkout without ever calling a cart endpoint after authenticating (skipping the one interaction that triggers `resolveCurrent()`) would complete checkout against an unmerged guest cart. This is a minor, realistic-but-unlikely UX edge case (mobile carts are virtually always viewed before checkout) rather than a security or data-loss issue — recorded as backlog, not solved in V1.

## Discovered backlog

- Token-rotation-per-request optimization for multi-device polling (above).
- The `createFromCheckout()` → `CustomerContext` wiring gap, to be closed in `COM-MOBILE-ORDER-HISTORY-1`.
- The straight-to-checkout-without-cart-view edge case (above) — could be closed later by also calling `resolveCurrent()`'s claim/merge step from `CommerceCheckoutService::createOrResume()` directly, if it proves to matter in practice.

## Git state

Branch: `claude/com-mobile-cart-identity-1`. Commit/PR/SHA details recorded once pushed and opened.

## Recommended next dependency-ready task

`COM-MOBILE-ORDER-HISTORY-1` — now that cart ownership works end-to-end, exposing `CommerceOrderService::ownedOrders()` as a route is the natural next step, but requires fixing `createFromCheckout()`'s `CustomerContext` sourcing first (see Discovered backlog) to have any real data to expose.
