<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * أساس الـ Webhooks الصادرة للـ Public API (PR-7) — تسليم أحداث موثوق ومعزول
 * بالمستأجر على البنية القائمة فعلاً (لا Redis ولا عامل خلفي؛ الإنتاج
 * `QUEUE_CONNECTION=sync`). ثلاثة جداول:
 *
 *  - `webhook_endpoints`  اشتراكات المستأجر: وجهة + أنواع أحداث + سرّ توقيع
 *    (مشفَّر at-rest عبر cast `encrypted`، لا يُخزَّن خامًا).
 *  - `webhook_events`     صندوق صادر دائم (outbox): الحدث المنطقي بمعرّف ثابت.
 *  - `webhook_deliveries` محاولة تسليم لكل (حدث، اشتراك) بحالة وعدّاد محاولات
 *    وموعد استحقاق و«إيجار» (lease) للمطالبة الآمنة بين مُشغّلات متزامنة.
 *
 * متوافق مع SQLite وPostgreSQL (UUID + FK + json + text قياسية). التزامن مرجعه
 * PostgreSQL؛ المطالبة الذرّية (`UPDATE ... WHERE status/​reserved_until`) تصمد
 * على المحرّكين. الاحتفاظ عبر أمر Artisan (`webhooks:prune`) فلا تنمو الجداول بلا حدّ.
 */
return new class extends Migration
{
    public function up(): void
    {
        // اشتراكات المستأجر (CompanyWide): وجهة تسليم موقَّعة وأنواع أحداث مختارة.
        Schema::create('webhook_endpoints', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            // أثر المنشأ: أي عميل API أنشأ الاشتراك (اختياري — المستأجر هو المالك الحاسم).
            $table->foreignUuid('api_client_id')->nullable()->constrained('api_clients')->nullOnDelete();
            $table->string('url', 2048);
            $table->string('description', 255)->nullable();
            // أنواع الأحداث المشترَك بها — قائمة سماح مُتحقَّقة عند الكتابة.
            $table->json('event_types');
            // سرّ التوقيع: مشفَّر at-rest (cast `encrypted` بمفتاح التطبيق)؛ الخادم
            // يفكّه وقت التسليم لحساب HMAC. لا يُخزَّن خامًا ولا يُعاد بعد الإنشاء.
            $table->text('secret');
            // مُعرِّف غير سرّي للعرض/الإدارة (بادئة السرّ) — لا يكشف السرّ.
            $table->string('secret_prefix', 32);
            // enabled | disabled — المعطَّل لا يستقبل أي حدث.
            $table->string('status', 20)->default('enabled');
            $table->timestamp('disabled_at')->nullable();
            $table->timestamp('last_success_at')->nullable();
            $table->timestamp('last_failure_at')->nullable();
            $table->timestamps();

            $table->index('tenant_id', 'webhook_endpoints_tenant_idx');
            $table->index(['tenant_id', 'status'], 'webhook_endpoints_tenant_status_idx');
        });

        // الصندوق الصادر الدائم: الحدث المنطقي بمعرّف ثابت (= معرّف المغلَّف).
        Schema::create('webhook_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('type', 80);
            $table->string('api_version', 20)->default('v1');
            // أثر المنشأ للمنتِج (للتشخيص ومنع الازدواج) — النموذج المصدر ومعرّفه.
            $table->string('source_type', 191)->nullable();
            $table->uuid('source_id')->nullable();
            // حمولة `data` المُنتقاة (مورد Public لا Eloquent خام).
            $table->json('payload');
            $table->timestamp('occurred_at');
            $table->timestamps();

            $table->index(['tenant_id', 'type'], 'webhook_events_tenant_type_idx');
            $table->index('created_at', 'webhook_events_created_idx');
            // منع ازدواج نفس الحدث المنطقي: حدثٌ واحد لكل (مصدر، نوع). المصدر
            // معرّفه UUID عالميّ، فالقيد عالميّ عبر المستأجرين بلا تسريب.
            $table->unique(['source_type', 'source_id', 'type'], 'webhook_events_source_unique');
        });

        // محاولة تسليم لكل (حدث، اشتراك): حالة + محاولات + استحقاق + إيجار مطالبة.
        Schema::create('webhook_deliveries', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('webhook_event_id')->constrained('webhook_events')->cascadeOnDelete();
            $table->foreignUuid('webhook_endpoint_id')->constrained('webhook_endpoints')->cascadeOnDelete();
            // pending | processing | delivered | retry_scheduled | failed
            $table->string('status', 20)->default('pending');
            $table->unsignedInteger('attempts')->default(0);
            // موعد الاستحقاق (NULL في الحالة النهائية delivered/failed).
            $table->timestamp('next_attempt_at')->nullable();
            // إيجار المطالبة أثناء المعالجة: مُشغّل آخر لا يطالب حتى انقضائه (استعادة المهجور).
            $table->timestamp('reserved_until')->nullable();
            $table->unsignedSmallInteger('last_status_code')->nullable();
            $table->string('last_error', 255)->nullable();
            $table->unsignedInteger('last_duration_ms')->nullable();
            // مقتطف استجابة محدود (تشخيص) — لا يُخزَّن جسم ضخم ولا ترويسات حسّاسة.
            $table->text('last_response_snippet')->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->timestamp('failed_at')->nullable();
            $table->timestamps();

            // مسح المستحقّات (المطالبة): (status, next_attempt_at).
            $table->index(['status', 'next_attempt_at'], 'webhook_deliveries_due_idx');
            $table->index('tenant_id', 'webhook_deliveries_tenant_idx');
            $table->index('webhook_event_id', 'webhook_deliveries_event_idx');
            // لا صفَّ تسليم مكرَّر لنفس (الحدث، الاشتراك).
            $table->unique(['webhook_event_id', 'webhook_endpoint_id'], 'webhook_deliveries_event_endpoint_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('webhook_deliveries');
        Schema::dropIfExists('webhook_events');
        Schema::dropIfExists('webhook_endpoints');
    }
};
