<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COM-MOBILE-CART-IDENTITY-1 (ADR-07) — cart ownership only. Mirrors the
 * exact pattern already used for `commerce_orders.customer_identity_id`
 * (`2026_09_18_010000_add_customer_identity_to_commerce_orders.php`):
 * nullable, composite tenant-scoped FK against `customer_identities`'
 * existing `(tenant_id, id)` unique index — a cross-tenant identity is
 * rejected at the database level, not only in application code.
 *
 * `restrictOnDelete()`, matching the order column after all (Codex, PR #924,
 * P2): this FK is composite — `ON DELETE SET NULL` on a composite key nulls
 * *every* referencing column, including `tenant_id`, which is `NOT NULL` on
 * `commerce_carts`. Force-deleting a referenced `CustomerIdentity` would
 * therefore fail on a not-null violation instead of the intended "orphan the
 * ephemeral cart" — there is no database-level way to null one column of a
 * composite FK while leaving another intact. Restricting keeps the
 * cross-tenant-identity-rejected-at-the-database-level guarantee this FK
 * exists for; it only means a hard delete of a `CustomerIdentity` still
 * owning a cart must clean up (or reassign) that cart first — unreachable in
 * practice today since `CustomerIdentity` uses `SoftDeletes` and nothing
 * force-deletes it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_carts', function (Blueprint $table) {
            $table->uuid('customer_identity_id')->nullable()->after('sales_channel_id');

            $table->foreign(['tenant_id', 'customer_identity_id'], 'commerce_carts_customer_identity_fk')
                ->references(['tenant_id', 'id'])->on('customer_identities')->restrictOnDelete();

            $table->index(['tenant_id', 'customer_identity_id', 'status'], 'commerce_carts_tenant_customer_status_index');
        });
    }

    public function down(): void
    {
        Schema::table('commerce_carts', function (Blueprint $table) {
            $table->dropForeign('commerce_carts_customer_identity_fk');
            $table->dropIndex('commerce_carts_tenant_customer_status_index');
            $table->dropColumn('customer_identity_id');
        });
    }
};
