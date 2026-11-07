<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * FUEL-B6 (تعديل) — طلبات القراءات المتأخرة + بصمة النية لإصلاح idempotency.
 *
 * ═══ الطلبات ═══
 *  سياسة `supervisor_approval`: القراءة بتاريخ سابق **لا تدخل `fuel_tank_readings`** حتى يعتمدها مشرف مخوَّل؛ تُحفظ هنا بحالة `pending` (بانتظار الموافقة) بوقت قياسها الأصلي
 *  وسببها. القرار (اعتماد/رفض) يُسجَّل بالفاعل والوقت والملاحظة؛ والاعتماد ينشئ القراءة (`fuel_tank_reading_id`) بوقت القياس الأصلي، فيبقى وقت القياس
 *  (`measured_at`) ووقت الاعتماد (`decided_at`) منفصلين. طلب مقرَّر لا يتغيّر ولا يُحذف (يحرسه النموذج والخدمة).
 *  لا مفتاح أجنبي جديد على `fuel_tank_readings` (جدول الأدلة الثابتة لا يُمسّ بنيوياً).
 *
 * ═══ بصمة النية ═══
 *  `intent_hash` (SHA-256) على القراءة والطلب: بصمة حمولة النية كلها (المحطة/الخزان/النوع/الكمية/الفاعل/الوقت الصريح/الأدلة/السبب). `NULL` للصفوف القائمة
 *  (لا Backfill ولا تحويل): تُقارَن بحقولها الظاهرة. تمكّن مقارنة نفس مفتاح الدليل بحمولة كاملة دون ادّعاء تعارض زائف حين غاب الوقت الصريح.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_tank_readings', function (Blueprint $table) {
            $table->char('intent_hash', 64)->nullable()->after('evidence_key');
        });

        Schema::create('fuel_tank_reading_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->restrictOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->restrictOnDelete();
            $table->foreignUuid('fuel_tank_id')->constrained('fuel_tanks')->restrictOnDelete();
            $table->string('reading_type', 20);
            $table->unsignedBigInteger('quantity_milliliters');
            $table->timestamp('measured_at'); // وقت القياس الأصلي (يبقى كما هو عند الاعتماد)
            $table->string('evidence_key', 128);
            $table->char('intent_hash', 64);
            $table->json('evidence')->nullable();
            $table->string('reason', 500)->nullable();
            $table->string('status', 20)->default('pending'); // pending | approved | rejected
            $table->foreignUuid('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->string('decision_note', 500)->nullable();
            $table->foreignUuid('fuel_tank_reading_id')->nullable()->constrained('fuel_tank_readings')->restrictOnDelete();
            $table->timestamps(); // created_at = وقت تقديم الطلب

            // مفتاح الدليل فريد للمؤسسة عبر الطلبات (والقراءات لها فهرسها)؛ يمنع تكرار الطلب نفسه ولو تزامن.
            $table->unique(['tenant_id', 'evidence_key'], 'fuel_reading_request_evidence_unique');
            $table->unique('fuel_tank_reading_id', 'fuel_reading_request_reading_unique');
            $table->index(['tenant_id', 'branch_id', 'fuel_station_id', 'status', 'created_at'], 'fuel_reading_request_queue_idx');
        });
    }

    public function down(): void
    {
        // لا فقدان صامت لطلبات/قرارات: يمتنع التراجع متى وُجد أي طلب.
        if (Schema::hasTable('fuel_tank_reading_requests') && DB::table('fuel_tank_reading_requests')->exists()) {
            throw new RuntimeException('لا يمكن التراجع: توجد طلبات قراءات متأخرة مسجَّلة.');
        }

        Schema::dropIfExists('fuel_tank_reading_requests');
        Schema::table('fuel_tank_readings', function (Blueprint $table) {
            $table->dropColumn('intent_hash');
        });
    }
};
