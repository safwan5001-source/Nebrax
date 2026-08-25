<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_transaction_links', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id')->index();
            $table->uuid('branch_id')->nullable()->index();
            $table->uuid('document_batch_id');
            $table->uuid('document_extraction_result_id');
            $table->string('transaction_type', 32);
            $table->uuid('transaction_id');
            $table->string('status', 32)->default('created');
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();

            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign('branch_id')->references('id')->on('branches')->nullOnDelete();
            $table->foreign('document_batch_id')->references('id')->on('document_batches')->restrictOnDelete();
            $table->foreign('document_extraction_result_id')->references('id')->on('document_extraction_results')->restrictOnDelete();
            $table->foreign('transaction_id')->references('id')->on('purchases')->restrictOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();
            $table->unique(['tenant_id', 'branch_id', 'document_batch_id', 'transaction_type'], 'document_transaction_link_once');
            $table->index(['tenant_id', 'branch_id', 'transaction_id'], 'document_transaction_link_transaction');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_transaction_links');
    }
};
