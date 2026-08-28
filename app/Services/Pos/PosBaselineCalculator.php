<?php

namespace App\Services\Pos;

/**
 * حساب خط الأساس المفسَّر بترتيب صارم: شخصي ← نظراء ← ثابت احتياطي.
 *
 * إحصاء بسيط قوي ومفسَّر (median للنظراء) لا نموذج غامض. يتفادى القسمة على صفر،
 * ولا يعاقب كاشيراً جديداً/قليل الحجم: عند نقص العينة يعيد حالة insufficient
 * صريحة بدل رقم مضلّل. كل الأسعار بمقياس القيمة ×1000 (milli) لتفادي float.
 */
final class PosBaselineCalculator
{
    /**
     * @param  int        $currentDenominator  مقام الموضوع في النافذة الحالية.
     * @param  int|null   $priorRateMilli      معدّل الموضوع في النافذة السابقة (self).
     * @param  int        $priorDenominator    مقام النافذة السابقة (لكفاية عينة self).
     * @param  list<int>  $peerRatesMilli      معدّلات النظراء ذوي العينة الكافية.
     * @param  int        $staticFallbackMilli خط الأساس الثابت الاحتياطي.
     * @return array{type:string, rate:int, sample_sufficient:bool}
     */
    public static function resolve(
        int $currentDenominator,
        int $minSample,
        ?int $priorRateMilli,
        int $priorDenominator,
        array $peerRatesMilli,
        int $staticFallbackMilli,
    ): array {
        // عينة الموضوع نفسها غير كافية: لا حكم — حالة نقص بيانات صريحة.
        if ($currentDenominator < $minSample) {
            return ['type' => 'insufficient', 'rate' => $staticFallbackMilli, 'sample_sufficient' => false];
        }

        // 1) أساس شخصي: سلوك الموضوع في نافذته السابقة، إن كفت عينتها.
        if ($priorRateMilli !== null && $priorDenominator >= $minSample) {
            return ['type' => 'self', 'rate' => $priorRateMilli, 'sample_sufficient' => true];
        }

        // 2) أساس نظراء: وسيط النظراء ذوي العينة الكافية داخل الفرع.
        if (count($peerRatesMilli) >= PosExceptionRuleCatalog::MIN_PEERS) {
            return ['type' => 'peer', 'rate' => self::median($peerRatesMilli), 'sample_sufficient' => true];
        }

        // 3) ثابت احتياطي: عينة الموضوع كافية لكن لا تاريخ ولا نظراء.
        return ['type' => 'static', 'rate' => $staticFallbackMilli, 'sample_sufficient' => true];
    }

    /** الوسيط — إحصاء قوي لا يتأثر بالقيم المتطرفة. */
    public static function median(array $values): int
    {
        if ($values === []) {
            return 0;
        }
        sort($values);
        $count = count($values);
        $mid = intdiv($count, 2);

        return $count % 2 === 1
            ? (int) $values[$mid]
            : intdiv((int) $values[$mid - 1] + (int) $values[$mid], 2);
    }

    /** معدّل مطبّع بمقياس ×1000، آمن ضد القسمة على صفر. */
    public static function rateMilli(int $numerator, int $denominator, int $per): ?int
    {
        if ($denominator <= 0) {
            return null;
        }

        return intdiv($numerator * $per * PosExceptionRuleCatalog::RATE_SCALE, $denominator);
    }
}
