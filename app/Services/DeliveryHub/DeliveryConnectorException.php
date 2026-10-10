<?php

namespace App\Services\DeliveryHub;

use RuntimeException;

/** فشل إعداد أو إدخال موصّل. الرسالة لا تحتوي سرّاً ولا جسم المصادقة. */
class DeliveryConnectorException extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly int $status = 422,
    ) {
        parent::__construct($message);
    }
}
