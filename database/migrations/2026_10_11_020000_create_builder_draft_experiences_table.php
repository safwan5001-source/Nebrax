<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * APP-BUILDER-1 (AB-02/AB-07) — النسخة العاملة القابلة للتعديل من تجربة
 * التطبيق. صفٌّ واحد فقط لكل تطبيق (`unique(builder_app_id)`) — لا تاريخ
 * مسودّات متعدد في V1؛ الحفظ يُحدِّث نفس الصفّ مكانه، مطابقاً لمبدأ "لا
 * تُحرَّر التجربة المنشورة مباشرة أبداً" (معمارية App Builder §9) بعكسه:
 * هذا الصفّ **هو** دوماً غير المنشور، والنشر ينسخ لقطة منه فلا يمسّه.
 *
 * **`schema` JSON محايد الهوية عمداً**: لا يحمل `appId`/`experienceId`/
 * `version` بداخله — تلك أعمدة خادمية (`builder_app_id` هنا، ورقم الإصدار
 * في جدول النسخ المنشورة) لا محتوًى قابلاً لتعديل التاجر. تضمينها داخل
 * JSON قابل للتعديل كان يفتح قناة انتحال هويةٍ/إصدارٍ لا داعي لها
 * (`APP_SCHEMA_V1.md` §3: لا سلطة تُمنح من داخل المخطط). البنية الدنيا
 * المخزَّنة اليوم (`schemaVersion`/`locales`/`defaultLocale`/`theme`/
 * `navigation`/`pages`/`assets`/`metadata`) مطابقة لـ`APP_SCHEMA_V1.md` §4
 * حرفياً؛ التحقق العميق من محتوى `pages`/`theme`/... مؤجَّلٌ إلى
 * APP-BUILDER-2 (محقّق مطابق لسجلّات المكوّنات/الإجراءات) — هذه المهمة
 * تتحقق فقط من الشكل السطحي (مفاتيح معروفة، أنواع أساسية صحيحة).
 *
 * **`revision`**: عدّاد تفاؤلي يزيد مع كل حفظ — أساسٌ خفيف لتاريخ
 * التراجع/الإعادة (APP-BUILDER-6) لاحقاً، وليس رقم نسخة منشورة (ذاك في
 * الجدول الآخر ومُقفلٌ تحت معاملة منفصلة).
 *
 * **`CompanyWide`**: يتبع تصنيف `builder_apps` رأسه — لا فرعاً بعينه.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('builder_draft_experiences', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('builder_app_id')->constrained('builder_apps')->cascadeOnDelete();

            $table->json('schema');
            $table->unsignedInteger('revision')->default(0);

            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            $table->unique('builder_app_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('builder_draft_experiences');
    }
};
