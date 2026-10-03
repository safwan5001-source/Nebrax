<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** FLOWERS-H5 / ADR-17 — كتل محتوى منتج مهيكلة (تركيبة/عناية/مسببات حساسية…): نص عادي ثنائي اللغة، كتلة واحدة لكل نوع. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_product_content_blocks', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->string('block_type', 32);
            $table->text('body');
            $table->text('body_en')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['product_id', 'block_type']);
            $table->index(['tenant_id', 'product_id', 'is_active', 'sort_order'], 'cpcb_product_active_sort');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_product_content_blocks');
    }
};
