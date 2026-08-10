<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  دورة الشراء — طلب شراء · طلب عروض · عرض مورّد · أمر شراء
     * ═══════════════════════════════════════════════════════════════
     *  أربعة مستندات **تجارية لا محاسبية**: لا يولّد أيٌّ منها قيداً. الأثر
     *  المحاسبي يبدأ عند ترحيل فاتورة المشتريات الناتجة (`PurchaseService::post`)
     *  — تماماً كما أن عرض السعر لا يقيَّد حتى تُرحَّل فاتورته.
     *
     *  لذلك جدول واحد بـ `type` لا أربعة جداول: الشكل واحد (رأس + سطور +
     *  حالة + تحويل)، والاختلاف في التسمية والتسلسل فقط — نفس نمط
     *  `ReturnDocument` و`CreditNote`.
     *
     *  `source_document_id` مرجع ذاتي يبني السلسلة، فيُتتبَّع أي أمر شراء
     *  رجوعاً إلى الطلب الذي وُلد منه؛ و`converted_purchase_id` يغلقها عند
     *  الفاتورة.
     */
    public function up(): void
    {
        Schema::create('procurement_documents', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();

            // request طلب شراء · rfq طلب عروض · quotation عرض مورّد · order أمر شراء
            $table->enum('type', ['request', 'rfq', 'quotation', 'order']);
            $table->string('number');                                   // PR/RFQ/PQ/PO-2025-00001

            // الطلب وطلب العروض بلا مورّد محدَّد؛ العرض والأمر يلزمهما مورّد.
            $table->foreignUuid('partner_id')->nullable()->constrained('partners')->restrictOnDelete();

            $table->date('doc_date');
            $table->date('due_date')->nullable();                       // تاريخ الحاجة/الصلاحية/التسليم حسب النوع
            $table->string('requested_by')->nullable();                 // الجهة الطالبة (لطلب الشراء)

            $table->enum('status', ['draft', 'submitted', 'approved', 'rejected', 'converted', 'cancelled'])
                ->default('draft');

            $table->bigInteger('subtotal')->default(0);
            $table->bigInteger('tax_amount')->default(0);
            $table->bigInteger('total')->default(0);
            $table->boolean('tax_inclusive')->default(false);
            $table->string('notes')->nullable();

            // سلسلة المستندات: طلب → طلب عروض → عرض مورّد → أمر شراء → فاتورة
            $table->foreignUuid('source_document_id')->nullable()
                ->constrained('procurement_documents')->nullOnDelete();
            $table->foreignUuid('converted_purchase_id')->nullable()
                ->constrained('purchases')->nullOnDelete();

            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'type', 'status']);
            $table->index(['tenant_id', 'partner_id']);
            $table->index(['tenant_id', 'branch_id']);
        });

        Schema::create('procurement_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('procurement_document_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('description')->nullable();
            $table->integer('quantity')->default(1);
            $table->bigInteger('unit_price')->default(0);               // هللات — صفر مسموح في الطلب وطلب العروض
            $table->unsignedSmallInteger('tax_rate')->default(15);
            $table->bigInteger('line_subtotal')->default(0);
            $table->bigInteger('line_tax')->default(0);
            $table->bigInteger('line_total')->default(0);
            $table->timestamps();

            $table->index(['tenant_id', 'procurement_document_id']);
        });

        // الموردون المدعوّون لطلب العروض — علاقة طلب العروض بالموردين.
        Schema::create('rfq_invitations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('procurement_document_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('partner_id')->constrained('partners')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['procurement_document_id', 'partner_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('rfq_invitations');
        Schema::dropIfExists('procurement_lines');
        Schema::dropIfExists('procurement_documents');
    }
};
