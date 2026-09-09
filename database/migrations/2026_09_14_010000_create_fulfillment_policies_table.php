<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * PR-COM-2B — سياسة تنفيذ Commerce (ADR-03): تربط قناة بيع بمخزن تنفيذ واحد
 * ثابت. جدولٌ إضافي بحت — لا `sales_channels`/`warehouses` يتغيّران.
 *
 * V1 = Fixed Warehouse فقط، فلا عمود `strategy`: الشكل الوحيد الممكن اليوم
 * هو هذا الجدول نفسه (سياسة واحدة = مخزنٌ واحد صريح). عمود تمييز استراتيجية
 * بقيمة محتملة وحيدة اليوم هو بالضبط «future-proofing بلا حاجة مثبتة» الذي
 * حذّر منه العقد — سياسة استراتيجية أخرى لاحقاً (PRIORITY_LOCATIONS) تضيف
 * عمودها وقتها بترحيلٍ إضافي، كما تُوسَّع أي enum آخر في هذا المستودع.
 *
 * `unique('sales_channel_id')`: **صفر أو سياسة واحدة** لكل قناة — لا قائمة
 * سياسات، لا أولوية، لا تاريخ. يمنع القيد نفسه ازدواج «سياستان فعّالتان لقناة
 * واحدة» بنيوياً، لا بفحصٍ في التطبيق وحده.
 *
 * الحذف: `cascadeOnDelete()` على كلا المرجعين — لأن هذا الجدول **تهيئة
 * حالية لا سجلّ تدقيق** (بخلاف `inventory_reservations` الذي اختار
 * `restrictOnDelete()` عمداً لأنه سجلّ تاريخي يجب أن يبقى مفسَّراً). سياسة
 * تشير إلى قناة أو مخزن محذوفَين بلا معنى؛ نفس منطق تراجُع
 * `product_warehouse_stock` مع حذف مخزنه.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fulfillment_policies', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();
            $table->foreignUuid('warehouse_id')->constrained('warehouses')->cascadeOnDelete();
            $table->timestamps();

            $table->unique('sales_channel_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fulfillment_policies');
    }
};
