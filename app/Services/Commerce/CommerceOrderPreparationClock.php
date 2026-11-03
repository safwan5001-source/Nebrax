<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderSchedule;
use Carbon\CarbonImmutable;
use Throwable;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COPS-H2-6 (D-H2-18/19) — ساعة التحضير المجدول: **حساب نقيّ، قراءة فقط**
 * ═══════════════════════════════════════════════════════════════
 *  - استحقاق كل طلب بمنطقة **لقطته** (`commerce_order_schedules.timezone`): بداية/نهاية نافذة التسليم تُفسَّر في تلك المنطقة ثم تُحوَّل إلى UTC. DST والمناطق ±14/−12
 *    تُحسم بمكتبة المناطق لا بإزاحة ثابتة؛ وقتٌ محلي غير موجود (قفزة DST) يتقدّم كما تفعل PHP.
 *  - حدود «اليوم/غداً» بمنطقة إعداد جدولة **القناة الحالي** (← المستأجر ← `Asia/Riyadh`، `CommerceDeliveryScheduleService::settings`) — **لا وقت المتصفح أبداً**.
 *  - `prepare_from = بداية النافذة − مدة التحضير`؛ المدة = أكبر `ProductPreparationService` لسطور الطلب وإلا `lead_time_minutes` للقناة (D-H2-18). لا لقطة جديدة.
 *  - **لا منع للتحضير المبكر** ولا كتابة ولا حدث؛ منطقة/تاريخ/وقت تالف ⇒ `null` (الطلب خارج الطابور) لا استثناء.
 */
final class CommerceOrderPreparationClock
{
    /** هامش «ابدأ التحضير»: يظهر قبل `prepare_from` بهذه الدقائق (D-H2-20). */
    public const PREPARE_LOOKAHEAD_MINUTES = 60;

    /** @return array{start: CarbonImmutable, end: CarbonImmutable}|null UTC */
    public static function window(CommerceOrderSchedule $schedule): ?array
    {
        $date = self::dateString($schedule->delivery_date);
        $start = self::instant($date, $schedule->start_time, $schedule->timezone);
        $end = self::instant($date, $schedule->end_time, $schedule->timezone);
        if ($start === null || $end === null) {
            return null;
        }
        // نافذة تعبر منتصف الليل (end ≤ start) تنتهي في اليوم التالي بالمنطقة نفسها.
        if ($end->lessThanOrEqualTo($start)) {
            $next = self::instant(CarbonImmutable::parse($date)->addDay()->toDateString(), $schedule->end_time, $schedule->timezone);
            $end = $next ?? $end;
        }

        return ['start' => $start, 'end' => $end];
    }

    /**
     * مدة التحضير بالدقائق: أكبر مهلة منتج لسطور الطلب، وإلا مهلة القناة.
     *
     * @param  array<string, int>  $productMinutes  `productId => minutes`
     */
    public static function prepareMinutes(CommerceOrder $order, array $productMinutes, int $channelLeadMinutes): int
    {
        $max = 0;
        foreach ($order->lines as $line) {
            if ($line->product_id !== null) {
                $max = max($max, (int) ($productMinutes[$line->product_id] ?? 0));
            }
        }

        return $max > 0 ? $max : max(0, $channelLeadMinutes);
    }

    public static function prepareFrom(array $window, int $minutes): CarbonImmutable
    {
        return $window['start']->subMinutes($minutes);
    }

    /**
     * حدود يوم المنطقة (UTC): [بداية اليوم، بداية اليوم التالي) لـ`$offsetDays` من «اليوم» بمنطقة القناة.
     *
     * @return array{0: CarbonImmutable, 1: CarbonImmutable}
     */
    public static function dayBounds(string $channelTimezone, CarbonImmutable $now, int $offsetDays = 0): array
    {
        $tz = self::safeZone($channelTimezone);
        // الإزاحة بالأيام التقويمية **قبل** تطبيع منتصف الليل: عند قفزة DST في 00:00 (سانتياغو) يطبّع startOfDay() اليوم إلى 01:00،
        // وإضافة اليوم بعده كانت تحمل هذا الـ01:00 إلى الغد (Codex P2).
        $day = $now->setTimezone($tz)->addDays($offsetDays)->startOfDay();

        return [$day->setTimezone('UTC'), $day->addDay()->startOfDay()->setTimezone('UTC')];
    }

    private static function dateString(mixed $value): string
    {
        return $value instanceof \DateTimeInterface ? $value->format('Y-m-d') : substr((string) $value, 0, 10);
    }

    private static function instant(string $date, ?string $time, ?string $timezone): ?CarbonImmutable
    {
        if ($time === null || $time === '' || preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $date) !== 1) {
            return null;
        }
        $time = substr($time, 0, 5);
        // لقطة الطلب: منطقة تالفة/غائبة ⇒ خارج الطابور (لا افتراض صامت يزيّف الاستحقاق).
        if ($timezone === null || $timezone === '') {
            return null;
        }
        try {
            $local = CarbonImmutable::createFromFormat('Y-m-d H:i', $date.' '.$time, new \DateTimeZone($timezone));

            return $local === false ? null : $local->setTimezone('UTC');
        } catch (Throwable) {
            return null;
        }
    }

    private static function safeZone(?string $timezone): string
    {
        if ($timezone !== null && $timezone !== '') {
            try {
                new \DateTimeZone($timezone);

                return $timezone;
            } catch (Throwable) {
                // تالف ⇒ الافتراضي أدناه
            }
        }

        return 'Asia/Riyadh';
    }
}
