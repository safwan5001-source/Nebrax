<?php

namespace App\Services\Accounting;

use App\Models\Invoice;

/** نتيجة بناء مسودة فاتورة من سندات تسليم، مع وسم إعادة الطلب الآمنة. */
final readonly class DeliveryNoteInvoiceDraftResult
{
    public function __construct(
        public Invoice $invoice,
        public bool $idempotentReplay,
    ) {}
}
