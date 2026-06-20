<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // فواتير المشتريات (Purchases) — رأس الفاتورة
        // المبالغ بالـ minor units (هللات) كـ bigint
        // ═══════════════════════════════════════════════════════
        Schema::create('purchases', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('number');                              // BILL-2025-00001
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete(); // المورد
            $table->enum('payment_type', ['cash', 'credit'])->default('credit');
            $table->date('purchase_date');
            $table->date('due_date')->nullable();
            $table->string('supplier_invoice_no')->nullable();     // رقم فاتورة المورد الأصلية
            $table->enum('status', ['draft', 'posted', 'cancelled'])->default('draft');
            $table->bigInteger('subtotal')->default(0);
            $table->bigInteger('tax_amount')->default(0);          // ضريبة المدخلات
            $table->bigInteger('total')->default(0);
            $table->string('notes')->nullable();
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'partner_id']);
            $table->index(['tenant_id', 'status']);
        });

        // سطور فاتورة المشتريات
        Schema::create('purchase_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('purchase_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('description')->nullable();
            $table->integer('quantity')->default(1);
            $table->bigInteger('unit_price')->default(0);          // تكلفة الوحدة (هللات)
            $table->unsignedSmallInteger('tax_rate')->default(15);
            $table->bigInteger('line_subtotal')->default(0);
            $table->bigInteger('line_tax')->default(0);
            $table->bigInteger('line_total')->default(0);
            $table->timestamps();

            $table->index(['tenant_id', 'purchase_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_lines');
        Schema::dropIfExists('purchases');
    }
};
