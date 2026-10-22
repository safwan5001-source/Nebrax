<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-H1-S8b — تشغيلة إصلاح فرعية: `parent_job_id` يربطها بالتشغيلة الأم التي فشلت وحداتها (`import_job_units`).
 *
 * عمودٌ واحد nullable بلا Backfill (التشغيلات القائمة = بلا أم)، ومفتاح أجنبي `nullOnDelete` على الجدول نفسه: حذف الأم لا يحذف الطفل. وحدات الأم
 * (`import_job_units`) تذهب معها (cascade)، فيُنزَع ربط طفلٍ لم ينتهِ ويعمل كاستيرادٍ عاديّ بلا مطالبة — لذلك **`imports:prune` لا يقلّم أمّاً لها طفلٌ غير منتهٍ**
 * (حارسٌ في الأمر، مختبَر).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('import_jobs', function (Blueprint $table) {
            $table->foreignUuid('parent_job_id')->nullable()->after('preview_hash')->constrained('import_jobs')->nullOnDelete();
            $table->index(['tenant_id', 'parent_job_id']);
        });
    }

    public function down(): void
    {
        Schema::table('import_jobs', function (Blueprint $table) {
            $table->dropConstrainedForeignId('parent_job_id');
        });
    }
};
