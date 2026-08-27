<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('zatca_submission_attempts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignUuid('invoice_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('attempt_number');
            $table->string('submission_type', 20);
            $table->string('source', 20);
            $table->string('status', 20)->default('pending');
            $table->char('idempotency_key_hash', 64);
            $table->char('request_hash', 64);
            $table->uuid('requested_by')->nullable();
            $table->timestamp('requested_at');
            $table->timestamp('completed_at')->nullable();
            $table->unsignedSmallInteger('response_http_status')->nullable();
            $table->string('response_code', 120)->nullable();
            $table->text('response_message')->nullable();
            $table->json('response_payload')->nullable();
            $table->timestamps();

            $table->foreign('requested_by')->references('id')->on('users')->nullOnDelete();
            $table->unique(['invoice_id', 'attempt_number'], 'zatca_attempt_invoice_number_unique');
            $table->unique(['tenant_id', 'idempotency_key_hash'], 'zatca_attempt_idempotency_unique');
            $table->index(['invoice_id', 'status', 'created_at'], 'zatca_attempt_invoice_status_idx');
            $table->index(['tenant_id', 'status', 'requested_at'], 'zatca_attempt_tenant_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('zatca_submission_attempts');
    }
};
