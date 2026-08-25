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
            $table->uuid('tenant_id')->index();
            $table->uuid('branch_id')->index();
            $table->uuid('document_batch_id')->index();
            $table->uuid('document_extraction_result_id')->index();
            $table->string('target_type', 16);
            $table->string('target_key', 160);
            $table->json('before_value')->nullable();
            $table->json('after_value');
            $table->string('value_type', 32);
            $table->string('reason', 500);
            $table->uuid('actor_id')->nullable();
            $table->unsignedBigInteger('review_version');
            $table->timestamp('created_at')->useCurrent();
            $table->unique(['document_extraction_result_id', 'review_version', 'target_key'], 'document_review_change_version_target_unique');
            $table->index(['tenant_id', 'branch_id', 'document_batch_id'], 'document_review_change_scope_batch_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_review_changes');
    }
};
