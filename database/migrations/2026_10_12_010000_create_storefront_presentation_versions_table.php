<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * CUST-H1-1 — نسخ مظهر المتجر المستقلّة (`storefront_presentation_versions`).
 *
 * إضافية بحتة إلى جانب `storefront_presentations` (الرأس المتوافق مع
 * الإصدار السابق) — لا تستبدله. مرجعها المعماري:
 * `docs/plans/store/CUST-H1-ARCH-1-THEME-VERSION-PERSISTENCE-SCHEDULING.md` §4.
 *
 * لا `status` مخزَّن: حالة النسخة (مسودة/مجدولة/منشورة) تُشتقّ من مؤشرات
 * الرأس (`active_version_id`/`scheduled_version_id`) وقت القراءة، فلا يمكن
 * لصفّين أن يدّعيا «منشور» في آنٍ واحد. بلا SoftDeletes — الحذف حذف منتج
 * لا أثر تدقيق (نفس فلسفة `storefront_presentations`).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('storefront_presentation_versions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('storefront_id')->constrained('storefronts')->cascadeOnDelete();
            $table->string('name', 120);
            $table->unsignedSmallInteger('schema_version');
            $table->json('config');
            $table->unsignedInteger('revision')->default(1);
            $table->timestamp('scheduled_for')->nullable();
            $table->unsignedInteger('schedule_generation')->default(0);
            $table->timestamp('last_published_at')->nullable();
            $table->timestamps();

            $table->index('tenant_id');
            $table->index('storefront_id');
            $table->index(['tenant_id', 'storefront_id']);
            $table->index('scheduled_for');
            $table->index(['storefront_id', 'scheduled_for']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('storefront_presentation_versions');
    }
};
