<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * القيود اليدوية تبقى مستندات مسودة مستقلة حتى ترحيلها عبر LedgerService.
     * لا تُكتب journal_entries أو journal_lines من هذه الهجرة أو من المتحكمات.
     */
    public function up(): void
    {
        Schema::create('manual_journals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('number'); // MJE-2025-00001
            $table->date('entry_date');
            $table->string('description', 1000)->nullable();
            $table->enum('status', ['draft', 'posted', 'reversed'])->default('draft');
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->nullOnDelete();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'branch_id', 'number'], 'manual_journals_tenant_branch_number_unique');
            $table->index(['tenant_id', 'branch_id', 'status']);
            $table->index(['tenant_id', 'entry_date']);
        });

        // PostgreSQL وSQLite يسمحان بتكرار NULL في القيد المركب؛ هذا الفهرس يحمي
        // المستندات المركزية صراحةً، ويكمل القيد الفريد للمستندات الموسومة بفرع.
        DB::statement(
            'CREATE UNIQUE INDEX manual_journals_tenant_number_null_branch_unique '
            . 'ON manual_journals (tenant_id, number) WHERE branch_id IS NULL'
        );

        Schema::create('manual_journal_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('manual_journal_id')->constrained('manual_journals')->cascadeOnDelete();
            $table->foreignUuid('account_id')->constrained('accounts')->restrictOnDelete();
            $table->string('description', 1000)->nullable();
            $table->bigInteger('debit')->default(0);  // هللات
            $table->bigInteger('credit')->default(0); // هللات
            $table->string('partner_type')->nullable();
            $table->uuid('partner_id')->nullable();
            $table->foreignUuid('cost_center_id')->nullable()->constrained('cost_centers')->nullOnDelete();
            $table->unsignedSmallInteger('sort_order');
            $table->timestamps();

            $table->unique(['manual_journal_id', 'sort_order'], 'manual_journal_lines_order_unique');
            $table->index(['tenant_id', 'account_id']);
            $table->index(['tenant_id', 'cost_center_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('manual_journal_lines');
        Schema::dropIfExists('manual_journals');
    }
};
