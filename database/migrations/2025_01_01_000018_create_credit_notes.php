<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // الإشعارات الدائنة (Credit Notes) — إشعار مالي للعميل.
        // مستند مالي صرف (بلا حركة مخزون). يُرحَّل بقيد عكسي عبر المحرك:
        //   مدين 4110 المبيعات + مدين 2120 ضريبة المخرجات
        //   دائن 1130 العملاء (آجل) أو 1110 الصندوق (استرداد نقدي)
        // كل المبالغ بالـ minor units (هللات) كـ bigint.
        // ═══════════════════════════════════════════════════════
        Schema::create('credit_notes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('number');                                   // CN-2025-00001
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete();
            $table->enum('refund_type', ['credit', 'cash'])->default('credit'); // تخفيض ذمة | استرداد نقدي
            $table->date('note_date');
            $table->enum('status', ['draft', 'posted', 'cancelled'])->default('draft');
            $table->bigInteger('subtotal')->default(0);
            $table->bigInteger('tax_amount')->default(0);
            $table->bigInteger('total')->default(0);
            $table->string('reason')->nullable();
            $table->foreignUuid('original_invoice_id')->nullable()->constrained('invoices')->nullOnDelete();
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'partner_id']);
            $table->index(['tenant_id', 'status']);
        });

        Schema::create('credit_note_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('credit_note_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('description')->nullable();
            $table->integer('quantity')->default(1);
            $table->bigInteger('unit_price')->default(0);
            $table->unsignedSmallInteger('tax_rate')->default(15);
            $table->bigInteger('line_subtotal')->default(0);
            $table->bigInteger('line_tax')->default(0);
            $table->bigInteger('line_total')->default(0);
            $table->timestamps();

            $table->index(['tenant_id', 'credit_note_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('credit_note_lines');
        Schema::dropIfExists('credit_notes');
    }
};
