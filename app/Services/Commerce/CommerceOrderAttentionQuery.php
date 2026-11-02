<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderFulfillment;
use App\Models\CommercePaymentIntent;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * مصالحة «الطلبات التي تحتاج انتباهاً» من **الحالة الحالية لا من التاريخ** (COPS-H1-2، ADR-29 §2.4 «المصالحة بالحالة»). **قراءة فقط، بلا أقفال.**
 *
 * هي الشبكة المستقلة عن التغذية: حدث فُقد لأي سبب (خلل، استعادة نسخة، كاتب قديم، حذف) يظهر طلبه هنا في المصالحة التالية؛ والعميل يوحّد
 * (Feed ∪ Attention) ويزيل التكرار بمعرّف الطلب.
 *
 * الشرط الأساسي (يطابق R-5 وحدّ الأمان الحالي):
 *   • الطلب `confirmed` وغير ملغى؛
 *   • دفعه **جاهز**: نية COD/استلام (`awaiting_collection`/`collected`) أو نية إلكترونية `paid` — الإلكتروني `pending` (غير المدفوع) لا يدخل ولا يولّد تنبيهاً؛
 *   • ضمن نافذة حداثة (`commerce.attention_window_hours`، الافتراضي 48 ساعة ≥ ضعف أقصى مهلة حجز دفع إلكتروني 24 ساعة، فطلب دُفع قرب نهاية مهلته يظهر).
 *
 * الأسباب (`reasons`) قائمة قابلة للتوسعة، وما يُفعَّل منها يتبع وجود قدرته. `new_order` (H1-2، للتوافق): كل طلب بالشرط الأساسي ضمن النافذة.
 * **`awaiting_acceptance` (COPS-H1-4):** طلب وضعه الفعّال يدوي (لقطة `manual` + بوابة القبول مفتوحة) لم يُقبل — **من الحالة لا من النافذة**: يبقى
 * حتى يُقبل أو يُرفض/يُلغى مهما طال، لأن الانتظار نفسه هو ما يحتاج انتباهاً. البوابة مغلقة ⇒ الاستعلام والأسباب كما في H1-2 حرفياً.
 * **COPS-H2-6 (D-H2-20) — مع بوابة التنفيذ مفتوحة فقط** (`commerce.order_fulfillment_enabled`؛ مغلقة ⇒ الاستعلام والأسباب H1 حرفياً):
 *   • `fulfillment_not_started`: مقبول فعلياً + دفع جاهز + لا صف + **غير مجدول**، ضمن نافذة الحداثة (48س) كالأساس؛
 *   • `due_for_preparation`: مجدول لم يبدأ و`prepare_from ≤ الآن + 60 دقيقة` — **بلا نافذة** (`CommerceOrderPrepQueueQuery`)؛
 *   • `delivery_failed`: تنفيذ `delivery_failed`/`returned_to_store` لطلب غير ملغى — **بلا نافذة** (يبقى ظاهراً حتى يُحسم، AR-1).
 * وH3-4 يزيل المُقَرّ لكل طلب. لا يُخترع هنا سلوك لقدرة لم تُبنَ.
 *
 * الاستعلام يمرّ بـ`TenantScope`؛ الترتيب الأقدم أولاً (الأطول انتظاراً) وبسقف صريح مع علم `truncated`. الفهرس `(tenant_id, status, created_at)`.
 */
final class CommerceOrderAttentionQuery
{
    public function __construct(private readonly CommerceOrderPrepQueueQuery $prepQueue) {}

    public const REASON_NEW_ORDER = 'new_order';

    public const REASON_AWAITING_ACCEPTANCE = 'awaiting_acceptance';

    public const REASON_FULFILLMENT_NOT_STARTED = 'fulfillment_not_started';

    public const REASON_DUE_FOR_PREPARATION = 'due_for_preparation';

    public const REASON_DELIVERY_FAILED = 'delivery_failed';

    public const MAX_LIMIT = 100;

    public const DEFAULT_LIMIT = 50;

    /** حالات النية التي تجعل الدفع «جاهزاً» (R-5). */
    public const PAYMENT_READY = [
        CommercePaymentIntent::STATUS_AWAITING_COLLECTION,
        CommercePaymentIntent::STATUS_COLLECTED,
        CommercePaymentIntent::STATUS_PAID,
    ];

    /**
     * @param  ?list<string>  $allowedWarehouseIds  null = غير مقيَّد
     * @return array{orders: Collection<int, CommerceOrder>, truncated: bool, window_hours: int, limit: int}
     */
    public function run(?string $storefrontId = null, int $limit = self::DEFAULT_LIMIT, ?array $allowedWarehouseIds = null): array
    {
        $limit = max(1, min(self::MAX_LIMIT, $limit));
        $hours = self::windowHours();

        $since = now('UTC')->subHours($hours);
        $acceptanceOpen = (bool) config('commerce.order_acceptance_enabled');
        $fulfillmentOpen = (bool) config('commerce.order_fulfillment_enabled');
        $select = ['id', 'number', 'storefront_id', 'sales_channel_id', 'delivery_method', 'status', 'cancelled_at', 'created_at', 'acceptance_mode', 'accepted_at'];

        // COPS-H2-2: المقيَّد بمخازن يرى انتباه طلبات مخازنه فقط (المخزن الفعّال)؛ غير المقيَّد (`null`) كما كان.
        $rows = CommerceOrderWarehouseScope::apply(CommerceOrder::query(), $allowedWarehouseIds)
            ->select($select)
            ->with('paymentIntent:id,commerce_order_id,method,status')
            ->where('status', CommerceOrder::STATUS_CONFIRMED)
            ->whereNull('cancelled_at')
            ->when(
                $acceptanceOpen,
                // نافذة الحداثة (new_order) **أو** بانتظار قبول يدوي مهما كان عمره.
                fn ($q) => $q->where(fn ($w) => $w->where('created_at', '>=', $since)
                    ->orWhere(fn ($m) => $m->where('acceptance_mode', CommerceOrder::ACCEPTANCE_MANUAL)->whereNull('accepted_at'))),
                fn ($q) => $q->where('created_at', '>=', $since),
            )
            ->whereHas('paymentIntent', fn ($q) => $q->whereIn('status', self::PAYMENT_READY))
            ->when($storefrontId !== null, fn ($q) => $q->where('storefront_id', $storefrontId))
            ->orderBy('created_at')->orderBy('id')
            ->limit($limit + 1)
            ->get();

        if ($fulfillmentOpen) {
            $rows = $this->withFulfillmentReasons($rows, $storefrontId, $allowedWarehouseIds, $select, $limit);
        }

        return [
            'orders' => $rows->take($limit)->values(),
            'truncated' => $rows->count() > $limit,
            'window_hours' => $hours,
            'limit' => $limit,
        ];
    }

    /**
     * COPS-H2-6: يضيف أسباب التنفيذ (D-H2-20) للصفوف الأساسية ويضمّ إليها الطلبات التي تستحق الانتباه **بلا نافذة** (`delivery_failed`، `due_for_preparation`).
     * الصفوف المضافة تمرّ بالشروط الأساسية نفسها (مؤكَّد، غير ملغى) وبنطاق المخازن والمتجر. الترتيب الأقدم أولاً على الاتحاد.
     *
     * @param  Collection<int, CommerceOrder>  $rows
     * @param  ?list<string>  $allowedWarehouseIds
     * @param  list<string>  $select
     * @return Collection<int, CommerceOrder>
     */
    private function withFulfillmentReasons(Collection $rows, ?string $storefrontId, ?array $allowedWarehouseIds, array $select, int $limit): Collection
    {
        $now = CarbonImmutable::now('UTC');

        // 1) الطلبات المجدولة التي حان تحضيرها (بلا نافذة) — من طابور التحضير، دلو `prepare_now`.
        $prep = $this->prepQueue->run($storefrontId, 'prepare_now', $allowedWarehouseIds, $now)['items']->keyBy('order_id');

        // 2) تنفيذ فاشل/عائد غير ملغى (بلا نافذة).
        $failedIds = CommerceOrderWarehouseScope::apply(CommerceOrder::query(), $allowedWarehouseIds)
            ->where('status', CommerceOrder::STATUS_CONFIRMED)->whereNull('cancelled_at')
            ->whereHas('fulfillment', fn (Builder $q) => $q->whereIn('status', [CommerceOrderFulfillment::DELIVERY_FAILED, CommerceOrderFulfillment::RETURNED_TO_STORE]))
            ->when($storefrontId !== null, fn ($q) => $q->where('storefront_id', $storefrontId))
            ->orderBy('created_at')->orderBy('id')->limit($limit + 1)->pluck('id')->all();

        $have = $rows->pluck('id')->all();
        $extraIds = array_values(array_diff(array_unique([...array_keys($prep->all()), ...$failedIds]), $have));
        $extras = $extraIds === [] ? collect() : CommerceOrder::query()
            ->select($select)
            ->with('paymentIntent:id,commerce_order_id,method,status')
            ->whereIn('id', $extraIds)->get();

        $all = $rows->concat($extras)->sortBy([['created_at', 'asc'], ['id', 'asc']])->values();
        $all->load(['fulfillment:id,commerce_order_id,status', 'schedule']);

        foreach ($all as $order) {
            $order->setAttribute('h2_reasons', $this->fulfillmentReasons($order, $prep->has($order->id), $now));
        }

        return $all;
    }

    /** @return list<string> */
    private function fulfillmentReasons(CommerceOrder $order, bool $prepareNow, CarbonImmutable $now): array
    {
        $reasons = [];
        $row = $order->fulfillment;
        $ready = $order->paymentIntent !== null && in_array($order->paymentIntent->status, self::PAYMENT_READY, true);

        if ($row === null && $order->schedule === null && $ready && ! $order->awaitsManualAcceptance()
            && $order->created_at !== null && $order->created_at->greaterThanOrEqualTo($now->subHours(self::windowHours()))) {
            $reasons[] = self::REASON_FULFILLMENT_NOT_STARTED;
        }
        if ($prepareNow) {
            $reasons[] = self::REASON_DUE_FOR_PREPARATION;
        }
        if ($row !== null && in_array($row->status, [CommerceOrderFulfillment::DELIVERY_FAILED, CommerceOrderFulfillment::RETURNED_TO_STORE], true)) {
            $reasons[] = self::REASON_DELIVERY_FAILED;
        }

        return $reasons;
    }

    public static function windowHours(): int
    {
        return max(1, min(24 * 30, (int) config('commerce.attention_window_hours', 48)));
    }

    /**
     * أسباب الانتباه لطلب. قائمة قابلة للتوسعة بقدرات الشرائح اللاحقة (انظر وصف الصنف).
     *
     * @return list<string>
     */
    public function reasonsFor(CommerceOrder $order): array
    {
        $reasons = [];
        if ($order->created_at !== null && $order->created_at->greaterThanOrEqualTo(now('UTC')->subHours(self::windowHours()))) {
            $reasons[] = self::REASON_NEW_ORDER;
        }
        if ($order->awaitsManualAcceptance()) {
            $reasons[] = self::REASON_AWAITING_ACCEPTANCE;
        }

        // COPS-H2-6: أسباب التنفيذ تُحسب في `run()` مع بوابة التنفيذ مفتوحة فقط (غيابها ⇒ H1 حرفياً).
        $reasons = [...$reasons, ...(array) ($order->getAttribute('h2_reasons') ?? [])];

        // كل صف من `run()` يطابق أحد الفرعين؛ حدّ النافذة قد يُعبَر بين الاستعلام والحساب ⇒ لا يُعاد طلب بلا سبب.
        return $reasons === [] ? [self::REASON_NEW_ORDER] : $reasons;
    }
}
