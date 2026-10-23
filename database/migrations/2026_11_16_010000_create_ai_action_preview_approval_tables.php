<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // AI-ACTIONS-04: the preview is the immutable object a user approves.
        // Only the invalidation columns are ever updated after creation.
        Schema::create('ai_action_previews', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('ai_action_id');
            $table->unsignedInteger('action_version');
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('preview_hash', 64);
            $table->string('proposal_hash', 64)->nullable();
            $table->string('manifest_hash', 64)->nullable();
            $table->json('preview');
            $table->json('summary');
            $table->boolean('approvable')->default(false);
            $table->foreignUuid('generated_by')->constrained('users')->restrictOnDelete();
            $table->timestamp('expires_at');
            $table->timestamp('invalidated_at')->nullable();
            $table->string('invalidation_reason', 64)->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'ai_action_id', 'action_version'], 'ai_action_previews_action_version_idx');
            $table->index(['tenant_id', 'preview_hash'], 'ai_action_previews_hash_idx');
            $table->unique(['tenant_id', 'id'], 'ai_action_previews_tenant_id_unique');
            $table->foreign(['tenant_id', 'ai_action_id'], 'ai_action_previews_tenant_action_fk')
                ->references(['tenant_id', 'id'])->on('ai_actions')->cascadeOnDelete();
        });

        // One approval per preview: the unique key makes a replayed approval
        // return the original record instead of creating a second one.
        Schema::create('ai_action_approvals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('ai_action_id');
            $table->uuid('ai_action_preview_id');
            $table->unsignedInteger('action_version');
            $table->foreignUuid('branch_id')->nullable()->constrained('branches')->nullOnDelete();
            $table->string('preview_hash', 64);
            $table->foreignUuid('approved_by')->constrained('users')->restrictOnDelete();
            $table->string('permission_digest', 64);
            $table->timestamp('approved_at');
            $table->timestamp('expires_at');
            $table->timestamp('revoked_at')->nullable();
            $table->string('revocation_reason', 64)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'ai_action_preview_id'], 'ai_action_approvals_preview_unique');
            $table->index(['tenant_id', 'ai_action_id'], 'ai_action_approvals_action_idx');
            $table->foreign(['tenant_id', 'ai_action_id'], 'ai_action_approvals_tenant_action_fk')
                ->references(['tenant_id', 'id'])->on('ai_actions')->cascadeOnDelete();
            $table->foreign(['tenant_id', 'ai_action_preview_id'], 'ai_action_approvals_tenant_preview_fk')
                ->references(['tenant_id', 'id'])->on('ai_action_previews')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_action_approvals');
        Schema::dropIfExists('ai_action_previews');
    }
};
