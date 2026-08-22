<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('pos_exchanges', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->restrictOnDelete();
            $table->foreignUuid('pos_session_id')->constrained('pos_sessions')->restrictOnDelete();
            $table->foreignUuid('original_invoice_id')->constrained('invoices')->restrictOnDelete();
            $table->foreignUuid('return_id')->constrained('return_documents')->restrictOnDelete();
            $table->foreignUuid('replacement_invoice_id')->constrained('invoices')->restrictOnDelete();
            $table->unsignedBigInteger('applied_credit_amount')->default(0);
            $table->unsignedBigInteger('cash_refund_amount')->default(0);
            $table->foreignUuid('journal_entry_id')->nullable()->constrained('journal_entries')->restrictOnDelete();
            $table->string('status', 20)->default('draft');
            $table->text('notes')->nullable();
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'return_id'], 'pos_exchanges_tenant_return_unique');
            $table->unique(['tenant_id', 'replacement_invoice_id'], 'pos_exchanges_tenant_replacement_unique');
            $table->index(['tenant_id', 'branch_id', 'pos_session_id', 'status'], 'pos_exchanges_session_status_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('pos_exchanges');
    }
};
