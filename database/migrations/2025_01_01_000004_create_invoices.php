<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // الفواتير (Invoices) — رأس الفاتورة
        // المبالغ بالـ minor units (هللات) كـ bigint
        // ═══════════════════════════════════════════════════════
        Schema::create('invoices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('number');                              // رقم الفاتورة (INV-2025-00001)
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete();
            $table->enum('type', ['sale'])->default('sale');       // مبيعات (المشتريات لاحقاً)
            $table->enum('payment_type', ['cash', 'credit'])->default('cash'); // نقدي | آجل
            $table->date('invoice_date');
            $table->date('due_date')->nullable();
            $table->enum('status', ['draft', 'posted', 'cancelled'])->default('draft');
            $table->bigInteger('subtotal')->default(0);            // الإجمالي قبل الضريبة
            $table->bigInteger('tax_amount')->default(0);          // إجمالي الضريبة
            $table->bigInteger('total')->default(0);               // الإجمالي شامل الضريبة
            $table->string('notes')->nullable();
            // القيد الذي ولّدته الفاتورة عند الترحيل
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'partner_id']);
            $table->index(['tenant_id', 'status']);
        });

        // ═══════════════════════════════════════════════════════
        // سطور الفاتورة (Invoice Lines)
        // ═══════════════════════════════════════════════════════
        Schema::create('invoice_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('invoice_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('description')->nullable();
            $table->integer('quantity')->default(1);               // كمية (وحدات صحيحة)
            $table->bigInteger('unit_price')->default(0);          // سعر الوحدة (هللات)
            $table->unsignedSmallInteger('tax_rate')->default(15); // نسبة الضريبة %
            $table->bigInteger('line_subtotal')->default(0);       // quantity × unit_price
            $table->bigInteger('line_tax')->default(0);            // الضريبة على السطر
            $table->bigInteger('line_total')->default(0);          // الإجمالي شامل الضريبة
            $table->timestamps();

            $table->index(['tenant_id', 'invoice_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('invoice_lines');
        Schema::dropIfExists('invoices');
    }
};
