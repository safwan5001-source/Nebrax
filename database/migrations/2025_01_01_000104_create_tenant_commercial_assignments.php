<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenant_commercial_assignments', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('source_type', 32);
            $table->foreignUuid('commercial_plan_version_id')->nullable()->constrained()->restrictOnDelete();
            $table->foreignUuid('commercial_product_version_id')->nullable()->constrained()->restrictOnDelete();
            $table->string('status', 32);
            $table->timestamp('starts_at');
            $table->timestamp('ends_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->foreignUuid('assigned_by_platform_administrator_id')->nullable()->constrained('platform_administrators')->nullOnDelete();
            $table->foreignUuid('cancelled_by_platform_administrator_id')->nullable()->constrained('platform_administrators')->nullOnDelete();
            $table->foreignUuid('revoked_by_platform_administrator_id')->nullable()->constrained('platform_administrators')->nullOnDelete();
            $table->string('reason', 500)->nullable();
            $table->json('metadata')->nullable();
            $table->char('idempotency_key', 64);
            $table->timestamps();

            $table->unique(['tenant_id', 'idempotency_key']);
            $table->index(['tenant_id', 'status', 'starts_at'], 'commercial_assignment_resolution_index');
            $table->index(['tenant_id', 'source_type']);
        });

        Schema::create('tenant_commercial_assignment_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_commercial_assignment_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('platform_administrator_id')->nullable()->constrained('platform_administrators')->nullOnDelete();
            $table->string('action', 32);
            $table->timestamp('effective_at');
            $table->string('reason', 500)->nullable();
            $table->json('metadata')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['tenant_id', 'effective_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_commercial_assignment_events');
        Schema::dropIfExists('tenant_commercial_assignments');
    }
};
