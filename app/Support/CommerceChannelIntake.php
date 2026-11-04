<?php

namespace App\Support;

use Carbon\CarbonImmutable;

/**
 * COPS-H4-4 (D-OPS-7/8، D-H4-05) — تقييم تحكّمات استقبال الطلبات: **دالة نقية** بلا قاعدة بيانات ولا ساعة نظام (الوقت يُمرَّر)، فتُختبر بمصفوفة حالات.
 * اللقطة `$snapshot` تأتي من `CommerceChannelOperationsSettingsService::intakeSnapshot()` (القارئ الوحيد للجدول):
 * `accepting` bool · `paused_until` ?ISO-UTC · `pause_message` ?string · `policy` accept|block · `hours` list{weekday,opens_at,closes_at} · `min_order_minor` ?int · `min_order_scope`.
 *
 *  • **الإيقاف:** `accepting=false` و(`paused_until` فارغ أو في المستقبل) ⇒ `paused`. موعد استئناف مضى ⇒ الاستئناف تلقائي (يُعامَل الإيقاف منتهياً).
 *  • **ساعات العمل:** لا فترات ⇒ مفتوحة 24/7 مهما كانت السياسة. بفترات: يوم بلا فترات = مغلق، والفترة `[opens_at, closes_at)` بتوقيت القناة (يوم 0=الأحد..6=السبت). خارجها مع
 *    السياسة `block` ⇒ `outside_hours`؛ مع `accept` ⇒ لا حجب (الساعات معلوماتية).
 *  • **الحد الأدنى:** على مجموع السطور **بعد الخصم وقبل الشحن** بالهللات؛ النطاق `delivery_only` يستثني الاستلام من المتجر.
 */
final class CommerceChannelIntake
{
    // القيم النصية (`accept|block`، `all|delivery_only`) معرَّفة في نموذج الإعداد؛ تُكرَّر حرفياً هنا كي لا يرجع هذا الصنف إلى نموذج الجدول (حصر القراءة في الخدمة).
    public const REASON_PAUSED = 'paused';

    public const REASON_OUTSIDE_HOURS = 'outside_hours';

    public const REVIEW_PAUSED = 'store_paused';

    public const REVIEW_OUTSIDE_HOURS = 'outside_opening_hours';

    public const REVIEW_BELOW_MINIMUM = 'below_minimum_order';

    /**
     * @param  array<string, mixed>  $snapshot
     * @return array{accepting: bool, reason: ?string, resumes_at: ?string, message: ?string}
     */
    public static function state(array $snapshot, CarbonImmutable $now, string $timezone): array
    {
        $pausedUntil = $snapshot['paused_until'] ?? null;
        $pauseActive = ($snapshot['accepting'] ?? true) === false
            && ($pausedUntil === null || CarbonImmutable::parse($pausedUntil)->greaterThan($now));
        if ($pauseActive) {
            return ['accepting' => false, 'reason' => self::REASON_PAUSED, 'resumes_at' => $pausedUntil, 'message' => $snapshot['pause_message'] ?? null];
        }

        if (($snapshot['policy'] ?? 'accept') === 'block'
            && ! self::isOpenAt($snapshot['hours'] ?? [], $now, $timezone)) {
            return ['accepting' => false, 'reason' => self::REASON_OUTSIDE_HOURS, 'resumes_at' => null, 'message' => null];
        }

        return ['accepting' => true, 'reason' => null, 'resumes_at' => null, 'message' => null];
    }

    /**
     * @param  list<array{weekday: int, opens_at: string, closes_at: string}>  $hours
     */
    public static function isOpenAt(array $hours, CarbonImmutable $now, string $timezone): bool
    {
        if ($hours === []) {
            return true;
        }
        try {
            $local = $now->setTimezone($timezone);
        } catch (\Throwable) {
            $local = $now->setTimezone('Asia/Riyadh');
        }
        $weekday = (int) $local->dayOfWeek;
        $time = $local->format('H:i');
        foreach ($hours as $period) {
            if ((int) $period['weekday'] === $weekday && $period['opens_at'] <= $time && $time < $period['closes_at']) {
                return true;
            }
        }

        return false;
    }

    /**
     * النقص عن الحد الأدنى بالهللات، أو `null` إن لم ينطبق/تحقق.
     *
     * @param  array<string, mixed>  $snapshot
     */
    public static function minimumShortfall(array $snapshot, int $linesTotalMinor, ?string $deliveryMethod): ?int
    {
        $min = $snapshot['min_order_minor'] ?? null;
        if ($min === null) {
            return null;
        }
        if (($snapshot['min_order_scope'] ?? 'all') === 'delivery_only'
            && $deliveryMethod === 'pickup') {
            return null;
        }

        return $linesTotalMinor < (int) $min ? (int) $min - $linesTotalMinor : null;
    }

    /** نصّ الرفض العام للمشتري (عربي؛ الواجهة تترجم بالرمز). لا يكشف إعداداً داخلياً. */
    public static function reviewMessage(string $reviewReason, ?string $pauseMessage = null): string
    {
        return match ($reviewReason) {
            self::REVIEW_PAUSED => $pauseMessage !== null && $pauseMessage !== '' ? $pauseMessage : 'المتجر لا يستقبل طلبات جديدة حالياً.',
            self::REVIEW_OUTSIDE_HOURS => 'المتجر خارج ساعات العمل حالياً ولا يستقبل طلبات جديدة.',
            default => 'لم يبلغ طلبك الحدّ الأدنى للطلب.',
        };
    }
}
