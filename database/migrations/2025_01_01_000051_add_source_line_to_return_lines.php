<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  ربط سطر المرتجع بسطره في المستند المصدر
     * ═══════════════════════════════════════════════════════════════
     *  رأس المرتجع يحمل رابط مصدره منذ 000011 (`nullableUuidMorphs('original')`)
     *  لكنه كان يُترك فارغاً ولا يُتحقَّق منه. والرابط على الرأس وحده **لا يكفي**
     *  لمنع الردّ بأكثر من المبيع:
     *
     *      فاتورة فيها سطران للصنف نفسه — ٥ بـ١٠٠٫٠٠ و٣ بـ٨٠٫٠٠.
     *      بالتجميع على المنتج: «بيع ٨، أعلى سعر ١٠٠٫٠٠»
     *      ⇒ يُقبل ردّ ٨ × ١٠٠٫٠٠ — وفيه ردّ ثلاثةٍ بأكثر ممّا قُبض عنها.
     *
     *  فالربط **سطراً بسطر**: الكمية تُقاس على سطرها، والسعر يُسقَّف بسعر سطره.
     *
     *  ــ لماذا بلا مفتاح أجنبي
     *
     *  السطر المصدر إمّا `invoice_lines` أو `purchase_lines` حسب `original_type`
     *  على الرأس. مفتاحٌ أجنبي واحد لا يشير إلى جدولين، وإضافة زوج polymorphic
     *  ثانٍ على السطر تكرارٌ لما يقوله الرأس. فالسلامة تُفرَض في `ReturnService`
     *  (يتحقّق أن السطر يخصّ المستند المصدر فعلاً) لا في المخطّط.
     *
     *  ــ لا يتغيّر شيء على القائم
     *
     *  العمود nullable بلا افتراض: كل مرتجع قائم وكل مرتجع حرّ (بلا مصدر) يبقى
     *  كما هو، وكل الحرّاس مشروطة بوجود الرابط.
     */
    public function up(): void
    {
        Schema::table('return_lines', function (Blueprint $table) {
            $table->uuid('source_line_id')->nullable()->after('product_id');

            // فهرسٌ لاستعلام «كم رُدَّ من هذا السطر حتى الآن؟» — يُنفَّذ عند كل
            // إنشاء وترحيل مرتجعٍ مرتبط.
            $table->index(['tenant_id', 'source_line_id']);
        });
    }

    public function down(): void
    {
        Schema::table('return_lines', function (Blueprint $table) {
            $table->dropIndex(['tenant_id', 'source_line_id']);
            $table->dropColumn('source_line_id');
        });
    }
};
