<?php

namespace App\Support;

/**
 * عقد توقيع الـ Webhooks — HMAC-SHA256 على **الجسم الخام** مع طابع زمني (PR-7).
 *
 * مدخل التوقيع: «{timestamp}.{raw_body}» — الطابع الزمني جزء من المُوقَّع فيقلّل
 * خطر إعادة التشغيل. التوقيع = hex لـ HMAC-SHA256 بالسرّ الخام للاشتراك.
 *
 * ترويسة التوقيع: `X-AWJ-Signature: t={ts},v1={hex}` (إصدار مُعلَّم للتطوّر الآمن).
 * التحقّق لدى المستهلك: أعد بناء المدخل من الجسم الخام والطابع، واحسب HMAC، وقارن
 * **بزمن ثابت** (`hash_equals`)، وتحقّق من تفاوت الطابع الزمني، وأزل التكرار بمعرّف
 * الحدث. السرّ لا يُرسل في الحمولة ولا يُسجَّل قطّ.
 */
final class WebhookSignature
{
    public const SIGNATURE_VERSION = 'v1';

    // أسماء الترويسات — جزء من العقد العام للمستهلكين.
    public const HEADER_SIGNATURE = 'X-AWJ-Signature';
    public const HEADER_ID = 'X-AWJ-Webhook-Id';
    public const HEADER_DELIVERY = 'X-AWJ-Webhook-Delivery';
    public const HEADER_EVENT = 'X-AWJ-Webhook-Event';
    public const HEADER_ATTEMPT = 'X-AWJ-Webhook-Attempt';
    public const HEADER_TIMESTAMP = 'X-AWJ-Webhook-Timestamp';

    /** يحسب توقيع hex لـ HMAC-SHA256 على «{timestamp}.{rawBody}». */
    public static function sign(string $secret, int $timestamp, string $rawBody): string
    {
        return hash_hmac('sha256', self::signingInput($timestamp, $rawBody), $secret);
    }

    /** مدخل التوقيع المُقنَّن. */
    public static function signingInput(int $timestamp, string $rawBody): string
    {
        return $timestamp . '.' . $rawBody;
    }

    /** قيمة ترويسة `X-AWJ-Signature`: `t={ts},v1={hex}`. */
    public static function signatureHeader(int $timestamp, string $signature): string
    {
        return 't=' . $timestamp . ',' . self::SIGNATURE_VERSION . '=' . $signature;
    }

    /**
     * تحقّق بزمن ثابت من توقيع الجسم الخام مقابل السرّ والطابع الزمني المعطيَين.
     * (مرجع للاختبارات ولإرشاد المستهلك — لا حالة إعادة تشغيل واردة هنا.)
     */
    public static function verify(string $secret, int $timestamp, string $rawBody, string $signature): bool
    {
        $expected = self::sign($secret, $timestamp, $rawBody);

        return hash_equals($expected, $signature);
    }
}
