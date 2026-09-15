<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * VAR-DOC-1 — `applyReceipt()`/`applyIssue()` (VAR-INV-1) يحلّان هويّة
 * المخزون (منتجٌ بسيط أو متغيّرٌ فعلي بعينه) ويحسبان الأرقام عليها فعلاً
 * منذ ذلك العقد، لكن صفّ `StockMovement` نفسه لم يكن يسجّل **أيّ متغيّرٍ**
 * كانت الحركة له — فتبقى الحركة تاريخياً غامضة الهويّة لمنتجٍ متعدد
 * الخيارات رغم صحة الأرقام. هذا العمود توثيقٌ إضافيّ لا تغييرٌ في خوارزمية
 * المتوسط المتحرك ولا في `InventoryState` سلطتها الوحيدة على الرصيد.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->uuid('product_variant_id')->nullable()->after('product_id');
            $table->foreign('product_variant_id')->references('id')->on('product_variants')->nullOnDelete();
            $table->index('product_variant_id');
        });
    }

    public function down(): void
    {
        Schema::table('stock_movements', function (Blueprint $table) {
            $table->dropForeign(['product_variant_id']);
            $table->dropIndex(['product_variant_id']);
            $table->dropColumn('product_variant_id');
        });
    }
};
