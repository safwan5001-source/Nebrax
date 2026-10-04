<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * FLOWERS-H7b / ADR-19 — اختيار موعد التسليم: صفّ مؤقت لجلسة Checkout مفتوحة (1:1) ولقطة ثابتة للطلب (1:1).
 * جدولان إضافيان بحتان؛ غياب الصفّ = لا جدولة. `commerce_delivery_slot_id` مفتاح أجنبي `nullOnDelete` في الاثنين:
 * حذف النافذة يُبطل اختياراً مفتوحاً (إعادة التحقق عند الإتمام) ولا يمسّ لقطة الطلب التاريخية (تحمل تسميتها وأوقاتها).
 * فهرس (النافذة، التاريخ) على لقطة الطلب هو مصدر عدّ السعة.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_checkout_schedules', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_checkout_id')->constrained('commerce_checkouts')->cascadeOnDelete();
            $table->string('delivery_date', 10);
            $table->foreignUuid('commerce_delivery_slot_id')->nullable()->constrained('commerce_delivery_slots')->nullOnDelete();
            $table->timestamps();

            $table->unique('commerce_checkout_id');
            $table->index('tenant_id');
        });

        Schema::create('commerce_order_schedules', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_order_id')->constrained('commerce_orders')->cascadeOnDelete();
            $table->string('method', 16);
            $table->string('delivery_date', 10);
            $table->foreignUuid('commerce_delivery_slot_id')->nullable()->constrained('commerce_delivery_slots')->nullOnDelete();
            $table->string('slot_label', 80);
            $table->string('slot_label_en', 80)->nullable();
            $table->string('start_time', 5);
            $table->string('end_time', 5);
            $table->string('timezone', 64);
            $table->timestamps();

            $table->unique('commerce_order_id');
            $table->index('tenant_id');
            $table->index(['commerce_delivery_slot_id', 'delivery_date'], 'cos_slot_date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_order_schedules');
        Schema::dropIfExists('commerce_checkout_schedules');
    }
};
