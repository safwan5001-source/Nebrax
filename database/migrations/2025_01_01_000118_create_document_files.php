<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_files', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_batch_id')->constrained('document_batches')->cascadeOnDelete();
            $table->string('storage_profile', 64)->default('platform');
            $table->string('object_key', 1024);
            $table->string('original_name', 255);
            $table->string('declared_mime', 128)->nullable();
            $table->string('detected_mime', 128);
            $table->unsignedBigInteger('size_bytes');
            $table->unsignedSmallInteger('page_count')->nullable();
            $table->char('sha256', 64);
            $table->string('scan_status', 24)->default('pending');
            $table->string('scan_provider', 64)->nullable();
            $table->timestampTz('scanned_at')->nullable();
            $table->foreignUuid('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('retention_until')->nullable();
            $table->timestampTz('purged_at')->nullable();
            $table->timestampsTz();

            $table->unique('object_key', 'document_files_object_key_unique');
            $table->unique(
                ['tenant_id', 'branch_id', 'sha256', 'size_bytes'],
                'document_files_scope_checksum_unique'
            );
            $table->index(
                ['tenant_id', 'branch_id', 'document_batch_id', 'created_at'],
                'document_files_batch_list_index'
            );
            $table->index(
                ['tenant_id', 'branch_id', 'scan_status', 'created_at'],
                'document_files_scan_queue_index'
            );
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_files');
    }
};
