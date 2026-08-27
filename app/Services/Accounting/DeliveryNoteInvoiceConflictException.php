<?php

namespace App\Services\Accounting;

use RuntimeException;

/** تعارض متوقع: إعادة تخصيص، نسخة قديمة، أو مفتاح idempotency بحمولة مختلفة. */
class DeliveryNoteInvoiceConflictException extends RuntimeException
{
}
