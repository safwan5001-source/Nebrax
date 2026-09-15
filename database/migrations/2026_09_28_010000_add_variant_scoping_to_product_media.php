<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * VAR-MEDIA-1 — امتداد `product_media` لهرمية الوسائط (منتج / قيمة خيار / متغيّر).
 *
 * ═══════════════════════════════════════════════════════════════
 *  لماذا امتدادٌ على `product_media` لا جدولٌ جديد؟
 * ═══════════════════════════════════════════════════════════════
 *  `product_media` اليوم جدولٌ واحدٌ بعمودَي `product_id`/`sort_order`، بلا
 *  علامة غلاف، والغلاف اليوم عرفٌ استعلامي محض («أوّل صفٍّ بترتيب sort_order»)
 *  مكرَّرٌ في ثلاثة مواضع مختلفة قليلاً. هذا الترحيل **لا يخترع سلطة غلافٍ
 *  ثانية** — العقد المعتمَد (VAR_ARCH_1 §5) يطلب تراجعاً حتمياً لا تخميناً من
 *  `sort_order`؛ الحلّ هنا هو تعريف واحدٍ حاسم («أوّل عنصرٍ في المعرض
 *  المحلول») يستبدل النسخ الثلاث المتكررة، لا عمود `is_cover` جديد يحتاج
 *  آلية ضبطٍ وتفرّدٍ جديدة كاملة لثلاث نطاقات مستقلة.
 *
 *  ═══ عمودان اختياريان فقط — إضافةٌ بحتة ═══
 *  `product_option_value_id` و`product_variant_id`، كلاهما nullable FK
 *  بـ`cascadeOnDelete()` — صفٌّ بلا أيٍّ منهما = وسيطٌ على مستوى المنتج
 *  (السلوك القائم حرفياً، بلا تغيير). `ADD COLUMN` فقط على SQLite —
 *  لا إعادة بناء جدول، ولا خطر فقدان قيدٍ (لا CHECK قائم على هذا الجدول
 *  أصلاً، مؤكَّدٌ من كل ترحيلٍ سابقٍ يلمسه).
 *
 *  ═══ التفرّد المتبادل عمداً على مستوى النموذج لا القاعدة ═══
 *  صفٌّ لا يجوز أن يستهدف قيمة خيارٍ **و** متغيّراً معاً. إنفاذ ذلك بقيد
 *  CHECK عابرٍ للمحركين كان سيحتاج إعادة بناء جدول SQLite كاملة — بالضبط
 *  الفئة التي يحذّر منها العقد صراحةً. يُفرض بدلاً منه في `ProductMedia::booted()`
 *  (فشلٌ مغلَق قبل أي كتابة)، بنفس فلسفة فحوصات الهويّة الصريحة في
 *  `InventoryService`/`ProductPricingService` — دفاعٌ تطبيقي موثَّق، لا قيد قاعدة بيانات.
 *
 *  لا قيد تفرّدٍ جديد: معرضٌ (قائمة) لا هويّةٌ واحدة كـ`ProductUnitPrice`/
 *  `InventoryState` — منتجٌ/قيمة/متغيّرٌ قد يملك عدة صورٍ بلا تعارض.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_media', function (Blueprint $table) {
            $table->foreignUuid('product_option_value_id')->nullable()->after('product_id')
                ->constrained('product_option_values')->cascadeOnDelete();
            $table->foreignUuid('product_variant_id')->nullable()->after('product_option_value_id')
                ->constrained('product_variants')->cascadeOnDelete();

            $table->index(['tenant_id', 'product_option_value_id']);
            $table->index(['tenant_id', 'product_variant_id']);
        });
    }

    public function down(): void
    {
        Schema::table('product_media', function (Blueprint $table) {
            $table->dropIndex(['tenant_id', 'product_variant_id']);
            $table->dropIndex(['tenant_id', 'product_option_value_id']);
            $table->dropConstrainedForeignId('product_variant_id');
            $table->dropConstrainedForeignId('product_option_value_id');
        });
    }
};
