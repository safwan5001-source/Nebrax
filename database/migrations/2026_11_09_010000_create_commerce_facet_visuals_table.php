<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-VD-H1 / VD-1b (§3.2) — the visual identity of a facet or facet value (L2), one optional row per owner.
 *
 * - `commerce_facet_value_id` NULL = the facet's own row (its `self` look + the `defaults` its values inherit).
 * - `visual` is always the normalized document (`CommerceFacetVisualNormalizer`); `{}` is the tombstone left by
 *   "remove identity", so a `version` number is never reused for the same owner (D-17, anti-ABA).
 * - `version` is the integer concurrency token of the write API (§3.8-a).
 * - Rows disappear only through the cascades of their owner (facet / value / tenant).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('commerce_facet_visuals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('commerce_facet_id')->constrained('commerce_facets')->cascadeOnDelete();
            $table->foreignUuid('commerce_facet_value_id')->nullable()->constrained('commerce_facet_values')->cascadeOnDelete();
            $table->unsignedSmallInteger('schema_version')->default(1);
            $table->json('visual');
            $table->unsignedInteger('version')->default(1);
            $table->timestamps();

            // One row per value (NULLs never collide, so facet rows are not constrained here)…
            $table->unique('commerce_facet_value_id', 'cfvis_value_unique');
            $table->index(['tenant_id', 'commerce_facet_id'], 'cfvis_tenant_facet');
        });

        // …and one row per facet: a partial unique index on the facet's own row (SQLite and PostgreSQL).
        DB::statement(
            'CREATE UNIQUE INDEX cfvis_facet_self_unique ON commerce_facet_visuals (commerce_facet_id) WHERE commerce_facet_value_id IS NULL'
        );
    }

    public function down(): void
    {
        Schema::dropIfExists('commerce_facet_visuals');
    }
};
