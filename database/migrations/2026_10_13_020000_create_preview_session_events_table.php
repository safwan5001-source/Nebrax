<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * MOBILE-PREVIEW-6 — سجلّ تدقيق ثابت لدورة حياة جلسات المعاينة (§5.12).
 *
 * لا يُحدَّث ولا يُحذف بعد الإنشاء (نفس انضباط `tenant_application_events` —
 * `App\Models\TenantApplicationEvent::booted()`). لا يحمل صفٌّ هنا أبداً
 * النصّ الصريح للتوكن/المرجع — معرّفات معتمة فقط (§5.12: "Raw credentials
 * are never logged").
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('preview_session_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('preview_session_id')->nullable()
                ->constrained('preview_sessions')->cascadeOnDelete();

            // created | opened | refreshed | revoked | expired | rejected
            $table->string('action', 24);

            $table->foreignUuid('changed_by')->nullable()->constrained('users')->nullOnDelete();

            // سياق آمن فقط (سبب الرفض، معرّف الجلسة القديمة عند التجديد…)
            // — لا يُخزَّن هنا أبداً توكن أو مرجع خام.
            $table->string('reason')->nullable();

            $table->timestamps();

            $table->index(['tenant_id', 'preview_session_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('preview_session_events');
    }
};
