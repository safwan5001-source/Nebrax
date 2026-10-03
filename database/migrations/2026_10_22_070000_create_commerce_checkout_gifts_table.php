<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** FLOWERS-H3 / ADR-15 — سياق الإهداء المؤقت لجلسة Checkout مفتوحة (1:1). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_checkout_gifts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_checkout_id')->constrained('commerce_checkouts')->cascadeOnDelete();
            $table->string('recipient_name', 255)->nullable();
            $table->string('recipient_phone', 32)->nullable();
            $table->string('sender_display_name', 255)->nullable();
            $table->boolean('hide_sender')->default(false);
            $table->text('message')->nullable();
            $table->timestamps();

            $table->unique('commerce_checkout_id');
            $table->index('tenant_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_checkout_gifts');
    }
};
