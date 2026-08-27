<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('zatca_credentials', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('environment', 20);
            $table->string('stage', 20);
            $table->string('status', 20)->default('configured');
            // Laravel encrypts this complete payload with APP_KEY before persistence.
            $table->text('credentials');
            $table->char('certificate_fingerprint', 64);
            $table->timestamp('configured_at');
            $table->timestamp('expires_at')->nullable();
            $table->foreignUuid('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'environment'], 'zatca_credential_tenant_environment_unique');
            $table->index(['tenant_id', 'status', 'expires_at'], 'zatca_credential_readiness_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('zatca_credentials');
    }
};
