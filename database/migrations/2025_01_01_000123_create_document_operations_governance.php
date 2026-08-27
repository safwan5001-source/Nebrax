<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_retention_policies', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('policy_key', 64)->unique();
            $table->unsignedSmallInteger('retention_days')->default(365);
            $table->boolean('enabled')->default(true);
            $table->string('purge_mode', 32)->default('manual_governed');
            $table->foreignUuid('updated_by')->nullable()->constrained('platform_administrators')->nullOnDelete();
            $table->timestampTz('updated_at');
            $table->timestampTz('created_at');
        });

        Schema::create('document_retention_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('document_retention_policy_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('platform_administrator_id')->nullable()->constrained('platform_administrators')->nullOnDelete();
            $table->boolean('dry_run')->default(true);
            $table->timestampTz('cutoff_at');
            $table->unsignedInteger('limit_count')->default(100);
            $table->uuid('after_file_id')->nullable();
            $table->uuid('last_file_id')->nullable();
            $table->string('status', 24)->default('planned');
            $table->unsignedInteger('scanned_count')->default(0);
            $table->unsignedInteger('eligible_count')->default(0);
            $table->unsignedInteger('purged_count')->default(0);
            $table->unsignedInteger('skipped_count')->default(0);
            $table->string('error_code', 64)->nullable();
            $table->string('error_message_safe', 500)->nullable();
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->timestampsTz();

            $table->index(['status', 'created_at'], 'document_retention_run_status_lookup');
        });

        Schema::create('document_retention_holds', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_batch_id')->nullable()->constrained('document_batches')->restrictOnDelete();
            $table->foreignUuid('document_file_id')->nullable()->constrained('document_files')->restrictOnDelete();
            $table->string('reason_code', 64);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('released_at')->nullable();
            $table->foreignUuid('released_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('release_reason_code', 64)->nullable();
            $table->timestampsTz();

            $table->index(['tenant_id', 'branch_id', 'released_at'], 'document_retention_hold_active_lookup');
            $table->index(['document_batch_id', 'released_at'], 'document_retention_hold_batch_lookup');
            $table->index(['document_file_id', 'released_at'], 'document_retention_hold_file_lookup');
        });

        Schema::create('document_redaction_overlays', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_extraction_result_id')->constrained()->restrictOnDelete();
            $table->string('field_path', 128);
            $table->string('reason_code', 64);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('redacted_at');
            $table->timestampsTz();

            $table->unique(['document_extraction_result_id', 'field_path'], 'document_redaction_overlay_unique');
            $table->index(['tenant_id', 'branch_id', 'redacted_at'], 'document_redaction_overlay_lookup');
        });

        Schema::create('document_governance_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_batch_id')->nullable()->constrained('document_batches')->restrictOnDelete();
            $table->foreignUuid('document_file_id')->nullable()->constrained('document_files')->restrictOnDelete();
            $table->foreignUuid('document_processing_run_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('document_retention_hold_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('document_redaction_overlay_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('document_retention_run_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('action', 64);
            $table->string('stage', 48)->nullable();
            $table->string('status', 48)->nullable();
            $table->string('reason_code', 64)->nullable();
            $table->string('reason_message_safe', 500)->nullable();
            $table->string('actor_type', 48)->nullable();
            $table->uuid('actor_id')->nullable();
            $table->json('metadata')->nullable();
            $table->timestampTz('occurred_at');
            $table->timestampsTz();

            $table->index(['tenant_id', 'branch_id', 'occurred_at'], 'document_governance_event_timeline');
            $table->index(['tenant_id', 'branch_id', 'action', 'occurred_at'], 'document_governance_event_action_lookup');
            $table->index(['document_processing_run_id', 'occurred_at'], 'document_governance_event_run_lookup');
            $table->index(['document_file_id', 'occurred_at'], 'document_governance_event_file_lookup');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_governance_events');
        Schema::dropIfExists('document_redaction_overlays');
        Schema::dropIfExists('document_retention_holds');
        Schema::dropIfExists('document_retention_runs');
        Schema::dropIfExists('document_retention_policies');
    }
};
