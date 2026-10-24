<?php

namespace App\Support;

use App\Contracts\Payable;
use App\Models\CommerceOrder;
use App\Models\CommercePaymentIntent;
use App\Models\PaymentAttempt;

/**
 * الـPayable لنية دفع إلكتروني لطلب متجر (PAY-H4-04a، ADR-04): يملك المبلغ والعملة وصلاحية الدفع، ولا يملك حالة المزوّد.
 *
 * - المبلغ لقطة النية (`amount_minor` = إجمالي الطلب وقت الإتمام، ثابت): لا يُقبل مبلغ من العميل ولا يُعاد حسابه من الأسعار الحالية.
 * - الصلاحية: النية `online` بحالة `pending` وطلبها `confirmed` ولا التقاط سابق لها. غير ذلك ⇒ `PaymentNotPayableException`.
 * - طرف الترحيل = طرف الطلب (null للضيف ⇒ لا ترحيل، D-05)؛ **هذه الشريحة لا ترحّل أصلاً** (G3): لا `allocationTargets`.
 */
final class CommercePayable implements Payable
{
    public function __construct(private readonly CommercePaymentIntent $intent) {}

    public function payableKey(): string
    {
        return $this->intent->payableKey();
    }

    public function amountDueMinor(): int
    {
        return (int) $this->fresh()->amount_minor;
    }

    public function currency(): string
    {
        return (string) $this->fresh()->currency;
    }

    public function partnerIdForAccounting(): ?string
    {
        return CommerceOrder::query()->find($this->intent->commerce_order_id)?->partner_id;
    }

    public function allocationTargets(): array
    {
        return [];
    }

    public function assertStillPayable(): void
    {
        $intent = CommercePaymentIntent::query()->find($this->intent->getKey());
        if ($intent === null || ! $intent->isOnline()) {
            throw new PaymentNotPayableException('نية الدفع الإلكتروني غير موجودة.');
        }
        if ($intent->isPaid()) {
            throw new PaymentNotPayableException('الطلب مدفوع بالفعل.');
        }
        if ($intent->status !== CommercePaymentIntent::STATUS_PENDING) {
            throw new PaymentNotPayableException('نية الدفع لم تعد بانتظار الدفع.');
        }

        $order = CommerceOrder::query()->find($intent->commerce_order_id);
        if ($order === null || $order->status !== CommerceOrder::STATUS_CONFIRMED) {
            throw new PaymentNotPayableException('الطلب غير مؤكَّد.');
        }

        // التقاط سابق (حتى قبل أن تُثبَّت النية مدفوعة) ⇒ لا محاولة جديدة تُحصِّل مبلغاً ثانياً.
        $captured = PaymentAttempt::query()
            ->where('payable_key', $intent->payableKey())
            ->where('capture_status', PaymentAttempt::STATUS_CAPTURED)
            ->exists();
        if ($captured) {
            throw new PaymentNotPayableException('سبق التقاط دفعة لهذا الطلب.');
        }
    }

    private function fresh(): CommercePaymentIntent
    {
        return CommercePaymentIntent::query()->findOrFail($this->intent->getKey());
    }
}
