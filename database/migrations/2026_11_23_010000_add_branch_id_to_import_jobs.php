<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-H1-S3a — الفرع الذي أُنشئت فيه تشغيلة الاستيراد، ثابتٌ بعد الإنشاء.
 *
 * كان الفرع يُؤخذ من الطلب الحالي عند **كل** قطعة ترحيل، فتشغيلةٌ فُحصت في فرع (أ) كانت تُرحَّل في فرع (ب) لو
 * تغيّر الفرع النشط بين الاستدعاءات. العمود إضافيٌّ nullable: التشغيلات القائمة تبقى `NULL` (سلوكها القديم حرفياً:
 * الفرع النشط وقت الترحيل)، ولا Backfill.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('import_jobs', function (Blueprint $table) {
            $table->foreignUuid('branch_id')->nullable()->after('tenant_id')->constrained('branches')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('import_jobs', function (Blueprint $table) {
            $table->dropConstrainedForeignId('branch_id');
        });
    }
};
