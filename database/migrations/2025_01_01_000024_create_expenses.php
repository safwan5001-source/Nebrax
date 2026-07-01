<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // ═══════════════════════════════════════════════════════
        // المصروفات (Expenses) — مستند مالي صرف (بلا مخزون).
        // يُرحَّل بقيد متوازن عبر المحرك:
        //   مدين  5xxx حساب المصروف   (المبلغ)
        //   مدين  1150 ضريبة المدخلات (إن وُجدت ضريبة)
        //   دائن  1110 الصندوق | 1120 البنك | 2110 الموردون (الإجمالي)
        // كل المبالغ بالـ minor units (هللات) كـ bigint.
        // ═══════════════════════════════════════════════════════
        Schema::create('expenses', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('number');                                   // EXP-2025-00001
            $table->foreignUuid('account_id')->constrained('accounts')->restrictOnDelete(); // حساب المصروف (نوع expense)
            $table->foreignUuid('partner_id')->nullable()->constrained('partners')->nullOnDelete(); // المورّد (اختياري)
            $table->uuid('cost_center_id')->nullable();                 // مركز التكلفة (بُعد تحليلي)
            $table->date('expense_date');
            $table->enum('payment_method', ['cash', 'bank', 'credit'])->default('cash');
            $table->string('description')->nullable();
            $table->bigInteger('amount')->default(0);                   // أساس المصروف (قبل الضريبة)
            $table->unsignedSmallInteger('tax_rate')->default(15);
            $table->bigInteger('tax_amount')->default(0);
            $table->bigInteger('total')->default(0);
            $table->enum('status', ['draft', 'posted', 'cancelled'])->default('draft');
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'number']);
            $table->index(['tenant_id', 'status']);
            $table->index(['tenant_id', 'account_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('expenses');
    }
};
