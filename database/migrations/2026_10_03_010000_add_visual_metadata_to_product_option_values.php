<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * VAR-OPTION-VISUAL-1 — صريّة بصرية (swatch) على قيمة خيار المنتج.
 *
 * إضافيٌّ بحت: ثلاثة أعمدة قابلة للقيمة الفارغة على `product_option_values`
 * فقط — لا تغيير على `product_options` (القرار المعتمَد: الصريّة مملوكة
 * للقيمة لا للخيار)، ولا على `product_variants`/`product_variant_option_values`
 * (هوية المتغيّر لا تتأثر بصريّة القيمة إطلاقاً).
 *
 *  - `visual_type` نصٌّ لا enum DDL — يطابق نمط `products.variant_state` نفسه
 *    في هذا المستودع (تحقّقٌ في الطلب/الخدمة، لا قيد قاعدة بيانات). الافتراض
 *    `none` يحافظ على كل صفٍّ قائم صالحاً بلا أي تعبئة رجعية.
 *  - `color_value` نصٌّ بحدّ ٧ خانات (`#RRGGBB`) — التحقّق من الصيغة في طبقة
 *    التطبيق حصراً (`ProductOptionValue::normalizeColorHex()`)، بنفس منطق
 *    الحقل أعلاه تماماً؛ لا قيد `CHECK` هنا عمداً لتفادي إعادة بناء جدول
 *    SQLite الذي يُسقط قيود `CHECK` صامتاً (المخاطرة المعروفة في هذا المستودع).
 *  - `image_media_id` مرجعٌ اختياري إلى `product_media.id` — `nullOnDelete()`
 *    لأن حذف صفّ وسيطٍ (نادرٌ اليوم: لا مسار HTTP يحذف وسيطاً منفرداً لقيمة
 *    خيار، فقط حذف القيمة بالجملة عبر `deleteOptionValue()` الذي يحذف القيمة
 *    نفسها معه) يجب ألا يفشل بقيد صارم؛ يبقى العمود فارغاً إن حدث، والخدمة
 *    وحدها هي التي تفرض تطابق `image_media_id` مع `product_option_value_id`
 *    لهذه القيمة بالذات وقت الكتابة — لا اعتماداً على الفهرس هنا.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('product_option_values', function (Blueprint $table) {
            $table->string('visual_type', 20)->default('none')->after('is_active');
            $table->string('color_value', 7)->nullable()->after('visual_type');
            $table->foreignUuid('image_media_id')->nullable()->after('color_value')
                ->constrained('product_media')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('product_option_values', function (Blueprint $table) {
            $table->dropConstrainedForeignId('image_media_id');
            $table->dropColumn('color_value');
            $table->dropColumn('visual_type');
        });
    }
};
