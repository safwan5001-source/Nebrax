<?php

namespace App\Support;

use Carbon\CarbonImmutable;

/**
 * تحويل وحدات قيم التقارير إلى نصوص عشرية **بأعداد صحيحة فقط** (لا float) — مُصدِّر الملفات يستعمله وحده. قيم الحمولة مللتر صحيح وهللة صحيحة؛
 * العرض في الواجهة يطبّق التحويل نفسه (متجه اختبار مشترك يضمن التطابق بين الشاشة وPDF وExcel وCSV).
 */
final class FuelReportFormatter
{
    /** مللتر صحيح ← لترات بثلاث منازل ("100.000"). */
    public static function liters(int $milliliters): string
    {
        return self::scaled($milliliters, 1000, 3);
    }

    /** هللات صحيحة ← ريال بمنزلتين ("230.00"). */
    public static function money(int $minor): string
    {
        return self::scaled($minor, 100, 2);
    }

    /** نقاط أساسية ← نسبة مئوية بمنزلتين ("15.00" لـ 1500). */
    public static function percentBp(int $bp): string
    {
        return self::scaled($bp, 100, 2);
    }

    /** لحظة ISO-8601 ← "Y-m-d H:i" بتوقيت التقرير. */
    public static function dateTime(?string $iso, string $timezone): ?string
    {
        return $iso === null || $iso === '' ? null : CarbonImmutable::parse($iso)->setTimezone($timezone)->format('Y-m-d H:i');
    }

    private static function scaled(int $value, int $divisor, int $decimals): string
    {
        $sign = $value < 0 ? '-' : '';
        $abs = abs($value);

        return $sign.intdiv($abs, $divisor).'.'.str_pad((string) ($abs % $divisor), $decimals, '0', STR_PAD_LEFT);
    }
}
