<?php

namespace App\Services;

use App\Models\PaymentAttempt;
use App\Models\PaymentRefund;
use App\Models\PaymentRefundEvent;

/**
 * قاعدة المزامنة (ADR-0007 §3، AWJ Decision): المزامنة العادية (webhook أو استطلاع) **لا تكتب `payment_attempts.refunded_minor` أبداً** من لقطة المزوّد.
 * أي `refunded` لدى المزوّد يزيد عن المعترَف به محلياً — دون استرداد داخلي قيد الطيران قد يفسّره — يُسجَّل فرقاً غير معترَف به: تُوسم الدفعة
 * `unrecognized_refund` ويُمنع الإرسال عليها حتى حسم بشري (`PaymentRefundService::resolveExternalRefund`). فلا يتطابق الأساس المجلوب لاحقاً مع محلي «مزامَن بصمت».
 *
 * يُستدعى من `PaymentOrchestrator::applySnapshot` **داخل معاملته وتحت قفل صف المحاولة** (لا قفل إضافي، لا شبكة). قراءة لقطة أقل أو مساوية للمحلي لا أثر لها
 * (لقطة متأخرة/قديمة). لا يحرّك مالاً.
 */
final class PaymentRefundObservation
{
    /** @return bool هل وُسمت/حُدّثت الدفعة بعلم الاسترداد الخارجي */
    public function observe(PaymentAttempt $lockedAttempt, int $observedRefundedMinor): bool
    {
        if ($observedRefundedMinor <= (int) $lockedAttempt->refunded_minor) {
            return false;
        }
        // استرداد داخلي قيد الطيران قد يكون سبب الزيادة؛ يحسمه ردّه المباشر أو المطابِق لا هذه المزامنة.
        $inFlight = PaymentRefund::query()
            ->where('payment_attempt_id', $lockedAttempt->getKey())
            ->whereIn('status', [PaymentRefund::SUBMITTING, PaymentRefund::UNKNOWN])
            ->exists();
        if ($inFlight) {
            return false;
        }
        if ($lockedAttempt->unrecognized_refund_at !== null && (int) $lockedAttempt->unrecognized_refund_minor >= $observedRefundedMinor) {
            return false;
        }

        $first = $lockedAttempt->unrecognized_refund_at === null;
        $lockedAttempt->forceFill([
            'unrecognized_refund_at' => $lockedAttempt->unrecognized_refund_at ?? now('UTC'),
            'unrecognized_refund_minor' => $observedRefundedMinor,
        ])->save();

        PaymentRefundEvent::query()->create([
            'payment_refund_id' => null,
            'payment_attempt_id' => $lockedAttempt->getKey(),
            'action' => $first ? 'external_refund_flagged' : 'external_refund_updated',
            'actor_id' => null,
            'meta' => ['observed_minor' => $observedRefundedMinor, 'local_minor' => (int) $lockedAttempt->refunded_minor, 'source' => 'sync'],
        ]);

        return true;
    }
}
