<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Public/Mobile Commerce API V1 — PR-3 (Guest Cart). Makes
 * `commerce_carts.storefront_id` nullable — the single schema change
 * authorized by `docs/plans/commerce/PR3_GUEST_CART_ARCHITECTURE_RECONCILIATION.md`
 * (Option A), mirroring the identical, already-live pattern on
 * `commerce_orders.storefront_id` (migration
 * `2026_09_25_010000_add_checkout_linkage_to_commerce_orders.php`) and the
 * exact drop/change/re-add-FK mechanics already used in this repo for the
 * same kind of change (`2026_08_29_020000_nullable_tenant_on_platform_administrator_actions.php`).
 *
 * A Cart resolved through the mobile channel has no `Storefront` at all —
 * by design, `Storefront::booted()` structurally forbids a non-`web`
 * `SalesChannel` from ever owning one — so it has no legal value for this
 * column and stays `NULL`. A web-resolved Cart continues to always carry a
 * real `storefront_id`; that invariant is enforced at the service level
 * (`CommerceCartService::context()`), not by the database, matching the
 * `commerce_orders` precedent's own reasoning exactly.
 *
 * Purely a constraint relaxation: `restrictOnDelete()` behavior is
 * unchanged, no column is added/removed/renamed, and no existing row's
 * value is touched. SQLite/PostgreSQL both index/compare `NULL` in a
 * composite index identically for this purpose — no partial-index or
 * engine-specific handling is required.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_carts', function (Blueprint $table) {
            $table->dropForeign(['storefront_id']);
            $table->foreignUuid('storefront_id')->nullable()->change();
            $table->foreign('storefront_id')->references('id')->on('storefronts')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        // القيد التاريخي كان NOT NULL؛ التراجع يرفض إن وُجد صفٌّ جوّال حقيقي
        // بلا Storefront (لا قيمة نستنتجها له) بدل حذف/تلفيق بيانات صامتاً.
        if (DB::table('commerce_carts')->whereNull('storefront_id')->exists()) {
            throw new RuntimeException(
                'لا يمكن التراجع: توجد سلال (Cart) جوّال حقيقية بلا storefront_id — لا قيمة آمنة يمكن استنتاجها.'
            );
        }

        Schema::table('commerce_carts', function (Blueprint $table) {
            $table->dropForeign(['storefront_id']);
            $table->foreignUuid('storefront_id')->nullable(false)->change();
            $table->foreign('storefront_id')->references('id')->on('storefronts')->restrictOnDelete();
        });
    }
};
