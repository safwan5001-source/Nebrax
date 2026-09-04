<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void {
  Schema::create('platform_document_file_scan_exceptions', function(Blueprint $table): void {
   $table->uuid('id')->primary(); $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
   $table->string('reason',500); $table->foreignUuid('granted_by')->constrained('platform_administrators')->restrictOnDelete();
   $table->timestamp('granted_at'); $table->timestamp('expires_at')->nullable(); $table->timestamp('revoked_at')->nullable();
   $table->foreignUuid('revoked_by')->nullable()->constrained('platform_administrators')->nullOnDelete(); $table->string('revocation_reason',500)->nullable(); $table->timestamps(); $table->index(['tenant_id','expires_at','revoked_at']);
  });
  Schema::create('document_file_scan_exception_admissions', function(Blueprint $table): void {
   $table->uuid('id')->primary(); $table->foreignUuid('document_file_id')->constrained('document_files')->cascadeOnDelete(); $table->foreignUuid('document_batch_id')->constrained('document_batches')->cascadeOnDelete(); $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete(); $table->foreignUuid('branch_id')->constrained('branches')->cascadeOnDelete(); $table->foreignUuid('platform_document_file_scan_exception_id')->constrained('platform_document_file_scan_exceptions')->restrictOnDelete(); $table->timestamp('admitted_at'); $table->timestamps(); $table->unique('document_file_id'); $table->index(['tenant_id','document_batch_id']);
  });
 }
 public function down(): void { Schema::dropIfExists('document_file_scan_exception_admissions'); Schema::dropIfExists('platform_document_file_scan_exceptions'); }
};
