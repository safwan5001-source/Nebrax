<?php

namespace App\Services;

use App\Models\FuelSalePaymentReceipt;
use App\Models\FuelShift;
use App\Models\FuelShiftCashVariance;
use App\Models\FuelShiftEvent;
use App\Models\Payment;
use App\Tenancy\BranchScope;

/**
 * #2021 (D2) — أثر تدقيقي مستقل لعكس سند نقدي مختوم بوردية **أُغلقت** بعد استلامه.
 *
 * لا يعدّل المتوقع ولا المعدود ولا الفرق ولا حالة الوردية (مجمَّدة)، ولا يُنشئ قيداً ولا حالة وردية جديدة:
 * حدث append-only على الوردية يعرضه الملخص إرشادياً للمشرف. العكس قبل الإغلاق لا يحتاج حدثاً (الحساب الحيّ يستبعده).
 *
 * يُستدعى من `PaymentReversalService` داخل معاملة العكس نفسها (كل مسارات العكس) على مرحلتين:
 *  1) `lockShiftBeforeReversal` — **أول شيء بعد قفل السند وقبل قفل الفاتورة ومِرساة المستأجر**: قفل مشترك على الوردية فيتسلسل مع
 *     `close` (FOR UPDATE): إما يسبق الإغلاق فيلتقطه الحساب، أو يتبعه فيُسجَّل أثراً لاحقاً. الترتيب إلزامي: `close` يمسك الوردية
 *     ثم يحتاج FOR KEY SHARE على صف المستأجر (مفتاح أجنبي) الذي تمسكه المِرساة FOR UPDATE داخل العكس؛ أخذ قفل الوردية بعد المِرساة
 *     كان يُنتج جموداً (40P01) أثبته اختبار التزامن على PostgreSQL.
 *  2) `onPaymentReversed` — بعد العكس: يكتب الحدث إن كانت الوردية مغلقة/معتمدة (القفل ما زال ممسوكاً فالحالة المقروءة نهائية).
 */
class FuelShiftCashAdjustmentRecorder
{
    /** المرحلة 1: قفل مشترك على وردية الإيصال النقدي المختوم (إن وُجدت) قبل أي قفل آخر في العكس. */
    public function lockShiftBeforeReversal(Payment $payment): void
    {
        $receipt = $this->cashReceipt($payment);
        if ($receipt !== null) {
            FuelShift::withoutGlobalScope(BranchScope::class)->whereKey($receipt->fuel_shift_id)->sharedLock()->first();
        }
    }

    private function cashReceipt(Payment $payment): ?FuelSalePaymentReceipt
    {
        // الفرع ليس شرط رؤية هنا: العكس قد يجري بفرع نشط مختلف، والمستأجر يبقى مقيَّداً بنطاقه.
        $receipt = FuelSalePaymentReceipt::withoutGlobalScope(BranchScope::class)
            ->where('payment_id', $payment->id)
            ->whereNotNull('fuel_shift_id')
            ->first();

        return $receipt !== null && $receipt->settlement_type === 'cash' ? $receipt : null;
    }

    /** المرحلة 2: أثر ما بعد الإغلاق. */
    public function onPaymentReversed(Payment $payment, ?string $actorId = null): ?FuelShiftEvent
    {
        $receipt = $this->cashReceipt($payment);
        if ($receipt === null) {
            return null;
        }
        $shift = FuelShift::withoutGlobalScope(BranchScope::class)->find($receipt->fuel_shift_id);
        if ($shift === null || $shift->isOpen()) {
            return null;
        }
        $already = FuelShiftEvent::withoutGlobalScope(BranchScope::class)
            ->where('fuel_shift_id', $shift->id)
            ->where('type', FuelShiftEvent::TYPE_POST_CLOSE_CASH_ADJUSTMENT)
            ->get()
            ->contains(fn (FuelShiftEvent $e) => ($e->payload['payment_id'] ?? null) === $payment->id);
        if ($already) {
            return null;
        }
        $frozen = FuelShiftCashVariance::withoutGlobalScope(BranchScope::class)->where('fuel_shift_id', $shift->id)->first();

        return FuelShiftEvent::create([
            'branch_id' => $shift->branch_id,
            'fuel_shift_id' => $shift->id,
            'type' => FuelShiftEvent::TYPE_POST_CLOSE_CASH_ADJUSTMENT,
            'payload' => [
                'kind' => 'payment_reversed',
                'payment_id' => $payment->id,
                'receipt_id' => $receipt->id,
                'fuel_sale_id' => $receipt->fuel_sale_id,
                'amount_minor' => (int) $receipt->amount_minor,
                // اللقطة كما هي: لا تتغير بهذا الحدث.
                'frozen_expected_cash_minor' => $frozen?->expected_operational_cash_minor === null ? null : (int) $frozen->expected_operational_cash_minor,
                'frozen_variance_minor' => $frozen?->variance_minor === null ? null : (int) $frozen->variance_minor,
                'shift_status_at_reversal' => $shift->status,
            ],
            'actor_id' => $actorId ?? auth()->id(),
            'occurred_at' => now(),
        ]);
    }
}
