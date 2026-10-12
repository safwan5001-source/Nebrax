<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CUST-H5-3 — سجلّ المراجعات المحفوظة لنسخة المظهر (`storefront_presentation_version_revisions`).
 *
 * لقطات **ثابتة** (immutable) كاملة للمستند المُطبَّع عند كل حفظ ناجح لنسخة، للاسترداد بعد إغلاق المتصفح أو حفظٍ خاطئ.
 * إضافية بحتة: لا تغيّر `storefront_presentation_versions` ولا رأس النشر، ولا تدخل في أي مسار عام (public). مرجعها المعماري:
 * `docs/plans/store/CUST-H5-EVIDENCE-ARCHITECTURE-EXECUTION-PLAN.md` §4.
 *
 *  - صف واحد على الأكثر لكل (نسخة، مراجعة): فريد `(version_id, version_revision)`.
 *  - `config_hash` (sha256 للـJSON الكانوني) يمنع تسجيل حفظٍ لم يغيّر المستند.
 *  - `size_bytes` يخدم سقف الاحتفاظ بالبايتات دون قراءة المستندات.
 *  - بلا `updated_at`: لا تُعدَّل بعد الإنشاء. تُحذف بالتتالي مع النسخة/المتجر/المستأجر، وبحدّ الاحتفاظ وحده.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('storefront_presentation_version_revisions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('storefront_id')->constrained('storefronts')->cascadeOnDelete();
            $table->foreignUuid('version_id')->constrained('storefront_presentation_versions')->cascadeOnDelete();
            $table->unsignedInteger('version_revision');
            $table->unsignedSmallInteger('schema_version');
            $table->json('config');
            $table->char('config_hash', 64);
            $table->unsignedInteger('size_bytes');
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['version_id', 'version_revision'], 'sp_version_revisions_version_revision_unique');
            $table->index(['tenant_id', 'storefront_id', 'version_id'], 'sp_version_revisions_tenant_store_version_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storefront_presentation_version_revisions');
    }
};
