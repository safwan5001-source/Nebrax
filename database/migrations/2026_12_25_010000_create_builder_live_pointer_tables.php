<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AD-06 / S05c — مؤشر النسخة الحيّة لكل قناة بيع (جوال) وسجل تدقيق ثابت لتحريكه.
 *
 * إضافي بالكامل وقابل للتراجع: جدولان جديدان لا يغيّران أي جدول قائم ولا أي صف. ما دام علم الميزة
 * `app_builder.live_pointer_enabled` مغلقاً (الافتراضي) أو لا مؤشر للقناة، يبقى السلوك المؤقت القائم
 * («أحدث نشر عبر تطبيقات المستأجر») حرفياً.
 *
 * - `builder_live_pointers`: صفّ واحد لكل (مستأجر، قناة) — الفريد يمنع مؤشرين لقناة. `live_version_id`
 *   مرجع `restrict`: النسخ المنشورة ثابتة أصلاً، فلا تُحذف نسخة حيّة بحذف تتالٍ من التطبيق دون وعي.
 * - `builder_live_pointer_events`: سجل append-only (النموذج يمنع التعديل والحذف) لكل ترقية/تراجع.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('builder_live_pointers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();
            $table->foreignUuid('builder_app_id')->constrained('builder_apps')->restrictOnDelete();
            $table->foreignUuid('live_version_id')->constrained('builder_published_experience_versions')->restrictOnDelete();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'sales_channel_id']);
        });

        Schema::create('builder_live_pointer_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();
            $table->string('action', 16); // promote | rollback
            $table->foreignUuid('from_version_id')->nullable()->constrained('builder_published_experience_versions')->nullOnDelete();
            $table->foreignUuid('to_version_id')->constrained('builder_published_experience_versions')->restrictOnDelete();
            $table->foreignUuid('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('reason', 500)->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'sales_channel_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('builder_live_pointer_events');
        Schema::dropIfExists('builder_live_pointers');
    }
};
