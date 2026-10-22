<?php

namespace App\Support;

use RuntimeException;

/** webhook مرفوض: `signature` (توقيع غائب/خاطئ ⇒ 401) أو `malformed` (جسم غير مفهوم ⇒ 400). بلا قيم في الرسالة. */
final class InvalidPaymentWebhookException extends RuntimeException
{
    public function __construct(public readonly string $reason)
    {
        parent::__construct("Invalid payment webhook ({$reason}).");
    }
}
