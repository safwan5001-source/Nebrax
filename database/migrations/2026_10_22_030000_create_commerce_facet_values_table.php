<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** FLOWERS-H2 / ADR-14 — قيم البُعد: مترجَمة، مرتَّبة، تُعطَّل ولا تُفقد إسناداتها. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_facet_values', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_facet_id')->constrained('commerce_facets')->cascadeOnDelete();
            $table->string('slug', 64);
            $table->string('name', 120);
            $table->string('name_en', 120)->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['commerce_facet_id', 'slug']);
            $table->index(['tenant_id', 'commerce_facet_id', 'is_active', 'sort_order'], 'cfv_tenant_facet_active_sort');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_facet_values');
    }
};
