<?php

namespace App\Support;

use App\Contracts\Payable;
use App\Models\Invoice;
use App\Models\InvoicePaymentRequest;

/**
 * الـPayable لطلب دفع فاتورة (PAY-H2-02b، ADR-0006): يملك المبلغ والعملة والطرف وصلاحية الدفع، ولا يملك حالة المزوّد.
 *
 * - المبلغ يُعاد حسابه من الفاتورة عند كل استدعاء (المتبقي) ما لم يُحدَّد مبلغ جزئي، وهو مُتحقَّق منه سلفاً في
 *   `InvoicePaymentRequestService` (D-16: الجزئي لا يكون إلا لرابط فعّله، ولا يتجاوز المتبقي). هنا لا يُعاد التحقق من السقف
 *   كي لا تنكسر إعادة تشغيل (replay) محاولة ثُبّت مبلغها؛ الفائض عند الترحيل يعالجه ADR-0006 M3.
 * - الصلاحية: الطلب مفتوح وغير منتهٍ، والفاتورة مرحَّلة بمتبقٍ موجب وطرفها كما التُقط. غير ذلك ⇒ `PaymentNotPayableException`.
 * - طرف الترحيل من لقطة الطلب (null ⇒ لا ترحيل، D-05).
 */
final class InvoicePayable implements Payable
{
    public function __construct(
        private readonly InvoicePaymentRequest $request,
        private readonly ?int $amountMinor = null,
    ) {}

    public function payableKey(): string
    {
        return $this->request->payableKey();
    }

    public function amountDueMinor(): int
    {
        return $this->amountMinor ?? $this->invoice()->remaining();
    }

    public function currency(): string
    {
        return (string) $this->request->currency;
    }

    public function partnerIdForAccounting(): ?string
    {
        return $this->request->partner_id;
    }

    public function allocationTargets(): array
    {
        return [['type' => Invoice::class, 'id' => (string) $this->request->invoice_id]];
    }

    public function assertStillPayable(): void
    {
        $request = InvoicePaymentRequest::query()->find($this->request->getKey());
        if ($request === null || $request->status !== InvoicePaymentRequest::STATUS_OPEN) {
            throw new PaymentNotPayableException('طلب الدفع لم يعد مفتوحاً.');
        }
        if ($request->expires_at !== null && $request->expires_at->isPast()) {
            throw new PaymentNotPayableException('انتهت صلاحية طلب الدفع.');
        }

        $invoice = $this->invoice();
        if (! $invoice->isPosted() || $invoice->remaining() <= 0) {
            throw new PaymentNotPayableException('الفاتورة غير مرحَّلة أو مسدَّدة بالكامل.');
        }
        if ($invoice->partner_id !== $request->partner_id) {
            throw new PaymentNotPayableException('تغيّر طرف الفاتورة منذ إنشاء الطلب.');
        }
    }

    private function invoice(): Invoice
    {
        return Invoice::query()->findOrFail($this->request->invoice_id);
    }
}
