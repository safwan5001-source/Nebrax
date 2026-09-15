<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * VAR-COM-1 — هوية المتغيّر ولقطته التاريخية في سطر طلب Commerce.
 *
 * نفس نمط الأعمدة التي أضافتها VAR-DOC-1 إلى الثماني سطور المصنَّفة
 * `BUSINESS_HISTORICAL` الأخرى (`invoice_lines` وغيرها): `product_variant_id`
 * اختياري (`nullOnDelete` — الحماية الحقيقية ضد الحذف الصلب تعيش في
 * `ProductReferenceRegistry::variantScopedBusinessDocumentLines()`، لا في
 * قيد قاعدة البيانات وحده) + `variant_descriptor_snapshot` نصّي حتمي لا
 * يُعاد اشتقاقه من متغيّرٍ حيّ لاحقاً.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_order_lines', function (Blueprint $table) {
            $table->foreignUuid('product_variant_id')->nullable()->after('product_id')
                ->constrained('product_variants')->nullOnDelete();
            $table->string('variant_descriptor_snapshot')->nullable()->after('product_name_snapshot');
        });
    }

    public function down(): void
    {
        Schema::table('commerce_order_lines', function (Blueprint $table) {
            $table->dropColumn('variant_descriptor_snapshot');
            $table->dropConstrainedForeignId('product_variant_id');
        });
    }
};
