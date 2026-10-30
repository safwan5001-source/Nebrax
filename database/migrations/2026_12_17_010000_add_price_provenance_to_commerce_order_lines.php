<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * H6 Batch F — immutable price provenance on NEW commerce order lines (additive, reversible).
 *
 * - `price_source`  : how the unit price was resolved at creation — `price_list` | `product_default`
 *                     (the server-side {@see \App\Services\Commerce\ResolvedCommercePrice::$source}).
 * - `price_list_id` : the price list that supplied it (only when `price_source = price_list`); `restrictOnDelete`
 *                     like `invoices.price_list_id`, so evidence can never dangle.
 *
 * Both are NULL for every historical line and stay NULL: no backfill, no rewrite, no recalculation
 * (`unit_price` / `line_total` are untouched). The channel context is the order's own `sales_channel_id`.
 * The values come only from the server's resolver, never from the browser.
 *
 * `down()` refuses while any line carries provenance (dropping it would destroy evidence).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('commerce_order_lines', function (Blueprint $table) {
            $table->string('price_source', 16)->nullable();
            $table->foreignUuid('price_list_id')->nullable()->constrained('price_lists')->restrictOnDelete();
        });

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE commerce_order_lines ADD CONSTRAINT commerce_order_lines_price_provenance_chk CHECK (
                (price_source IS NULL AND price_list_id IS NULL)
                OR (price_source = 'price_list' AND price_list_id IS NOT NULL)
                OR (price_source = 'product_default' AND price_list_id IS NULL)
            )");
        }
    }

    public function down(): void
    {
        if (DB::table('commerce_order_lines')->whereNotNull('price_source')->exists()) {
            throw new RuntimeException('Refusing to roll back: order lines carry price provenance evidence.');
        }

        if (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE commerce_order_lines DROP CONSTRAINT IF EXISTS commerce_order_lines_price_provenance_chk');
        }

        Schema::table('commerce_order_lines', function (Blueprint $table) {
            $table->dropConstrainedForeignId('price_list_id');
            $table->dropColumn('price_source');
        });
    }
};
