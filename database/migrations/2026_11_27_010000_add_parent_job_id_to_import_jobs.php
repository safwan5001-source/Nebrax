<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-H1-S8b — تشغيلة إصلاح فرعية: `parent_job_id` يربطها بالتشغيلة الأم التي فشلت وحداتها (`import_job_units`).
 *
 * عمودٌ واحد nullable بلا Backfill (التشغيلات القائمة = بلا أم)، ومفتاح أجنبي `nullOnDelete` على الجدول نفسه: تقليم/حذف الأم لا يحذف الطفل،
 * لكن مطالبات الوحدات (`import_job_units`) تذهب مع الأم (cascade) فيفشل ترحيل الطفل مغلقاً بـ`repair_ref_already_used` لا بنجاحٍ صامت.
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
