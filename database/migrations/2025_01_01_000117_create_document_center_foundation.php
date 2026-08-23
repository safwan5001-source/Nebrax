<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_batches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->string('document_type', 64);
            $table->string('source_type', 64);
            $table->string('status', 32)->default('draft');
            $table->unsignedSmallInteger('schema_version')->default(1);
            $table->unsignedInteger('version')->default(1);
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('review_assigned_to')->nullable()->constrained('users')->nullOnDelete();
            $table->string('failure_code', 64)->nullable();
            $table->string('failure_message_safe', 500)->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'branch_id', 'status', 'created_at'], 'document_batch_work_queue_index');
            $table->index(['tenant_id', 'branch_id', 'document_type', 'created_at'], 'document_batch_type_index');
            $table->index(['tenant_id', 'review_assigned_to', 'status'], 'document_batch_reviewer_index');
        });

        Schema::create('document_workflow_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_batch_id')->constrained('document_batches')->restrictOnDelete();
            $table->string('from_status', 32);
            $table->string('to_status', 32);
            $table->string('event', 64);
            $table->string('actor_type', 64);
            $table->uuid('actor_id')->nullable();
            $table->string('reason', 500)->nullable();
            $table->json('metadata')->nullable();
            $table->timestamp('occurred_at');

            $table->index(['tenant_id', 'branch_id', 'document_batch_id', 'occurred_at'], 'document_workflow_batch_timeline_index');
            $table->index(['tenant_id', 'branch_id', 'to_status', 'occurred_at'], 'document_workflow_status_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_workflow_events');
        Schema::dropIfExists('document_batches');
    }
};
