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
 * `nullOnDelete()`, not `restrictOnDelete()` like the order column: a cart
 * is ephemeral, server-authoritative, never-a-financial-document state
 * (`CommerceCart`'s own docblock), unlike a confirmed order's historical
 * record — nulling an orphaned cart's ownership on identity deletion is
 * safe and does not erase anything that must remain explainable.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_carts', function (Blueprint $table) {
            $table->uuid('customer_identity_id')->nullable()->after('sales_channel_id');

            $table->foreign(['tenant_id', 'customer_identity_id'], 'commerce_carts_customer_identity_fk')
                ->references(['tenant_id', 'id'])->on('customer_identities')->nullOnDelete();

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
