<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_method_channel_availabilities', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('payment_method_id')->constrained('payment_methods')->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();
            $table->boolean('is_enabled');
            $table->timestamps();

            $table->unique(['tenant_id', 'payment_method_id', 'sales_channel_id'], 'pm_channel_availability_unique');
            $table->index(['tenant_id', 'sales_channel_id', 'is_enabled'], 'pm_channel_availability_lookup');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_method_channel_availabilities');
    }
};
