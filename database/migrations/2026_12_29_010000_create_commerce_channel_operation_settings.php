<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * COPS-H1-3 (ADR-29 §2.5) — أساس إعدادات تشغيل قناة المتجر: صف واحد لكل قناة يحمل مفاتيح **القبول فقط**
 * (`acceptance_mode`، `acceptance_reminder_minutes`، `acceptance_escalation_minutes`) و`version` للحماية من التحديث المتزامن.
 *
 * **غياب الصف = السلوك الحالي حرفياً** (`auto`، بلا تذكير ولا تصعيد، النسخة 0): لا صف يُدرج لأي قناة قائمة ولا backfill، ولا شيء في
 * المسارات القائمة يقرأ هذا الجدول (Checkout والدفع والإلغاء لا يتغيّر فيها شيء). جدول إضافي: لا يُعدَّل أي جدول قائم.
 *
 * قيود القيم تُفرض في PostgreSQL بـCHECK (الإنتاج) وفي الخدمة على المحرّكين (SQLite للاختبار فقط). الصف إعداد قابل للتحديث بتدقيق في
 * `sales_channel_setting_events` (الدليل التدقيقي هناك، لا هنا) فيتبع حذف القناة (`cascade`) دون فقد دليل. الفريد `(sales_channel_id)` يحمي من
 * صفين لقناة واحدة حتى لو تجاوز أحدٌ قفل صف القناة.
 *
 * Rollback: `down()` يرفض متى وُجد صف (إعداد تشغيل مُهيَّأ بقرار بشري).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_channel_operation_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();
            $table->string('acceptance_mode', 16)->default('auto');
            $table->unsignedSmallInteger('acceptance_reminder_minutes')->nullable();
            $table->unsignedSmallInteger('acceptance_escalation_minutes')->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->foreignUuid('updated_by_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique('sales_channel_id', 'commerce_channel_operation_settings_channel_unique');
            $table->index('tenant_id', 'commerce_channel_operation_settings_tenant_idx');
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE commerce_channel_operation_settings ADD CONSTRAINT commerce_ops_settings_shape_chk CHECK (
                acceptance_mode IN ('auto', 'manual')
                AND version >= 1
                AND (acceptance_reminder_minutes IS NULL OR acceptance_reminder_minutes BETWEEN 1 AND 1440)
                AND (acceptance_escalation_minutes IS NULL OR acceptance_escalation_minutes BETWEEN 1 AND 1440)
                AND (acceptance_reminder_minutes IS NULL OR acceptance_escalation_minutes IS NULL
                     OR acceptance_escalation_minutes >= acceptance_reminder_minutes)
            )");
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('commerce_channel_operation_settings') && DB::table('commerce_channel_operation_settings')->exists()) {
            throw new \RuntimeException('Refusing to roll back: channel operation settings exist (a human configured them).');
        }

        Schema::dropIfExists('commerce_channel_operation_settings');
    }
};
