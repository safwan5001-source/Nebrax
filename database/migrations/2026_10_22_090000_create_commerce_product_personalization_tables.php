<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * FLOWERS-H4a / ADR-16 — تعريفات التخصيص لكل منتج (نص/نص طويل/اختيار).
 * إضافي بحت؛ `image` محجوز لـH4c بعقده المنفصل.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_product_personalization_fields', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('key', 48);
            $table->string('type', 16);
            $table->string('label', 120);
            $table->string('label_en', 120)->nullable();
            $table->string('help_text', 255)->nullable();
            $table->boolean('is_required')->default(false);
            $table->unsignedSmallInteger('max_length')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['product_id', 'key']);
            $table->index(['tenant_id', 'product_id', 'is_active', 'sort_order'], 'cppf_product_active_sort');
        });

        Schema::create('commerce_product_personalization_options', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('field_id')->constrained('commerce_product_personalization_fields')->cascadeOnDelete();
            $table->string('value_key', 48);
            $table->string('label', 120);
            $table->string('label_en', 120)->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['field_id', 'value_key']);
            $table->index('tenant_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_product_personalization_options');
        Schema::dropIfExists('commerce_product_personalization_fields');
    }
};
