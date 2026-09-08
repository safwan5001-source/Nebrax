<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تحديثات النظام / What's New (PR-NOTIF-6)
 * ═══════════════════════════════════════════════════════════════
 *  جدول على مستوى المنصة (لا tenant_id) — مشغّل المنصة ينشر
 *  تحديثاً، وخدمة النشر تسلّم إشعاراً عبر `NotificationService`
 *  للمستهدفين. سجلّ What's New دائم ومستقل عن حالة قراءة Notification.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('system_updates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('author_id')
                ->constrained('platform_administrators')
                ->cascadeOnDelete();

            $table->string('status', 20)->default('draft');
            $table->string('target_type', 20)->default('all');

            $table->string('title_ar', 255);
            $table->string('title_en', 255);
            $table->text('content_ar');
            $table->text('content_en');

            $table->timestamp('published_at')->nullable();
            $table->timestamps();

            $table->index(['status', 'published_at'], 'system_updates_published_idx');
        });

        Schema::create('system_update_targets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('system_update_id')
                ->constrained('system_updates')
                ->cascadeOnDelete();

            // 'tenant' أو 'user' — نوع الهدف.
            $table->string('target_type', 20);
            $table->uuid('target_id');

            $table->unique(['system_update_id', 'target_type', 'target_id'], 'system_update_targets_unique');
            $table->index(['target_type', 'target_id'], 'system_update_targets_lookup_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('system_update_targets');
        Schema::dropIfExists('system_updates');
    }
};
