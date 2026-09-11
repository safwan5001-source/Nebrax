<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_gateways', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('provider');
            $table->string('name');
            $table->string('name_en')->nullable();
            $table->string('environment')->default('sandbox');
            $table->boolean('is_active')->default(true);
            $table->string('merchant_reference')->nullable();
            $table->string('publishable_key')->nullable();
            $table->text('secret_key')->nullable();
            $table->text('webhook_secret')->nullable();
            $table->text('extra_credentials')->nullable();
            $table->foreignUuid('payment_method_id')
                ->nullable()
                ->constrained('payment_methods')
                ->nullOnDelete();
            $table->timestamps();

            $table->unique(['tenant_id', 'name'], 'payment_gateways_tenant_name_unique');
            $table->index(['tenant_id', 'provider', 'is_active'], 'payment_gateways_provider_lookup');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_gateways');
    }
};
