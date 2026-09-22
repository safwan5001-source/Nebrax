<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COM-MOBILE-ADDRESSES-1 (ADR-08) — closes the discovered gap in
 * `commerce_checkouts`' own delivery-address contract: `building_no` (and,
 * for genuine Saudi National Address support, `additional_number`) were
 * never collectible at checkout time at all — `CommerceCheckoutController::
 * updateAddress()`'s accepted fields were `country, region, city, district,
 * street, postal_code, notes` only, even though `CommerceOrderSnapshot`
 * already has a `shipping_building_no`/`billing_building_no` column that
 * `CommerceOrderService::createFromCheckout()`'s header→snapshot mapping
 * silently never populated. Both gaps are closed together in this task
 * (see `CommerceCheckoutController`/`CommerceOrderService` changes) since
 * a National-Address-aware saved address book would otherwise still
 * produce an incomplete order snapshot end-to-end.
 *
 * Purely additive, nullable columns — no historical checkout/order/
 * snapshot row is touched or reinterpreted.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_checkouts', function (Blueprint $table) {
            $table->string('delivery_building_no')->nullable()->after('delivery_street');
            $table->string('delivery_additional_number')->nullable()->after('delivery_building_no');
        });
    }

    public function down(): void
    {
        Schema::table('commerce_checkouts', function (Blueprint $table) {
            $table->dropColumn(['delivery_building_no', 'delivery_additional_number']);
        });
    }
};
