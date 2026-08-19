<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_custody_settlements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            // تتبع التسوية فرع العهدة حتى تبقى الحركة والقيد ضمن النطاق ذاته.
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('number');
            $table->foreignUuid('employee_custody_id')->constrained('employee_custodies')->restrictOnDelete();
            $table->foreignUuid('settlement_type_id')->constrained('settlement_types')->restrictOnDelete();
            $table->foreignUuid('debit_account_id')->constrained('accounts')->restrictOnDelete();
            $table->date('settlement_date');
            $table->bigInteger('amount'); // هللات
            $table->text('notes')->nullable();
            // ينشأ السجل أولاً ليكون source للقيد، ثم يُربط القيد في المعاملة نفسها.
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->restrictOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'number']);
            $table->index(['tenant_id', 'employee_custody_id']);
            $table->index(['tenant_id', 'settlement_type_id']);
            $table->index(['tenant_id', 'settlement_date']);
        });

        // NULL لا يتصادم في الفهرس المركب؛ التسويات غير الموسومة بالفرع تحتاج قيداً صريحاً.
        DB::statement('CREATE UNIQUE INDEX employee_custody_settlements_unbranched_number_unique ON employee_custody_settlements (tenant_id, number) WHERE branch_id IS NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS employee_custody_settlements_unbranched_number_unique');
        Schema::dropIfExists('employee_custody_settlements');
    }
};
