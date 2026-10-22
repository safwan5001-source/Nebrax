<?php

namespace App\Support;

use DomainException;

/**
 * خطأ قاعدة عمل لاتصال بوابة الدفع برمز ثابت (`reason`) تترجمه الواجهة.
 * يرث DomainException كي تبقى كل الاختبارات والمستدعين القائمين الذين ينتظرونه سليمين.
 */
class PaymentGatewayException extends DomainException
{
    public function __construct(public readonly string $reason, string $message)
    {
        parent::__construct($message);
    }
}
