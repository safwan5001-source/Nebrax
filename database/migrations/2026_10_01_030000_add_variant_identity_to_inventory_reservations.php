<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * VAR-COM-1 — هوية المتغيّر في حجز مخزون Commerce.
 *
 * بلا هذا العمود، حجزان لمتغيّرين شقيقين لنفس المنتج كانا سيتشاركان مفتاح
 * `(product_id, warehouse_id)` نفسه في `activeReservedQuantity()`، فيخصم
 * حجز متغيّرٍ من توفّر شقيقه خطأً — نفس عزل الشقيق الذي كرّسته
 * `product_warehouse_stock.product_variant_id` (VAR-INV-1) والمطلوب هنا
 * بالتناظر تماماً. `nullOnDelete` يطابق اختيار VAR-INV-1 على العمود
 * المناظر في `product_warehouse_stock` حرفياً.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inventory_reservations', function (Blueprint $table) {
            $table->foreignUuid('product_variant_id')->nullable()->after('product_id')
                ->constrained('product_variants')->nullOnDelete();
        });

        Schema::table('inventory_reservations', function (Blueprint $table) {
            $table->index(['tenant_id', 'product_variant_id', 'warehouse_id', 'status'], 'inventory_reservations_variant_ats_idx');
        });
    }

    public function down(): void
    {
        Schema::table('inventory_reservations', function (Blueprint $table) {
            $table->dropIndex('inventory_reservations_variant_ats_idx');
            $table->dropConstrainedForeignId('product_variant_id');
        });
    }
};
