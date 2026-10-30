<?php

namespace App\Support\Commerce;

use Illuminate\Database\Eloquent\Builder;

/**
 * H6 Batch G — `sort=sale_price` / `-sale_price` ordered by the price the API actually DISPLAYS.
 *
 * Root cause this replaces: the public listings did `ORDER BY products.sale_price`, but since VAR-PRICE-1 that
 * column is frozen/unwritten — the authority is `product_unit_prices` (read through the `Product::sale_price`
 * accessor), and a channel's active price list can re-price it on top. So the order bore no relation to the
 * amounts shown (new products all carry the column default 0 ⇒ the order collapsed to the `id` tie-break).
 *
 * The expression mirrors, tier for tier, what the listing shows:
 *   1. variant-managed product            → 0 (its list row deliberately shows 0; real prices are per variant)
 *      (only when {@see self::apply()} is told the surface shows 0 for them — the ERP API shows the parent price)
 *   2. the channel's ACTIVE list item for the product's own unit (variant NULL)
 *   3. the product's base unit price (`product_unit_prices`, variant NULL, unit = products.unit)
 *   4. 0 (the accessor's own fallback)
 * so ascending/descending order always agrees with the displayed amounts, in whole minor units, with `products.id`
 * as the deterministic tie-break. Correlated subqueries, not joins: no row multiplication (pagination/count stay
 * exact), no ambiguity with TenantScope's columns, no in-memory sorting, one SQL statement.
 */
final class EffectivePriceOrdering
{
    public static function apply(Builder $query, ?string $priceListId, bool $variantManagedAsZero, string $direction): void
    {
        $direction = strtolower($direction) === 'desc' ? 'desc' : 'asc';

        $base = '(SELECT pup.price FROM product_unit_prices pup WHERE pup.product_id = products.id '
            .'AND pup.product_variant_id IS NULL AND pup.unit_name = products.unit LIMIT 1)';

        $bindings = [];
        if ($priceListId !== null) {
            $list = '(SELECT pli.price FROM price_list_items pli WHERE pli.price_list_id = ? AND pli.product_id = products.id '
                .'AND pli.product_variant_id IS NULL AND pli.unit_name = products.unit LIMIT 1)';
            $effective = "COALESCE({$list}, {$base}, 0)";
            $bindings[] = $priceListId;
        } else {
            $effective = "COALESCE({$base}, 0)";
        }

        if ($variantManagedAsZero) {
            $effective = "CASE WHEN products.variant_state = 'variant_managed' THEN 0 ELSE {$effective} END";
            // binding order follows the placeholder order inside the expression (the only `?` is the list id)
        }

        $query->orderByRaw($effective.' '.$direction, $bindings)->orderByDesc('products.id');
    }
}
