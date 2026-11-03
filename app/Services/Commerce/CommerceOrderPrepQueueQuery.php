<?php

namespace App\Services\Commerce;

use App\Models\CommerceDeliveryScheduleSetting;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderFulfillment;
use App\Models\CommerceOrderSchedule;
use App\Models\CommerceProductPreparation;
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
 *  **التقييد:** مرشّح SQL أولي **لكل دلو** على `delivery_date` بهامش يوم (يغطي ±14/−12؛ وأفق `prepare_now` يغطي أطول تحضير مدعوم 30 يوماً) ثم حساب دقيق بـ`CommerceOrderPreparationClock` في PHP؛ سقف مرشّحين صريح
 *  (`MAX_CANDIDATES`) مع علم `truncated`. يمرّ بـ`TenantScope` وبنطاق مخازن المستخدم (`CommerceOrderWarehouseScope`). لا كتابة ولا حدث.
 */
final class CommerceOrderPrepQueueQuery
{
    public const BUCKETS = ['overdue', 'today', 'tomorrow', 'prepare_now'];

    public const MAX_CANDIDATES = 500;

    /** أفق الدلاء الزمنية (`today`/`tomorrow`) بالأيام، بهامش يوم للمنطقة الزمنية. */
    private const LOOKAHEAD_DAYS = 3;

    public function __construct(private readonly CommerceDeliveryScheduleService $schedules, private readonly ProductPreparationService $preparation) {}

    /**
     * @param  ?list<string>  $allowedWarehouseIds
     * @return array{items: Collection<int, array<string, mixed>>, truncated: bool}
     */
    public function run(?string $storefrontId = null, ?string $bucket = null, ?array $allowedWarehouseIds = null, ?CarbonImmutable $now = null): array
    {
        $now ??= CarbonImmutable::now('UTC');

        /** @var Collection<int, CommerceOrder> $orders */
        $orders = CommerceOrderWarehouseScope::apply(CommerceOrder::query(), $allowedWarehouseIds)
            ->where('status', CommerceOrder::STATUS_CONFIRMED)
            ->whereNull('cancelled_at')
            ->whereHas('paymentIntent', fn (Builder $q) => $q->whereIn('status', CommerceOrderAttentionQuery::PAYMENT_READY))
            ->where(function (Builder $q) use ($bucket, $now): void {
                // مرشّح أولي لكل دلو على حدة قبل السقف: طلبات دلو آخر لا تستنزف ميزانية المرشّحين (Codex P2)،
                // وأفق `prepare_now` يغطي أطول مدة تحضير مدعومة (30 يوماً) لا نافذة ثابتة (Codex P1).
                foreach ($bucket === null ? self::BUCKETS : [$bucket] as $b) {
                    $q->orWhere(fn (Builder $w) => $this->coarse($w, $b, $now));
                }
            })
            ->whereDoesntHave('fulfillment', fn (Builder $q) => $q->whereIn('status', CommerceOrderFulfillment::COMPLETED))
            ->when($storefrontId !== null, fn (Builder $q) => $q->where('storefront_id', $storefrontId))
            ->with(['schedule', 'fulfillment:id,commerce_order_id,status', 'lines:id,commerce_order_id,product_id'])
            ->orderBy('created_at')->orderBy('id')
            ->limit(self::MAX_CANDIDATES + 1)
            ->get();

        $truncated = $orders->count() > self::MAX_CANDIDATES;
        $orders = $orders->take(self::MAX_CANDIDATES);

        $productMinutes = $this->preparation->minutesMany($orders->flatMap(fn (CommerceOrder $o) => $o->lines->pluck('product_id'))->filter()->unique()->values()->all());
        // إعدادات كل القنوات المرشَّحة دفعةً واحدة (لا استعلام لكل قناة — Codex P2).
        $channelContext = $this->schedules->settingsMany($orders->pluck('sales_channel_id')->filter()->unique()->values()->all());
        $items = $orders->map(fn (CommerceOrder $order): ?array => $this->classify($order, $now, $productMinutes, $channelContext[$order->sales_channel_id] ?? $this->schedules->settings($order->sales_channel_id)))->filter()->values();

        if ($bucket !== null) {
            $items = $items->filter(fn (array $i) => in_array($bucket, $i['buckets'], true))->values();
        }

        return ['items' => $items->sortBy([['window_start', 'asc'], ['order_id', 'asc']])->values(), 'truncated' => $truncated];
    }

    /**
     * مرشّح SQL أولي (واسع بهامش يوم للمنطقة الزمنية) لدلو واحد؛ الحساب الدقيق في `classify()`.
     * `overdue`: نهاية النافذة قبل الآن ⇒ تاريخ التسليم ≤ غداً. `today`/`tomorrow`: حول اليوم.
     * `prepare_now`: بلا صف تنفيذ، وتاريخ التسليم حتى (أطول تحضير مدعوم + نافذة الاستباق) من الآن.
     */
    private function coarse(Builder $q, string $bucket, CarbonImmutable $now): void
    {
        // `overdue` و`prepare_now` بلا حدّ أدنى (D-H2-20: بلا نافذة حداثة): طلب عالق لا يتوقف عن الحاجة للتحضير لأنه شاخ؛ يحدّ المعالجةَ سقفُ المرشّحين وعلم `truncated`.
        [$low, $high] = match ($bucket) {
            'overdue' => [null, $now->addDay()->toDateString()],
            // يوم القناة (UTC−12..+14، حتى 25 ساعة) ونافذة اللقطة بمنطقتها هي (تاريخ التسليم ± يوم بالتوقيت العالمي): منطقتان قد تختلفان
            // بما يصل إلى يومين، فالهامش ثلاثة أيام لـ«اليوم» وأربعة لـ«غداً» (Codex P2).
            'today' => [$now->subDays(3)->toDateString(), $now->addDays(3)->toDateString()],
            'tomorrow' => [$now->subDay()->toDateString(), $now->addDays(self::LOOKAHEAD_DAYS + 1)->toDateString()],
            default => [null, $now->addDays(self::prepareHorizonDays())->toDateString()],
        };
        $q->whereHas('schedule', fn (Builder $s) => $low === null ? $s->where('delivery_date', '<=', $high) : $s->whereBetween('delivery_date', [$low, $high]));
        if ($bucket === 'prepare_now') {
            $q->whereDoesntHave('fulfillment');
        }
    }

    /** أيام أفق `prepare_now`: أكبر تحضير مدعوم (منتج/قناة) + الاستباق + يومان هامش منطقة زمنية. */
    private static function prepareHorizonDays(): int
    {
        $maxMinutes = max(CommerceProductPreparation::MAX_MINUTES, CommerceDeliveryScheduleSetting::MAX_LEAD_TIME_MINUTES);

        return intdiv($maxMinutes + CommerceOrderPreparationClock::PREPARE_LOOKAHEAD_MINUTES, 1440) + 2;
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
