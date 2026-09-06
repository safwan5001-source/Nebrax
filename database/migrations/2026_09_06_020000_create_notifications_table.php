<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * ═══════════════════════════════════════════════════════════════
 *  أساس الإشعارات (PR-NOTIF-1) — سجلّ تسليم لكل مستخدم
 * ═══════════════════════════════════════════════════════════════
 *  إضافية بحتة: لا تمسّ `financial_control_alerts` ولا أي جدول محاسبي.
 *  انظر docs/plans/alerts-notifications/AWJ_ALERTS_NOTIFICATIONS_MASTER_PLAN.md §5.1.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notifications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('recipient_id')->constrained('users')->cascadeOnDelete();

            // تبويب الواجهة: الكل | تنبيهات | تحديثات (تحديثات محجوزة لـ PR-NOTIF-6).
            $table->string('category', 20);
            // مفتاح مُنتِج مستقر بصيغة منقطة، مثل inventory.low_stock.
            $table->string('type', 100);
            $table->string('severity', 20);

            // محتوى آمن قابل للعرض مباشرة؛ `type` يبقى مفتاحاً مستقراً تستطيع
            // الواجهة ترجمته محلياً إن وُجدت ترجمة، والسقوط على هذا النص إن غابت
            // — نفس اصطلاح "رمز + نص عربي" الموثّق لأخطاء الأرصدة الافتتاحية.
            $table->string('title', 255);
            $table->text('message');

            // مصدر اختياري لإعادة التحقق من الصلاحية عند الفتح — لا يمنح وصولاً بذاته.
            $table->string('source_type', 60)->nullable();
            $table->uuid('source_id')->nullable();
            // إجراء مصرَّح به من قائمة ثابتة في الخادم (App\Support\NotificationActions)؛
            // ليس رابطاً ولا أمر واجهة حرّاً.
            $table->string('action', 60)->nullable();
            // بيانات إضافية مقيَّدة (قيم بسيطة فقط) — يفحصها NotificationService قبل الحفظ.
            $table->json('data')->nullable();

            // هوية idempotency صريحة يحدّدها المُنتِج: نفس المفتاح لنفس المستلم لا يتكرر.
            $table->string('dedupe_key', 191);

            $table->timestamp('read_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'recipient_id', 'dedupe_key'], 'notifications_dedupe_unique');
            $table->index(['tenant_id', 'recipient_id', 'read_at', 'created_at'], 'notifications_recipient_unread_idx');
            $table->index(['tenant_id', 'recipient_id', 'category', 'created_at'], 'notifications_recipient_category_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('notifications');
    }
};
