<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderEvent;
use Illuminate\Support\Collection;

/**
 * قارئ تغذية أحداث طلبات المتجر بالمؤشّر (COPS-H1-2، ADR-29 §2.4). **قراءة فقط، بلا أقفال.**
 *
 * الاكتمال لا يحتاج قفلاً هنا: `feed_seq` يُخصَّص بترتيب الالتزام لكل مستأجر بلا فجوات (H1-1)، فالمستطلِع الذي رأى `seq = N` ملتزماً يضمن أن كل ما دونه
 * ملتزم ومرئي أو غير مُخصَّص بعد؛ إذن `feed_seq > after_seq` مرتَّباً تصاعدياً لا يقفز على حدث أبداً مهما تأخر التزام معاملة كاتبة. القراءة تمرّ بـ`TenantScope`
 * (نموذجا `CommerceOrderEvent` و`CommerceOrder` يرثان `BaseModel`) فلا يرى المستأجر إلا أحداثه، ولا تستقبل معرّف مستأجر من العميل.
 *
 * استعلامان ثابتان مهما كثرت الأحداث: صفحة الأحداث (حدّ+1 لمعرفة وجود المزيد) ثم بيانات الطلبات المرجعية لها (`whereIn`) — لا N+1.
 */
final class CommerceOrderFeedReader
{
    public const MAX_LIMIT = 100;

    /**
     * @return array{events: Collection<int, CommerceOrderEvent>, orders: array<string, CommerceOrder>, has_more: bool, next_after_seq: int, limit: int}
     */
    public function page(int $afterSeq, int $limit = self::MAX_LIMIT): array
    {
        $afterSeq = max(0, $afterSeq);
        $limit = max(1, min(self::MAX_LIMIT, $limit));

        $rows = CommerceOrderEvent::query()
            ->where('feed_seq', '>', $afterSeq)
            ->orderBy('feed_seq')
            ->limit($limit + 1)
            ->get();

        $hasMore = $rows->count() > $limit;
        $events = $rows->take($limit)->values();
        $orderIds = $events->pluck('commerce_order_id')->unique()->values()->all();
        $orders = $orderIds === []
            ? []
            : CommerceOrder::query()->whereIn('id', $orderIds)->get(['id', 'number', 'storefront_id', 'sales_channel_id'])->keyBy('id')->all();

        return [
            'events' => $events,
            'orders' => $orders,
            'has_more' => $hasMore,
            'next_after_seq' => $events->isEmpty() ? $afterSeq : (int) $events->last()->feed_seq,
            'limit' => $limit,
        ];
    }

    /**
     * آخر `feed_seq` ملتزم للمستأجر الحالي (0 إن لم يكن) — COPS-H3-3 (D-H3-02): جهاز بلا مؤشّر يبدأ من هنا لا من الصفر فلا يتصفح تاريخ المستأجر ولا يُنبَّه به.
     * قراءة بلا قفل على الفهرس الفريد `(tenant_id, feed_seq)`؛ التسلسل بلا فجوات بترتيب الالتزام فالقيمة بادئة متصلة آمنة (ما فوقها غير ملتزم بعد).
     */
    public function headSeq(): int
    {
        return (int) (CommerceOrderEvent::query()->max('feed_seq') ?? 0);
    }
}
