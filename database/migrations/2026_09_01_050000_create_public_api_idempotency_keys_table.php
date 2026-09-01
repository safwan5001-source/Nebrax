<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * مفاتيح Idempotency للـ Public API — أساس دائم يحمي مسارات الكتابة المستقبلية
 * (PR-5) من التنفيذ المزدوج عند إعادة إرسال العميل الطلبَ نفسه.
 *
 * السجلّ **بيانات وصفية فقط**: لا يُخزَّن المفتاح الخام (تُخزَّن تجزئته sha256)،
 * ولا جسم الطلب (تُخزَّن بصمته sha256 لكشف التعارض)، ولا أي ترويسة تفويض. يُخزَّن
 * جسم الاستجابة الناجحة (2xx) **محدود الحجم** لإعادة التشغيل الحرفية عند التكرار.
 *
 * **بوابة التزامن = قيد فريد** `(tenant_id, api_client_id, key_hash)`: طلبان
 * متزامنان بالمفتاح نفسه يتسابقان على الإدراج، فيفوز واحد (ينفّذ العملية) ويصطدم
 * الآخر بالقيد فيُعامَل تكرارًا (إعادة تشغيل/تعارض/قيد التنفيذ) — بلا تنفيذ مزدوج.
 * PostgreSQL هو المرجع الأقوى للتزامن؛ SQLite يسلسل الكتابة فيصمد القيد أيضًا.
 *
 * متوافق مع SQLite وPostgreSQL (UUID + FK + json + text قياسية، بلا سلوك خاص).
 * الاحتفاظ: تُحذف السجلّات المنتهية عبر أمر Artisan (`public-api:prune`)، فلا جدول
 * ينمو بلا حدّ. لا اعتماد على طابور خلفي (الإنتاج `QUEUE_CONNECTION=sync`).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('public_api_idempotency_keys', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('api_client_id')->constrained('api_clients')->cascadeOnDelete();

            // تجزئة sha256 (64 hex) للمفتاح الخام — الخام لا يُخزَّن إطلاقًا.
            $table->string('key_hash', 64);
            $table->string('method', 10);
            // هوية المسار المطبَّعة (اسم المسار أو method+path) — للتشخيص والتدقيق.
            $table->string('route_identity', 191)->nullable();
            // بصمة sha256 (64 hex) لتمثيل الطلب المُقنّن (method+path+query+body) —
            // للكشف عن «نفس المفتاح بحمولة مختلفة» ⇒ تعارض. الحمولة الخام لا تُخزَّن.
            $table->string('request_fingerprint', 64);

            // in_progress → completed. الفاشل/الخطأ يُحرَّر (يُحذف) فلا يُعاد تشغيله.
            $table->string('status', 20)->default('in_progress');
            $table->unsignedSmallInteger('response_status')->nullable();
            // جسم الاستجابة الناجحة المحدود (≤64KB) لإعادة التشغيل الحرفية.
            $table->text('response_body')->nullable();
            // ترويسات آمنة محدودة لإعادة البناء (Content-Type فقط) — لا أسرار.
            $table->json('response_headers')->nullable();

            $table->timestamp('locked_at')->nullable();     // وقت المطالبة (كشف القفل المهجور).
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('expires_at');                 // احتفاظ حتمي.
            $table->timestamps();

            // بوابة التزامن: مفتاحٌ واحد فعّال لكل (مستأجر، عميل).
            $table->unique(['tenant_id', 'api_client_id', 'key_hash'], 'public_api_idem_unique');
            // مسار التنظيف/الاحتفاظ.
            $table->index('expires_at', 'public_api_idem_expires_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('public_api_idempotency_keys');
    }
};
