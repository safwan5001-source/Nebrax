<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * FLOWERS-H3 / ADR-15 — سياسة الإهداء لكل قناة بيع (ويب/جوال منفصلتان).
 * أعمدة typed بلا JSON. غياب الصفّ = معطَّل (افتراض يحمي المتاجر القائمة).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_gift_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();
            $table->boolean('is_enabled')->default(false);
            $table->unsignedSmallInteger('message_max_length')->default(250);
            $table->boolean('allow_hide_sender')->default(true);
            $table->boolean('recipient_phone_required')->default(true);
            $table->timestamps();

            $table->unique('sales_channel_id');
            $table->index('tenant_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_gift_settings');
    }
};
