<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * COM-MOBILE-ADDRESSES-1 (ADR-08), round 3 (Codex) — the address book and
 * checkout both carry a `region` field (`commerce_customer_addresses.region`,
 * `commerce_checkouts.delivery_region`), but the order snapshot never had a
 * column to receive it, so selecting a saved address with a region silently
 * dropped that part of it from the immutable order record at completion.
 * Purely additive, nullable — no historical (confirmed) snapshot row is
 * touched; the `CommerceOrderSnapshot::booted()` immutability guard is
 * unaffected.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_order_snapshots', function (Blueprint $table) {
            $table->string('shipping_region')->nullable()->after('shipping_country');
            $table->string('billing_region')->nullable()->after('billing_country');
        });
    }

    public function down(): void
    {
        Schema::table('commerce_order_snapshots', function (Blueprint $table) {
            $table->dropColumn(['shipping_region', 'billing_region']);
        });
    }
};
