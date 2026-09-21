<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * COM-MOBILE-CART-IDENTITY-1 (ADR-07) — PR #924 review fix (Codex P1): a
 * database-level backstop for "at most one active cart per customer",
 * matching the codebase's established partial-unique-index pattern (see
 * `customer_partner_links_one_active_per_identity`). `CommerceCartService`
 * already serializes first-cart creation by locking the customer's own
 * `CustomerIdentity` row before checking for/creating a cart — this index
 * is the guarantee under any isolation level or code path that skips that
 * lock, not the primary defense.
 *
 * `customer_identity_id IS NOT NULL` keeps guest carts (always null)
 * completely unaffected — a guest may still hold any number of active
 * carts, exactly as before this task.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(
            'CREATE UNIQUE INDEX commerce_carts_one_active_per_customer '
            . 'ON commerce_carts (tenant_id, customer_identity_id) '
            . "WHERE status = 'active' AND customer_identity_id IS NOT NULL"
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS commerce_carts_one_active_per_customer');
    }
};
