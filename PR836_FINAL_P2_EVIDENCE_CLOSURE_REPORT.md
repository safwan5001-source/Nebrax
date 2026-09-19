# PR #836 — Final P2 Evidence & Closure Report

## Starting State

- **Starting head:** `78c3e612d6c2b8d6634d46617103ca16b6a5fc0f` (confirmed via `pull_request_read` before any change — unchanged since the prior handoff)
- **Latest `main` at task start:** `0beee2374396c338e5a211b0fddbe87b989be6bd`
- **Merge-base:** `0beee2374396c338e5a211b0fddbe87b989be6bd` (this PR's branch was already caught up to that point before this task; the only new commits since are this task's own P2 fix + merge)
- **Existing CI state:** green on `78c3e612` (SQLite/PostgreSQL success, per the prior closure report); `mergeable = true`

## P2-1 Consumed Cart Expiry

**Classification: A — real correctness gap, fixed.**

**Repository evidence:** `CommerceCartService::findByToken()` (`app/Services/Commerce/CommerceCartService.php`), the `allowConsumed` branch:

```php
if ($allowConsumed && $cart->status === CommerceCart::STATUS_CONSUMED) {
    return ['cart' => $cart, 'invalid' => false];   // ← no expires_at check
}
```

This branch returned immediately, before the `expires_at->isPast()` check a few lines below (which only runs for the `active` branch). `CommerceCheckoutService::resolveForCompletion()` calls `findByToken($cartToken, allowConsumed: true)` — the only caller of that flag — so a completed order's `X-Cart-Token` could replay indefinitely past the Cart's normal 30-day bearer lifetime.

**Root cause:** the `allowConsumed` branch was added (Cart One-Shot Lifecycle work) purely to let replay resolve a Checkout through a now-non-`active` Cart; it never accounted for the Cart's own expiry.

**Fix:** check `expires_at` inside the `allowConsumed` branch too, without any status write:

```php
if ($allowConsumed && $cart->status === CommerceCart::STATUS_CONSUMED) {
    if ($cart->expires_at->isPast()) {
        return ['cart' => null, 'invalid' => true];
    }

    return ['cart' => $cart, 'invalid' => false];
}
```

**Exact behavior before/after:**
- Before: a `consumed` Cart's token resolved for replay forever, regardless of `expires_at`.
- After: replay works exactly as before within the Cart's normal lifetime; once `expires_at` has passed, resolution fails closed (`invalid: true` → 404, cleared token) — `status` is **never** rewritten to `expired` by this check (unlike the `active` branch's own lazy demotion a few lines away) — `consumed` stays a true terminal state, it just stops being resolvable.

**Tests** (`tests/Feature/CommerceCartOneShotLifecycleTest.php`):
- `a_consumed_cart_can_replay_the_completed_order_before_its_token_expires`
- `a_consumed_cart_cannot_resolve_through_its_token_after_expiry_and_status_stays_consumed`
- `the_web_path_enforces_the_same_consumed_cart_expiry_boundary` (web/mobile parity — both go through the same `CommerceCartService`)

**Thread status:** resolved, with the fix, exact diff, and test names posted as evidence.

## P2-2 Historical Replay Resolution

**Classification: A — real, possible in historical data, fixed.**

**Whether the historical shape is actually possible — verified, not assumed:**
- `commerce_orders.commerce_checkout_id` is nullable **and unique** (`commerce_orders_checkout_id_unique`) — one Checkout can back at most one Order.
- `commerce_checkouts.cart_id` has **no** uniqueness constraint — nothing in the schema stops a Cart from owning more than one Checkout row.
- The original P1 bug this PR closed earlier (`createOrResume()` only searching `OPEN_STATUSES`, first review thread on this PR) is exactly the mechanism that — before it was fixed — could leave a Cart with a real completed Checkout 1 (linked to a real `CommerceOrder`) **and** a separately-created, never-completed Checkout 2, both pointing at the same `cart_id`.
- The backfill migration (`2026_10_04_010000_add_consumed_status_to_commerce_carts`) only ever inspects the Cart's own `status`/order-linkage to decide `consumed` — it does not delete or touch any extra Checkout rows — so such a Cart becomes `consumed` with both Checkout rows intact.

**Root cause:** `resolveForCompletion()`'s query — `whereIn('status', [...OPEN_STATUSES, COMPLETED])->orderByDesc('created_at')->first()` — picks the *newest* Checkout among those statuses, with no preference for "the one that actually has an Order." For the historical shape above, that newest row is Checkout 2 (open, no order). `complete()` then sees a non-`COMPLETED` checkout and tries `lockActiveCart()`, which fails (`cart.status = consumed`, not `active`) → `CheckoutNotFoundException` → 404, instead of routing into `replayOrConflict()` and returning the original order.

**Fix** — scoped exclusively to the `consumed`-cart case:

```php
if ($cart->status === CommerceCart::STATUS_CONSUMED) {
    $checkout = $this->scopeToContext(CommerceCheckout::query(), $context)
        ->where('cart_id', $cart->id)
        ->whereHas('order')
        ->orderByDesc('created_at')
        ->first();

    return ['checkout' => $checkout, 'invalid' => false];
}

// unchanged below — normal active-cart resolution is untouched
$checkout = $this->scopeToContext(CommerceCheckout::query(), $context)
    ->where('cart_id', $cart->id)
    ->whereIn('status', [...CommerceCheckout::OPEN_STATUSES, CommerceCheckout::STATUS_COMPLETED])
    ->orderByDesc('created_at')
    ->first();
```

Uses the existing `CommerceCheckout::order(): HasOne` relation — the same "does a `CommerceOrder` actually exist" signal the backfill migration itself treats as authoritative, per this task's explicit instruction not to trust `status` alone when a stronger `CommerceOrder`-linkage signal is available.

**Tenant-safety proof:** `whereHas('order')` is a live Eloquent query (not a raw migration `DB::table()` call) — both `CommerceCheckout` and `CommerceOrder` are `BaseModel`s carrying `TenantScope`, bound to the single `TenantContext` active for the request. Eloquent applies global scopes to relation-constraint subqueries by default, so the `EXISTS` subquery Laravel builds for `whereHas('order')` is itself tenant-scoped identically to the outer query — the same mechanism every other query in `CommerceCheckoutService` already relies on (no manual `tenant_id` matching exists anywhere else in this class either). No client-controlled context is read. This was not re-derived from scratch — it is the same tenant-isolation guarantee this whole file already depends on for `current()`, `createOrResume()`, `complete()`, etc.

**Replay/idempotency proof:** `complete()` and `replayOrConflict()` are byte-for-byte unchanged. Once `resolveForCompletion()` hands back the *correct* (order-linked) Checkout, `complete()`'s existing `status === STATUS_COMPLETED` branch routes into `replayOrConflict()` exactly as it always has: same `Idempotency-Key` → same order (`replayed: true`); different key → 409 `idempotency_conflict`. No new order-creation path, no change to `createFromCheckout()`.

**Test** (`tests/Feature/CommerceCartOneShotLifecycleTest.php`):
`a_consumed_cart_with_a_later_open_checkout_still_replays_through_the_order_linked_checkout` — completes a real purchase via the actual API (Checkout 1 + real Order), then inserts a second, newer, open Checkout 2 directly (the shape unreachable through the current API — `createOrResume()` blocks it on a consumed cart — but real in pre-fix historical rows). Replays the *original* `Idempotency-Key` and asserts: `replayed: true`, same order ID returned, exactly 1 `CommerceOrder` total, and Checkout 2 completely untouched (still `active`, 2 checkout rows total).

**Thread status:** resolved, with the diff, historical-possibility evidence, tenant-safety reasoning, and test name posted.

## P2-3 Contact / Delivery Completeness

**Classification: B — pre-existing, shared contract decision. Not changed.**

**Mobile vs `/store/v1` comparison — verified directly, not assumed:**
- `CommerceCheckoutController::updateContact()` and `StorefrontCheckoutController::updateContact()`: identical validation — `'phone' => ['sometimes', 'string', 'max:32']` in both, byte-for-byte.
- `CommerceCheckoutService::complete()` (the single shared method both controllers call): checks only `contact_name` (non-empty) and `delivery_method` (non-null) — no `contact_phone` or address-field check, for either channel.
- This check is unmodified by this PR or its parent (predates PR-4 entirely — it's COM-CHECKOUT-1B, `/store/v1`'s own original completion logic).

**Architecture/contract evidence:** `docs/plans/commerce/AWJ_CHECKOUT_V1_ARCHITECTURE.md` §4 lists "customer name, phone" as the "minimum customer/contact snapshot," and separately requires an address snapshot "when delivery is required" — but the doc never maps that phrase onto `DELIVERY_METHODS = ['pickup', 'standard']`, and no code anywhere enforces such a mapping today. There is no existing, code-enforced contract that ties a specific `delivery_method` to required phone/address fields.

**Whether changed or deferred:** deferred — no code change. Adding phone/address enforcement only to `/commerce/v1` would create a divergence from `/store/v1` this PR was explicitly told to avoid; adding it to both is a product/architecture decision (exactly which fields each delivery method requires) outside a bug-fix PR's mandate, and risks breaking any existing `/store/v1` completions that rely on the current minimal contract.

**Tests:** none added — no behavior changed.

**Thread status:** left open, with the comparison evidence and reasoning posted, explicitly flagged as needing an owner/product decision — not claimed as fixed.

## Deferred P2

Confirmed: **"Include variant identity in completed-order items" was NOT changed.** No edit to `serializeOrder()` in either controller, no change to variant serialization anywhere in this task's diff.

## Changed Files

- `app/Services/Commerce/CommerceCartService.php` — P2-1 fix (`findByToken()`'s `allowConsumed` branch now checks `expires_at`).
- `app/Services/Commerce/CommerceCheckoutService.php` — P2-2 fix (`resolveForCompletion()` prefers the order-linked Checkout for a `consumed` Cart).
- `tests/Feature/CommerceCartOneShotLifecycleTest.php` — 4 new tests (3 for P2-1 including web parity, 1 for P2-2).

No controller, route, migration, or model schema file touched.

## Migrations

**None.** No migration was added or modified — both fixes are service-level query/logic changes against the existing schema.

## Accounting / Payment / Inventory Safety

Confirmed no side effects introduced. Neither fix touches `CommerceOrderService::createFromCheckout()`, `LedgerService`, `PaymentService`, `InvoiceService`, or any inventory reservation/mutation code path. `complete()`'s order-creation branch and `replayOrConflict()`'s replay branch are both byte-for-byte unchanged — only *which Checkout gets resolved before reaching them* changed (P2-2), and *whether a consumed Cart's token still resolves at all* changed (P2-1). Existing regression tests asserting zero accounting/inventory side effects (`no_accounting_or_inventory_side_effects_are_created_by_checkout_foundation` and equivalents) re-verified green, unmodified.

## Test Results

**Targeted SQLite** (post-fix, pre-merge): `CommerceCartOneShotLifecycleTest` — 13 passed (116 assertions), including all 4 new tests. Broader targeted suite (13 files: `CommerceCheckoutApiTest`, `CommerceCartApiTest`, `CommerceCartOneShotLifecycleTest`, `CommerceCartConsumedStatusMigrationTest`, `StorefrontCheckoutApiTest`, `StorefrontCheckoutCompletionApiTest`, `CommerceModuleBoundaryTest`, `CommerceApiFoundationTest`, `MobileSalesChannelResolverTest`, `StorefrontCartApiTest`, `StorefrontCatalogApiTest`, `PublicApiAuthTest`, `SalesChannelTest`): 180 passed, 1 skipped.

**Targeted PostgreSQL** (post-fix, pre-merge and re-verified post-merge): same 13-file targeted suite plus the 3 real concurrency files (`StorefrontCheckoutPostgresConcurrencyTest`, `StorefrontCheckoutCompletionPostgresConcurrencyTest`, `StorefrontCartPostgresConcurrencyTest`): **194 passed, 0 failed**, both before and after the `main` sync.

**Real PostgreSQL concurrency:** all 4 fork-based row-lock tests in `StorefrontCheckoutCompletionPostgresConcurrencyTest`/`StorefrontCheckoutPostgresConcurrencyTest` green — not simulated with SQLite.

**Full suite / baseline comparison** — run on a clean rebuild, both before and after the `main` merge, on both engines:
- **SQLite (pre-merge):** 4056 passed, 43 skipped, **35 failed** — the documented baseline only (`Fuel*`/ext-bcmath ×26, `AuthRecoveryTest` ×8, `DocumentCenterSecureIntakeTest` ×1).
- **SQLite (post-merge):** 4041 passed, 43 skipped, **35 failed** — same baseline names.
- **PostgreSQL (pre-merge):** 4088 passed, **35 failed** — same baseline.
- **PostgreSQL (post-merge, local):** 4099 passed, **35 failed** — same baseline.

Zero Commerce/Storefront-cart/checkout failures in any local run, before or after the merge.

## Sync

- **Latest `main` used:** `0beee2374396c338e5a211b0fddbe87b989be6bd`
- **Sync method:** `git merge origin/main --no-edit` (no rebase, no force-push, no history rewrite).
- **Conflicts:** none.
- **Overlap analysis:** `git diff --stat` between the pre-sync head and `origin/main` restricted to Commerce/SalesChannel/Storefront/migrations/Tenancy paths showed only Storefront-workspace domain-visibility additions (`STORE-ADMIN-ADOPT-1B-2`, PR #852) and storefront-app locale/edge-middleware work (PR #849/#850) — new files and one additive route (`GET commerce/workspace/storefronts/{id}/domains`) plus one corresponding `CommerceModuleBoundaryTest` allowlist line. **No** touch to `CommerceCart`, `CommerceCheckout`, `CommerceOrder`, `SalesChannel`, cart/checkout migrations, auth, or idempotency code. Safe, semantics-preserving merge.

## Final Git State

- **Branch:** `commerce-api-v1/pr4-mobile-checkout`
- **PR:** [#836](https://github.com/safwan5001-source/Nebrax/pull/836)
- **Base SHA:** `0beee2374396c338e5a211b0fddbe87b989be6bd`
- **Previous Head SHA:** `78c3e612d6c2b8d6634d46617103ca16b6a5fc0f`
- **New Head SHA:** `7b1d9e0f9540574fa67c326848f57e739cfc946c`

## GitHub CI

Two workflow runs triggered on push (`push` + `pull_request` events):

| Check | Run 35281310405/…053/…054 | Run 35281314140 |
|---|---|---|
| `php artisan test (L11, sqlite)` | ✅ success | ✅ success |
| `php artisan test (L11, pgsql)` | ✅ success | ❌ failure ×2 (see below) |
| `web build (Next.js)` | ✅ success | — |
| `storefront (lint + typecheck + test)` | ✅ success | — |

**pgsql failure investigation (run 35281314140, job re-run once per the "at most once" rule):** both the original run and the one re-run failed on the exact same single test, same line, same assertion: `Tests\Feature\CommerceWorkspaceCustomDomainPostgresConcurrencyTest`, `Failed asserting that 0 is identical to 1` at line 154 (a real-fork Postgres race test for the **unrelated** Storefront custom-domain feature, introduced by merged `main` commit `#852`, never touched by this task's diff — not `CommerceCart`, `CommerceCheckout`, `CommerceOrder`, or anything cart/checkout related). Critically, the **sibling workflow run on the byte-identical commit** (`35281310405`) passed this exact test, along with the entire 4173+-test suite, cleanly. Same code, two different outcomes across the two triggered runs — consistent with runner-environment/timing sensitivity in that specific fork-based race test, not a defect traceable to this task's changes. Per the "flake" handling rule, one re-run was spent to confirm; the second failure at the identical assertion means it should not be re-run again, and per this task's own stop conditions, an unrelated pre-existing test's timing sensitivity is not one of the listed reasons to halt P2 closure. Documented here in full rather than silently retried further.

**Exact final head tested:** `7b1d9e0f9540574fa67c326848f57e739cfc946c`. This PR's own scope (Cart/Checkout/P2-1/P2-2) is fully green on both engines, confirmed in run `35281310405` end-to-end and independently by two full local test-suite runs per engine.

## Review Threads

| Thread | Status |
|---|---|
| P1 — Enforce the checkout-creation idempotency key | resolved (prior task) |
| P1 — Allow changed carts to start another checkout | resolved (prior task) |
| P1 — Backfill carts for already-completed checkouts | resolved (prior task) |
| P2 — Include variant identity in completed-order items | **deferred**, untouched (as instructed) |
| P2-1 — Continue enforcing expiry for consumed carts | **resolved** (this task, fixed + tested) |
| P2-2 — Prefer the completed checkout for consumed-cart replays | **resolved** (this task, fixed + tested) |
| P2-3 — Require contact and delivery details before completion | **open/deferred** (this task, verified pre-existing shared contract — owner/product decision needed) |

## Remaining Risks

- **`CommerceWorkspaceCustomDomainPostgresConcurrencyTest` flakiness** — unrelated to this PR's scope, present in already-merged `main` code (Storefront custom-domain feature), reproduced deterministically twice in one CI workflow run's environment while passing cleanly in the sibling run on the identical commit. Recommend the owner track this separately as a CI-stability follow-up for that feature; it does not reflect on Cart/Checkout correctness, which is independently verified green in full (once in CI, twice locally per engine).
- **P2-3** remains an open, deferred decision requiring explicit owner/product input on which delivery methods should require phone/address before completion, applied consistently to both `/store/v1` and `/commerce/v1`.
- No other risks identified within this task's scope.

## Next Step

Owner review and explicit merge approval — including a decision on P2-3 (separate from this PR's mergeability) and awareness of the unrelated Storefront-domain concurrency test's CI flakiness.

---

# READY FOR OWNER MERGE APPROVAL

No merge, no deploy, no production release performed or requested by this task.
