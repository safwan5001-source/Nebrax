<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_match_results', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_batch_id')->constrained('document_batches')->cascadeOnDelete();
            $table->foreignUuid('document_extraction_result_id')->constrained('document_extraction_results')->cascadeOnDelete();
            $table->string('subject_type', 32);
            $table->string('subject_key', 160);
            $table->string('status', 16)->default('unmatched');
            $table->string('matched_type', 64)->nullable();
            $table->uuid('matched_id')->nullable();
            $table->string('strategy', 64)->nullable();
            $table->unsignedSmallInteger('score_basis_points')->nullable();
            $table->json('explanation_codes')->nullable();
            $table->foreignUuid('confirmed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('confirmed_at')->nullable();
            $table->timestampsTz();
            $table->unique(['document_extraction_result_id', 'subject_type', 'subject_key'], 'document_match_result_subject_unique');
            $table->index(['tenant_id', 'branch_id', 'document_batch_id'], 'document_match_result_batch_lookup');
        });

        Schema::create('document_match_candidates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_match_result_id')->constrained('document_match_results')->cascadeOnDelete();
            $table->string('candidate_type', 64);
            $table->uuid('candidate_id')->nullable();
            $table->unsignedSmallInteger('rank');
            $table->unsignedSmallInteger('score_basis_points');
            $table->string('strategy', 64);
            $table->json('explanation_codes');
            $table->json('snapshot')->nullable();
            $table->timestampsTz();
            $table->unique(['document_match_result_id', 'rank'], 'document_match_candidate_rank_unique');
            $table->index(['tenant_id', 'branch_id', 'candidate_type'], 'document_match_candidate_scope_lookup');
        });

        Schema::create('document_issues', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_batch_id')->constrained('document_batches')->cascadeOnDelete();
            $table->foreignUuid('document_extraction_result_id')->constrained('document_extraction_results')->cascadeOnDelete();
            $table->string('subject_key', 160);
            $table->string('code', 80);
            $table->string('severity', 16);
            $table->string('status', 16)->default('open');
            $table->string('safe_message', 500);
            $table->json('metadata')->nullable();
            $table->foreignUuid('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('resolved_at')->nullable();
            $table->timestampsTz();
            $table->unique(['document_extraction_result_id', 'subject_key', 'code'], 'document_issue_unique');
            $table->index(['tenant_id', 'branch_id', 'document_batch_id', 'status'], 'document_issue_batch_lookup');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_issues');
        Schema::dropIfExists('document_match_candidates');
        Schema::dropIfExists('document_match_results');
    }
};
