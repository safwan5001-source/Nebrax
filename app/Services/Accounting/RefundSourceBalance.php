<?php

namespace App\Services\Accounting;

use App\Models\CreditNote;
use App\Models\CustomerRefundAllocation;
use App\Models\PaymentRefund;
use App\Models\PaymentRefundAllocation;
use App\Models\ReturnDocument;

/**
 * ═══════════════════════════════════════════════════════════════
 *  رصيد المصدر التجاري القابل للاسترداد — دالة واحدة مشتركة (PAY-H3-01b، ADR-0007 §4.2)
 * ═══════════════════════════════════════════════════════════════
 *  مصدر الحقيقة الوحيد لما استُهلك من إشعار دائن آجل/مرتجع مبيعات آجل، يقرأه كل من `CustomerRefundService` (نقدي/بنكي) و`PaymentRefundService` (بوابة)،
 *  فلا يُدفع المصدر نفسه نقداً وبوابةً معاً (ازدواج الاسترداد):
 *
 *      المستهلَك = Σ تخصيصات الاستردادات النقدية/البنكية **المرحّلة** (`customer_refunds.status = posted`)
 *               + Σ تخصيصات استردادات البوابة في {requested, approved, submitting, unknown, confirmed}
 *
 *  `confirmed` يُحسب مرحَّلاً كان أو محجوباً بفترة (المال خرج فعلاً)، والبقية احتجاز. المرفوض/الملغى/الفاشل لا يستهلك. `$excluding` يستثني مستنداً بعينه
 *  (إعادة التحقق من استرداد قائم لا تخصم احتجازه من رصيده). قراءة فقط؛ الأقفال على المستدعي.
 */
final class RefundSourceBalance
{
    /** @param class-string<ReturnDocument|CreditNote> $sourceModel */
    public function consumed(string $sourceModel, string $sourceId, ?string $excludingPaymentRefundId = null): int
    {
        $cash = (int) CustomerRefundAllocation::query()
            ->where('source_type', $sourceModel)
            ->where('source_id', $sourceId)
            ->whereHas('customerRefund', fn ($q) => $q->where('status', 'posted'))
            ->sum('amount');

        $gateway = (int) PaymentRefundAllocation::query()
            ->where('source_type', $sourceModel)
            ->where('source_id', $sourceId)
            ->whereHas('paymentRefund', function ($q) use ($excludingPaymentRefundId) {
                $q->whereIn('status', PaymentRefund::SOURCE_CONSUMING);
                if ($excludingPaymentRefundId !== null) {
                    $q->where('id', '<>', $excludingPaymentRefundId);
                }
            })
            ->sum('amount_minor');

        return $cash + $gateway;
    }

    public function refundable(ReturnDocument|CreditNote $source, ?string $excludingPaymentRefundId = null): int
    {
        return (int) $source->total - $this->consumed($source::class, (string) $source->getKey(), $excludingPaymentRefundId);
    }
}
