<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_review_changes', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_batch_id')->constrained('document_batches')->cascadeOnDelete();
            $table->foreignUuid('document_extraction_result_id')->constrained('document_extraction_results')->cascadeOnDelete();
            $table->string('target_type', 16);
            $table->string('target_key', 160);
            $table->json('before_value')->nullable();
            $table->json('after_value');
            $table->string('value_type', 32);
            $table->string('reason', 500);
            $table->foreignUuid('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->unsignedBigInteger('review_version');
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['document_extraction_result_id', 'review_version', 'target_key'], 'document_review_change_version_target_unique');
            $table->index(['tenant_id', 'branch_id', 'document_batch_id', 'created_at'], 'document_review_change_batch_timeline');
        });

        Schema::create('document_review_actions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_batch_id')->constrained('document_batches')->cascadeOnDelete();
            $table->foreignUuid('document_extraction_result_id')->nullable()->constrained('document_extraction_results')->nullOnDelete();
            $table->string('subject_type', 32);
            $table->uuid('subject_id')->nullable();
            $table->string('action', 48);
            $table->json('before')->nullable();
            $table->json('after')->nullable();
            $table->foreignUuid('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('reason', 500)->nullable();
            $table->unsignedBigInteger('review_version');
            $table->timestampTz('occurred_at')->useCurrent();
            $table->index(['tenant_id', 'branch_id', 'document_batch_id', 'occurred_at'], 'document_review_action_batch_timeline');
            $table->index(['subject_type', 'subject_id'], 'document_review_action_subject_lookup');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_review_actions');
        Schema::dropIfExists('document_review_changes');
    }
};
