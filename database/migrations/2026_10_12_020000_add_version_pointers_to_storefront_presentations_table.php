<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * CUST-H1-1 — تطوير رأس `storefront_presentations` لدعم النسخ.
 *
 * يضيف مؤشرات nullable فقط؛ لا يحذف ولا يعيد توظيف أي عمود قائم
 * (`draft_config`/`draft_revision`/`published_config`/`published_revision`/
 * `published_at`/`schema_version` تبقى كما هي — حقول توافق دائمة).
 *
 * تسلسل آمن عبر SQLite/PostgreSQL (بلا Doctrine غير ضروري حيث يمكن تفاديه):
 * 1) إضافة الأعمدة الجديدة كلّها nullable (أو بقيمة افتراضية آمنة)،
 * 2) تعبئة `draft_schema_version`/`published_schema_version` من `schema_version`
 *    القائم عبر UPDATE مباشر (بلا نماذج Eloquent — لا سياق مستأجر هنا)،
 * 3) فرض NOT NULL على `draft_schema_version` فقط بعد التحقق أن كل الصفوف
 *    القائمة معبّأة (`->change()` مثل بقية الهجرات المشابهة في المستودع).
 *
 * `published_schema_version` يبقى nullable — الصفوف بلا لقطة منشورة ليس لها
 * قيمة معنى لها. `schedule_epoch` يبدأ 0 لكل الصفوف القائمة والجديدة —
 * قيمة آمنة أولية لن تُفعَّل ضمن هذا الأفق (لا جدولة في CUST-H1-1).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('storefront_presentations', function (Blueprint $table) {
            $table->unsignedSmallInteger('draft_schema_version')->default(1)->nullable()->after('schema_version');
            $table->unsignedSmallInteger('published_schema_version')->nullable()->after('draft_schema_version');
            $table->unsignedInteger('schedule_epoch')->default(0)->after('published_at');

            $table->uuid('active_version_id')->nullable()->after('schedule_epoch');
            $table->uuid('scheduled_version_id')->nullable()->after('active_version_id');
            $table->uuid('compatibility_working_version_id')->nullable()->after('scheduled_version_id');
        });

        DB::table('storefront_presentations')->update([
            'draft_schema_version' => DB::raw('schema_version'),
        ]);

        DB::table('storefront_presentations')
            ->whereNotNull('published_config')
            ->update([
                'published_schema_version' => DB::raw('schema_version'),
            ]);

        Schema::table('storefront_presentations', function (Blueprint $table) {
            $table->unsignedSmallInteger('draft_schema_version')->default(1)->nullable(false)->change();
        });

        Schema::table('storefront_presentations', function (Blueprint $table) {
            $table->foreign('active_version_id')
                ->references('id')->on('storefront_presentation_versions')
                ->nullOnDelete();
            $table->foreign('scheduled_version_id')
                ->references('id')->on('storefront_presentation_versions')
                ->nullOnDelete();
            $table->foreign('compatibility_working_version_id')
                ->references('id')->on('storefront_presentation_versions')
                ->nullOnDelete();

            $table->index('active_version_id');
            $table->index('scheduled_version_id');
            $table->index('compatibility_working_version_id');
        });
    }

    public function down(): void
    {
        Schema::table('storefront_presentations', function (Blueprint $table) {
            $table->dropForeign(['active_version_id']);
            $table->dropForeign(['scheduled_version_id']);
            $table->dropForeign(['compatibility_working_version_id']);
            $table->dropColumn([
                'draft_schema_version',
                'published_schema_version',
                'schedule_epoch',
                'active_version_id',
                'scheduled_version_id',
                'compatibility_working_version_id',
            ]);
        });
    }
};
