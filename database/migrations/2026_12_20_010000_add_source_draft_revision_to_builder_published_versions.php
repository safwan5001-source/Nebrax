<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AD-01 / S01d (G1) — يُسجَّل في كل نسخة منشورة `revision` المسودة التي نُشرت منها.
 *
 * إضافي وقابل للتراجع: العمود `nullable` فلا يتغير شيء في الصفوف القائمة (null = نُشرت قبل
 * هذا التتبع، ولا Backfill مختلَق). النسخة المنشورة تبقى غير قابلة للتعديل بعد إنشائها؛ العمود
 * يُكتب عند الإنشاء فقط (`BuilderPublishedExperienceVersionService::publish`).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('builder_published_experience_versions', function (Blueprint $table) {
            $table->unsignedInteger('source_draft_revision')->nullable()->after('schema_version');
        });
    }

    public function down(): void
    {
        Schema::table('builder_published_experience_versions', function (Blueprint $table) {
            $table->dropColumn('source_draft_revision');
        });
    }
};
