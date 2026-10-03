<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * FLOWERS-H2 / ADR-14 — بُعد وصفي قابل للترشيح (Facet) يحكمه التاجر.
 *
 * إضافي بحت. `system_key` (occasion | recipient) اختياري وفريد لكل مستأجر حين
 * يوجد؛ يتجاوز NULL في الفهرس الفريد بنفس دلالة SQLite وPostgreSQL (NULL ≠ NULL).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_facets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->string('key', 64);
            $table->string('system_key', 32)->nullable();
            $table->string('name', 120);
            $table->string('name_en', 120)->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['tenant_id', 'key']);
            $table->unique(['tenant_id', 'system_key']);
            $table->index(['tenant_id', 'is_active', 'sort_order']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_facets');
    }
};
