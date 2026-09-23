<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * APP-BUILDER-1 (AB-03) — نسخة تجربة منشورة **غير قابلة للتعديل إطلاقاً**
 * بعد إنشائها (انظر `App\Models\BuilderPublishedExperienceVersion::booted()`
 * — يمنع أي `update`/`delete`، مطابقاً لنمط `TenantApplicationEvent` بلا
 * استثناء "حقل واحد لا يزال قابلاً للتغيير" الذي يستعمله `CommercialProductVersion`
 * (لا حالة "سحب/تقاعد" في V1 — ذلك يُنمذَج لاحقاً كنسخة جديدة تُنشَر فوقها،
 * لا تعديلاً على صفّ قديم، مطابقاً لـ`RUNTIME_COMPATIBILITY_V1.md` §15).
 *
 * **`version`**: عدد صحيح تسلسلي **لكل تطبيق** (`unique(builder_app_id,
 * version)`) يبدأ من 1 — يُحسَب `max(version)+1` داخل معاملة مقفلة على صفّ
 * `builder_apps` نفسه (انظر `BuilderPublishedExperienceVersionService`)،
 * وليس عبر `App\Support\GeneratesDocumentNumbers` — ذاك مخصَّصٌ صراحةً
 * لترقيم المستندات التجارية (`CLAUDE.md` §"الترقيم التسلسلي": «ممنوع كتابة
 * منطق ترقيم جديد... النموذج يعلن تصنيفه الفرعي»)، ونسخة تجربة App Builder
 * ليست مستنداً تجارياً بذلك المعنى.
 *
 * **`schema` لقطة كاملة مستقلة**: يُنسَخ من `builder_draft_experiences.schema`
 * وقت النشر، لا مرجعاً إليه — تعديل المسودة لاحقاً لا يُغيّر نسخاً منشورة
 * قائمة بصمت (يطابق مبدأ "لقطة لا مرجع" المستعمل لـ`commerce_payment_
 * intents.amount_minor`/`commerce_order_snapshots`).
 *
 * **`schema_version`**: نسخة عقد `APP_SCHEMA_V1` (حقل `schemaVersion` داخل
 * الـJSON نفسه) مستخرَجةً إلى عمود مستقل — يتيح فهرسة/استعلام التوافق لاحقاً
 * (APP-BUILDER-2/10) دون تفكيك JSON في كل استعلام.
 *
 * **`published_at` غير قابل للإلغاء**: كل صفّ هنا **هو** حدث نشر مكتمل؛ لا
 * حالة "منشور جزئياً" أو "مسودة نشر" في هذا الجدول — ذلك يبقى في
 * `builder_draft_experiences` حتى لحظة النشر الفعلية.
 *
 * **`CompanyWide`**: يتبع تصنيف `builder_apps` رأسه — لا فرعاً بعينه.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('builder_published_experience_versions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('builder_app_id')->constrained('builder_apps')->cascadeOnDelete();

            $table->unsignedInteger('version');
            $table->json('schema');
            $table->string('schema_version', 16);

            $table->foreignUuid('published_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('published_at');
            $table->string('note', 1000)->nullable();

            $table->timestamps();

            $table->unique(['builder_app_id', 'version']);
            $table->index(['tenant_id', 'builder_app_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('builder_published_experience_versions');
    }
};
