<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** FLOWERS-H8 / ADR-20 — مهلة تجهيز المنتج (دقائق) لاشتقاق وعد التسليم؛ غياب الصف = بلا مهلة خاصة بالمنتج. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_product_preparations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->unsignedInteger('preparation_minutes');
            $table->timestamps();

            $table->unique('product_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_product_preparations');
    }
};
