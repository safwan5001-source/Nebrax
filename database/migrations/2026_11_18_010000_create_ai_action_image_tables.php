<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * AI-ACTIONS-06: private staging of product images (validated bytes only, never attached to a product)
 * and the per-image result of executing an approved import.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_action_images', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('ai_action_id');
            $table->string('source_kind', 16);
            $table->string('source_key', 160);
            $table->string('source_label', 255);
            $table->string('archive_sha256', 64)->nullable();
            // Which upload an archive entry belongs to, in order: the highest sequence is the archive that is matched.
            $table->unsignedInteger('archive_seq')->nullable();
            $table->string('content_sha256', 64);
            $table->string('mime_type', 64);
            $table->string('extension', 8);
            $table->unsignedBigInteger('size_bytes');
            $table->unsignedInteger('width');
            $table->unsignedInteger('height');
            $table->string('storage_profile', 64);
            $table->string('storage_key', 512);
            $table->string('thumb_key', 512)->nullable();
            $table->string('thumb_mime', 64)->nullable();
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            // One staged object per source: the same URL or archive entry is never staged twice.
            $table->unique(['tenant_id', 'ai_action_id', 'source_key'], 'ai_action_images_source_unique');
            $table->index(['tenant_id', 'ai_action_id', 'archive_sha256'], 'ai_action_images_archive_idx');
            $table->unique(['tenant_id', 'id'], 'ai_action_images_tenant_id_unique');
            $table->foreign(['tenant_id', 'ai_action_id'], 'ai_action_images_tenant_action_fk')
                ->references(['tenant_id', 'id'])->on('ai_actions')->cascadeOnDelete();
        });

        Schema::create('ai_action_execution_images', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('ai_action_execution_id')->constrained('ai_action_executions')->cascadeOnDelete();
            $table->foreignUuid('ai_action_execution_row_id')->constrained('ai_action_execution_rows')->cascadeOnDelete();
            $table->uuid('ai_action_id');
            $table->string('item_key', 64);
            $table->uuid('ai_action_image_id')->nullable();
            $table->string('content_sha256', 64);
            $table->string('role', 16);
            $table->unsignedSmallInteger('position');
            $table->string('status', 16)->default('pending');
            $table->string('error_code', 64)->nullable();
            $table->string('error_message', 500)->nullable();
            $table->boolean('retryable')->default(false);
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->foreignUuid('product_media_id')->nullable()->constrained('product_media')->nullOnDelete();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamps();

            // One result per image per row: a retry reuses the record, it never adds a second attempt row.
            $table->unique(['ai_action_execution_row_id', 'item_key'], 'ai_action_exec_images_item_unique');
            $table->index(['tenant_id', 'ai_action_execution_id', 'status'], 'ai_action_exec_images_status_idx');
            $table->foreign(['tenant_id', 'ai_action_id'], 'ai_action_exec_images_tenant_action_fk')
                ->references(['tenant_id', 'id'])->on('ai_actions')->cascadeOnDelete();
            $table->foreign(['tenant_id', 'ai_action_image_id'], 'ai_action_exec_images_tenant_image_fk')
                ->references(['tenant_id', 'id'])->on('ai_action_images')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_action_execution_images');
        Schema::dropIfExists('ai_action_images');
    }
};
