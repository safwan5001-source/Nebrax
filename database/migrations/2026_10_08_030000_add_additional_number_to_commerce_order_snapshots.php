<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COM-MOBILE-ADDRESSES-1 (ADR-08) — companion to
 * `2026_10_08_020000_add_building_no_to_commerce_checkouts.php`: since that
 * migration makes `additional_number` collectible at checkout time (Saudi
 * National Address support), the historical snapshot must be able to carry
 * it too, alongside the pre-existing `building_no` propagation fix — an
 * order snapshot capturing `building_no` but silently dropping
 * `additional_number` would be a half-closed gap. Purely additive,
 * nullable — no historical (confirmed) snapshot row is touched; the
 * `CommerceOrderSnapshot::booted()` immutability guard is unaffected.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_order_snapshots', function (Blueprint $table) {
            $table->string('shipping_additional_number')->nullable()->after('shipping_building_no');
            $table->string('billing_additional_number')->nullable()->after('billing_building_no');
        });
    }

    public function down(): void
    {
        Schema::table('commerce_order_snapshots', function (Blueprint $table) {
            $table->dropColumn(['shipping_additional_number', 'billing_additional_number']);
        });
    }
};
