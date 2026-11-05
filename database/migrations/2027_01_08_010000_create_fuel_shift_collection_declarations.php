<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * إقرار تحصيل الوردية — جدولان إضافيان فقط (لا تعديل على أي جدول قائم، لا Backfill).
 *
 *  - `fuel_shift_collection_declarations`: إقرار واحد حيّ لكل وردية (قابل للاستبدال بنسخة ما دامت الوردية مفتوحة، ثم يُجمَّد عند `close`).
 *    يحمل توزيع التحصيل حسب طرق الدفع (بمعرّفات الطرق الحالية + لقطة الاسم والنوع) ولقطة المبيعات المشتقة من العدادات والفرق.
 *  - `fuel_shift_collection_revisions`: سجل append-only لكل نسخة محفوظة بمفتاح idempotency فريد للمؤسسة (منع التكرار والتدقيق).
 *
 * تشغيلي فقط: لا سند قبض ولا فاتورة ولا قيد ولا مدخل خزينة. التراجع يرفض متى وُجد أي إقرار.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fuel_shift_collection_declarations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_station_id')->constrained('fuel_stations')->cascadeOnDelete();
            $table->foreignUuid('fuel_shift_id')->constrained('fuel_shifts')->cascadeOnDelete();
            $table->unsignedInteger('revision')->default(1);
            $table->string('status', 16)->default('declared'); // declared → frozen (عند إغلاق الوردية)
            $table->string('payload_hash', 64);
            $table->json('lines'); // [{payment_method_id,name,settlement_type,amount_minor}]
            $table->bigInteger('collected_total_minor')->default(0);
            $table->bigInteger('cash_declared_minor')->default(0);
            $table->bigInteger('network_declared_minor')->default(0);

            // لقطة المبيعات المشتقة من فرق العدادين × السعر الفعّال (تشغيلية، ليست فاتورة).
            $table->bigInteger('sales_milliliters')->nullable();
            $table->boolean('sales_milliliters_complete')->default(false);
            $table->bigInteger('sales_minor')->nullable(); // null ⇒ غير موثوق (لا رقم جزئي كإجمالي)
            $table->boolean('sales_complete')->default(false);
            $table->string('sales_tax_mode', 16)->nullable();
            $table->json('sales_breakdown')->nullable();
            $table->json('sales_gaps')->nullable();
            $table->timestamp('sales_evaluated_at')->nullable();
            $table->bigInteger('difference_minor')->nullable(); // collected − sales؛ null ⇒ غير نهائي

            // لقطة الدرج عند الإغلاق (تُملأ عند التجميد فقط).
            $table->bigInteger('opening_float_minor')->nullable();
            $table->bigInteger('counted_cash_minor')->nullable();
            $table->bigInteger('cash_in_minor')->nullable();
            $table->bigInteger('cash_out_minor')->nullable();
            $table->bigInteger('treasury_handover_minor')->nullable();
            $table->bigInteger('expenses_minor')->nullable();
            $table->bigInteger('drawer_implied_sales_cash_minor')->nullable();
            $table->bigInteger('cash_cross_difference_minor')->nullable();

            // مراجعة المشرف لفرق المطابقة (Q3): السبب يُوثَّق عند الإغلاق (ملاحظة الإغلاق) والمراجعة مرة واحدة بلا تعديل لما جُمِّد.
            $table->boolean('review_required')->default(false);
            $table->text('difference_reason')->nullable();
            $table->foreignUuid('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('reviewed_at')->nullable();
            $table->text('review_note')->nullable();

            $table->foreignUuid('declared_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('declared_at');
            $table->timestamp('frozen_at')->nullable();
            $table->timestamps();

            $table->unique('fuel_shift_id');
            $table->index(['tenant_id', 'fuel_station_id', 'status']);
        });

        Schema::create('fuel_shift_collection_revisions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('fuel_shift_id')->constrained('fuel_shifts')->cascadeOnDelete();
            $table->foreignUuid('declaration_id')->constrained('fuel_shift_collection_declarations')->cascadeOnDelete();
            $table->unsignedInteger('revision');
            $table->string('idempotency_key', 120);
            $table->string('payload_hash', 64);
            $table->json('lines');
            $table->bigInteger('collected_total_minor');
            $table->foreignUuid('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('occurred_at');
            $table->timestamps();

            $table->unique(['tenant_id', 'idempotency_key']);
            $table->unique(['fuel_shift_id', 'revision']);
        });
    }

    public function down(): void
    {
        if (DB::table('fuel_shift_collection_declarations')->exists()) {
            throw new RuntimeException('لا يمكن التراجع: توجد إقرارات تحصيل وردية مسجّلة.');
        }
        Schema::dropIfExists('fuel_shift_collection_revisions');
        Schema::dropIfExists('fuel_shift_collection_declarations');
    }
};
