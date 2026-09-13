<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_carts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            // `storefronts.id` is VARCHAR in the established PostgreSQL schema.
            // Keep this reference on that authoritative legacy key type rather
            // than inferring UUID from the UUID-shaped model value.
            $table->string('storefront_id');
            $table->foreign('storefront_id')->references('id')->on('storefronts')->restrictOnDelete();
            $table->foreignUuid('sales_channel_id')->constrained('sales_channels')->restrictOnDelete();
            $table->string('token_hash', 64)->unique();
            $table->enum('status', ['active', 'expired'])->default('active');
            $table->timestamp('expires_at');
            $table->timestamps();

            $table->index(['tenant_id', 'storefront_id', 'sales_channel_id', 'status', 'expires_at'], 'commerce_carts_context_index');
        });

        Schema::create('commerce_cart_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('cart_id')->constrained('commerce_carts')->cascadeOnDelete();
            $table->foreignUuid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->string('product_name_snapshot');
            $table->string('unit_key');
            $table->string('unit_name_snapshot')->nullable();
            $table->unsignedInteger('quantity');
            $table->timestamps();

            // Portable on both PostgreSQL and SQLite. Product soft deletion leaves
            // the UUID in place; hard deletion nulls it while retaining the line.
            $table->unique(['cart_id', 'product_id', 'unit_key'], 'commerce_cart_items_identity_unique');
            $table->index(['tenant_id', 'cart_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_cart_items');
        Schema::dropIfExists('commerce_carts');
    }
};
