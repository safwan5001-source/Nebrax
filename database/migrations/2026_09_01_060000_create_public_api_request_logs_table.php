<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * سجلّ تدقيق طلبات الـ Public API — تدقيق **تشغيلي/أمني** (لا محاسبي)، جدول
 * append-only يُكتب مرة ولا يُحدَّث. غايته الإجابة عن: أيّ مستأجر/عميل، أيّ
 * request_id، أيّ method/route، متى، حالة الاستجابة، المدة، أيّ scope، هل
 * حدثت إعادة تشغيل idempotency، وهل قُيّد المعدّل.
 *
 * **حدود الخصوصية (بيانات وصفية فقط):** لا يُخزَّن جسم الطلب/الاستجابة، ولا
 * ترويسة Authorization، ولا مفتاح API خام، ولا مفتاح idempotency خام. تُخزَّن
 * معاملات استعلام من **قائمة سماح** محدودة الطول (ترقيم/فرز/تصفية) لا غير.
 * IP وUser-Agent يُخزَّنان عمدًا (بيانات تدقيق أمني معيارية) محدودَي الطول.
 *
 * **داخلي للمنصة فقط:** لا يُكشف عبر أيّ مسار Public API. يرث عزل المستأجر
 * (BaseModel) دفاعًا في العمق، لكنه ليس موردًا يقرؤه المستأجر.
 *
 * الاحتفاظ: تُقلَّم السجلّات الأقدم من نافذة محدّدة عبر `public-api:prune`.
 * متوافق SQLite + PostgreSQL. الكتابة **fail-open**: فشل التدقيق لا يكسر الـ API.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('public_api_request_logs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            // nullOnDelete: يبقى أثر التدقيق حتى لو حُذف العميل لاحقًا.
            $table->foreignUuid('api_client_id')->nullable()->constrained('api_clients')->nullOnDelete();

            $table->string('request_id', 128)->nullable();
            $table->string('method', 10);
            $table->string('route_identity', 191)->nullable();
            $table->string('path', 191)->nullable();
            // قائمة سماح مطبَّعة (page/per_page/sort/type/status) — لا نصّ بحثٍ حرّ.
            $table->json('query_params')->nullable();
            $table->string('scope', 64)->nullable();

            $table->unsignedSmallInteger('response_status')->nullable();
            $table->unsignedInteger('duration_ms')->nullable();
            $table->boolean('rate_limited')->default(false);
            // replayed | in_progress | conflict | created | null — أثر idempotency.
            $table->string('idempotency_status', 20)->nullable();

            $table->string('ip', 45)->nullable();            // IPv4/IPv6 (تدقيق أمني).
            $table->string('user_agent', 255)->nullable();

            $table->timestamps();

            $table->index(['tenant_id', 'created_at'], 'public_api_log_tenant_time_idx');
            $table->index('created_at', 'public_api_log_created_idx');   // احتفاظ/تنظيف.
            $table->index('request_id', 'public_api_log_request_idx');   // ربط الأثر.
            $table->index('api_client_id', 'public_api_log_client_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('public_api_request_logs');
    }
};
