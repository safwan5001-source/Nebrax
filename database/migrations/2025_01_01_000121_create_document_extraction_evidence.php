<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_provider_attempts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_batch_id')->constrained('document_batches')->cascadeOnDelete();
            $table->foreignUuid('document_file_id')->constrained('document_files')->cascadeOnDelete();
            $table->foreignUuid('document_processing_run_id')->constrained('document_processing_runs')->cascadeOnDelete();
            $table->unsignedSmallInteger('sequence');
            $table->string('provider_key', 64);
            $table->string('model', 128);
            $table->string('status', 24)->default('started');
            $table->string('error_code', 64)->nullable();
            $table->string('error_message_safe', 500)->nullable();
            $table->unsignedInteger('page_count')->default(0);
            $table->unsignedBigInteger('input_tokens')->nullable();
            $table->unsignedBigInteger('output_tokens')->nullable();
            $table->string('provider_request_id', 128)->nullable();
            $table->unsignedInteger('processing_duration_ms')->nullable();
            $table->timestampTz('started_at');
            $table->timestampTz('finished_at')->nullable();
            $table->timestampsTz();

            $table->unique(['document_processing_run_id', 'sequence'], 'document_provider_attempt_sequence_unique');
            $table->index(['tenant_id', 'branch_id', 'provider_key', 'started_at'], 'document_provider_attempt_lookup');
        });

        Schema::create('document_extraction_results', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_batch_id')->constrained('document_batches')->cascadeOnDelete();
            $table->foreignUuid('document_file_id')->constrained('document_files')->cascadeOnDelete();
            $table->foreignUuid('document_processing_run_id')->constrained('document_processing_runs')->cascadeOnDelete();
            $table->foreignUuid('document_provider_attempt_id')->constrained('document_provider_attempts')->restrictOnDelete();
            $table->string('provider_key', 64);
            $table->string('model', 128);
            $table->string('schema_version', 32);
            $table->string('detected_document_type', 64)->nullable();
            $table->string('detected_language', 16)->nullable();
            $table->unsignedSmallInteger('confidence_basis_points')->nullable();
            $table->text('normalized_payload');
            $table->timestampTz('extracted_at');
            $table->timestampsTz();

            $table->unique('document_processing_run_id', 'document_extraction_result_run_unique');
            $table->index(['tenant_id', 'branch_id', 'document_batch_id'], 'document_extraction_result_batch_lookup');
        });

        Schema::create('document_provider_usage_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_provider_attempt_id')->constrained('document_provider_attempts')->cascadeOnDelete();
            $table->foreignUuid('document_batch_id')->constrained('document_batches')->cascadeOnDelete();
            $table->string('provider_key', 64);
            $table->string('model', 128);
            $table->string('provider_event_key', 128);
            $table->unsignedInteger('page_count')->default(0);
            $table->unsignedBigInteger('input_tokens')->nullable();
            $table->unsignedBigInteger('output_tokens')->nullable();
            $table->unsignedInteger('processing_duration_ms')->nullable();
            $table->string('currency', 3)->nullable();
            $table->unsignedBigInteger('cost_minor')->nullable();
            $table->string('cost_policy_version', 64)->nullable();
            $table->timestampTz('occurred_at');
            $table->timestampsTz();

            $table->unique('document_provider_attempt_id', 'document_provider_usage_attempt_unique');
            $table->unique('provider_event_key', 'document_provider_usage_event_key_unique');
            $table->index(['tenant_id', 'provider_key', 'occurred_at'], 'document_provider_usage_monthly_lookup');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_provider_usage_events');
        Schema::dropIfExists('document_extraction_results');
        Schema::dropIfExists('document_provider_attempts');
    }
};
