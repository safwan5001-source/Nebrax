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
 *
 * (Codex, PR #924, P1, ninth round) Scoped by `sales_channel_id`: every
 * cart lookup in `CommerceCartService` (`scopeToContext()`) already treats
 * "the customer's active cart" as per-channel, not per-tenant — a tenant
 * can have more than one mobile `SalesChannel` (a second app, an
 * environment, a channel migration), and the application code already
 * allows a customer to hold separate active carts across them. Without
 * `sales_channel_id` here, this tenant-wide index rejected the second
 * channel's first cart with a raw constraint-violation 500 as long as the
 * old channel's cart hadn't yet expired. `sales_channel_id` is never
 * nullable (unlike `storefront_id`, deliberately excluded: NULL never
 * equals NULL in a unique index, so including it would silently disable
 * this guarantee entirely for mobile, which never sets it).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(
            'CREATE UNIQUE INDEX commerce_carts_one_active_per_customer '
            . 'ON commerce_carts (tenant_id, sales_channel_id, customer_identity_id) '
            . "WHERE status = 'active' AND customer_identity_id IS NOT NULL"
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS commerce_carts_one_active_per_customer');
    }
};
