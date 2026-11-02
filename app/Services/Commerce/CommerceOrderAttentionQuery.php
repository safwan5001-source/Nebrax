<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
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
 * الأسباب (`reasons`) قائمة قابلة للتوسعة، وما يُفعَّل منها يتبع وجود قدرته: في H1-2 لا قبول يدوي ولا تنفيذ ولا إقرار فيُرجَع السبب الأساسي `new_order`
 * وحده؛ H1-4 يضيف `awaiting_acceptance`، وH2 يضيف `fulfillment_not_started`، وH3-4 يزيل المُقَرّ لكل طلب. لا يُخترع هنا سلوك لقدرة لم تُبنَ.
 *
 * الاستعلام يمرّ بـ`TenantScope`؛ الترتيب الأقدم أولاً (الأطول انتظاراً) وبسقف صريح مع علم `truncated`. الفهرس `(tenant_id, status, created_at)`.
 */
final class CommerceOrderAttentionQuery
{
    public const REASON_NEW_ORDER = 'new_order';

    public const MAX_LIMIT = 100;

    public const DEFAULT_LIMIT = 50;

    /** حالات النية التي تجعل الدفع «جاهزاً» (R-5). */
    public const PAYMENT_READY = [
        CommercePaymentIntent::STATUS_AWAITING_COLLECTION,
        CommercePaymentIntent::STATUS_COLLECTED,
        CommercePaymentIntent::STATUS_PAID,
    ];

    /**
     * @return array{orders: Collection<int, CommerceOrder>, truncated: bool, window_hours: int, limit: int}
     */
    public function run(?string $storefrontId = null, int $limit = self::DEFAULT_LIMIT): array
    {
        $limit = max(1, min(self::MAX_LIMIT, $limit));
        $hours = self::windowHours();

        $rows = CommerceOrder::query()
            ->select(['id', 'number', 'storefront_id', 'sales_channel_id', 'delivery_method', 'status', 'cancelled_at', 'created_at'])
            ->with('paymentIntent:id,commerce_order_id,method,status')
            ->where('status', CommerceOrder::STATUS_CONFIRMED)
            ->whereNull('cancelled_at')
            ->where('created_at', '>=', now('UTC')->subHours($hours))
            ->whereHas('paymentIntent', fn ($q) => $q->whereIn('status', self::PAYMENT_READY))
            ->when($storefrontId !== null, fn ($q) => $q->where('storefront_id', $storefrontId))
            ->orderBy('created_at')->orderBy('id')
            ->limit($limit + 1)
            ->get();

        return [
            'orders' => $rows->take($limit)->values(),
            'truncated' => $rows->count() > $limit,
            'window_hours' => $hours,
            'limit' => $limit,
        ];
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
        return [self::REASON_NEW_ORDER];
    }
}
