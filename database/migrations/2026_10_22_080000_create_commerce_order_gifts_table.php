<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * FLOWERS-H3 / ADR-15 — لقطة الإهداء الثابتة للطلب (1:1) تُنسَخ داخل معاملة الإتمام
 * وتتجمّد بعد التأكيد (الحارس في النموذج). ليست هوية محاسبية ولا مرجعاً لـPartner.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_order_gifts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_order_id')->constrained('commerce_orders')->cascadeOnDelete();
            $table->string('recipient_name', 255);
            $table->string('recipient_phone', 32)->nullable();
            $table->string('sender_display_name', 255)->nullable();
            $table->boolean('hide_sender')->default(false);
            $table->text('message')->nullable();
            $table->timestamps();

            $table->unique('commerce_order_id');
            $table->index('tenant_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_order_gifts');
    }
};
