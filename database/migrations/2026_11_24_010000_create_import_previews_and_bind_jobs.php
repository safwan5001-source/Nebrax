<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-H1-S3b — ربط التنفيذ بمعاينته.
 *
 * `import_previews`: سجلّ معاينة **أحادي الاستعمال** يحفظه الخادم (لا العميل): المستأجر والفرع والمستخدم والمجال وبصمة
 * الملف (وأرشيف الصور) والخيارات القانونية المجمَّدة وبصمة HMAC لها كلّها، مع انقضاء واستهلاك. التشغيلة التنفيذية تُنشأ
 * بإنفاق معاينة واحدة بتحديثٍ شرطيّ (`consumed_at IS NULL`) في معاملة إنشاء التشغيلة نفسها.
 *
 * إضافيٌّ بالكامل: جدول جديد وعمودان nullable على `import_jobs` (التشغيلات القائمة تبقى بلا معاينة = العقد القديم)، بلا Backfill.
 * مشترك على مستوى المؤسسة (`CompanyWide`) كـ`import_jobs`؛ الفرع حقل ربط لا ملكية.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('import_previews', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->string('domain', 64);
            $table->char('file_sha256', 64);
            $table->char('archive_sha256', 64)->nullable();
            $table->json('options');
            $table->char('preview_hash', 64);

            $table->timestamp('expires_at');
            $table->timestamp('consumed_at')->nullable();
            $table->uuid('consumed_job_id')->nullable();

            $table->timestamps();

            $table->index(['tenant_id', 'expires_at']);
        });

        Schema::table('import_jobs', function (Blueprint $table) {
            $table->uuid('preview_id')->nullable()->after('branch_id');
            $table->char('preview_hash', 64)->nullable()->after('preview_id');
        });
    }

    public function down(): void
    {
        Schema::table('import_jobs', function (Blueprint $table) {
            $table->dropColumn(['preview_id', 'preview_hash']);
        });
        Schema::dropIfExists('import_previews');
    }
};
