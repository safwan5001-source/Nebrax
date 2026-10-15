<?php

namespace App\Support;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * REM-13a / ADR-0001 — مصدر وحيد للحظة إصدار الفاتورة وتمثيلاتها النصية.
 *
 * **لحظة واحدة، عدة تمثيلات.** تُلتقط اللحظة مرة واحدة عند الترحيل (`capture`) وتُخزَّن في `invoices.issued_at`
 * (UTC، دقة ثانية)، ثم يُشتق منها كل مخرج بتمثيله الخاص:
 *
 *  • XML `IssueDate`/`IssueTime`: توقيت السعودية (AST = UTC+3، بلا توقيت صيفي) وبلا `Z`.
 *    الدليل: XML Implementation Standard v1.2 — BR-KSA-70 («hh:mm:ss for time expressed in AST or hh:mm:ssZ for UTC»)،
 *    BR-KSA-F-01 (التاريخ YYYY-MM-DD)؛ وكل عيّنات SDK الرسمية الـ19 بصيغة AST بلا `Z`.
 *  • QR المرحلة الأولى (وسم 3): صيغة AWJ القائمة حرفياً — ISO 8601 بإزاحة (`2026-10-15T07:00:00+00:00`).
 *  • QR المرحلة الثانية (وسم 3): صيغة AWJ القائمة حرفياً — UTC بـ`Z` (`ZatcaPhaseTwoQrEncoder`).
 *
 * **غير محسوم (D-06 / TAX-E01 — Q1):** نصّ الوسم 3 المطلوب فعلاً (بـ`Z` كأمثلة SEC/Resolution/DTG أم بلا `Z`
 * كعيّنات SDK). لذلك **لا تُغيَّر صيغتا الوسم هنا** ولا تُستنتج من قبول SDK (إذ لا يفحص SDK الوسم 3). هذا الصنف
 * لا يفترض تطابقاً حرفياً بين نصّ XML ونصّ QR؛ المطابقة المطلوبة هي **اللحظة نفسها**.
 */
final class ZatcaIssueTimestamp
{
    /** توقيت السعودية — ثابت UTC+3 بلا توقيت صيفي. */
    public const ZATCA_TIMEZONE = 'Asia/Riyadh';

    /** يلتقط لحظة الإصدار الآن: UTC مقتطعة للثانية (لا يتفاوت التخزين بين SQLite وPostgreSQL). */
    public static function capture(): CarbonImmutable
    {
        return CarbonImmutable::createFromFormat('Y-m-d H:i:s', CarbonImmutable::now('UTC')->format('Y-m-d H:i:s'), 'UTC');
    }

    /** XML `cbc:IssueDate` — تاريخ توقيت السعودية. */
    public static function xmlDate(CarbonInterface $instant): string
    {
        return CarbonImmutable::instance($instant)->setTimezone(self::ZATCA_TIMEZONE)->format('Y-m-d');
    }

    /** XML `cbc:IssueTime` — وقت توقيت السعودية بلا `Z` (BR-KSA-70). */
    public static function xmlTime(CarbonInterface $instant): string
    {
        return CarbonImmutable::instance($instant)->setTimezone(self::ZATCA_TIMEZONE)->format('H:i:s');
    }

    /** نصّ الوسم 3 للمرحلة الأولى — الصيغة الحرفية القائمة (ISO 8601 بإزاحة) لكن من اللحظة المخزَّنة بتوقيت UTC. */
    public static function phase1QrText(CarbonInterface $instant): string
    {
        return CarbonImmutable::instance($instant)->setTimezone('UTC')->format('Y-m-d\TH:i:sP');
    }
}
