<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AI-ACTIONS-06B: a repair is a NEW AI action holding only the rows an execution could not apply. This record is the
 * immutable link back to the execution it repairs, plus the per-row failure and the fields the repair may edit.
 * The original action, execution and results are never modified.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_action_repairs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('ai_action_id');
            $table->uuid('origin_action_id');
            $table->foreignUuid('origin_execution_id')->constrained('ai_action_executions')->restrictOnDelete();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->json('rows');
            $table->timestamps();

            // One repair record per repair action.
            $table->unique(['tenant_id', 'ai_action_id'], 'ai_action_repairs_action_unique');
            $table->index(['tenant_id', 'origin_execution_id'], 'ai_action_repairs_origin_idx');
            $table->foreign(['tenant_id', 'ai_action_id'], 'ai_action_repairs_tenant_action_fk')
                ->references(['tenant_id', 'id'])->on('ai_actions')->cascadeOnDelete();
            $table->foreign(['tenant_id', 'origin_action_id'], 'ai_action_repairs_tenant_origin_fk')
                ->references(['tenant_id', 'id'])->on('ai_actions')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_action_repairs');
    }
};
