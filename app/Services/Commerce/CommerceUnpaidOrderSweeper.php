<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\InventoryReservation;
use App\Models\PaymentAttempt;
use App\Services\PaymentOrchestrationException;
use App\Services\PaymentOrchestrator;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  مكنسة الطلبات الإلكترونية غير المدفوعة — H4-02 / D-14
 * ═══════════════════════════════════════════════════════════════
 *  الحجز المؤقت (`InventoryReservation.expires_at`) **لا يُحرَّر تلقائياً** ببلوغ الموعد: هذه المكنسة وحدها تحرّره، **بعد التحقق من حالة الدفع** لدى المزوّد:
 *   1) لكل محاولة دفع نشطة: `reconcile` (يسأل المزوّد ثم يُنهي المنتهية). تعذّر الوصول إلى المزوّد ⇒ يُترك الطلب كما هو ويُعاد في التشغيل التالي
 *      (الاتجاه الآمن: يبقى المخزون محجوزاً ولا يُباع طلب قد يكون مدفوعاً).
 *   2) إن التُقط مبلغ ⇒ `completeCaptured` (النية مدفوعة والحجز يصير دائماً) — لا إلغاء ولا تحرير.
 *   3) محاولة ما زالت نشطة بعد المطابقة (صفحة حيّة/مفوَّضة) ⇒ يُترك الطلب ويُؤجَّل موعده (لا تحرير تحت صفحة قد تُدفع).
 *   4) وإلا ⇒ إلغاء النية (`CommercePaymentIntentService::cancel`، يغلق المحاولات محلياً ويرفض إن ظهر التقاط تحت القفل) ثم تحرير الحجز.
 *      التقاط متأخر بعد ذلك يُوسَم `late_capture` للمراجعة البشرية (D-15)؛ الطلب يبقى سجلاً (بلا حالة طلب جديدة).
 *  لا أثر محاسبي ولا حركة مخزون. كل طلب معزول (فشل واحد لا يوقف الباقي) وبسياق مستأجره.
 */
final class CommerceUnpaidOrderSweeper
{
    /** تراجع (دقائق) بعد تخطٍّ أو فشل: يمنع إعادة الطلب نفسه في رأس كل دفعة فيحجب الأحدث. */
    private const BACKOFF_MINUTES = 10;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly PaymentOrchestrator $orchestrator,
        private readonly CommerceOnlinePaymentService $online,
        private readonly CommercePaymentIntentService $intents,
        private readonly CommerceOrderReservationService $reservations,
    ) {}

    /** @return array{processed: int, released: int, paid: int, skipped: int, failed: int} */
    public function run(int $limit = 100): array
    {
        $summary = ['processed' => 0, 'released' => 0, 'paid' => 0, 'skipped' => 0, 'failed' => 0];

        $due = InventoryReservation::query()->withoutGlobalScopes()
            ->where('status', InventoryReservation::STATUS_ACTIVE)
            ->where('source_type', CommerceOrder::class)
            ->whereNotNull('expires_at')
            ->where('expires_at', '<=', now('UTC'))
            ->selectRaw('tenant_id, source_id, min(expires_at) as due_at')
            ->groupBy('tenant_id', 'source_id')
            ->orderBy('due_at')
            ->limit($limit)
            ->get();

        $previous = $this->tenant->id();
        foreach ($due as $row) {
            $summary['processed']++;
            $this->tenant->set((string) $row->tenant_id);
            try {
                $outcome = $this->sweepOrder((string) $row->source_id);
                $summary[$outcome]++;
                if ($outcome === 'skipped') {
                    $this->reservations->deferExpiry((string) $row->source_id, self::BACKOFF_MINUTES);
                }
            } catch (\Throwable $e) {
                $summary['failed']++;
                report($e);
                try {
                    $this->reservations->deferExpiry((string) $row->source_id, self::BACKOFF_MINUTES);
                } catch (\Throwable) {
                    // لا نخفي الخطأ الأصلي؛ يعاد الطلب في التشغيل التالي
                }
            } finally {
                $previous === null ? $this->tenant->forget() : $this->tenant->set($previous);
            }
        }

        return $summary;
    }

    /** @return 'released'|'paid'|'skipped' */
    private function sweepOrder(string $orderId): string
    {
        $order = CommerceOrder::query()->find($orderId);
        $intent = $order === null ? null : CommercePaymentIntent::query()->where('commerce_order_id', $order->getKey())->first();

        // طلب بلا نية إلكترونية (محذوف/مغيَّر): الحجز بلا مالك دفع ⇒ يُحرَّر.
        if ($order === null || $intent === null || ! $intent->isOnline()) {
            $this->reservations->releaseActive($orderId);

            return 'released';
        }
        if ($intent->isPaid()) {
            $this->reservations->makePermanent($orderId);

            return 'paid';
        }
        if ($intent->isCancelled()) {
            $this->reservations->releaseActive($orderId);

            return 'released';
        }

        // نية pending: تحقّق من المزوّد قبل أي تحرير.
        foreach (PaymentAttempt::query()->where('payable_key', $intent->payableKey())->whereIn('capture_status', PaymentAttempt::ACTIVE_STATUSES)->get() as $attempt) {
            try {
                $this->orchestrator->reconcile($attempt);
            } catch (PaymentOrchestrationException) {
                return 'skipped'; // لا يمكن التحقق الآن: يبقى الحجز ويُعاد لاحقاً
            }
        }
        $captured = PaymentAttempt::query()->where('payable_key', $intent->payableKey())
            ->where('capture_status', PaymentAttempt::STATUS_CAPTURED)->get();
        // «لم يُلتقط بعد» ≠ «ميّت»: بعد `reconcile` أي محاولة ما زالت نشطة (صفحة حيّة لم تنتهِ، أو مفوَّضة) قد تُدفع بعد قليل ⇒ لا إلغاء ولا تحرير؛
        // تنتهي صفحتها بحدّ TTL المزوّد فيحسم التشغيل التالي. (الحجز يمتد إذن إلى انتهاء آخر صفحة حيّة.)
        if ($captured->isEmpty() && PaymentAttempt::query()->where('payable_key', $intent->payableKey())
            ->whereIn('capture_status', PaymentAttempt::ACTIVE_STATUSES)->exists()) {
            return 'skipped';
        }
        foreach ($captured as $attempt) {
            if ($this->online->completeCaptured($attempt)) {
                return 'paid';
            }
        }
        if ($captured->isNotEmpty()) {
            return 'skipped'; // التقاط محجوز للمراجعة البشرية (مبلغ/عملة): لا إلغاء ولا تحرير
        }

        try {
            $this->intents->cancel($intent);
        } catch (RuntimeException) {
            // التُقط مبلغ بين الفحص والقفل (أو أُلغيت النية للتوّ): نعيد التقييم في التشغيل التالي بدل التحرير الأعمى.
            return 'skipped';
        }
        $this->reservations->releaseActive($orderId); // idempotent (cancel() حرّرها غالباً)

        return 'released';
    }
}
