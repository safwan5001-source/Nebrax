<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * APP-BUILDER-1 (AWJ App Builder Horizon V1, AB-01/AB-02) — جذر هوية تطبيق
 * الجوال المُؤلَّف عبر AWJ App Builder. صفٌّ واحد هنا = تطبيق جوال واحد
 * يملكه المستأجر؛ لا يحمل محتوى التجربة نفسه (ذلك في `builder_draft_
 * experiences`/`builder_published_experience_versions`) — هذا الجدول هوية
 * ومعدن فقط، مطابقاً لفصل AB-02 بين "هوية التطبيق" و"محتوى التجربة".
 *
 * **`creation_source`**: يسجّل أيّ من المسارات الثلاثة المعتمدة (معمارية
 * App Builder §5) أنشأ التطبيق — `store_design`/`template`/`scratch`. V1
 * (APP-BUILDER-1) يهيّئ نفس المحتوى الأدنى الآمن لكل المسارات الثلاثة؛
 * التمايز الفعلي (استيراد تصميم المتجر الحقيقي، محتوى القالب) مؤجَّلٌ
 * صراحةً إلى APP-BUILDER-8/9 — هذا العمود يحفظ النيّة الآن فلا يحتاج
 * الترحيل لاحقاً عمود جديد لإعادة بناء تاريخ لم يُسجَّل.
 *
 * **لا `bundle_id`/`package_id` هنا**: معرّف المتجر/التطبيق الإنتاجي بوابة
 * قرار مفتوحة صراحة (`AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md` §20/20A)
 * — لا علاقة لها بهوية App Builder الداخلية، ولا يُخترَع عمود لها قبل قرار
 * الملكية/التوقيع.
 *
 * **لا حذف في V1**: النطاق (APP-BUILDER-1) لا يعرّف سياسة حذف تطبيق له
 * نسخ منشورة (قد تكسر مرجعاً مستقبلياً من App Factory/Release Center) —
 * غير مطلوب في تعريف المهمة ولا في Definition of Done؛ مسجَّلٌ backlog
 * صراحة لا نقصاً صامتاً.
 *
 * **`CompanyWide`** (انظر `App\Models\BuilderApp`): تطبيق الجوال يخصّ
 * المؤسسة كلها لا فرعاً بعينه — يوازي بالضبط تصنيف `commerce.storefront`
 * (قناة بيع واحدة للمؤسسة، لا قناة لكل فرع).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('builder_apps', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();

            $table->string('name');
            $table->string('name_en')->nullable();

            $table->string('creation_source', 32); // store_design | template | scratch

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            $table->index('tenant_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('builder_apps');
    }
};
