<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The execution table references (tenant_id, id): the referenced key must be unique first.
        Schema::table('ai_action_approvals', function (Blueprint $table) {
            $table->unique(['tenant_id', 'id'], 'ai_action_approvals_tenant_id_unique');
        });

        // AI-ACTIONS-05: one execution per approval (unique key ⇒ an approval can never be
        // executed twice); per-row results make retries touch only unfinished rows.
        Schema::create('ai_action_executions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('ai_action_id');
            $table->uuid('ai_action_approval_id');
            $table->uuid('ai_action_preview_id');
            $table->unsignedInteger('action_version');
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('preview_hash', 64);
            $table->foreignUuid('started_by')->constrained('users')->restrictOnDelete();
            $table->string('status', 24);
            $table->unsignedInteger('retry_count')->default(0);
            // Lease: a worker holds the execution until `locked_until`; a crashed worker's lease expires.
            $table->string('claim_token', 64)->nullable();
            $table->timestamp('locked_until')->nullable();
            $table->timestamp('started_at');
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'ai_action_approval_id'], 'ai_action_executions_approval_unique');
            $table->unique(['tenant_id', 'id'], 'ai_action_executions_tenant_id_unique');
            $table->index(['tenant_id', 'ai_action_id'], 'ai_action_executions_action_idx');
            $table->foreign(['tenant_id', 'ai_action_id'], 'ai_action_executions_tenant_action_fk')
                ->references(['tenant_id', 'id'])->on('ai_actions')->cascadeOnDelete();
            $table->foreign(['tenant_id', 'ai_action_approval_id'], 'ai_action_executions_tenant_approval_fk')
                ->references(['tenant_id', 'id'])->on('ai_action_approvals')->cascadeOnDelete();
        });

        Schema::create('ai_action_execution_rows', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('ai_action_execution_id');
            $table->uuid('ai_action_id');
            $table->string('row_id', 128);
            $table->unsignedInteger('source_row');
            $table->string('operation', 16);
            $table->string('status', 16);
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('error_code', 48)->nullable();
            $table->string('error_message', 500)->nullable();
            $table->boolean('retryable')->default(false);
            $table->unsignedInteger('attempts')->default(0);
            // Field NAMES only — never values, so cost data is not copied into the result log.
            $table->json('changed_fields')->nullable();
            $table->json('deferred')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'ai_action_execution_id', 'row_id'], 'ai_action_execution_rows_row_unique');
            $table->index(['tenant_id', 'ai_action_execution_id', 'status'], 'ai_action_execution_rows_status_idx');
            $table->foreign(['tenant_id', 'ai_action_execution_id'], 'ai_action_execution_rows_tenant_exec_fk')
                ->references(['tenant_id', 'id'])->on('ai_action_executions')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_action_execution_rows');
        Schema::table('ai_action_approvals', function (Blueprint $table) {
            $table->dropUnique('ai_action_approvals_tenant_id_unique');
        });
        Schema::dropIfExists('ai_action_executions');
    }
};
