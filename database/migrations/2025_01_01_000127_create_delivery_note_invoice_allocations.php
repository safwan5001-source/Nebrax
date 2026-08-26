<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        /*
         * مرساة طلب البناء: تخصيص واحد لمفتاح idempotency في المستأجر/الفرع،
         * مع checksum ليُرفض المفتاح نفسه عند تغيير الحمولة حتى لو لم تتداخل
         * السندات المختارة. لا تحمل هذه المرساة أي مبلغ أو أثر محاسبي.
         */
        Schema::create('delivery_note_invoice_draft_builds', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->restrictOnDelete();
            $table->string('idempotency_key', 128);
            $table->string('request_checksum', 64);
            $table->foreignUuid('invoice_id')->constrained('invoices')->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at');

            $table->unique(['tenant_id', 'branch_id', 'idempotency_key'], 'delivery_note_invoice_draft_builds_idempotency_unique');
            $table->unique('invoice_id');
            $table->index(['tenant_id', 'branch_id', 'invoice_id']);
        });

        /*
         * تخصيص MVP كامل: السند الواحد يربط بفاتورة واحدة فقط. لا cascade على
         * مصدر التسليم أو الفاتورة لأن إزالة الرابط تحرير صامت لدليل تدقيق.
         */
        Schema::create('delivery_note_invoice_allocations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->restrictOnDelete();
            $table->foreignUuid('delivery_note_invoice_draft_build_id')
                ->constrained('delivery_note_invoice_draft_builds')
                ->restrictOnDelete();
            $table->foreignUuid('delivery_note_id')->constrained('delivery_notes')->restrictOnDelete();
            $table->foreignUuid('invoice_id')->constrained('invoices')->restrictOnDelete();
            $table->string('delivery_note_number_snapshot');
            $table->string('delivery_note_status_snapshot', 32);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at');

            $table->unique('delivery_note_id');
            $table->index(['tenant_id', 'branch_id', 'invoice_id']);
            $table->index(['tenant_id', 'branch_id', 'delivery_note_id']);
        });

        /*
         * يدعم سطر فاتورة مجمّعاً من عدة سطور تسليم، لكن سطر التسليم لا يخصص
         * إلا مرة واحدة. لقطات الكمية والوحدة تحفظ قابلية التدقيق بلا float.
         */
        Schema::create('delivery_note_line_invoice_links', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained('branches')->restrictOnDelete();
            $table->foreignUuid('delivery_note_invoice_allocation_id')
                ->constrained('delivery_note_invoice_allocations')
                ->restrictOnDelete();
            $table->foreignUuid('delivery_note_line_id')->constrained('delivery_note_lines')->restrictOnDelete();
            $table->foreignUuid('invoice_line_id')->constrained('invoice_lines')->restrictOnDelete();
            $table->unsignedInteger('quantity');
            $table->unsignedInteger('quantity_numerator')->nullable();
            $table->unsignedInteger('quantity_denominator')->nullable();
            $table->string('unit_name');
            $table->unsignedInteger('unit_factor');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('created_at');

            $table->unique('delivery_note_line_id');
            $table->index(['tenant_id', 'branch_id', 'invoice_line_id']);
            $table->index(['tenant_id', 'branch_id', 'delivery_note_invoice_allocation_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_note_line_invoice_links');
        Schema::dropIfExists('delivery_note_invoice_allocations');
        Schema::dropIfExists('delivery_note_invoice_draft_builds');
    }
};
