<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * FLOWERS-H2 / ADR-14 — إسناد متعدد القيم: منتج ↔ قيمة بُعد.
 *
 * فهرس `(tenant_id, commerce_facet_value_id, product_id)` يخدم الترشيح
 * والعدّ المجمَّع؛ و`(product_id)` يخدم قراءة إسنادات منتج واحد.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_product_facet_values', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('product_id')->constrained('products')->cascadeOnDelete();
            $table->foreignUuid('commerce_facet_value_id')->constrained('commerce_facet_values')->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['product_id', 'commerce_facet_value_id'], 'cpfv_product_value_unique');
            $table->index(['tenant_id', 'commerce_facet_value_id', 'product_id'], 'cpfv_filter_idx');
            $table->index('product_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_product_facet_values');
    }
};
