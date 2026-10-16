<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ Intelligence — AI-02A: القياس والتدقيق الدائم (ثلاثة جداول إضافية، لا تعديل على جدول قائم).
 *
 *  - `ai_budgets`       سقوف الإنفاق وعدّاداته: صف لكل (فترة شهرية UTC × global | tenant).
 *                       الأسقف **صريحة وإلزامية** (NOT NULL بلا افتراضي): غياب الصف = لا ميزانية = رفض.
 *                       الوحدات في الأسماء: `*_tokens` رموز، `*_micro_usd` = 1/1,000,000 دولار (bigint).
 *  - `ai_requests`      سجل طلبات المزوّد: هوية الطلب والمحاولات والحجز والتسوية وفرادة مفتاح التكرار.
 *  - `ai_audit_events`  تدقيق وصفي فقط، يُلحَق ولا يُعدَّل (حارس النموذج): لا prompt ولا ردّ ولا أسرار.
 *
 * التزامن: الحجز جملة UPDATE شرطية واحدة لكل صف سقف (ذرّية في PostgreSQL وSQLite)؛ الطلبات تُحجز
 * بترتيب ثابت (global ثم tenant) داخل معاملة واحدة.
 *
 * **PostgreSQL** يفرض CHECK لعدم السالب؛ SQLite لا يضيف CHECK بعد الإنشاء فيحرسه الكود والاختبارات.
 * **التراجع** (`down`) يحذف الجداول الثلاثة — آمن في بيئة لم تُفعَّل فيها الميزة؛ بعد وجود بيانات
 * فعلية تُفضَّل التغييرات إلى الأمام فقط.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_budgets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            // 'global' أو 'tenant:<uuid>' — مفتاح فرادة موحَّد لأن NULL لا يتفرّد في الفهارس.
            $table->string('budget_key', 64);
            $table->foreignUuid('tenant_id')->nullable()->constrained('tenants')->cascadeOnDelete();
            // 'YYYY-MM' بتوقيت UTC.
            $table->char('period', 7);
            $table->bigInteger('cap_tokens');
            $table->bigInteger('cap_cost_micro_usd');
            $table->bigInteger('reserved_tokens')->default(0);
            $table->bigInteger('used_tokens')->default(0);
            $table->bigInteger('reserved_cost_micro_usd')->default(0);
            $table->bigInteger('used_cost_micro_usd')->default(0);
            $table->timestamps();

            $table->unique(['period', 'budget_key']);
            $table->index('tenant_id');
        });

        Schema::create('ai_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('actor_id');
            $table->string('feature', 32)->default('assistant');
            $table->string('provider', 32);
            $table->string('model', 64);
            $table->boolean('billable');
            // HMAC(tenant ⏎ Idempotency-Key) وبصمة الطلب — المفتاح الخام والنص لا يُخزَّنان.
            $table->char('idempotency_hash', 64)->nullable();
            $table->char('request_fingerprint', 64)->nullable();
            // reserved | settled | failed (الرفض قبل الحجز يُدقَّق فقط ولا يُنشئ صفاً)
            $table->string('status', 16);
            $table->unsignedSmallInteger('attempt')->default(1);
            $table->char('period', 7);
            $table->bigInteger('reserved_tokens')->default(0);
            $table->bigInteger('reserved_cost_micro_usd')->default(0);
            // تراكمي عبر المحاولات.
            $table->bigInteger('input_tokens')->default(0);
            $table->bigInteger('output_tokens')->default(0);
            // رموز محتسبة بلا قياس فعلي (فشل/انتهاء حجز) — تُحتسب بالمحجوز بحسب سياسة الفشل.
            $table->bigInteger('unmetered_tokens')->default(0);
            $table->bigInteger('cost_micro_usd')->default(0);
            $table->string('error_code', 64)->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'idempotency_hash']);
            $table->index(['status', 'updated_at']);
            $table->index(['tenant_id', 'created_at']);
        });

        Schema::create('ai_audit_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('request_id');
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('actor_id')->nullable();
            $table->string('feature', 32)->default('assistant');
            $table->string('event', 40);
            $table->string('tool', 80)->nullable();
            $table->string('provider', 32)->nullable();
            $table->string('model', 64)->nullable();
            // allowed | denied | error
            $table->string('outcome', 16);
            $table->string('reason', 64);
            $table->unsignedSmallInteger('attempt')->nullable();
            $table->bigInteger('input_tokens')->nullable();
            $table->bigInteger('output_tokens')->nullable();
            $table->bigInteger('cost_micro_usd')->nullable();
            // قائمة بيضاء من الأعداد/الأعلام فقط (AiAuditRecorder::META_KEYS).
            $table->json('meta')->nullable();
            $table->timestamp('occurred_at');

            $table->index(['tenant_id', 'occurred_at']);
            $table->index(['tenant_id', 'request_id']);
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE ai_budgets ADD CONSTRAINT ai_budgets_non_negative CHECK (
                cap_tokens >= 0 AND cap_cost_micro_usd >= 0 AND reserved_tokens >= 0 AND used_tokens >= 0
                AND reserved_cost_micro_usd >= 0 AND used_cost_micro_usd >= 0)');
            DB::statement('ALTER TABLE ai_requests ADD CONSTRAINT ai_requests_non_negative CHECK (
                reserved_tokens >= 0 AND reserved_cost_micro_usd >= 0 AND input_tokens >= 0 AND output_tokens >= 0
                AND unmetered_tokens >= 0 AND cost_micro_usd >= 0)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_audit_events');
        Schema::dropIfExists('ai_requests');
        Schema::dropIfExists('ai_budgets');
    }
};
