<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Public/Mobile Commerce API V1 — PR-4 (Mobile Checkout). Makes
 * `commerce_checkouts.storefront_id` nullable — the identical, already-flagged
 * follow-up authorized by
 * `docs/plans/commerce/PR3_GUEST_CART_ARCHITECTURE_RECONCILIATION.md` (§"Checkout
 * Impact": "PR-4 (Checkout) will need the same two-part change"). Same
 * drop/change/re-add-FK mechanics as
 * `2026_10_02_010000_make_commerce_carts_storefront_id_nullable.php`, which
 * itself followed the repo's established precedent
 * (`2026_08_29_020000_nullable_tenant_on_platform_administrator_actions.php`).
 *
 * A Checkout resolved through the mobile channel has no `Storefront` at all —
 * same reasoning as Cart: `Storefront::booted()` structurally forbids a
 * non-`web` `SalesChannel` from ever owning one, so it has no legal value
 * for this column and stays `NULL`. A web-resolved Checkout continues to
 * always carry a real `storefront_id`; that invariant is enforced at the
 * service level (`CommerceCheckoutService::context()`), not by the
 * database, matching the Cart precedent exactly.
 *
 * Purely a constraint relaxation: `restrictOnDelete()` behavior is
 * unchanged, no column is added/removed/renamed, and no existing row's
 * value is touched.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_checkouts', function (Blueprint $table) {
            $table->dropForeign(['storefront_id']);
            $table->foreignUuid('storefront_id')->nullable()->change();
            $table->foreign('storefront_id')->references('id')->on('storefronts')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        // القيد التاريخي كان NOT NULL؛ التراجع يرفض إن وُجد صفٌّ جوّال حقيقي
        // بلا Storefront (لا قيمة نستنتجها له) بدل حذف/تلفيق بيانات صامتاً.
        if (DB::table('commerce_checkouts')->whereNull('storefront_id')->exists()) {
            throw new RuntimeException(
                'لا يمكن التراجع: توجد جلسات دفع (Checkout) جوّال حقيقية بلا storefront_id — لا قيمة آمنة يمكن استنتاجها.'
            );
        }

        Schema::table('commerce_checkouts', function (Blueprint $table) {
            $table->dropForeign(['storefront_id']);
            $table->foreignUuid('storefront_id')->nullable(false)->change();
            $table->foreign('storefront_id')->references('id')->on('storefronts')->restrictOnDelete();
        });
    }
};
