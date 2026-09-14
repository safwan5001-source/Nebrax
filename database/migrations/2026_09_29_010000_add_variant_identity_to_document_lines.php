<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * VAR-DOC-1 — يضيف الهويّة القابلة للبيع (المتغيّر) إلى كل سطر مستندٍ تجاري
 * حقيقي (`BUSINESS_HISTORICAL` في `ProductReferenceRegistry`)، بنفس مبدأ
 * VAR-CORE-1 حرفياً: `product_id` يبقى المنتج الأب دائماً، و`product_variant_id`
 * الجديد اختياريٌّ يحمل المتغيّر الفعلي فقط حين يكون المنتج متعدد الخيارات.
 *
 * `variant_descriptor_snapshot` لقطةٌ نصّية حتمية لتركيبة المتغيّر وقت إنشاء
 * السطر (مثل «أسود / كبير») — لا تُشتقّ مجدداً من المتغيّر الحيّ عند عرض مستندٍ
 * تاريخي، تماماً كنمط `product_name_snapshot`/`unit_name` القائم على هذه
 * الجداول نفسها. الأعمدة الأخرى (اسم/SKU/باركود) تبقى كما هي: `description`
 * على كل هذه الجداول يخدم دور لقطة الاسم فعلياً (`?? $product?->name`)، فلا
 * دعمَ جديداً يُضاف حيث لا يوجد أصلاً — العقد نفسه يكتفي بـ«حيثما يدعم
 * النموذج الحالي ذلك».
 *
 * `nullOnDelete()` يطابق سلوك `product_id` القائم حرفياً على هذه الجداول
 * نفسها (@see 2025_01_01_000004_create_invoices.php) — شبكة أمانٍ على مستوى
 * القاعدة لا الحارس الفعلي؛ الحارس الحقيقي فعليّاً في
 * `ProductVariantService::deleteVariant()` الذي يرفض حذف أي متغيّرٍ يحمل
 * مرجعاً في أيٍّ من هذه الجداول **قبل** وصول أي طلب حذفٍ إلى القاعدة أصلاً.
 */
return new class extends Migration
{
    private const TABLES = [
        'invoice_lines',
        'purchase_lines',
        'return_lines',
        'credit_note_lines',
        'quote_lines',
        'recurring_invoice_lines',
        'procurement_lines',
        'delivery_note_lines',
    ];

    public function up(): void
    {
        foreach (self::TABLES as $table) {
            Schema::table($table, function (Blueprint $table) {
                $table->uuid('product_variant_id')->nullable()->after('product_id');
                $table->string('variant_descriptor_snapshot')->nullable();
                $table->foreign('product_variant_id')->references('id')->on('product_variants')->nullOnDelete();
                $table->index('product_variant_id');
            });
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $table) {
            Schema::table($table, function (Blueprint $table) {
                $table->dropForeign(['product_variant_id']);
                $table->dropIndex(['product_variant_id']);
                $table->dropColumn(['product_variant_id', 'variant_descriptor_snapshot']);
            });
        }
    }
};
