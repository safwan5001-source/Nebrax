<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_action_files', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->uuid('ai_action_id');
            $table->unsignedInteger('action_version');
            $table->string('original_name', 255);
            $table->string('extension', 8);
            $table->string('content_type', 127)->nullable();
            $table->unsignedBigInteger('size_bytes');
            $table->string('content_sha256', 64);
            $table->string('storage_profile', 64);
            $table->string('storage_key', 512);
            $table->foreignUuid('uploaded_by')->constrained('users')->restrictOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'ai_action_id', 'action_version', 'content_sha256'], 'ai_action_files_content_unique');
            $table->index(['tenant_id', 'ai_action_id', 'action_version'], 'ai_action_files_action_version_idx');
            $table->foreign(['tenant_id', 'ai_action_id'], 'ai_action_files_tenant_action_fk')
                ->references(['tenant_id', 'id'])->on('ai_actions')->cascadeOnDelete();
        });

        Schema::create('ai_action_extractions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->foreignUuid('ai_action_file_id')->constrained('ai_action_files')->cascadeOnDelete();
            $table->uuid('ai_action_id');
            $table->unsignedInteger('action_version');
            $table->unsignedSmallInteger('schema_version');
            $table->json('manifest');
            $table->string('manifest_hash', 64);
            $table->foreignUuid('created_by')->constrained('users')->restrictOnDelete();
            $table->timestamp('created_at');

            $table->unique(['tenant_id', 'ai_action_file_id'], 'ai_action_extractions_file_unique');
            $table->index(['tenant_id', 'ai_action_id', 'action_version'], 'ai_action_extractions_action_version_idx');
            $table->foreign(['tenant_id', 'ai_action_id'], 'ai_action_extractions_tenant_action_fk')
                ->references(['tenant_id', 'id'])->on('ai_actions')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_action_extractions');
        Schema::dropIfExists('ai_action_files');
    }
};
