<?php

namespace App\Services;

use App\Models\FuelProduct;
use App\Models\Product;
use RuntimeException;

/**
 * عقد وحدات الوقود: Quantity في Product/StockMovement لمنتجات الوقود = mL صحيح.
 * يرفض أي دقة أكبر من 3 منازل عشرية بدلاً من تقريبها بصمت.
 */
final class FuelQuantity
{
    public const MILLILITERS_PER_LITER = 1000;

    public function litersToMilliliters(string|int $liters): int
    {
        $value = trim((string) $liters);
        if (! preg_match('/^(0|[1-9][0-9]*)(?:\.([0-9]{1,3}))?$/', $value, $matches)) {
            throw new RuntimeException('كمية الوقود يجب أن تكون باللترات، غير سالبة، وبحد أقصى ثلاث منازل عشرية.');
        }

        $whole = (int) $matches[1];
        $fraction = str_pad($matches[2] ?? '', 3, '0');
        if ($whole > intdiv(PHP_INT_MAX - (int) $fraction, self::MILLILITERS_PER_LITER)) {
            throw new RuntimeException('كمية الوقود تتجاوز الحد المسموح به.');
        }

        return ($whole * self::MILLILITERS_PER_LITER) + (int) $fraction;
    }

    public function millilitersToLiters(int $milliliters): string
    {
        if ($milliliters < 0) {
            throw new RuntimeException('كمية الوقود لا تكون سالبة.');
        }
        $whole = intdiv($milliliters, self::MILLILITERS_PER_LITER);
        $fraction = str_pad((string) ($milliliters % self::MILLILITERS_PER_LITER), 3, '0', STR_PAD_LEFT);

        return rtrim(rtrim("{$whole}.{$fraction}", '0'), '.');
    }

    public function assertFuelUnitMapping(FuelProduct $fuelProduct, ?Product $product = null): void
    {
        if ($fuelProduct->inventory_base_unit !== 'mL' || $fuelProduct->display_unit !== 'L') {
            throw new RuntimeException('منتج الوقود غير مهيأ بوحدة مخزون mL ووحدة عرض L.');
        }
        if ($product !== null && $product->unit !== 'mL') {
            throw new RuntimeException('منتج Nebrax المرتبط بالوقود يجب أن تكون وحدة مخزونه الأساسية mL.');
        }
    }
}
