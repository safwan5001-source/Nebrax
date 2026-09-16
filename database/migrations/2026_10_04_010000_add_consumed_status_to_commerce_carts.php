<?php

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
 */
return new class extends Migration
{
    private const CONSTRAINT = 'commerce_carts_status_check';

    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('ALTER TABLE commerce_carts DROP CONSTRAINT '.self::CONSTRAINT);
        DB::statement(
            'ALTER TABLE commerce_carts ADD CONSTRAINT '.self::CONSTRAINT.
            " CHECK (status IN ('active', 'expired', 'consumed'))"
        );
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
