<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('document_channel_identities', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->string('channel', 32);
            $table->string('display_name', 160);
            // قيمة قابلة للبحث لا تعيد الهوية الخارجية الخام ولا تمثل credential.
            $table->char('external_identity_fingerprint', 64);
            $table->string('external_identity_masked', 160);
            $table->json('metadata')->nullable();
            $table->string('status', 16)->default('active');
            $table->foreignUuid('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('disabled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('disabled_at')->nullable();
            $table->timestampsTz();

            // لا يدخل المستأجر أو الفرع في مفتاح الحل لأن resolver يعمل قبل السياق؛
            // uniqueness عالمي يضمن أن fingerprint يعيد صفاً موثوقاً واحداً فقط.
            $table->unique(['channel', 'external_identity_fingerprint'], 'document_channel_identity_fingerprint_unique');
            $table->index(['tenant_id', 'branch_id', 'channel', 'status'], 'document_channel_identity_scope_index');
        });

        Schema::create('document_source_receipts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_channel_identity_id')->constrained('document_channel_identities')->restrictOnDelete();
            $table->string('channel', 32);
            $table->char('external_reference_fingerprint', 64);
            $table->string('external_reference_masked', 160);
            // لا يؤخذ من العميل: يحسبه DocumentFileInspector من bytes الفعلية.
            $table->char('content_sha256', 64);
            $table->foreignUuid('document_batch_id')->constrained('document_batches')->restrictOnDelete();
            $table->foreignUuid('document_file_id')->constrained('document_files')->restrictOnDelete();
            $table->foreignUuid('received_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('received_at');
            $table->timestampsTz();

            $table->unique(
                ['document_channel_identity_id', 'channel', 'external_reference_fingerprint'],
                'document_source_receipt_replay_unique',
            );
            $table->index(['tenant_id', 'branch_id', 'channel', 'received_at'], 'document_source_receipt_timeline_index');
            $table->index(['tenant_id', 'branch_id', 'document_batch_id'], 'document_source_receipt_batch_index');
        });

        Schema::create('document_source_audit_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained()->restrictOnDelete();
            $table->foreignUuid('document_channel_identity_id')->nullable()->constrained('document_channel_identities')->restrictOnDelete();
            $table->foreignUuid('document_source_receipt_id')->nullable()->constrained('document_source_receipts')->restrictOnDelete();
            $table->foreignUuid('document_batch_id')->nullable()->constrained('document_batches')->restrictOnDelete();
            $table->string('event', 64);
            $table->string('reason_safe', 500)->nullable();
            $table->json('metadata')->nullable();
            $table->foreignUuid('performed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestampTz('occurred_at');
            $table->timestampsTz();

            $table->index(['tenant_id', 'branch_id', 'document_channel_identity_id', 'occurred_at'], 'document_source_audit_identity_timeline_index');
            $table->index(['tenant_id', 'branch_id', 'document_batch_id', 'occurred_at'], 'document_source_audit_batch_timeline_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('document_source_audit_events');
        Schema::dropIfExists('document_source_receipts');
        Schema::dropIfExists('document_channel_identities');
    }
};
