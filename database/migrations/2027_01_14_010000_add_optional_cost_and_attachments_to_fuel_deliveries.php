<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * FUEL-B5.1 — تكلفة الاستلام اختيارية حتى تُسجَّل، ومرفقات سند المورد.
 *
 * ═══ التكلفة ═══
 *  `received_unit_cost_minor` و`received_total_cost_minor` كانتا NOT NULL فكان موظف المحطة (بلا `products.view_cost`) عاجزاً عن بدء استلام.
 *  تُصبحان nullable: **NULL = لم تُسجَّل بعد** (لا صفر). كل الصفوف القائمة تحتفظ بقيمها كما هي (لا Backfill ولا تحويل).
 *  الاعتماد يرفض التكلفة الفارغة (`FuelSupplyReceivingService::assertApprovable`) فلا يصل NULL إلى المخزون أو القيد أو متوسط التكلفة قط.
 *  `cost_recorded_by/at`: من سجّل التكلفة ومتى (NULL للصفوف القديمة = «لم تُسجَّل بهذا الإجراء»، لا خطأ). القيمة نفسها لا تُنسخ إلى التدقيق.
 *
 * ═══ المرفقات ═══
 *  جدول مرفقات خاص بالاستلام على نمط `purchase_attachments`/`expense_attachments` (لكل نطاق جدوله)، والتخزين `AttachmentStorage` القائم (R2/محلي)
 *  بنطاق مفتاح جديد؛ لا نظام تخزين موازٍ. `fuel_delivery_id` بـ`cascadeOnDelete` كبقية المرفقات؛ والاستلام المعتمد لا يُحذف أصلاً.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fuel_deliveries', function (Blueprint $table) {
            $table->unsignedBigInteger('received_unit_cost_minor')->nullable()->change();
            $table->unsignedBigInteger('received_total_cost_minor')->nullable()->change();
            $table->foreignUuid('cost_recorded_by')->nullable()->after('received_total_cost_minor')->constrained('users')->nullOnDelete();
            $table->timestamp('cost_recorded_at')->nullable()->after('cost_recorded_by');
        });

        Schema::create('fuel_delivery_attachments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->foreignUuid('fuel_delivery_id')->constrained('fuel_deliveries')->cascadeOnDelete();
            $table->string('disk');
            $table->string('path');
            $table->string('original_name');
            $table->string('mime_type', 100)->nullable();
            $table->unsignedBigInteger('size');
            $table->char('sha256', 64)->nullable();
            $table->foreignUuid('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['tenant_id', 'fuel_delivery_id']);
            // نفس المحتوى لا يُرفق مرتين لاستلام واحد (إعادة رفع بعد انقطاع الرد لا تُكرّر الملف).
            $table->unique(['fuel_delivery_id', 'sha256'], 'fuel_delivery_attachment_content_unique');
        });
    }

    public function down(): void
    {
        // التراجع يعيد NOT NULL فيمتنع إن وُجدت مسودة بلا تكلفة أو مرفق: لا فقدان صامت ولا تحويل NULL إلى صفر.
        if (DB::table('fuel_deliveries')->whereNull('received_total_cost_minor')->exists()
            || DB::table('fuel_delivery_attachments')->exists()) {
            throw new RuntimeException('لا يمكن التراجع: توجد استلامات بلا تكلفة أو مرفقات سند.');
        }

        Schema::dropIfExists('fuel_delivery_attachments');
        Schema::table('fuel_deliveries', function (Blueprint $table) {
            $table->dropConstrainedForeignId('cost_recorded_by');
            $table->dropColumn('cost_recorded_at');
            $table->unsignedBigInteger('received_unit_cost_minor')->nullable(false)->change();
            $table->unsignedBigInteger('received_total_cost_minor')->nullable(false)->change();
        });
    }
};
