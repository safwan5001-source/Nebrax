<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * MOBILE-PREVIEW-7 — مراجع تبادل QR/رابط عميق لمرّة واحدة (تطبيق حرفي لِما
 * أجّلته وثيقة معمارية MP-5 §5.14 صراحةً إلى هذه المهمة، ولنمط
 * `auth_action_tokens`/`customer_otp_codes` القائم بالفعل).
 *
 * **هذا الصفّ نيّة إنشاء جلسة، لا جلسة بذاتها**: `schema_snapshot`/
 * `draft_revision` يُنسخان من المسودة الحيّة وقت *إصدار المرجع* — لا وقت
 * التبادل — فالجلسة الفعلية (`preview_sessions` + توكن Sanctum) لا تُنشَأ إلا
 * عند تبادلٍ ناجح واحد (`PreviewExchangeService::consume()`)، فلا بصمة عمل
 * خامّة تُصدَر ولا تُستهلَك أبداً تبقى معلّقة في الخادم.
 *
 * **هاش فقط**: `reference_hash` (sha256 hex) — نفس شكل `auth_action_tokens`،
 * لا يُخزَّن النصّ الخام هنا ولا في أي مكان آخر بعد إعادته مرّة واحدة.
 *
 * **مرّة واحدة**: `consumed_at` يُختَم داخل معاملة مقفَلة (`lockForUpdate`) —
 * أول تبادل ناجح فقط، أي محاولة لاحقة لنفس المرجع تُرفَض (`§8` من المهمة).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('preview_exchange_references', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('builder_app_id')->constrained('builder_apps')->cascadeOnDelete();

            $table->string('reference_hash', 64)->unique();

            // نيّة إنشاء جلسة — لقطة مجمَّدة وقت إصدار المرجع، لا مؤشر حيّ.
            $table->json('schema_snapshot');
            $table->unsignedInteger('draft_revision');

            $table->string('channel', 16)->default('device');
            $table->string('device_label')->nullable();

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamp('expires_at');
            $table->timestamp('consumed_at')->nullable();

            // الجلسة الناتجة عن تبادل ناجح — null حتى يُستهلَك المرجع فعلياً.
            $table->foreignUuid('preview_session_id')->nullable()
                ->constrained('preview_sessions')->nullOnDelete();

            $table->timestamps();

            $table->index(['tenant_id', 'builder_app_id']);
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('preview_exchange_references');
    }
};
