<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * FLOWERS-H7a / ADR-19 — سياسة جدولة التسليم لكل قناة بيع: إعداد، نوافذ زمنية، وتواريخ محجوبة.
 * جداول إضافية بحتة؛ غياب صفّ الإعداد = لا جدولة (سلوك Checkout الحالي حرفياً).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_delivery_schedule_settings', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();
            $table->boolean('is_enabled')->default(false);
            $table->boolean('is_required')->default(true);
            $table->string('timezone', 64)->nullable();
            $table->unsignedInteger('lead_time_minutes')->default(0);
            $table->string('cutoff_time', 5)->nullable();
            $table->unsignedSmallInteger('max_days_ahead')->default(30);
            $table->timestamps();

            $table->unique('sales_channel_id');
        });

        Schema::create('commerce_delivery_slots', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();
            $table->string('method', 16);
            $table->string('label', 80);
            $table->string('label_en', 80)->nullable();
            $table->string('start_time', 5);
            $table->string('end_time', 5);
            $table->unsignedSmallInteger('weekday_mask')->default(127);
            $table->unsignedInteger('capacity')->nullable();
            // سقوط المنطقة يُسقط النافذة (فشلٌ مغلق) بدل أن تتّسع إلى «أي وجهة» بصمت.
            $table->foreignUuid('shipping_zone_id')->nullable()->constrained('commerce_shipping_zones')->cascadeOnDelete();
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['tenant_id', 'sales_channel_id', 'method', 'is_active', 'sort_order'], 'cds_channel_method_active_sort');
        });

        Schema::create('commerce_delivery_blocked_dates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->cascadeOnDelete();
            $table->string('date', 10);
            $table->string('method', 16)->default('all');
            $table->string('reason', 120)->nullable();
            $table->timestamps();

            $table->unique(['sales_channel_id', 'date', 'method'], 'cdbd_channel_date_method_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_delivery_blocked_dates');
        Schema::dropIfExists('commerce_delivery_slots');
        Schema::dropIfExists('commerce_delivery_schedule_settings');
    }
};
