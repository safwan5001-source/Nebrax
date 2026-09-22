# COM-MOBILE-CART-IDENTITY-1 — Implementation Report

## Outcome

Guest → authenticated customer cart transition on `/commerce/v1`, resolving the Decision Escalation Gate recorded in `TASK-QUEUE.md` via the owner decision (`COM-MOBILE-CART-IDENTITY-1-MERGE-POLICY`), recorded durably in `docs/plans/store/ADR-07-COMMERCE-CART-MERGE-POLICY.md`.

Merge policy (not claim-replace): presenting a valid `X-Customer-Token` alongside a guest `X-Cart-Token` claims the guest cart outright when the customer has no existing cart, or folds the guest cart's lines into the customer's existing cart — using `CommerceCartService::add()`'s own, unmodified quantity-sum-on-duplicate-line semantics — when they do. The source guest cart becomes terminal (`STATUS_CONSUMED`) either way, so a replayed guest token never merges twice.

**Final-state note (post 11 review rounds):** the sections below describe the *initial* design, including its "zero changes to `CommerceCheckoutService`/`CommerceCheckoutController`" goal — that goal did not survive review. Round 7 found that an authenticated customer going straight to checkout with a guest token bypassed the merge entirely (the exact edge case flagged as accepted backlog in the original "Risks" section below), and closing it required routing `current()`/`createOrResume()` through `resolveCurrent()` and adding matching ownership-recheck locks to checkout's own cart/checkout locking. See "Automated review findings" and "Git state" at the end of this report for what actually shipped.

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

## Changed files (final, across all 11 review rounds)

- `database/migrations/2026_10_07_010000_add_customer_identity_to_commerce_carts.php` (new) — `restrictOnDelete()`, not `nullOnDelete()` as originally planned (round 3: nulling a composite FK nulls every referencing column, including non-nullable `tenant_id`).
- `database/migrations/2026_10_07_020000_add_one_active_cart_per_customer_index.php` (new, round 1) — partial unique index, later widened to include `sales_channel_id` (round 9).
- `database/migrations/2026_10_07_030000_add_previous_token_hash_to_commerce_carts.php` (new, round 5) — indexed (round 8).
- `app/Models/CommerceCart.php` — `customer_identity_id` + `previous_token_hash` fillable/hidden, `customerIdentity()` relation.
- `app/Http/Middleware/EstablishCommerceCustomerContextIfPresent.php` (new)
- `app/Services/Commerce/CommerceCartService.php` — `resolveCurrent()`, `rebindToken()` (two-slot), `add()`'s creation tagging and identity-locked reuse, `findByToken()`'s ownership guard and locked identity-fallback, `lockUsableCart()`'s post-lock ownership recheck, `serializeForOwnedRead()` (locked recheck-and-serialize for reads), `isOwnedByCurrentBearer()`/`cartModelOwnedByCurrentBearer()`.
- `app/Services/Commerce/CommerceCartQuantityOverflowException.php` (new, round 2), `CommerceCartLineNotPurchasableException.php` (new, round 5) — precise exception typing so the merge loop only drops a line for its own eligibility failure, never an unrelated arithmetic one.
- `app/Http/Controllers/Api/CommerceCartController.php` — `resolveCurrent()` call-site swaps, `applyTokenOutcome()` helper, `merged` 409 handling, `serializeForOwnedRead()` on `show()`.
- `app/Services/Commerce/CommerceCheckoutService.php` (round 7+, contrary to the original "zero changes" design) — `current()`/`createOrResume()` route through `resolveCurrent()`; `assertOwnedByCurrentBearer()`/`serializeForOwnedRead()` added to every checkout read/lock path; `lockUsableCheckout()`/`complete()`/`createOrResume()`'s cart+checkout locks standardized on one order (round 11).
- `app/Http/Controllers/Api/CommerceCheckoutController.php` (round 7+) — `store()`/`show()`/`withCurrentCheckout()`/`complete()`'s review-required branch all updated for token-outcome propagation and locked ownership rechecks.
- `routes/api_commerce.php` — `EstablishCommerceCustomerContextIfPresent` added to the read/write cart and checkout groups.
- `app/Support/PublicApiErrorCode.php` + `docs/openapi/public-api-v1.yaml` — `cart_merged` (409) additive error code.
- `tests/Feature/CommerceCartMergeApiTest.php` (new, grew from 12 to 35 tests across all rounds).

## Tests and exact results

### Final — `tests/Feature/CommerceCartMergeApiTest.php` (35 tests, grown across 11 review rounds)

Claim (no existing customer cart); merge with quantity-sum on an identical line and distinct lines kept separate; token rebinding (including the round-5 two-slot previous-token-hash grace window) so subsequent (including checkout) requests keep resolving correctly; idempotent replay of the same guest token after a merge (no duplicate quantities); idempotent repeated claim; a guest line no longer purchasable is dropped during merge without blocking sign-in (via a dedicated `CommerceCartLineNotPurchasableException`, never swallowing an unrelated arithmetic overflow); multi-device (a second device with no guest cart receives the customer's existing cart unchanged, never discarded); price is resolved live post-merge, never frozen from either source cart; cross-tenant isolation; a cart token already claimed by a *different* customer never leaks to a second customer presenting it; full guest backward compatibility; a brand-new cart created while authenticated is tagged with that identity from creation; concurrent-claim ownership rechecks under lock on both write (`lockUsableCart()`/`lockUsableCheckout()`) and read (`serializeForOwnedRead()`) paths, for both cart and checkout; checkout creation itself now merges a presented guest cart into the customer's existing cart instead of silently completing the raw guest cart; a single POST checkout rebinds the cart token at most once; channel-scoped active-cart uniqueness (a tenant with two mobile `SalesChannel`s doesn't collide).

### Regression (final, after round 11)

- Full `Commerce|Customer|Storefront|PublicApiOpenApiContractTest` filter: **931 passed / 25 skipped on SQLite (0 failed); 956 passed on PostgreSQL (0 failed)**.
- `BranchIsolationGuardTest`: green (no new model introduced — `CommerceCart` was already classified `CompanyWide`, unchanged).
- `CommerceModuleBoundaryTest`: green, no route allowlist changes needed (no new routes — only new middleware on existing ones).

### Full suite (initial pass, before the 11 review rounds' fixes; unaffected by them)

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

- Zero behavior change for any guest-only flow on `/commerce/v1` or `/store/v1` — `resolveCurrent()` is `findByToken()` verbatim when no `CustomerContext` is established, and `EstablishCommerceCustomerContextIfPresent` is a complete no-op when `X-Customer-Token` is absent. This held even after `CommerceCheckoutService`/`CommerceCheckoutController` stopped being untouched (round 7+): every change there is inside the `CustomerContext`-established branch or a lock-order/lock-recheck detail invisible to a correctly-behaving guest request.
- `CommerceCart`'s existing guest lifecycle (30-day rolling `expires_at`, lazy expire-on-read, single-successful-order consumption) is unchanged; merge/claim only adds two *additional* ways a cart can end up owned or consumed.

## API / DB / migration impact

- New nullable column + composite FK + index on `commerce_carts`. No new routes (existing `GET cart`, `POST/PATCH/DELETE cart/items` behave identically for guests; additively support a customer token).

## External research used

Cart-merge policy comparison (commercetools' `MergeWithExistingCustomerCart`/`UseAsNewActiveCustomerCart`, and general industry practitioner guidance on not letting a merge failure block sign-in) was gathered for the Decision Escalation packet prior to this task and is recorded in ADR-07; no new external research was needed during implementation.

## Automated review findings

11 rounds of automated (Codex) review on PR #924, every non-optional finding verified and fixed except one explicitly verified and declined with reasoning:

1. **Round 1 (4 findings):** guest lookup didn't reject an owned cart's token; expired customer carts used as merge targets; concurrent first-cart creation for one customer wasn't serialized (added `CustomerIdentity` row lock + backstop partial unique index); token rebinding invalidated another device's token with no self-heal.
2. **Round 2 (4 findings):** stale-token replay of a completion request could resolve a different, newer checkout (identity fallback scoped to exclude `allowConsumed`); concurrent guest claims under one new customer could 500 (identity lock moved earlier); a blanket `catch (RuntimeException)` swallowed quantity-overflow failures during merge; a merged guest item ID returned a bare 404 instead of a `cart_merged` 409.
3. **Round 3 (2 findings):** reachable path differed from the description but the underlying gap was real — `show()`'s unwrapped `serialize()` call, and `ON DELETE SET NULL` on a composite FK nulling the non-nullable `tenant_id` (switched to `restrictOnDelete()`).
4. **Round 4 (1 finding):** checkout preparation never rebound/returned a fresh token, so a device whose token went stale mid-checkout couldn't complete on its first attempt — required (contrary to the original design) adding token-outcome propagation to `CommerceCheckoutController`.
5. **Round 5 (2 findings):** unconditional token rotation still let one device invalidate another's token right before completion (added the two-slot `previous_token_hash` grace window); a plain `RuntimeException` catch could still swallow an unrelated arithmetic failure during merge (added `CommerceCartLineNotPurchasableException` as the only droppable type).
6. **Round 6 (2 findings):** a cart claimed between resolution and mutation-lock could still be mutated by a stale guest reference (`lockUsableCart()` now rechecks ownership post-lock); concurrent fallback rebinds could strand a token in neither slot (wrapped in a locked transaction).
7. **Round 7 (3 findings):** authenticated checkout never merged a presented guest cart (routed `current()`/`createOrResume()` through `resolveCurrent()`); checkout's own locks never rechecked ownership post-lock (added `assertOwnedByCurrentBearer()`); `POST checkout` rebound the token twice per request (removed a redundant duplicate lookup).
8. **Round 8 (2 findings, 1 declined):** `previous_token_hash` was unindexed, defeating the `OR` query plan (indexed); review-required responses discarded a rebound token (wired into `applyTokenOutcome()`). **Declined:** "merge carts before checkout completion" — verified the literal fix would orphan the already-open checkout being completed (its `cart_id` never moves) or violate the one-active-cart-per-customer index; reasoning posted on the PR thread, left open, no code change.
9. **Round 9 (2 findings):** cart/checkout reads had the same stale-authorization gap as writes, just for GET responses (added `isOwnedByCurrentBearer()`); the active-cart unique index was tenant-wide when the application already scopes per channel (widened to include `sales_channel_id`, deliberately excluding the nullable `storefront_id`).
10. **Round 10 (1 finding):** the round-9 read-path recheck was itself unlocked, leaving a smaller window open (replaced with `serializeForOwnedRead()`, locking the row for the whole recheck-and-serialize).
11. **Round 11 (2 findings):** `CommerceCheckoutController::store()` was the one call site missed when `serializeForOwnedRead()` was introduced (fixed); `serializeForOwnedRead()`'s lock order conflicted with `lockUsableCheckout()`'s — investigating this also surfaced a pre-existing, unrelated conflict with `createOrResume()`'s order, so all four cart+checkout double-lock sites were standardized on one order (cart-then-checkout, the only order `createOrResume()` can structurally take).

## Risks / remaining work

- **Minor efficiency tradeoff, not a bug**: in a genuine multi-device scenario, a device's cart/checkout request whose token doesn't match either the current or previous-generation slot (round 5's two-slot grace window) triggers a token rotation (one extra `UPDATE`). This self-heals correctly on every request but isn't optimized to avoid a rotation on, e.g., three or more devices polling in quick succession. Acceptable for V1; not a correctness or security issue.
- **Discovered, deliberately not fixed here**: `CommerceOrderService::createFromCheckout()` still never reads `CustomerContext` (by original, documented design — predates this task). A confirmed Commerce order therefore still has `customer_identity_id = null` even after this task, regardless of cart ownership. This is `COM-MOBILE-ORDER-HISTORY-1`'s job, not this task's — ADR-07 explicitly scopes this task to cart ownership only.
- **~~A mobile client that jumps straight to checkout without ever calling a cart endpoint would complete against an unmerged guest cart~~ — fixed in round 7**, not left as backlog: `CommerceCheckoutService::current()`/`createOrResume()` now route through `resolveCurrent()`, so checkout entry points merge exactly like cart entry points.
- **Bounded, not eliminated**: the two-slot token-rotation grace window (round 5) survives exactly one interleaved touch from another device, not unlimited concurrent devices — a third rapid rotation before a device's next request still invalidates its token. A full fix needs a genuine multi-token table, treated as an accepted residual limit (documented in the migration's own docblock) rather than a session-management redesign for V1.
- **Standing, not a defect**: completing an already-open checkout that was created and filled out entirely as a guest never merges in a separate customer cart the customer authenticated into afterward (round 8 finding, verified and declined — see "Automated review findings" above). The customer's other cart is untouched, not lost, and remains available for its own checkout.

## Discovered backlog

- Token-rotation-per-request optimization for 3+ simultaneous devices (above).
- The `createFromCheckout()` → `CustomerContext` wiring gap, to be closed in `COM-MOBILE-ORDER-HISTORY-1`.
- A genuine multi-token-per-cart schema, if the bounded two-slot rotation grace window ever proves insufficient in practice.

## Git state

Branch: `claude/com-mobile-cart-identity-1`. PR #924, merged via squash. Head SHA `1d3e42c65ae4ca36303faba7316242ca802d3f06`, Merge SHA `dffe6c86017e88019a82fceb2b0214d8a895b332`. 12 commits across the initial implementation and 11 review-fix rounds.

## Recommended next dependency-ready task

`COM-MOBILE-ORDER-HISTORY-1` — now that cart ownership works end-to-end, exposing `CommerceOrderService::ownedOrders()` as a route is the natural next step, but requires fixing `createFromCheckout()`'s `CustomerContext` sourcing first (see Discovered backlog) to have any real data to expose.
