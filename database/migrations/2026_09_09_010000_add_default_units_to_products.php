<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  PR-UOM2-1 — وحدة البيع/الشراء الافتراضية للمنتج
     * ═══════════════════════════════════════════════════════════════
     *  أول مهمّة تنفيذية في Phase 2A. المنتج اليوم يعرف وحدة أساسه
     *  (`Product.unit` = `UnitTemplate.base_unit`) ووحداته البديلة من القالب،
     *  لكن لا يعرف **أيّها يقترحه** عند البيع أو الشراء — فيضطر المستخدم إلى
     *  اختيار الوحدة يدوياً في كل سطر رغم أن الغالب ثابت لكل منتج.
     *
     *  **العمودان nullable عمداً، و`NULL` تعني «وحدة الأساس».** فكل صفٍّ قائم
     *  اليوم يبقى على سلوكه حرفياً بلا أي تعبئة رجعية: غياب الوحدة في سطر
     *  المستند ظلّ ولا يزال يُحَلّ إلى وحدة الأساس بمعامل ١ عبر
     *  `UnitConversion::resolve()`. لا يقرأ أي مسار مستندات هذين العمودين في
     *  هذه المهمّة (قرار المالك D-A: عرضٌ فقط، لا تطبيق تلقائي).
     *
     *  النوع `string` لا مفتاح أجنبي: الوحدة اسمٌ نصّي داخل القالب لا صفّ
     *  مستقلّ — نفس نمط `ProductBarcode.unit_name` و`PriceListItem.unit_name`
     *  و`StockPermitLine.unit_name`. صحّة الاسم تحرسها طبقة التحقق وحارس
     *  التعديل الدلالي في PR-UOM-1، لا قيدٌ في المخطط.
     */
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->string('default_sales_unit', 255)->nullable()->after('unit');
            $table->string('default_purchase_unit', 255)->nullable()->after('default_sales_unit');
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn(['default_sales_unit', 'default_purchase_unit']);
        });
    }
};
