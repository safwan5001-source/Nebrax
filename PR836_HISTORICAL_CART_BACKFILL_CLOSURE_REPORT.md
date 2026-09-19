# PR #836 — Historical Cart Backfill P1 Closure Report

**Status: READY FOR OWNER MERGE APPROVAL**

## Root Cause

`2026_10_04_010000_add_consumed_status_to_commerce_carts` (the Cart One-Shot Lifecycle migration)
widened `commerce_carts.status` to accept `consumed` but only affected the constraint — every
pre-existing row stayed `active`, including Carts that had already backed a real `CommerceOrder`
*before* that migration ever ran. Those Carts' retained tokens stayed mutable, and
`createOrResume()` would permanently resume their old completed Checkout instead of ever allowing
a genuine new purchase — precisely the `active`-Cart-with-a-completed-purchase state the lifecycle
exists to prevent going forward, just left standing for historical data.

## Authoritative Historical-Consumption Invariant

**Not** `commerce_checkouts.status = 'completed'` alone. The authoritative, direct signal is the
existence of a `commerce_orders` row pointing at the Cart's Checkout:

- `commerce_orders.commerce_checkout_id` is nullable **and unique**
  (`commerce_orders_checkout_id_unique`, added by
  `2026_09_25_010000_add_checkout_linkage_to_commerce_orders`).
- It is written **only** by `CommerceOrderService::createFromCheckout()`, called **only** from
  `CommerceCheckoutService::complete()`, inside one transaction that also creates the order's
  lines and snapshot and flips its status from `draft` to `confirmed` before commit. No code path
  in this codebase ever leaves a `commerce_orders` row visible at rest with `status = 'draft'`.
- A `commerce_orders` row referencing a Checkout is therefore first-hand, direct proof that a
  purchase through that Checkout's Cart actually completed — one hop closer to the real
  commercial commitment than trusting the Checkout's own status flag.

## Exact Backfill Query/Logic

Added to the same migration's `up()`, after the PostgreSQL CHECK constraint is widened (so the
`UPDATE` always satisfies the currently-active constraint on both engines):

```php
DB::table('commerce_carts')
    ->where('status', CommerceCart::STATUS_ACTIVE)
    ->whereExists(function ($query) {
        $query->select(DB::raw(1))
            ->from('commerce_checkouts')
            ->join('commerce_orders', function ($join) {
                $join->on('commerce_orders.commerce_checkout_id', '=', 'commerce_checkouts.id')
                    ->on('commerce_orders.tenant_id', '=', 'commerce_checkouts.tenant_id');
            })
            ->whereColumn('commerce_checkouts.cart_id', 'commerce_carts.id')
            ->whereColumn('commerce_checkouts.tenant_id', 'commerce_carts.tenant_id');
    })
    ->update(['status' => CommerceCart::STATUS_CONSUMED]);
```

Pure Laravel query builder — no raw/dialect-specific SQL — so it runs identically on SQLite and
PostgreSQL. Idempotent: re-running `up()` is a no-op on rows already `consumed` (the `WHERE status
= 'active'` guard excludes them).

## Why It Is Tenant-Safe

The `cart_id` foreign key on `commerce_checkouts` has no same-tenant clause — nothing in the
schema itself forbids a (buggy or malicious) row where `commerce_checkouts.tenant_id` differs from
the Cart it points `cart_id` at. `TenantScope` (Eloquent's global tenant scope) does not apply
inside a migration's raw `DB::table()` queries, so it cannot be relied on either. The backfill
therefore ties tenant identity explicitly at every join step:

1. `commerce_orders.tenant_id = commerce_checkouts.tenant_id` (the `join ... on`)
2. `commerce_checkouts.tenant_id = commerce_carts.tenant_id` (the second `whereColumn`)

Only when **all three rows** agree on the same `tenant_id`, in addition to the `cart_id`/
`commerce_checkout_id` linkage, does a Cart get backfilled. No client-controlled context (headers,
cookies, tokens) is read anywhere in this logic — it is a pure, fail-closed database-level join.

Proven directly by `cross_tenant_checkout_and_order_data_never_backfills_another_tenants_cart`:
a Checkout/Order pair is constructed with tenant B's `tenant_id` but `cart_id` pointing at tenant
A's Cart (a shape the FK alone permits) — the test asserts tenant A's Cart is **not** flipped to
`consumed`.

## Existing Rows Affected

Any pre-existing row where `commerce_carts.status = 'active'` **and** a `commerce_orders` row
exists, in the same tenant, referencing a `commerce_checkouts` row whose `cart_id` points at that
Cart. On a fresh test database (and on this PR's own CI runs, which always start from
`migrate:fresh`) there are no such rows, so the backfill is a verified no-op in every CI run — its
correctness is established entirely through the dedicated migration tests below, which construct
the historical-data shapes directly.

## Existing Rows Intentionally NOT Affected

- **`expired` Carts** — left alone unconditionally, regardless of any Checkout/Order linkage
  (`a_historical_expired_cart_stays_expired_even_with_a_completed_checkout_and_order` gives an
  `expired` Cart a completed Checkout + Order and confirms it stays `expired`). The lifecycle only
  ever transitions `active → consumed`; `expired` keeps its own separate meaning.
- **`active` Carts with an open/incomplete Checkout and no Order** — stay `active`
  (`a_historical_active_cart_with_an_open_checkout_and_no_order_stays_active`).
- **`active` Carts with no Checkout or Order at all** — stay `active`
  (`a_historical_active_cart_with_no_checkout_or_order_stays_active`).
- **Any Cart in a different tenant than its would-be proof** — see tenant-safety section above.
- No other column on any of the three tables (`tenant_id`, `sales_channel_id`, `storefront_id`,
  `token_hash`, `expires_at`, etc.) is touched by this migration; only `commerce_carts.status` on
  the matched rows.

## SQLite Migration Behavior

No CHECK constraint exists on `commerce_carts.status` in SQLite (confirmed against the live
schema, unchanged from the original migration's analysis) — the constraint-widening block is
skipped entirely (`if (DB::getDriverName() === 'pgsql')`), and the backfill `UPDATE` runs directly
via the portable query builder. No table rebuild, no risk to any existing constraint/index.

## PostgreSQL Migration Behavior

The CHECK constraint (`commerce_carts_status_check`) is dropped and re-added with `consumed`
included **before** the backfill runs, so the backfill's `UPDATE ... SET status = 'consumed'`
always satisfies the constraint in effect at the time it executes. No column type change, no
native `ENUM`, no destructive conversion — same `DROP CONSTRAINT` + `ADD CONSTRAINT` mechanics as
the original (pre-backfill) version of this migration.

## Rollback Behavior

Unchanged from the original migration, and it already fully covers backfilled rows: `down()`
checks for **any** row with `status = 'consumed'` — normally-consumed or backfilled, the query
cannot and does not distinguish — and throws a `RuntimeException` before touching anything if one
exists. No `consumed → active`/`expired` rewrite, no row deletion, ever. Proven directly by
`down_refuses_after_a_real_backfill_produced_consumed_rows`: runs `up()` (which backfills a real
row via the Checkout/Order evidence), then confirms `down()` refuses and the row is unchanged
afterward.

## Changed Files

- `database/migrations/2026_10_04_010000_add_consumed_status_to_commerce_carts.php` — added
  `backfillConsumedCarts()`, called from `up()`; imported `App\Models\CommerceCart` for its status
  constants; extended the class doc-block with the backfill rationale. `down()` unchanged.
- `tests/Feature/CommerceCartConsumedStatusMigrationTest.php` — 6 new test methods (below), 3 new
  model imports/helpers (`makeCheckout()`, `makeOrder()`).

No other file touched for this fix — no controller, service, route, or `CommerceOrder`/
`CommerceCheckout` schema change.

## Tests Added

1. `a_historical_active_cart_with_a_completed_checkout_and_order_is_backfilled_to_consumed` (A)
2. `a_historical_active_cart_with_an_open_checkout_and_no_order_stays_active` (B)
3. `a_historical_active_cart_with_no_checkout_or_order_stays_active` (C)
4. `a_historical_expired_cart_stays_expired_even_with_a_completed_checkout_and_order` (D)
5. `cross_tenant_checkout_and_order_data_never_backfills_another_tenants_cart` (E)
6. `down_refuses_after_a_real_backfill_produced_consumed_rows` (F)

## SQLite Targeted Results

`CommerceCartConsumedStatusMigrationTest` (13 tests, including the 6 new + the 7 pre-existing from
the original migration's own test suite): **13 passed** (1 PostgreSQL-only test correctly skipped
with an explicit reason on SQLite).

## PostgreSQL Targeted Results

`CommerceCartConsumedStatusMigrationTest`: **13 passed** (all, including the PostgreSQL-only CHECK
constraint test). Full targeted Commerce/`/store/v1` regression suite (`CommerceCheckoutApiTest`,
`CommerceCartApiTest`, `CommerceModuleBoundaryTest`, `CommerceApiFoundationTest`,
`CommerceCatalogApiTest`, `MobileSalesChannelResolverTest`, `StorefrontCheckoutApiTest`,
`StorefrontCheckoutCompletionApiTest`, `StorefrontCheckoutPostgresConcurrencyTest`,
`StorefrontCheckoutCompletionPostgresConcurrencyTest`, `StorefrontCartApiTest`,
`StorefrontCartPostgresConcurrencyTest`, `StorefrontCatalogApiTest`,
`StorefrontDomainResolutionApiTest`, `PublicApiAuthTest`, `SalesChannelTest`,
`CommerceCartOneShotLifecycleTest`, `CommerceCartConsumedStatusMigrationTest`): **220 passed, 0
failed** — the full Cart One-Shot Lifecycle invariant suite re-verified unchanged (successful
completion consumes atomically, consumed Cart rejects mutations/new Checkout, replay/conflict
semantics intact, purchase-again via new Cart/token, web/mobile parity, tenant/channel/storefront
isolation).

## PostgreSQL Concurrency Results

`StorefrontCheckoutPostgresConcurrencyTest` and `StorefrontCheckoutCompletionPostgresConcurrencyTest`
(the real fork-based row-lock tests from the earlier Cart One-Shot Lifecycle work) re-run and green
— unaffected by this backfill fix, since the backfill only runs once at migration time, not on any
request path. Not replaced or simulated with SQLite.

## Full-Suite Results / Baseline Comparison

Run on a clean rebuild of the merged branch (post-`origin/main` sync), on both engines:

- **PostgreSQL:** 4084 passed, **35 failed** — the documented pre-existing baseline only
  (`Fuel*`/ext-bcmath ×26, `AuthRecoveryTest` ×8, `DocumentCenterSecureIntakeTest` ×1). Zero
  Commerce/Storefront-cart/checkout failures.
- **SQLite:** 4041 passed, 43 skipped, **35 failed** — identical baseline set, identical count.
  Zero Commerce/Storefront-cart/checkout failures.

Both runs match the baseline established in the prior Cart One-Shot Lifecycle closure report
exactly (same 35 test names), confirming this backfill introduced zero new failures on either
engine.

## GitHub CI

Push: `838e9a55206c02b28d418bd8c3a2cf34553a0448`. Two workflow runs triggered (`push` +
`pull_request`), all 5 checks `completed`/`success`:

| Check | Run 35189410805/35189410820 | Run 35189413637 |
|---|---|---|
| `php artisan test (L11, sqlite)` | ✅ success | ✅ success |
| `php artisan test (L11, pgsql)` | ✅ success | ✅ success |
| `web build (Next.js)` | ✅ success | — |

No `Claude Approvals` check is configured on this repository. `pull_request_read(get_status)`
returns 0 status-API entries — no separate status gate.

## P1 Thread Status

**"Backfill carts for already-completed checkouts"** — resolved. Replied with the invariant used
(direct `CommerceOrder` existence, not `checkout.status`), the exact query, the tenant-safety
mechanism and its dedicated test, the SQLite/PostgreSQL coverage, and the full test/CI results.
Thread marked resolved on GitHub.

The two earlier P1 threads (duplicate-order idempotency; "allow changed carts to start another
checkout") were already resolved by the prior Cart One-Shot Lifecycle work and remain resolved —
untouched by this task.

## P2 Status

**"Include variant identity in completed-order items"** — left untouched, deferred, as instructed.
No change to `serializeOrder()` or any variant serialization.

## SHAs

- **Latest `main` used:** `69707de3ca836363159f96ce85c9c8643f7c5385`
- **Base SHA (PR base, post-sync):** `69707de3ca836363159f96ce85c9c8643f7c5385`
- **Previous Head SHA:** `c14bd00685fb2b633cc6c02d94b45f15025b0b63`
- **New Head SHA:** `838e9a55206c02b28d418bd8c3a2cf34553a0448`

Two commits added on top of the previous head: the backfill fix itself
(`112984c8`), and a clean merge of `origin/main` (`838e9a55`) — the merge introduced no conflicts;
`origin/main`'s new commits since the previous sync (`#843`–`#848`: Store Identity Settings, Media/
Publication workspace, Options & Variants workspace, tenant-provisioning lifecycle fixes) touch
only Storefront-workspace/product-UX/auth-registration code, none of `CommerceCart`,
`CommerceCheckout`, `CommerceOrder`, `SalesChannel`, or any Commerce-related migration.

## Merge Readiness

- **Mergeable:** yes
- **`mergeable_state`:** `clean`
- **Risks/remaining:** none identified within this task's scope. The backfill is a one-time,
  idempotent, fail-safe `UPDATE` guarded by an authoritative, tenant-matched `EXISTS` join; it
  cannot mutate a row twice or touch a row it cannot prove was consumed. The P2 variant-identity
  gap remains open by design (explicitly out of scope). No schema beyond this migration's existing
  authorization (widening `commerce_carts.status`) was touched.
- **Next step:** owner review and explicit merge approval.

---

# READY FOR OWNER MERGE APPROVAL

No merge, no deploy, no production release performed or requested by this task.
