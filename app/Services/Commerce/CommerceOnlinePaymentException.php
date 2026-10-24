<?php

namespace App\Services\Commerce;

use RuntimeException;

/** فشل عمل متوقَّع في الدفع الإلكتروني للمتجر برمز ثابت (`reason`) تترجمه الطبقة العامة إلى رمز HTTP/عقد. لا تحمل أسراراً ولا تفاصيل مزوّد. */
final class CommerceOnlinePaymentException extends RuntimeException
{
    public function __construct(public readonly string $reason, string $message, ?\Throwable $previous = null)
    {
        parent::__construct($message, 0, $previous);
    }
}
