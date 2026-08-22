<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commercial_products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code')->unique();
            $table->string('name');
            $table->timestamps();
        });

        Schema::create('commercial_product_versions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('commercial_product_id')->constrained()->restrictOnDelete();
            $table->unsignedInteger('version');
            $table->timestamp('published_at')->nullable();
            $table->timestamps();

            $table->unique(['commercial_product_id', 'version']);
        });

        Schema::create('commercial_product_version_capabilities', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('commercial_product_version_id')->constrained()->cascadeOnDelete();
            $table->string('capability_key');
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['commercial_product_version_id', 'capability_key'], 'product_version_capability_unique');
        });

        Schema::create('commercial_plan_versions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('plan_code');
            $table->unsignedInteger('version');
            $table->timestamp('published_at')->nullable();
            $table->timestamps();

            $table->unique(['plan_code', 'version']);
        });

        Schema::create('commercial_plan_version_products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('commercial_plan_version_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commercial_product_version_id')->constrained()->restrictOnDelete();
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['commercial_plan_version_id', 'commercial_product_version_id'], 'plan_version_product_unique');
        });

        Schema::create('tenant_application_entitlements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('capability_key');
            $table->string('access_mode', 32);
            $table->string('source_type', 32);
            $table->string('source_reference_type')->nullable();
            $table->uuid('source_reference_id')->nullable();
            $table->uuid('grant_group_id')->nullable();
            $table->timestamp('starts_at');
            $table->timestamp('ends_at')->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->string('grant_reason_code')->nullable();
            $table->string('reason', 500)->nullable();
            $table->foreignUuid('granted_by_platform_administrator_id')->nullable()->constrained('platform_administrators')->nullOnDelete();
            $table->foreignUuid('revoked_by_platform_administrator_id')->nullable()->constrained('platform_administrators')->nullOnDelete();
            $table->json('metadata')->nullable();
            $table->char('idempotency_key', 64);
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['tenant_id', 'idempotency_key']);
            $table->index(['tenant_id', 'capability_key', 'starts_at'], 'entitlement_resolution_index');
            $table->index(['tenant_id', 'source_type', 'source_reference_id'], 'entitlement_source_index');
            $table->index(['tenant_id', 'grant_group_id']);
            $table->index('ends_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tenant_application_entitlements');
        Schema::dropIfExists('commercial_plan_version_products');
        Schema::dropIfExists('commercial_plan_versions');
        Schema::dropIfExists('commercial_product_version_capabilities');
        Schema::dropIfExists('commercial_product_versions');
        Schema::dropIfExists('commercial_products');
    }
};
