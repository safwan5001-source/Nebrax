<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * MOBILE-PREVIEW-6 — جلسات معاينة App Builder (تطبيق الـ MOBILE-PREVIEW-5
 * الأمنية المعتمدة، `docs/plans/app-builder/MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md` §5.14).
 *
 * لا جدول توكن جديد: التوكن نفسه صفّ Sanctum عادي على `personal_access_tokens`
 * (tokenable = PreviewSession) — تماماً كـ`ApiClient`/`CustomerIdentity`
 * (§2.2 من وثيقة المعمارية). هذا الجدول يحمل السياق الذي لا عمود لـSanctum
 * فيه: المستأجر/التطبيق/مصدر اللقطة/محتواها المجمَّد/القناة/الإبطال.
 *
 * **لقطة لا مؤشر حيّ**: `schema_snapshot`/`draft_revision` يُنسخان من
 * `BuilderDraftExperience` وقت الإصدار فقط (source = draft)؛ لا عمود يشير
 * إلى الصفّ الحيّ. تعديل المسودة لاحقاً لا يغيّر جلسة صادرة — الضمان الذي
 * تطلبه §5.5 (استنساخ Draft لا الإشارة إليه).
 *
 * **لا `preview_exchange_references` هنا**: تبادل QR/رابط عميق مؤجَّل صراحةً
 * لـMOBILE-PREVIEW-7 (نطاق المهمة)، فلا حاجة اليوم لجدول مرجع تبادل لمرّة
 * واحدة — القناة الوحيدة المطبَّقة في MP-6 تُسلَّم بها البصمة الخام مباشرة
 * من نقطة إصدار موثوقة (لوحة التاجر)، لا عبر رابط.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('preview_sessions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('builder_app_id')->constrained('builder_apps')->cascadeOnDelete();

            $table->string('source', 16); // draft | published | default

            // source = draft فقط — لقطة مجمَّدة وقت الإصدار، لا مؤشر حيّ.
            $table->json('schema_snapshot')->nullable();
            $table->unsignedInteger('draft_revision')->nullable();

            // source = published فقط.
            $table->foreignUuid('published_version_id')->nullable()
                ->constrained('builder_published_experience_versions')->nullOnDelete();

            $table->string('channel', 16)->default('device'); // browser | device
            $table->string('device_label')->nullable();

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamp('expires_at');
            $table->timestamp('revoked_at')->nullable();
            $table->timestamp('last_used_at')->nullable();

            $table->timestamps();

            $table->index(['tenant_id', 'builder_app_id']);
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('preview_sessions');
    }
};
