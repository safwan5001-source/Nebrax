<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  سجلّ تغييرات المستندات — مَن غيّر ماذا ومتى
     * ═══════════════════════════════════════════════════════════════
     *  المستند المسوّد يُعدَّل بلا أثر: لا شيء في النظام يحفظ ما كان عليه قبل
     *  التعديل. ثلاثة أعطال متتالية (#165، #166) كانت تغيّر **مبالغ** الفواتير
     *  صامتةً، ولم يكشفها إلا مسحٌ متعمَّد للكود بعد أشهر — لأن لا سجلّ يُراجَع.
     *
     *  هذا الجدول يجعل تلك الطبقة مرئية: كل تغيير حقلٍ يُخزَّن بقيمته قبلَ وبعد،
     *  موسوماً بفاعله. **لا أثر محاسبي**: لا يمسّ قيداً ولا رصيداً ولا إجمالياً،
     *  وهو للقراءة فقط — سجلٌّ يُكتب مرّة ولا يُعدَّل.
     *
     *  القيود المرحّلة immutable أصلاً، فمجال هذا السجلّ هو المسوّدات وانتقالات
     *  الحالة — وهي بالضبط المنطقة التي لا يحرسها شيء.
     */
    public function up(): void
    {
        Schema::create('document_revisions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();

            // مورفي: يخدم الفاتورة وعرض السعر ومستندات الشراء بجدول واحد.
            $table->string('document_type');
            $table->uuid('document_id');

            $table->enum('action', ['created', 'updated', 'status'])->default('updated');

            // {"total": [115000, 132250], "shipping": [50000, 0]} — القيم كما تُخزَّن
            // (هللات للمال)، والتحويل إلى ريال في طبقة العرض وحدها.
            //
            // **الاسم `diff` لا `changes` عمداً:** `Model::$changes` خاصية
            // محمية في Eloquent لتتبّع الحقول المتغيّرة، والوصول إليها مسموح
            // من أي صنف في شجرة `Model` — فقراءة `$revision->changes` من داخل
            // نموذجٍ آخر كانت تُرجع مصفوفة التتبّع الداخلية بدل الحقل، بلا خطأ.
            $table->json('diff');

            $table->foreignUuid('user_id')->nullable()->constrained('users')->nullOnDelete();
            // دقّة الميكروثانية ضرورية لا تجميلية: قيدا الإنشاء والتعديل قد
            // يقعان في الثانية نفسها، فترتيبٌ بدقّة الثواني يجعل الخطّ الزمني
            // عشوائياً — ويقرأ المستخدم التعديل قبل الإنشاء.
            $table->timestamps(6);

            $table->index(['tenant_id', 'document_type', 'document_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_revisions');
    }
};
