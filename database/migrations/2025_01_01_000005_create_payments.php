<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // المدفوعات (Payments) — سندات القبض والصرف
        // المبالغ بالـ minor units (هللات) كـ bigint
        // ═══════════════════════════════════════════════════════
        Schema::create('payments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('number');                              // REC-2025-00001 | PAY-2025-00001
            $table->foreignUuid('partner_id')->constrained('partners')->restrictOnDelete();
            $table->foreignUuid('invoice_id')->nullable()->constrained('invoices')->nullOnDelete();
            $table->enum('direction', ['received', 'paid'])->default('received'); // قبض | صرف
            $table->enum('method', ['cash', 'bank'])->default('cash');            // نقدي | بنكي
            $table->date('payment_date');
            $table->bigInteger('amount')->default(0);
            $table->enum('status', ['draft', 'posted', 'cancelled'])->default('draft');
            $table->string('notes')->nullable();
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'partner_id']);
            $table->index(['tenant_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payments');
    }
};
