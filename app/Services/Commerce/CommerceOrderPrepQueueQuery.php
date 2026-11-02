<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderFulfillment;
use App\Models\CommerceOrderSchedule;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COPS-H2-6 (D-H2-18/19/20) — طابور التحضير المجدول: **قراءة فقط، بلا أقفال**
 * ═══════════════════════════════════════════════════════════════
 *  يحسب لكل طلب **مجدول وغير مكتمل** (مؤكَّد، غير ملغى، دفعه جاهز R-5، لا تنفيذ مكتمل): نافذة التسليم بمنطقة لقطته، `prepare_from`، ودلو الاستحقاق:
 *   - `overdue`: انتهت نافذته ولم يكتمل تنفيذه (`delivered`/`picked_up`)؛
 *   - `today` / `tomorrow`: بداية نافذته داخل يوم القناة / اليوم التالي (بمنطقة إعداد جدولة القناة، لا المتصفح)؛
 *   - `prepare_now` («ابدأ التحضير»): مقبول فعلياً، **لا صف تنفيذ**، و`prepare_from ≤ الآن + 60 دقيقة` — بلا نافذة حداثة (D-H2-20).
 *  الدلاء غير حصرية بين `overdue` و`prepare_now` وغيرهما (طلب متأخر لم يبدأ يظهر في الاثنين). طلب غير مجدول خارج الطابور تماماً.
 *
 *  **التقييد:** مرشّح SQL أولي على `delivery_date` بهامش يوم (يغطي ±14/−12) ثم حساب دقيق بـ`CommerceOrderPreparationClock` في PHP؛ سقف مرشّحين صريح
 *  (`MAX_CANDIDATES`) مع علم `truncated`. يمرّ بـ`TenantScope` وبنطاق مخازن المستخدم (`CommerceOrderWarehouseScope`). لا كتابة ولا حدث.
 */
final class CommerceOrderPrepQueueQuery
{
    public const BUCKETS = ['overdue', 'today', 'tomorrow', 'prepare_now'];

    public const MAX_CANDIDATES = 500;

    /** أقدم موعد ما زال يُعدّ «متأخراً» في الطابور (أيام). */
    private const LOOKBACK_DAYS = 30;

    private const LOOKAHEAD_DAYS = 3;

    public function __construct(private readonly CommerceDeliveryScheduleService $schedules, private readonly ProductPreparationService $preparation) {}

    /**
     * @param  ?list<string>  $allowedWarehouseIds
     * @return array{items: Collection<int, array<string, mixed>>, truncated: bool}
     */
    public function run(?string $storefrontId = null, ?string $bucket = null, ?array $allowedWarehouseIds = null, ?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now('UTC');
        $from = $now->subDays(self::LOOKBACK_DAYS + 1)->toDateString();
        $to = $now->addDays(self::LOOKAHEAD_DAYS + 1)->toDateString();

        /** @var Collection<int, CommerceOrder> $orders */
        $orders = CommerceOrderWarehouseScope::apply(CommerceOrder::query(), $allowedWarehouseIds)
            ->where('status', CommerceOrder::STATUS_CONFIRMED)
            ->whereNull('cancelled_at')
            ->whereHas('paymentIntent', fn (Builder $q) => $q->whereIn('status', CommerceOrderAttentionQuery::PAYMENT_READY))
            ->whereHas('schedule', fn (Builder $q) => $q->whereBetween('delivery_date', [$from, $to]))
            ->whereDoesntHave('fulfillment', fn (Builder $q) => $q->whereIn('status', CommerceOrderFulfillment::COMPLETED))
            ->when($storefrontId !== null, fn (Builder $q) => $q->where('storefront_id', $storefrontId))
            ->with(['schedule', 'fulfillment:id,commerce_order_id,status', 'lines:id,commerce_order_id,product_id'])
            ->orderBy('created_at')->orderBy('id')
            ->limit(self::MAX_CANDIDATES + 1)
            ->get();

        $truncated = $orders->count() > self::MAX_CANDIDATES;
        $orders = $orders->take(self::MAX_CANDIDATES);

        $productMinutes = $this->preparation->minutesMany($orders->flatMap(fn (CommerceOrder $o) => $o->lines->pluck('product_id'))->filter()->unique()->values()->all());
        $channelContext = [];
        $items = $orders->map(function (CommerceOrder $order) use ($now, $productMinutes, &$channelContext): ?array {
            $channelContext[$order->sales_channel_id] ??= $this->schedules->settings($order->sales_channel_id);

            return $this->classify($order, $now, $productMinutes, $channelContext[$order->sales_channel_id]);
        })->filter()->values();

        if ($bucket !== null) {
            $items = $items->filter(fn (array $i) => in_array($bucket, $i['buckets'], true))->values();
        }

        return ['items' => $items->sortBy([['window_start', 'asc'], ['order_id', 'asc']])->values(), 'truncated' => $truncated];
    }

    /**
     * يصنّف طلباً مجدولاً (للمستدعين الذين حمّلوا `schedule` و`fulfillment` و`lines`).
     *
     * @param  array<string, int>  $productMinutes
     * @param  array{timezone: string, lead_time_minutes: int}  $channel
     * @return array<string, mixed>|null
     */
    public function classify(CommerceOrder $order, CarbonImmutable $now, array $productMinutes, array $channel): ?array
    {
        /** @var CommerceOrderSchedule|null $schedule */
        $schedule = $order->schedule;
        if ($schedule === null) {
            return null;
        }
        $window = CommerceOrderPreparationClock::window($schedule);
        if ($window === null) {
            return null; // لقطة تالفة ⇒ خارج الطابور
        }
        $minutes = CommerceOrderPreparationClock::prepareMinutes($order, $productMinutes, (int) $channel['lead_time_minutes']);
        $prepareFrom = CommerceOrderPreparationClock::prepareFrom($window, $minutes);

        [$todayStart, $todayEnd] = CommerceOrderPreparationClock::dayBounds($channel['timezone'], $now, 0);
        [$tomorrowStart, $tomorrowEnd] = CommerceOrderPreparationClock::dayBounds($channel['timezone'], $now, 1);

        $buckets = [];
        if ($window['end']->lessThan($now)) {
            $buckets[] = 'overdue';
        }
        if ($window['start']->greaterThanOrEqualTo($todayStart) && $window['start']->lessThan($todayEnd)) {
            $buckets[] = 'today';
        }
        if ($window['start']->greaterThanOrEqualTo($tomorrowStart) && $window['start']->lessThan($tomorrowEnd)) {
            $buckets[] = 'tomorrow';
        }
        if ($this->startable($order) && $prepareFrom->lessThanOrEqualTo($now->addMinutes(CommerceOrderPreparationClock::PREPARE_LOOKAHEAD_MINUTES))) {
            $buckets[] = 'prepare_now';
        }

        return [
            'order_id' => (string) $order->id,
            'window_start' => $window['start']->toIso8601String(),
            'window_end' => $window['end']->toIso8601String(),
            'prepare_from' => $prepareFrom->toIso8601String(),
            'prepare_minutes' => $minutes,
            'timezone' => $schedule->timezone,
            'buckets' => $buckets,
            'order' => $order,
        ];
    }

    /** مقبول فعلياً (الوضع التلقائي أو قُبل يدوياً) وبلا صف تنفيذ. */
    public function startable(CommerceOrder $order): bool
    {
        return $order->fulfillment === null && ! $order->awaitsManualAcceptance();
    }
}
