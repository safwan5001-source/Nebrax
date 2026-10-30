<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * H6 Batch G — database-level backstop for "only a web channel can be wholesale-flagged" (until now enforced only
 * by the `SalesChannel` saving guard, which raw SQL / `DB::table` / a later type edit would bypass).
 *
 * Why it matters for security: `/commerce/v1` serves the tenant's *mobile* channel to any valid API key. If a
 * wholesale-flagged channel could ever be (or become) a mobile channel, a machine credential would reach prices
 * that are meant to require an approved buyer. The resolver now refuses such a channel, and this CHECK stops the
 * state from existing at all.
 *
 * Additive and safe on existing data: the column defaults to false and no route could set it before Batch F.
 * PostgreSQL only (SQLite cannot add a CHECK to an existing table without a rebuild; the model guard and the
 * resolver refusal still apply there, and SQLite is the test engine, not production).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement("ALTER TABLE sales_channels ADD CONSTRAINT sales_channels_wholesale_web_only_chk CHECK (NOT wholesale_membership_enabled OR type = 'web')");
    }

    public function down(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('ALTER TABLE sales_channels DROP CONSTRAINT IF EXISTS sales_channels_wholesale_web_only_chk');
    }
};
