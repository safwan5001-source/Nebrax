<?php

namespace App\Support;

use Carbon\CarbonInterface;

/**
 * FUEL-B6 — تقييم مستوى خزان من قراءة واحدة، دالة نقيّة بلا قاعدة بيانات.
 *
 * المصدر الوحيد لنسبة الامتلاء والسعة المتاحة وأعلام «تحتاج مراجعة» وحالة حداثة القياس.
 *
 * مبادئ لا تُكسر:
 *  - **لا حدّ اختراعي:** الأعلام تقارن القراءة بقيم الخزان المعتمدة في بياناته الرئيسية فقط (السعة، السعة الآمنة، الحدّ الأدنى، المخزون الميت).
 *    لا نسبة مئوية افتراضية ولا «انخفاض مفاجئ» (يحتاج سياق مبيعات واستلام = دورة التسوية B7).
 *  - **حداثة القياس تتبع إعداد المحطة** `tank_reading_stale_after_minutes`؛ غياب الإعداد (null) = `unrated` (يُعرض العمر ولا يُحكم عليه).
 *  - **قياس لا رصيد:** آخر كمية مقاسة في وقت معلوم، لا رصيد دفتري ولا حركة مخزون ولا تسوية.
 *  - لا float: النسبة بالنقاط الأساسية (basis points) بحساب صحيح.
 */
final class FuelTankLevel
{
    public const FLAG_ABOVE_CAPACITY = 'above_capacity';
    public const FLAG_ABOVE_SAFE_CAPACITY = 'above_safe_capacity';
    public const FLAG_BELOW_MINIMUM = 'below_minimum_level';
    public const FLAG_BELOW_DEAD_STOCK = 'below_dead_stock';

    public const FRESHNESS_NONE = 'none';
    public const FRESHNESS_FRESH = 'fresh';
    public const FRESHNESS_STALE = 'stale';
    public const FRESHNESS_UNRATED = 'unrated';

    /** @return list<string> أعلام تحتاج مراجعة بشرية؛ لا تحوَّل تلقائياً إلى تسوية. */
    public static function flags(int $quantity, int $capacity, int $safeCapacity, int $minimumLevel, int $deadStock): array
    {
        $flags = [];
        if ($capacity > 0 && $quantity > $capacity) {
            $flags[] = self::FLAG_ABOVE_CAPACITY;
        } elseif ($safeCapacity > 0 && $quantity > $safeCapacity) {
            $flags[] = self::FLAG_ABOVE_SAFE_CAPACITY;
        }
        if ($minimumLevel > 0 && $quantity < $minimumLevel) {
            $flags[] = self::FLAG_BELOW_MINIMUM;
        }
        if ($deadStock > 0 && $quantity < $deadStock) {
            $flags[] = self::FLAG_BELOW_DEAD_STOCK;
        }

        return $flags;
    }

    /** نسبة الامتلاء بالنقاط الأساسية (10000 = 100%)، مقرَّبة لأقرب نقطة؛ `null` إن لم تُعرف سعة موجبة. */
    public static function fillBasisPoints(int $quantity, int $capacity): ?int
    {
        if ($capacity <= 0) {
            return null;
        }

        return intdiv(($quantity * 10000) + intdiv($capacity, 2), $capacity);
    }

    public static function freshness(?CarbonInterface $measuredAt, CarbonInterface $now, ?int $staleAfterMinutes): string
    {
        if ($measuredAt === null) {
            return self::FRESHNESS_NONE;
        }
        if ($staleAfterMinutes === null || $staleAfterMinutes <= 0) {
            return self::FRESHNESS_UNRATED;
        }

        return $measuredAt->lessThan($now->copy()->subMinutes($staleAfterMinutes)) ? self::FRESHNESS_STALE : self::FRESHNESS_FRESH;
    }
}
