<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('platform_integration_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('integration_key', 64)->unique();
            $table->string('provider', 64)->nullable();
            $table->boolean('enabled')->default(false);
            $table->text('configuration')->nullable();
            $table->timestampTz('configured_at')->nullable();
            $table->foreignUuid('updated_by')->nullable()->constrained('platform_administrators')->nullOnDelete();
            $table->timestampsTz();
        });

        Schema::create('platform_integration_audit_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('platform_administrator_id')->nullable()->constrained('platform_administrators')->nullOnDelete();
            $table->string('integration_key', 64);
            $table->string('action', 64);
            $table->json('changed_keys')->nullable();
            $table->timestampTz('occurred_at');
            $table->index(['integration_key', 'occurred_at'], 'platform_integration_audit_lookup');
        });

        Schema::create('platform_runtime_heartbeats', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('component', 64)->unique();
            $table->string('instance_id', 128)->nullable();
            $table->string('status', 32)->default('online');
            $table->json('metadata')->nullable();
            $table->timestampTz('last_seen_at');
            $table->timestampsTz();
        });

        Schema::create('document_processing_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_batch_id')->constrained('document_batches')->cascadeOnDelete();
            $table->foreignUuid('document_file_id')->constrained('document_files')->cascadeOnDelete();
            $table->string('stage', 48);
            $table->string('status', 24)->default('queued');
            $table->unsignedSmallInteger('attempt_count')->default(0);
            $table->uuid('job_uuid')->nullable();
            $table->string('error_code', 64)->nullable();
            $table->string('error_message_safe', 500)->nullable();
            $table->timestampTz('queued_at');
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->timestampTz('next_retry_at')->nullable();
            $table->timestampsTz();

            $table->unique(
                ['tenant_id', 'branch_id', 'document_file_id', 'stage'],
                'document_processing_run_idempotency_unique'
            );
            $table->index(
                ['tenant_id', 'branch_id', 'status', 'queued_at'],
                'document_processing_run_queue_index'
            );
            $table->index(['status', 'updated_at'], 'document_processing_runtime_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_processing_runs');
        Schema::dropIfExists('platform_runtime_heartbeats');
        Schema::dropIfExists('platform_integration_audit_events');
        Schema::dropIfExists('platform_integration_settings');
    }
};
