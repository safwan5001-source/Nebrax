<?php

use App\Models\CommerceCart;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Cart One-Shot Lifecycle (PR-4 follow-up). Adds `consumed` as a legal
 * `commerce_carts.status` value — the terminal state a Cart enters the
 * moment `CommerceCheckoutService::complete()` creates its `CommerceOrder`
 * (same transaction, `CommerceCart::STATUS_CONSUMED`). One Cart now backs
 * at most one successful Order; a repeat purchase always starts from a new
 * Cart/token, never a reused one — see `CommerceCartService`/
 * `CommerceCheckoutService` for the enforcement.
 *
 * **Representation differs by engine, verified against the actual schema
 * before writing this migration (not assumed):**
 * - **SQLite**: `status` is a plain `varchar NOT NULL DEFAULT 'active'`
 *   column with **no CHECK constraint at all** — Laravel's SQLite grammar
 *   does not emit one for `enum()`. `sqlite_master` for this table carries
 *   no `check` clause. Nothing to alter here, and therefore no table
 *   rebuild — the historical loss-of-CHECK-constraint-on-rebuild failure
 *   mode this repo has hit before does not apply because there is no
 *   rebuild.
 * - **PostgreSQL**: `status` is `varchar(255)` with a named CHECK
 *   constraint `commerce_carts_status_check` =
 *   `CHECK (status IN ('active','expired'))` (confirmed via
 *   `pg_get_constraintdef`) — not a native `ENUM` type. Widening it is a
 *   plain `DROP CONSTRAINT` + `ADD CONSTRAINT` with the same name and the
 *   value list extended; no column type change, no data touched.
 *
 * Columns, defaults, nullability, PK, FKs (`tenant_id`/`storefront_id`/
 * `sales_channel_id` — all `RESTRICT`/`CASCADE` as before), the composite
 * index, and the `token_hash` unique constraint are all untouched by
 * either branch.
 *
 * **Backfill (P1 review follow-up)**: widening the constraint alone left
 * every pre-existing row `active`, including Carts that had already backed
 * a real `CommerceOrder` before this migration ever ran — the exact
 * `active`-Cart-with-a-completed-purchase state the lifecycle above exists
 * to prevent going forward. `up()` closes that gap for historical data in
 * the same migration, using `commerce_orders` — not `commerce_checkouts.
 * status` — as the authoritative signal: `commerce_orders.
 * commerce_checkout_id` is nullable **and unique**
 * (`commerce_orders_checkout_id_unique`,
 * `2026_09_25_010000_add_checkout_linkage_to_commerce_orders`), written
 * only by `CommerceOrderService::createFromCheckout()`, called only from
 * `CommerceCheckoutService::complete()` inside one transaction that also
 * creates the order's lines/snapshot and flips it to `confirmed` before
 * commit — no code path ever leaves a `commerce_orders` row visible at
 * `draft`. A `commerce_orders` row pointing at a Cart's Checkout is
 * therefore direct, first-hand proof of a successful purchase, strictly
 * stronger than trusting `commerce_checkouts.status = 'completed'` alone
 * (which the same transaction also sets, but which is one hop further from
 * the actual commercial commitment). Only currently-`active` Carts are
 * touched — `expired` is left alone unconditionally, matching the
 * lifecycle's own "one Cart, at most one Order" contract without
 * reinterpreting what `expired` means. The join is written as an explicit
 * `tenant_id`-matched `EXISTS` (no reliance on `TenantScope`, which does
 * not apply inside a migration's raw `DB::table()` queries, or on any
 * client-controlled context) via Laravel's portable query builder — no
 * dialect-specific SQL, works identically on SQLite and PostgreSQL.
 */
return new class extends Migration
{
    private const CONSTRAINT = 'commerce_carts_status_check';

    public function up(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE commerce_carts DROP CONSTRAINT '.self::CONSTRAINT);
            DB::statement(
                'ALTER TABLE commerce_carts ADD CONSTRAINT '.self::CONSTRAINT.
                " CHECK (status IN ('active', 'expired', 'consumed'))"
            );
        }

        $this->backfillConsumedCarts();
    }

    /**
     * Flips an `active` Cart to `consumed` only when a `commerce_orders` row
     * proves — via the same tenant, through its Checkout — that this exact
     * Cart already backed a successful purchase. Idempotent: safe to run
     * more than once, and a no-op on a database with no such rows yet.
     */
    private function backfillConsumedCarts(): void
    {
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
    }

    /**
     * Fail-closed: a `consumed` Cart records that a real purchase happened
     * through it. Rolling the constraint back while such a row exists would
     * either leave data violating the restored CHECK (PostgreSQL rejects
     * that outright) or require silently rewriting/deleting the row — both
     * unacceptable. Refuse instead; nothing is modified or deleted.
     */
    public function down(): void
    {
        if (DB::table('commerce_carts')->where('status', 'consumed')->exists()) {
            throw new RuntimeException(
                'لا يمكن التراجع: توجد سلال (Cart) بحالة consumed — التراجع كان سيُسقط قيداً تاريخياً على بياناتٍ حقيقية.'
            );
        }

        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('ALTER TABLE commerce_carts DROP CONSTRAINT '.self::CONSTRAINT);
        DB::statement(
            'ALTER TABLE commerce_carts ADD CONSTRAINT '.self::CONSTRAINT.
            " CHECK (status IN ('active', 'expired'))"
        );
    }
};
