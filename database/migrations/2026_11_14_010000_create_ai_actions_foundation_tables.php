<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_actions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('type', 64);
            $table->unsignedSmallInteger('schema_version');
            $table->string('status', 32);
            $table->unsignedInteger('version')->default(1);
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->foreignUuid('cancelled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'type', 'status'], 'ai_actions_tenant_type_status_idx');
            $table->index(['tenant_id', 'branch_id'], 'ai_actions_tenant_branch_idx');
            $table->unique(['tenant_id', 'id'], 'ai_actions_tenant_id_unique');
        });

        Schema::create('ai_action_versions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('ai_action_id');
            $table->unsignedInteger('version');
            $table->json('proposal');
            $table->string('proposal_hash', 64);
            $table->json('validation_summary')->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'ai_action_id', 'version'], 'ai_action_versions_unique');
            $table->index(['tenant_id', 'proposal_hash'], 'ai_action_versions_hash_idx');
            $table->foreign(['tenant_id', 'ai_action_id'], 'ai_action_versions_tenant_action_fk')
                ->references(['tenant_id', 'id'])->on('ai_actions')->cascadeOnDelete();
        });

        Schema::create('ai_action_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('ai_action_id');
            $table->unsignedInteger('version');
            $table->string('event', 64);
            $table->string('from_status', 32)->nullable();
            $table->string('to_status', 32)->nullable();
            $table->foreignUuid('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->json('metadata')->nullable();
            $table->timestamp('occurred_at');

            $table->index(['tenant_id', 'ai_action_id', 'occurred_at'], 'ai_action_events_timeline_idx');
            $table->foreign(['tenant_id', 'ai_action_id'], 'ai_action_events_tenant_action_fk')
                ->references(['tenant_id', 'id'])->on('ai_actions')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_action_events');
        Schema::dropIfExists('ai_action_versions');
        Schema::dropIfExists('ai_actions');
    }
};
