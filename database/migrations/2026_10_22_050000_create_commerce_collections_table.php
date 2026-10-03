<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * FLOWERS-H2 / ADR-14 §2.3 — مجموعة تسويقية منتقاة (Collection) ≠ تصنيف ≠ بُعد.
 * V1 يدوية فقط (عضوية مرتّبة)؛ المجموعات القائمة على قواعد مؤجَّلة صراحةً.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_collections', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('slug', 64);
            $table->string('title', 160);
            $table->string('title_en', 160)->nullable();
            $table->string('description', 500)->nullable();
            $table->string('status', 16)->default('draft');
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();

            $table->unique(['tenant_id', 'slug']);
            $table->index(['tenant_id', 'status', 'sort_order']);
        });

        Schema::create('commerce_collection_products', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_collection_id')->constrained('commerce_collections')->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();

            $table->unique(['commerce_collection_id', 'product_id'], 'ccp_collection_product_unique');
            $table->index(['commerce_collection_id', 'position'], 'ccp_collection_position');
            $table->index('product_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_collection_products');
        Schema::dropIfExists('commerce_collections');
    }
};
