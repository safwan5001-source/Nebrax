# PR #836 — Cart One-Shot Lifecycle Closure Report

## Repository State

- **Branch:** `commerce-api-v1/pr4-mobile-checkout`
- **PR:** [#836 — Commerce API V1 — PR-4: Mobile Checkout](https://github.com/safwan5001-source/Nebrax/pull/836)
- **Starting Head (this task's handoff):** `73b4189700b9ab62e0450f7411a6a64a59d95a77`
- **Latest `main` used:** `cf2ec7373762b3711fb3e24f8c58784d2c578af2`
- **Base SHA (PR base, post-sync):** `cf2ec7373762b3711fb3e24f8c58784d2c578af2`
- **Final Head SHA:** `7654430f9e9b394ae4420a8ca91c72da81934df9`

Before touching anything, `git fetch origin` confirmed PR #836 and the branch still existed at the
expected head, and `origin/main` had moved from the handoff's `dc03db7a` to `3ef33e61` (2 commits:
`#838` Product Workspace, `#840` Storefront provisioning) — neither touching `CommerceCart`,
`CommerceCheckout`, `CommerceOrder`, `SalesChannel`, or any migration. Implementation proceeded on
the confirmed, unchanged head.

## Migration Design

**Actual SQLite DDL before** (`sqlite_master`, verified against a real build, not assumed):

```sql
CREATE TABLE "commerce_carts" (
  "id" varchar not null, "tenant_id" varchar not null, "storefront_id" varchar,
  "sales_channel_id" varchar not null, "token_hash" varchar not null,
  "status" varchar not null default ('active'), "expires_at" datetime not null,
  "created_at" datetime, "updated_at" datetime,
  foreign key("sales_channel_id") references sales_channels("id") on delete restrict,
  foreign key("tenant_id") references tenants("id") on delete cascade,
  foreign key("storefront_id") references "storefronts"("id") on delete restrict,
  primary key ("id")
)
```

**No CHECK constraint exists on `status` at all** — Laravel's SQLite grammar never emitted one for
`enum()` here. This directly determined the migration strategy: nothing to alter on SQLite.

**Actual PostgreSQL DDL before** (`pg_get_constraintdef`, verified against a real PostgreSQL 16
instance):

```
commerce_carts_status_check: CHECK (((status)::text = ANY ((ARRAY['active'::character varying,
'expired'::character varying])::text[])))
```

A named CHECK constraint on a plain `varchar(255)` column — **not** a native PostgreSQL `ENUM`
type.

**Representation of status in each DB:** SQLite = unconstrained `varchar`; PostgreSQL = `varchar`
+ named CHECK constraint.

**Exact migration strategy — SQLite:** no-op (`up()`/`down()` both return immediately when
`DB::getDriverName() !== 'pgsql'`). No table rebuild, so no risk to the historical
loss-of-CHECK-constraint-on-rebuild failure mode this repo has hit before — there is no rebuild.

**Exact migration strategy — PostgreSQL:** `DROP CONSTRAINT commerce_carts_status_check` followed
by `ADD CONSTRAINT commerce_carts_status_check CHECK (status IN ('active','expired','consumed'))`.
No column type change, no data touched, no destructive conversion.

**DDL after (PostgreSQL, verified):**

```
commerce_carts_status_check: CHECK (((status)::text = ANY ((ARRAY['active'::character varying,
'expired'::character varying, 'consumed'::character varying])::text[])))
```

**Constraints preservation:** FKs (`tenant_id` cascade, `storefront_id`/`sales_channel_id`
restrict), primary key, and the `token_hash` unique constraint are all untouched by either branch
— proven in `CommerceCartConsumedStatusMigrationTest` by inserting rows that violate each and
asserting `QueryException`.

**Indexes preservation:** `commerce_carts_context_index`
(`tenant_id, storefront_id, sales_channel_id, status, expires_at`) and the primary key index are
untouched — no `Schema::table()` blueprint operation on SQLite (no-op) and only a constraint
swap on PostgreSQL, neither of which touches indexes.

**FK preservation:** confirmed directly above.

**Rollback strategy:** fail-closed. `down()` first checks
`DB::table('commerce_carts')->where('status', 'consumed')->exists()` and throws a
`RuntimeException` (Arabic message, unchanged data) before touching anything if any `consumed`
row exists — no `consumed → active`/`expired` rewrite, no row deletion. Only when no `consumed`
rows exist does it proceed: no-op on SQLite, restore the two-value CHECK constraint on PostgreSQL.

**Rollback refusal with consumed rows:** proven in
`down_refuses_when_a_consumed_row_exists_and_does_not_modify_or_delete_data` — asserts the
exception message, and that both an `active` and a `consumed` row are byte-for-byte unchanged
afterward (no update, no delete).

## Domain Lifecycle

**Before:** `CommerceCart::STATUS_ACTIVE` / `STATUS_EXPIRED` only. A completed Checkout left its
Cart `active` forever. The only defense against a duplicate `CommerceOrder` was a temporary
workaround in `createOrResume()`: if a completed Checkout already existed for the cart, resume it
instead of creating a new one — which meant the *cart* itself became permanently unusable for a
second purchase (P1 review thread "Allow changed carts to start another checkout") while still
reporting `status = active` in the schema — a semantic mismatch, not a real fix.

**After:** `active → checkout → successful CommerceOrder → consumed`
(`CommerceCart::STATUS_CONSUMED`, new).

**`STATUS_CONSUMED`:** the terminal state. A consumed Cart can never `add`/`update`/`remove` a
line, start a new Checkout, or back a second Order.

**One Cart → maximum one Order:** enforced by `CommerceCheckoutService::complete()` moving the
Cart to `consumed` in the same transaction that creates the `CommerceOrder` and marks the Checkout
`completed`. Every path that could start a new purchase cycle on that cart
(`CommerceCartService::lockUsableCart()`/`lockActiveCart()`, both requiring `status = active`)
already existed and needed **no new logic** — they simply stopped matching once the cart's
status changed.

**Purchase-again via new Cart/token:** proven end-to-end in
`the_old_cart_token_cannot_start_a_new_purchase_but_a_new_cart_token_can` — Cart A → Order A →
same token rejected for both mutation and new-checkout → Cart B (new token) → Order B, with
`Order B.checkout.cart_id === Cart B.id`.

## Implementation

**Changed files:**
- `app/Models/CommerceCart.php` — `STATUS_CONSUMED = 'consumed'` constant only.
- `app/Services/Commerce/CommerceCartService.php` — `findByToken()` gains an `allowConsumed`
  flag (default `false`); when `true` and the cart is `consumed`, it is returned as valid instead
  of `invalid`.
- `app/Services/Commerce/CommerceCheckoutService.php`:
  - `resolveForCompletion()` now calls `findByToken($cartToken, allowConsumed: true)`.
  - `complete()` adds one line — `$cart->update(['status' => CommerceCart::STATUS_CONSUMED])` —
    immediately after marking the Checkout `completed`, inside the same transaction.
  - `current()`/`createOrResume()` are **unchanged in behavior** — they keep calling
    `findByToken()` with the default `allowConsumed: false`, so a consumed cart is treated like
    any other non-active cart (404).
- `database/migrations/2026_10_04_010000_add_consumed_status_to_commerce_carts.php` — new,
  detailed above.
- Tests: `tests/Feature/CommerceCartOneShotLifecycleTest.php` (new, 9 scenarios),
  `tests/Feature/CommerceCartConsumedStatusMigrationTest.php` (new, 7 scenarios),
  `tests/Feature/CommerceCheckoutApiTest.php` (1 test updated — see below),
  `tests/Feature/StorefrontCheckoutCompletionApiTest.php` (1 test updated — mirror on the web
  path), `tests/Feature/StorefrontCheckoutCompletionPostgresConcurrencyTest.php` (1 assertion
  added to the existing concurrency test + 1 new concurrency test).
- Docs: `docs/plans/commerce/AWJ_CHECKOUT_V1_ARCHITECTURE.md` §9 (Cart One-Shot Lifecycle
  paragraph added), `docs/plans/commerce/PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md`
  (corrected the `POST checkout` + `POST checkout/complete` Idempotency-Key claim the second P1
  thread flagged as contradicting the implementation).

**`createOrResume()` behavior:** the PR-4 "resume a completed Checkout on a still-active Cart"
branch is now unreachable through this fix (a cart consumed via `complete()` never reaches
`lockActiveCart()`'s `status = active` filter again) and is kept, unmodified, only as a defensive
fallback for any Checkout/Cart rows written before this fix landed. Documented in place; not
deleted (out of this task's scope to refactor further).

**`complete()` behavior:** unchanged for the replay/conflict branch
(`checkout.status === COMPLETED → replayOrConflict()`, no cart access at all). Changed only in the
first-completion branch, where cart consumption is now the last statement before returning.

**Cart consumption:** exactly one line, one transaction, no separate write path.

**Atomicity:** `complete()` already ran inside `DB::transaction(..., 3)` with the Checkout and
Cart both `lockForUpdate()`-locked before any write. Adding the cart-consumption `update()` inside
that same closure means Order-created + Checkout-completed + Cart-consumed commit together or none
commit — proven by
`a_completion_that_fails_review_leaves_order_checkout_and_cart_untouched` (a review-required
failure before any write leaves Order count 0, Checkout still open, Cart still `active`).

**Locking:** no new locks. The existing `lockForUpdate()` on the Checkout row (always) and Cart
row (first-completion path only) are reused as-is.

**Replay path:** `resolveForCompletion()`'s `findByToken(..., allowConsumed: true)` is the only
new lookup behavior. It exists solely so a retried `POST checkout/complete` with the same
`Idempotency-Key` can still locate the (now consumed-cart-linked) completed Checkout. It grants no
write capability — `complete()`'s replay branch performs no cart mutation.

## Security / Isolation

- **Tenant Isolation:** unchanged — every query in the modified code paths still goes through
  `BaseModel`'s `TenantScope`/`scopeToContext()`. Proven directly for the new lifecycle in
  `a_consumed_carts_token_stays_isolated_across_tenant_channel_and_web_mobile_boundaries`.
- **SalesChannel isolation:** unchanged; same test covers a second mobile channel under the same
  tenant.
- **Storefront semantics:** unchanged — `storefront_id` nullability and the mobile
  positive-`TYPE_MOBILE`-check in `context()` were not touched.
- **Cart token boundary:** unchanged — `X-Cart-Token` / web cookie still the only carriers of cart
  identity; no new token mechanism.
- **ApiClient/Sanctum boundary:** untouched — no middleware, no auth code modified.

## Accounting / Payment / Inventory

**Confirmed no new side effects.** `CommerceOrderService::createFromCheckout()` was not modified
by this task. Re-verified directly: no `LedgerService::post()`, no `PaymentService`, no
`InvoiceService`, no `StockMovement`, no inventory reservation/mutation call anywhere in
`createFromCheckout()` or in the new `$cart->update(['status' => ...])` line (a plain Eloquent
update on `commerce_carts`, not a financial document). Existing regression test
`no_accounting_or_inventory_side_effects_are_created_by_checkout_foundation` still passes
unmodified. Cart lifecycle transition is not financial posting and was never routed through
`LedgerService`.

## Tests

**Migration tests (`CommerceCartConsumedStatusMigrationTest`, 7 scenarios)** — run on both
engines:
- existing `active`/`expired` rows survive `up()`, `active` stays the default for new rows
- `consumed` can be persisted after `up()`
- all original constraints (FK violation still rejected) and the `token_hash` unique constraint
  still enforced after `up()`
- PostgreSQL-only: CHECK constraint widened to accept `consumed`, still rejects an arbitrary value
  (skipped on SQLite with an explicit reason — no CHECK exists there)
- `down()` succeeds with no `consumed` rows and restores the two-value restriction
- `down()` refuses with a `consumed` row present, without modifying or deleting any row

**Lifecycle tests (`CommerceCartOneShotLifecycleTest`, 9 scenarios)** — mobile + one dedicated web
test, covering: new cart starts active, successful completion (one Order / Checkout completed /
Cart consumed together), atomicity on a failed completion, consumed-cart mutation rejection
(add/update/remove), consumed-cart checkout/second-order rejection, replay + conflict semantics
post-consumption, old-token-blocked / new-token-purchase-again, full web-path lifecycle parity,
and cross-tenant/channel/web-mobile isolation of a consumed cart's token.

**Web tests:** `the_full_lifecycle_holds_identically_for_the_web_storefront_path` drives
`CommerceCartService`/`CommerceCheckoutService` directly through the same code path
`StorefrontCheckoutController` uses, confirming Cart consumption and the same-token rejection on
`/store/v1`.

**Mobile tests:** the remaining 8 lifecycle scenarios plus the updated
`a_second_post_checkout_after_completion_is_rejected_because_the_cart_is_consumed` in
`CommerceCheckoutApiTest` (renamed from the pre-fix
`..._resumes_the_completed_checkout_and_never_creates_a_second_order`, whose premise — the cart
stays `active` after completion — no longer holds).

**Tenant isolation tests:** as above, plus the pre-existing cross-tenant/cross-channel checkout
tests in `CommerceCheckoutApiTest`, unmodified and still green.

**PostgreSQL concurrency tests (`StorefrontCheckoutCompletionPostgresConcurrencyTest`)**:
- existing `a_blocked_concurrent_completion_still_resolves_to_exactly_one_order` extended with an
  assertion that the cart is `consumed` after the real-lock-contended completion
- new `two_concurrent_checkout_creation_attempts_after_consumption_create_zero_new_checkouts`:
  a consumed cart's row is locked by one forked process while a second forked process attempts a
  real `createOrResume()` call; it fails with `CheckoutNotFoundException` once unblocked, and a
  third sequential attempt confirms the same deterministic outcome — `commerce_checkouts` count
  never exceeds the pre-existing 1 row.
- `StorefrontCheckoutPostgresConcurrencyTest`'s existing
  `two_concurrent_checkout_creations_after_completion_resolve_to_the_same_completed_checkout` was
  re-verified unchanged (it exercises the still-active-cart legacy fallback path in
  `createOrResume()` directly, which this fix does not remove).

**Targeted regression totals:** `CommerceCheckoutApiTest`, `CommerceCartApiTest`,
`CommerceModuleBoundaryTest`, `CommerceApiFoundationTest`, `CommerceCatalogApiTest`,
`MobileSalesChannelResolverTest`, `StorefrontCheckoutApiTest`,
`StorefrontCheckoutCompletionApiTest`, `StorefrontCheckoutPostgresConcurrencyTest`,
`StorefrontCheckoutCompletionPostgresConcurrencyTest`, `StorefrontCartApiTest`,
`StorefrontCartPostgresConcurrencyTest`, `StorefrontCatalogApiTest`,
`StorefrontDomainResolutionApiTest`, `PublicApiAuthTest`, `SalesChannelTest`,
`CommerceCartOneShotLifecycleTest`, `CommerceCartConsumedStatusMigrationTest`:
**214 passed, 0 failed** on PostgreSQL (run twice — pre-merge and post-`main`-merge, both clean).

**Full suite results:**
- **SQLite** (post-merge, clean rebuild): 4000 passed, 43 skipped, **35 failed** — the documented
  pre-existing baseline only (`Fuel*`/ext-bcmath ×26, `AuthRecoveryTest` ×8,
  `DocumentCenterSecureIntakeTest` ×1). Zero Commerce/Storefront-cart/checkout failures.
- **PostgreSQL** (post-merge, clean rebuild): 4043 passed, **35 failed** — identical baseline set,
  identical count. Zero Commerce/Storefront-cart/checkout failures.
- Verified identically on a pre-merge build first (Postgres: 4003 passed/35 failed; SQLite: 3961
  passed/42 skipped/35 failed) — a mid-task stale-build contamination (a `nibras-app` build
  created before switching to this branch, carrying unrelated `StorefrontProvisioning*` files from
  a different branch) was caught, the build was discarded and rebuilt clean from the correct
  branch, and every full-suite run reported above is from that clean rebuild.

## GitHub CI

Push: `7654430f9e9b394ae4420a8ca91c72da81934df9` (base auto-updated to `main`'s then-current tip,
`cf2ec737`, by GitHub after the merge commit was pushed).

Two workflow runs triggered (`push` + `pull_request` events, per `ci.yml`'s trigger config) — both
report the same 5 checks, all `completed`/`success`:

| Check | Run 35111746888 | Run 35111755331 |
|---|---|---|
| `php artisan test (L11, sqlite)` | ✅ success | ✅ success |
| `php artisan test (L11, pgsql)` | ✅ success | ✅ success |
| `web build (Next.js)` | ✅ success | — |

**SQLite status:** success (both runs). **PostgreSQL status:** success (both runs). **Other
checks:** `web build (Next.js)` success. No `Claude Approvals` check is configured on this
repository (not present in `get_check_runs`). `pull_request_read(get_status)` (commit statuses,
distinct from checks) returns 0 entries — no separate status-API gate either.

**Zero-failure confirmation on Final Head:** confirmed — all 5 check runs on `7654430f` report
`conclusion: success`.

## Review Threads

- **Original P1 ("Enforce the checkout-creation idempotency key"):** resolved. Replied explaining
  the fix closes the duplicate-order gap at the Cart-lifecycle level rather than by adding a
  creation-time `Idempotency-Key`, and that completion idempotency/replay is unaffected. Thread
  marked resolved.
- **Second P1 ("Allow changed carts to start another checkout"):** resolved. Replied with the
  full Cart One-Shot Lifecycle mechanism, confirming the exact scenario it reported (mutate/
  re-checkout the retained token after completion) is now rejected, and that a genuine repeat
  purchase works via a new Cart/token. Thread marked resolved.
- **P2 ("Include variant identity in completed-order items"):** left untouched, deferred, as
  instructed — no `serializeOrder()` change made.

## Documentation

**Files changed:**
- `docs/plans/commerce/AWJ_CHECKOUT_V1_ARCHITECTURE.md` — §9's critical-section line extended with
  "consume the cart"; new paragraph documenting the Cart One-Shot Lifecycle, why the old
  `createOrResume()` workaround is now a legacy-only fallback, and why completion replay still
  works after consumption.
- `docs/plans/commerce/PUBLIC_MOBILE_COMMERCE_API_V1_ARCHITECTURE.md` — corrected the "Idempotency-
  Key required on `POST checkout` and `POST checkout/complete`" claim (the exact contradiction the
  second P1 review comment cited) to match the real, now-final contract; updated the PR-4 slice
  description in the implementation-order section with a one-line pointer to the lifecycle
  follow-up.

**Final Idempotency contract (unified, matches implementation):** `Idempotency-Key` is required on
`POST checkout/complete` only, on both `/store/v1` and `/commerce/v1`. `POST checkout` carries no
`Idempotency-Key` of its own; it is naturally idempotent via resume-if-open for genuinely open
Checkouts, and duplicate-order prevention past that point is a Cart-lifecycle invariant (one Cart →
at most one Order), not a `POST checkout` idempotency mechanism.

## Merge Readiness

- **Current latest `main` used:** `cf2ec7373762b3711fb3e24f8c58784d2c578af2`
- **PR base:** `cf2ec7373762b3711fb3e24f8c58784d2c578af2` (in sync — merged cleanly, no conflicts)
- **Mergeable:** yes
- **`mergeable_state`:** `clean`
- **Risks/remaining:** none identified within this task's scope. The `createOrResume()` legacy
  fallback branch is intentionally left in place (documented, not deleted) as a safety net for
  pre-fix data; it is inert for any cart consumed through this fix. The P2 variant-identity gap in
  `serializeOrder()` remains open by design (explicitly out of scope).
- **Next step:** owner review and explicit merge approval.

---

# READY FOR OWNER MERGE APPROVAL

No merge, no deploy, no production release performed or requested by this task. Awaiting
Safwan's explicit approval per this task's standing instructions.
