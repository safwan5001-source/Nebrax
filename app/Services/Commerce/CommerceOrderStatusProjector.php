<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;

/**
 * COPS-H1-4 (ADR-29 §2.1) — المُسقِط الوحيد لـ`operational_status`: قيمة **مشتقة للعرض فقط** من الحقائق الأصلية (دورة الحياة، الدفع، القبول).
 * **لا تُخزَّن، ولا تُستعمل شرطاً في أي انتقال** (الانتقالات تفحص الحقائق تحت الأقفال)، ولا تضيف مصدر حقيقة جديداً لحالة الطلب.
 * دالة نقية: لا استعلام (يتطلب `paymentIntent` محمَّلاً) ولا أثر.
 *
 * الأسبقية (الأولى المطابقة):
 *  1. `cancelled`           — للطلب `cancelled_at` (يشمل رفض التاجر `merchant_rejected`).
 *  2. `draft`               — غير مؤكَّد (لا يراه مسار الموظف عادةً).
 *  3. `awaiting_payment`    — دفع غير جاهز وغير منتهٍ: نية إلكترونية `pending`، أو لا نية (R-5: خارج طابور القبول وبلا تنبيه).
 *  4. `payment_cancelled`   — نيته ملغاة والطلب غير ملغى (مثل طلب إلكتروني انتهت مهلة دفعه فألغت المكنسة نيته؛ يبقى الطلب سجلاً).
 *  5. `awaiting_acceptance` — وضعه الفعّال يدوي (لقطة `manual` + البوابة مفتوحة) ولم يُقبل.
 *  6. `accepted`            — قُبل يدوياً، أو تلقائي (لقطة `NULL` أو البوابة مغلقة ⇒ القبول ضمني).
 *
 * التنفيذ (H2) يضيف حالاته **بعد** `accepted` (تحضير/جاهز/…)؛ لا يُختلق هنا شيء منها.
 */
final class CommerceOrderStatusProjector
{
    public const CANCELLED = 'cancelled';

    public const DRAFT = 'draft';

    public const AWAITING_PAYMENT = 'awaiting_payment';

    public const PAYMENT_CANCELLED = 'payment_cancelled';

    public const AWAITING_ACCEPTANCE = 'awaiting_acceptance';

    public const ACCEPTED = 'accepted';

    public const VALUES = [self::CANCELLED, self::DRAFT, self::AWAITING_PAYMENT, self::PAYMENT_CANCELLED, self::AWAITING_ACCEPTANCE, self::ACCEPTED];

    public static function project(CommerceOrder $order): string
    {
        if ($order->isCancelled()) {
            return self::CANCELLED;
        }
        if (! $order->isConfirmed()) {
            return self::DRAFT;
        }
        $intent = $order->paymentIntent;
        if ($intent instanceof CommercePaymentIntent && $intent->isCancelled()) {
            return self::PAYMENT_CANCELLED;
        }
        if (! self::paymentReady($intent)) {
            return self::AWAITING_PAYMENT;
        }
        if ($order->awaitsManualAcceptance()) {
            return self::AWAITING_ACCEPTANCE;
        }

        return self::ACCEPTED;
    }

    /** R-5: دفع جاهز = نية COD/استلام (`awaiting_collection`/`collected`) أو إلكترونية `paid` — القائمة الواحدة في {@see CommerceOrderAttentionQuery::PAYMENT_READY}. */
    public static function paymentReady(?CommercePaymentIntent $intent): bool
    {
        return $intent !== null && in_array($intent->status, CommerceOrderAttentionQuery::PAYMENT_READY, true);
    }

    /**
     * كتلة القبول للعرض. `mode` اللقطة المخزَّنة (`auto` لـNULL)، و`effective_mode` ما يُنفَّذ الآن (البوابة المغلقة ⇒ `auto`).
     *
     * @return array{mode: string, effective_mode: string, accepted_at: ?string}
     */
    public static function acceptanceBlock(CommerceOrder $order): array
    {
        return [
            'mode' => $order->isManualAcceptance() ? CommerceOrder::ACCEPTANCE_MANUAL : CommerceOrder::ACCEPTANCE_AUTO,
            'effective_mode' => $order->effectiveAcceptanceMode(),
            'accepted_at' => $order->accepted_at?->toIso8601String(),
        ];
    }
}
